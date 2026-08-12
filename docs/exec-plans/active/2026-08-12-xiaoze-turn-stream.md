# Xiaoze turn stream: one module owns "what has streamed so far"

> Status: **Active**
> Date: 2026-08-12
> Branch: `refactor/xiaoze-turn-stream`
> Chinese: [`docs/zh-CN/exec-plans/active/2026-08-12-xiaoze-turn-stream.md`](../../zh-CN/exec-plans/active/2026-08-12-xiaoze-turn-stream.md)
> Source: 2026-08-12 architecture review, candidate 2 (Strong)

## Goal

Deepen the Xiaoze turn streaming pipeline into one module, `xiaozeTurnStream.ts`, whose interface is a synchronous reducer: `open() / ingest(sink event) / interrupt(approval begin) / finalize(run result) / forbidden(message) / fail(error)`, each returning AG-UI frames. Today one assistant reply crosses 14 files; "what has streamed so far" lives in three mutually unaware mirrors (`TurnStreamFlags`, `XiaozeTurnStateTracker`, the classifier's sink bookkeeping) that `finalizeTurnReply` reconciles with a 90 % similarity fudge; and `agUiEndpoint.ts` hosts 23 inline frame literals plus two identical FORBIDDEN reply blocks. After this change the module holds the only copy of streaming progress, the endpoint shrinks to transport (auth, parse, pump, persist, SSE), and every frame is produced by the module.

## Non-goals

- Wire-protocol changes: CUSTOM event names and payload shapes (`xiaoze_turn_state`, `xiaoze_turn_reply`, `xiaoze_run_timing`, `xiaoze_prompt_debug`, `on_interrupt`) are unchanged; no frontend edits.
- Removing the 90 % resync tolerance (kept as an internal implementation detail; changing it is a separate behavior decision).
- Touching the model-side classification (`reasoningClassifier` stream router, `splitAssistantContent`) — they keep their property-tested seam and are not absorbed.

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation agent | Commit on `refactor/xiaoze-turn-stream`; do not open or merge GitHub PRs |
| Parent agent | Review, run verification, open/merge the PR, then sync local `main` |

## Design decisions (settled 2026-08-12)

- **D1 Interface:** synchronous reducer, no IO. Pumping (`pumpAgentRun`) stays in the endpoint; `beginApproval` (IO) stays in the endpoint and the module renders its result.
- **D2 Boundary:** the module absorbs `runTimelineEvents.ts` (frame construction), `streamAssistantReply.ts` (reasoning frames + `AgUiStreamEvent`), the `XiaozeTurnStateTracker` implementation, `TurnStreamFlags`, and `finalizeTurnReply`'s resync arithmetic. `runEventSink.ts` stays as the transport queue and gains `serializeTurnSteps` / `createToolCallId` (step-record vocabulary, imported by the graph). `xiaozeTurnState.ts` keeps only the wire types (`XIAOZE_TURN_STATE_EVENT`, phase/step/payload types, `turnStateCustomEvent`).
- **D3 One progress truth:** a single internal record replaces the three mirrors. The handler-side `reasoningClassifier` option is deleted: its `normalizeSinkEvent` performed no event transformation (it only appended deltas into the flags this module now owns); model-side classification is untouched.
- **D4 Behavior line:** frame sequences are preserved (existing `agUiEndpoint.test.ts` assertions must pass unchanged), with one intended enhancement — see D5. One intentional cleanup: the old `finalizeTurnReply` emitted a duplicate `REASONING_MESSAGE_END` when reasoning arrived without having streamed; the module ends reasoning exactly once (frontend treated the duplicate as a no-op).
- **D5 TD-070 closes:** the resume branch joins the same open/ingest/finalize path, so approved turns now stream run steps and turn state like any other turn, and a chained second interrupt after a resume is handled instead of silently dropped (today the resume branch ignores `result.interrupt`). The approved execution itself becomes a timeline step: `planningGraph` actNode wraps `resolveApproval` in a tool run step (approve only; a reject executes nothing and records none). Resume turns still do not persist the "approve" user message.
- **D6 Dead exports deleted** with their host files: `yieldAssistantReply`, `yieldReasoningTurn` (unused once resume unifies), duplicated FORBIDDEN blocks, `buildInterruptValue`, `turnReplyCustomEvent`.

## Tasks

1. Create `server/modules/agent/xiaoze/xiaozeTurnStream.ts` (reducer + all frame construction + single progress record + resync arithmetic + turn-state snapshots; `finalize` returns `{ events, reply }` so the endpoint can persist).
2. Move `serializeTurnSteps` / `createToolCallId` into `runEventSink.ts`; update `planningGraph.ts` / endpoint imports.
3. Rewrite `streamEvents` in `agUiEndpoint.ts` as one path (initial and resume turns) over the module; delete absorbed helpers and the handler `reasoningClassifier` option; delete `runTimelineEvents.ts` and `streamAssistantReply.ts`; shrink `xiaozeTurnState.ts` to wire types.
4. Tests: new `xiaozeTurnStream.test.ts` (golden frame sequences for plain reply, streamed reply with resync, tool steps, interrupt, forbidden, error, turn-state snapshots; absorb the assertions from `runTimelineEvents.test.ts`, `streamAssistantReply.test.ts`, `xiaozeTurnState.test.ts`, which are deleted). Existing `agUiEndpoint.test.ts` must pass unchanged, plus one new resume-with-steps case (TD-070 behavior).
5. Docs: tracker closes TD-070; `docs/PLANS.md` + zh entries; this plan + zh companion.
6. Verify: agent module tests, `tsc -b`, `npm run docs:check`, and a manual isolated-API pass (deterministic model): streamed read turn, approval turn, resume turn showing step frames.

## Documentation Impact Matrix

| Area | Action | Paths |
| --- | --- | --- |
| Repository maps | No change | Module list unchanged (`server/modules/agent/` description already generic) |
| Planning | Update | This plan + zh; `docs/PLANS.md` + `docs/zh-CN/PLANS.md` |
| Domain / ADR | No change | No new durable decision; wire protocol unchanged |
| Product specs | No change | Approved-turn step timeline is a presentation enhancement inside existing behavior promises |
| Architecture | No change | `ARCHITECTURE.md` does not describe the streaming internals |
| Quality / testing | No change | No acceptance-ID surface change (SSE frame set unchanged; new frames on resume turns are additive) |
| Reliability / runbooks | No change | — |
| Security / governance | No change | — |
| Frontend / design docs | Review | `docs/FRONTEND.md` — wire protocol unchanged; expect no change with evidence |
| Tech debt | Update | TD-070 closed |

## Documentation Update Gate

- [x] TD-070 moved to Completed with evidence
- [x] `docs/PLANS.md` EN + zh list this plan
- [x] `docs/FRONTEND.md` reviewed — no change needed (wire protocol untouched; no doc references the absorbed files)
- [ ] `npm run docs:check` green before moving this plan to `completed/`
