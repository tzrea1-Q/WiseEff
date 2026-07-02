# Node-Only Debugging Platform — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Active — supersedes TD-032 Phase D product direction (parameter reload + `/debugging` restore).

**Goal:** Remove all user-facing **parameter debugging** surfaces; keep **node debugging** (`/node-debugging`) as the sole runtime workspace; repurpose **调试管理后台** to govern a **node catalog** (`debug_nodes`) instead of parameter-shaped legacy rows.

**Architecture:** Hide `/debugging` and reload APIs from product UX; add a runtime `GET /api/v1/debugging/nodes` that lists enabled `debug_nodes`; migrate M3 `debugging_parameters` (+ bindings) into `debug_nodes`; reshape Admin UI by reusing the existing table/dialog shell but binding to node DTOs and dropping parameter-only fields (value kind/format, dual bindings, M1 reload).

**Tech Stack:** React/Vite frontend, Express debugging module, PostgreSQL migrations, Vitest + Playwright acceptance.

**Branch:** `feat/node-only-debugging-platform` (from latest `main`).

---

## Product Decisions (locked)

| Decision | Choice |
| --- | --- |
| Runtime catalog source | **`debug_nodes` only** — one-time migration from `debugging_parameters` |
| User-facing debugging entry | **`/node-debugging` only** |
| Parameter debugging (`/debugging`) | **Hidden** (nav removed; route → unavailable/redirect) |
| Admin route | Keep **`/debugging-admin`** path; rename labels to **调试管理后台** |
| Admin content | **Single node directory** — no Legacy tab, no reload-bindings tab |
| Admin edit fields | Node: name, description, protocol, node path, access mode, sort order, enabled, archive — **no** value kind/format/normalization, unit/range/key/module bindings sheet |
| TD-032 reload surface | **Product-offline** (endpoints may remain deprecated behind flag or 404; no UI/client calls) |

---

## Current vs Target

| Area | Current (TD-032 branch) | Target |
| --- | --- | --- |
| Nav | 参数调试 + 节点调试 + 管理后台 | 节点调试 + **调试管理后台** |
| `/debugging` | `DebuggingPage` + reload runtime | Hidden (`NoEntryPage` or redirect) |
| `/node-debugging` | Reads `GET /debugging/parameters` (legacy) | Reads `GET /debugging/nodes` |
| `/debugging-admin` | Legacy parameter table + 3 tabs | **Node table only** |
| DB runtime catalog | `debugging_parameters` + bindings | `debug_nodes` |
| `node_operations` | `parameter_id` → `debugging_parameters` | `node_id` → `debug_nodes` (new column + backfill) |

---

## Phase 1 — Product hide & rename (frontend-only, safe first ship)

### Task 1.1: Hide parameter debugging

**Files:**
- Modify: `src/appConfig.ts` — remove or disable `debugging` nav entry; keep `node-debugging`
- Modify: `src/app/routes.tsx` — `case "debugging"` → `NoEntryPage` (link to `/node-debugging`)
- Modify: `src/application/debugging/debuggingRuntime.ts` — remove `listReloadTargets` / `reloadParameter` branches from default node-debugging refresh path
- Modify: `src/App.test.tsx`, `src/appConfig.test.ts`, `e2e/quality/responsive.quality.spec.ts`

- [ ] Restore interim hide behavior for `/debugging`
- [ ] Ensure side nav no longer shows「参数调试」
- [ ] Update tests expecting「参数调试平台」on `/debugging`

### Task 1.2: Rename admin shell copy

**Files:**
- Modify: `src/appConfig.ts` — group「调试平台」; admin title **调试管理后台**; subtitle node-focused
- Modify: `src/DebuggingAdminPage.tsx` — KPI labels, headings: **可调节点** not 可调参数
- Modify: permission/tooltip copy only where it says「参数调试管理后台」

- [ ] All visible admin chrome says「调试管理后台」
- [ ] Table section title: **可调节点目录**

