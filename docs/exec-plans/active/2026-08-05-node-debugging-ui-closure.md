# Node debugging UI closure (C2 / TD-015)

> Status: **Implementation complete on branch** — included in umbrella PR; **TD-015** closed
> Date: 2026-08-05
> Parent: [`2026-08-05-path-reachable-mock-gap-program.md`](./2026-08-05-path-reachable-mock-gap-program.md)
> Closes: **TD-015**
> Chinese: [`docs/zh-CN/exec-plans/active/2026-08-05-node-debugging-ui-closure.md`](../../zh-CN/exec-plans/active/2026-08-05-node-debugging-ui-closure.md)
> Related: [`2026-07-01-wiseeff-node-only-debugging-platform.md`](./2026-07-01-wiseeff-node-only-debugging-platform.md) (do not restore `/debugging`)

## Goal

Close the API-mode `/node-debugging` product loop that the backend already supports:

1. Hydrate write **snapshots** into a visible **rollback** card and confirm dialog.
2. Load durable **session events** after session start (and after rollback).
3. Require **human confirmation** for high-risk writes (stop silent `confirmationToken` injection).

## Non-goals

- Restoring `/debugging`, SessionSummaryCard-only parameter push UX, or `rollbackLastSnapshot` mock undo as a product API.
- Changing gateway/simulator/HDC/ADB/bridge execution semantics beyond confirmation token plumbing.
- Admin catalog CRUD redesign.
- Agent write tools for debug nodes (separate debt).

## Locked decisions

1. Reuse [`RollbackConfirmDialog`](../../../src/components/RollbackConfirmDialog.tsx) patterns from [`DebuggingPage.tsx`](../../../src/DebuggingPage.tsx); mount them on [`NodeDebuggingPage.tsx`](../../../src/NodeDebuggingPage.tsx).
2. Snapshot SSOT after API writes: runtime already has `dispatchSnapshot` — surface `lastDebugSnapshot` (or equivalent) on the node page.
3. On session establish (API mode), call `listSessionEvents(sessionId)` and populate the node operation history panel (replace pure memory-only init).
4. Remove automatic `confirmationToken: "confirm-high-risk-write"` from [`debuggingRuntime.ts`](../../../src/application/debugging/debuggingRuntime.ts); NodeDebuggingPage must collect explicit confirm before write with that token (or `approvalId` when Agent path exists later).
5. `rollbackLastSnapshot()` mock-only path may remain for non-API demos but must not be the API rollback entry — API uses `rollbackSnapshot({ snapshotId, confirmationToken })`.

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation agent | Commit on `feat/node-debugging-ui-closure`; no PR open/merge |
| Parent agent | Review, PR, merge, sync `main`; mark TD-015 Completed |

Branch: `feat/node-debugging-ui-closure` from latest `main`.

## Current vs target

| Concern | Current | Target |
| --- | --- | --- |
| Snapshot after write | Runtime may dispatch; node page has no rollback UI | Rollback card + confirm dialog on `/node-debugging` |
| Session history | In-memory `events[]` only | Seed from `GET …/sessions/:id/events` |
| High-risk write | Silent token inject | Modal confirm → then write with token |
| TD-015 | Open | Completed with acceptance evidence |

## File map

| Area | Paths |
| --- | --- |
| Page | `src/NodeDebuggingPage.tsx`, tests |
| Runtime | `src/application/debugging/debuggingRuntime.ts`, tests |
| Dialog reuse | `src/components/RollbackConfirmDialog.tsx` |
| Reference UX | `src/DebuggingPage.tsx` (read-only reference; keep offline) |
| Gateway | `src/infrastructure/http/debuggingClient.ts` (already has list/rollback) |
| Docs / debt | `docs/FRONTEND.md`, tech-debt TD-015, acceptance maps |

## Tasks

### Batch 1 — Snapshot hydrate + rollback UI

- [ ] Ensure write / batch write paths always `dispatchSnapshot` when API returns a snapshot (already present — verify coverage).
- [ ] Add rollback card state on NodeDebuggingPage bound to runtime snapshot summary.
- [ ] Wire `RollbackConfirmDialog` → `debuggingActions.rollbackSnapshot` with `confirm-rollback` (or existing rollback token contract).
- [ ] After rollback, refresh session events via `listSessionEvents`.
- [ ] Unit/component tests for dialog open, confirm, cancel, error.

