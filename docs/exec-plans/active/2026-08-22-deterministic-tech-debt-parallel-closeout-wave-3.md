# Deterministic tech-debt parallel closeout — wave 3

> Status: **Active**
> Date: 2026-08-22
> Planning baseline: `origin/main@afa6095f9c9d27576f8f0b423fb438e2782a5e8d`
> Planning branch: `codex/deterministic-tech-debt-wave3-plan`
> Chinese: [Chinese](../../zh-CN/exec-plans/active/2026-08-22-deterministic-tech-debt-parallel-closeout-wave-3.md)
> Tracker: [Technical Debt Tracker](../tech-debt-tracker.md)

## Goal

Close the largest safe set of independent, deterministic tracker rows that needs no HDC/ADB hardware, target deployment, expert-labelled log set, live model/provider, KMS, or unresolved product decision:

- **TD-072** — retire the final three `QueuedResult` database-fake tests in `server/modules/parameters/service.test.ts` through real PostgreSQL state transitions or a pure review policy.
- **TD-110** — remove the nine structural demo users from API-mode initial state while preserving authenticated-current-user and governed-directory hydration.
- **TD-031** — make a Xiaoze-specific environment-variable family canonical, retain one explicit legacy read path, and update templates, checks, health gates, and operator docs without requiring a live LLM.
- **TD-112** — conditionally close table convergence by migrating the actual Admin list that enters the configuration workbench, `src/components/admin/ProjectAdminTable.tsx`, to `admin/DataTable` while preserving its responsive contracts.

Each row closes only after a focused red → green implementation, proportionate full gates, independent Standards and Spec reviews, its own PR and required CI, and a shared tracker/plan closeout. TD-112 additionally requires the scope and responsive-behaviour gate below; failure keeps TD-112 Open rather than forcing an inaccurate closure.

## Audit baseline and fixed facts

### TD-072 — three queue-fake residuals

- At `afa6095f`, the only repository `QueuedResult` type is `server/modules/parameters/service.test.ts:1109`; the only matching `createFakeDb` starts at line 1111.
- Exactly three tests use that section:
  - `submitParameterChanges rejects mixed working tips in one batch` near line 1316;
  - `submitParameterChanges creates enablement change requests from node-enablement drafts` near line 1399;
  - `rejects semantic merge when projectId is missing` near line 1508.
- The first two behaviors are reachable through the existing public seam `submitParameterChanges(Database, AuthContext, input)` and can use `createInMemoryTestDatabase()` with `seedCoreGraph` / `seedSpecBindingGraph` plus test-local candidates and occurrences.
- The third fake manufactures a state prohibited by the real schema: `parameter_change_requests.project_id` is `NOT NULL`. Its durable contract is the semantic review subject/precondition policy consumed by `reviewChange`, not a queued SQL call sequence.
- TD-096 is already Completed. The current TD-072 tracker wording that delegates residual SQL-text work to TD-096 is stale and must be corrected during closeout.

### TD-110 — API boot still owns mock identities

- `src/application/state/apiInitialState.ts:7-27` defines and exports nine demo users, and `createApiInitialState` at lines 36-67 assigns those users directly to API state.
- Mock seeding lives in `src/infrastructure/mock/prototypeState.ts`, but currently imports those users back from the API-state module; `src/mockData.ts` also re-exports them from the API-state module.
- The runtime already has the required public actions: `HYDRATE_AUTH_CONTEXT` and `HYDRATE_USERS` in `src/application/state/appState.ts`; `src/UserPermissionsPage.tsx` already calls `listUsers()` and dispatches `HYDRATE_USERS` on success.
- During API auth checking or failure, `App` renders skeleton/error/login rather than the business shell. Therefore an API empty shell can start with `users: []`, `currentUserId: ""`, and `activeRoleId: "guest"`; successful auth then inserts the real current user before the governed directory is visible.
- The user directory already presents loading, error/retry, ready, and DataTable empty states. This wave does not invent a hollow global section-status abstraction merely to close the hygiene row.

### TD-031 — operator naming is cross-cutting but locally testable

- The live family remains `AGENT_API_BASE_URL`, `AGENT_MODEL`, and `AGENT_API_KEY` in `.env.example`, `ops/self-hosted` templates/setup/checks, `server/config/env.ts`, Xiaoze model construction, health/readiness, and EN/ZH operator docs.
- `XIAOZE_MODEL` is an additional Xiaoze-specific model override, so the current contract has two model names and one legacy generic family.
- The canonical family for this track is fixed as:
  - `XIAOZE_LLM_API_BASE_URL`
  - `XIAOZE_LLM_MODEL`
  - `XIAOZE_LLM_API_KEY`
- `AGENT_API_BASE_URL`, `AGENT_MODEL`, `AGENT_API_KEY`, and `XIAOZE_MODEL` become deprecated read-only aliases for one compatibility window. Resolution is **group-atomic**: if any canonical raw key is present, including a blank value, canonical mode wins for the entire group; values are trimmed, blank means explicitly unset, base/key never fall back, and a blank/missing model defaults to `gpt-4o-mini`. Only when all three canonical raw keys are absent may legacy mode resolve base/key and `XIAOZE_MODEL > AGENT_MODEL > gpt-4o-mini`.
- Canonical plus legacy input produces secret-safe diagnostics: same values are `deprecated/ignored`, different values are `conflict/ignored`; diagnostics contain key names/codes, never values. Legacy-only input stays usable for one migration window with a warning and no invented removal date. Generated templates and setup output write only canonical keys.
- `XIAOZE_DETERMINISTIC=true` still waives live base/key readiness, but it does not suppress migration/conflict diagnostics. `AGENT_API_TIMEOUT_MS` has no current runtime consumer and is not promoted into this three-key family; its wiring or retirement remains a separately reviewed debt.
- Local tests can prove parsing, precedence, incomplete configuration, secret redaction, health mapping, self-hosted generation, and legacy migration. A live provider call is explicitly outside the closure claim.
- `docs/exec-plans/active/td-031-xiaoze-run-timeline-streaming.md` is an unrelated stale-numbered plan: its implementation was absorbed by TD-070 and only its EN/ZH persistence metadata note remains. Shared closeout must satisfy that note and archive the stale active plan so TD-031 names only the environment debt.

