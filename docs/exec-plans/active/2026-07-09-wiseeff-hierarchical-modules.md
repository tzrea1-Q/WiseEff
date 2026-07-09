# Hierarchical Modules (多层级模块) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Prefer `superpowers:test-driven-development` for data-model, repository, and filter logic.

**Goal:** Evolve node/parameter **module** from a flat single-level string label into a **multi-level (tree) taxonomy** for both the parameter domain and the debugging domain, while preserving all current flat behavior for un-nested modules.

**Design decisions (confirmed with product owner 2026-07-09):**

1. **Separate trees per domain.** The parameter-management module tree and the debugging (node) module tree stay independent namespaces. No shared/unified tree.
2. **Entity + adjacency + materialized path.** Each module is a row with `id`, `parent_id`, and a materialized `path`. Parameters and nodes reference a module by `module_id` FK (not by name string).
3. **Attach at any level.** Parameters/nodes may attach to any module node, leaf or interior. Interior modules are both containers and attachable.
4. **Parent filter includes descendants.** Selecting a parent module in any filter/group returns the whole subtree (parent + all descendants).

**Non-goals:** unifying parameter and debug taxonomies; changing device modeling (devices remain module-less); migrating the legacy `debugging_parameters` archive table off string modules (TD-033 archive-only).

**Tech Stack:** PostgreSQL migrations (recursive/materialized-path), TypeScript API (Vitest), React + Vite ports/clients, tree-select/cascader UI, Playwright acceptance / `playwright-cli` UI verification.

---

## Current State (from codebase exploration)

Flat, string-based module modeling exists in **two independent domains**:

| Domain | Module registry | Attribution | Hierarchy today |
| --- | --- | --- | --- |
| Parameter (M1) | `project_modules` (per-project, `id`+`sort_order`, nearly read-only) + `parameterModules[]` in `src/config/power-management.json` (org/global taxonomy) | `parameter_definitions.module` is a **text string**, no FK; grouping/filter uses `=== name` | none |
| Debugging (M3/TD-032) | `debug_node_modules` (org-scoped, PK by `id`, unique `(org, name)`) | `debug_nodes.module` / `debugging_parameters.module` **text string**, no FK; REST keyed by `:moduleName` | none |
| Device | — | `debugging_devices` has **no module**; `node_path` is a device path, not a taxonomy | n/a |

Key flat-assumption hot spots (all must change):

- **Types:** `src/domain/parameters/types.ts`, `src/domain/debugging/types.ts`, `src/powerManagementConfig.ts` — `module: string`.
- **Backend DTO/Zod:** `server/modules/parameters/{types,schemas,repository}.ts`, `server/modules/debugging/{types,schemas,repository,catalogSplitRepository,service}.ts`.
- **Filter/group logic:** `Set.has(p.module)` / `includes(p.module)` / `pd.module = $n` / `GROUP BY d.module` everywhere; no ancestor/descendant matching.
- **Module CRUD:** debug admin renames by string replace (`UPDATE debug_nodes SET module = ...`); REST path `:moduleName`.
- **UI:** `MultiSelectDropdown`, `ColumnFilter`, `<select>`, `ParameterLibraryList` grouping, `ModuleManagementDialog` / `DebugModuleManagementDialog` all consume/produce flat `string[]`.
- **Deep link:** `?module=<name>` (params page) and `?module=A,B` (admin).

**Backfill principle:** every existing distinct module string becomes a **root node** (depth 1, `parent_id = null`). No parameter/node changes tier, so behavior is identical until an operator nests a module. This keeps the migration non-breaking.

---

## Target Data Model

### Parameter domain (org-scoped tree — matches the shared `parameter_definitions` library)

New table `parameter_modules` (single source of truth for the parameter taxonomy):

```sql
create table if not exists parameter_modules (
  id text primary key,
  organization_id text not null references organizations(id),
  parent_id text references parameter_modules(id) on delete restrict,
  name text not null,
  path text not null,             -- materialized path of ids, e.g. 'pm_a/pm_b/pm_c'
  depth integer not null default 1,
  sort_order integer not null default 0,
  description text not null default '',
  scope text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, parent_id, name)   -- sibling names unique
);
create index if not exists parameter_modules_org_path_idx on parameter_modules (organization_id, path);
create index if not exists parameter_modules_org_parent_idx on parameter_modules (organization_id, parent_id, sort_order);
```

