# Xiaoze LLM Runbook

> Chinese: [Chinese](../zh-CN/runbooks/agent-provider.md)

Use this runbook when validating live Xiaoze LLM configuration in staging or pilot. Xiaoze is the sole Agent surface; API mode always mounts CopilotKit against `POST /api/v1/agent/xiaoze`. Mock mode has no Agent UI.

## Required Configuration

- `XIAOZE_LLM_API_BASE_URL`
- `XIAOZE_LLM_MODEL` (blank defaults to `gpt-4o-mini`)
- `XIAOZE_LLM_API_KEY`
- `AGENT_API_TIMEOUT_MS` remains separate, currently unwired debt; it is not a fourth canonical Xiaoze key.

For acceptance or offline drills without a live model, set `XIAOZE_DETERMINISTIC=true` instead of filling `XIAOZE_LLM_*`. If any canonical raw key is present, the canonical group wins as a unit, including explicit blanks. Legacy aliases are read only when the whole canonical group is absent and produce redacted migration diagnostics.

Production and self-hosted deployments must set `XIAOZE_CHECKPOINTER=postgres` (unless `XIAOZE_DETERMINISTIC=true`). Run `npm run db:migrate` after deploy or config changes so LangGraph checkpoint tables are ensured before serving traffic.

## Readiness Check

1. Run `npm run db:migrate` when `XIAOZE_CHECKPOINTER=postgres` and confirm checkpoint tables exist (`checkpoints`, `checkpoint_blobs`, `checkpoint_writes`, `checkpoint_migrations`).
2. Start the API with live Xiaoze LLM configuration (or `XIAOZE_DETERMINISTIC=true` for offline acceptance).
3. Check `/health/ready`.
4. Confirm `dependencies.xiaozeLlm.details` reports safe evidence such as `baseUrlConfigured` and, when present, `model`.
5. Check `/api/v1/operations/pilot-readiness` with an admin smoke token and confirm the `xiaozeLlm` gate is ready.
6. Check `/metrics` from the private operations network and confirm readiness gauges reflect the Xiaoze LLM dependency without exposing secrets in labels.
7. Run a minimal Xiaoze acceptance spec or open the CopilotKit popup in API mode and send a read-only prompt.
8. Confirm mutating tool proposals create approvals and resume only through the orchestrator approval chain with audit `actorType=agent`.

## Safety Expectations

- Unknown tool names must be rejected.
- Mutating tool requests must create approvals instead of executing directly.
- LLM outage may produce a degraded assistant response, but it must skip tool execution.
- Unsafe or ungrounded mutating output must not bypass the tool registry.

## Evidence

Record:

- model name,
- request id,
- thread id when applicable,
- trace id,
- latency and token/cost metadata when available,
- fallback or safety status,
- approval id for mutating tool requests.

Do not commit API keys, raw sensitive prompts, raw provider payloads, Authorization headers, or customer data to repository docs.

## Smoke Commands

```bash
npm run smoke:m5
npm run acceptance:e2e -- e2e/acceptance/xiaoze-perception.acceptance.spec.ts
npm run acceptance:e2e -- e2e/acceptance/xiaoze-action.acceptance.spec.ts
```

Mutating Xiaoze actions use the orchestrator approval chain; see `docs/SECURITY.md` and `e2e/acceptance/xiaoze-action.acceptance.spec.ts`.
