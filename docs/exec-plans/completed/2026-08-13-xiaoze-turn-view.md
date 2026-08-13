# Xiaoze turn view: one pure adjudication point for rendering a turn

> Status: **Completed 2026-08-13** (single-PR change; plan recorded at completion)
> Date: 2026-08-13
> Branch: `refactor/xiaoze-turn-view`
> Chinese: [`docs/zh-CN/exec-plans/completed/2026-08-13-xiaoze-turn-view.md`](../../zh-CN/exec-plans/completed/2026-08-13-xiaoze-turn-view.md)
> Source: 2026-08-12 architecture review, candidate 3 (Strong)

## Goal

One Xiaoze turn renders from seven sources (streamed assistant message, authoritative `xiaoze_turn_reply`, live `xiaoze_turn_state` snapshots, live run steps, persisted thread metadata, the reasoning message, and run flags). The precedence rules and five display gates lived untested inside the `XiaozeTurnBlock` component body; every helper it called was tested, but the composition — where the bugs live — was not. This change moves the whole adjudication into one pure function, `resolveXiaozeTurnView(input) → XiaozeTurnView` (`src/features/agent/xiaozeTurnView.ts`), and reduces `XiaozeTurnBlock` to hooks-in, ViewModel-out rendering.

## Decisions

- `resolveXiaozeTurnView` owns: step precedence (live → reply → state → metadata), answer precedence (done-state text → reply/message adjudication with defer gate), reasoning precedence (message → reply → state), streaming detection, and all show/hide gates (reasoning panel, thinking fallback, phase strip, answer).
- `shouldDeferTurnAnswer` / `resolveTurnAnswerText` moved from `xiaozeTurnGrouping.ts` into the new module (their only consumer was the turn block); `shouldShowTurnThinking` was inlined and deleted. Grouping keeps message grouping and assistant picking only.
- Behavior line: rendering output is unchanged; assertions were translated line-by-line from the component body.

## Verification

- `xiaozeTurnView.test.ts`: 15 cases covering the defer gate, answer adjudication (reply-vs-streamed, internal-only reply fallback, dedupe), step precedence chain, reasoning precedence chain, reasoning-streaming detection on active thinking turns, phase-strip/answer gates, done-state override, and citation precedence. Full `src/features/agent` suite green (34 files / 101 tests); `tsc -b`, `npm run build` green.
- Browser check (isolated deterministic runtime, fresh Postgres): Xiaoze popup on `/`, read turn renders user bubble → step strip (查询项目概览 · 完成) → answer with citation badge; viewports 1440x900 / 768x1024 / 390x844; console 0 errors; screenshots `work/ui-checks/turn-view-{desktop,tablet,mobile}.png` (not committed).

## Documentation Impact Matrix

| Area | Action | Paths |
| --- | --- | --- |
| Planning | Update | This plan + zh; `docs/PLANS.md` + zh |
| Frontend docs | No change | `docs/FRONTEND.md` does not enumerate turn-block internals |
| Others | No change | Wire protocol, product behavior, quality gates untouched |

## Documentation Update Gate

- [x] `docs/PLANS.md` EN + zh list this plan
- [x] `npm run docs:check` green
