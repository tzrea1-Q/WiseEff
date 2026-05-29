# Agent Provider Runbook

Use this runbook when validating a live Agent provider in staging or pilot.

## Required Configuration

- `AGENT_PROVIDER=live`
- `AGENT_API_FORMAT=openai`
- `AGENT_API_BASE_URL`
- `AGENT_MODEL`
- `AGENT_API_KEY`
- `AGENT_API_TIMEOUT_MS`
- `AGENT_PROMPT_VERSION`

## Readiness Check

1. Start the API with live provider configuration.
2. Check `/health/ready`.
3. Confirm the provider dependency reports ready or gives a clear blocked reason.
4. Send a minimal Agent request through the API.
5. Confirm trace metadata includes provider, model, latency, token usage, estimated cost, safety status, and fallback reason when applicable.

## Safety Expectations

- Unknown tool names must be rejected.
- Mutating tool requests must create approvals instead of executing directly.
- Provider outage may produce a degraded assistant response, but it must skip tool execution.
- Unsafe or ungrounded mutating output must not bypass the tool registry.

## Evidence

Record:

- provider and model name,
- prompt version,
- request id,
- session id,
- trace id,
- latency and token/cost metadata,
- fallback or safety status,
- approval id for mutating tool requests.

Do not commit API keys, raw sensitive prompts, or customer data to repository docs.