- `parameter_definitions.module` (text) → add `parameter_module_id text references parameter_modules(id)`. Keep the old `module` text column during transition for rollback/analytics, but reads/writes switch to `parameter_module_id`. (Column drop deferred to a follow-up + TD entry.)
- `project_modules` decision: **keep the table**, add `parent_id`/`path`/`depth`/`parameter_module_id` and re-derive its rows from the org tree per project during seed, so `moduleCount` and project governance stay consistent. It is not the source of truth; the org `parameter_modules` tree is. (This resolves the pre-existing double-source-of-truth noted in exploration; any remaining reconciliation → TD-037 follow-up.)

### Debugging domain (org-scoped tree)

Extend existing `debug_node_modules`:

```sql
alter table debug_node_modules
  add column if not exists parent_id text references debug_node_modules(id) on delete restrict,
  add column if not exists path text not null default '',
  add column if not exists depth integer not null default 1,
  add column if not exists sort_order integer not null default 0;
-- drop old unique(organization_id, name); add sibling-unique
```

- New unique: `unique (organization_id, parent_id, name)`.
- `debug_nodes.module` (text) → add `debug_node_module_id text references debug_node_modules(id)`; reads/writes switch to id. Keep `module` text during transition.
- `debugging_parameters.module` (legacy/archive, TD-033) stays a string — out of scope.

### Path & subtree semantics (both domains)

- `path` is `parent.path || '/' || id` (root path = its own id). Depth = count of segments.
- **Subtree query (include descendants):** given selected module id `X` with path `P`, match modules where `path = P OR path LIKE P || '/%'`. Filter records via `module_id IN (subtree ids)` or `join module m on r.module_id = m.id where m.path like $prefix`.
- **Move/rename:** rename = update `name` only (path unaffected because path is id-based). Move (reparent) = recompute `path`/`depth` for the node and every descendant (recursive CTE update). Cycle prevention: reject if new parent is self or a descendant.

---

## File Map

| Path | Responsibility |
| --- | --- |
| `server/migrations/0039_parameter_modules_tree.sql` | `parameter_modules` table + `parameter_definitions.parameter_module_id` + `project_modules` tree cols + backfill roots |
| `server/migrations/0040_debug_node_modules_tree.sql` | `debug_node_modules` tree cols + `debug_nodes.debug_node_module_id` + sibling-unique + backfill |
| `server/modules/shared/moduleTree.ts` (+ test) | Reusable path/depth/subtree helpers (build path, descendants, cycle check) |
| `server/modules/parameters/{types,schemas,repository,service,routes}.ts` (+ tests) | Parameter module tree DTOs, CRUD, hierarchical list filter |
| `server/modules/debugging/{types,schemas,repository,catalogSplitRepository,service,routes}.ts` (+ tests) | Debug module tree DTOs, CRUD by id, node list module filter (subtree) |
| `server/modules/contracts/routeManifest.ts` | Register new/changed module routes |
| `src/domain/parameters/types.ts`, `src/domain/debugging/types.ts` | `moduleId` + `modulePath`/`ModuleNode` tree types |
| `src/powerManagementConfig.ts`, `src/config/power-management.json` | Hierarchical `parameterModules[]` (add `parent`/`path`) + tree derivation |
| `src/application/ports/{ParameterRepository,DebuggingGateway,...}.ts` | `moduleId?` + `includeDescendants?` query fields; module tree fetch |
| `src/infrastructure/http/{parameterClient,parameterAdminClient,debuggingAdminClient,debuggingClient}.ts` (+ tests) | Tree DTOs, id-keyed module REST, subtree query params |
| `src/infrastructure/mock/*` , `src/parameterAdminLibrary.ts`, `src/debugAdminModules.ts` | Build module tree from records instead of flat name set |
| `src/components/common/ModuleTreeSelect.tsx` (+ test) | Shared tree/cascader select + tree multi-filter |
| `src/components/ParameterLibraryList.tsx`, `src/components/admin/ParameterLibraryTable.tsx`, `src/ParametersPage.tsx` | Nested grouping + subtree filter |
| `src/components/admin/ModuleManagementDialog.tsx`, `ModuleEditDialog.tsx`, `ModuleDefinitionForm.tsx`, `CreateParameterDialog.tsx`, `ParameterDefinitionForm.tsx` | Tree CRUD (add child, move), parent picker |
| `src/components/admin/{DebugNodeLibraryTable,DebugModuleManagementDialog,DebugNodeEditorDialog,DebugParameterLibraryTable}.tsx`, `src/DebuggingAdminPage.tsx`, `src/DebugAdminSplitCatalog.tsx` | Debug tree CRUD + filter |
| `src/workbenchUi.tsx`, `src/hooks/useParamAdminSearch.ts` | Deep link `?module=<id>` (with name→id back-compat) |
| `e2e/acceptance/*.acceptance.spec.ts` | Hierarchical module acceptance |
| Docs / OpenAPI / coverage maps | Per Documentation Impact Matrix |

