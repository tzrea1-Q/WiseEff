# Debug & Log Analysis Org-Scope Decoupling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Design spec:** [2026-07-07-debug-logs-org-scope-decoupling-design.md](../../design-docs/2026-07-07-debug-logs-org-scope-decoupling-design.md) (approved)
>
> Chinese spec: [2026-07-07-debug-logs-org-scope-decoupling-design.md](../../zh-CN/superpowers/specs/2026-07-07-debug-logs-org-scope-decoupling-design.md)

**Goal:** Decouple log analysis and debugging from parameter-management `projects`; both domains operate at `organization_id` scope only.

**Architecture:** Single migration drops `project_id` FKs/columns on M2/M3 tables and removes `parameter_reload_bindings`. Backend APIs infer org from auth and delete `require*ProjectAccess`. Frontend limits TopBar project selector to parameter routes; logs/debug clients drop `projectId`.

**Tech Stack:** PostgreSQL migrations, Node/TypeScript server modules, React/Vite frontend, Vitest, Playwright acceptance.

---

## Git & PR Workflow

| Item | Value |
| --- | --- |
| Base branch | `main` |
| Feature branch | `feat/debug-logs-org-scope-decoupling` |
| Subagent | Implement + commit on feature branch only |
| Parent agent | Review, open PR, merge, sync `main` |

---

## File Map (high level)

| Area | Primary files |
| --- | --- |
| Migration | `server/migrations/0037_debug_logs_org_scope_decoupling.sql` |
| Logs backend | `server/modules/logs/{policy,schemas,repository,service,routes}.ts`, `*.test.ts` |
| Debug backend | `server/modules/debugging/{policy,schemas,repository,service,routes,catalogSplitRepository}.ts`, `*.test.ts` |
| Jobs | `server/modules/jobs/{repository,routes}.ts`, `routes.test.ts` |
| Notifications | `server/modules/notifications/producers.ts`, `producers.test.ts` |
| Agent | `server/modules/agent/tools/perceptionTools.ts`, `*.test.ts`, `xiaoze/threadPersistence.ts` |
| Frontend types | `src/domain/logs/types.ts`, `src/domain/debugging/types.ts`, `src/mockData.ts` |
| HTTP layer | `src/infrastructure/http/{log,debugging,debuggingAdmin}{Client,Dtos}.ts` |
| Ports/runtime | `src/application/{logs/logRuntime,debugging/debuggingRuntime}.ts`, ports |
| Pages | `src/LogsPage.tsx`, `src/LogAdminPage.tsx`, `src/DebuggingPage.tsx`, `src/DebuggingAdminPage.tsx`, `src/App.tsx`, `src/appConfig.ts` |
| TopBar | `src/App.tsx` (project selector visibility), `src/logAdminAnalytics.ts` |
| E2E | `e2e/acceptance/debugging-simulator.acceptance.spec.ts`, `e2e/logs*.spec.ts`, `docs/developer/browser-acceptance-coverage-map.md` |
| Docs | `docs/design-docs/domain-model.md`, `api-contract.md`, `docs/FRONTEND.md`, `docs/generated/db-schema.md` |

---

## Task 1: Database migration

**Files:**
- Create: `server/migrations/0037_debug_logs_org_scope_decoupling.sql`

- [ ] **Step 1: Add migration file**

Drop FK constraints then columns in dependency-safe order:

```sql
-- 1) Drop parameter_reload_bindings (cross-domain)
drop table if exists parameter_reload_bindings;

-- 2) Debugging runtime: drop project_id FKs + columns
--    Tables: debugging_events, debugging_snapshots, node_operations,
--            debugging_sessions, debugging_targets, debugging_devices, debug_device_leases
--    For debug_device_leases: drop PK, drop project_id, add PK (organization_id, device_id)

-- 3) Debugging catalog: drop project_id from
--    debug_node_bindings, debug_nodes, debugging_parameter_node_bindings, debugging_parameters
--    Drop partial indexes referencing project_id IS NULL

-- 4) Logs: drop project_id from log_records, log_file_objects
--    Drop index log_records_org_project_status_idx; add log_records_org_status_idx

-- 5) Optional: drop FK on debugging_parameters.parameter_definition_id,
--    node_operations.parameter_definition_id (keep columns as nullable text refs)
```

