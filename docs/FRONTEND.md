# Frontend

> Chinese: [Chinese](zh-CN/frontend.md)

WiseEff frontend is a Vite, React, TypeScript SPA. It supports a rich mock-backed prototype plus API mode for the M0-M6.2 productized backend surface.

## Key Directories

- `src/app/`: page routing, navigation, permission checks.
- `src/domain/`: role, parameter, log, debugging, audit, and Agent domain types and pure logic.
- `src/application/ports/`: frontend-facing business interfaces.
- `src/infrastructure/mock/`: mock state and mock implementations for demos/tests.
- `src/infrastructure/http/`: API client, DTOs, auth client, runtime mode.
- `src/components/`: reusable UI, layout, tables, dialogs, filters, charts.
- `src/features/agent/`: Xiaoze CopilotKit surface (`XiaozeProvider`, `useXiaozePageContext`, `XiaozeApprovalCard`, frontend tools).
- `src/features/product-feedback/`: sidebar `FeedbackDialog` and Admin triage UI for `/feedback-admin`.
- `src/test/setup.ts`: Vitest DOM setup.

## Runtime Modes

Default mode is `api`. `npm run dev` and `npm run dev:all` inject API runtime settings; copy `.env.example` to `.env` for the same defaults when using other Vite entrypoints.

```text
VITE_WISEEFF_RUNTIME_MODE=api
VITE_WISEEFF_API_BASE_URL=http://127.0.0.1:8787
```

Use `mock` only for frontend-only demos or component tests that should not call the backend:

```text
VITE_WISEEFF_RUNTIME_MODE=mock
```

Production builds must not use mock runtime as a business data source.

M6.2 OIDC runtime support uses an async authorization provider so API clients can request the current access token and handle refresh/logout failures without static bearer injection. `VITE_WISEEFF_API_AUTHORIZATION` remains a local static-token convenience and is rejected by production builds.

When API mode starts, the app calls `/api/v1/me` before rendering the main shell. If the current token is missing or rejected, it shows the WiseEff auth screen with local account login and registration forms. Local login uses username and password. Registration collects one of the localized hardware/software department organization choices, name, a self-service platform role, username, and password. The registration role picker excludes Admin. Hardware/Software Committer requests create an inactive account with the matching base User role plus a pending Admin approval request; `/api/v1/auth/register` returns `202 pending_approval` without a session token, and the auth screen stays on a pending-approval result state without the editable registration form until an Admin approves the request from `/user-permissions`. Successful local login or non-committer registration stores the opaque `we_local_*` session token in `localStorage` under `wiseeff.localAuthToken`; the default API client prefers an OIDC runtime token when one is available and otherwise falls back to this local token. The topbar user menu opens the current-user profile dialog and logout action. Profile updates call `PATCH /api/v1/me/profile`; logout calls `POST /api/v1/auth/logout` and clears the local token.

## TopBar Project Selector

The TopBar project picker is visible only on parameter-management routes. `pageUsesProjectScope()` in `src/appConfig.ts` returns `true` for `parameters`, `parameter-submissions`, `parameter-review`, `parameter-admin`, `parameter-admin-projects`, and `parameter-home`. It is hidden on log analysis (`logs`, `log-admin`) and debugging (`node-debugging`, `debugging-admin`) routes because M2/M3 data loads from authenticated organization context without `projectId`. Parameter pages may still read `?project=` from the URL; log and debug pages ignore project query params.

`/user-permissions` uses the user-governance HTTP client in API mode for listing users, creating local-account users, activation changes, profile updates, and role replacement. The Admin Add User dialog creates an active local account in the current Admin organization with `name`, `username`, optional job title, initial password, and initial role; it no longer uses email as the account identifier. API-mode rows hydrate from `/api/v1/users`, including local usernames, before operators make changes, so UI rows use backend governed ids instead of mock ids. UI permission checks remain UX only; backend `/api/v1/users` routes enforce `users:manage`, self-lockout protection, credential hashing, and audit.

## Parameter Repository

`ParameterRepository` is the frontend port for parameter-management workflows. Page components call runtime actions from `src/application/parameters/parameterRuntime.ts`; those actions dispatch local reducer updates in `mock` mode and call a repository in `api` mode.

In `mock` mode, `src/infrastructure/mock/mockParameterRepository.ts` preserves prototype behavior for demos and component tests. It can list projects and parameters, stash drafts, submit rounds, advance reviews, and apply import previews against the in-memory mock state.

In `api` mode, `src/infrastructure/http/parameterClient.ts` maps `ParameterRepository` calls to `/api/v1` endpoints and DTO adapters. Parameter pages hydrate projects, parameters, drafts, change requests, and submission rounds from the backend, then refresh after write actions.

Page action flow:

