# Mock honesty and dead residual cleanup (C4)

> Status: **Active** — planning only until implementation starts
> Date: 2026-08-05
> Parent: [`2026-08-05-path-reachable-mock-gap-program.md`](./2026-08-05-path-reachable-mock-gap-program.md)
> Chinese: [`docs/zh-CN/exec-plans/active/2026-08-05-mock-honesty-and-dead-residual-cleanup.md`](../../zh-CN/exec-plans/active/2026-08-05-mock-honesty-and-dead-residual-cleanup.md)

## Goal

Make mock-mode parameter import **honest** (real apply or clear failure), and remove **dead residuals** that advertise APIs or state that no product path uses: unhooked `AI_FEEDBACK`, and admin `reload-bindings` contracts for a dropped table.

## Non-goals

- Changing API-mode import apply (already durable via `parameter-import-batches`).
- Restoring parameter reload or `/debugging`.
- Rewiring mock App to use `createMockParameterRepository` for the entire parameter surface (out of scope; only import apply path).
- Vite HDC bridge changes.

## Locked decisions

1. Mock import apply goes through the **mock parameter repository apply path** (or equivalent shared apply helper) so state actually changes; **forbidden**: `IMPORT_PARAMETERS` toast-only success (`src/App.tsx` today).
2. Delete `AI_FEEDBACK` action, `aiFeedback` state, and tests — no UI dispatch remains.
3. Remove `reload-bindings` from [`routeManifest.ts`](../../../server/modules/contracts/routeManifest.ts) and [`debuggingAdminClient.ts`](../../../src/infrastructure/http/debuggingAdminClient.ts) (+ orphan UI/tests if any). Keep `410` on `/api/v1/debugging/parameters/reload` and `/reload-targets` as honest GONE.

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation agent | Commit on `feat/mock-honesty-dead-residual-cleanup`; no PR open/merge |
| Parent agent | Review, PR, merge, sync `main` |

Branch: `feat/mock-honesty-dead-residual-cleanup` from latest `main`.

## File map

| Area | Paths |
| --- | --- |
| Fake import | `src/App.tsx` (`IMPORT_PARAMETERS`), `src/application/parameters/parameterRuntime.ts`, `src/infrastructure/mock/mockParameterRepository.ts` |
| AI feedback dead code | `src/App.tsx`, `src/mockData.ts`, `src/reducerReview.test.ts` |
| Reload residual | `server/modules/contracts/routeManifest.ts`, `src/infrastructure/http/debuggingAdminClient.ts`, any `ReloadBinding*` / `DebugAdminSplitCatalog` orphans, related tests |
| Docs | Parent program; `docs/FRONTEND.md` / zh-CN if mock import behavior is documented |

## Tasks

### Batch 1 — Honest mock import

- [ ] Trace every caller of `IMPORT_PARAMETERS` / import wizard apply in mock mode.
- [ ] Replace toast-only reducer branch with apply that mutates definitions/values (reuse logic from `mockParameterRepository` apply; prefer calling repository from runtime rather than duplicating).
- [ ] Preserve permission gate (`admin.access`).
- [ ] Update unit/integration tests that assert the fake notification text; assert parameter counts / values change instead.
- [ ] On apply failure, surface error notification — never claim success.

### Batch 2 — Remove AI_FEEDBACK

- [ ] Remove `AI_FEEDBACK` from `AppAction` union and reducer.
- [ ] Remove `aiFeedback` from `AppState` / `mockData` initial state.
- [ ] Delete or rewrite `reducerReview.test.ts` AI_FEEDBACK cases.
- [ ] Grep for `aiFeedback` / `AI_FEEDBACK` and clear leftovers.

### Batch 3 — Remove reload-bindings contract residue

- [ ] Delete `debugging.admin.*ReloadBindings*` entries from `routeManifest.ts` (and any OpenAPI generation consumers).
- [ ] Remove `listReloadBindings` / create/update methods from `debuggingAdminClient` (+ DTO types if exclusive).
- [ ] Delete or stop shipping orphan components (`DebugAdminSplitCatalog`, `ReloadBindingEditorDialog`) if unused outside tests; update tests.
- [ ] Confirm `routes.ts` still returns 410 for runtime reload endpoints; do not reintroduce handlers for admin reload-bindings.
- [ ] Grep for `reload-bindings` / `reloadBindings` / `parameter_reload_bindings` in src + server contracts.

### Batch 4 — Verify + docs

- [ ] Run targeted tests + `npm run build`.
- [ ] Complete Documentation Update Gate.
- [ ] Note completion on parent program checklist.

## Verification

```bash
npm test -- src/App.test.tsx src/reducerReview.test.ts src/infrastructure/mock/mockParameterRepository.test.ts src/infrastructure/http/debuggingAdminClient.test.ts --run
# plus any new import-apply mock tests
npm run build
npm run docs:check
```

Manual (mock mode): open parameter admin import wizard, apply a small batch, confirm table/state reflects new or updated rows — not only a toast.

## UI interaction coverage

Import wizard already has acceptance coverage under the batch-import plan. This plan must **review** existing operation IDs for import apply and either:

- confirm mock-mode honesty does not change API-mode acceptance, or
- add a note in the coverage map that mock apply is unit-tested only (mock is not pilot acceptance runtime).

No new browser acceptance ID required if API-mode behavior is unchanged and mock is unit-covered.

## Documentation Impact Matrix

| Area | Action | Paths |
| --- | --- | --- |
| Repository maps | No change | `AGENTS.md`, `ARCHITECTURE.md` |
| Planning | Update | Parent program checklist; `docs/PLANS.md` / zh-CN already list this plan |
| Product specs | Review | `docs/product-specs/prototype-functional-spec.md` — update only if it claims mock import side effects |
| Frontend | Update | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` — mock import honesty / dead AI feedback removal if mentioned |
| API contract | Update | Remove reload-bindings from contract docs / route manifest consumers; keep 410 reload notes |
| Domain / design | No change | — |
| Security / audit | No change | — |
| Reliability / runbooks | No change | — |
| Quality / acceptance | Review | Import operation IDs — no change expected for API mode |
| Tech debt | Review | TD-033 legacy debug tables remain; do not reopen reload product |
| Generated | Review | Regenerated OpenAPI/route artifacts if CI derives from manifest |
| Chinese companions | Update | This plan’s zh-CN summary |

## Documentation Update Gate

- [ ] Matrix rows closed with evidence or explicit “unchanged”
- [ ] Manifest no longer lists admin reload-bindings
- [ ] Parent program C4 checkbox ready to tick after merge
- [ ] `npm run docs:check`

## Success criteria

1. Mock import apply changes in-memory parameter state (or fails visibly).
2. No `AI_FEEDBACK` / `aiFeedback` in the codebase.
3. No client or manifest surface for admin reload-bindings; runtime reload remains 410.
4. Build and targeted tests pass.