---

## Git & PR Workflow

| Role | Branch | Actions |
| --- | --- | --- |
| This plan (docs) | plan docs commit on `main` or a docs branch | Docs only |
| Implementation | `feat/hierarchical-modules` from latest `main` | All code + docs updates |
| Implementation subagents | Same feature branch | Commit on branch; **must not** open/merge PRs or push to `main` |
| Parent agent | — | Review, `gh pr create`, merge, sync local `main` |

Because this is a large vertical change across two domains, prefer a **PR series on the same branch**: PR-1 parameter backend, PR-2 parameter frontend, PR-3 debug backend, PR-4 debug frontend, PR-5 mock/docs/acceptance. Each PR must keep tests + build green (flat behavior preserved).

---

## Implementation Tasks

### Task 0: Branch + register plan

**Files:** this plan; `docs/PLANS.md` (+ zh-CN); `docs/exec-plans/tech-debt-tracker.md` (+ zh-CN).

- [ ] **Step 1: Branch**

```bash
git fetch origin && git checkout main && git pull origin main
git checkout -b feat/hierarchical-modules
```

- [ ] **Step 2: Link plan in `docs/PLANS.md` Current Active Plan list (mirror zh-CN):**

```markdown
- `exec-plans/active/2026-07-09-wiseeff-hierarchical-modules.md`: Multi-level module taxonomy — tree-based parameter and debugging modules (migrations 0039/0040, module_id FKs, subtree filters, tree-select UI).
```

- [ ] **Step 3: Register TD-037 in tech-debt tracker Open table (mirror zh-CN):**

```markdown
| TD-037 | Modules | Node/parameter modules are flat single-level strings. | Cannot express real product taxonomy (e.g. 电源→电池→充电); grouping/filter/governance are one level. | Implement `docs/exec-plans/active/2026-07-09-wiseeff-hierarchical-modules.md` on `feat/hierarchical-modules`. Follow-ups: drop transitional `module` text columns; reconcile `project_modules` vs org `parameter_modules` source-of-truth. |
```

- [ ] **Step 4: Commit plan registration.**

---

### Task 1: Shared module-tree helpers (TDD)

**Files:** create `server/modules/shared/moduleTree.ts` (+ `.test.ts`).

- [ ] **Step 1: Failing tests** for: `buildPath(parentPath, id)`; `depthOf(path)`; `isDescendant(candidatePath, ancestorPath)`; `subtreePrefix(path)`; `assertNoCycle(nodeId, targetParent, byId)`.
- [ ] **Step 2: Implement** pure helpers (id-based `/`-joined path; `subtreePrefix` returns `path` and `path + '/'` matchers).
- [ ] **Step 3: `npm run test:server -- server/modules/shared/moduleTree.test.ts` PASS.**
- [ ] **Step 4: Commit.**

---

### Task 2: Parameter domain migration + repository (TDD)

**Files:** `server/migrations/0039_parameter_modules_tree.sql`; `server/modules/parameters/{types,repository}.ts` (+ repository test).

- [ ] **Step 1: Failing repository tests** — `listParameterModules` returns tree rows (id/parentId/path/depth); `createParameterModule` computes path from parent; `moveParameterModule` recomputes descendant paths; `listParameters({ moduleId, includeDescendants: true })` emits a subtree filter (`pm.path like $prefix` or `parameter_module_id = any($ids)`), and `includeDescendants: false` emits exact `parameter_module_id = $n`.
- [ ] **Step 2: Write migration 0039:**
  - Create `parameter_modules` (schema above).
  - Backfill: insert one **root** module per distinct `trim(module)` found in `parameter_definitions` (and existing `project_modules.name`); set `path = id`, `depth = 1`, carry `description`/`scope` from `project_modules` where present.
  - Add `parameter_definitions.parameter_module_id`; backfill by matching `module` string → new root id (per org).
  - Add `project_modules` tree columns (`parent_id`, `path`, `depth`, `parameter_module_id`); backfill roots.
  - Keep old `module` text columns (transition). Add index for `parameter_module_id`.