### TD-112 — scope is the Admin list entry, not the workbench canvas

- `docs/FRONTEND.md` states that Admin **list** tables use `src/components/admin/DataTable`; it lists the adopted Admin surfaces and calls the TD-112 residual “project-configuration workbench tables.”
- The live `src/components/project-configuration-workbench/` directory contains zero `<table>` elements. Tree, timeline, inspector, source canvas, task dock, and cards are not list tables.
- `src/components/admin/ProjectAdminTable.tsx` is a 360-line handwritten Admin table. `src/components/parameter-admin-next/ProjectsOperationsPanel.tsx:324-341` renders it at `/parameter-admin/projects` and its primary row action enters `/parameter-admin/projects/:projectId/configuration` as “配置工作台”. It is therefore the actual current Admin list shell that enters the configuration workbench.
- Existing coverage is only `ProjectAdminTable.layout.test.tsx` plus historical manual evidence. `PARAM-ADMIN-003` remains `future`, and its ≤960px-card wording has drifted from current CSS: the required contract is 390px card layout, 768px 1080px-wide scroll table with a 16px always-visible rail, and 1440px full table without page-level overflow.
- The everyday `DtsParameterWorkbenchTable` is excluded: `CONTEXT.md` separates the everyday Parameter workbench from Parameter admin governance, and its draft-only selection/tray/detail-edit semantics are not the generic Admin list contract. `ParametersTable` is also excluded as the mock-only legacy shell described by `docs/FRONTEND.md`.

## Non-goals

- TD-062 shell thinning, TD-075 acceptance-registry unification, TD-076 fixture consolidation, TD-003/012 client generation/contract breadth, or a TD-113 token/lint stock-burn wave.
- Changing parameter submit/review business policy, SQL schema, review roles, or audit behavior while removing TD-072 fakes.
- Building a new user-directory API, changing permissions, or hydrating the entire directory on unrelated API pages for TD-110.
- Removing legacy Xiaoze env aliases immediately, logging secrets, or claiming live-provider/target-environment readiness for TD-031.
- Rewriting completed historical plans, `docs/design-docs/2026-06-26-xiaoze-sole-agent-cleanup-design.md`, `docs/zh-CN/design-docs/2026-06-26-xiaoze-sole-agent-cleanup-design.md`, or `server/modules/agent/xiaoze/SPIKE.md` merely to modernize old variable names. Current normative docs change; history remains history.
- Migrating `DtsParameterWorkbenchTable`, `ParametersTable`, `/logs` rawlog, configuration-workbench tree/timeline/cards, wizards, diff/source viewers, or every remaining handwritten `<table>` under TD-112.
- Rewriting the project-configuration workbench or changing its route, domain sessions, selection semantics, or configuration operations.

## Deep-module seams and dependency classification

| Track | Public/deep seam | Dependency category | Boundary rule |
| --- | --- | --- | --- |
| TD-072 | `submitParameterChanges(Database, AuthContext, input)` plus a pure semantic review subject/precondition policy consumed by `reviewChange` | PostgreSQL is locally substitutable through the per-worker in-memory harness; policy is in-process | Tests assert returned errors and committed state, never SQL text, call order, or private helpers. The impossible `project_id=null` row is not recreated in PostgreSQL. |
| TD-110 | `createApiInitialState`, `createPrototypeState`, and reducer actions `HYDRATE_AUTH_CONTEXT` / `HYDRATE_USERS` | State transitions are in-process; directory HTTP is locally substitutable through `userGovernanceActions` | API boot owns no demo identity. Mock seeding owns the demo cast. Auth inserts the current user; directory hydration replaces/extends it without a flash or cross-route fetch. |
| TD-031 | `server/config/xiaozeLlmConfig.ts` exports the pure `resolveXiaozeLlmConfig(env)` TypeScript seam, canonical/legacy key metadata, normalized config, source, and redacted diagnostics. `ops/self-hosted/scripts/setup.sh` retains the only non-TypeScript legacy reader as an audited Bash migration adapter. | Operator configuration is externally supplied; parsing/health/setup are locally substitutable; a live model is external and excluded | Every TypeScript production consumer uses the resolver result. The Bash adapter implements the same group-atomic table and is parity-tested against the TypeScript seam through `ops/self-hosted/scripts/setup-selfhost.test.ts`. Canonical output, legacy input only. Do not invent a runtime `tsx` dependency for setup. |
| TD-112 | Existing `DataTable` controlled sort/row/action/toolbar/empty/pagination contract; `HorizontalDragScroll` gains an optional visible-rail capability | React behavior is in-process; API-mode route/browser is locally substitutable through the local server | `ProjectAdminTable` becomes composition, not a second table framework. Shared additions are generic: string-header `data-label` and optional rail. Project-specific columns/copy/actions stay local. |

No track depends on hardware. TD-031 consumes externally supplied configuration in production, but this wave proves only deterministic resolution and operator migration. TD-110/112 browser evidence uses the local API runtime and disposable/local data only.

## TD-112 pre-implementation scope gate

The TD-112 worker must record this gate before writing its first red test:

1. Re-run `rg -n '<table' src/components/project-configuration-workbench` and confirm the result is still empty on the refreshed implementation baseline.
2. Confirm `ProjectAdminTable` is still the `/parameter-admin/projects` Admin list whose primary action enters the canonical configuration route.
3. Confirm the migration needs no shared interface beyond:
   - `DataTable` deriving mobile `td[data-label]` from string headers, with “操作” for row actions; and
   - an optional visible rail owned by `HorizontalDragScroll`, absorbing the current ProjectAdmin `ResizeObserver` and pointer-scroll math.
4. Prove in a throwaway/render spike that the existing CSS breakpoints can preserve all three contracts: 390 card, 768 1080px table + 16px rail, 1440 full table without page overflow.