- `/parameters` keeps the real source/effective topology workspace and the API-backed draft/submission table together. Before opening the submit preview it loads `GET /api/v1/projects/:projectId/parameter-workflow-assignees`; all three selectors fail closed when a role has no eligible candidate, and the server revalidates selected ids.
- `/parameter-review` lists pending and merged requests, advances or rejects workflow steps through `reviewChange`, and refreshes state after each server response.
- `/parameter-admin` keeps direct library editing in mock mode; in API mode, parameter writes go through import batches or review flows instead of mutating client state directly.

## DtsStructuredRepository (P3 / P3.1)

`DtsStructuredRepository` is the frontend port for structured DTS product surfaces (read, search, config sets/baselines, compare/export, structured edit submit). New P3 UI must consume this port through `resolveDtsStructuredRepository(runtimeMode)` in `src/application/parameters/dtsStructuredRuntime.ts` — mock via `createMockDtsStructuredRepository`, API via `createDtsStructuredClient`. Do not call HTTP clients directly from new panels.

`submitStructuredEdits(projectId, input)` posts structured edits to `POST /api/v1/projects/:projectId/dts-structured-edits/submit`. Each edit carries `{ fileId, nodePath, propertyName, rawText, reason? }`. The server maps edits onto `project_parameter_values` via `source_file_name` / `source_node_path`, creates drafts, and submits through the existing submission-round / change-request flow. **CR `targetValue` and CST writeback use `rawText`**, not `normalizedValue`, so hex casing and multi-group formatting survive merge writeback. Diff/compare views may still display `normalizedValue` for noise-free comparison.

Key UI:

- `StructuredValueEditor` (`src/components/parameters/StructuredValueEditor.tsx`) — type-aware editor driven by `valueType` / `rawText` from structure (u32-array, bytes, string-list, phandle-list, bool, empty, mixed). Client-side validation mirrors backend typing; authoritative values still come from review merge + CST writeback.
- `DtsStructureBrowserPanel` — browse node tree, edit properties, aggregate a local change set, and submit via `submitStructuredEdits`. Requires `parameter:edit` (`canEdit`); sensitive/critical nodes additionally require `parameter:edit-critical` (`canEditCritical`).
- `DtsSearchPanel` — project-scoped search by path / `@address` / label / compatible / value; mounts on the manage-files dialog of `/parameter-admin/projects`.
- `ConfigSetBaselinePanel` — list/create config sets and baselines, add members, compare/release/export; mounts on the config-set/baseline tab of the same dialog. Baseline compare change-set rows map to real parameters and can submit structured edits through the same port.
- `StructuredDiffView` — renders baseline compare `structuralDiff` plus optional aggregated change-set rows (node/property kinds).

## ParameterFileRepository (legacy file / conflict panels)

`ParameterFileRepository` is the frontend port for project parameter-file list/upload/version/sync and sync-conflict resolve. Admin surfaces must inject it through `resolveParameterFileRepository(runtimeMode)` in `src/application/parameters/parameterFileRuntime.ts` — mock via `createMockParameterFileRepository`, API via `createParameterFileClient`.

- `ProjectParameterFilesPanel` and `ParameterFileConflictPanel` accept a `repository` prop only; they must **not** call `createParameterFileClient()` inside the component.
- `/parameter-admin/projects` and `/parameter-admin` resolve the port once and pass it down (including mock mode demos that list teaching files / open conflicts without HTTP).

## Parameter topology ports (semantic identity)

Semantic library and project topology UI live under `src/components/parameter-topology/` and domain types under `src/domain/parameter-topology/`. Ports cover:

- Parameter specs + spec review queue (`/parameter-admin`)
- Source vs effective topology browse and search on `/parameters`
- Typed binding edit with schema diagnostics
- Binding-centric typed draft submission with project-scoped Hardware Committer, Software Committer, and Software User assignees; subsequent stages run on the real `/parameter-review` UI
- Identity mapping task resolution
- Fail-closed config revision validate/publish gate
- **Unmatched spec review:** `SpecReviewQueue` exposes create-spec for unmatched tasks (`createSpec: true` on resolve). Library resolve with a property-key mismatch requires explicit `confirmPropertyMismatch: true` before the client calls `POST .../parameter-spec-review-tasks/:taskId/resolve`.
- **Draft spec activate:** `ParameterSpecLibrary` + `DraftSpecActivatePanel` let Admins complete full inferred `valueShape` (bits/groups/cellsPerGroup/length — never collapse to kind-only or default cells=1) plus `constraints`/`documentation`, then call `POST /api/v2/parameter-specs/:specId/activate` before resolving unmatched reviews. Incomplete/conflicting shapes block activate in UI. Platform-global drafts hide the activate action for org Admins (server also returns `403`). Resolve/release reject draft specs until active+complete.
- Dashboard hotspots include global vendor specs for tenant-bound projects (API aggregates `organization_id IS NULL` specs).

