# Agent Provider Runbook

> Chinese: [Chinese](../zh-CN/runbooks/agent-provider.md)

Use this runbook when validating a live Agent provider in staging or pilot.

## Required Configuration

- `AGENT_PROVIDER=live`
- `AGENT_API_FORMAT=pi`
- `AGENT_PI_PROVIDER=minimax`
- `AGENT_MODEL`
- `AGENT_API_KEY`
- `AGENT_API_TIMEOUT_MS`
- `AGENT_PROMPT_VERSION=m7-pi-agent-v1`

Use `AGENT_API_FORMAT=openai` or `wiseeff` only for the legacy URL-backed transports. Those formats require `AGENT_API_BASE_URL`; Pi does not.

## Readiness Check

1. Run the offline adapter eval: `npm run agent:pi-eval`.
2. If a live Pi key is intentionally configured, run `npm run agent:pi-smoke`. For local documentation-only checks without a live key, use `npm run agent:pi-smoke -- --allow-deterministic` and mark the result as a no-op wiring check, not provider evidence.
3. Start the API with live provider configuration.
4. Check `/health/ready`.
5. Confirm `dependencies.agentProvider.details` reports safe provider evidence such as `provider`, `format`, `piProvider`, `model`, and `promptVersion`.
6. Check `/api/v1/operations/pilot-readiness` with an admin smoke token and confirm the Agent provider gate includes the same safe details.
7. Check `/metrics` from the private operations network and confirm `wiseeff_agent_provider_ready` is present. Pi-backed providers should also expose the low-cardinality labels `provider="live"`, `format="pi"`, and `piProvider="<id>"`; model and prompt version stay out of metric labels.
8. Send a minimal Agent request through the API.
9. Confirm trace metadata includes provider, model, prompt version, request/trace id, latency, token usage, estimated cost, safety status, and fallback reason when applicable.

## Safety Expectations

- Unknown tool names must be rejected.
- Mutating tool requests must create approvals instead of executing directly.
- Provider outage may produce a degraded assistant response, but it must skip tool execution.
- Unsafe or ungrounded mutating output must not bypass the tool registry.

## Evidence

Record:

- provider and model name,
- Pi provider id when `AGENT_API_FORMAT=pi`,
- prompt version,
- request id,
- session id,
- trace id,
- latency and token/cost metadata,
- fallback or safety status,
- approval id for mutating tool requests.
- explicit note that Pi Coding Agent CLI, Pi filesystem tools, and Pi shell tools were not loaded in the WiseEff product runtime.

Do not commit API keys, raw sensitive prompts, raw provider payloads, Authorization headers, or customer data to repository docs.

## Pi Evidence Commands

```bash
npm run agent:pi-eval
npm test -- scripts/run-pi-agent-smoke.test.ts
npm run agent:pi-smoke
npm run smoke:m5
```

`agent:pi-eval` is CI-safe and uses fake Pi completions. `agent:pi-smoke` is live-key dependent and uses only a synthetic no-tool prompt. The smoke result must report `toolRequests: 0`; any provider tool request during smoke is a failed smoke.
