# Xiaoze run timeline and streaming metadata closeout

> Status: **Completed 2026-08-22**
> Historical label: this file previously reused `TD-031`, but timeline/streaming implementation was absorbed by completed `2026-08-12-xiaoze-turn-stream` and TD-070 is closed. Current TD-031 refers only to Xiaoze LLM environment naming and closed via #591.
> Chinese: [Chinese](../../zh-CN/exec-plans/completed/2026-08-22-xiaoze-run-timeline-streaming-metadata-closeout.md)

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

- [x] English + Chinese persistence design docs state that finalized assistant messages store `metadata: { runSteps, runId }`, hydration restores `metadata.runSteps`, and persistence occurs after successful turn completion rather than per SSE token.

No product/code work remained in this plan. The metadata note matches `server/modules/agent/xiaoze/threadPersistence.ts` and `src/features/agent/XiaozeTurnTimeline.tsx`; the plan now exists only under `completed/` with a Chinese companion.

## Verification

```bash
npm run test:server -- runEventSink runTimelineEvents planningGraph agUiEndpoint threadPersistence
npm test -- XiaozeReasoningMessage XiaozeProvider
npm run build
```

Browser: send a tool-grounded prompt; confirm tool steps stream before answer, reasoning label uses server duration after finish.