---

## Phase 2 — Backend: runtime nodes API + operations FK

### Task 2.1: Migration `0027_node_only_runtime.sql`

**Create:** `server/migrations/0027_node_only_runtime.sql`

- [ ] Add `node_id text references debug_nodes(id)` on `node_operations` (nullable during backfill)
- [ ] Backfill `node_id` from existing `parameter_id` + protocol → matching `debug_nodes` row (see Phase 3 seed/migration script)
- [ ] Index `node_operations(node_id, created_at desc)`
- [ ] Optional: set `session_kind` default remains `node`; document `parameter_reload` as deprecated

### Task 2.2: Runtime list nodes endpoint

**Files:**
- Modify: `server/modules/debugging/routes.ts` — `GET /api/v1/debugging/nodes` (non-admin, same auth as `listParameters`)
- Modify: `server/modules/debugging/service.ts` — `listRuntimeNodes(auth, { projectId, protocol, module?, risk? })`
- Modify: `server/modules/debugging/schemas.ts`, `server/modules/contracts/routeManifest.ts`, `schemaRegistry.ts`
- Modify: `server/modules/debugging/types.ts` — `DebugNodeRuntimeRecord` (shape for UI: id, name, description, protocol, nodePath, accessMode, sortOrder, enabled; optional risk if migrated)

- [ ] Returns enabled, non-archived `debug_nodes` for project + protocol
- [ ] Deny cross-project same as `listParameters`
- [ ] Server tests in `service.test.ts`, `routes.test.ts`

### Task 2.3: Write/read paths use `node_id`

**Files:**
- Modify: `server/modules/debugging/service.ts` — `writeNode`/`readNode` resolve catalog row from `debug_nodes` when `nodeId` provided (keep `nodePath` fallback for lab)
- Modify: `server/modules/debugging/schemas.ts` — accept `nodeId` on read/write bodies (alongside or replacing `parameterId` for runtime)
- Modify: `insertNodeOperation` — persist `node_id`

- [ ] Simulator e2e still passes with migrated ids
- [ ] Audit `targetType` → `debug-node` / `debug-node-write` consistent

### Task 2.4: Deprecate product reload endpoints

**Files:**
- Modify: `server/modules/debugging/routes.ts` — `GET /reload-targets`, `POST /parameters/reload` return 404 or `GONE` with stable error code (or feature flag `DEBUG_RELOAD_ENABLED=false`)
- Modify: `server/modules/contracts/routeManifest.ts` — mark stability `deprecated` or remove from manifest if 404

- [ ] No frontend client calls remain
- [ ] Remove/revert reload e2e test or mark skipped with ticket reference

---

## Phase 3 — Data migration: parameters → nodes

### Task 3.1: Migration script

**Create:** `scripts/migrate-debug-parameters-to-nodes.ts`

Logic per org/project:
- For each enabled `debugging_parameter_node_bindings` row → insert `debug_nodes` with:
  - `id`: `{parameter_id}:{protocol}` (stable for backfill)
  - `name`, `description`, `protocol`, `node_path`, `access_mode`, `sort_order`, `enabled` from binding + parameter
  - Drop parameter-only columns from UI; DB may keep default `value_kind='scalar'` unused
- Backfill `node_operations.node_id` = `{parameter_id}:{protocol}` where protocol matches

**Modify:** `scripts/seed-m3-debugging.ts` — seed **`debug_nodes` directly** instead of (or after) legacy parameters for new installs

- [ ] `npm run db:migrate && tsx scripts/migrate-debug-parameters-to-nodes.ts` idempotent
- [ ] Document in plan verification block

### Task 3.2: Admin API alignment

**Files:**
- Modify: `server/modules/debugging/service.ts` — admin CRUD already on `debug_nodes`; ensure list includes fields needed for table (no value metadata in response DTO if UI drops it)
- Optional: stop exposing `GET/POST /debugging/admin/parameters` in manifest (404) after frontend cutover