API mode talks to `/api/v2` (not flat `/api/v1` parameter definition IDs). DTOs keep `exampleValue`, `schemaDefault`, `policyTarget`, and `effectiveValue` separate — no business `recommendedValue`. After cutover, legacy parameter IDs are not projected; callers must use binding/spec IDs.

On `/parameters`, API mode keeps the mature `ParametersPage`/`WorkbenchLayout` hierarchy and renders `DtsParameterWorkbench` inside `ApiProjectTopologyWorkspace`. The coordinator remains responsible for API loading while semantic rows, a collapsible **module-first navigator** (business module → parameter by default; optional device/driver tier via `groupByDevice`; default expand through level 2; a lone business wrapper root such as Power is promoted so its children become navigator roots, while an exact "Unclassified" peer root is kept), optional DTS topology tech view, current-edits tray **under the toolbar**, **read-only binding detail dialog** (View), **local draft dialog** (Edit / add-to-draft), and binding submission panel are integrated into the familiar workbench. Draft cards use arrow preview for simple values and line-level `+/-` diff plus a monospace editor for complex values; successful validate keeps in-card "Server validation passed; draft created", fills the current-edits tray, and marks the main-table row with a draft badge. The tray reuses `ParameterValueDiff`, shows each draft's business module name (not set/delete action labels), and omits the technical identity panel. Browse groups by the admin module registry (`GET /api/v2/parameter-modules`: v1 modules + DTS mappings); module CRUD stays on `/api/v1/parameter-modules`, while DTS driver/compatible/instance mappings use `/api/v2/parameter-modules/mappings`. Unmapped bindings fall back to driver-derived modules. The workbench applies a **parameter surface** filter (`isParameterSurfaceRow`) so structural DTS properties (`#address-cells`, `compatible`, bus scaffolding locators) stay out of the default list; use `includeNonSurface: true` only for tech diagnostics. Scaffolding drivers (`amba` / `gic` / `gpio` / `spmi` and provisional "Unclassified · …" buckets for them) stay out of the default ledger; WiseEff does not treat them as manageable parameters. Primary table columns are property, module, current value, importance, and actions; device/driver identity stays in the detail dialog. Importance is the primary sortable signal; healthy `valid` bindings render no governance badge (`matched`/`reviewed` storage normalizes to `valid`), and only anomalies show attention/blocked. Open identity-mapping review appears only when tasks exist (toolbar **Mapping pending N** + bottom panel); revision **Validate** lives in the toolbar, not an empty governance shell. The toolbar keeps a single semantic search (property, module, compatible/driver, address, topology path, source file/node path, and raw value); navigator selection still scopes the list. Draft checkboxes feed selective submit in the current-edits tray (empty selection submits all). Semantic CSV export is available; flat Excel export and `recommendedValue` remain forbidden in API mode.

**Project-primary writeback:** Each demo/production project owns one self-contained DTS file (`{projectId}-board.dts` in seed). Config revisions with a sole `base` member write parameter edits back into that same file text (CST span merge). There is no shared platform base DTS in the product path. See [`docs/design-docs/2026-07-21-project-primary-dts-contract-rfc.md`](design-docs/2026-07-21-project-primary-dts-contract-rfc.md).

**Toolchain tiers:** L0 (parse + occurrence writeback) is on the typed-edit hot path — binding drafts must not fail closed on `dtc`/`dtschema`. L2 toolchain validate runs on Admin validate/export/publish assist only. See [`docs/design-docs/2026-07-21-dts-parameter-surface-boundary-rfc.md`](design-docs/2026-07-21-dts-parameter-surface-boundary-rfc.md).

The API semantic list is separate from the mock-only legacy `ParametersTable`. Recommendation-drift labels, recommended-value draft initialization, flat detail/export, legacy identities, and teaching topology fallbacks are forbidden in API mode. A typed edit requires an explicit reason and preserves the returned draft/binding/spec/candidate identities plus the `set|delete` action. The submission wire item sends `draftId`, `projectParameterBindingId`, `parameterSpecId`, and `action` (never a semantic binding disguised as legacy `parameterId`) before assigned roles act in `/parameter-review`. A returned delete draft is rendered as “Delete property” with an empty tombstone target; the current workspace does not expose a delete-authoring control, so delete acceptance creates/submits through the public typed-draft/submission APIs while all role reviews and merge remain real UI operations. When the TopBar switches projects, the workspace discards the prior project's preferred candidate revision, pending draft, assignee state, publish message, and mapping message; the new project starts from `current`. Draft requests capture their owning project and are ignored if they resolve after the active project changes, so stale responses cannot repopulate the submission panel or load assignees for the wrong project.

**Shared working tip (typed draft rounds):**

- One user×project open draft round shares a single working tip.
- Each subsequent typed edit must use that tip as `baseRevisionId`; the server rebases sibling drafts onto the new tip.
- The current-edits tray healthy copy (N = draft count):

  ```text
  本轮 N 项 · 同一工作版本
  ```

  Mixed revision tips within a round are exceptional; the tray surfaces actionable remediation in Chinese when they occur.