- [ ] **Step 3: Implement `types.ts` DTOs** (`ParameterModuleDto { id, parentId, name, path, depth, sortOrder, description, scope }`; extend `ParameterRecordDto` with `moduleId` + `modulePath: string[]`) and repository functions (`listParameterModules`, `createParameterModule`, `updateParameterModule`, `moveParameterModule`, `deleteParameterModule`, subtree-aware `listParameters`).
- [ ] **Step 4: Tests PASS; commit.**

```bash
npm run test:server -- server/modules/parameters
```

---

### Task 3: Parameter domain API + contract

**Files:** `server/modules/parameters/{schemas,service,routes}.ts` (+ tests); `server/modules/contracts/routeManifest.ts`.

- [ ] **Step 1: Failing route/service tests** for module CRUD + hierarchical query.
- [ ] **Step 2: Schemas** — `listParametersQuerySchema` gains `moduleId?` + `includeDescendants?: boolean` (keep `module?` string as deprecated back-compat that resolves name→id, default `includeDescendants=true`). Add `createParameterModuleBodySchema` (`name`, `parentId?`, `description?`, `scope?`, `sortOrder?`), `updateParameterModuleBodySchema`, `moveParameterModuleBodySchema` (`parentId`), `parameterModuleParamsSchema` (`moduleId`).
- [ ] **Step 3: Service** — enforce org scope, sibling-name uniqueness, cycle prevention on move, and **delete guard**: reject delete when module has children or referencing parameters (409), matching debug-domain behavior.
- [ ] **Step 4: Routes** (new group):

```text
GET    /api/v1/parameter-modules            list tree
POST   /api/v1/parameter-modules            create (parentId optional)
PATCH  /api/v1/parameter-modules/:moduleId  rename/description/scope/sortOrder
POST   /api/v1/parameter-modules/:moduleId/move   reparent
DELETE /api/v1/parameter-modules/:moduleId  delete (guarded)
GET    /api/v1/parameters?moduleId=&includeDescendants=  subtree filter
```

Keep `GET /api/v1/projects/:projectId/modules` returning tree-shaped rows (backward-compatible fields plus `parentId`/`path`/`depth`).

- [ ] **Step 5: Register routes in `routeManifest.ts`; `npm run contract:check`.**
- [ ] **Step 6: Tests PASS; commit.**

---

### Task 4: Parameter frontend (types, ports, clients, tree UI)

**Files:** `src/domain/parameters/types.ts`; `src/application/ports/ParameterRepository.ts`; `src/infrastructure/http/{parameterClient,parameterAdminClient}.ts` (+ tests); `src/parameterAdminLibrary.ts`; `src/components/common/ModuleTreeSelect.tsx` (+ test); `ParametersPage.tsx`, `ParameterLibraryList.tsx`, `components/admin/ParameterLibraryTable.tsx`, `ModuleManagementDialog.tsx`, `ModuleEditDialog.tsx`, `ModuleDefinitionForm.tsx`, `CreateParameterDialog.tsx`, `ParameterDefinitionForm.tsx`; `workbenchUi.tsx`, `hooks/useParamAdminSearch.ts`.

- [ ] **Step 1: Domain + port types** — introduce `ParameterModuleNode { id, name, parentId, path, depth, children }`; `ParameterRecord` gains `moduleId: string` and `modulePath: string[]` (ancestor names for badge/breadcrumb); keep `module` as a computed leaf-name getter for minimal churn where only display is needed. `ParameterListQuery` gains `moduleId?` + `includeDescendants?`.
- [ ] **Step 2: HTTP/mock clients** — id-keyed module REST; build tree from list; `buildParameterModulesFromRecords` → `buildParameterModuleTree` (group by `moduleId`, assemble parent/child). Client query encodes `moduleId` + `includeDescendants`.
- [ ] **Step 3: `ModuleTreeSelect` component** — a reusable control with two modes: single-select (forms, with parent picker semantics) and multi-select filter with **descendant auto-include** (selecting a parent visually implies its subtree). Tests: expand/collapse, select parent selects subtree, keyboard/aria.
- [ ] **Step 4: Wire filters/grouping** — `ParametersPage` module `ColumnFilter` → tree filter (subtree include); `ParameterLibraryList` grouping → nested collapsible sections by tree; `ParameterLibraryTable` `MultiSelectDropdown` → `ModuleTreeSelect`; table badge shows `modulePath.join(' / ')` (or leaf + tooltip).
- [ ] **Step 5: Module management** — `ModuleManagementDialog` renders the tree with **add-child**, **rename**, **move (reparent)**, delete-guarded; `ModuleDefinitionForm`/`CreateParameterDialog`/`ParameterDefinitionForm` parent/module pickers use `ModuleTreeSelect`.
- [ ] **Step 6: Deep link** — `?module=<id>`; `getContextQuery` resolves legacy `?module=<name>` to id when possible; admin `useParamAdminSearch` stores `moduleId[]`.
- [ ] **Step 7: Tests + build.**

