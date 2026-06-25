# TD-031: Xiaoze run timeline and streaming (P0 + P2)

Status: active

## Goal

Expose mid-run process visibility (tool steps, streaming deltas, accurate thinking duration) via AG-UI SSE and persist turn steps on assistant messages.

## Scope

- P0: server `startedAt` / `durationMs` on `RUN_STARTED` and `xiaoze_run_timing` custom event
- P2: `RunEventSink` in planning graph, SSE pump in `agUiEndpoint`, optional LLM `.stream()`, `XiaozeTurnTimeline`, `agent_messages.metadata`

## Documentation Impact Matrix

| Doc | Action |
| --- | --- |
| `docs/design-docs/xiaoze-thread-persistence.md` | Note run step metadata on assistant messages |
| `docs/zh-CN/design-docs/xiaoze-thread-persistence.md` | Mirror metadata note |

## Documentation Update Gate

- [ ] English + Chinese design doc metadata note before merge

## Verification

```bash
npm run test:server -- runEventSink runTimelineEvents planningGraph agUiEndpoint threadPersistence
npm test -- XiaozeReasoningMessage XiaozeProvider
npm run build
```

Browser: send a tool-grounded prompt; confirm tool steps stream before answer, reasoning label uses server duration after finish.
