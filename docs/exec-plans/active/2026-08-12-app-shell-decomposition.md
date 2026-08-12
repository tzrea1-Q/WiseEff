# App Shell Decomposition (Architecture Review Candidates 1 + 2)

- **Status:** Active — Wave 1 landed (`34305cc9`); Wave 2 landed on `refactor/app-state-module`
- **Branch:** Wave 1 on `refactor/extract-app-state` (from `main` @ `8ab19113`); Wave 2 onward on `refactor/app-state-module` (from Wave 1 tip) after the original branch name was contested by parallel sessions sharing one worktree
- **Owner:** Frontend
- **Scope source:** 2026-08-12 architecture review. Candidate 1 (decompose the `App.tsx` prototype shell) plus Candidate 2 (move domain types out of `mockData.ts`). Backend candidates 3–4 are owned by `2026-08-12-database-layer-deepening.md`; candidate 5 remains tracked by TD-069; candidate 6 is not scheduled.

## Goal

`src/App.tsx` (6089 lines, 174 commits in 4 months — the most-changed code file in the repo) is four unrelated modules in one file: a 1255-line global reducer (63 cases) plus a 163-line `AppAction` union (48 variants), a 795-line `AppShell` composition root (12 inline `useMemo` mock/http adapter ternaries, 14 injection props, two duplicated 26-prop `PageRouter` calls), ~2900 lines of inline page UI (log analysis, parameter review/submissions), and shared helpers. `src/mockData.ts` (1112 lines) additionally owns `PrototypeState` and ~40 domain types consumed by ~92 `import type` sites, so `src/domain/` depends on a mock fixture file — inverted relative to `ARCHITECTURE.md`.

Decompose behavior-preservingly: after this plan, `App.tsx` holds only `App`/`AppShell`/`Sidebar`/`TopBar`/`ApiAuthPage`/`ProfileDialog` orchestration (~1800 lines; long-term soft gate 800–1000 per TD-062 precedent), domain types live in `src/domain/`, pure state logic lives in `src/state/`, and the log-analysis and parameter-review surfaces live under `src/features/`.

**Non-goals:** no behavior change, no route change, no visual change, no port interface change, no backend change. Deleted-code cleanups beyond the moves are out of scope.

## Waves

Each wave is one commit on the plan branch, gated by `npm run build` plus the targeted tests named below. Later waves depend on earlier ones.

### Wave 1 — Move prototype domain types out of `mockData.ts` (Candidate 2)

- Create `src/domain/prototype/types.ts` holding the type block currently at `src/mockData.ts` lines 26–388 (all `export type` declarations from `RiskLevel` through `PrototypeState`) plus the `STAGE_LABELS` / `SEVERITY_LABELS` label constants, carrying over the type-level imports they need (`./powerManagementConfig`, `./appConfig`, `@/domain/users/types`, `@/domain/parameters/types`, `@/domain/notifications/types`, `@/application/ports/ParameterRepository`).
- `src/mockData.ts` keeps fixtures only (`projects`, `roles`, `users`, `derivePowerManagementRuntimeState`, `createPrototypeState`, `initialState`, `auditEvents`, `mockDataFingerprint`) and imports the moved types from the new module. **No re-exports** — every importer retargets.
- Rewrite all importers (~92 files): moved names now import from `@/domain/prototype/types`; fixture names keep importing from `mockData`; mixed imports split.
- Gate: `npm run build`; `npm test -- src/reducer src/reducerReview src/domain`.

### Wave 2 — Extract the reducer and `AppAction` into `src/application/state/` (Candidate 1, step A) — **landed**