```bash
npm test -- ParametersPage ParameterLibrary ModuleManagement ModuleTreeSelect parameterClient parameterAdminLibrary
npm run build
```

- [ ] **Step 8: Commit.**

---

### Task 5: Debugging domain migration + repository (TDD)

**Files:** `server/migrations/0040_debug_node_modules_tree.sql`; `server/modules/debugging/{types,repository,catalogSplitRepository}.ts` (+ tests).

- [ ] **Step 1: Failing repository tests** — module tree CRUD by id; `moveDebugNodeModule` recomputes descendant paths; `listDebugNodes`/`listRuntimeDebugNodes` accept `moduleId` + `includeDescendants` and emit subtree filter; `deleteDebugNodeModule` guarded by children + referencing nodes (extend existing `countDebugNodesForModule`).
- [ ] **Step 2: Migration 0040** — add tree columns to `debug_node_modules`; swap unique to `(org, parent_id, name)`; backfill `path=id`, `depth=1` for existing rows; add `debug_nodes.debug_node_module_id` and backfill from `debug_nodes.module` string → module id (per org); keep `module` text (transition).
- [ ] **Step 3: Implement** DTOs (`DebugNodeModuleRecord` gains `id`/`parentId`/`path`/`depth`/`sortOrder`; `DebugNodeRecord` gains `moduleId`+`modulePath`), and repository functions in `catalogSplitRepository.ts` (replace name-keyed rename with id-based rename/move).
- [ ] **Step 4: Tests PASS; commit.**

```bash
npm run test:server -- server/modules/debugging
```

---

### Task 6: Debugging domain API + contract

**Files:** `server/modules/debugging/{schemas,service,routes}.ts` (+ tests); `routeManifest.ts`.

- [ ] **Step 1: Failing tests.**
- [ ] **Step 2: Schemas** — module admin routes keyed by `:moduleId` (not `:moduleName`); create/update/move bodies with `parentId?`; node write bodies accept `moduleId` (keep `module` name as deprecated alias resolved to id); node/param list queries gain `moduleId?` + `includeDescendants?`.
- [ ] **Step 3: Service** — create node validates module existence by id; delete module guarded; move prevents cycles; runtime node fallback default (`module: "Device Nodes"`) becomes a real seeded root module id.
- [ ] **Step 4: Routes** — migrate `/api/v1/debugging/admin/modules` group to id keys; add `.../:moduleId/move`; add `moduleId`+`includeDescendants` to `/debugging/nodes`, `/debugging/admin/nodes`, `/debugging/parameters`, `/debugging/admin/parameters`.
- [ ] **Step 5: `routeManifest.ts`; `npm run contract:check`.**
- [ ] **Step 6: Tests PASS; commit.**

---

### Task 7: Debugging frontend (tree select + filters + admin)

**Files:** `src/domain/debugging/types.ts`; `src/application/ports/DebuggingGateway.ts`; `src/infrastructure/http/{debuggingAdminClient,debuggingClient,debuggingAdminDtos,debuggingDtos}.ts` (+ tests); `src/debugAdminModules.ts`; `components/admin/{DebugNodeLibraryTable,DebugModuleManagementDialog,DebugNodeEditorDialog,DebugParameterLibraryTable}.tsx`; `DebuggingAdminPage.tsx`, `DebugAdminSplitCatalog.tsx`; optionally add module tree filter to `NodeDebuggingPage.tsx` / `DebuggingPage.tsx` (currently no module filter).

