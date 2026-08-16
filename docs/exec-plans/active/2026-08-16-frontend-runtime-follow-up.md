# Frontend Runtime Follow-up (TD-110 / TD-109 / C7)

> Chinese: [Chinese](../../zh-CN/exec-plans/active/2026-08-16-frontend-runtime-follow-up.md)

- **Status:** Active — three parallel implementation tracks from `origin/main` @ `fcef9758`
- **Owner:** Frontend
- **Verified against:** GitHub `main` on 2026-08-16 (`fcef9758`, merge of #473). Open PRs at verification time: none.
- **Predecessor:** `docs/exec-plans/completed/2026-08-12-app-shell-decomposition.md` (PRs #324, #342, #375, page-owned loading). C2/C6 leftovers were recorded as TD-110 / TD-109.

## Goal

Close the remaining architecture-review follow-ups that are still open on `main`, in slices that do not share files, so three agents can land three PRs without rebasing each other.

After this program:

- API mode no longer boots with demo people, demo log-admin users, or demo audit events in `PrototypeState`.
- Mock adapters throw `WiseEffApiError`, so `error.code` branches in application runtimes work in mock mode.
- Log-analysis feature CSS lives next to `src/features/log-analysis/`, following the `parameter-home.css` precedent.

## Non-goals (this program)

- **C5 `BridgeGateway` / shared `BridgeTargetSession`:** still deferred. `dtsReloadRunSession` already owns DTS-reload bridge/target/protocol/device state. Extracting a shared session now would rewrite that module. Revisit only after `NodeDebuggingPage` (~1539 lines) is sessionized.
- **TD-109 wave 2 — shared state machines:** designed below, not implemented in the first parallel batch. Envelope alignment (wave 1) is the mergeable slice.
- **C7 wave 2 — parameter-review CSS:** same `src/styles.css` as wave 1. Starts only after wave 1 merges.
- **TD-110 remainder:** `persistedConfigSnapshot` schema leftovers, mock seeding into adapters, and extending `idle/loading/ready/empty/error` beyond the pages that already have it. Track A does not absorb these.
- Collapsing `AppProps` into `runtime?: Partial<AppRuntime>` (rejected in PR #375).
- Token burn (TD-113), table convergence (TD-112), Button `className="full"` (TD-114).

## Evidence from the 2026-08-16 re-audit

| Item | Still true on `main` | Correction vs tracker wording |
| --- | --- | --- |
| TD-110 | `createApiInitialState()` empties parameters/logs/devices/notifications but still spreads mock `auditEvents`, `developers` (12 demo names, **zero production readers**), and `logAdminUsers` (Jane Smith / Mike Kruger / Ana Lin; **no page reads**; `LOG_ADMIN_*_USER` only in reducer tests). `AuditCenterPage` already isolates mock events via `isApiMode`. | Prefer **retirement** for `developers` / `logAdminUsers`, not a new `HYDRATE_*` channel. |
| TD-109 | `src/infrastructure/mock/` has **zero** `WiseEffApiError` imports; adapters still `throw new Error(...)`. Candidate activation and identity-mapping open/closed checks remain duplicated against `server/modules/`. | "Five error strings match character-for-character" is **stale**. Messages have drifted (mock appends `taskId`; candidate stale text is the short form). Duplication of **rules** remains; string coincidence does not. |
| C7 | `src/styles.css` ≈ 28,732 lines. Feature CSS exists only for `parameter-home` and Xiaoze markdown. `src/features/log-analysis/` and `src/features/parameter-review/` have no colocated CSS. Log Analysis v2 block starts at `styles.css:6935`. | First cut is log-analysis only. |
| C5 | No `BridgeGateway` type. `LocalDeviceBridgePanel` is shared UI only. | Keep deferred. |

## Parallel file map (do not cross)

| Track | Branch | Owns these paths | Must not touch |
| --- | --- | --- | --- |
| **A — TD-110 leftover slices** | `fix/td110-api-legacy-slices` | `src/mockData.ts`, `src/domain/prototype/types.ts`, `src/application/state/appState.ts`, `src/reducer.logAdmin.test.ts`, new `src/mockData.apiInitialState.test.ts` (or equivalent next to existing mockData tests), any test that constructs `developers` / `logAdminUsers` | `src/infrastructure/mock/**`, `src/styles.css`, `src/features/**`, `docs/PLANS.md`, tracker |
| **B — TD-109 wave 1 envelopes** | `fix/td109-mock-error-envelopes` | `src/infrastructure/mock/**` (plus a new helper e.g. `src/infrastructure/mock/mockApiError.ts`), tests under that folder | `src/mockData.ts`, `src/application/state/appState.ts`, `src/styles.css`, `docs/PLANS.md`, tracker |
| **C — C7 wave 1 log CSS** | `refactor/log-analysis-css-colocation` | `src/styles.css` (deletions only of moved rules), `src/features/log-analysis/**` (new css + imports), `src/App.test.tsx` (the `.logs-v2` stylesheet assertion around line 3613), any log-analysis `readStylesheet("src/styles.css")` tests that would go red | `src/mockData.ts`, `src/infrastructure/mock/**`, `src/application/state/**`, tracker |

Parent session owns `docs/PLANS.md`, both trackers, FRONTEND bilingual pages, and this plan. Implementation agents do not edit those files.

## Track A — TD-110 leftover slices

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

## Track sequencing after this batch

```
now (parallel):  A TD-110 │ B TD-109 envelopes │ C log-analysis CSS
after A+B merge: TD-109 wave 2 (domain guards) — new branch from main
after C merge:   C7 wave 2 parameter-review CSS — new branch from main
later:           NodeDebuggingPage session → then reconsider C5
later:           TD-110 remainder (persistedConfigSnapshot / mock seeding / section-state)
```

## Git & PR Workflow

This plan **explicitly uses three feature branches**, each from latest `main`, because the tracks do not share files. That is an exception to the default "one plan → one branch" rule in `docs/PLANS.md`.

| Role | Allowed |
| --- | --- |
| Implementation agent | Work only in the assigned git worktree. `git fetch`, implement, test, **commit on the feature branch**. |
| Implementation agent | Must not push to `main`, open GitHub PRs, merge PRs, fast-forward local `main`, or edit `docs/PLANS.md` / tech-debt trackers / this plan / FRONTEND.md. |
| Parent agent | Review, open GitHub PRs, merge when green, sync `main`, then update tracker rows and FRONTEND bilingual pages. |

Worktrees (created from `origin/main`):

- Track A: `/Users/tzrea1/Develop/WiseEff/.worktrees/td110`
- Track B: `/Users/tzrea1/Develop/WiseEff/.worktrees/td109`
- Track C: `/Users/tzrea1/Develop/WiseEff/.worktrees/c7-logs-css`

The shared checkout `/Users/tzrea1/Develop/WiseEff` is dirty and on an unrelated branch — never implement there.

## UI Interaction Automation Review

- Track A: no route/form/table/modal/permission/device behavior change. Audit Center already ignores mock events in API mode; emptying `auditEvents` in API boot is a data-honesty fix, not a new interaction. Existing `/audit` coverage stays. No new requirement/operation IDs.
- Track B: mock-mode error presentation may start using `error.code` branches (Chinese CONFLICT copy instead of raw English `Error.message`). That is a mock-runtime honesty fix. Browser acceptance runs against API mode and is unaffected. No new IDs.
- Track C: no interaction behavior change if the CSS move is verbatim. Visual quality specs for `/logs` and `/log-dashboard` remain the evidence. If a selector is dropped accidentally, those specs (and App.test stylesheet assertions) fail. No new IDs.

## Documentation Impact Matrix

| Doc | Path | Impact |
| --- | --- | --- |
| Repository map | `AGENTS.md` | No change |
| Architecture | `ARCHITECTURE.md` | Review after Track A — confirm API-mode boot sentence still accurate |
| Architecture (zh) | `docs/zh-CN/architecture.md` | Review — mirror if EN changes |
| Frontend guide | `docs/FRONTEND.md` | Update (parent, after merges) — API initial state has no demo audit/people slices; mock adapters throw `WiseEffApiError`; log-analysis CSS colocation |
| Frontend guide (zh) | `docs/zh-CN/frontend.md` | Update — mirror |
| Plans index | `docs/PLANS.md` | Update — this plan in Current Active Plan; app-shell completed bullet points here |
| Plans index (zh) | `docs/zh-CN/PLANS.md` | Update — mirror the active-plan bullet |
| Tech debt | `docs/exec-plans/tech-debt-tracker.md` | Update — point TD-110/TD-109 at this plan; correct TD-109 "character-for-character" wording; shrink TD-110 remaining list after Track A |
| Tech debt (zh) | `docs/zh-CN/exec-plans/tech-debt-tracker.md` | Update alongside |
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

- [ ] Track A merged; TD-110 row rewritten to the true remainder (`persistedConfigSnapshot`, section-state, mock seeding)
- [ ] Track B merged; TD-109 row rewritten to "envelopes done; wave 2 machines remain"
- [ ] Track C merged; FRONTEND notes log-analysis CSS colocation; C7 wave 2 (parameter-review) recorded as remainder
- [ ] Bilingual FRONTEND + tracker + PLANS updates applied
- [ ] `npm run docs:check` passes

Deferred C5 and TD-109 wave 2 stay in this plan until they get their own branches or a follow-up plan.

## Expected outcomes

- Three independent PRs, mergeable in any order.
- API mode cannot be confused with demo directory/audit fixtures.
- Mock failures participate in `WiseEffApiError` code branches.
- Log-analysis CSS is colocated; `styles.css` loses the Log Analysis v2 block without visual change.
