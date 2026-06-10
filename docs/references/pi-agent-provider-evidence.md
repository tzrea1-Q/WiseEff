# Pi Agent Provider Evidence Reference

WiseEff uses `@earendil-works/pi-ai` only behind the backend live Agent provider adapter. The product runtime must not load `@earendil-works/pi-agent-core`, `@earendil-works/pi-coding-agent`, Pi filesystem tools, Pi shell tools, or project-local `.pi` extensions.

Safe evidence may include:

- `provider`: `deterministic` or `live`
- `format`: `deterministic`, `wiseeff`, `openai`, or `pi`
- `piProvider`: Pi provider id such as `minimax`
- `model`
- `promptVersion`
- readiness status
- request id, session id, trace id
- latency, token usage, estimated cost
- safety status, safety reasons, fallback reason
- approval id for approval-required tool requests

Evidence must not include:

- `AGENT_API_KEY`
- Authorization headers or bearer tokens
- raw prompts
- raw provider payloads
- customer data
- raw uploaded logs
- raw parameter values
- raw device write payloads

Core commands:

```bash
npm run agent:pi-eval
npm test -- scripts/run-pi-agent-smoke.test.ts
npm run agent:pi-smoke
npm run smoke:m5
```

`agent:pi-eval` is offline and deterministic. `agent:pi-smoke` is live-key dependent and uses a synthetic no-tool prompt; its output must report `toolRequests: 0`.