If any condition fails, stop TD-112 implementation, report the evidence, and leave the tracker row Open. Do not broaden the row to Dts, PCW tree/timeline/cards, or unrelated tables, and do not close it with a documentation-only reinterpretation.

## Worker scheduling and file ownership

After this plan PR merges, refresh `main` and start exactly three implementation workers in isolated worktrees:

| Slot | First assignment | Branch | Worktree | Next assignment |
| --- | --- | --- | --- | --- |
| Worker 1 | TD-072 | `codex/td-072-parameters-service-pg` | `WiseEff-worktrees/wave3-td072` | Review/support only after merge |
| Worker 2 | TD-110 | `codex/td-110-api-users-empty-boot` | `WiseEff-worktrees/wave3-td110` | Reuse this slot for TD-112 after TD-110 is reviewed, merged, and `main` is refreshed |
| Worker 3 | TD-031 | `codex/td-031-xiaoze-llm-env` | `WiseEff-worktrees/wave3-td031` | Review/support only after merge |
| Worker 2, second pass | TD-112 | `codex/td-112-project-admin-datatable` | `WiseEff-worktrees/wave3-td112` | Starts from refreshed `main`, not from the TD-110 branch |
| Parent/shared | closeout | `codex/deterministic-td-wave3-closeout` | `WiseEff-worktrees/wave3-closeout` | Tracker, plan archive, stale-plan hygiene, final gates |

Implementation workers commit only to their feature branches. They do not push `main`, create/merge PRs, or edit either tracker or this plan.

### Ownership and conflict matrix

| Track | Owned implementation files | Shared/high-conflict files | Conflict control |
| --- | --- | --- | --- |
| TD-072 | `server/modules/parameters/service.test.ts`; `server/modules/parameters/service.ts`; `server/modules/parameters/reviewChangePolicy.ts`; `server/modules/parameters/reviewChangePolicy.test.ts` | None with other wave tracks | The pure policy is the non-skipped contract for the schema-impossible project-less subject. No frontend, env, tracker, or broad database refactor. |
| TD-110 | `src/application/state/apiInitialState.ts`; `src/infrastructure/mock/prototypeState.ts`; `src/mockData.ts`; `src/application/state/appState.ts`; `src/mockData.apiInitialState.test.ts`; `src/reducer.userPermissions.test.ts`; `src/App.test.tsx`; `src/UserPermissionsPage.test.tsx`; `docs/FRONTEND.md`; `docs/zh-CN/frontend.md` | `docs/FRONTEND.md`; `docs/zh-CN/frontend.md` | Merge TD-110 before creating TD-112. Preserve mock exports and unrelated state slices. |
| TD-031 | `server/config/xiaozeLlmConfig.ts`; `server/config/xiaozeLlmConfig.test.ts`; `server/config/env.ts`; `server/config/env.test.ts`; `server/config/envExample.test.ts`; `server/config/loadDotenv.test.ts`; `server/index.ts`; `server/app.test.ts`; `server/modules/agent/xiaoze/agUiEndpoint.ts`; `server/modules/agent/xiaoze/agUiEndpoint.test.ts`; `server/modules/agent/xiaoze/agUiEndpoint.assembly.test.ts`; `server/modules/agent/xiaoze/agUiEndpoint.concurrency.test.ts`; `server/modules/agent/xiaoze/perceptionAgent.stream.test.ts`; `server/modules/agent/xiaoze/planningGraph.test.ts`; `server/modules/agent/xiaoze/planningGraph.sink.test.ts`; `server/modules/agent/xiaoze/planningGraph.toolContext.test.ts`; `server/modules/operations/health.ts`; `server/modules/operations/health.test.ts`; `server/modules/operations/routes.ts`; `server/modules/operations/routes.test.ts`; `server/modules/knowledge/indexing/embeddingClient.ts`; `e2e/acceptance/xiaoze-perception.acceptance.spec.ts`; `e2e/acceptance/xiaoze-action.acceptance.spec.ts`; `.env.example`; `.env.local.example`; `ops/self-hosted/.env.example`; `ops/self-hosted/.env.ip-lab.example`; `ops/self-hosted/scripts/check-self-hosted-config.ts`; `ops/self-hosted/scripts/check-self-hosted-config.test.ts`; `ops/self-hosted/scripts/ip-lab-profile.ts`; `ops/self-hosted/scripts/ip-lab-profile.test.ts`; `ops/self-hosted/scripts/selfhost-answers.ts`; `ops/self-hosted/scripts/selfhost-profile.ts`; `ops/self-hosted/scripts/selfhost-profile.test.ts`; `ops/self-hosted/scripts/setup.sh`; `ops/self-hosted/scripts/setup-selfhost.test.ts`; `scripts/check-doc-governance.ts`; `scripts/check-doc-governance.test.ts`; `README.md`; `docs/zh-CN/root/README.md`; `docs/design-docs/full-stack-architecture.md`; `docs/zh-CN/design-docs/full-stack-architecture.md`; exact documentation paths in the Documentation Impact Matrix | `docs/FRONTEND.md`; `docs/zh-CN/frontend.md`; `README.md`; `docs/zh-CN/root/README.md`; `docs/design-docs/full-stack-architecture.md`; `docs/zh-CN/design-docs/full-stack-architecture.md`; active self-hosted files may move on `main` | Rebase immediately before review and again before merge. Touch only Xiaoze LLM keys in shared operator files; preserve upgrade/setup behavior. |
| TD-112 | `src/components/admin/ProjectAdminTable.tsx`; `src/components/admin/ProjectAdminTable.test.tsx`; `src/components/admin/ProjectAdminTable.layout.test.tsx`; `src/components/admin/DataTable.tsx`; `src/components/admin/DataTable.test.tsx`; `src/components/HorizontalDragScroll.tsx`; `src/components/HorizontalDragScroll.test.tsx`; `src/hooks/useParamAdminProjectsSearch.ts`; `src/hooks/useParamAdminProjectsSearch.test.tsx`; `src/ParameterAdminNextPage.test.tsx`; `src/styles.css`; `e2e/acceptance/parameter-admin-projects.acceptance.spec.ts`; `e2e/acceptance/requirements.ts`; `e2e/acceptance/operationMatrix.ts`; exact acceptance/documentation paths in the Documentation Impact Matrix | `docs/FRONTEND.md`; `docs/zh-CN/frontend.md`; `e2e/acceptance/requirements.ts`; `e2e/acceptance/operationMatrix.ts`; generated coverage maps | Start after TD-110 merge. Rebase after TD-031 if it changed FRONTEND. No edits under `src/components/project-configuration-workbench/`. |
| Shared closeout | `docs/exec-plans/tech-debt-tracker.md`; `docs/zh-CN/exec-plans/tech-debt-tracker.md`; the exact Wave 3, PLANS, launch-plan, persistence-design, and stale-plan paths in the Documentation Impact Matrix | All TD numbers and plan locations | Start only after every implementation PR intended for closure is on `main`; re-check TD/ADR/migration numbers. |