Provenance, binding detail, and mapping/review queues must come from the API response (`sourceChain`, occurrence spans, task payloads). In API mode do **not** fall back to teaching/mock topology data when the backend is empty or errors. Validate/publish copy must match gate outcomes (`validated` vs fail-closed revoke); never treat `schema-failed` as a success path.

### Binding module identity, history, and compare (Phase 2)

Phase 2 materializes module identity on `project_parameter_bindings` and drops the derive-on-read fallback (clean cutover, no dual-read layer):

- **Persisted `module_id` (source of truth).** Every binding carries a required `module_id` referencing `parameter_modules(id)`; the browse unique key is `(project_id, logical_node_id, parameter_spec_id, module_id)` (migration `0067`). Writes (ingest / `createOrReuseBinding`) resolve the module through `resolveModuleIdForBinding` using mapping precedence instance > compatible > driver, falling back to an org unclassified module — never null. Seeds always write `module_id`, so the workbench never reads a binding without a module.
- **Workbench reads `binding.moduleId`.** The `/api/v2/projects/:projectId/parameter-bindings` DTO exposes `moduleId: string`; `buildDtsWorkbenchRows` reads `binding.moduleId` and looks up name/importance/sortOrder from the module registry (`GET /api/v2/parameter-modules`). It does **not** re-derive module assignment when the binding already has `moduleId`; `deriveModuleAssignment` is retained only for remap tooling and tests.
- **Explicit remap recompute (admin).** `POST /api/v2/parameter-modules/recompute-bindings` (optional `{ projectId }`) re-resolves `module_id` for existing bindings, returning `{ updated, conflicts }`; unique conflicts surface as `409`. `ParameterModuleMappingPanel` exposes an admin-only recompute button so mapping edits do not silently drift binding identity.
- **Real detail history + cross-project compare.** When the detail dialog opens, `ApiProjectTopologyWorkspace` loads `GET /api/v2/projects/:projectId/bindings/:bindingId/history` (revision-derived `from -> to` entries) and `GET /api/v2/projects/:projectId/bindings/:bindingId/compare` (other projects in the same org that share `parameter_spec_id` + `module_id`, excluding the source project). History comes from `project_parameter_binding_revisions` only — never the legacy flat `parameter_history_entries`. Actor/reason are not surfaced because binding revisions carry no per-revision actor or reason column. Compare peers are deduped by `projectId`. The view dialog shows a compact compare entry (coverage + **Open cross-project compare**); the mature surface (target select, text delta, `+/-` raw diff, project overview, **Add this project config to draft**) lives in a secondary `DtsBindingCompareDialog`. Draft-from-peer seeds the local draft bag and opens `DtsBindingDraftDialog`. Empty states render localized "no history" / "no cross-project comparison" copy instead of the earlier phase-1 placeholder wording.
- **Spec meaning on view.** The read-only detail dialog also loads `GET /api/v2/parameter-specs/:specId` and surfaces display name, documentation/description, illustrative `exampleValue` (never as a recommendation), units, constraints, and optional schemaDefault/policyTarget when present.

### Instance submodules and module discovery (U / N / C)

Seed and ingest build a three-tier module tree: **business leaf → driver group (Types U/N) → instance module**; Type C nodes without `compatible` nest under their parent instance. Bus/scaffolding nodes (`gic`, `gpio*`, `amba`, `i2c@*`, `spmi*`, `pmic@*`) stay out of the product module tree. Org mappings key on `compatible` (preferred) or `driver`, never unit addresses or `*_1` suffixes.

- **Placement helpers:** `src/domain/parameter-topology/modulePlacement.ts` (server mirror under `server/modules/parameter-modules/`).
- **Binding writes:** ingest uses `resolveBindingInstanceModuleId` to ensure/create instance modules and assign `module_id` to the instance (not only the driver group). Unmapped `compatible` values land in provisional `Unclassified · {driver}` modules without blocking ingest.
- **Admin discovery queue:** `/parameter-admin` → `ParameterModuleMappingPanel` loads `GET /api/v2/parameter-modules/discovery-hints` (observed compatibles from bindings) and filters against existing mappings. Admins can one-click create a driver-group child under the selected business module plus a `compatible` mapping, then recompute bindings. This queue is separate from spec-review unmatched tasks.
- **Seed recompute:** `db:seed:m1` runs `recomputeBindingModules` after semantic ingest so existing bindings pick up instance-level `module_id` when mappings change.

## Parameter Import Wizard

`ParameterImportWizard` on `/parameter-admin` supports spreadsheet / JSON / DTS fragment / full DTS sources.