- [ ] Admin node CRUD remains on existing `/debugging/admin/nodes` routes

---

## Phase 4 — Admin UI: node catalog (reuse shell)

### Task 4.1: Replace library table data source

**Files:**
- Create: `src/components/admin/DebugNodeLibraryTable.tsx` (fork from `DebugParameterLibraryTable.tsx` with node columns)
- Modify: `src/DebuggingAdminPage.tsx` — remove `DebugParameterLibraryTable`, 3-tab catalog, parameter dialogs, mock JSON export footer (or keep export only in mock if still needed for demos)
- Remove usage: `CreateDebugParameterDialog`, `DebugParameterDefinitionDialog`, `DebugParameterBindingsDialog`, `DebugAdminSplitCatalog` tabs (legacy/reload)
- Reuse: `DebugNodeEditorDialog` (extend with sort order; remove any value-kind fields if present)

**Node table columns (recommended):**
| # | 节点名 | 协议 | 节点路径 | 访问 | 状态 | 操作 |

**Node editor fields:**
- name, description, protocol (immutable on edit), nodePath, accessMode, sortOrder, enabled
- **Exclude:** key, module, unit, range, current/target value, valueKind, valueFormat, normalizationMode, bindings dialog

- [ ] Single-page admin; no tabs
- [ ] Create / Edit / Archive node flows
- [ ] `debuggingAdminClient` uses `listNodes` / `createNode` / `updateNode` only

### Task 4.2: Archive flow

**Files:**
- Create or adapt: `ArchiveDebugNodeDialog.tsx` from parameter archive dialog
- Backend: add `POST /debugging/admin/nodes/:id/archive` if not present (or PATCH `archivedAt`)

- [ ] Archived nodes hidden from runtime list; visible in admin with filter

### Task 4.3: Mock mode

- [ ] Mock runtime for admin reads/writes local node draft array (mirror parameter mock pattern) OR read static fixture `debug-nodes.json`
- [ ] Document mock limitation in `docs/FRONTEND.md`

---

## Phase 5 — Node debugging runtime wiring

### Task 5.1: HTTP client

**Files:**
- Modify: `src/infrastructure/http/debuggingClient.ts` — `listNodes()` → `GET /api/v1/debugging/nodes`
- Modify: `src/infrastructure/http/debuggingDtos.ts` — `debugNodeFromDto` → maps to existing `DebugParameter` UI shape minimally (id, name, nodePath, accessMode, protocol, risk optional, currentValue from last read empty string)
- Modify: `src/application/ports/DebuggingGateway.ts`

- [ ] Remove `listReloadTargets`, `reloadParameter` from gateway used by `/node-debugging`

### Task 5.2: Runtime coordinator

**Files:**
- Modify: `src/application/debugging/debuggingRuntime.ts`
  - `refresh()` → `listNodes` not `listParameters` / reload
  - `pushValues` → always `writeNode` with `nodeId`
  - `detectAndStartSession` → `sessionKind: "node"` only

- [ ] `src/application/debugging/debuggingRuntime.test.ts` updated

### Task 5.3: Node debugging page copy

**Files:**
- Modify: `src/NodeDebuggingPage.tsx` — labels「参数」→「节点」where user-visible (sheet title, empty states)
- Keep layout/components (`ParameterRow` etc.) — internal names can stay; user copy is 节点

- [ ] No references to「参数重载」or M1 parameter library in node workspace

---

## Phase 6 — Docs, debt, acceptance

### Task 6.1: Tech debt & plan hygiene

**Files:**
- Modify: `docs/exec-plans/tech-debt-tracker.md` (+ zh-CN)
  - Reopen/adjust **TD-032** note: closed scope partially reverted; node-only supersedes reload
  - Add **TD-033** if needed: legacy `debugging_parameters` table retirement / FK cleanup