## TDD vertical slices

### Track A — TD-072

1. **Red: mixed tips.** Express two real drafts/candidates/occurrences through `submitParameterChanges`; assert the public `mixed-working-tips` rejection and unchanged durable rows.
2. **Green: harness adoption.** Seed the smallest real graph with `createInMemoryTestDatabase()` and repository seed helpers; remove the corresponding queued results and SQL-call assertions.
3. **Red: node enablement.** Submit a real node-enablement draft and assert the returned request plus persisted request/item/enablement semantics.
4. **Green: behavior parity.** Reuse production submit paths; keep test-only rows local and assert transaction rollback/state, not query order.
5. **Red/green: impossible project-less merge.** Pin the semantic review subject/precondition in `server/modules/parameters/reviewChangePolicy.ts`, consume it from `reviewChange`, and execute its table test from `server/modules/parameters/reviewChangePolicy.test.ts`. Do not insert an invalid database row.
6. Remove `QueuedResult`, `createFakeDb`, queue helpers, stale comments, and all remaining SQL-text assertions in this section. Prove repository-wide `QueuedResult` stock is zero.

### Track B — TD-110

1. **Red: honest API shell.** `createApiInitialState()` must contain zero users, no demo current-user id, and guest-safe authority before auth.
2. **Green: move the cast.** Move the nine demo users into `src/infrastructure/mock/prototypeState.ts`; preserve `createPrototypeState`, `initialState`, and compatibility test exports without importing mock data into API boot.
3. **Red: auth hydration.** Starting from the empty API shell, `HYDRATE_AUTH_CONTEXT` inserts exactly the authenticated current user and establishes its role without reviving demo peers.
4. **Green: directory hydration.** `HYDRATE_USERS` replaces the directory when it includes the current user and retains only the authenticated current user when the response omits it; route-local loading/error/empty rendering remains honest.
5. **Red/green: no flash/no eager fetch.** App/page tests prove business pages do not render demo names during auth and non-user-governance routes do not call `listUsers`.

### Track C — TD-031

1. **Red: precedence table.** Table-test canonical-only, legacy-only, canonical+legacy same/different values, any canonical key present, blank canonical, incomplete live configuration, `XIAOZE_DETERMINISTIC`, and model-default cases. Assert group-atomic selection, redacted diagnostic codes/key names, and no value-bearing warnings.
2. **Green: TypeScript deep resolver.** Add `server/config/xiaozeLlmConfig.ts` with the dependency-light `resolveXiaozeLlmConfig(env)` and canonical key constants; model construction, health/readiness, routes, config validation, docs governance, TypeScript self-hosted profiles, and `server/index.ts` consume the normalized result rather than reading legacy keys.
3. **Red/green: audited Bash migration adapter.** Because `ops/self-hosted/scripts/setup.sh` cannot depend on `tsx`, it is the only production fallback allowed to read legacy keys directly. Its Bash mapping implements the same group-atomic presence/blank/default/diagnostic table, writes only canonical keys, and is parity-tested against `server/config/xiaozeLlmConfig.ts` through the same case matrix in `ops/self-hosted/scripts/setup-selfhost.test.ts` and `server/config/xiaozeLlmConfig.test.ts`.
4. **Red: generated output.** Assert root/self-hosted env templates and setup/profile writers emit only the three canonical names, while an existing legacy `.env` is read and rewritten/migrated without losing non-Xiaoze settings.
5. **Green: migration path.** Keep legacy aliases accepted for one compatibility window. Any present canonical raw key makes the canonical group authoritative, including explicit blank/unset; only total canonical absence allows legacy fallback. Health/error messages use canonical semantic names and never include secret values.
6. Update current normative EN/ZH environment, security, reliability, provider, setup, acceptance, deployment, and contribution docs. In the two active target-evidence plans, update future commands/examples and add a supersession note; do not rewrite completed historical plans, the sole-agent historical design, or the Xiaoze spike.
7. Prove deterministic/offline startup, health, Xiaoze perception, and Xiaoze action behavior through the two existing acceptance specs on one fresh, dedicated Playwright runtime. Run with `CI=true` and `XIAOZE_DETERMINISTIC=true`; do not reuse an existing live runtime, provide or contact a live provider, or convert missing target evidence into a local success claim.

### Track D — TD-112, after its scope gate

1. **Red: public ProjectAdmin behavior and URL contract.** Cover status filtering/clear, controlled header sort with `aria-sort`, >10-row pagination, empty states, Enter/click row entry, and edit/delete action isolation (actions must not trigger row entry). Search, status, and sort must write the existing `q`, `status`, and `sort` query keys; reload, `popstate`, browser Back, and Forward must restore the visible controls, rows, and sort direction.
2. **Green: DataTable composition.** Express project columns, toolbar, controlled sort, row action, empty state, and pagination through `DataTable`; delete local `<table>`, `filterRows`/`sortRows` duplication, and ProjectAdmin-owned scroll math.
3. **Red/green: generic responsive capability.** Add string-header `data-label` cells/actions to `DataTable`; add optional visible rail to `HorizontalDragScroll`; prove default consumers are unchanged.
4. **Red/green: three layout contracts.** Preserve 390 card field/action visibility, 768 1080px scroll table + 16px rail, and 1440 full table with no page-level overflow. Do not replace the 768 rail with a mobile card.
5. Add `e2e/acceptance/parameter-admin-projects.acceptance.spec.ts` for `PARAM-ADMIN-003` and update its requirement/operation wording from the stale ≤960px claim. Run `PROJ-CONFIG-READ-001` to prove the row still enters the canonical workbench. The spec must exercise URL write, reload, `popstate`, Back, and Forward restoration for `q`/`status`/`sort`.

