# WiseEff API Runtime Strictness And Frontend Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Keep the mock runtime available for demos/tests, but make API mode strict and production-oriented.

**Goal:** Eliminate API-mode fallback to local demo data and separate frontend API behavior from mock-only runtime behavior.

**Architecture:** API mode gets an explicit bootstrap state, runtime status model, and route/domain error boundary so business pages never render mock seeded domain data after auth or required API hydration fails. Mock data and local reducer mutations remain available only through the explicit mock runtime path; API runtime actions use HTTP gateways/repositories and surface loading, unavailable, retry, and partial-domain states instead of silently preserving `src/mockData.ts`. Acceptance and unit tests lock this as a product invariant.

**Tech Stack:** TypeScript, React/Vite, existing WiseEff frontend ports, Vitest, Playwright browser acceptance, existing backend API and docs governance scripts.

## Completion Record

Status: completed on 2026-06-12.

Implemented:

- API mode starts from an empty business-domain bootstrap state and route gates required API domains with unavailable/retry UI instead of retaining seeded demo data.
- Frontend runtime behavior is route-aware: `/logs` refreshes project-scoped logs, `/log-admin` refreshes global logs with archived records, and API mutations do not fall back to mock reducer actions.
- Parameter, log, debugging, user-governance, and Agent-facing API seams were covered with regression tests and acceptance evidence.
- Documentation updates landed in architecture, frontend, quality, planning, acceptance coverage, operation matrix, and Chinese companion docs.

Verification evidence:

- `npm test`
- `npm run build`
- `npm run acceptance:browser`
- `npm run acceptance:evidence`
- `npm run docs:check`
- `git diff --check`
- Frontend browser verification screenshots and snapshots under `work/ui-checks/` for `/parameters`, `/parameter-admin`, `/logs`, `/log-admin`, and `/parameters` API outage across desktop `1440x900`, tablet `768x1024`, and mobile `390x844`.

Documentation gate:

- Update rows were completed in `ARCHITECTURE.md`, `docs/FRONTEND.md`, `docs/QUALITY_SCORE.md`, `docs/developer/browser-acceptance-coverage-map.md`, `docs/developer/user-operation-coverage-matrix.md`, `docs/generated/acceptance-operation-evidence.md`, `docs/exec-plans/tech-debt-tracker.md`, `docs/zh-CN/frontend.md`, `docs/zh-CN/root/ARCHITECTURE.md`, `docs/zh-CN/QUALITY_SCORE.md`, and `docs/zh-CN/exec-plans/tech-debt-tracker.md`.
- Review rows were checked; product specs, reliability/runbooks, security/governance docs, and references did not require wording changes for this runtime-boundary implementation.

---

## Scope

In scope:

- Stop API-mode auth and required domain failures from rendering local demo projects, parameters, logs, devices, debug parameters, users, or mock reducer side effects.
- Replace current fallback copy such as `无法连接雷泽 API，已保留本地演示数据` with explicit API unavailable/retry UI and notifications.
- Add an API runtime bootstrap state that is empty for business domain collections and contains only safe shell defaults until backend data arrives.
- Make API-mode hydration and route rendering depend on typed runtime status rather than the presence of mock `PrototypeState` data.
- Move mock-only local actions behind explicit mock runtime boundaries for parameters, logs, debugging, and user governance surfaces touched by this change.
- Add automated regression coverage proving API mode does not show demo seeded data when auth or domain APIs fail.
- Add or update browser acceptance requirement IDs, operation IDs, generated operation matrix docs, and implementation docs.

Out of scope for this plan:

- Removing mock mode entirely.
- Replacing all `PrototypeState` usage across every test in one pass.
- Rewriting the whole 5k-line `src/App.tsx` into a new application shell.
- Changing backend API contracts unless a frontend strict-mode test exposes a missing error/status contract.
- Adding new production features beyond strict API-mode behavior and runtime boundary cleanup.

## Problem Statement

Current evidence:

- `src/App.tsx` initializes the reducer with `initialAppState = initialState`, and the default `initialState` comes from `src/mockData.ts`.
- `src/mockData.ts` seeds business data including `activeProjectId: "aurora"`, demo parameters, logs, devices, users, and review queues.
- `src/App.tsx` currently catches API bootstrap/hydration failures and dispatches notifications that explicitly say demo data was preserved:
  - `无法连接雷泽 API，已保留本地演示数据`
  - `无法加载雷泽日志 API，已保留本地演示数据`
  - `无法加载雷泽调试 API，已保留本地演示数据`
  - `无法加载雷泽用户 API，已保留本地演示用户`
- `src/application/parameters/parameterRuntime.ts`, `src/application/logs/logRuntime.ts`, and `src/application/debugging/debuggingRuntime.ts` combine API and mock behavior in the same runtime action factories.
- `src/application/debugging/debuggingRuntime.ts` still exposes API-mode adjacent methods such as `rollbackLastSnapshot()` and `connectDevice()` that directly dispatch local reducer actions.
- Existing tests already acknowledge the seam, for example `src/App.test.tsx` checks node debugging avoids mock parameter reads before API hydration, but the app still starts from mock state and preserves unrelated demo data on API failure.
- `docs/FRONTEND.md` documents that mock mode remains useful and API mode is production-oriented, but current runtime behavior violates the production rule that API mode must not use mock data as a business source.

## Product Decisions

- API mode is strict: failed auth or failed required business hydration must never fall back to local demo data.
- Mock mode remains first-class for demos, local component tests, and mock acceptance where explicitly selected.
- API mode may show shell chrome, route navigation, and non-business empty states before hydration, but it must not show seeded domain rows from `src/mockData.ts`.
- Required API domains are route-aware:
  - Authentication is required for every API-mode route.
  - Parameter routes require parameter project/parameter/review/draft hydration.
  - Log routes require log list hydration.
  - Debugging routes require debugging device/parameter hydration for the active project before reads/writes.
  - User governance requires `/api/v1/users` hydration before rendering governed user rows.
- Partial success is allowed only when the visible route's required domain is healthy. A parameter API failure must not block a log route if the log route has its own authenticated API data, but the parameter route must render unavailable/retry instead of demo rows.
- API-mode mutations never call mock reducer actions. If the required gateway/repository is absent or fails, the action reports an API failure and keeps API state unchanged.
- Regression tests must assert absence of demo identifiers such as `Aurora`, `Nebula`, `Atlas`, `aurora`, `api_runtime_voltage_limit` only when API-provided, demo log names, and mock debug node rows on failing API paths.

## Expected File Structure

- Create: `src/app/runtime/apiBootstrapState.ts`
  - Builds API-mode initial state from `PrototypeState` shape with empty business domain collections, safe shell defaults, migrated auth defaults, and no demo project/log/debug/user rows.
- Create: `src/app/runtime/runtimeStatus.ts`
  - Defines `RuntimeDomain`, `RuntimeDomainStatus`, `ApiRuntimeState`, status transitions, required-domain helpers, and user-facing unavailable copy.
- Create: `src/app/runtime/runtimeHydration.ts`
  - Coordinates auth, parameter, log, debugging, and user-governance refreshes with cancellable bootstrap/retry helpers.
- Create: `src/app/runtime/RuntimeUnavailable.tsx`
  - Shared route-level unavailable/retry view for API mode.
- Test: `src/app/runtime/apiBootstrapState.test.ts`
- Test: `src/app/runtime/runtimeStatus.test.ts`
- Modify: `src/App.tsx`
  - Selects mock vs API initial state.
  - Stores API runtime status.
  - Replaces fallback notifications.
  - Delegates bootstrap/hydration to runtime helper.
  - Gates route rendering by required domain status.
- Modify: `src/app/routes.tsx`
  - Accepts runtime status and renders `RuntimeUnavailable` for unavailable required domains.
- Modify: `src/application/parameters/parameterRuntime.ts`
  - Keeps mock local reducer actions only under `runtimeMode !== "api"`.
  - Makes API refresh/mutation failures explicit typed failures.
- Modify: `src/application/logs/logRuntime.ts`
  - Keeps simulated upload and local log mutations only under mock mode.
  - Makes API refresh/mutation failures explicit typed failures.
- Modify: `src/application/debugging/debuggingRuntime.ts`
  - Removes direct local dispatch fallbacks from API-mode paths, including `rollbackLastSnapshot()` and `connectDevice()`.
