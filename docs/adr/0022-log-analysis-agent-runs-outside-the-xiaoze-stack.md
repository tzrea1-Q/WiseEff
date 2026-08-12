# ADR-0022: Log analysis agent runs outside the Xiaoze stack

- Status: Accepted
- Date: 2026-08-12

## Context

Xiaoze is the sole conversational Agent surface: a LangGraph `StateGraph` with thread checkpointers behind `/api/v1/agent/xiaoze`, a shared `ToolRegistry`, and an approval chain that gates every mutating tool. The 2026-08-12 planning session for the agent log analysis system decided that log analysis gets its own autonomous multi-step kernel (the **log analysis agent**, see `CONTEXT.md`) behind the reserved `LogAnalysisAdapter` seam inside the M2 pipeline's `rootcause` stage. The obvious path would have been to reuse the Xiaoze stack for that kernel.

## Decision

The log analysis agent runs as a **plain bounded loop** owned by the logs module, not on the Xiaoze stack:

- It reuses only the OpenAI-compatible chat client pattern and the provider evidence discipline (model, latency, tokens, trace id; never raw prompts or payloads), configured through a separate `LOG_ANALYSIS_*` env family so log analysis and Xiaoze can point at different models.
- The loop is an ordinary bounded for-loop with a max-step and token budget, and a deterministic fake-model seam for evaluation. No LangGraph, no checkpointer: cross-attempt durability is already owned by the PostgreSQL jobs queue (lease, retry, dead letter), so a conversation checkpointer would be dead weight.
- Its tools are internal read-only functions of the worker, organization-scoped at the repository layer. They are **not** registered in the Xiaoze `ToolRegistry` and never enter the approval chain: that registry exists to gate user-session mutations, and the log analysis agent mutates nothing — its entire output is an advisory, evidence-grounded report.

## Consequences

- Two LLM call paths coexist in the codebase (Xiaoze's graph and the logs loop). Accepted: they serve different jobs, and forcing one stack would couple an interactive HITL surface to a batch worker.
- Xiaoze stays a read-only consumer of finished conclusions (`perception.getRecentLogConclusions`); it never analyzes logs in-session.
- If the loop ever needs cross-request planning or human-in-the-loop interrupts, that is a new decision — revisit with a new ADR rather than silently migrating onto LangGraph.
- Provider outage degrades to the deterministic rule analyzer with explicit provenance (degraded analysis, `CONTEXT.md`), never silently; `docs/SECURITY.md` must state the log-analysis LLM path (advisory output, no write path, prompt-injection stance for untrusted log content) when P1 ships.