Reference existing FK names from `0005_m3_debugging.sql`, `0007`, `0017`, `0018`, `0026`, `0028`.

- [ ] **Step 2: Run migration locally**

```bash
npm run dev:api   # or project migrate command from CONTRIBUTING.md
```

Expected: migration applies without FK errors on seed DB.

- [ ] **Step 3: Commit**

```bash
git add server/migrations/0037_debug_logs_org_scope_decoupling.sql
git commit -m "feat(db): decouple logs and debugging from parameter projects"
```

---

## Task 2: Logs backend — remove project scope

**Files:**
- Modify: `server/modules/logs/policy.ts`
- Modify: `server/modules/logs/schemas.ts`
- Modify: `server/modules/logs/types.ts`
- Modify: `server/modules/logs/repository.ts`
- Modify: `server/modules/logs/service.ts`
- Modify: `server/modules/logs/routes.ts`
- Modify: `server/modules/logs/policy.test.ts` (if exists)
- Modify: `server/modules/logs/repository.test.ts`
- Modify: `server/modules/logs/service.test.ts`
- Modify: `server/modules/logs/routes.test.ts`
- Modify: `server/modules/logs/schemas.test.ts`

- [ ] **Step 1: Update schemas — remove projectId**

In `schemas.ts`, remove `projectId` from upload body schema and list query schema. Keep `relatedParameterId` optional on records.

- [ ] **Step 2: Delete project ACL helpers**

Remove `getAllowedLogProjectIds` and `requireLogProjectAccess` from `policy.ts`. Call sites use `requireLogView` / `requireLogUpload` only.

- [ ] **Step 3: Update repository**

In `repository.ts`:
- Remove `project_id` from INSERT/SELECT for `log_file_objects` and `log_records`
- Remove `allowedProjectIds` / `projectId` filter branches in `listLogs`
- List by `organization_id` + optional status/archive/query filters

- [ ] **Step 4: Update service + routes**

`service.ts`: upload uses `auth.organization.id` only; remove all `requireLogProjectAccess` calls.

`routes.ts`: stop parsing/passing `projectId`.

- [ ] **Step 5: Fix tests**

Update fixtures in `repository.test.ts`, `service.test.ts`, `routes.test.ts` — no `projectId` in payloads; org-scoped list assertions.

Run:

```bash
npm run test:server -- server/modules/logs/
```

Expected: all logs module tests PASS.

- [ ] **Step 6: Commit**

```bash
git add server/modules/logs/
git commit -m "feat(logs): scope APIs to organization instead of parameter projects"
```

---

## Task 3: Debugging backend — remove project scope

**Files:**
- Modify: `server/modules/debugging/policy.ts`, `policy.test.ts`
- Modify: `server/modules/debugging/schemas.ts`, `schemas.test.ts`
- Modify: `server/modules/debugging/types.ts`
- Modify: `server/modules/debugging/repository.ts`, `repository.test.ts`
- Modify: `server/modules/debugging/catalogSplitRepository.ts`, `catalogSplitRepository.test.ts`
- Modify: `server/modules/debugging/service.ts`, `service.test.ts`
- Modify: `server/modules/debugging/routes.ts`, `routes.test.ts`
- Delete or gut: reload-target routes already 410 — remove dead code paths referencing `parameter_reload_bindings`

- [ ] **Step 1: Remove project ACL**

Delete `getAllowedDebugProjectIds`, `requireDebugProjectAccess` from `policy.ts`; update `policy.test.ts`.

- [ ] **Step 2: Schemas — drop projectId**

Remove `projectId` from session create, device list, admin catalog query, runtime node query schemas.

- [ ] **Step 3: Repository + catalogSplitRepository**

Remove `project_id` from all SQL in `repository.ts` and `catalogSplitRepository.ts`. Remove reload binding CRUD if table dropped.

Update `debug_device_leases` queries for new PK `(organization_id, device_id)`.

- [ ] **Step 4: Service + routes**

Remove every `requireDebugProjectAccess(auth, …)` call in `service.ts` (~15 call sites).

Remove `?projectId=` handling in `routes.ts`.

- [ ] **Step 5: Fix tests**

Run:

```bash
npm run test:server -- server/modules/debugging/
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/modules/debugging/
git commit -m "feat(debugging): scope APIs to organization instead of parameter projects"
```

---

## Task 4: Jobs + notifications

