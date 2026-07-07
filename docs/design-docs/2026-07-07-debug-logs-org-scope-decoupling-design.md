# Debug & Log Analysis — Organization-Scope Decoupling Design

> Chinese: [Chinese](../zh-CN/superpowers/specs/2026-07-07-debug-logs-org-scope-decoupling-design.md)

**Date:** 2026-07-07  
**Status:** Implemented (Scheme A)  
**Decision:** Logs and debugging are scoped by `organization_id` only. They must not reference parameter-management `projects`.

---

## 1. Problem

Parameter-management `projects` (`server/migrations/0002_m1_parameters.sql`) is the authoritative entity for M1 workflows. Debugging and log analysis currently reuse the same `project.id` string through:

- Hard FKs on debugging runtime tables (`0005`, `0007`, `0017`)
- Nullable FKs on debugging catalog tables (`0018`, `0026`, `0028`)
- Logical `project_id` on logs without FK (`0004`)
- API query/body requirements (`projectId`)
- Shared RBAC helpers (`requireLogProjectAccess`, `requireDebugProjectAccess`)
- Frontend `activeProjectId` and cross-page `?project=` navigation

This creates inconsistent delete behavior (parameter cascade vs debugging FK block vs log orphans) and couples unrelated product workflows.

## 2. Goal (Scheme A)

1. **Debugging** and **log analysis** operate at **organization scope** only.
2. **No column** on logs/debug tables references `projects(id)`.
3. Deleting a parameter-admin project affects **only** the parameter domain.
4. Parameter definitions remain organization-level; optional soft links from logs may remain without FK.

## 3. Non-goals

- Introducing new scope entities (workspace, environment, log source) — deferred unless product later requires sub-org isolation.
- Changing parameter-management project semantics inside M1.
- Re-enabling `/debugging` parameter-reload workspace (TD-032 remains separate).
- Migrating `user_role_bindings.project_id` away from parameter RBAC (still used for param module; not for logs/debug gates).

---

## 4. Target architecture

```text
┌─────────────────────────────────────────────────────────────┐
│ organization_id (tenant boundary for ALL modules)           │
├──────────────────────┬──────────────────┬───────────────────┤
│ Parameter (M1)       │ Log analysis (M2)│ Debugging (M3)    │
│ projects ──► values  │ log_records      │ devices/sessions  │
│ parameter_definitions│ (org scoped)     │ debug_nodes       │
│ (org library)        │ no project_id    │ (org catalog)     │
└──────────────────────┴──────────────────┴───────────────────┘
         ▲                                              │
         │ optional soft ref (no FK)                    │
         └──── log_records.related_parameter_id ───────┘
               parameter_reload_bindings → REMOVE
```

### 4.1 Scope rules

| Domain | Boundary | Project selector |
| --- | --- | --- |
| Parameter management | `organization_id` + `project_id` | TopBar / URL `?project=` |
| Log analysis | `organization_id` only | Hidden on log pages |
| Debugging | `organization_id` only | Hidden on debug pages |
| Audit / Agent (logs & debug events) | `organization_id`; `project_id` null for these apps |

---

## 5. Database changes

New migration (sequential after latest): `00xx_debug_logs_org_scope_decoupling.sql`

### 5.1 Debugging runtime — drop project coupling

Remove `project_id` from (drop FK first, then column):

| Table | Current FK | Action |
| --- | --- | --- |
| `debugging_devices` | NOT NULL → projects | Drop FK + column |
| `debugging_targets` | NOT NULL → projects | Drop FK + column |
| `debugging_sessions` | NOT NULL → projects | Drop FK + column |
| `node_operations` | NOT NULL → projects | Drop FK + column |
| `debugging_snapshots` | NOT NULL → projects | Drop FK + column |
| `debugging_events` | NOT NULL → projects | Drop FK + column |
| `debug_device_leases` | NOT NULL → projects | Drop FK; PK becomes `(organization_id, device_id)` |

Replace indexes `*_project_idx` with `organization_id` (+ status/time) indexes where needed.