- [ ] **Step 1: Domain/port types** — `DebugNodeRegistryEntry`/`DebugParameter` gain `moduleId`+`modulePath`; `DebuggingGateway.listRuntimeNodes/listParameters` gain `moduleId?`+`includeDescendants?`; module DTOs id-keyed with tree fields.
- [ ] **Step 2: Clients** — reuse `ModuleTreeSelect`; `buildDebugModulesFromNodes` → `buildDebugModuleTree`; `adminModulePath(moduleId)` id-keyed.
- [ ] **Step 3: Admin UI** — `DebugModuleManagementDialog` tree CRUD (add child/rename/move/delete-guarded); `DebugNodeEditorDialog` module picker → `ModuleTreeSelect`; `DebugNodeLibraryTable`/`DebugParameterLibraryTable` module filter → tree filter with subtree include.
- [ ] **Step 4 (optional but recommended):** add a module tree filter to `NodeDebuggingPage` runtime list so operators can browse by subtree.
- [ ] **Step 5: Tests + build.**

```bash
npm test -- Debug DebuggingAdmin NodeDebugging debuggingAdmin
npm run build
```

- [ ] **Step 6: Commit.**

---

### Task 8: Mock config + derivation hierarchy

**Files:** `src/config/power-management.json`; `src/powerManagementConfig.ts` (+ tests); `src/mockData.ts`; mock repositories.

- [ ] **Step 1:** Extend `PowerManagementParameterModule` with optional `parent?: string` (parent module name) or `path?: string[]`; default no-parent = root (back-compat).
- [ ] **Step 2:** Update `collectParameterModules`/derivation to build a tree; `renamePowerManagementParameterModule` and add/update/delete operate on tree nodes; mock repos assign `moduleId`/`modulePath` to derived records.
- [ ] **Step 3:** Nest a representative subset in `power-management.json` (e.g. `电源 → 电池 → {估计, 健康}`, `充电 → 充电策略`) to demonstrate multi-level in mock mode.
- [ ] **Step 4:** `npm test -- powerManagementConfig mockData` + `npm run build`; commit.

---

### Task 9: Browser verification + acceptance IDs

**Files:** `e2e/acceptance/*.acceptance.spec.ts`; `docs/developer/browser-acceptance-coverage-map.md`; `docs/developer/user-operation-coverage-matrix.md` (+ requirement/operation registries as repo patterns require).

**New requirement/operation IDs:**

| ID | Behavior |
| --- | --- |
| `MOD-TREE-PARAM-001` | Admin creates nested parameter module (child under parent), assigns a parameter, and filtering by the parent returns the child's parameter (subtree include) |
| `MOD-TREE-PARAM-002` | Admin moves a parameter module to a new parent; descendants + parameters follow; cycle move rejected |
| `MOD-TREE-DEBUG-001` | Admin creates nested node module, assigns a node, and node library filter by parent returns subtree nodes |
| `MOD-TREE-AUTHZ-001` | Non-admin cannot mutate module tree; delete of non-empty module returns 409 |

- [ ] **Step 1:** Add coverage-map + matrix rows.
- [ ] **Step 2:** Automate API-level subtree create/assign/filter/move/delete-guard; UI via Playwright where stable.
- [ ] **Step 3:** Manual `playwright-cli` gate (required for UI). Verify `/parameters`, `/parameter-admin` (module management tree), `/debugging-admin` at desktop 1440×900, tablet 768×1024, mobile 390×844: create child module, move, filter subtree, tree-select expand/collapse; `snapshot` + `screenshot` + `console error`; save under `work/ui-checks/`.
- [ ] **Step 4:** Commit acceptance.

---

### Task 10: Documentation gate

**Files:** per Documentation Impact Matrix.

- [ ] **Step 1:** Update English + Chinese docs listed as Update.
- [ ] **Step 2:** Update `docs/generated/db-schema.md` for `parameter_modules` + tree columns; OpenAPI via contract check.
- [ ] **Step 3:** Run gates:

```bash
npm run docs:check
npm run contract:check
npm run test:server
npm test
npm run build
```

- [ ] **Step 4:** Record follow-ups (drop transitional `module` text columns; `project_modules` source-of-truth reconciliation) under TD-037; commit docs.

---

## Verification Matrix

