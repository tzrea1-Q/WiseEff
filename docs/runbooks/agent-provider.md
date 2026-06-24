# Agent Provider Runbook

> Chinese: [Chinese](../zh-CN/runbooks/agent-provider.md)

Use this runbook when validating a live Agent provider in staging or pilot.

## Required Configuration

- `AGENT_PROVIDER=live`
- `AGENT_API_FORMAT=wiseeff` or `openai`
- `AGENT_API_BASE_URL`
- `AGENT_MODEL`
- `AGENT_API_KEY`
- `AGENT_API_TIMEOUT_MS`
- `AGENT_PROMPT_VERSION=m5-agent-v1`

`AGENT_API_FORMAT=pi` and `@earendil-works/pi-ai` were removed in P1 (TD-027). Legacy `.env` files that still set `pi` are migrated to `wiseeff` at server startup.

## Readiness Check

1. Start the API with live provider configuration.
2. Check `/health/ready`.
3. Confirm `dependencies.agentProvider.details` reports safe provider evidence such as `provider`, `format`, `model`, and `promptVersion`.
4. Check `/api/v1/operations/pilot-readiness` with an admin smoke token and confirm the Agent provider gate includes the same safe details.
5. Check `/metrics` from the private operations network and confirm `wiseeff_agent_provider_ready` is present with low-cardinality labels `provider="live"` and `format="wiseeff"` or `format="openai"`. Model and prompt version stay out of metric labels.
6. Send a minimal Agent request through the API.
7. Confirm trace metadata includes provider, model, prompt version, request/trace id, latency, token usage, estimated cost, safety status, and fallback reason when applicable.

## Safety Expectations

- Unknown tool names must be rejected.
- Mutating tool requests must create approvals instead of executing directly.
- Provider outage may produce a degraded assistant response, but it must skip tool execution.
- Unsafe or ungrounded mutating output must not bypass the tool registry.

## Evidence

Record:

- provider and model name,
- format (`wiseeff` or `openai`),
- prompt version,
- request id,
- session id,
- trace id,
- latency and token/cost metadata,
- fallback or safety status,
- approval id for mutating tool requests.

Do not commit API keys, raw sensitive prompts, raw provider payloads, Authorization headers, or customer data to repository docs.

## Smoke Commands

```bash
npm run smoke:m5
npm run test:server -- providerRegistry
```

`providerRegistry.test.ts` rejects `AGENT_API_FORMAT=pi`. Xiaoze mutating actions use the orchestrator approval chain; see `docs/SECURITY.md` and `e2e/acceptance/xiaoze-action.acceptance.spec.ts`.