- Modify: `src/UserPermissionsPage.tsx` and `src/UserPermissionsPage.test.tsx` if current page assumptions depend on mock users in API mode.
- Modify: `src/App.test.tsx`
- Modify: `src/application/parameters/parameterRuntime.test.ts`
- Modify: `src/application/logs/logRuntime.test.ts`
- Modify: `src/application/debugging/debuggingRuntime.test.ts`
- Modify: `e2e/acceptance/auth-runtime.acceptance.spec.ts`
- Modify: `e2e/acceptance/requirements.ts`
- Modify: `e2e/acceptance/operationMatrix.ts`
- Generated after scripts: `docs/developer/browser-acceptance-coverage-map.md`
- Generated after scripts: `docs/developer/user-operation-coverage-matrix.md`
- Generated after acceptance evidence run: `docs/generated/acceptance-operation-evidence.md`
- Modify: `docs/FRONTEND.md`
- Modify: `ARCHITECTURE.md`
- Modify: `docs/QUALITY_SCORE.md`
- Modify: `docs/exec-plans/tech-debt-tracker.md`
- Modify Chinese companion docs as needed:
  - `docs/zh-CN/frontend.md`
  - `docs/zh-CN/root/ARCHITECTURE.md`
  - `docs/zh-CN/QUALITY_SCORE.md`

## Success Criteria

- In API mode, no auth or required domain API failure path displays local demo project, parameter, log, debug, or user rows.
- In API mode, route-level unavailable UI is visible with retry affordance when the current route's required API domain fails.
- In API mode, notifications and page copy describe API unavailability; no copy says demo data was preserved.
- In mock mode, current demo workflows keep passing without requiring backend APIs.
- Runtime action factories have clear API vs mock behavior and tests for both paths.
- Browser acceptance includes a blocking strict runtime requirement and operation evidence.
- `npm test`, `npm run build`, `npm run acceptance:coverage`, `npm run acceptance:operations`, `npm run acceptance:browser`, `npm run acceptance:evidence`, `npm run docs:check`, and `git diff --check` pass before completion.

## Implementation Tasks

### Task 1: Lock The Failure With Tests

**Files:**

- Modify: `src/App.test.tsx`
- Create: `src/app/runtime/apiBootstrapState.test.ts`
- Create: `src/app/runtime/runtimeStatus.test.ts`

- [ ] Add a failing `src/App.test.tsx` case for API auth failure:

```tsx
it("does not render demo data when API auth bootstrap fails", async () => {
  window.history.replaceState(null, "", "/parameters");

  render(
    <App
      authClient={{ getCurrentAuthContext: vi.fn().mockRejectedValue(new Error("auth unavailable")) }}
      runtimeMode="api"
    />
  );

  expect(await screen.findByRole("alert")).toHaveTextContent(/API|无法连接|重试/);
  expect(document.body).not.toHaveTextContent(/Aurora|Nebula|Atlas|aurora/);
  expect(document.body).not.toHaveTextContent("已保留本地演示数据");
});
```

- [ ] Add a failing `src/App.test.tsx` case for parameter API failure after auth succeeds:

```tsx
it("blocks parameter routes instead of preserving demo rows when parameter API refresh fails", async () => {
  window.history.replaceState(null, "", "/parameters");
  const repository = createAppParameterRepository({
    listProjects: vi.fn().mockRejectedValue(new Error("parameter API unavailable"))
  });

  render(
    <App
      authClient={createResolvedAuthClient()}
      parameterRepository={repository}
      runtimeMode="api"
    />
  );

  expect(await screen.findByRole("alert")).toHaveTextContent(/参数 API|重试|不可用/);
  expect(document.body).not.toHaveTextContent(/Aurora|Nebula|Atlas|charging_thermal_trace/);
  expect(document.body).not.toHaveTextContent("已保留本地演示数据");
});
```

- [ ] Add a failing `src/App.test.tsx` case for log API failure on `/logs`:

```tsx
it("blocks log routes instead of preserving demo logs when log API refresh fails", async () => {
  window.history.replaceState(null, "", "/logs");

  render(
    <App
      authClient={createResolvedAuthClient()}
      parameterRepository={createAppParameterRepository()}
      logAnalysisRepository={createAppLogAnalysisRepository({
        listLogs: vi.fn().mockRejectedValue(new Error("log API unavailable"))
      })}
      runtimeMode="api"
    />
  );

  expect(await screen.findByRole("alert")).toHaveTextContent(/日志 API|重试|不可用/);
  expect(document.body).not.toHaveTextContent(/charging_thermal_trace|Aurora|已保留本地演示数据/);
});
```

- [ ] Add a failing `src/App.test.tsx` case for debugging API failure on `/node-debugging`:

```tsx
it("blocks debugging routes instead of preserving mock node rows when debugging API refresh fails", async () => {
  window.history.replaceState(null, "", "/node-debugging");

  render(
    <App
      authClient={createResolvedAuthClient()}
      parameterRepository={createAppParameterRepository()}
      debuggingGateway={createAppDebuggingGateway({
        listDevices: vi.fn().mockRejectedValue(new Error("debug API unavailable"))
      })}
      runtimeMode="api"
    />
  );

  expect(await screen.findByRole("alert")).toHaveTextContent(/调试 API|重试|不可用/);
  expect(document.body).not.toHaveTextContent(/ChargeLab_X01|battery_pack_temp|Aurora|已保留本地演示数据/);
});
```

- [ ] Add `apiBootstrapState.test.ts` assertions that API bootstrap state has empty `projects`-derived collections, empty `parameters`, `logs`, `devices`, `debugParameters`, `changeRequests`, `parameterSubmissionRounds`, `users`, and no `activeProjectId: "aurora"`.
- [ ] Add `runtimeStatus.test.ts` assertions for `loading -> ready`, `loading -> unavailable`, route required-domain lookup, retry reset, and partial-domain success.
- [ ] Run `npm test -- src/App.test.tsx src/app/runtime/apiBootstrapState.test.ts src/app/runtime/runtimeStatus.test.ts`.
- [ ] Confirm the new tests fail for the current implementation before changing production code.

### Task 2: Add API Bootstrap State

**Files:**

- Create: `src/app/runtime/apiBootstrapState.ts`
- Modify: `src/App.tsx`

- [ ] Implement `createApiBootstrapState()` by starting from `createPrototypeState()` or `initialState` shape and explicitly clearing business data:

```ts
export function createApiBootstrapState(): PrototypeState {
  const shell = createPrototypeState();
  return {
    ...shell,
    activeProjectId: "",
    activeRoleId: "guest",
    parameters: [],
    changeRequests: [],
    aiFeedback: [],
    parameterSubmissionRounds: [],
    parameterInitializationDrafts: [],
    parameterInitializationReviews: [],
    projectInitializationStatuses: {},
    logs: [],
    archivedLogIds: [],
    devices: [],
    debugParameters: [],
    auditEvents: [],
    users: [],
    currentUserId: "",
    notifications: [],
    lastDebugSnapshot: null,
    debugEvents: [],
    pushedDebugIds: [],
    debuggingSessionStartedAt: null,
    debuggingActiveSessionId: null,
    insightDismissedIds: [],
    aiFlaggedImportIds: [],
    _undoStack: null
  };
}
```

- [ ] Keep `configDraft` and `persistedConfigSnapshot` only if route code still needs project metadata for non-business shell controls; otherwise replace them with an empty clone in the same task and adjust tests.
- [ ] In `App`, change default state selection so `runtimeMode === "api"` uses `createApiBootstrapState()` unless tests inject an explicit API fixture.
- [ ] Preserve test injection by documenting that `initialAppState` in API-mode tests is a fixture override, not the production default.
- [ ] Run `npm test -- src/app/runtime/apiBootstrapState.test.ts src/App.test.tsx`.

### Task 3: Add Runtime Status And Route Gating

**Files:**

- Create: `src/app/runtime/runtimeStatus.ts`
- Create: `src/app/runtime/RuntimeUnavailable.tsx`
- Modify: `src/App.tsx`
- Modify: `src/app/routes.tsx`

- [ ] Define domains:

```ts
export type RuntimeDomain = "auth" | "parameters" | "logs" | "debugging" | "users";
```