### 5.2 Debugging catalog — org-wide only

Remove `project_id` from:

| Table | Notes |
| --- | --- |
| `debugging_parameters` | Already nullable shared catalog; drop column + partial indexes on `project_id IS NULL` |
| `debugging_parameter_node_bindings` | Drop column |
| `debug_nodes` | Drop column |
| `debug_node_bindings` | Drop column |

**Drop table** `parameter_reload_bindings` — cross-domain FK to `parameter_definitions`; product surface already HTTP 410. Removes debug→param hard coupling.

Optional: drop `debugging_parameters.parameter_definition_id` and `node_operations.parameter_definition_id` if no runtime need (audit history may retain IDs as opaque text without FK).

### 5.3 Log analysis — org-wide only

| Table | Action |
| --- | --- |
| `log_file_objects` | Drop `project_id`; list/upload keyed by `organization_id` |
| `log_records` | Drop `project_id`; keep `related_parameter_id` as optional **text** (no FK), documented as soft link |

Child tables (`log_analysis_runs`, stages, reports, evidence, feedback) unchanged — scoped via `log_record_id`.

### 5.4 Seed / backfill

- Production: `project_id` data discarded (org scope replaces it); no mapping to param projects.
- Dev seed scripts: remove `projectId` from log/device fixtures; use `organization_id` only.

### 5.5 Parameter delete

`deleteProject()` in `server/modules/parameters/repository.ts` **unchanged scope** — only M1 tables. After this migration, debugging/logs no longer block project deletion.

---

## 6. API changes

### 6.1 Logs (`server/modules/logs/`)

| Endpoint / field | Before | After |
| --- | --- | --- |
| Upload body `projectId` | Required | **Removed** — infer org from auth |
| `GET /api/v1/logs?projectId=` | Filter + ACL | **Removed** — org list; optional filters: status, archive, q |
| `requireLogProjectAccess` | Used everywhere | **Removed** |
| `getAllowedLogProjectIds` | RBAC filter | **Removed** — use `logs:view` only |
| Response DTO `projectId` | Present | **Removed** from public DTOs |
| `relatedParameterId` | Optional | **Keep** optional soft link |

### 6.2 Debugging (`server/modules/debugging/`)

| Endpoint / field | Before | After |
| --- | --- | --- |
| `?projectId=` on runtime routes | Required / ACL | **Removed** |
| Admin catalog `?projectId=` | Filter shared vs project rows | **Removed** — org catalog only |
| `requireDebugProjectAccess` | Used | **Removed** |
| `GET /reload-targets`, reload admin APIs | 410 | **Delete** routes + repository code in same change set |
| Session create body `projectId` | Required | **Removed** |
| Response DTO `projectId` | Present | **Removed** |

### 6.3 Jobs (`server/modules/jobs/`)

- Stop joining `log_records.project_id` for ACL; use org + `logs:view` on job owner record.

### 6.4 Agent (`server/modules/agent/`)

| Tool | Change |
| --- | --- |
| `getRecentLogConclusions` | Org-scoped query; no `projectId` filter |
| `getNodeSnapshot` | Org-scoped; no project context |
| Thread context | Do not inject `projectId` for log/debug pages |

### 6.5 Notifications (`server/modules/notifications/producers.ts`)

- Log/debug notification URLs: drop `?project=` query (`/logs`, `/node-debugging` without project param).

---

## 7. Authorization

| Permission | Scope |
| --- | --- |
| `logs:view`, `logs:upload`, `logs:analyze`, … | Organization |
| `debugging:view`, `debugging:write`, … | Organization |
| `parameter:view`, `parameter:edit`, … | Organization + **project role** where applicable |

`user_role_bindings.project_id` continues to gate parameter workflows only. Admin org role (`projectId: null`) retains full org access to logs/debug.

---

## 8. Frontend changes

### 8.1 Global state