- Full `.dts` / `.dtsi` (`dts-full`) must go through `ParameterRepository.parseDtsImport` → `POST /api/v1/parameter-import/parse-dts` (mock uses a CST-derived walker). **Do not** silently fall back to `parseDtsFragmentImport` for `dts-full`.
- Sources containing `/include/` fail with a readable `dts-include-unsupported` message.
- Skipped rows become optional `reviewMetadata` on `createImportPreview` / `applyImportBatch` for server audit.
- Content over 2MB shows the "will use server-side parse" hint; clients must not invent a local full-DTS pseudo-parse path.

## Hierarchical Module Trees

Parameter and debugging domains each maintain an independent org-scoped module tree. Shared picker UI lives in `src/components/common/ModuleTreeSelect.tsx` (expand/collapse, breadcrumb labels, single- and multi-select modes).

- `/parameters` — module filter and library grouping use `moduleId` with subtree include (parent selection returns descendant parameters). Deep links use `?module=<moduleId>`.
- `/parameter-admin` — `ModuleManagementDialog` supports create-child, rename, move (reparent), and delete guards; library filters and import preview use `ModuleTreeSelect`.
- `/debugging-admin` — `DebugModuleManagementDialog` governs the debug node module tree; `DebugNodeLibraryTable`, `DebugParameterLibraryTable`, and `DebugNodeEditorDialog` pick modules via `ModuleTreeSelect`.

API mode loads trees from `/api/v1/parameter-modules` and `/api/v1/debugging/admin/modules`. Mock mode derives trees from nested `parent`/`path` fields in `src/config/power-management.json` through `buildPowerManagementModuleTree()` in `src/powerManagementConfig.ts`.

Mock mode intentionally keeps the 12 legacy compatibility parameters for fast component tests and demos. In API mode, `db:seed:m1` derives an additional 228 DTS-source definitions at seed time from the committed `aurora-board.dts` template; each persisted value carries `sourceFileName=aurora-board.dts` and a property-qualified `sourceNodePath`. Regenerate the three committed Aurora/Nebula/Atlas project-primary fixtures with `npm run dts:seed:generate`, then prove them with `npm run dtc:seed:compile`.

The M1 API smoke lives in `e2e/parameter-management.api.spec.ts` and requires `DATABASE_URL` plus `db:migrate`, `db:seed:m0`, and `db:seed:m1`.

## Parameter Dashboard

`ParameterDashboardRepository` is the read-only frontend port for `/parameter-home`. It is separate from `ParameterRepository` write flows. Page code calls `createParameterDashboardRuntime()` from `src/application/parameters/parameterDashboardRuntime.ts`, which dispatches partitioned dashboard state in `src/application/parameters/dashboardState.ts`.

View-model types live in `src/domain/parameters/dashboardTypes.ts` (`DashboardSummary`, `DashboardHotspot`, `DashboardWindow`, `HotspotDimension`, `WorkbenchSignals`). The UI lives under `src/features/parameter-home/`:

- `ParameterHomePage.tsx` wires dashboard runtime/state, role-adaptive workbench, and insight sections.
- `components/SituationStrip.tsx` renders KPI cards from `summary.kpis`.
- `components/AnalysisContextControls.tsx` owns in-page time-window and hotspot-dimension toggles (not the TopBar).
- `components/InsightSection.tsx` loads trend/risk charts and the hotspot leaderboard from dashboard state.
- `workbench/derivePersonalWorkbench.ts` composes role-specific next actions from `WorkbenchSignals`, drafts, change requests, and hotspot context.

`dashboardState` keeps independent section status for `summary` and `hotspots` (`idle | loading | ready | empty | error`). `App.tsx` triggers `loadSummary` and `loadHotspots` when `/parameter-home` mounts or when `window`, `dimension`, or active project changes.

Runtime split:

- `mock` mode uses `src/infrastructure/mock/mockParameterDashboardRepository.ts`, deriving trend, risk buckets, hotspots, and workbench signals from `PrototypeState`.
- `api` mode uses `src/infrastructure/http/parameterDashboardClient.ts` against `/api/v1/parameters/dashboard/summary` and `/api/v1/parameters/dashboard/hotspots`.

Browser acceptance for the production dashboard path lives in `e2e/acceptance/parameter-home.acceptance.spec.ts` (`PARAM-HOME-001`).

## Log Analysis Repository

`LogAnalysisRepository` is the frontend port for M2 log-analysis workflows. Page components call runtime actions from `src/application/logs/logRuntime.ts`; those actions keep mock demos responsive in `mock` mode and call a repository in `api` mode.

In `mock` mode, uploads use the reducer's simulated log path: supported `.log`, `.txt`, and `.json` files become processing records that can be promoted through prototype state, while unsupported files become failed mock records. This keeps component tests and demos independent from PostgreSQL and object storage.