**Files:**
- Modify: `server/modules/jobs/repository.ts`, `routes.ts`, `routes.test.ts`, `types.ts`
- Modify: `server/modules/notifications/producers.ts`, `producers.test.ts`

- [ ] **Step 1: Jobs — org ACL for log jobs**

In `jobs/repository.ts`, stop selecting `log.project_id` for authorization snapshot.

In `jobs/routes.ts`, replace `requireLogProjectAccess(auth, item.projectId)` with org-level `requireLogView(auth)`.

Remove `projectId` from `JobSnapshot` type if only used for log ACL.

- [ ] **Step 2: Notifications — drop project query params**

In `producers.ts`, change:
- `logsUrl(projectId)` → `"/logs"`
- `nodeDebuggingUrl(projectId)` → `"/node-debugging"`
- Keep `parameterAdminUrl` / `reviewQueueUrl` with project for param workflows.

Update `producers.test.ts` expected URLs.

- [ ] **Step 3: Run tests**

```bash
npm run test:server -- server/modules/jobs/ server/modules/notifications/
```

- [ ] **Step 4: Commit**

```bash
git add server/modules/jobs/ server/modules/notifications/
git commit -m "refactor: align jobs and notifications with org-scoped logs/debug"
```

---

## Task 5: Agent perception tools

**Files:**
- Modify: `server/modules/agent/tools/perceptionTools.ts`, `perceptionTools.test.ts`
- Modify: `server/modules/agent/xiaoze/threadPersistence.ts` (if injects project for log/debug pages)

- [ ] **Step 1: Org-scope log conclusions**

`getRecentLogConclusions`: query by `organization_id`, remove `projectId` filter parameter.

- [ ] **Step 2: Org-scope node snapshot**

`getNodeSnapshot`: remove project filter; use org + parameter/node id.

- [ ] **Step 3: Thread context**

Do not require `projectId` in AG-UI context for `pageKey` ∈ `{logs, log-admin, node-debugging, debugging-admin}`.

- [ ] **Step 4: Tests**

```bash
npm run test:server -- server/modules/agent/tools/perceptionTools.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add server/modules/agent/
git commit -m "refactor(agent): org-scope log and debug perception tools"
```

---

## Task 6: Frontend domain + HTTP clients

**Files:**
- Modify: `src/domain/logs/types.ts` — remove `projectId`
- Modify: `src/domain/debugging/types.ts` — remove `projectId` where present
- Modify: `src/infrastructure/http/logDtos.ts`, `logClient.ts`, `*.test.ts`
- Modify: `src/infrastructure/http/debuggingDtos.ts`, `debuggingClient.ts`, `*.test.ts`
- Modify: `src/infrastructure/http/debuggingAdminDtos.ts`, `debuggingAdminClient.ts`, `*.test.ts`
- Modify: `src/application/ports/LogAnalysisRepository.ts`, `DebuggingGateway.ts`

- [ ] **Step 1: Types + DTO mappers**

Remove `projectId` from domain types and DTO map functions. Keep `relatedParameterId` on logs.

- [ ] **Step 2: HTTP clients**

Remove `projectId` query params and body fields from all log/debug client methods.

- [ ] **Step 3: Port interfaces**

Update repository/gateway interfaces to match.

- [ ] **Step 4: Tests**

```bash
npm test -- src/infrastructure/http/logClient.test.ts src/infrastructure/http/debuggingClient.test.ts src/infrastructure/http/debuggingAdminClient.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/domain/logs/ src/domain/debugging/ src/infrastructure/http/log* src/infrastructure/http/debugging* src/application/ports/
git commit -m "refactor(frontend): remove projectId from log and debug HTTP layer"
```

---

## Task 7: Frontend runtime + pages

**Files:**
- Modify: `src/application/logs/logRuntime.ts`, `logRuntime.test.ts`
- Modify: `src/application/debugging/debuggingRuntime.ts`, `debuggingRuntime.test.ts`
- Modify: `src/LogsPage.tsx`, `src/logsPage.*.test.tsx`
- Modify: `src/LogAdminPage.tsx`, `src/logAdminAnalytics.ts`, `src/logAdminAnalytics.test.ts`
- Modify: `src/components/admin/LogRecordDrawer.tsx`, `LogRecordDrawer.test.tsx`
- Modify: `src/DebuggingPage.tsx`, `DebuggingPage.test.tsx`
- Modify: `src/DebuggingAdminPage.tsx`, `DebuggingAdminPage.test.tsx`
- Modify: `src/components/DebugAdminSplitCatalog.tsx`, `src/debugAdminDraft.ts`