- [ ] Define status:

```ts
export type RuntimeDomainStatus =
  | { state: "idle" | "loading" }
  | { state: "ready"; loadedAt: string }
  | { state: "unavailable"; message: string; retryKey: number };
```

- [ ] Add `requiredDomainsForPage(pageKey)` with route mappings:
  - Parameter pages: `["auth", "parameters"]`
  - Log pages: `["auth", "logs"]`
  - Debugging pages: `["auth", "debugging"]`
  - User permissions: `["auth", "users"]`
  - Home/shell pages: `["auth"]`
- [ ] Add `selectBlockingRuntimeStatus(pageKey, status)` returning the first unavailable/loading required domain.
- [ ] Add `RuntimeUnavailable` with `role="alert"`, clear domain-specific copy, and a Retry button wired to runtime retry.
- [ ] In `routes.tsx`, render `RuntimeUnavailable` for API-mode required-domain failures before rendering the business page.
- [ ] Keep mock mode route rendering unchanged.
- [ ] Run `npm test -- src/app/runtime/runtimeStatus.test.ts src/App.test.tsx`.

### Task 4: Extract And Harden API Hydration

**Files:**

- Create: `src/app/runtime/runtimeHydration.ts`
- Modify: `src/App.tsx`

- [ ] Move current API bootstrap effect out of `App.tsx` into a helper that accepts:
  - `authClient`
  - `parameterActions`
  - `logActions`
  - `debuggingActions`
  - current route/page key
  - active project id
  - status dispatchers
  - app dispatch
- [ ] Replace `Promise.allSettled()` fallback notifications with domain status transitions:
  - auth failure marks all route-visible API behavior unavailable.
  - parameter refresh failure marks `parameters` unavailable.
  - log refresh failure marks `logs` unavailable.
  - debugging refresh failure marks `debugging` unavailable.
- [ ] Remove all `已保留本地演示数据` and `已保留本地演示用户` copy.
- [ ] Keep success notifications such as `已连接雷泽参数 API` only after the corresponding domain is ready.
- [ ] Add a retry function that resets failed domain status to `loading` and reruns only required route hydration when the user clicks Retry.
- [ ] Ensure cancelled effects do not dispatch status or app actions after unmount.
- [ ] Run `npm test -- src/App.test.tsx src/app/runtime/runtimeStatus.test.ts`.

### Task 5: Split Mock And API Runtime Actions

**Files:**

- Modify: `src/application/parameters/parameterRuntime.ts`
- Modify: `src/application/logs/logRuntime.ts`
- Modify: `src/application/debugging/debuggingRuntime.ts`
- Modify tests under `src/application/**`

- [ ] Add tests proving API-mode runtime actions never dispatch local mock action types on gateway/repository failure:
  - Parameters: no `ADD_PARAMETER_SUBMISSION_ROUND`, `STASH_PARAMETER_SUBMISSION_ROUND`, `ADVANCE_REVIEW`, `REJECT_REVIEW`, or `IMPORT_PARAMETERS`.
  - Logs: no `SIMULATE_LOG_UPLOAD`, `LOG_ADMIN_REANALYZE_LOG`, `LOG_ADMIN_ARCHIVE_LOG`, or `LOG_ADMIN_UNARCHIVE_LOG`.
  - Debugging: no `CONNECT_DEVICE`, `PUSH_DEBUG_VALUES`, or `ROLLBACK_LAST_SNAPSHOT` from API mode.
- [ ] Change API-mode `rollbackLastSnapshot()` so it either calls `rollbackSnapshot()` with a known backend snapshot id or returns a typed API failure when no API snapshot is selected.
- [ ] Change API-mode `connectDevice()` so it calls `detectAndStartSession()` or returns a typed API failure instead of dispatching `CONNECT_DEVICE`.
- [ ] Keep existing mock-mode tests for local reducer actions passing.
- [ ] Run:

```bash
npm test -- src/application/parameters/parameterRuntime.test.ts src/application/logs/logRuntime.test.ts src/application/debugging/debuggingRuntime.test.ts
```

### Task 6: Add Strict Runtime Browser Acceptance

**Files:**