## Verification gates by track

TD-072 has an additional blocking preflight because its PostgreSQL suites use `describe.skipIf(!databaseAvailable)`. Before accepting focused evidence, the worker must make local PostgreSQL reachable through `TEST_DATABASE_URL`, `DATABASE_URL`, or the repository default and run:

```bash
npx tsx -e 'import("./server/testing/testDatabase.ts").then(async ({ isTestDatabaseAvailable }) => { if (!(await isTestDatabaseAvailable())) process.exit(1); })'
```

That command must exit 0. The verbose focused run must then show the mixed-tip test, node-enablement test, and project-less pure-policy test actually executed, with **zero skips among those three behaviors**. A skipped PostgreSQL suite, a summary containing only the policy test, or CI without named test evidence cannot close TD-072.

| Track | Focused/component gate | Full/static gate | Browser gate | Acceptance/evidence gate |
| --- | --- | --- | --- | --- |
| TD-072 | PostgreSQL preflight above, then `npx vitest run --reporter=verbose --config vitest.server.config.ts server/modules/parameters/service.test.ts server/modules/parameters/reviewChangePolicy.test.ts server/modules/parameters/serviceReviewWorkflow.integration.test.ts server/modules/parameter-topology/postCutoverWorkflow.integration.test.ts`; record the three named behaviors and zero skips for them | `npm run test:server`; `npx tsc -b`; `npm run build`; `npm run docs:check`; `git diff --check` | Not applicable: no visible UI | Not applicable: local real-DB behavior plus the in-process policy are proven; no target DB claim |
| TD-110 | `npx vitest run src/mockData.apiInitialState.test.ts src/reducer.userPermissions.test.ts src/UserPermissionsPage.test.tsx src/App.test.tsx` | `npm test`; `npm run acceptance:quality`; `npx tsc -b`; `npm run build`; `npm run docs:check`; `git diff --check` | API mode `/organization/members`, reload at 1440×900, 768×1024, 390×844; snapshot+screenshot each; auth probe has no demo-name flash; `/api/v1/me` and user directory are 200; zero console errors | `PERM-USER-MGMT-001` in `e2e/acceptance/permissions.acceptance.spec.ts`; preserve non-Admin denial, API, DB, and audit evidence |
| TD-031 | `npx vitest run --config vitest.server.config.ts server/config/xiaozeLlmConfig.test.ts server/config/env.test.ts server/config/envExample.test.ts server/config/loadDotenv.test.ts server/modules/agent/xiaoze/agUiEndpoint.test.ts server/modules/agent/xiaoze/agUiEndpoint.assembly.test.ts server/modules/agent/xiaoze/agUiEndpoint.concurrency.test.ts server/modules/agent/xiaoze/perceptionAgent.stream.test.ts server/modules/agent/xiaoze/planningGraph.test.ts server/modules/agent/xiaoze/planningGraph.sink.test.ts server/modules/agent/xiaoze/planningGraph.toolContext.test.ts server/modules/operations/health.test.ts server/modules/operations/routes.test.ts`; `npx vitest run --config vitest.scripts.config.ts ops/self-hosted/scripts/check-self-hosted-config.test.ts ops/self-hosted/scripts/ip-lab-profile.test.ts ops/self-hosted/scripts/selfhost-profile.test.ts ops/self-hosted/scripts/setup-selfhost.test.ts scripts/check-doc-governance.test.ts`; `CI=true XIAOZE_DETERMINISTIC=true WISEEFF_ACCEPTANCE_FRONTEND_URL=http://127.0.0.1:5313 VITE_WISEEFF_API_BASE_URL=http://127.0.0.1:8931 npm run acceptance:e2e -- e2e/acceptance/xiaoze-perception.acceptance.spec.ts e2e/acceptance/xiaoze-action.acceptance.spec.ts` | `npm run test:server`; `npm run test:scripts`; `npm run selfhost:check`; `npm run contract:check`; `npm run docs:check`; `npx tsc -b`; `npm run build`; `git diff --check` | Not applicable: no user-visible UI or route behavior changes | Offline/deterministic health, perception, action, and self-hosted config only. The dedicated-runtime gate below must prove a fresh deterministic-ready Xiaoze dependency and record zero external-provider requests; no live provider credentials, target readiness, or secret provisioning are used or claimed |
| TD-112 | `npx vitest run src/components/admin/ProjectAdminTable.test.tsx src/components/admin/ProjectAdminTable.layout.test.tsx src/components/admin/DataTable.test.tsx src/components/HorizontalDragScroll.test.tsx src/hooks/useParamAdminProjectsSearch.test.tsx src/ParameterAdminNextPage.test.tsx` | `npm test`; `npm run acceptance:quality`; `npm run acceptance:a11y`; `npm run acceptance:visual`; `npm run acceptance:responsive`; `npm run lint`; `npm run ui:check`; `npx tsc -b`; `npm run build`; `npm run docs:check`; `git diff --check` | API mode `/parameter-admin/projects` at 1440×900, 768×1024, 390×844; snapshot+screenshot each; search/filter/sort/pagination/Enter row/edit/delete; verify `q`/`status`/`sort` after reload, `popstate`, Back, and Forward; 390 card completeness, 768 rail, 1440 no page overflow; zero console errors and relevant API requests 200 | Run `npm run acceptance:operations`, then the focused Playwright command for `e2e/acceptance/parameter-admin-projects.acceptance.spec.ts` (`PARAM-ADMIN-003`) plus `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts` (`PROJ-CONFIG-READ-001`), then require recorded evidence with `npm run acceptance:evidence -- --run <runDir> --require PARAM-ADMIN-003`; do not close from regenerated maps alone |