- **As executed (ADR-0023):** one module `src/application/state/appState.ts` owns `AppAction`, `reducer`/`appReducer`, and the reducer-only transition helpers (`addAuditEvent`, `getNextReviewStep`, `updateRoundStatusAfterRequest`, `canAdvanceReviewRequest`, `isAdminCapabilityRole`, `wouldHaveActiveAdmin`, `canManageUsers`, `canSubmitParameterChangesForProject`, `isEditableProjectLifecycleStatus`, `buildRuntimeReviewFields`, `updateArchivedLogIdsForLog`, `archivedLogIdsFromHydratedLogs`, `initialsOf`, `pickAvatarTone`, plus UI-shared `activeRoleLabel`). The location is `src/application/state/` (not top-level `src/state/`) so the state machine sits in the existing application layer per `docs/FRONTEND.md` key directories; splitting into per-domain slice files stays a local follow-up inside the module.
- 13 non-test importers of `AppAction` plus the reducer test files retarget from `@/App` to `@/application/state/appState`; `App.tsx` stops exporting them; `main.tsx`'s default `App` import is the only remaining non-test import from `@/App`. `application/logs/logRuntime.ts` and `application/debugging/debuggingRuntime.ts` no longer import from the UI entry (layering inversion removed).
- Dead exported types `ParameterValueDraft` / `ParameterEditorDraft` (zero importers) stay in `App.tsx` untouched; their disposal is Wave 4 cleanup at the earliest.
- Gate (run): app-project `tsc --noEmit` clean; reducer suites (94 tests), page suites (73), `App.test.tsx` (118), `vite build`; mock-mode browser spot-check of `/logs`, `/log-dashboard`, `/parameter-review`, `/parameter-submissions`, `/user-permissions`, `/parameters` (0 console errors; review advance interaction exercised; evidence `work/ui-checks/appstate-*.png`).

### Wave 3 — `createAppRuntime()` composition root (Candidate 1, step B)

- Create `src/app/appRuntime.ts`: an `AppRuntime` record of the ~12 port clients `AppShell` currently builds inline (parameter, topology, dashboard, log analysis, product feedback, DTS reload, parameter initialization, debugging gateway, debugging admin, user governance, notifications, auth), plus `createAppRuntime(mode, overrides?)` reusing the existing `resolve*Runtime` helpers where they exist.
- Collapse `AppProps`' 14 injection props into `runtime?: Partial<AppRuntime>`; update `App.test.tsx` call sites mechanically (inject the same doubles through `runtime`). Thread one `runtime` value through `PageProps` in place of the six repository fields where that reduces prop count without changing page behavior; collapse the duplicated `<PageRouter>` prop lists.
- Gate: `npm run build`; `npm test -- src/App.test src/app/`.

### Wave 4 — Move log-analysis and parameter-review surfaces into `src/features/` (Candidate 1, step C)

- `src/features/log-analysis/`: `LogDashboardPage`, `LogsPage`, the 12 log panel components (`UploadLogDialog`, `RawLogViewer`, `EvidenceChainPanel`, `LogConclusionCard`, …), and pure helpers (`parseLogLine`, `createEmptyLogRecord`, `isSupportedLogFile`) — ~1400 lines out of `App.tsx`.
- `src/features/parameter-review/`: `ParameterReviewPage`, `ParameterSubmissionsPage`, `RejectReviewDialog`, the submission-history view-model block, with the pure diff builders in a `submissionHistoryDiff.ts` — ~1330 lines out of `App.tsx`.
- `src/app/routes.tsx` imports these pages directly; the page-component props disappear from `PageRouterProps`. Existing test files keep passing unchanged (they render `<App />`, which now composes the moved modules).
- Gate: `npm run build`; `npm test -- src/App.test src/logsPage src/features/log-analysis src/features/parameter-review`.

## Verification

- Per-wave gates above; before PR: full `npm test` and `npm run build`.
- Baseline note: the worktree carries unrelated in-flight edits (dts-reload value-shape stream and others). Test/build failures must be attributed against the recorded pre-wave baseline before being fixed here.
- Browser spot-check with `playwright-cli` (per `AGENTS.md`): `/`, `/logs`, `/log-dashboard`, `/parameter-submissions`, `/parameter-review` at 1440x900 / 768x1024 / 390x844 — snapshot, screenshot, console errors.
- `npm run docs:check` before closing the plan.

## UI Interaction Automation Review

Behavior-preserving refactor: no route, form, table, filter, upload, modal, approval, navigation, client, permission, or device behavior changes. No acceptance requirement IDs or operation IDs are added or modified; existing browser acceptance specs under `e2e/acceptance/` continue to cover the affected routes and must stay green where they run. Operation evidence generation is unaffected.