- Modify: `e2e/acceptance/requirements.ts`
- Modify: `e2e/acceptance/operationMatrix.ts`
- Modify: `e2e/acceptance/auth-runtime.acceptance.spec.ts`
- Generated: `docs/developer/browser-acceptance-coverage-map.md`
- Generated: `docs/developer/user-operation-coverage-matrix.md`
- Generated: `docs/generated/acceptance-operation-evidence.md`

- [ ] Add requirement `API-STRICT-001`:

```ts
{
  id: "API-STRICT-001",
  workflow: "A",
  title: "API mode never falls back to local demo business data when auth or required API hydration fails.",
  required: true
}
```

- [ ] Add operation `API-STRICT-001`:

```ts
{
  id: "API-STRICT-001",
  priority: "P0",
  area: "auth",
  route: "/parameters",
  roles: ["Admin"],
  action: "Simulate an API-mode required-domain outage and verify unavailable UI appears without demo business rows.",
  coverage: "automated",
  acceptanceIds: ["API-STRICT-001"],
  specFiles: ["e2e/acceptance/auth-runtime.acceptance.spec.ts"],
  assertions: ["ui", "api", "screenshot"]
}
```

- [ ] Extend `auth-runtime.acceptance.spec.ts` with `// @acceptance API-STRICT-001` and `// @operation API-STRICT-001`.
- [ ] Implement the browser test with Playwright route interception for one required domain, for example abort or fulfill `GET /api/v1/projects` with `503`, then load `/parameters`.
- [ ] Assert:
  - unavailable/retry UI is visible.
  - `Aurora`, `Nebula`, `Atlas`, `aurora`, and known demo log/debug identifiers are absent.
  - copy does not contain `已保留本地演示数据`.
  - operation evidence records the simulated API response and screenshot.
- [ ] Run:

```bash
npm run acceptance:coverage
npm run acceptance:operations
npm run acceptance:browser
npm run acceptance:evidence
```

### Task 7: Update Documentation And Technical Debt

**Files:**

- Modify: `docs/FRONTEND.md`
- Modify: `ARCHITECTURE.md`
- Modify: `docs/QUALITY_SCORE.md`
- Modify: `docs/exec-plans/tech-debt-tracker.md`
- Modify: `docs/zh-CN/frontend.md`
- Modify: `docs/zh-CN/root/ARCHITECTURE.md`
- Modify: `docs/zh-CN/QUALITY_SCORE.md`

- [ ] Update `docs/FRONTEND.md` to state that API mode starts from an empty API bootstrap state and never preserves mock business data after API failures.
- [ ] Update `ARCHITECTURE.md` frontend boundary section to distinguish mock runtime adapters from API runtime adapters.
- [ ] Update `docs/QUALITY_SCORE.md` to remove or reduce the specific risk that API mode keeps demo business data once tests and acceptance evidence pass.
- [ ] Update `docs/exec-plans/tech-debt-tracker.md`:
  - Close or narrow `TD-001` if it currently covers mock mode drift.
  - Add a follow-up only for remaining broad `PrototypeState` test fixture cleanup, if still needed.
- [ ] Apply the same durable developer-facing statements to the Chinese companion docs named above.
- [ ] Run `npm run docs:check`.

### Task 8: Final Verification

**Files:** no additional production files.

- [ ] Run targeted tests:

```bash
npm test -- src/App.test.tsx src/app/runtime/apiBootstrapState.test.ts src/app/runtime/runtimeStatus.test.ts
npm test -- src/application/parameters/parameterRuntime.test.ts src/application/logs/logRuntime.test.ts src/application/debugging/debuggingRuntime.test.ts
```

- [ ] Run full verification:

```bash
npm test
npm run build
npm run acceptance:coverage
npm run acceptance:operations
npm run acceptance:browser
npm run acceptance:evidence
npm run docs:check
git diff --check
```

- [ ] Manually inspect `git diff` for accidental changes to unrelated generated evidence files before completion.
- [ ] Move this plan to `docs/exec-plans/completed/` only after all success criteria pass and documentation gates are satisfied.

## UI Interaction Acceptance Impact

Affected existing requirement IDs:

- `AUTH-RUNTIME-001`: API-mode browser runtime auth still must load current user with the local dev auth contract.
- `SHELL-DIAG-001`: Core routes must still fail on unexpected console/page/request/API diagnostics.

New required requirement ID:

- `API-STRICT-001`: API mode never falls back to local demo business data when auth or required API hydration fails.

Affected operation IDs:

- Existing `AUTH-RUNTIME-001`
- Existing `SHELL-DIAG-001`
- New `API-STRICT-001`

Required spec impact:

- `e2e/acceptance/auth-runtime.acceptance.spec.ts` must add the outage/no-demo-data case.
- `e2e/acceptance/requirements.ts` must add `API-STRICT-001`.
- `e2e/acceptance/operationMatrix.ts` must add `API-STRICT-001`.
- Generated coverage docs must be refreshed by the existing acceptance scripts.

## Rollout And Risk

- Main risk: existing UI components assume a non-empty `activeProjectId` or mock project list. Mitigation: route gating prevents business pages from rendering until required domain data is ready; unit tests cover empty API bootstrap state.
- Main risk: tests that use `initialState` as API fixture may keep masking production fallback. Mitigation: add strict tests that render `<App runtimeMode="api" />` without `initialAppState` and verify no demo data.
- Main risk: large `src/App.tsx` changes can cause regression. Mitigation: extract only runtime bootstrap/status coordination first, then adjust route gates and runtime actions in small tested steps.
- Main risk: route-scoped partial success may be confused with global outage. Mitigation: status model records domain-specific state and route required domains.

## Documentation Impact Matrix

| Area | Status | Files | Required action |
| --- | --- | --- | --- |
| Repository maps | Review | `AGENTS.md`, `ARCHITECTURE.md`, `docs/README.md` | Update only `ARCHITECTURE.md` if frontend runtime boundary wording changes; no `AGENTS.md` change expected. |
| Planning docs | Update | `docs/PLANS.md`, this plan | Keep this active plan listed while work is active; move to completed after verification. |
| Product specs | Review | `docs/product-specs/index.md`, `docs/product-specs/product-spec.md`, `docs/product-specs/prototype-functional-spec.md` | Confirm no product workflow text promises demo fallback in API mode. Update only if stale. |
| Architecture docs | Update | `ARCHITECTURE.md`, `docs/design-docs/full-stack-architecture.md`, `docs/zh-CN/root/ARCHITECTURE.md` | Document strict API mode and mock/API boundary if implementation changes durable architecture. |
| Quality/testing docs | Update | `docs/QUALITY_SCORE.md`, `docs/design-docs/testing-strategy.md`, `docs/developer/browser-acceptance-coverage-map.md`, `docs/developer/user-operation-coverage-matrix.md`, `docs/zh-CN/QUALITY_SCORE.md` | Add `API-STRICT-001`, refresh generated coverage docs, and update quality risk language. |
| Reliability/runbooks | Review | `docs/RELIABILITY.md`, `docs/runbooks/README.md` | Update only if runtime unavailable/retry behavior changes operator runbooks. |
| Security/governance docs | Review | `docs/SECURITY.md`, `docs/security/README.md` | No authz contract change expected; record unchanged evidence in completion notes. |
| Frontend/design docs | Update | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` | Document API bootstrap state, unavailable UI, retry behavior, and mock-only data boundary. |
| Generated artifacts | Update | `docs/developer/browser-acceptance-coverage-map.md`, `docs/developer/user-operation-coverage-matrix.md`, `docs/generated/acceptance-operation-evidence.md` | Regenerate after acceptance metadata and browser evidence changes. |
| References | Review | `docs/references/` | Update only if a reference page describes runtime mode fallback or frontend API contracts. |

## Documentation Update Gate

Before this plan can be marked complete:

- Every `Update` row in the Documentation Impact Matrix must be changed or explicitly recorded as unchanged with evidence.
- Every `Review` row must be checked and either updated or recorded as no change in the completion notes.
- English and Chinese developer-facing docs must stay separate and linked; do not mix Chinese and English prose inside one doc as the bilingual strategy.
- `npm run docs:check` must pass.
- If any runtime-boundary cleanup remains, add or update an item in `docs/exec-plans/tech-debt-tracker.md` before moving this plan to `completed/`.