- Move: `docs/exec-plans/completed/2026-07-01-td032-parameter-debugging-reload-execution.md` → annotate **superseded by this plan**
- Modify: `docs/design-docs/domain-model.md` (+ zh-CN) — node-only catalog; deprecate reload binding section for product
- Modify: `docs/FRONTEND.md`, `docs/product-specs/prototype-functional-spec.md` (+ zh-CN product pages)

- [ ] `npm run docs:check` passes

### Task 6.2: Browser & E2E gates

**Files:**
- Modify: `e2e/acceptance/debugging-simulator.acceptance.spec.ts` — admin opens node table; create/edit node
- Modify: `e2e/debugging.api.spec.ts` — remove reload smoke; assert `GET /debugging/nodes`
- Modify: `docs/developer/browser-acceptance-coverage-map.md` if operation IDs change

- [ ] `npm run acceptance:e2e -- e2e/acceptance/debugging-simulator.acceptance.spec.ts`
- [ ] Responsive gate: `/debugging-admin` heading **调试管理后台**; `/debugging` unavailable

---

## Documentation Impact Matrix

| Doc | Action | Path |
| --- | --- | --- |
| Active plan | **Create (this file)** | `docs/exec-plans/active/2026-07-01-wiseeff-node-only-debugging-platform.md` |
| TD-032 execution | Review / supersede | `docs/exec-plans/completed/2026-07-01-td032-parameter-debugging-reload-execution.md` |
| Tech debt | Update | `docs/exec-plans/tech-debt-tracker.md`, zh-CN mirror |
| Domain model | Update | `docs/design-docs/domain-model.md`, zh-CN |
| Frontend map | Update | `docs/FRONTEND.md` |
| Product spec | Update | `docs/product-specs/prototype-functional-spec.md`, zh-CN |
| API contract | Update | `docs/design-docs/api-contract.md` — nodes runtime endpoint; deprecate reload |
| Browser coverage | Update | `docs/developer/browser-acceptance-coverage-map.md` |
| Generated OpenAPI | Review | `npm run contracts:check` after route manifest change |

## Documentation Update Gate

- [ ] All `Update` rows addressed before plan → `completed/`
- [ ] `npm run docs:check`
- [ ] Deferred legacy table drop documented as TD-033

## Git & PR Workflow

| Role | Action |
| --- | --- |
| Implementation agent | Branch `feat/node-only-debugging-platform` from `main`, implement phases, commit |
| Parent agent | Review, PR, merge, sync `main` |

## Verification Matrix

```bash
npm run db:migrate
tsx scripts/migrate-debug-parameters-to-nodes.ts   # after Phase 3
npm run test:server -- server/modules/debugging server/modules/contracts
npm test -- src/appConfig.test.ts src/App.test.tsx src/application/debugging/debuggingRuntime.test.ts
npm run build
npm run docs:check
npm run acceptance:e2e -- e2e/acceptance/debugging-simulator.acceptance.spec.ts
```

**Success criteria:**
1. Nav: only **节点调试** + **调试管理后台** under 调试平台
2. `/debugging` unavailable; `/node-debugging` works against simulator
3. Admin: node table CRUD without parameter-only fields
4. No UI calls to reload-targets or parameters/reload
5. M3 seed + migration produce identical simulator smoke behavior

---

## Out of Scope (explicit)

- Dropping `debugging_parameters` / `parameter_reload_bindings` tables (keep for audit/history; TD-033)
- Redesigning node-debugging page layout (keep existing workbench)
- Agent tools for parameter reload
- HDC device-lab acceptance changes beyond id field rename

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| `node_operations` FK break during migration | Idempotent script + backfill before enforcing NOT NULL |
| Complex value nodes (JSON/DTS) | Node-only MVP treats all as scalar path writes; complex format UI deferred |
| Mock mode admin drift | Fixture file or slim local reducer; document gap |