| Gate | Command / evidence |
| --- | --- |
| Shared helpers | `npm run test:server -- server/modules/shared/moduleTree.test.ts` |
| Parameter server | `npm run test:server -- server/modules/parameters` |
| Debug server | `npm run test:server -- server/modules/debugging` |
| Frontend | `npm test -- ModuleTreeSelect ParameterLibrary Debug NodeDebugging powerManagementConfig` |
| Contract | `npm run contract:check` |
| Build | `npm run build` |
| Docs | `npm run docs:check` |
| Browser | `playwright-cli` 1440×900 / 768×1024 / 390×844 + acceptance IDs above |
| Migration safety | Fresh migrate + seed: existing flat modules appear as roots; no data loss; filters unchanged for un-nested modules |

## Success Criteria

1. Parameter and debug modules are independent trees; a module can have a parent and children at arbitrary depth.
2. Parameters/nodes attach to any module by `module_id`; DTOs carry `moduleId` + `modulePath`.
3. Selecting a parent in any filter/group returns the whole subtree.
4. Admin can create-child, rename, move (reparent, cycle-guarded), and delete (guarded) modules in both domains.
5. Backfill makes every existing flat module a root; pre-existing behavior is preserved for un-nested taxonomy.
6. Contract/docs/coverage maps updated; all gates green.

---

## Documentation Impact Matrix

| Area | Status | Files | Notes |
| --- | --- | --- | --- |
| Repository maps | Review | `AGENTS.md`, `docs/README.md` | Update only if module domains are enumerated |
| Planning docs | Update | `docs/PLANS.md`, `docs/zh-CN/PLANS.md`, this plan, tech-debt trackers (+ zh-CN) | TD-037 |
| Product specs | Update | `docs/product-specs/product-spec.md`, `prototype-functional-spec.md` (+ zh-CN pairs) | Multi-level module taxonomy in parameter + debugging workflows |
| Architecture docs | Update | `docs/design-docs/domain-model.md`, `docs/design-docs/api-contract.md` (+ zh-CN); Review `ARCHITECTURE.md`, `docs/design-docs/full-stack-architecture.md` | Tree entities, module_id FKs, subtree endpoints |
| Quality/testing docs | Update | `docs/developer/browser-acceptance-coverage-map.md`, `docs/developer/user-operation-coverage-matrix.md`; Review `docs/design-docs/testing-strategy.md` | New MOD-TREE-* IDs |
| Reliability/runbooks | No change | — | No new ops procedure (migration is standard) |
| Security/governance docs | Review | `docs/SECURITY.md` (+ zh-CN) | Confirm module CRUD authz/audit unchanged in scope |
| Frontend/design docs | Update | `docs/FRONTEND.md` (+ zh-CN) | `ModuleTreeSelect`, tree grouping/filter, module management |
| Generated artifacts | Update | `docs/generated/db-schema.md`; OpenAPI via contract check | New table + columns + routes |
| References | Review | `docs/references/productization-api-contract-draft.md` | Module endpoints if listed |
| Chinese developer docs | Update | Matching zh-CN pages for every English Update above | Bilingual pair rule |

## Documentation Update Gate

- Blocking: every `Update`/`Review` row addressed before moving plan to `completed/`.
- `npm run docs:check` and `npm run contract:check` must pass.
- Migration + API contract + security notes land on the same branch as the code.
- MOD-TREE acceptance IDs exist before merge.
- Deferred work (drop transitional `module` text columns; `project_modules` vs org tree source-of-truth reconciliation; hierarchical dashboard hotspot rollups) → TD-037 entries, not silent scope creep.

## UI Interaction Automation Review

Changes: module filters (flat → tree with subtree include), grouping, module management dialogs (add-child/move), form module pickers, deep-link `?module=<id>`, optional runtime node module filter.

- **Specs:** parameter + debugging acceptance specs under `e2e/acceptance/`.
- **Requirement/Operation IDs:** `MOD-TREE-PARAM-001/002`, `MOD-TREE-DEBUG-001`, `MOD-TREE-AUTHZ-001`.
- **Evidence:** acceptance run + `playwright-cli` screenshots under `work/ui-checks/` for module management + filters at three viewports; console error check clean.

## Out of Scope (do not implement in this plan)

- Unifying parameter and debug taxonomies into one shared tree.
- Adding a module to devices or `node_path`.
- Migrating legacy `debugging_parameters` archive off string module (TD-033).
- Dropping the transitional `module` text columns (follow-up after id-based reads/writes are proven in a target environment).
- Hierarchical rollups for dashboard hotspots (`GROUP BY module` stays leaf-level unless a follow-up plan adds ancestor aggregation).
- Cross-org / global module sharing.

---

**Plan status:** Active — ready for implementation on `feat/hierarchical-modules`.
