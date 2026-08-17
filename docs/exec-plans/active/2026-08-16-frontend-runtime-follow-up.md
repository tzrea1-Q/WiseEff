# Frontend Runtime Follow-up (TD-110 / TD-109 / C7)

> Chinese: [Chinese](../../zh-CN/exec-plans/active/2026-08-16-frontend-runtime-follow-up.md)

- **Status:** Active — Closeout. First batch A/B/C (#474–#476), wave 2 (#478 domain guards, #479 parameter-review CSS, #481 DTS `/include/` envelope), and #480 API catalog honesty are on `main`. Remaining closeout tracks D–H below.
- **Owner:** Frontend
- **Verified against:** GitHub `main` on 2026-08-17 (`d99823df`, merge of #480).
- **Predecessor:** `docs/exec-plans/completed/2026-08-12-app-shell-decomposition.md` (PRs #324, #342, #375, page-owned loading). C2/C6 leftovers were recorded as TD-110 / TD-109.

## Goal

Close the remaining architecture-review follow-ups that are still open on `main`, in slices that do not share files, so three agents can land three PRs without rebasing each other.

After this program:

- API mode no longer boots with demo people, demo log-admin users, or demo audit events in `PrototypeState`. **Done** (#474).
- Mock adapters throw `WiseEffApiError`, so `error.code` branches in application runtimes work in mock mode. **Done** (#475). Wave 1 leftover `Object.assign(new Error)` in spec reattribute/rename is a closeout track.
- Log-analysis feature CSS lives next to `src/features/log-analysis/`. **Done** (#476). Parameter-review CSS lives next to `src/features/parameter-review/`. **Done** (#479).
- Identity-mapping, candidate-activation, and spec-lifecycle guards live in `src/domain/`. **Done** (#478).
- DTS `/include/` mock parse throws `WiseEffApiError`. **Done** (#481).
- `NodeDebuggingPage` owns a `dtsReloadRunSession`-shaped session, then C5 `BridgeGateway` can share target/protocol/session without rewriting either page.

## Non-goals (this program)

- Collapsing `AppProps` into `runtime?: Partial<AppRuntime>` (rejected in PR #375).
- Importing `server/` from `src/`, or introducing a `packages/` share for the domain guards.
- Token burn (TD-113), table convergence (TD-112), Button `className="full"` (TD-114) — aesthetics-uplift residue, not this architecture review.
- Spreading `idle/loading/ready/empty/error` onto pages that are not otherwise being touched. Promote section-state when a page is already in the diff.
- Moving the Parameter Admin M1 CSS block or `.dts-parameter-workbench*` in the same PR as configuration-workbench CSS.

## Evidence from the 2026-08-16 re-audit

Pre-merge snapshot (then-`main` @ `fcef9758`). After #474/#475/#476 the leftover-slice and envelope rows are historical; remaining truth is in **Track sequencing after this batch**.

| Item | Still true on `main` (pre-merge) | Correction vs tracker wording |
| --- | --- | --- |
| TD-110 | `createApiInitialState()` emptied parameters/logs/devices/notifications but still spread mock `auditEvents`, `developers` (12 demo names, **zero production readers**), and `logAdminUsers` (Jane Smith / Mike Kruger / Ana Lin; **no page reads**; `LOG_ADMIN_*_USER` only in reducer tests). `AuditCenterPage` already isolates mock events via `isApiMode`. | Prefer **retirement** for `developers` / `logAdminUsers`, not a new `HYDRATE_*` channel. **Done in #474.** |
| TD-109 | `src/infrastructure/mock/` had **zero** `WiseEffApiError` imports; adapters still `throw new Error(...)`. Candidate activation and identity-mapping open/closed checks remain duplicated against `server/modules/`. | "Five error strings match character-for-character" is **stale**. Messages have drifted (mock appends `taskId`; candidate stale text is the short form). Envelope alignment **done in #475**; duplication of **rules** remains for wave 2. |
| C7 | `src/styles.css` ≈ 28,732 lines. Feature CSS existed only for `parameter-home` and Xiaoze markdown. Log Analysis v2 block started at `styles.css:6935`. | First cut is log-analysis only. **Done in #476.** Parameter-review CSS is wave 2. |
| C5 | No `BridgeGateway` type. `LocalDeviceBridgePanel` is shared UI only. | Keep deferred. |

## Parallel file map (do not cross)

| Track | Branch | Owns these paths | Must not touch |
| --- | --- | --- | --- |
| **A — TD-110 leftover slices** | `fix/td110-api-legacy-slices` | `src/mockData.ts`, `src/domain/prototype/types.ts`, `src/application/state/appState.ts`, `src/reducer.logAdmin.test.ts`, new `src/mockData.apiInitialState.test.ts` (or equivalent next to existing mockData tests), any test that constructs `developers` / `logAdminUsers` | `src/infrastructure/mock/**`, `src/styles.css`, `src/features/**`, `docs/PLANS.md`, tracker |
| **B — TD-109 wave 1 envelopes** | `fix/td109-mock-error-envelopes` | `src/infrastructure/mock/**` (plus a new helper e.g. `src/infrastructure/mock/mockApiError.ts`), tests under that folder | `src/mockData.ts`, `src/application/state/appState.ts`, `src/styles.css`, `docs/PLANS.md`, tracker |
| **C — C7 wave 1 log CSS** | `refactor/log-analysis-css-colocation` | `src/styles.css` (deletions only of moved rules), `src/features/log-analysis/**` (new css + imports), `src/App.test.tsx` (the `.logs-v2` stylesheet assertion around line 3613), any log-analysis `readStylesheet("src/styles.css")` tests that would go red | `src/mockData.ts`, `src/infrastructure/mock/**`, `src/application/state/**`, tracker |

Parent session owns `docs/PLANS.md`, both trackers, FRONTEND bilingual pages, and this plan. Implementation agents do not edit those files.

## Landed 2026-08-16

| Track | PR | Merge commit on `main` |
| --- | --- | --- |
| A — TD-110 leftover slices | [#474](https://github.com/tzrea1-Q/WiseEff/pull/474) | `171ec4f8` |
| B — TD-109 wave 1 envelopes | [#475](https://github.com/tzrea1-Q/WiseEff/pull/475) | `1df5bbc5` |
| C — C7 wave 1 log CSS | [#476](https://github.com/tzrea1-Q/WiseEff/pull/476) | `c3b6a7a1` |

Track specs below are the executed checklist, kept for audit. Do not re-implement them.

## Track A — TD-110 leftover slices

**Landed in #474.**

**Intent:** API mode must not hold demo records in slices that have no hydrate channel.

### Do

1. In `createApiInitialState()`, set `auditEvents: []`, `developers: []`, `logAdminUsers: []` (the last two become unnecessary once retired — see 2–3).
2. **Retire `developers`:** remove the field from `PrototypeState`, the `Developer` / `DeveloperRole` types if unused, and the fixture array in `createPrototypeState()`. Confirmed 2026-08-16: the only production write is `mockData.ts`.
3. **Retire `logAdminUsers` and the three user-directory actions** `LOG_ADMIN_ADD_USER`, `LOG_ADMIN_UPDATE_USER_ROLE`, `LOG_ADMIN_REMOVE_USER` plus their reducer cases and `src/reducer.logAdmin.test.ts` blocks. `LogAdminPage` does not read `state.logAdminUsers` and never dispatches those actions. Keep `LOG_ADMIN_ARCHIVE_LOG` / `UNARCHIVE` / `REANALYZE` / `SYNC_LOGS` / `EXPORT_REPORT`. If `pickAvatarTone` / `initialsOf` exist only for the retired actions, delete them too. Keep `LogAdminUser` in `src/domain/logs/types.ts` if other log types still reference it; delete the duplicate in `src/domain/prototype/types.ts` when the field is gone.
4. Add a focused test: `createApiInitialState()` has empty `auditEvents` (and no `developers` / `logAdminUsers` fields). Mock `createPrototypeState()` / `initialState` still seeds `auditEvents` for mock-mode Audit Center.
5. Leave `persistedConfigSnapshot` as it is (arrays already emptied). Leave `users` / `roles` / config schema as structural (hydrated by `HYDRATE_AUTH_CONTEXT` / `HYDRATE_USERS`).

### Verification

```bash
npx vitest run src/mockData.apiInitialState.test.ts src/reducer.logAdmin.test.ts src/App.test.tsx --reporter=dot
npx tsc --noEmit -p tsconfig.json
npm run build
```

Adjust the new test path to match where mockData tests already live. `npm run build` is required because `PrototypeState` is a shared type.

### Done when

- API boot state cannot surface Jane Smith, 赵磊, or `buildAuditEvents()` rows.
- `git grep developers src/` (non-test) is empty except comments / this plan.
- `LOG_ADMIN_ADD_USER` does not exist.

## Track B — TD-109 wave 1: mock error envelopes

**Landed in #475.**

**Intent:** one error type across mock and HTTP adapters. Do not extract state machines in this track.

### Do

1. Add `src/infrastructure/mock/mockApiError.ts`:

   ```ts
   export function mockApiError(
     code: string,
     message: string,
     details: Record<string, unknown> = {}
   ): WiseEffApiError {
     return new WiseEffApiError(code, message, details, "mock");
   }
   ```

   Import `WiseEffApiError` from `@/infrastructure/http/apiClient`.

2. Replace `throw new Error(...)` in non-test files under `src/infrastructure/mock/` with `throw mockApiError(code, message, details?)`. Keep the **existing message text** (do not "fix" drift against the server in this wave). Map codes:

   | Heuristic (message / situation) | `code` |
   | --- | --- |
   | not found, unknown id | `NOT_FOUND` |
   | stale, already open/closed, not open, cannot activate/abandon, conflict, blocked | `CONFLICT` |
   | required, invalid, at least one, empty-library, selected ids | `VALIDATION_FAILED` |
   | only available in API runtime, unauthorized | `FORBIDDEN` |
   | everything else | `INTERNAL_ERROR` |

   Put identifying ids in `details` (`taskId`, `candidateId`, …) when the message already interpolates them.

3. Add/extend tests on the hottest adapters so a representative failure is `instanceof WiseEffApiError` with the expected `code`:
   - `mockParameterFileRepository` stale-base activate → `CONFLICT`
   - `mockParameterTopologyRepository` resolve-when-not-open → `CONFLICT`
   - one `NOT_FOUND` path (any adapter)

4. Existing `toThrow("…")` assertions should keep passing (`WiseEffApiError extends Error`). If a test asserts `error.name === "Error"` or `constructor === Error`, update it.

### Verification

```bash
npx vitest run src/infrastructure/mock --reporter=dot
npx tsc --noEmit -p tsconfig.json
```

### Done when

- `rg "throw new Error" src/infrastructure/mock --glob '!*.test.ts'` is empty (or only comments).
- `rg WiseEffApiError src/infrastructure/mock` is non-empty in production mock files.
- Mock mode can hit `error.code === "CONFLICT"` the same way API mode does.

### Wave 2 (designed, not in this batch)

**Decision, locked here:** do **not** move server modules into `src/`, and do **not** introduce a `packages/` share in wave 2. Server stays the HTTP source of truth. Frontend mocks currently copy rules; wave 2 extracts the **frontend-side** guards that mocks need into `src/domain/` (same seam as `submitParameterRound` / `canPerform`), then thins the mocks to "domain function + in-memory store". A later program may lift a stable subset into `packages/` if the server wants the same functions. First machines to extract, in this order:

1. Identity-mapping open/closed/reopen (`mockParameterTopologyRepository` vs `server/modules/parameter-topology/service.ts`).
2. Candidate activation stale-base / status gate (`mockParameterFileRepository` vs `server/modules/parameter-files/candidateService.ts`).
3. Spec lifecycle transitions in `mockParameterTopologyRepository` / module registry.

Wave 2 also aligns the drifted English messages with the server **or** stops asserting on English message text in mocks (prefer `code` + `details`). Starts only after wave 1 merges.

## Track C — C7 wave 1: log-analysis CSS colocation

**Landed in #476.**

**Intent:** pixel-identical move. Precedent: `src/features/parameter-home/parameter-home.css` imported from `ParameterHomePage.tsx`.

### Do

1. Create `src/features/log-analysis/log-analysis.css`.
2. Move feature-scoped rules out of `src/styles.css`. Anchor: comment `/* ========== Log Analysis v2 ========== */` at line 6935. Include `.logs-v2*` , `.log-dashboard-*`, `.logs-conclusion*`, `.analysis-provenance*`, `.topic-*` used only by the dashboard, log timeline rules that only the log pages use, and the **media-query fragments that only wrap those selectors** (~8746+).
3. **Leave in `styles.css`:** `:root` tokens, `.button` / `.sr-only` / `.confirm-dialog` / `.icon-button` / shared loading-empty-error trio at ~7988 ("promoted from parameter-home"), log-admin page rules if they sit in a different product surface (`src/LogAdminPage.tsx` is not under `features/log-analysis` yet), any selector used outside `src/features/log-analysis/`.
4. Import the new file from `LogsPage.tsx` and `LogDashboardPage.tsx` (one import is enough if both are in the same graph; importing from both is fine and matches parameter-home).
5. Update `src/App.test.tsx` "includes responsive and reduced-motion styles for the log analysis workbench" so it reads the colocated file (concatenate with `styles.css` if some of those `@media` queries remain global).
6. Do not change visual values. Do not run `ui:check --update-baseline` unless `npm run ui:check` actually fails because a file path assumption broke (it scans all `src/**/*.css`, so a verbatim move should keep counts).

### Verification

```bash
npx vitest run src/App.test.tsx src/LogDashboardPage.test.tsx src/logsPage.test.tsx src/logsPage.upload.test.tsx --reporter=dot
npx tsc --noEmit -p tsconfig.json
npm run ui:check
npm run build
```

Frontend-visible: `/logs` and `/log-dashboard` at 1440×900, 768×1024, 390×844 — snapshot + screenshot, console errors empty. Expect pixel-identical layout. If `playwright-cli` cannot run, stop and report the blocker; do not claim visual verification.

### Done when

- `src/features/log-analysis/log-analysis.css` exists and `LogsPage.tsx` imports it.
- The Log Analysis v2 block is gone from `src/styles.css` (or reduced to a pointer comment).
- App.test log-analysis stylesheet case is green.
- No intentional visual change.

## Landed after the first batch (2026-08-16 → 2026-08-17)

| Track | PR | Merge commit on `main` |
| --- | --- | --- |
| Docs first-batch remainder | [#477](https://github.com/tzrea1-Q/WiseEff/pull/477) | `17294ffa` |
| TD-109 wave 2 domain guards | [#478](https://github.com/tzrea1-Q/WiseEff/pull/478) | `76b573de` |
| C7 wave 2 parameter-review CSS | [#479](https://github.com/tzrea1-Q/WiseEff/pull/479) | `00f18d0a` |
| TD-109 DTS `/include/` envelope leftover | [#481](https://github.com/tzrea1-Q/WiseEff/pull/481) | `4fc6a127` |
| TD-110 API catalog honesty | [#480](https://github.com/tzrea1-Q/WiseEff/pull/480) | `d99823df` |

## Closeout tracks (file-disjoint, from `origin/main` @ `4fc6a127`)

```
landed: A #474 │ B #475 │ C #476 │ guards #478 │ review CSS #479 │ dts-parse #481 │ catalog #480 │ docs #477
next:   D  TD-109 Object.assign leftover     branch fix/td109-topology-mock-api-error
next:   E  C7 configuration-workbench CSS    branch refactor/configuration-workbench-css
next:   F  NodeDebuggingPage session         branch refactor/node-debugging-session
then:   G  C5 BridgeGateway / BridgeTargetSession (starts only after F merges)
then:   H  TD-110 mock seeding into adapters (unblocked by #480)
```

### Track D — TD-109 `Object.assign(new Error)` leftover

`mockParameterTopologyRepository.reattributeParameterSpec` / `renameParameterSpecPropertyKey` still throw `Object.assign(new Error, { code: "CONFLICT", status: 409, details })`. Swap to `mockApiError("CONFLICT", sameMessage, details)`. Drop `status`. Add `instanceof WiseEffApiError` coverage. `rg "new Error" src/infrastructure/mock --glob '!*.test.ts'` must be empty.

### Track E — C7 configuration-workbench CSS

Move the `src/styles.css` block starting `/* === Project configuration workbench (read-only tracer) ===` (~24680) to `src/components/project-configuration-workbench/configuration-workbench.css`. Import from `ProjectConfigurationWorkbench.tsx`. Leave shared `.workbench-page` / `.workbench-sheet` / `.node-debugging-page` / Parameter Admin M1 / `.dts-parameter-workbench*` in `styles.css`. Pixel-identical. Do not edit `App.test.tsx` unless a test goes red.

### Track F — NodeDebugging session (C5 prerequisite)

Extract `src/application/debugging/nodeDebuggingSession.ts` + `useNodeDebuggingSession.ts` on the `dtsReloadRunSession` snapshot/subscribe/command shape. Page stays render + wiring. Existing `NodeDebuggingPage.test.tsx` stays green. Do not touch `src/application/dts-reload/**`, do not invent `BridgeGateway` here.

### Track G — C5 `BridgeGateway` / `BridgeTargetSession`

After F: extract the shared bridge/target/protocol/session cluster used by node-debugging and dts-reload. `dtsReloadRunSession` already owns that cluster for reload; fold the overlapping types behind one port without rewriting reload behavior. Starts only after F merges.

### Track H — TD-110 mock seeding

Move `createPrototypeState` construction into `src/infrastructure/mock/` so production pages/reducer never import the mock catalog. `createApiInitialState` must not go through seeded `createPrototypeState`. Unblocked by #480.

## Git & PR Workflow

This plan **explicitly uses multiple feature branches**, each from latest `main`, because the tracks do not share files. That is an exception to the default "one plan → one branch" rule in `docs/PLANS.md`.

| Role | Allowed |
| --- | --- |
| Implementation agent | Work only in the assigned git worktree. `git fetch`, implement, test, **commit on the feature branch**. |
| Implementation agent | Must not push to `main`, open GitHub PRs, merge PRs, fast-forward local `main`, or edit `docs/PLANS.md` / tech-debt trackers / this plan / FRONTEND.md. |
| Parent agent | Review, open GitHub PRs, merge when green, sync `main`, then update tracker rows and FRONTEND bilingual pages. |

Closeout worktrees (created from `origin/main` @ `4fc6a127`):

- Track D: `/Users/tzrea1/Develop/WiseEff/.worktrees/td109-w3`
- Track E: `/Users/tzrea1/Develop/WiseEff/.worktrees/c7-pcw-css`
- Track F: `/Users/tzrea1/Develop/WiseEff/.worktrees/node-debug-session`
- Docs: `/Users/tzrea1/Develop/WiseEff/.worktrees/arch-closeout`

The shared checkout `/Users/tzrea1/Develop/WiseEff` is dirty and on an unrelated branch — never implement there.

## UI Interaction Automation Review

- Track A: no route/form/table/modal/permission/device behavior change. Audit Center already ignores mock events in API mode; emptying `auditEvents` in API boot is a data-honesty fix, not a new interaction. Existing `/audit` coverage stays. No new requirement/operation IDs.
- Track B: mock-mode error presentation may start using `error.code` branches (Chinese CONFLICT copy instead of raw English `Error.message`). That is a mock-runtime honesty fix. Browser acceptance runs against API mode and is unaffected. No new IDs.
- Track C: no interaction behavior change if the CSS move is verbatim. Visual quality specs for `/logs` and `/log-dashboard` remain the evidence. If a selector is dropped accidentally, those specs (and App.test stylesheet assertions) fail. No new IDs.
- Track D: mock-only envelope. Browser acceptance is API mode. No new IDs.
- Track E: verbatim CSS move of `/parameter-admin/projects/:projectId/configuration`. Existing visual/responsive specs for that route remain the evidence. No new IDs.
- Track F: no intended interaction change. Existing `NodeDebuggingPage.test.tsx` plus browser acceptance `/node-debugging` remain the evidence. No new IDs. If a command is dropped, those tests fail.
- Track G: sharing session types must not change detect/read/write/rollback or dts-reload deploy confirmation. Existing node-debugging and dts-reload acceptance remain. No new IDs unless a user-visible confirm token path changes (then stop and add coverage).
- Track H: mock seeding location only. API mode already hydrates from the server. No new IDs.

## Documentation Impact Matrix

| Doc | Path | Impact |
| --- | --- | --- |
| Repository map | `AGENTS.md` | No change |
| Architecture | `ARCHITECTURE.md` | Reviewed 2026-08-16 — Frontend Boundaries still accurate (`Production behavior must not depend on mock runtime data`); no edit |
| Architecture (zh) | `docs/zh-CN/architecture.md` | Reviewed — same; no edit |
| Frontend guide | `docs/FRONTEND.md` | Updated this docs PR — API boot has no demo audit/people slices; catalog honesty #480; mock adapters throw `WiseEffApiError`; log-analysis and parameter-review CSS colocation |
| Frontend guide (zh) | `docs/zh-CN/frontend.md` | Updated — mirror |
| Plans index | `docs/PLANS.md` | Updated — this plan in Current Active Plan with landed PR numbers; remainder listed |
| Plans index (zh) | `docs/zh-CN/PLANS.md` | Updated — mirror the active-plan bullet |
| Tech debt | `docs/exec-plans/tech-debt-tracker.md` | Updated — TD-110/TD-109 rows shrunk to true remainder; TD-109 "character-for-character" wording already corrected |
| Tech debt (zh) | `docs/zh-CN/exec-plans/tech-debt-tracker.md` | Updated alongside |
| ADR | `docs/adr/` | No change this batch (wave 2 may add one if a domain module interface needs a decision record) |
| Domain glossary | `CONTEXT.md` | No change |
| Product specs | `docs/product-specs/*` | No change |
| Design docs | `docs/design-docs/*` | No change |
| Quality/testing | `docs/QUALITY_SCORE.md`, `docs/design-docs/testing-strategy.md` | No change |
| Reliability/runbooks | `docs/RELIABILITY.md`, `docs/runbooks/*` | No change |
| Security | `docs/SECURITY.md`, `docs/security/*` | No change |
| API docs | `docs/api/*` | No change |
| Generated | `docs/generated/*` | No change |
| References | `docs/references/*` | No change |

## Documentation Update Gate

This plan cannot move to `completed/` until:

- [x] Track A merged (#474); TD-110 row rewritten to the true remainder
- [x] Track B merged (#475); TD-109 row rewritten to "envelopes done; wave 2 machines remain"
- [x] Track C merged (#476); FRONTEND notes log-analysis CSS colocation
- [x] TD-109 wave 2 merged (#478); C7 wave 2 merged (#479); DTS `/include/` envelope merged (#481)
- [x] #480 merged (`d99823df`); ParametersPage / reducer no longer fall back to `mockData.projects`
- [ ] Track D (`Object.assign` leftover) merged; `rg "new Error" src/infrastructure/mock --glob '!*.test.ts'` empty
- [ ] Track E configuration-workbench CSS merged; FRONTEND notes the colocation
- [ ] Track F NodeDebugging session merged
- [ ] Track G C5 `BridgeGateway` merged **or** explicitly re-homed on the tracker with a reason
- [ ] Track H mock seeding merged **or** tracker row states why `createPrototypeState` stays in `mockData.ts`
- [ ] Bilingual FRONTEND + tracker + PLANS match the landed PRs
- [ ] `npm run docs:check` passes

Keep this plan **active** until the closeout tracks land or are re-homed on the tracker.

## Expected outcomes

- First-batch PRs #474–#476 plus wave-2 #478/#479/#481 and catalog honesty #480 on `main`.
- API mode cannot be confused with demo directory/audit fixtures or the mock project catalog.
- Mock failures participate in `WiseEffApiError` code branches, including spec reattribute/rename and DTS `/include/`.
- Feature CSS for log-analysis, parameter-review, and configuration-workbench is colocated; shared workbench chrome stays global.
- `/node-debugging` is sessionized; C5 either shares bridge/target/session with dts-reload or is a dated tracker row.