In `api` mode, `src/infrastructure/http/logClient.ts` maps the port to `/api/v1/log-files`, `/api/v1/logs`, `/api/v1/jobs`, archive/unarchive, rerun, and feedback endpoints. Uploads send base64 file content without `projectId` (organization inferred from auth), hydrate the created `LogRecord`, poll the job until a terminal state, then refresh the completed report and evidence. Archive and feedback actions refresh active logs afterward, so default `/logs` excludes archived records.

The M2 API smoke lives in `e2e/log-analysis.api.spec.ts` and requires `DATABASE_URL` plus `db:migrate`, `db:seed:m0`, `db:seed:m1`, and `db:seed:m2`.

## Product Feedback Repository

`ProductFeedbackRepository` is the frontend port for Internal Beta product feedback. `FeedbackDialog` submits the current page path/title, feedback type, description, and selected image files through this port. Mock mode uses `src/infrastructure/mock/mockProductFeedbackRepository.ts`; API mode uses `src/infrastructure/http/productFeedbackClient.ts`.

In API mode, submit maps to `POST /api/v1/product-feedback`, list/detail/update map to the Admin triage routes, and attachment previews use `GET /api/v1/product-feedback/:id/attachments/:attachmentId/content` to create object URLs. The HTTP client base64-encodes image files, mirrors the server attachment limits, and preserves API error envelopes through `WiseEffApiError`.

`/feedback-admin` is a utility Admin page mounted from `src/features/product-feedback/FeedbackAdminPage.tsx`. It uses the same port to filter and search feedback, inspect details in `FeedbackAdminDrawer`, view attachments, write `adminNote`, and move status through `open -> in_progress -> closed`. The route is gated by the frontend Admin role for UX, while backend routes remain the security boundary.

## Debugging Gateway

`DebuggingGateway` is the frontend port for M3 device debugging. Page components call runtime actions from `src/application/debugging/debuggingRuntime.ts`; those actions keep mock/HDC demos available outside API mode and call the HTTP gateway in API mode for HDC or ADB sessions.

Runtime split:

- `mock` mode keeps `DebuggingPage` reducer behavior for demos and component tests; the `/debugging` route is not linked in navigation.
- Local HDC helpers remain available for non-API `/node-debugging` experiments.
- `api` mode uses `src/infrastructure/http/debuggingClient.ts` for HDC/ADB devices, targets, parameters, sessions, node reads, node writes, snapshot rollback, and session events. Runtime and admin calls are organization-scoped and do not send `projectId`.

**Parameter debugging route:** `/debugging` remains product-offline (TD-032). Migration `0037` removed `parameter_reload_bindings` and reload HTTP routes. `/node-debugging` is the M3 node catalog workspace.

### Local Device Bridge (Phase A)

`/node-debugging` shows a three-step wizard (install Bridge, connect locally, plug in USB) in `src/components/LocalDeviceBridgeWizard.tsx`. The panel reads release metadata from `/api/v1/device-bridges/releases`, prefers `artifactKind: "installer"` downloads via `pickBridgeReleaseForHost()`, creates pairing codes from `/api/v1/device-bridges/pairing-codes`, and lists user-owned bridges from `/api/v1/device-bridges/mine` through `src/infrastructure/http/deviceBridgeClient.ts`.

Primary connect flow: click the connect-local-device CTA → optional first-run confirm (`wiseeff.bridgeSchemeConfirm`) → `launchBridgeConnect()` opens `wiseeff-bridge://connect?server=<origin>&code=<6-digit>` → `pollLocalBridgeHealth()` probes `http://127.0.0.1:18787/health` for up to 30s → auto-detect when `connected: true`. Helpers live in `src/infrastructure/http/bridgeConnectLauncher.ts`.

Phase B (Step 3 tools): health JSON includes `tools.adb` / `tools.hdc`. When the selected protocol tool is missing, `deriveBridgePanelStatus()` returns `tools_missing` and `LocalDeviceBridgeToolsPanel` shows an install-tools CTA via `bridgeToolInstallLauncher.ts` (`wiseeff-bridge://install-tools`, 120s poll). Detect failures mentioning missing adb/hdc map to the tools install CTA instead of the bridge-missing copy.

CLI `pair` / `start` / `connect` commands are collapsed under **Advanced · CLI**. Portable zip/tar artifacts remain under **Other platforms** when installers are the primary CTA.

The browser health probe is UI guidance only; bridge-backed device execution remains server-authorized through debugging sessions and audit.

Bridge management (rename/revoke, multi-bridge target picker) behavior is unchanged from Phase 2.

`/debugging-admin` (debug management console) uses API-backed **logical debug node** catalog management in `api` mode. It calls `src/infrastructure/http/debuggingAdminClient.ts` to list, create, update, and archive adjustable nodes (`debug_nodes`). Protocol-specific device paths live in separate **`debug_node_bindings`** rows (HDC and ADB per logical node). Legacy parameter catalog APIs remain on the server for audit/history but are no longer exposed in this Admin UI. `mock` mode keeps a slim local path for demos and component tests.

