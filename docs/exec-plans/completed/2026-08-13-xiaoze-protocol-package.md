# Xiaoze wire protocol: one contract, two adapters

> Status: **Completed 2026-08-13** (single-PR change; plan recorded at completion)
> Date: 2026-08-13
> Branch: `refactor/xiaoze-protocol-package`
> Chinese: [`docs/zh-CN/exec-plans/completed/2026-08-13-xiaoze-protocol-package.md`](../../zh-CN/exec-plans/completed/2026-08-13-xiaoze-protocol-package.md)
> Source: 2026-08-12 architecture review, candidate 5; ADR-0031

## What changed

- **New workspace package `@wiseeff/xiaoze-protocol`** (`packages/xiaoze-protocol`): the five CUSTOM event names (`xiaoze_turn_state`, `xiaoze_turn_reply`, `xiaoze_run_timing`, `xiaoze_prompt_debug`, `on_interrupt`) and their payload shapes — `XiaozeRunStep`, `XiaozeCitation` (+ type enum), `XiaozeTurnStatePayload`, `XiaozeTurnReplyPayload`, `XiaozeRunTimingPayload`, `XiaozePromptDebugSnapshot/Payload`, `XiaozeTurnPhase`. Shapes only; heuristics and rendering stay on their own side (ADR-0031).
- **Server**: `xiaozeTurnState.ts` and `xiaozeTurnReply.ts` deleted (the one remaining helper, `turnStateCustomEvent`, was inlined into `xiaozeTurnStream`); `runEventSink` / `modelTypes` / `promptDebug` / `types.ts` now import or re-export the contract; the step record is `XiaozeRunStep` everywhere (the `XiaozeRunStepRecord` name is gone); `AgentCitation` is a contract alias.
- **Frontend**: the four hand-copied mirror files (`xiaozeTurnStateTypes.ts`, `xiaozeTurnReplyTypes.ts`, `xiaozeRunTimingTypes.ts`, `xiaozePromptDebugTypes.ts`) deleted; ~20 consumers import the package; `XiaozeRunStepSnapshot` renamed to `XiaozeRunStep`.
- Drift found and resolved by the merge: the contract keeps the server's `promptVersion?` (the frontend mirror had dropped it) and the server's citation `type` enum (the frontend had widened to `string?`).
- Out of scope, unchanged: `xiaozeToolLabels.ts` stays as the frontend fallback label table (labels are not wire payloads; see the tool-metadata plan), and `splitAssistantContent` / reasoning heuristics remain side-local behavior.

## Verification

- `npx tsc -b --force` green (both sides compile against the one contract); `vite build` green; `npm run docs:check` green.
- `server/modules/agent`: 179 tests green; `src/features/agent`: 109 tests green.
- Wire behavior unchanged: event names and payload field sets are byte-identical to what the server already emitted.

## Documentation Impact Matrix

| Area | Action | Paths |
| --- | --- | --- |
| Domain / ADR | Add | `docs/adr/0031-xiaoze-wire-contract-is-a-shared-package.md`; `CONTEXT.md` + `docs/adr/README.md` indexes |
| Planning | Update | This plan + zh; `docs/PLANS.md` + zh |
| Others | No change | Wire payloads unchanged; no product behavior change |

## Documentation Update Gate

- [x] ADR-0031 recorded and indexed (`CONTEXT.md`, `docs/adr/README.md`)
- [x] `docs/PLANS.md` EN + zh list this plan
- [x] `npm run docs:check` green
