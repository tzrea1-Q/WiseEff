# Pi Agent Provider Evidence Reference

> **Superseded (2026-06-24, P1 / TD-027):** The Pi provider, `@earendil-works/pi-ai`, `AGENT_API_FORMAT=pi`, and Pi smoke scripts were removed. Xiaoze now uses LangChain `ChatOpenAI` against OpenAI-compatible `AGENT_API_*` configuration. See `docs/runbooks/agent-provider.md` and `docs/exec-plans/tech-debt-tracker.md` (TD-027).

This file is retained only as a historical pointer. Do not run the commands below; they no longer exist in the repository.

Historical safe evidence fields included `provider`, `format`, `model`, `promptVersion`, readiness status, request/session/trace ids, latency, token usage, estimated cost, safety status, and approval ids for mutating tool requests. Evidence must never include API keys, Authorization headers, raw prompts, raw provider payloads, customer data, raw logs, raw parameter values, or raw device write payloads.
