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

- `/parameters` filters project parameters, opens details/history, creates local drafts, submits selected draft items, and sends assignees to the submission API.
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