- [ ] **Step 1: logRuntime — upload/list without projectId**

Remove `projectId` from upload input; refresh list org-wide.

- [ ] **Step 2: debuggingRuntime — session/device without projectId**

Remove `projectId` from `refresh`, `connect`, admin list calls.

- [ ] **Step 3: LogsPage + LogAdminPage**

Upload uses org context only. Remove project column/filter from admin analytics (`logAdminAnalytics.ts` — drop `projectId` sort dimension).

Update `LogRecordDrawer` — remove project display or replace with org-only metadata.

- [ ] **Step 4: Debugging pages**

Remove `state.activeProjectId` from API calls in `DebuggingPage`, `DebuggingAdminPage`.

- [ ] **Step 5: Cross-page navigation in App.tsx**

Find log primary action → parameters link (~4938). Change to `/parameters?parameter=…&logId=…` without `project=`.

- [ ] **Step 6: Tests**

```bash
npm test -- src/application/logs/ src/application/debugging/ src/logsPage.primaryAction.test.tsx src/DebuggingAdminPage.test.tsx
```

- [ ] **Step 7: Commit**

```bash
git add src/application/logs/ src/application/debugging/ src/LogsPage.tsx src/LogAdminPage.tsx src/DebuggingPage.tsx src/DebuggingAdminPage.tsx src/logAdminAnalytics.ts src/components/admin/LogRecordDrawer.tsx
git commit -m "feat(ui): org-scope log and debug pages without parameter project"
```

---

## Task 8: TopBar project selector + mock state

**Files:**
- Modify: `src/App.tsx` — project selector visibility; mock `LogRecord`, `Device`; cross-links
- Modify: `src/mockData.ts` — remove `projectId` from logs/devices types and seed data
- Modify: `src/appConfig.ts` (if page groups defined)

- [ ] **Step 1: Limit TopBar project picker to param routes**

Show project selector only when `pageKey` ∈ parameter-management group (`parameters`, `parameter-admin`, `parameter-review`, `home` hotspots that need project, etc.).

Hide on `logs`, `log-admin`, `node-debugging`, `debugging-admin`.

- [ ] **Step 2: Mock data**

Remove `projectId` from `LogRecord` and `Device` types and `initialState` seed arrays.

Ensure mock log upload does not dispatch projectId.

- [ ] **Step 3: Verify mock delete project**

Confirm `DELETE_PARAMETER_ADMIN_PROJECT` does not need to touch logs/devices (already aligned).

- [ ] **Step 4: Typecheck**