## Git & PR Workflow

- One branch: `refactor/extract-app-state` from latest `main`. One commit per wave (plus docs closeout).
- Implementation commits stage explicit paths only. The worktree carries unrelated in-flight edits from other streams (dts-reload value-shape work, database-layer deepening plan, `src/components/common/ErrorBoundary.tsx`, and small edits to `ARCHITECTURE.md` / `CONTEXT.md` / `docs/PLANS.md` / `docs/FRONTEND.md` / `docs/design-docs/domain-model.md` / `docs/zh-CN/design-docs/domain-model.md` / `scripts/check-doc-governance.*`); those files must never be staged by this plan except via hunk-level staging (`git apply --cached`) limited to this plan's own additions.
- Parent agent (session owner) reviews wave diffs, opens the GitHub PR, merges when green, syncs local `main`.

## Documentation Impact Matrix

| Doc | Path | Impact |
| --- | --- | --- |
| Repository map | `AGENTS.md` | No change (commands and map entries unaffected) |
| Architecture | `ARCHITECTURE.md` | Update — Frontend Boundaries gains `src/state/` and the `src/domain/prototype` note (hunk-staged; file carries unrelated in-flight edits) |
| Architecture (zh) | `docs/zh-CN/architecture.md` | Review — mirror the Frontend Boundaries change |
| Frontend guide | `docs/FRONTEND.md` | Update — structure section: state module, `createAppRuntime`, `features/log-analysis`, `features/parameter-review` (hunk-staged) |
| Frontend guide (zh) | `docs/zh-CN/frontend.md` | Review — mirror the structure change |
| Plans index | `docs/PLANS.md` | Update — add this plan to Current Active Plan (hunk-staged) |
| Plans index (zh) | `docs/zh-CN/PLANS.md` | Review — mirror if the English index row is added |
| Tech debt | `docs/exec-plans/tech-debt-tracker.md` | Update at closeout — record App.tsx residual (target 800–1000 lines) if not reached; close nothing |
| Tech debt (zh) | `docs/zh-CN/exec-plans/tech-debt-tracker.md` | Update alongside the English row |
| ADR | `docs/adr/0023-app-state-transitions-live-in-application-state.md` | Added in Wave 2 (numbered 0023 because two parallel uncommitted ADRs already claim 0022) |
| Domain glossary | `CONTEXT.md` | Update (deferred) — index ADR-0023 once the parallel uncommitted edits to `CONTEXT.md` / `docs/adr/README.md` land, to avoid entangling in-progress work; add "App runtime" / "Prototype state" terms only if they prove load-bearing |
| Product specs | `docs/product-specs/*` | No change (no product behavior change) |
| Design docs | `docs/design-docs/*` | No change (no domain/API/design change) |
| Quality/testing | `docs/QUALITY_SCORE.md`, `docs/design-docs/testing-strategy.md` | No change (test files move import targets only) |
| Reliability/runbooks | `docs/RELIABILITY.md`, `docs/runbooks/*` | No change |
| Security | `docs/SECURITY.md`, `docs/security/*` | No change |
| API docs | `docs/api/*` | No change (no endpoint/DTO change) |
| Generated | `docs/generated/*` | No change |
| References | `docs/references/*` | No change |

## Documentation Update Gate

This plan cannot move to `completed/` until every Update/Review row above is either applied or explicitly recorded as unchanged with evidence, and `npm run docs:check` passes. Deferred work goes to `docs/exec-plans/tech-debt-tracker.md`.

## Expected Outcomes

- `src/App.tsx` ≈ 1800 lines holding only shell orchestration; zero behavior change (full frontend suite green, acceptance unaffected).
- `src/domain/prototype/types.ts` owns the prototype semantic-model types; `src/mockData.ts` is fixtures-only; no `src/domain/` file imports from `mockData`.
- `src/state/appReducer.ts` + `src/state/appActions.ts` testable without jsdom; the five reducer test suites import them directly.
- `src/app/appRuntime.ts` is the single mock/http adapter selection point (`createAppRuntime` unit-tested for per-port mode selection).
- Log-analysis and parameter-review render from `src/features/`, imported directly by `src/app/routes.tsx`.