### Debugging Admin UI

Page shell lives in `src/DebuggingAdminPage.tsx`. The main surface is a full-width **node directory** table; create/edit/archive flows open modal dialogs.

- `DebugNodeLibraryTable` — toolbar search, module tree filter (`ModuleTreeSelect`), protocol coverage filters, and row actions (edit node, edit bindings, archive).
- `DebugNodeEditorDialog` — logical node metadata (name, description, sort order, enabled, module tree assignment).
- `DebugModuleManagementDialog` — nested debug node module CRUD (create-child, move, delete guards).
- `DebugNodeBindingsDialog` — per-protocol binding editor (HDC / ADB node path, access mode, enabled, notes).
- `ArchiveDebugNodeDialog` — confirm archive from a row action.

Admin saves bindings through `PUT/PATCH /api/v1/debugging/admin/nodes/:nodeId/bindings/:protocol` and can disable one protocol without affecting the other.

The **parameter debugging** route (`/debugging`) is retired from navigation and resolves to an unavailable page. Runtime catalog for `/node-debugging` comes from `GET /api/v1/debugging/nodes?protocol=...` (`listRuntimeNodes`); the API inner-joins enabled `debug_node_bindings` for the selected protocol (Option A filter). Writes use `nodeId`. Parameter reload endpoints return HTTP 410.

The runtime coordinator hydrates devices and runtime nodes after auth, detects `Aurora Simulator 1`, starts a session, dispatches node operations into operation history, and records valid write snapshots returned by the API. Snapshot rollback card hydration from `/node-debugging` writes may still lag API state (**TD-015**). Rollback remains available via API and operation history.

The M3 API smoke lives in `e2e/debugging.api.spec.ts` and requires `DATABASE_URL` plus `db:migrate`, `db:seed:m0`, `db:seed:m1`, and `db:seed:m3`. Playwright starts the backend with `DEBUG_DEVICE_GATEWAY_MODE=simulator` and the frontend with `VITE_WISEEFF_RUNTIME_MODE=api`.

## Xiaoze (sole Agent)

Xiaoze is the only Agent surface in API mode. `mock` mode mounts no Agent UI and makes no Agent HTTP calls from the frontend.

When `VITE_WISEEFF_RUNTIME_MODE=api`, the app wraps the shell in `XiaozeProvider` (`@copilotkit/react-core/v2` + `@ag-ui/client` `HttpAgent`) and streams AG-UI events from `POST /api/v1/agent/xiaoze`. `XiaozePageContextRegistrar` registers page-visible state through `useAgentContext` with description `wiseeff.page`.

P0: read-only `perception.*` tools.

P1 adds `XiaozeApprovalCard` (`useInterrupt`) for mutating `action.submitParameterChange` proposals (approve / reject / edit target value) and low-risk frontend tools (`navigateTo`, `prefillParameterValue`) via `useFrontendTool`.

P2 adds a LangGraph planning loop on the backend (intent → perceive → plan → act → observe) with checkpoint resume after approval, and opt-in proactive suggestions via `useXiaozeSuggestions` mounted in `AgentInsightBar`. When `VITE_XIAOZE_PROACTIVE_ENABLED=true` (and the API flag is on), the hook calls `POST /api/v1/agent/xiaoze/suggest` for the current page context; insight actions can open Xiaoze chat pre-seeded with the suggestion headline.

| Flag | Default | Purpose |
| --- | --- | --- |
| `VITE_XIAOZE_PROACTIVE_ENABLED` | `false` | Enables proactive read-only suggestions in `AgentInsightBar` via `useXiaozeSuggestions`. Requires API `XIAOZE_PROACTIVE_ENABLED=true`. |
| `XIAOZE_PROACTIVE_ENABLED` (API) | `false` | Registers `POST /api/v1/agent/xiaoze/suggest` for read-only proactive suggestions. |
| `XIAOZE_DETERMINISTIC` (API) | `false` | Offline deterministic model for acceptance/tests (no live LLM). |
| `XIAOZE_MODEL` (API) | falls back to `AGENT_MODEL` | Model name for LangChain `ChatOpenAI`. |
| `AGENT_API_BASE_URL`, `AGENT_MODEL`, `AGENT_API_KEY` (API) | blank locally | OpenAI-compatible LLM endpoint for live Xiaoze runs when `XIAOZE_DETERMINISTIC` is not set. |

Xiaoze acceptance specs live under `e2e/acceptance/xiaoze-*.acceptance.spec.ts` and require `DATABASE_URL` plus `db:migrate`, `db:seed:m0`, and `db:seed:m1`.

## Identity And User Governance

M6.2 moves target production identity to OIDC while preserving the existing `AuthContext` shape returned by `/api/v1/me`. API-mode clients send `Authorization: Bearer <oidc-access-token>` through `createOidcAuthProvider` or the selected runtime handoff. Local HMAC smoke tokens are acceptable only for local development and deterministic tests.