Browser artifacts go under `work/ui-checks/wave3-td110/` and `work/ui-checks/wave3-td112/`. Each visible-track PR records the local URL, three viewports, interactions, screenshot paths, console/network results, issues found/fixed, and any existing non-error warning separately.

For TD-031 focused acceptance, reserve frontend `5313` and API `8931`; both were free during plan authoring. Immediately before the run, confirm both are still free with read-only probes:

```bash
! lsof -nP -iTCP:5313 -sTCP:LISTEN
! lsof -nP -iTCP:8931 -sTCP:LISTEN
```

If either is occupied, do not kill, restart, or reuse that process. Select another free dedicated pair, record the exact replacement ports in the PR evidence, and substitute the same pair in every URL below. `CI=true` makes `reuseExistingServer=false`; the frontend `--strictPort` and API bind must fail rather than attach to an occupied port. Run both specs in one invocation so Playwright owns one fresh runtime:

```bash
CI=true XIAOZE_DETERMINISTIC=true WISEEFF_ACCEPTANCE_FRONTEND_URL=http://127.0.0.1:5313 VITE_WISEEFF_API_BASE_URL=http://127.0.0.1:8931 npm run acceptance:e2e -- e2e/acceptance/xiaoze-perception.acceptance.spec.ts e2e/acceptance/xiaoze-action.acceptance.spec.ts
```

After Playwright starts its API and frontend web servers and before the two Xiaoze scenarios proceed, the acceptance precondition must capture `/health/ready` from the dedicated API and require `dependencies.xiaozeLlm.status=ready` with the deterministic-mode message. Preserve the fresh-process/server logs or equivalent focused artifact and record that no external provider request occurred. A reused runtime, an occupied-port fallback, missing deterministic-ready health evidence, or any external provider request blocks TD-031 closure.

For TD-112 focused acceptance, create one stable focused run ID and retain the emitted run directory. Execute the operation-matrix check before Playwright, attach both relevant specs to that run, and validate the concrete evidence directory afterward:

```bash
npm run acceptance:operations
WISEEFF_ACCEPTANCE_EVIDENCE_RUN_ID=<focused-run-id> WISEEFF_ACCEPTANCE_EVIDENCE_RUN_KIND=focused npm run acceptance:e2e -- e2e/acceptance/parameter-admin-projects.acceptance.spec.ts e2e/acceptance/project-configuration-workbench.acceptance.spec.ts
npm run acceptance:evidence -- --run <runDir> --require PARAM-ADMIN-003
```

## Git & PR Workflow

1. Merge this planning-only change first. Every implementation worktree and every `codex/` feature branch named above is created from the latest `origin/main` after that merge; no implementation branch may predate the merged plan baseline.
2. Start TD-072, TD-110, and TD-031 in parallel from refreshed `main`.
3. For each implementation branch:
   - implementation subagent records red evidence before production edits, focused/full evidence after green, and commits only on its assigned `codex/` branch;
   - parent fetches/rebases on current `origin/main`, runs `npx tsc -b` and affected tests;
   - two agents independent of the implementer review the fixed diff in parallel: one **Standards** review against repository docs, one **Spec** review against this plan and tracker row;
   - findings are fixed and both reviews are repeated until zero findings;
   - implementation subagents never open/merge PRs or push/fast-forward `main`; parent alone pushes the feature branch, opens the PR, waits for every required CI check, merges, then runs `git pull origin main` in the parent main worktree.
4. Preferred first-wave merge order is TD-072 → TD-110 → TD-031. A green TD-110 may merge before TD-072/031; immediately reuse its worker slot for TD-112 from refreshed `main`.
5. Before TD-112 PR review, rebase it over every already-merged first-wave branch, especially TD-031 if shared FRONTEND docs changed. Repeat typecheck and affected tests after rebase.
6. Merge TD-112 only after its scope gate, three-viewport QA, `PARAM-ADMIN-003`, `PROJ-CONFIG-READ-001`, zero-finding two-axis review, and all required CI are green.
7. Create the shared closeout branch from final refreshed `main`; no implementation agent edits tracker/plan state.

Required repository checks remain blocking. A pending check is not approval to merge. Path-filtered target/HDC/provider jobs may honestly skip, but their absence cannot support a readiness claim.

## Shared tracker and active-plan hygiene closeout

1. Move only successfully closed TD-072/110/031/112 rows from Open to Completed in both trackers with exact PR/SHA, focused/full/CI, browser/acceptance, and boundary evidence. If TD-112's scope gate fails, leave it Open and record why.
2. Correct TD-072's stale reference to already-Completed TD-096 and record repository-wide zero `QueuedResult` only after verified.
3. Satisfy the stale timeline plan's metadata gate in:
   - `docs/design-docs/xiaoze-thread-persistence.md`
   - `docs/zh-CN/design-docs/xiaoze-thread-persistence.md`
4. Replace `docs/exec-plans/active/td-031-xiaoze-run-timeline-streaming.md` with archived `docs/exec-plans/completed/2026-08-22-xiaoze-run-timeline-streaming-metadata-closeout.md` and create `docs/zh-CN/exec-plans/completed/2026-08-22-xiaoze-run-timeline-streaming-metadata-closeout.md`.
5. Update current-state references in `docs/PLANS.md`, `docs/zh-CN/PLANS.md`, `docs/exec-plans/active/2026-08-17-launch-actionable-tech-debt-closeout.md`, and `docs/zh-CN/exec-plans/active/2026-08-17-launch-actionable-tech-debt-closeout.md`; preserve historical implementation evidence.
6. Move `docs/exec-plans/active/2026-08-22-deterministic-tech-debt-parallel-closeout-wave-3.md` to `docs/exec-plans/completed/2026-08-22-deterministic-tech-debt-parallel-closeout-wave-3.md` and its Chinese active companion to `docs/zh-CN/exec-plans/completed/2026-08-22-deterministic-tech-debt-parallel-closeout-wave-3.md` only after every Update/Review row and combined gate passes. The filenames must not remain in both trees.