```bash
npx tsc -b
```

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/mockData.ts src/appConfig.ts
git commit -m "refactor(ui): restrict project selector to parameter routes; update mock state"
```

---

## Task 9: E2E acceptance + regression

**Files:**
- Modify: `e2e/acceptance/debugging-simulator.acceptance.spec.ts`
- Modify: `e2e/acceptance/hdc-device-lab.acceptance.spec.ts` (if uses projectId cleanup SQL)
- Modify: `e2e/logs*.spec.ts`, `e2e/debugging*.spec.ts` as needed
- Modify: `docs/developer/browser-acceptance-coverage-map.md` (if ops change)

- [ ] **Step 1: Update debugging acceptance cleanup SQL**

Replace `where project_id = $1` teardown with `where organization_id = $1` or session-scoped deletes.

Remove `projectId` from API request bodies in specs.

Remove `?project=` from `page.goto('/node-debugging?project=…')` → `/node-debugging`.

- [ ] **Step 2: Update log acceptance specs**

Upload without projectId; list assertions org-scoped.

- [ ] **Step 3: Run targeted e2e**

```bash
npm run acceptance:browser -- --grep "debugging|logs"
```

(or project-specific acceptance command from `CONTRIBUTING.md`)

- [ ] **Step 4: Commit**

```bash
git add e2e/ docs/developer/browser-acceptance-coverage-map.md
git commit -m "test(e2e): org-scope logs and debugging acceptance"
```

---

## Task 10: Documentation + generated artifacts

**Files:**
- Modify: `docs/design-docs/domain-model.md` + Chinese companion
- Modify: `docs/design-docs/api-contract.md` + Chinese if exists
- Modify: `docs/FRONTEND.md`
- Regenerate: `docs/generated/db-schema.md`, `docs/generated/openapi.json` (if script exists)
- Modify: `docs/design-docs/2026-07-07-debug-logs-org-scope-decoupling-design.md` — status → Implemented

- [ ] **Step 1: Update domain model**

Replace "Debugging runtime records are still project-contextual" with org-scope wording. Document removed `parameter_reload_bindings`.

- [ ] **Step 2: Update API contract**

Remove `projectId` from M2/M3 endpoint tables.

- [ ] **Step 3: Update FRONTEND.md**

Document TopBar project selector scope split.

- [ ] **Step 4: Regenerate schema**

```bash
npm run docs:check
```

Fix any broken links.

- [ ] **Step 5: Commit**

```bash
git add docs/
git commit -m "docs: org-scope decoupling for logs and debugging"
```

---

## Task 11: Final verification gate

- [ ] **Step 1: Server tests**

```bash
npm run test:server
```

- [ ] **Step 2: Frontend tests + build**

```bash
npm test
npx tsc -b
npm run build
```

- [ ] **Step 3: Manual browser smoke**

Routes: `/logs`, `/log-admin`, `/node-debugging`, `/parameter-admin/projects`

Verify: TopBar project picker hidden on logs/debug; delete param project succeeds with existing log/debug seed data.

- [ ] **Step 4: Confirm delete project no longer blocked by debug FK**

With API mode + seeded aurora debug sessions, `DELETE /api/v1/parameters/admin/projects/atlas` returns 200.

---

## Documentation Impact Matrix

| Document | Action | Task |
| --- | --- | --- |
| `docs/design-docs/domain-model.md` | Update | 10 |
| `docs/zh-CN/design-docs/domain-model.md` | Update | 10 |
| `docs/design-docs/api-contract.md` | Update | 10 |
| `docs/FRONTEND.md` | Update | 10 |
| `docs/generated/db-schema.md` | Regenerate | 10 |
| `docs/generated/openapi.json` | Regenerate | 10 |
| `docs/product-specs/product-spec.md` | Review — update if mentions log/debug per-project | 10 |
| `docs/developer/browser-acceptance-coverage-map.md` | Review/update | 9 |
| `ARCHITECTURE.md` | No change | — |
| `AGENTS.md` | No change | — |
| `docs/design-docs/2026-07-07-debug-logs-org-scope-decoupling-design.md` | Mark implemented | 10 |

## Documentation Update Gate

Plan cannot move to `completed/` until:

- [ ] Every **Update** row in the matrix is edited or explicitly deferred in `tech-debt-tracker.md` with reason
- [ ] `npm run docs:check` passes
- [ ] Bilingual domain-model pair stays linked

## UI Interaction Automation Rule

| Changed behavior | Spec / requirement |
| --- | --- |
| TopBar project selector hidden on logs/debug | Update or add op in `browser-acceptance-coverage-map.md` |
| Log upload without project context | `e2e/logs*.spec.ts` |
| Node debugging without `?project=` | `e2e/acceptance/debugging-simulator.acceptance.spec.ts` |
| Delete param project with org logs/debug present | Add acceptance case or document in Task 11 Step 4 |

---

## Spec self-review (plan vs design)

| Spec requirement | Task |
| --- | --- |
| Drop project_id from log tables | 1, 2 |
| Drop project_id + FK from debug runtime/catalog | 1, 3 |
| Drop parameter_reload_bindings | 1, 3 |
| Remove requireLog/DebugProjectAccess | 2, 3 |
| Jobs/notifications org URLs | 4 |
| Agent org-scope | 5 |
| Frontend TopBar split | 7, 8 |
| related_parameter_id kept | 2, 6 |
| deleteProject unaffected by logs/debug | 1 (FK removal) + Task 11 Step 4 |
| Docs + acceptance | 9, 10 |

No placeholder gaps identified.

---

## Execution handoff

Plan saved to `docs/exec-plans/active/2026-07-07-wiseeff-debug-logs-org-scope-decoupling.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — one subagent per task (1–11), review between tasks
2. **Inline Execution** — implement tasks sequentially in this session with checkpoints

Which approach do you want?