WiseEff local accounts use the same `AuthContext` shape after login. Registration creates a local account with the selected organization and an allowed self-service platform role; email verification is not supported yet. Admin cannot be selected during registration. Committer requests remain inactive and unauthenticated until an Admin approves them, at which point the backend activates the user and replaces the base role with the requested Committer role. The frontend treats permission checks as UX only, so API-mode writes still depend on backend authorization and audit.

The user-governance client maps `/api/v1/users` responses into frontend `UserAccount` records, including local usernames when present. Creating a user through `/user-permissions` posts `name`, `username`, `password`, optional `title`, and role bindings using the platform role ids: `guest`, `hardware-user`, `software-user`, `hardware-committer`, `software-committer`, and `admin`. Admin-created users are active immediately because the Admin action is already authenticated and audited; self-registered Committer users still use `/api/v1/users/registration-role-requests` and the Admin approval queue.

## M5 Pilot Gate

M5 does not add a new frontend surface yet, but it does add the release smoke that guards the backend pilot boundary. `npm run smoke:m5` checks the OpenAPI contract artifact, `/health/live`, `/health/ready`, and `/api/v1/operations/pilot-readiness`. It requires a live API base URL by default and only skips with `M5_SMOKE_ALLOW_NO_API=true` for local documentation runs. `npm run test:m5` is the intended full pilot gate when PostgreSQL and the other environment-specific checks are available, and it invokes the smoke with `--require-api` so the live API probe cannot be skipped.

## Commercial Readiness Notes

M3.5 and M5 keep the frontend architecture unchanged: pages still call `application/ports`, mock mode remains available for demos/tests, and API mode remains the production-oriented path. The backend now reflects `X-Request-Id` and propagates it into M1 parameter, M2 log, and M3 debugging audit traces, so HTTP client calls can be correlated with backend audit evidence.

Before treating API mode as a commercial pilot baseline, run `npm run test:m3-5` in an environment with `DATABASE_URL`. That command includes frontend tests, backend tests, production build, and the simulator debugging API smoke.
M5 extends that baseline with the release smoke and pilot acceptance artifact. Do not call the environment pilot-ready until `docs/generated/m5-pilot-acceptance.md` records the external checks that were actually exercised.

## Frontend Rules

- Keep business rules out of page components when they can live in `domain/` or a focused view-model file.
- Keep API DTO mapping in `infrastructure/http/`.
- Do not let UI permission checks become the security boundary; backend writes must enforce permissions.
- Preserve mock mode when adding API mode unless the task explicitly removes a prototype path.
- Prefer existing component patterns and tests before adding new primitives.

## Button And Action Styling

Buttons must look and behave like buttons. Do not rely on a bare `.button` class, raw `<button>` browser defaults, or text-only styling for actions that mutate state, submit forms, close dialogs, navigate workflows, or open menus. Use the existing button component or an established local variant; if a scoped button variant is needed, define the full visual contract in that scope:

- layout: `inline-flex`, centered content, stable `min-height`, and stable `min-width` or icon-only square dimensions;
- surface: explicit `background`, `border`, `border-radius`, text color, and disabled opacity/cursor;
- hierarchy: clear primary, secondary/subtle, destructive, or ghost treatment instead of two equal-looking text labels;
- interaction: hover and focus-visible states, with focus rings that remain visible on light and dimmed modal backdrops;
- responsive behavior: buttons must not collapse to bare text, overlap siblings, overflow their container, or change layout unexpectedly across desktop, tablet, and mobile widths.

Dialog footers, table row actions, topbar actions, card actions, and toast actions are common regression points. When changing them, add a focused DOM assertion for the intended button variant or class and run browser verification that captures the relevant state. The browser check should explicitly confirm that primary and secondary actions have visible surface styling, stable dimensions, and no horizontal overflow. Text-only actions are acceptable only for low-emphasis links or inline affordances, and should use a link/text-action class rather than masquerading as a button.

## Testing

Use targeted tests while editing:

```bash
npm test -- src/path/to/test.tsx
```

Use broader checks before finishing frontend-impacting changes:

```bash
npm test
npm run build
```

Commercial-readiness gate:

```bash
npm run test:m3-5
```

Xiaoze acceptance gate:

```bash
npm run acceptance:e2e -- e2e/acceptance/xiaoze-perception.acceptance.spec.ts
npm run acceptance:e2e -- e2e/acceptance/xiaoze-action.acceptance.spec.ts
npm run acceptance:e2e -- e2e/acceptance/xiaoze-planning.acceptance.spec.ts
```

Testing priorities:

- Role and permission visibility.
- Workbench filters, sorting, table states, and dialogs.
- Agent actions and confirmation behavior.
- Runtime mode parsing and API error mapping.
- Domain pure functions and DTO conversions.