## Success criteria

- Three first-wave workers run concurrently without overlapping code ownership; TD-112 reuses the TD-110 slot from a refreshed main baseline.
- Repository `QueuedResult` stock is zero; local PostgreSQL preflight passes; the two converted DB behaviors and the pure project-less policy test execute with zero skips; no SQL-text/call-order assertion replaces behavior evidence.
- API initial state contains no demo user or demo authority; mock mode retains the nine-person cast; API auth and directory hydration remain correct with no visible demo flash.
- All current templates and setup output use `XIAOZE_LLM_*`. Direct legacy reads are allowed only in `server/config/xiaozeLlmConfig.ts`, the audited `ops/self-hosted/scripts/setup.sh` Bash migration adapter, their exact tests, and explicit migration/history documents; every other production consumer has zero direct legacy reads. TypeScript/Bash parity passes, config/health errors stay redacted, and no live-provider readiness is claimed.
- `ProjectAdminTable` composes `DataTable`, no longer owns a handwritten `<table>` or scroll math, and preserves 390/768/1440 behavior plus entry/actions/filters/sort/pagination and `q`/`status`/`sort` URL restoration across reload, `popstate`, Back, and Forward.
- TD-112 closure is evidence-led and conditional; Dts, legacy ParametersTable, and PCW non-table surfaces remain explicitly outside it.
- Every implementation and closeout diff receives zero-finding independent Standards and Spec reviews and passes required PR CI before merge.
- Both tracker languages, both PLANS indexes, both plan locations, acceptance registries/maps, and Xiaoze timeline plan hygiene agree with final `main`.

## Final combined verification

Run from refreshed `main` after all implementation PRs and the closeout diff are composed:

```bash
npx tsc -b
npm test -- --maxWorkers=4
npm run test:server
npm run build
npm run lint
npm run ui:check
npm run test:scripts
npm run selfhost:check
npm run contract:check
npm run acceptance:coverage
npm run acceptance:operations
npm run acceptance:quality
npm run acceptance:a11y
npm run acceptance:visual
npm run acceptance:responsive
npm run acceptance:browser -- --mode local-non-hdc
npm run acceptance:evidence
npm run docs:check
git diff --check
```

Also re-run the TD-072 local-PostgreSQL preflight plus named zero-skip behavior gate and the TD-110/112 API-mode browser gates from their final merged routes. Record exact test counts, skips, named TD-072 cases, warnings, screenshots, network/console results, CI check names, PR numbers, and merge SHAs in the completed plan and trackers.

## Documentation Impact Matrix