| Item | Change |
| --- | --- |
| `activeProjectId` | Used only by parameter-management routes and Agent on param pages |
| `Device.projectId`, `LogRecord.projectId` (mock) | Remove fields |
| `DELETE_PARAMETER_ADMIN_PROJECT` | No change to logs/devices in mock — aligns with API |

### 8.2 TopBar project selector

- Visible when route group ∈ `{parameters, parameter-admin, parameter-review, …}`.
- **Hidden** on `/logs`, `/log-admin`, `/node-debugging`, `/debugging-admin`.

### 8.3 Pages

| Page | Change |
| --- | --- |
| `LogsPage` | Upload without `projectId`; list all org logs (API mode) |
| `LogAdminPage` | Analytics dimensions: remove `projectId` breakdown or replace with `source` / `submittedBy` |
| `DebuggingPage` / node debugging | Session + refresh without `projectId` |
| `DebuggingAdminPage` | Catalog CRUD org-scoped |
| Cross-links | Remove `/parameters?project=&logId=` mandatory project param; use `parameterId` + `logId` only |

### 8.4 HTTP clients / ports

- `LogAnalysisRepository`, `DebuggingGateway`, `debuggingAdminClient`: remove `projectId` from methods and query strings.
- `parameterClient` unchanged.

---

## 9. Audit & observability

- New log/debug audit events: `project_id = null`, `app` ∈ `{log-analysis, debugging}`.
- Historical audit rows keep legacy `project_id` values (read-only; no FK).
- Metrics/dashboards: replace log-by-project charts with org-level KPIs.

---

## 10. Implementation phases

| Phase | Deliverable | Verification |
| --- | --- | --- |
| **P0 — Design** | This spec + domain-model update | Review approved |
| **P1 — DB** | Migration + seed updates | `npm run test:server` repository tests |
| **P2 — API** | logs + debugging + jobs + notifications | Route/service tests |
| **P3 — Frontend** | State, pages, clients, TopBar | Component tests + `playwright-cli` |
| **P4 — Agent** | Tools + thread context | Agent unit tests |
| **P5 — Docs** | domain-model, api-contract, FRONTEND, generated schema | `npm run docs:check` |
| **P6 — Acceptance** | e2e specs for logs/debug without project | `npm run acceptance:browser` |

**Branch (for implementation plan):** `feat/debug-logs-org-scope-decoupling`

---

## 11. Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| Pilot users relied on per-project log isolation | Release note: org-wide visibility; future workspace entity if needed |
| Existing URLs with `?project=` | Ignore unknown query param; no redirect required in P1 |
| `related_parameter_id` points to deleted definition | UI shows "link stale"; no FK cascade |
| Long migration on large tables | Single transaction per table; off-peak deploy |

---

## 12. Documentation Impact Matrix

| Document | Action |
| --- | --- |
| `docs/design-docs/domain-model.md` | **Update** — debug/logs org scope |
| `docs/design-docs/api-contract.md` | **Update** — remove projectId from M2/M3 |
| `docs/FRONTEND.md` | **Update** — TopBar scope split |
| `docs/generated/db-schema.md` | **Regenerate** |
| `docs/generated/openapi.json` | **Regenerate** if applicable |
| `docs/product-specs/product-spec.md` | **Review** — workflow wording |
| `docs/zh-CN/design-docs/domain-model.md` | **Update** (Chinese companion) |
| `docs/developer/browser-acceptance-coverage-map.md` | **Review** — log/debug ops |

---

## 13. Success criteria

1. `DELETE /api/v1/parameters/admin/projects/:id` succeeds even when org has logs, devices, and debug sessions.
2. No logs/debug table column references `projects(id)`.
3. Log upload and debug session APIs work without `projectId`.
4. TopBar project switch does not affect log/debug data loading.
5. All targeted tests and build pass.

---

## 14. Open follow-ups (out of scope)

- TD-032 parameter-reload workspace (separate from this decoupling).
- Optional future `workspaces` entity if sub-org isolation returns as a product requirement.
- Bulk cleanup of historical audit `project_id` on log/debug events.