### Batch 2 — Session event hydration

- [ ] After successful `detectAndStartSession` in API mode, load `listSessionEvents` and replace or merge into the history panel source of truth.
- [ ] Keep optimistic local appends for in-session ops; reconcile with server list after write/rollback.
- [ ] Handle empty session / permission errors without blanking the page.

### Batch 3 — High-risk confirmation

- [ ] Remove silent High-risk token injection from `debuggingRuntime.writeNode` / batch paths.
- [ ] Add confirm UI on NodeDebuggingPage when target node risk is High (and no `approvalId`).
- [ ] On confirm, call write with `confirmationToken: "confirm-high-risk-write"`.
- [ ] Negative tests: write without token rejected by service remains covered; UI never bypasses confirm.
- [ ] Update `debuggingRuntime.test.ts` expectations that currently assume auto-inject.

### Batch 4 — Acceptance, debt, docs

- [ ] Add or update browser acceptance / operation IDs (see below).
- [ ] playwright-cli evidence: desktop / tablet / mobile on `/node-debugging` — write (simulator), confirm high-risk if seeded, rollback, history after refresh.
- [ ] Move TD-015 to Completed in EN + ZH tech-debt trackers.
- [ ] Update `docs/FRONTEND.md` / zh-CN note that currently says snapshot hydration may lag.
- [ ] Tick parent program C2 checkbox after merge.

## UI interaction coverage

Review and extend:

- `docs/developer/browser-acceptance-coverage-map.md`
- `docs/developer/user-operation-coverage-matrix.md`
- zh-CN mirrors

**Add** (if missing) requirement/operation IDs approximately:

| ID | Behavior |
| --- | --- |
| `DEBUG-NODE-ROLLBACK-001` | After a successful node write that returns a snapshot, user can confirm rollback and values restore |
| `DEBUG-NODE-HISTORY-001` | After session start, history shows server events; survives remount/refresh of panel state |
| `DEBUG-NODE-HIGHRISK-001` | High-risk write blocked until confirm; cancel does not write |

Wire into `e2e/acceptance/` debugging specs (simulator mode). Preserve `npm run acceptance:browser` / evidence generation.

## Verification

```bash
npm test -- src/NodeDebuggingPage.test.tsx src/application/debugging/debuggingRuntime.test.ts src/components/RollbackConfirmDialog.test.tsx --run
npm run test:server -- server/modules/debugging --run
npm run build
# acceptance as configured for debugging simulator
npm run docs:check
```

## Documentation Impact Matrix

| Area | Action | Paths |
| --- | --- | --- |
| Repository maps | No change | — |
| Planning | Update | Parent program; this plan |
| Tech debt | Update | `docs/exec-plans/tech-debt-tracker.md`, zh-CN — **close TD-015** |
| Product specs | Review | `docs/product-specs/prototype-functional-spec.md` debugging section |
| Frontend | Update | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` (TD-015 note) |
| API contract | No change | Rollback/events already exist |
| Security | Update | Note high-risk confirm is UI-enforced + server-validated |
| Reliability / runbooks | Review | `docs/runbooks/hdc-device-lab.md` if it mentions rollback-only-via-API |
| Quality / acceptance | Update | coverage map + operation matrix (+ zh-CN) |
| Design docs | No change | — |
| Generated | No change | — |
| Chinese companions | Update | This plan’s zh-CN summary |

## Documentation Update Gate

- [ ] TD-015 Completed with link to this plan / PR
- [ ] FRONTEND TD-015 lag note removed or rewritten as closed
- [ ] Acceptance IDs registered and covered or explicitly deferred with TD
- [ ] `npm run docs:check`
- [ ] Parent program C2 ready to tick

## Success criteria

1. User can roll back the latest write snapshot from `/node-debugging` in API + simulator.
2. Session history is not solely ephemeral memory.
3. High-risk writes require explicit UI confirmation; runtime does not auto-inject tokens.
4. TD-015 closed.