| Area | Status | Exact files / required evidence |
| --- | --- | --- |
| Repository maps | Review | `AGENTS.md`; `docs/zh-CN/root/AGENTS.md`; `ARCHITECTURE.md`; `docs/zh-CN/root/ARCHITECTURE.md`; `docs/README.md`; `docs/zh-CN/README.md`. Treat the latter pair as the documentation knowledge-base indexes; record unchanged unless navigation or runtime boundaries actually move. |
| Architecture entry points | Update | `README.md`; `docs/zh-CN/root/README.md`; `docs/design-docs/full-stack-architecture.md`; `docs/zh-CN/design-docs/full-stack-architecture.md`. Align the Xiaoze canonical runtime/configuration entry points and retain the local-deterministic versus live-provider evidence boundary. |
| Planning | Update | `docs/exec-plans/active/2026-08-22-deterministic-tech-debt-parallel-closeout-wave-3.md`; `docs/zh-CN/exec-plans/active/2026-08-22-deterministic-tech-debt-parallel-closeout-wave-3.md`; closeout destinations `docs/exec-plans/completed/2026-08-22-deterministic-tech-debt-parallel-closeout-wave-3.md` and `docs/zh-CN/exec-plans/completed/2026-08-22-deterministic-tech-debt-parallel-closeout-wave-3.md`; `docs/PLANS.md`; `docs/zh-CN/PLANS.md`; `docs/exec-plans/active/2026-08-17-launch-actionable-tech-debt-closeout.md`; `docs/zh-CN/exec-plans/active/2026-08-17-launch-actionable-tech-debt-closeout.md`; stale source `docs/exec-plans/active/td-031-xiaoze-run-timeline-streaming.md`; archive destinations `docs/exec-plans/completed/2026-08-22-xiaoze-run-timeline-streaming-metadata-closeout.md` and `docs/zh-CN/exec-plans/completed/2026-08-22-xiaoze-run-timeline-streaming-metadata-closeout.md`. |
| Technical debt | Update | `docs/exec-plans/tech-debt-tracker.md`; `docs/zh-CN/exec-plans/tech-debt-tracker.md`. Move only rows supported by merged evidence. |
| Domain context | Review | `CONTEXT.md`; `docs/adr/README.md`. Preserve the everyday Parameter workbench vs Parameter admin/configuration-workbench distinction; add no ADR unless implementation changes a durable decision. |
| Product specs | No change | `docs/product-specs/index.md`; `docs/product-specs/product-spec.md`; `docs/zh-CN/product-specs/index.md`; `docs/zh-CN/product-specs/product-spec.md`. No product workflow or permission decision is planned. |
| Frontend architecture | Update | `docs/FRONTEND.md`; `docs/zh-CN/frontend.md`. Remove API demo-user wording, define the actual TD-112 Admin-list closure, and document canonical Xiaoze env names where listed. |
| Quality/testing | Review | `docs/QUALITY_SCORE.md`; `docs/zh-CN/QUALITY_SCORE.md`; `docs/design-docs/testing-strategy.md`; `docs/zh-CN/design-docs/testing-strategy.md`; `docs/developer/verification-matrix.md`; `docs/zh-CN/developer/verification-matrix.md`. Record unchanged if no repository-wide gate changes. |
| Browser acceptance | Update | `e2e/acceptance/requirements.ts`; `e2e/acceptance/operationMatrix.ts`; `e2e/acceptance/parameter-admin-projects.acceptance.spec.ts`; `docs/developer/browser-acceptance-coverage-map.md`; `docs/zh-CN/developer/browser-acceptance-coverage-map.md`; `docs/developer/user-operation-coverage-matrix.md`; `docs/zh-CN/developer/user-operation-coverage-matrix.md`. Make `PARAM-ADMIN-003` automated with accurate breakpoints and URL-history behavior, retain `PROJ-CONFIG-READ-001`, and pass `npm run acceptance:operations`, the focused evidence command, `npm run acceptance:quality`, `npm run acceptance:a11y`, `npm run acceptance:visual`, and `npm run acceptance:responsive`. |
| Environment/runtime/contribution | Update | `.env.example`; `.env.local.example`; `ops/self-hosted/.env.example`; `ops/self-hosted/.env.ip-lab.example`; `CONTRIBUTING.md`; `docs/zh-CN/root/CONTRIBUTING.md`; `docs/developer/environment-variables.md`; `docs/zh-CN/developer/environment-variables.md`; `docs/developer/local-development.md`; `docs/zh-CN/developer/local-development.md`; `docs/zh-CN/backend-runtime.md`. Canonical output is `XIAOZE_LLM_*`; legacy input is migration-only. |
| Reliability/runbooks | Update | `docs/RELIABILITY.md`; `docs/zh-CN/RELIABILITY.md`; `docs/runbooks/agent-provider.md`; `docs/zh-CN/runbooks/agent-provider.md`; `docs/runbooks/observability-operations.md`; `docs/zh-CN/runbooks/observability-operations.md`; `docs/runbooks/manual-acceptance.md`; `docs/zh-CN/manual-acceptance.md`; `docs/runbooks/m5-commercial-pilot-readiness.md`; `docs/zh-CN/runbooks/m5-commercial-pilot-readiness.md`; `docs/design-docs/deployment-operations.md`; `docs/zh-CN/design-docs/deployment-operations.md`. Preserve local-vs-target proof boundaries. |
| Active target-evidence plans | Update | `docs/exec-plans/active/2026-05-29-wiseeff-m5-2-staging-pilot-evidence-execution.md`; `docs/zh-CN/exec-plans/active/2026-05-29-wiseeff-m5-2-staging-pilot-evidence-execution.md`; `docs/exec-plans/active/2026-05-29-wiseeff-m5-2-non-hdc-target-evidence-closure.md`; `docs/zh-CN/exec-plans/active/2026-05-29-wiseeff-m5-2-non-hdc-target-evidence-closure.md`. Update examples to canonical keys without fabricating target evidence. |
| Security secrets/governance | Update | `docs/security/secrets-management.md`; `docs/zh-CN/security/secrets-management.md`; `docs/zh-CN/security-reliability.md`; `scripts/check-doc-governance.ts`; `scripts/check-doc-governance.test.ts`. Retain secret-redaction and no-committed-key rules under canonical names. |
| Security maps | Review | `docs/SECURITY.md`; `docs/zh-CN/SECURITY.md`; `docs/security/README.md`; `docs/zh-CN/security/README.md`. Record unchanged unless the trust, authz, audit, or secret classification boundary changes. |
| Frontend/design | Review | `docs/design-docs/ui-design-system.md`; `docs/zh-CN/design-docs/ui-design-system.md`; `docs/developer/ui-quality-checklist.md`; `docs/zh-CN/developer/ui-quality-checklist.md`. Record unchanged only after TD-112 three-viewport evidence passes. |
| API/generated artifacts | No change | `docs/api/README.md`; `docs/zh-CN/api/README.md`; `docs/design-docs/api-contract.md`; `docs/zh-CN/design-docs/api-contract.md`; `docs/generated/openapi.json`. No HTTP contract is planned; `contract:check` must prove no drift. |
| Xiaoze persistence design | Update | `docs/design-docs/xiaoze-thread-persistence.md`; `docs/zh-CN/design-docs/xiaoze-thread-persistence.md`. Add the already-implemented assistant-message run-step metadata note before archiving the stale active plan. |
| References | Review | `docs/references/productization-api-contract-draft.md`; `docs/references/pi-agent-provider-evidence.md`. Record unchanged unless current env-name examples are found; no vendored reference corpus rewrite. |

## Documentation Update Gate

This gate is blocking:

- every `Update` row is changed in both languages where a companion exists, and every `Review` row is either changed or explicitly recorded unchanged with commit/diff evidence;
- all canonical/legacy Xiaoze env mentions are inventoried with `rg`; current templates and operator instructions use canonical keys; direct legacy reads are limited to `server/config/xiaozeLlmConfig.ts`, `ops/self-hosted/scripts/setup.sh`, exact tests, and migration/history documents; TypeScript/Bash parity passes;
- `PARAM-ADMIN-003` requirement, operation registry, generated maps, `e2e/acceptance/parameter-admin-projects.acceptance.spec.ts`, and recorded three-viewport evidence agree on the 390/768/1440 plus `q`/`status`/`sort` history contract; `npm run acceptance:operations` passes, and the focused run directory passes `npm run acceptance:evidence -- --run <runDir> --require PARAM-ADMIN-003`;
- TD-072/110/031/112 tracker states agree with merged code and CI; a failed TD-112 scope gate leaves the row Open;
- the stale Xiaoze timeline metadata note is complete and its plan exists only under `completed/` with a Chinese companion;
- this Wave 3 filename exists only under `active/` while work remains and only under `completed/` after closure;
- `npm run docs:check`, `npm run acceptance:coverage`, `npm run acceptance:operations`, `npm run acceptance:quality`, `npm run acceptance:a11y`, `npm run acceptance:visual`, `npm run acceptance:responsive`, `npm run acceptance:browser -- --mode local-non-hdc`, `npm run acceptance:evidence`, `npm run contract:check`, and `git diff --check` pass before moving the plan to completed;
- deferred target/HDC/live-provider evidence stays explicit and is not converted into a local completion claim.
