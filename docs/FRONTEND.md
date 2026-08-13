# Frontend

> Chinese: [Chinese](zh-CN/frontend.md)

WiseEff frontend is a Vite, React, TypeScript SPA. It supports a rich mock-backed prototype plus API mode for the M0-M6.2 productized backend surface.

## Key Directories

- `src/app/`: page routing, navigation, permission checks, and `appRuntime.ts` — the composition root that selects every mode-dependent adapter once (`createAppRuntime`); pages receive the record via `PageProps.runtime`.
- `src/domain/`: role, parameter, log, debugging, audit, and Agent domain types and pure logic.
- `src/application/state/`: the global prototype state machine — `AppAction`, `reducer`/`appReducer`, and reducer-only transition helpers. Import state types from here, never from `@/App` (ADR-0023).
- `src/application/ports/`: frontend-facing business interfaces.
- `src/infrastructure/mock/`: mock state and mock implementations for demos/tests.
- `src/infrastructure/http/`: API client, DTOs, auth client, runtime mode.
- `src/components/`: reusable UI, layout, tables, dialogs, filters, charts.
- `src/features/agent/`: Xiaoze CopilotKit surface (`XiaozeProvider`, `useXiaozePageContext`, `XiaozeApprovalCard`, frontend tools).
- `src/features/log-analysis/`: `LogsPage` (upload, conclusion, evidence chain, raw viewer) and `LogDashboardPage`.
- `src/features/parameter-review/`: `ParameterReviewPage`, `ParameterSubmissionsPage`, submission-history diff, and review-specific UI atoms.
- `src/features/product-feedback/`: sidebar `FeedbackDialog` and Admin triage UI for `/feedback-admin`.
- `src/features/knowledge/`: knowledge base pages for `/knowledge` and `/knowledge-admin` (list, split editor, upload, revisions).
- `src/test/setup.ts`: Vitest DOM setup.

## Runtime Modes

Default mode is `api`. `npm run dev` and `npm run dev:all` inject API runtime settings; copy `.env.example` to `.env` for the same defaults when using other Vite entrypoints.

```text
VITE_WISEEFF_RUNTIME_MODE=api
VITE_WISEEFF_API_BASE_URL=http://127.0.0.1:8787
```

The Project configuration workbench is the **canonical** project-operations experience (`/parameter-admin/projects/:projectId/configuration`). The former development flag `VITE_PROJECT_CONFIGURATION_WORKBENCH_ENABLED` is retired and ignored (#240). See `.env.example` and `docs/developer/environment-variables.md`.

Use `mock` only for frontend-only demos or component tests that should not call the backend:

```text
VITE_WISEEFF_RUNTIME_MODE=mock
```

Production builds must not use mock runtime as a business data source.

API mode never falls back to mock data. The shell boots from `createApiInitialState()` (structural fields kept, every business-data slice empty), shows a slim connecting strip until the first runtime sync completes, and when a domain refresh (parameters / logs / debugging) fails it clears that domain's slices via `CLEAR_API_RUNTIME_DOMAIN` and raises a persistent page-level cannot-connect / no-data error banner with a retry button instead of quietly keeping demo records on screen. Successful hydration also repoints `activeProjectId` at real server projects when the demo id is unknown. Mock mode behavior is unchanged.

M6.2 OIDC runtime support uses an async authorization provider so API clients can request the current access token and handle refresh/logout failures without static bearer injection. `VITE_WISEEFF_API_AUTHORIZATION` remains a local static-token convenience and is rejected by production builds.

When API mode starts, the app calls `/api/v1/me` before rendering the main shell. If the current token is missing or rejected, it shows the WiseEff auth screen with local account login and registration forms. Local login uses username and password. Registration collects one of the localized hardware/software department organization choices, name, a self-service platform role, username, and password. The registration role picker excludes Admin. Hardware/Software Committer requests create an inactive account with the matching base User role plus a pending Admin approval request; `/api/v1/auth/register` returns `202 pending_approval` without a session token, and the auth screen stays on a pending-approval result state without the editable registration form until an Admin approves the request from `/user-permissions`. Successful local login or non-committer registration stores the opaque `we_local_*` session token in `localStorage` under `wiseeff.localAuthToken`; the default API client prefers an OIDC runtime token when one is available and otherwise falls back to this local token. The topbar user menu opens the current-user profile dialog and logout action. Profile updates call `PATCH /api/v1/me/profile`; logout calls `POST /api/v1/auth/logout` and clears the local token.

The startup probe distinguishes an auth rejection from an unreachable backend so a server restart or network blip never logs everyone out. Only a `WiseEffApiError` with code `UNAUTHENTICATED` or `FORBIDDEN` clears the local token and drops to the login screen; any other failure (fetch `TypeError`, timeout, 5xx) keeps the token and enters the `unreachable` auth state, which renders a branded cannot-connect screen whose retry button re-runs the probe (`authProbeAttempt`) and resumes the session in place — no re-login. While the probe is in flight the `checking` state renders a lightweight session-restore screen instead of the interactive login form, so a refresh no longer flashes the login page. Both states reuse `.auth-panel` chrome (`.auth-status-panel`).

Notification feedback (`state.notifications`, pushed by `ADD_NOTIFICATION`) reaches the screen through one renderer: `AppToastLayer` (`src/components/common/AppToastLayer.tsx`) is a render-less bridge mounted once in the AppShell for **both runtime modes**; it drains each queue entry into the design-system `ToastProvider` (`useToast`) with a word-level tone inference (failure vocabulary → `danger`/`role="alert"`, completion vocabulary → `success`, otherwise `info`) and immediately consumes the entry via `DISMISS_NOTIFICATION`. `ToastCard` owns display: ~4s auto-dismiss, hover pause, stacking in `.toast-viewport` (the `--z-toast` layer, above dialogs and the Xiaoze popup), and a labelled manual close button. Imperative `useToast()` calls and reducer notifications therefore share one visual pipeline. This replaces the earlier mock-mode-only toast inside `LogsPage`, which left every API-mode success/failure notice invisible. Server failures surfacing through runtime notifications go through `toUserErrorMessage` (`src/infrastructure/http/userErrorMessage.ts`), which maps `WiseEffApiError.code` (and known `details.reason` values) to Chinese copy with a short request-id suffix; unknown codes keep the server text but stay reportable, and fetch-level network failures get connectivity copy.

The audit center (`/audit`) pushes its filters down to `GET /api/v1/audit-events`: text search (`q`, matching action / kind / target id / actor name server-side), a time window (today / last 7 days / last 30 days, sent as `from`), plus the existing app-group / project / severity / trace filters and cursor paging. The CSV export button exports the current filter's full result (paged fetch, 2000-row cap) as UTF-8-BOM CSV with Chinese headers. In mock mode the same filters run client-side.

## TopBar Project Selector

The TopBar project picker is visible only on everyday parameter-management routes. `pageUsesProjectScope()` in `src/appConfig.ts` returns `true` for `parameters`, `parameter-submissions`, `parameter-review`, and `parameter-home`. It is hidden on `/parameter-admin` and `/parameter-admin/projects` (organization-scoped governance and project operations own their own pickers; see ADR-0001), and on log analysis (`logs`, `log-admin`) and debugging (`node-debugging`, `debugging-admin`) routes because M2/M3 data loads from authenticated organization context without `projectId`. Parameter pages may still read `?project=` from the URL; log and debug pages ignore project query params.

### Parameter admin (governance scope)

`/parameter-admin` is a **single sidebar destination** (label: Parameter admin under the parameter-management group). Organization-scoped governance and project-scoped operations switch via peer scope tabs; `/parameter-admin` redirects to `/parameter-admin/specs` (query preserved). Organization peer routes are `/parameter-admin/specs` (parameter definition management: library + embedded spec review; nested `/parameter-admin/specs/identity-mapping` when mapping work exists) and `/parameter-admin/modules` (module management). Legacy `/parameter-admin/spec-review` and `/parameter-admin/identity-mapping` permanently redirect to the new locations with query preserved (ADR-0015). Project deep links use the canonical `/parameter-admin/projects/:projectId/configuration` workbench route; legacy `/parameter-admin/projects/:projectId/{files|config-sets|structure|conflicts}` paths redirect to equivalent workbench contexts for one compatibility release (#240). Panels consume a single `createParameterAdminApplication` facade over `ParameterTopologyRepository`, `ParameterModuleRegistryRepository`, and import actions from `parameterActions` (resolved for both mock and api modes). Admin cross-panel state lives in `ParameterAdminProvider` — not global `PrototypeState`. URL query params (`q`, `lifecycle`, `driver`, `sort`, `spec`, …) are the source of truth for filters, sort, and selection. Bulk import is a TopBar action on organization sub-routes. Spec review pages through `listSpecReviewTasks` cursor pagination; the spec library paginates client-side (50/page) and hides structural `#…` properties by default. Operation `PARAM-IDENTITY-MAP-ADMIN-001` tracks admin-side identity mapping coverage (browser acceptance retarget in #198).

The project-list entry opens `/parameter-admin/projects/:projectId/configuration` (label: Configuration workbench). This Phase 1 route is a full-screen, source-dominant workbench: Config-set and file query state select the Working configuration, member/ungrouped identity and active source come through the existing `DtsStructuredRepository` and `ParameterFileRepository` ports in both runtimes. Source-located navigation (#229) nests the structural node tree under the selected member, scrolls/highlights CST spans via `ProjectPrimaryDtsViewer`, runs unified search (file-grouped, omit-`by` = all dimensions) across Config-set members, and restores `configSet`/`file`/`node`/`property`/`sourceMode` deep links; tree metadata and source load/retry stay independent. Keyboard helpers use Alt+F / Alt+N / Alt+G / Alt+1 / Alt+2 (and `/` when not typing) so browser/system shortcuts are not overridden. Context inspection (#230) opens leveled inspector content for Config set / file / node / property with back navigation that preserves source selection; file inspection lists immutable versions (origin, creator/time) and downloads through `ParameterFileRepository`; canvas modes `working` / `history` / `unified-diff` / `side-by-side` / `candidate` stay read-only and restore the prior Working target/scroll on exit (`structured`/`raw` remain Working aliases). Candidate upload (#231) enables the Upload candidate control, creates a staged candidate via `ParameterFileRepository.createCandidate` without changing the active version or Config set membership, shows impact evidence (text/structural diff, diagnostics, coverage/mapping, conflicts, blockers) in candidate source mode and the inspector, supports blocked/stale recompute and abandon for ready/blocked/failed/stale, and keeps Working / file-version / candidate / release-baseline identities independently labeled. Candidate activation (#232) adds an impact-confirmation dialog and `ParameterFileRepository.activateCandidate` with expected-current-version CAS; new-file activation requires an explicit Config set member role; stale base preserves Working configuration and requires recompute; blocked/failed/abandoned/stale are never activatable; success refreshes files/members/source without a full-page reset. Structured edit sessions (#233) open `StructuredValueEditor` in the property inspector (`canEdit` / `canEditCritical`), accumulate session drafts in the task dock with subset validate/submit through `submitStructuredEdits` / `aggregateLocalStructuredEdits`, share property identity across tree and source-gutter markers, and keep the source canvas read-only (whole-file replacement remains the Candidate path). Recoverable session drafts (#234) persist patches and reason locally (never full DTS source) under a user/org/project/config/file/base scope: navigation or refresh restores when the base matches; a changed base keeps drafts inspectable/copyable but blocks validate/submit until reconfirm; leaving with dirty drafts uses ConfirmDialog; logout clears via `clearSessionDraftsForLogout`. Missing edit capability locks writes with product language while read context stays visible. File and Config set operations (#236) let Admins create/configure Config sets with validation and duplicate-name handling, add/remove members with role and sortOrder through ConfirmDialog blast-radius confirmation, keep ungrouped files visibly outside Working/Release until assigned, run manual sync via `ParameterFileRepository.syncFile` with task-dock evidence, and export the selected Config set via `DtsStructuredRepository.exportConfigSet` from the command context; empty Config sets present a focused Candidate upload/assignment path that does not auto-activate, and `canAdmin=false` denies mutations while keeping read context. Conflict arbitration (#235) opens a source-located three-way Conflicts dock from the task bar: base / file-or-candidate / pending UI draft with provenance and readable version labels; equal-weight "Use file value" and "Keep UI value" outcomes confirm via ConfirmDialog with an optional audit reason; the queue advances in source context; eligible bulk resolve requires an impact preview first; an empty queue keeps the dock collapsed without a dedicated empty page; open conflicts continue to block Candidate activation. Release readiness (#237) loads one server-owned `getReleaseReadiness` result into the command-bar summary and Issues task dock (ordered blockers/warnings with locators and remediation); create/release require a matching `gateToken` and stay fail-closed when blocked, unavailable, stale, or when local session drafts are dirty; the UI never reconstructs release permission from unrelated client counts. Release baselines (#238) surface draft/released/historical identities with pinned members in the inspector dock (`WorkbenchBaselineDock`), compare against Working or the released tip in unified/side-by-side source modes (restoring the prior Working position on exit), require warning acknowledgement plus impact ConfirmDialog for release (demotes prior tip to historical, refreshes drift/readiness), and restore via preview blast radius + atomic rollback that leaves the released tip unchanged. The inspector overlays by default and becomes persistent only when measured workbench width leaves the source canvas ≥640px (PCW-D15). Activity (#239 / PCW-D11) adds a command-bar Activity entry that opens an activity inspector over scoped `listAuditEvents` projections (parameter apps + current project); events use product language for actor/action/target/outcome/time, restore targetable Config set/file/candidate/node/property context when possible, and keep missing targets as readable evidence. Legacy `/files` `/config-sets` `/structure` `/conflicts` deep links redirect to equivalent workbench contexts for one compatibility release; `ProjectOperationsDialog` and the four-view page-shaped panels are removed (#240).

**Project tab chrome:** the configuration workbench owns project deep views; legacy four-view dialog chrome is removed. Empty queues use `ParamAdminEmptyState` (`.param-admin-empty`) with a short status line, optional guidance, and an optional next-step action. Scope navigation (`.parameter-admin-scope-nav`) is visually heavier than organization sub-nav (`.parameter-admin-subnav`) so containment is readable: scope uses larger, solid-primary active pills with soft shadow; sub-nav keeps smaller outlined pills for every peer (not only the active one) so inactive destinations still read as switchable. The projects list page keeps a single authoritative heading (the project inventory title); the TopBar subtitle mirrors the list or workbench name instead of repeating the scope label. Project rows expose governance signals (open conflict count and released-baseline presence) from `GET /api/v1/parameters/admin/projects`. Unified search lives inside the configuration workbench source tree.

**Project operations are a deep-linked dialog over the list (ADR-0001).** `ProjectOperationsDialog` presents the four views over the project inventory while the URL stays at `/parameter-admin/projects/:projectId/:view`. It uses the shared `ModalDialog` contract (portal, focus trap, background `inert`, top-most Escape, paired backdrop dismissal). Chrome is one authoritative `<h2>` (the project name), the shared view navigation (`.project-operations-nav`, `aria-current="page"` with left/right/Home/End roving focus), the latest **audit-center projection** (`recentAuditEvents` from `listAuditEvents`, refreshed after admin mutations — not a local `PUSH_AUDIT_HINT`), and a labelled body region. The card has a fixed height (`min(88vh, 920px)`) with only the body scrolling; at ≤768px it becomes a full-viewport sheet. Every panel keeps one heading level (`<h3>`). Visited views stay mounted so filters, selected nodes, and unsubmitted structure drafts survive view switches; closing the dialog (or Escape) with unsubmitted drafts asks for confirmation first. An unknown project id renders a not-found screen on the list page instead of titling the dialog with the raw id. Search hits in `DtsSearchPanel` navigate to the structure view and select that node, and say so when the node lives in another file.

**Shared dialog contract.** Dialogs use `ModalDialog` (`src/components/common/ModalDialog.tsx`), which portals into `document.body` and owns `role="dialog"` + `aria-modal` on the card, generated `aria-labelledby` / `aria-describedby` ids, initial focus, a Tab focus trap, focus restore to the trigger, `inert` on the app root, top-most-only Escape, and paired pointer-down/pointer-up backdrop dismissal so a text selection that ends outside the card does not close it. `ConfirmDialog` builds on it for irreversible governance actions (baseline release/rollback, config-set member removal, conflict arbitration) and supports an acknowledgement checkbox for gates that report `requiresConfirmation` plus an optional reason captured into the audit hint. Because the portal moves the card out of `.param-admin-shell`, param-admin dialog styling is scoped to the backdrop class as well (`.param-admin-modal-backdrop .button`, `… .dialog-actions`); `ModalDialog.styles.test.ts` guards that pairing. Overlay stacking comes from one declared scale in `:root` (`--z-xiaoze-fab: 1100`, `--z-modal-backdrop: 1150`, `--z-modal-backdrop-nested: 1160`, `--z-xiaoze-popup: 1200`, `--z-xiaoze-approval: 1250`, `--z-toast: 1350`) — do not add ad-hoc z-index numbers. The Xiaoze approval card portals to `<body>`, so it must outrank the chat popup: `XiaozeApprovalCardContent` applies `--z-xiaoze-approval` to both its overlay and content through the opt-in `overlayClassName` prop on `AlertDialogContent` (other `AlertDialog` consumers keep the default `z-50`), and `XiaozePopupView` exempts pointer-down and scrim clicks that land inside `[data-slot="alert-dialog-content"]` / `[data-slot="alert-dialog-overlay"]` so approving does not close the chat and strand the pending interrupt.

**Spec library governance (`/parameter-admin/specs`):** `OrganizationSpecGovernancePanel` hosts `ParameterSpecLibrary` plus embedded `SpecReviewQueue`. The library toolbar **New definition** action opens `SpecCreateDialog` (subjects from `GET /api/v2/parameter-modules` driver-group / node-type rows with `attributionSubjectId`; create body covers `propertyKey` + `reason` plus optional `displayName` / `description` / `documentation` / `valueShape` / `constraints` / `units` / `exampleValue` / `overridePlatform`; optional compatible for post-create activate with `coverageClaim` of kind `overlay-property` only) and calls `POST /api/v2/parameter-specs`. **Soft deprecate / restore** use reason-gated dialogs in `ParameterSpecDetailDialog` (`POST .../deprecate`, `POST .../restore`); create / activate / deprecate / restore / cutover-finalize success paths show a short fixed-position toast (`logs-feedback-toast`). The spec library **defaults to hiding `deprecated`** definitions (lifecycle filter can include them); review binding pickers allow `active` and org-owned activatable `draft` only. Library **parameter definition** column shows `property_key` only; **driver module** column prefers observed attribution taxonomy paths, otherwise the attribution subject displayName (API `driverModule`, display-only) with not-yet-observed, or unclassified. `driverModule` is not write identity and `?driverModule=` is removed; filter via `attributionSubjectId` / attribution module columns. Detail keeps separate property key / driver module (subject or path display) / attribution module (path). **Driver registry / module governance** surfaces read-only `driverNature` and `instanceCardinality` on driver-group rows (from `GET .../driver-registry`). Dedicated `ParameterAdminAuditBanner` is removed — panels push compact hints via `ParameterAdminProvider` (`PUSH_AUDIT_HINT`); project operations may still show the latest hint inline. **Identity mapping** (`/parameter-admin/specs/identity-mapping`) composes `IdentityMappingReview` with `taskKind` badges (`identity-ambiguity` vs `singleton-cardinality`). For ambiguity tasks, Admins can **confirm mapping** (`resolved`), **declare new identity** (`new-identity`; multi-candidate requires `confirmAllCandidates`), or **dismiss** (`dismissed`). For `singleton-cardinality` tasks the panel shows registration/topology remediation guidance only — no identity resolve controls (API returns `409 singleton-cardinality-conflict`). Workbench surfaces publish blockers only; full disposition stays in this admin route.

`/user-permissions` uses the user-governance HTTP client in API mode for listing users, creating local-account users, activation changes, profile updates, and role replacement. The Admin Add User dialog creates an active local account in the current Admin organization with `name`, `username`, optional job title, initial password, and initial role; it no longer uses email as the account identifier. API-mode rows hydrate from `/api/v1/users`, including local usernames, before operators make changes, so UI rows use backend governed ids instead of mock ids. UI permission checks remain UX only; backend `/api/v1/users` routes enforce `users:manage`, self-lockout protection, credential hashing, and audit.

## Parameter Repository

`ParameterRepository` is the frontend port for parameter-management workflows. Page components call runtime actions from `src/application/parameters/parameterRuntime.ts`; those actions dispatch local reducer updates in `mock` mode and call a repository in `api` mode.

In `mock` mode, `src/infrastructure/mock/mockParameterRepository.ts` preserves prototype behavior for demos and component tests. It can list projects and parameters, stash drafts, submit rounds, advance reviews, and apply import previews against the in-memory mock state.

In `api` mode, `src/infrastructure/http/parameterClient.ts` maps `ParameterRepository` calls to `/api/v1` endpoints and DTO adapters. Parameter pages hydrate projects, parameters, drafts, change requests, and submission rounds from the backend, then refresh after write actions.

Page action flow:

- `/parameters` keeps the real source/effective topology workspace and the API-backed draft/submission table together. Before opening the submit preview it loads `GET /api/v1/projects/:projectId/parameter-workflow-assignees`; all three selectors fail closed when a role has no eligible candidate, and the server revalidates selected ids.
- `/parameter-review` lists pending and merged requests, advances or rejects workflow steps through `reviewChange`, and refreshes state after each server response.
- `/parameter-admin` is the only sidebar entry for parameter admin. Organization peers live under `/parameter-admin/{specs|spec-review|modules|identity-mapping}`; project file/config-set routes live under `/parameter-admin/projects`.

## DtsStructuredRepository (P3 / P3.1)

`DtsStructuredRepository` is the frontend port for structured DTS product surfaces (read, search, config sets/members/baselines, compare/export, structured edit submit). New P3 UI must consume this port through `resolveDtsStructuredRepository(runtimeMode)` in `src/application/parameters/dtsStructuredRuntime.ts` — mock via `createMockDtsStructuredRepository`, API via `createDtsStructuredClient`. `listConfigSetFiles` maps to `GET /api/v1/projects/:projectId/config-sets/:configSetId/files` and returns scoped member role, sort order, format, and active version identity. Do not call HTTP clients directly from new panels.

`submitStructuredEdits(projectId, input)` posts structured edits to `POST /api/v1/projects/:projectId/dts-structured-edits/submit`. Each edit carries `{ fileId, nodePath, propertyName, rawText, reason? }`. The server maps edits onto `project_parameter_values` via `source_file_name` / `source_node_path`, creates drafts, and submits through the existing submission-round / change-request flow. **CR `targetValue` and CST writeback use `rawText`**, not `normalizedValue`, so hex casing and multi-group formatting survive merge writeback. Diff/compare views may still display `normalizedValue` for noise-free comparison. Shared acceptance/CI keeps flat identity (`WISEEFF_SEED_LEGACY_FLAT_IDENTITY=1`, `WISEEFF_LOCAL_POST_CUTOVER=0`) so `PROJ-CONFIG-EDIT-001` / `PARAM-DTS-EDIT-002` can prove live submit; local post-cutover DBs retire that table and need a cutover-aware structured-edit adapter (out of workbench #233 scope).

Key UI:

- `StructuredValueEditor` (`src/components/parameters/StructuredValueEditor.tsx`) — type-aware editor driven by `valueType` / `rawText` from structure (u32-array, bytes, string-list, phandle-list, bool, empty, mixed). Client-side validation mirrors backend typing; authoritative values still come from review merge + CST writeback.
- `DtsStructureBrowserPanel` — browse node tree, edit properties, aggregate a local change set, and submit via `submitStructuredEdits`. Requires `parameter:edit` (`canEdit`); sensitive/critical nodes additionally require `parameter:edit-critical` (`canEditCritical`). Permission states are stated once in product language above a locked editor — never as a permission slug — and safety-critical nodes carry a warning treatment matched to the risk of the write. The panel takes an explicit `fileId` / `versionId` / `fileName`; with none it shows an empty state naming the next action instead of loading a fixture. `onDirtyChange` reports unsubmitted drafts so the page can guard navigation, and `focusRequest` selects the node a search hit asked for.
- `DtsSearchPanel` — project-scoped search by path / `@address` / label / compatible / value; mounts below the parameter-file list on `/parameter-admin/projects/:projectId/files` (tree browse/edit stays on the structure tab).
- `ConfigSetBaselinePanel` — list/create config sets and baselines, add members, compare/release/export; mounts on `/parameter-admin/projects/:projectId/config-sets`. Baseline compare change-set rows map to real parameters and can submit structured edits through the same port. Member roles and baseline statuses render as display labels, every mutating action has a pending/disabled state, empty name input reports a visible validation message, and release/rollback/member removal go through `ConfirmDialog`. Revision validation is offered only when the caller supplies a real `revisionId`; there is no teaching fallback, so no fixture id can reach an audit record.
- `StructuredDiffView` — renders baseline compare `structuralDiff` plus optional aggregated change-set rows (node/property kinds).

## ParameterFileRepository (legacy file / conflict panels)

`ParameterFileRepository` is the frontend port for project parameter-file list/upload/version/sync and sync-conflict resolve. Admin surfaces must inject it through `resolveParameterFileRepository(runtimeMode)` in `src/application/parameters/parameterFileRuntime.ts` — mock via `createMockParameterFileRepository`, API via `createParameterFileClient`.

## AuditQuery (workbench Activity)

`AuditQuery` is the read-side port for listing audit events (Activity timelines and similar projections). It is distinct from write-only `AuditSink`. Resolve it with `resolveAuditQuery(runtimeMode)` in `src/application/parameters/auditQueryRuntime.ts` — mock returns an empty listing adapter (no HTTP); API wraps `createAuditClient`. The project configuration workbench must receive `listAuditEvents` by injection from that resolver (or a test double) and must **not** call `createAuditClient()` inside the page module.

## Workbench sessions (project configuration)

Domain acts for the configuration workbench live as Workbench sessions under `src/application/project-configuration/` (see `CONTEXT.md`):

| Session | Owns |
| --- | --- |
| `StructuredEditSession` | Local draft hydrate/persist, validate/submit, stale-base recovery |
| `CandidateVersionFlow` | Candidate create/load/recompute/abandon/activate (+ File→base64) |
| `ReleaseBaselineSession` | Readiness refresh/ack, baseline create/compare/release/restore (+ gate tokens) |
| `ConflictLocateFacade` | Open-conflict load, locate projection, open-arbitration refresh |
| `ConfigSetOpsSession` | Config-set create / add-remove member / export / manual sync (+ narrow port Picks) |
| `WorkbenchNavigationSession` | URL/selection sync, structure target, unified search (+ hits) |
| `WorkbenchWorkspaceLoadSession` | Config sets / project files / members / active source / structure loads + retries |
| `WorkbenchCanvasHistorySession` | History / unified-diff / side-by-side source load + working-canvas snapshot restore |
| `WorkbenchActivitySession` | Activity timeline load/refresh + missing-notice; event→navigate stays shell+Navigation |

React hooks (`useStructuredEditSession`, `useCandidateVersionFlow`, `useReleaseBaselineSession`, `useConflictLocateFacade`, `useConfigSetOpsSession`, `useWorkbenchNavigationSession`, `useWorkbenchWorkspaceLoadSession`, `useWorkbenchCanvasHistorySession`, `useWorkbenchActivitySession`) are thin `useSyncExternalStore` adapters. Prefer unit-testing the session command interfaces. The shell (`ProjectConfigurationWorkbench`) keeps ConfirmDialog ownership, cross-session bridges, and presentation-adapter wiring (`WorkbenchCommandBar`, `WorkbenchInspectorPanel`, `WorkbenchSourceTree`, `WorkbenchSourceCanvas`, `WorkbenchTaskDock`); navigation/load/canvas/activity lifecycle state machines live in the sessions above (wave-3 / #258).

- `ProjectParameterFilesPanel` and `ParameterFileConflictPanel` accept a `repository` prop only; they must **not** call `createParameterFileClient()` inside the component.
- `/parameter-admin/projects` and `/parameter-admin` resolve the port once and pass it down (including mock mode demos that list fixture files / open conflicts without HTTP).
- `ParameterFileConflictPanel` gives both arbitration sides equal emphasis, shows each conflict's provenance (time, source file version), counts the open queue in its heading, and confirms the chosen side through `ConfirmDialog` with an optional reason recorded in the audit hint.
- `ProjectParameterFilesPanel` version history shows version number, current-version marker, origin label, timestamp, author, size, and a per-version download. Rollback-to-version and resolving `createdByUserId` to a display name are tracked as TD-056.

## Parameter topology ports (semantic identity)

Semantic library and project topology UI live under `src/components/parameter-topology/` and domain types under `src/domain/parameter-topology/`. Ports cover:

- Parameter specs + spec review queue (`/parameter-admin`)
- Source vs effective topology browse and search on `/parameters`
- **Node enablement:** topology tree rows show enabled/disabled badges and unreachable markers (blocking ancestor); workbench parameter rows under a disabled node show a no-effect notice; node detail opens `DtsNodeEnablementDialog` for three-state enablement edits (shared draft round with binding edits)
- Typed binding edit with schema diagnostics
- Binding-centric typed draft submission with project-scoped Hardware Committer, Software Committer, and Software User assignees; subsequent stages run on the real `/parameter-review` UI
- Identity mapping task resolution
- Fail-closed config revision validate/publish gate
- **Unmatched spec review:** `SpecReviewQueue` exposes create-spec for unmatched tasks (`createSpec: true` on resolve). Library resolve with a property-key mismatch requires explicit `confirmPropertyMismatch: true` before the client calls `POST .../parameter-spec-review-tasks/:taskId/resolve`.
- **Draft spec activate:** `ParameterSpecLibrary` + `DraftSpecActivatePanel` let Admins complete full inferred `valueShape` (bits/groups/cellsPerGroup/length — never collapse to kind-only or default cells=1) plus `constraints`/`documentation`, then call `POST /api/v2/parameter-specs/:specId/activate` before resolving unmatched reviews. Incomplete/conflicting shapes block activate in UI. Platform-global drafts hide the activate action for org Admins (server also returns `403`). Resolve/release reject draft specs until active+complete.
- Dashboard hotspots include global vendor specs for tenant-bound projects (API aggregates `organization_id IS NULL` specs).

API mode talks to `/api/v2` (not flat `/api/v1` parameter definition IDs). DTOs keep `exampleValue`, `schemaDefault`, `policyTarget`, and `effectiveValue` separate — no business `recommendedValue`. After cutover, legacy parameter IDs are not projected; callers must use binding/spec IDs. Local `npm run dev` / `dev:all` defaults to a **post-cutover** semantic seed so typed binding drafts can be submitted for review without a maintenance-window cutover on the developer database.

On `/parameters`, API mode keeps the mature `ParametersPage`/`WorkbenchLayout` hierarchy and renders `DtsParameterWorkbench` inside `ApiProjectTopologyWorkspace`. The coordinator remains responsible for API loading while semantic rows, a collapsible **module-first navigator** (business module → parameter by default; **device instance tier via `groupByDevice`** — enabled in production so per-instance browsing reaches `hl7603@77` without per-instance registry rows; default expand through level 2; a lone business wrapper root such as Power is promoted so its children become navigator roots, while an exact "Unclassified" peer root is kept), optional **tech view** that replaces the results pane with read-only project-primary DTS while the module navigator stays, current-edits tray **under the toolbar**, **read-only binding detail dialog** (View), **local draft dialog** (Edit / add-to-draft), and binding submission panel are integrated into the familiar workbench. Draft cards use arrow preview for simple values and line-level `+/-` diff plus a monospace editor for complex values; successful validate keeps in-card "Server validation passed; draft created", fills the current-edits tray, and marks the main-table row with a draft badge. The tray reuses `ParameterValueDiff`, shows each draft's business module name (not set/delete action labels), and omits the technical identity panel. Browse groups by the admin module registry (`GET /api/v2/parameter-modules`: v1 modules + DTS mappings); module CRUD stays on `/api/v1/parameter-modules`, while DTS driver/compatible/instance mappings use `/api/v2/parameter-modules/mappings`. Unmapped bindings fall back to driver-derived modules. The workbench applies a **parameter surface** filter (`isParameterSurfaceRow`) so structural DTS properties (`#address-cells`, `compatible`, bus scaffolding locators) stay out of the default list; use `includeNonSurface: true` only for tech diagnostics. Missing topology locators fail closed (excluded). DTS root `board_id` is a managed surface row under `Board Identity` / `board` — ingest and seed never materialize a product module named `/` under Unclassified. Scaffolding drivers (`amba` / `gic` / `gpio` / `spmi` and provisional "Unclassified · …" buckets for them) stay out of the default ledger; WiseEff does not treat them as manageable parameters. Primary table columns are property, module, current value, importance, and actions; device/driver identity stays in the detail dialog. Importance is the primary sortable signal; healthy `valid` bindings render no governance badge (`matched`/`reviewed` storage normalizes to `valid`), and only anomalies show attention/blocked. Open identity-mapping tasks still block validate/publish through publish blockers only; the workbench no longer renders a mapping review panel — Admins resolve tasks in `/parameter-admin`. There is **no** dedicated toolbar revision **Validate** action (L2 remains Admin/export assist only). The toolbar keeps a single semantic search (property, module, compatible/driver, address, topology path, source file/node path, and raw value); navigator selection still scopes the list. Draft checkboxes feed selective submit in the current-edits tray with WYSIWYG semantics: drafts start fully checked, the submit scope is exactly the checked set (an empty selection submits nothing), the submit button shows a live count of the checked drafts, and same-tip node-enablement drafts that ride along with a checked binding are annotated on their tray item. Tray removal deletes the server-side draft (`DELETE /api/v1/parameter-drafts/:draftId`) and refreshes the draft list, so removed drafts cannot resurrect after a reload or ride into the next submit; failures render inline in the tray. A successful submit clears the consumed drafts, selection, and preferred candidate revision, reloads drafts/topology, and leaves a dismissible success notice with the review-queue entry, so a consumed draftId can never be resubmitted. Semantic CSV export is available; flat Excel export and `recommendedValue` remain forbidden in API mode.

**Project-primary writeback:** Each demo/production project owns one self-contained DTS file (`{projectId}-board.dts` in seed). Config revisions with a sole `base` member write parameter edits back into that same file text (CST span merge). There is no shared platform base DTS in the product path. See [`docs/design-docs/2026-07-21-project-primary-dts-contract-rfc.md`](design-docs/2026-07-21-project-primary-dts-contract-rfc.md).

**Toolchain tiers:** L0 (parse + occurrence writeback) is on the typed-edit **and merge/writeback** hot path — binding drafts and semantic merges must not fail closed on `dtc`/`dtschema`. L2 toolchain validate runs on Admin validate/export/publish assist only. The workbench does **not** surface `dtc` / `ranges_format` compile diagnostics in default governance. Committed seed board DTS files are the product source of truth; `npm run dtc:seed:compile` is CI/tooling evidence, not a prerequisite for everyday parameter maintenance correctness. See [`docs/design-docs/2026-07-21-dts-parameter-surface-boundary-rfc.md`](design-docs/2026-07-21-dts-parameter-surface-boundary-rfc.md).

**Workbench attention:** Module-navigator "Pending" counts and row badges use `governanceState`. `attention` can still flag bindings tied to open identity-mapping tasks, but resolution UI lives only in `/parameter-admin`; the workbench surfaces publish blockers instead of an inline review panel. `blocked` is for `schemaState=invalid` or `policyState=fail`. Provisional-surface `schemaState=unreviewed` (typical after overlay-only ingest without `compatible`) does not elevate to attention — Admin SpecReviewQueue owns that backlog.
The API semantic list is separate from the mock-only legacy `ParametersTable`. Recommendation-drift labels, recommended-value draft initialization, flat detail/export, legacy identities, and teaching topology fallbacks are forbidden in API mode. A typed edit requires an explicit reason and preserves the returned draft/binding/spec/candidate identities plus the `set|delete` action. The submission wire item sends `draftId`, `projectParameterBindingId`, `parameterSpecId`, and `action` (never a semantic binding disguised as legacy `parameterId`) before assigned roles act in `/parameter-review`. A returned delete draft is rendered as “Delete property” with an empty tombstone target; the current workspace does not expose a delete-authoring control, so delete acceptance creates/submits through the public typed-draft/submission APIs while all role reviews and merge remain real UI operations. When the TopBar switches projects, the workspace discards the prior project's preferred candidate revision, pending draft, assignee state, publish message, and mapping message; the new project starts from `current`. Draft requests capture their owning project and are ignored if they resolve after the active project changes, so stale responses cannot repopulate the submission panel or load assignees for the wrong project.

**Shared working tip (typed draft rounds):**

- One user×project open draft round shares a single working tip.
- Each subsequent typed edit must use that tip as `baseRevisionId`; the server rebases sibling drafts onto the new tip.
- The current-edits tray healthy copy (N = draft count):

  ```text
  本轮 N 项
  ```

  Mixed revision tips within a round are exceptional; the tray surfaces actionable remediation in Chinese when they occur.

Provenance, binding detail, and mapping/review queues must come from the API response (`sourceChain`, occurrence spans, task payloads). In API mode do **not** fall back to teaching/mock topology data when the backend is empty or errors. Validate/publish copy must match gate outcomes (`validated` vs fail-closed revoke); never treat `schema-failed` as a success path.

### Binding module identity, history, and compare (Phase 2)

Phase 2 materializes module identity on `project_parameter_bindings` and drops the derive-on-read fallback (clean cutover, no dual-read layer):

- **Persisted `module_id` (source of truth).** Every binding carries a required `module_id` referencing `parameter_modules(id)`; the browse unique key is `(project_id, logical_node_id, parameter_spec_id, module_id)` (migration `0067`). Writes (ingest / `createOrReuseBinding`) resolve the module through `resolveModuleForBinding` using **compatible → node-type → unclassified root** — never null. `module_id` must point at a driver group, node-type unit, or org unclassified root; device instance identity is `logical_node_id` only (ADR-0010). Seeds always write `module_id`, so the workbench never reads a binding without a module.
- **Workbench reads `binding.moduleId`.** The `/api/v2/projects/:projectId/parameter-bindings` DTO exposes `moduleId: string`; `buildDtsWorkbenchRows` reads `binding.moduleId` and looks up name/importance/sortOrder from the module registry (`GET /api/v2/parameter-modules`). It does **not** re-derive module assignment when the binding already has `moduleId`; `deriveModuleAssignment` is retained only for remap tooling (not spec-library display).
- **Explicit remap recompute (admin, ops).** `POST /api/v2/parameter-modules/recompute-bindings` (optional `{ projectId, dryRun }`) re-resolves `module_id` for existing bindings. `dryRun: true` previews without writes. The panel exposes this as a full-org backfill for historical drift, seed repair, or post–identity-continuity alignment; day-to-day classify and driver register/claim already scoped-apply bindings and do not need full recompute.
- **Real detail history + cross-project compare.** When the detail dialog opens, `ApiProjectTopologyWorkspace` loads `GET /api/v2/projects/:projectId/bindings/:bindingId/history` (revision-derived `from -> to` entries) and `GET /api/v2/projects/:projectId/bindings/:bindingId/compare` (other projects in the same org that share `parameter_spec_id` + `module_id`, excluding the source project). History comes from `project_parameter_binding_revisions` only — never the legacy flat `parameter_history_entries`. The history API collapses adjacent config-revision tip snapshots whose raw value did not change (storage still keeps one tip per config revision); the initial tip is retained with `fromRawValue: null`. Actor/reason are not surfaced because binding revisions carry no per-revision actor or reason column. Compare peers are deduped by `projectId`. The view dialog shows a compact compare entry (coverage + **Open cross-project compare**); the mature surface (target select, text delta, `+/-` raw diff, project overview, **Add this project config to draft**) lives in a secondary `DtsBindingCompareDialog`. Draft-from-peer seeds the local draft bag and opens `DtsBindingDraftDialog`. Empty states render localized "no history" / "no cross-project comparison" copy instead of the earlier phase-1 placeholder wording.
- **Spec meaning on view.** The definition editor loads `GET /api/v2/parameter-specs/:specId` and surfaces display name, documentation/description, illustrative `exampleValue` (never as a recommendation), units, constraints, and optional `schemaDefault` when present. `policyTarget` is not edited on the definition dialog (SE-D1 / TD-055); GET may still return it from `parameter_policy_targets` when a product-scoped row exists.

### Module attribution admin (`/parameter-admin/modules`, tab **Module attribution**)

`OrganizationModuleGovernancePanel` composes `ParameterModuleMappingPanel`, which in turn wires `ModuleAttributionTree` as the default surface, plus `ClassifyCompatibleDialog` when classifying. Seed and ingest build a **taxonomy tree**: **business category → {driver group | node-type unit} → nested node-type\***; bus/scaffolding nodes stay out of the product tree. Org mappings match on `compatible` or `node-type` only (no `driver` or `instance` match kind — ADR-0010).

- **Placement helpers:** `src/domain/parameter-topology/modulePlacement.ts` (server mirror under `server/modules/parameter-modules/`).
- **Binding writes:** ingest uses `ensureAttributionModuleForBinding` + `resolveModuleForBinding` to assign `module_id`. Compatible evidence resolves to a driver group; driverless config nodes resolve to node-type units (bare node name). Unmapped compatibles and unplaceable node types surface in the unclassified queue; bindings with no match park on the unclassified root module.
- **Unclassified queue (secondary):** when discovery returns pending compatibles, a modules sub-nav exposes **Attribution tree** / **Unregistered drivers** (`/parameter-admin/modules/queue`) with a count badge and a banner CTA on the tree view. When the queue is empty, the sub-nav is omitted entirely (no single-tab switcher). The queue is the gap between observed and registered compatibles (ADR-0007). Classify opens `ClassifyCompatibleDialog`; **Claim** opens the register dialog prefilled for that compatible. Classify calls `POST /api/v2/parameter-modules/mappings/preview`, then applies scoped `POST /api/v2/parameter-modules/mappings` on confirm. Legacy `/parameter-admin/modules/registry` bookmarks redirect to the tree.
- **Driver coverage on the tree:** There is no separate registry route. `GET /api/v2/parameter-modules/driver-registry` still feeds parse/observed coverage into the attribution tree: driver-group rows show a coverage chip (official / organization-tier / platform-tier / superseded-by-higher-priority / partial `N/M` / uncovered), a default-off **only uncovered parse** filter finds incomplete groups, and `ModuleEditDialog` shows per-compatible coverage beside each rule. For Admin driver-groups, the dialog exposes editable `driverNature` / `instanceCardinality` selects (orthogonal to taxonomy `node-type`; save calls `PATCH /api/v2/parameter-modules/driver-registry/:moduleId` after the module update), edits the registration **default business category** (`PATCH .../driver-registry/:moduleId/default-business-category`), and offers **replay from registration** (`POST .../replay-placement`): auto placements follow the default; curated stay frozen. Uncovered rules expose **configure organization-tier parse**, which closes the module editor and opens `OrganizationDriverSchemaDialog`; **Add parameter definition** opens a nested `OverlaySpecPickerDialog` embedding the definition-library table (search + column filters), with optional create form. Saving activates `/api/v2/organization-driver-schemas`. Authoring is refused when an active platform overlay already covers the compatible. Register/claim remains `POST /api/v2/parameter-modules/driver-registry` (tree create with kind `driver-group`, or queue claim) and persists the chosen business category as the registration default. Curated driver groups and node-type units with zero bindings show **not yet observed**; a default-off filter can hide them.
- **Platform console (`/platform-console`):** Visible only to `platform-admin`. Lists cross-organization promotion candidates, shows contributor shape diffs for ineligible rows, and runs promote/revert with an explicit cross-tenant blast-radius confirmation (`platform:schema-promote`).
- **Pre-upload create (unified):** Attribution tree **New module** opens `ModuleCreateDialog` with a kind picker (`business` / `driver-group` / `node-type`). Parent options are filtered by kind rules (business under null/business; driver-group and node-type under business; node-type may nest under node-type). Driver-group create requires ≥1 exact compatible and calls `registerOrClaimDriver`; other kinds use `POST /api/v1/parameter-modules` with `origin=curated`. Optional `sourceKey` may be set for node-type (`nodetype:{name}`).
- Kind-scoped tree: `ModuleAttributionTree` shows kind badges (`business` / `driver-group` / `node-type` / `unclassified`), **spec count** (distinct specs) and **observed binding count** as separate rollups, driver-group parse-coverage chips, and business-only importance (`effectiveImportance` from registry). Sibling move-up / move-down swaps `sortOrder` among peers via `PATCH /api/v1/parameter-modules`; disabled menu items show inline reasons when already first/last or when server kind guards block move/add/delete. Actions follow server kind guards (node-type may move/reclassify; driver-group delete = disband; unclassified root read-only; add-child on business and driver-group). Edit dialog allows controlled reclassify among `{business, node-type}` (ADR-0010). Driver-group rows show a read-only `N compatible rule(s)` summary plus coverage chip; the matching rules (and per-compatible coverage) are edited inside `ModuleEditDialog` (add/remove), not inline on the tree. **Overlay deprecate** loads `GET .../deprecation-impact` in `ModuleEditDialog` before `POST .../deprecate`, surfacing coverage loss, definition/project counts, and optional successor source; explicit confirmation when coverage would be lost. Classifying a queue compatible creates a **driver-group** (not a business category) under the chosen parent, with `source_key = compatible:{normalized}`; match values strip DTS surrounding quotes so `"mt,mt5788"` and `mt,mt5788` are the same lever.
- **Spec library column:** `OrganizationSpecGovernancePanel` and `ParameterSpecLibrary` render the **attribution module** from `GET /api/v2/parameter-specs` `attributionModules` (stated fact from bindings — no predictive suffix). Registered-but-not-yet-observed driver groups show a **not yet observed** marker; genuinely unattributed specs show **unclassified**.
- **Upload driver summary:** DTS file upload responses may include `driverSummary` (`matchedRegistered` / `newUnregistered`) comparing file compatibles to registered mappings. `ProjectParameterFilesPanel` opens `DriverUploadSummaryDialog` after a successful upload.
- **Ops recompute:** admin-only full `recompute-bindings` (optional `dryRun`) remains an ops/backfill tool. Mapping create/delete and `POST .../driver-registry` (register/claim) each apply scoped `planScopedMoves` in the same write transaction. `db:seed:m1` may still run `recomputeBindingModules` after ingest.

## Project parameter initialization

New projects are created with `initialization_status = not_initialized`. Creators use `ProjectParameterInitializationWizard` to take a one-time **semantic binding** snapshot (or explicit empty library), then submit an initialization review. Admin approve/reject lives on `/parameter-review` (initialization tab).

- **Port:** `ParameterInitializationRepository` (`src/application/ports/ParameterInitializationRepository.ts`).
- **API mode:** HTTP client + hydrate of `projectInitializationStatuses` on project switch; submit/approve/reject call the Port (not reducer-as-SSOT).
- **Mock mode:** mock adapter implements the same Port honestly; legacy wizard reducer paths remain for component tests.
- **Lock:** `ParametersPage` disables normal typed edits while status ≠ `initialized` (and ≠ `maintenance`); API `submitParameterChanges` also fail-closes via `assertProjectAllowsParameterSubmit`.
- Design: [`docs/design-docs/2026-05-20-project-parameter-initialization-design.md`](design-docs/2026-05-20-project-parameter-initialization-design.md). Acceptance: `PARAM-INIT-*`.

## Parameter Import Wizard

`ParameterImportWizard` on `/parameter-admin` supports spreadsheet / JSON / DTS fragment / full DTS sources.

- Full `.dts` / `.dtsi` (`dts-full`) must go through `ParameterRepository.parseDtsImport` → `POST /api/v1/parameter-import/parse-dts` (mock uses a CST-derived walker). **Do not** silently fall back to `parseDtsFragmentImport` for `dts-full`.
- Sources containing `/include/` fail with a readable `dts-include-unsupported` message.
- Skipped rows become optional `reviewMetadata` on `createImportPreview` / `applyImportBatch` for server audit.
- Content over 2MB shows the "will use server-side parse" hint; clients must not invent a local full-DTS pseudo-parse path.

## Hierarchical Module Trees

Parameter and debugging domains each maintain an independent org-scoped module tree. Shared picker UI lives in `src/components/common/ModuleTreeSelect.tsx` (expand/collapse, breadcrumb labels, single- and multi-select modes).

- `/parameters` — module filter and library grouping use `moduleId` with subtree include (parent selection returns descendant parameters). Deep links use `?module=<moduleId>`.
- `/parameter-admin/modules` — `ModuleAttributionTree` governs business / driver-group / node-type attribution; **New module** uses `ModuleCreateDialog` with a kind picker (parent filter, required driver-group compatibles, optional `sourceKey` for node-type); edit uses `ModuleEditDialog` (name, controlled kind reclassify among `{business, node-type}`, importance for business categories, description, scope), with move/delete guards. Library filters and import preview use `ModuleTreeSelect`.
- `/debugging-admin` — scope peers (same chrome as parameter-admin organization/projects): **Parameter debugging** at `/debugging-admin` hosts reload-configuration admin; **Node debugging** at `/debugging-admin/nodes` hosts the logical debug-node catalog. `DebugModuleManagementDialog` governs the debug node module tree; `DebugNodeLibraryTable`, `DebugParameterLibraryTable`, and `DebugNodeEditorDialog` pick modules via `ModuleTreeSelect`.

API mode loads trees from `/api/v1/parameter-modules` and `/api/v1/debugging/admin/modules`. Mock mode derives trees from nested `parent`/`path` fields in `src/config/power-management.json` through `buildPowerManagementModuleTree()` in `src/powerManagementConfig.ts`.

Mock mode intentionally keeps the 12 legacy compatibility parameters for fast component tests and demos. In API mode, `db:seed:m1` derives an additional 228 DTS-source definitions at seed time from the committed `aurora-board.dts` template; each persisted value carries `sourceFileName=aurora-board.dts` and a property-qualified `sourceNodePath`. Regenerate the three committed Aurora/Nebula/Atlas project-primary fixtures with `npm run dts:seed:generate`. Optional: `npm run dtc:seed:compile` proves seed boards against the pinned toolchain in CI — it is not required for product correctness narrative (seed boards are SoT).

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

In `api` mode, `src/infrastructure/http/logClient.ts` maps the port to `/api/v1/log-files`, `/api/v1/logs`, `/api/v1/jobs`, archive/unarchive, rerun, feedback, and `/api/v1/log-domains` endpoints. Uploads send base64 file content without `projectId` (organization inferred from auth), hydrate the created `LogRecord`, poll the job until a terminal state, then refresh the completed report and evidence. Archive and feedback actions refresh active logs afterward, so default `/logs` excludes archived records.

Job polling uses adaptive backoff instead of a fixed 1s interval: 1s for 30 attempts, then 2s for 45, then 5s, capped at ~5 minutes of scheduled polling (aligned to the p95 ≤ 3 min analysis SLO plus headroom). The per-log generation guard still discards stale poll results when a newer upload or rerun supersedes the same log.

Log-domain UI (P1):

- The upload dialog shows an optional log-domain selector. API mode fetches active domains through `logActions.listLogDomains()`; the default stays the uncategorized domain (generic analysis) and domain selection never blocks an upload. Mock mode keeps its static seeds and shows only the default option.
- `LogConclusionCard` (and the `/log-admin` `LogRecordDrawer`) render analyzer provenance from the additive `analysisSource` / `degradedReason` fields: a prominent amber degraded badge with the reason for `rules-fallback` reports (rules-fallback wording) and for P2 early-converged agent conclusions (`analysisSource: "agent"` + `degradedReason` set → early-convergence wording), a subtle agent badge for full agent reports, and a domain chip when the record is bound to a domain. Records without a source (legacy rule reports) render no badge; a degraded analysis never renders as a full one.
- `/log-admin` gains a log-domain governance section (list, create/edit form with format-profile JSON validation, archive) gated by the frontend `logs.admin-domains` action (Admin); backend routes enforce the real `logs:admin-domains` permission.
- P2: each active domain row offers a knowledge-entries editor that links **published** knowledge-base entries to the domain (`DomainKnowledgeLinksEditor` in `LogAdminPage.tsx`). The selector lists published entries from the knowledge repository with a title filter; stale links whose entry is no longer published are flagged and dropped from the replace-set save. The link set bounds the analysis agent's `read_domain_knowledge` retrieval (organization-generic fallback when empty). API-mode only, like the rest of domain governance.

Log-analysis quality & annotation intake (P3):

- `/log-admin` has a read-only analysis-quality section (`FeedbackQualityInsightsSection` in `LogAdminPage.tsx`): a DataTable of `GET /api/v1/logs/feedback-insights` rows (helpful rate per log domain × analysis source × prompt version) that follows the page's shared TimeWindow and refreshes after drawer feedback. The empty state honestly says no feedback exists yet; mock mode shows an API-mode hint like domain governance.
- `LogRecordDrawer` offers an export-eval-case-draft action on completed records: `buildEvalCaseDraft` (`src/domain/logs/evalCaseDraft.ts`) assembles a golden-set `case.yaml` draft (realLog: true, **deIdentified: false**, rootCauseCategory TODO, evidence lines / root-cause points / actions prefilled) plus `log.txt`, downloaded client-side as two files. The dialog shows the README de-identification checklist and states that a human must de-identify and flip `deIdentified` to true before the case may enter `eval-cases/logs` — deliberately no auto-commit or repository write.
- The upload dialog states archive support in API mode (`.gz` single file, single-entry `.zip`; server-side unpack) and its pre-check accepts those names; the server stays the authority on format failures.

The `/logs` analysis-quality feedback dialog persists through this port in API mode: it calls `submitFeedback` (`POST /api/v1/logs/:id/feedback`) with the rating mapped high to `helpful` / other to `not_helpful` and the issue text as `note`, shows pending/inline-error states, and closes only after the server accepts (mock mode keeps the local notification). `/log-admin` gains an archived-logs view backed by `refresh({ includeArchived: true })` with a per-row restore (unarchive) action, making archiving reversible at any time; the post-archive undo toast window is 10s.

Result webhooks & per-domain model override (P3b):

- Each active domain row offers a result-webhook editor (`DomainWebhookEditor` in `LogAdminPage.tsx`): https-only URL, write-only signing secret (the UI shows only configured-state + last four; empty input keeps the stored secret), enable toggle, an audited test-delivery button, and a recent-deliveries list rendering one honest row per attempt (time, result/test kind, attempt number, delivered/retrying/failed, HTTP status or error). Saves go through `PUT /api/v1/log-domains/:domainId/webhook`; SSRF-rejected URLs surface a readable inline error.
- The domain form gains a model-override field (placeholder states that blank means the global model) persisted via the domain PATCH (`modelOverride`; blank clears back to the global model — endpoint/key/budget stay global). The domain table shows model and webhook state columns. API-mode only, like the rest of domain governance.

The M2 API smoke lives in `e2e/log-analysis.api.spec.ts` and requires `DATABASE_URL` plus `db:migrate`, `db:seed:m0`, `db:seed:m1`, and `db:seed:m2`.

## Product Feedback Repository

`ProductFeedbackRepository` is the frontend port for Internal Beta product feedback. `FeedbackDialog` submits the current page path/title, feedback type, description, and selected image files through this port. Mock mode uses `src/infrastructure/mock/mockProductFeedbackRepository.ts`; API mode uses `src/infrastructure/http/productFeedbackClient.ts`.

In API mode, submit maps to `POST /api/v1/product-feedback`, list/detail/update map to the Admin triage routes, and attachment previews use `GET /api/v1/product-feedback/:id/attachments/:attachmentId/content` to create object URLs. The HTTP client base64-encodes image files, mirrors the server attachment limits, and preserves API error envelopes through `WiseEffApiError`.

`/feedback-admin` is a utility Admin page mounted from `src/features/product-feedback/FeedbackAdminPage.tsx`. It uses the same port to filter and search feedback, inspect details in `FeedbackAdminDrawer`, view attachments, write `adminNote`, and move status through `open -> in_progress -> closed`. The route is gated by the frontend Admin role for UX, while backend routes remain the security boundary.

## Knowledge Repository

`KnowledgeRepository` (`src/application/ports/KnowledgeRepository.ts`) is the frontend port for the knowledge base workflow. Mock mode uses `src/infrastructure/mock/mockKnowledgeRepository.ts` with fixtures covering draft/published/archived entries and a failed-extraction file (same port shape, ADR-0002 parity); API mode uses `src/infrastructure/http/knowledgeClient.ts` against `/api/v1/knowledge/*`. Stale saves surface as `KnowledgeRevisionConflictError` (mapped from the structured `409`), which the editor renders as a readable reload-and-retry conflict instead of overwriting.

- `/knowledge` (`src/features/knowledge/KnowledgePage.tsx`, its own knowledge sidebar group) lists entries with shared `ColumnFilter` status/tag column filters, searches published entries only through the search endpoint (results state the honest retrieval mode: semantic+FTS vs FTS-only), creates markdown entries in a split edit/preview editor (`renderMarkdownPreview` in `src/domain/knowledge/markdown.ts` escapes input before rendering), uploads file entries with a visible extraction status badge, and offers revision history with restore-as-new-revision. In API mode it adds the ask-the-knowledge-base button, which dispatches the Xiaoze open handoff — mock mode has no Agent UI so the entry is hidden. `?entryId=…` deep links (used by Xiaoze citations) open the entry detail directly.
- `/knowledge-admin` (`KnowledgeAdminPage.tsx`): the agent-draft publish queue (Phase 3) — `list({ status: "draft", sourceType: "agent" })` rows with creator, session origin, source-analysis deep link (`/logs?logId=…`), and created time; per-row review (`/knowledge?entryId=…`), publish, and archive-reject behind a `ConfirmDialog` (`rejectAgentDraft`) — plus archived-entry management (restore), manage-gated hard delete behind an acknowledged `ConfirmDialog`, and the retrieval index health section — honest retrieval-mode banner (pgvector/embedding availability), per-entry index status with failure reasons, per-entry retry, and rebuild-all.
- Distil-to-knowledge (Phase 3): the log-analysis result page (`src/features/log-analysis/LogsPage.tsx`) shows a distil-to-knowledge action on completed analyses when the user holds `knowledge:edit`; it calls `KnowledgeRepository.distillFromLog(logId)` and hands off into the `/knowledge?entryId=…` draft detail for review and publish. Mock mode builds the same pre-filled draft from the prototype log record via `src/domain/knowledge/distill.ts` (same port shape); the server-side prefill couples only to the stored analysis-record DTO.
- Related knowledge on log results: completed analyses render a related-knowledge section (`src/features/log-analysis/RelatedKnowledgeSection.tsx`) for `knowledge:view` holders. It calls `KnowledgeRepository.relatedToLog(logId)` (API mode: `GET /api/v1/knowledge/related-to-log`; mock mode: bigram-overlap scoring over published fixtures — same published-only cutoff semantics), lists related published entries as `/knowledge?entryId=…` deep links, states the honest retrieval mode, and shows loading/error states plus an honest no-related-knowledge empty state.
- Capability wiring: `App.tsx` builds a `KnowledgeCapability` (`userId`, `canView`, `canEdit`, `canManage`) from `/api/v1/me` permissions in API mode (`knowledge:view` / `knowledge:edit` / `knowledge:manage`) or role checks in mock mode (`canView` is the member default there). UI gating is UX only; backend routes remain the security boundary. Pure lifecycle/visibility rules live in `src/domain/knowledge/rules.ts`.
- Xiaoze answers render source citations (`XiaozeCitationSources` in `src/features/agent/`) under the assistant markdown: the turn-reply custom event and persisted thread messages carry `citations`; knowledge citations deep-link to `/knowledge?entryId=…`.

## Debugging Gateway

`DebuggingGateway` is the frontend port for M3 device debugging. Page components call runtime actions from `src/application/debugging/debuggingRuntime.ts`; those actions route every node operation (detect/session start, node reads, node writes, snapshot rollback) through the gateway resolved by `resolveDebuggingGateway(runtimeMode)` in `src/application/debugging/debuggingGatewayRuntime.ts`. Runtime-mode knowledge lives in that seam — pages must not construct clients or issue raw fetches themselves.

Runtime split:

- `api` mode uses `createHttpDebuggingGateway` (`src/infrastructure/http/debuggingClient.ts`, built on the shared `apiClient` with auth header and error envelope) for HDC/ADB devices, targets, parameters, sessions, node reads, node writes, snapshot rollback, and session events. Runtime and admin calls are organization-scoped and do not send `projectId`.
- `mock` mode serves the same port through `src/infrastructure/mock/mockDebuggingGateway.ts` (ADR-0002 restored 2026-08-13): one seeded multi-protocol Aurora device behind a paired Mock Bridge, device-side values that drift plausibly from the catalog, honest read/write/readback semantics, write snapshots feeding the rollback safety net, and the same confirmation gates the server enforces (`confirm-high-risk-write`, `confirm-rollback`) — so detect, read, write, and rollback are walkable without hardware for both protocols. The `/node-debugging` route also passes `createMockDebuggingBridgeSeams()` into `LocalDeviceBridgePanel`, so mock mode makes no local bridge HTTP probes.
- The former raw `/api/hdc/*` page fallback (`src/hdcClient.ts`) is deleted; `/node-debugging` no longer bypasses the port or the shared HTTP client (and the hardcoded "ADB requires API mode" branch is gone). The Vite dev middleware (`viteHdcApi.ts`) remains a curl-level local experiment tool without a frontend consumer — it is not a product seam.
- `mock` mode keeps `DebuggingPage` reducer behavior for demos and component tests; the `/debugging` route is not linked in navigation.

**Parameter debugging route:** `/debugging` remains product-offline (TD-032). Migration `0037` removed `parameter_reload_bindings` and the live reload-target/reload-write surface (HTTP routes still return `410 Gone`). `/node-debugging` is the M3 node catalog workspace. **Parameter debugging** (UI title for `/dts-reload`, `src/features/dts-reload/DtsReloadPage.tsx`) is the live DTS overlay reload surface and is unrelated to the retired parameter-reload concept.

### Parameter debugging / DTS reload (`/dts-reload`)

Page for validating project parameter candidates on a bridge-reachable device, served in both runtimes through the same `DtsReloadRepository` port (ADR-0002). Shell title/nav label is **Parameter debugging** (`appConfig`). The shell follows the same **workbench** rhythm as `/node-debugging` (`workbench-page` / `workbench-one-col`): protocol switch and shared `LocalDeviceBridgePanel` (install/pair/connect wizard) above the table, the same multi-target `bridge-target-picker` when detect returns several devices (targetRef/`deviceId` come from Bridge detect + selected bridge — no separate deploy-target card), then a **left module navigator + right candidate table** (reuses `DtsTopologyNavigator` and `buildModuleTree` with registry nesting + `groupByDevice`, same as the parameter workbench; selecting a navigator node filters by subtree bindings; the **Module** header also uses shared `ColumnFilter` multi-select; the last column is **Actions**: blocked rows keep the reason text, debuggable rows show a pencil **Edit** that opens a `WorkbenchSheet` side panel for details, last-reload history, and debug value, confirming into the reload batch). The **Reload batch** tray mirrors the parameter workbench current-edits tray: it renders as a **sibling above** the **Debuggable parameters** section only when the batch is non-empty (`Reload batch` eyebrow, baseline→debug `ParameterValueDiff`, edit fields, primary **Dispatch parameters**). Run-result panel when present, and **collapsed-by-default** run history. Title/subtitle come from the app shell (`appConfig`); the page does not repeat a local `h2`. Bridge readiness UI is the same component as `/node-debugging` (`src/components/LocalDeviceBridgePanel.tsx`), not a duplicate strip.

- Lists reload candidates for a project (debuggable vs blocked reasons, baseline vs debug value, sensitive-match badges, last-reload projection).
- Starts a reload run (batch targets), shows overlay preview / preflight diagnostics, then deploys with explicit `confirm-dts-reload` (and `confirm-sensitive-reload` when critical rules match).
- Shows in-request deploy progress, reload snapshot evidence (artifact integrity, unjudged kernel log, behavioural verification), residue indicator, restore-baseline confirmation, and run history.
- Mock mode serves the same semantic reload model through `src/infrastructure/mock/mockDtsReloadRepository.ts` (ADR-0002 restored 2026-08-13): seeded candidates across every supported value shape, a completable run lifecycle with reload-snapshot evidence, paginated history, residue + restore-baseline, and the same token gates (`confirm-dts-reload` / `confirm-sensitive-reload`) the server enforces. Resolve the port with `resolveDtsReloadRepository(runtimeMode)` (`src/application/dts-reload/dtsReloadRuntime.ts`); the route passes stable mock bridge/target/pairing seams so the deploy flow is walkable without hardware. Reload configuration CRUD for admins lives on `/debugging-admin` (parameter-debug scope peer; node catalog is `/debugging-admin/nodes`).
- Client: `src/infrastructure/http/dtsReloadClient.ts` (and related ports under `src/application/ports/`).
- Orchestration lives in the **DtsReloadRunSession** (`src/application/dts-reload/dtsReloadRunSession.ts` + `useDtsReloadRunSession`), a Workbench-style session (snapshot + subscribe + command verbs, narrow `Pick<DtsReloadRepository, …>` per method): candidate loading, run-id-in-URL rehydration, reload-batch editing/validation, run start, deploy confirmation (the only place `confirm-dts-reload` is attached), restore-baseline, deploy-target state, and run/history/residue loading with pagination. Prefer unit-testing the session command interface.
- Implementation: `src/features/dts-reload/DtsReloadPage.tsx` is a rendering layer over the session hook; presentation helpers are colocated in `dtsReloadPresentation.tsx`; the pure debug-value authoring pre-check is `src/domain/dtsReload/debugValue.ts` (TD-069 split, plan `2026-08-13-dts-reload-run-session.md`).

### Local Device Bridge (Phase A)

`/node-debugging` and `/dts-reload` share `LocalDeviceBridgePanel` (`src/components/LocalDeviceBridgePanel.tsx`), which hosts the three-step wizard (install Bridge, connect locally, plug in USB) in `src/components/LocalDeviceBridgeWizard.tsx`. The panel reads release metadata from `/api/v1/device-bridges/releases`, prefers `artifactKind: "installer"` downloads via `pickBridgeReleaseForHost()`, creates pairing codes from `/api/v1/device-bridges/pairing-codes`, and lists user-owned bridges from `/api/v1/device-bridges/mine` through `src/infrastructure/http/deviceBridgeClient.ts`.

Primary connect flow: click the connect-local-device CTA → optional first-run confirm (`wiseeff.bridgeSchemeConfirm`) → `launchBridgeConnect()` opens `wiseeff-bridge://connect?server=<origin>&code=<6-digit>` → `pollLocalBridgeHealth()` probes `http://127.0.0.1:18787/health` for up to 30s → auto-detect when `connected: true`. Helpers live in `src/infrastructure/http/bridgeConnectLauncher.ts`.

Phase B (Step 3 tools): health JSON includes `tools.adb` / `tools.hdc`. When the selected protocol tool is missing, `deriveBridgePanelStatus()` returns `tools_missing` and `LocalDeviceBridgeToolsPanel` shows an install-tools CTA via `bridgeToolInstallLauncher.ts` (`wiseeff-bridge://install-tools`, 120s poll). Detect failures mentioning missing adb/hdc map to the tools install CTA instead of the bridge-missing copy.

CLI `pair` / `start` / `connect` commands are collapsed under **Advanced · CLI**. Portable zip/tar artifacts remain under **Other platforms** when installers are the primary CTA.

The browser health probe is UI guidance only; bridge-backed device execution remains server-authorized through debugging sessions and audit.

Bridge management (rename/revoke, multi-bridge target picker) behavior is unchanged from Phase 2.

`/debugging-admin` (debug management console) uses peer scope navigation: `/debugging-admin` for DTS reload configuration, `/debugging-admin/nodes` for API-backed **logical debug node** catalog management in `api` mode. The nodes scope calls `src/infrastructure/http/debuggingAdminClient.ts` to list, create, update, and archive adjustable nodes (`debug_nodes`). Protocol-specific device paths live in separate **`debug_node_bindings`** rows (HDC and ADB per logical node). Legacy parameter catalog APIs remain on the server for audit/history but are no longer exposed in this Admin UI. `mock` mode keeps a slim local path for demos and component tests.

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

P1 adds `XiaozeApprovalCard` (`useInterrupt`) for mutating `action.submitParameterChange` proposals and one low-risk frontend tool (`navigateTo`) via `useFrontendTool` (the former `prefillParameterValue` tool was removed — its registry had no consumer, so the agent claimed prefills that never appeared). The card is fully localized into Chinese (approve / reject actions and the target-value label), renders the AI-provided change reason as a dedicated block when the payload carries one, and offers an optional rejection-reason textarea whose text (falling back to a localized default) travels through the interrupt resolve `reason` field.

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

The user-governance client maps `/api/v1/users` responses into frontend `UserAccount` records, including local usernames when present. Creating a user through `/user-permissions` posts `name`, `username`, `password`, optional `title`, and role bindings using the platform role ids: `guest`, `hardware-user`, `software-user`, `hardware-committer`, `software-committer`, `admin`, and `platform-admin`. Only a caller who already holds `platform-admin` may grant or revoke that role; the grant control is hidden for ordinary Admins. Admin-created users are active immediately because the Admin action is already authenticated and audited; self-registered Committer users still use `/api/v1/users/registration-role-requests` and the Admin approval queue. Self-registration never offers `admin` or `platform-admin`.

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

## UI Design System And Quality Gate

Every product surface follows the operational visual standard in [UI Design System](design-docs/ui-design-system.md): design tokens as the only source of visual values, one accent, mandatory interaction states (rest/hover/active/focus-visible/disabled/loading), shared primitives (the `.button` base layer + `ui/button`, `ModalDialog`/`ConfirmDialog` for every dialog, `useToast()` from `src/components/common/toast` as the single toast pipeline, `admin/DataTable` as the standard list shell, `ColumnFilter`, `SectionState` + `AppShellSkeleton` for loading/empty/error and auth bootstrap), tokenized motion, and Chinese-first product language with shared formatters. Every frontend-visible change must pass the completion gate in [UI Quality Checklist](developer/ui-quality-checklist.md) before it is called done. Migration of legacy surfaces to this standard is tracked in `docs/exec-plans/active/2026-08-12-frontend-aesthetics-uplift.md`.

## Button And Action Styling

Buttons must look and behave like buttons. Do not rely on a bare `.button` class, raw `<button>` browser defaults, or text-only styling for actions that mutate state, submit forms, close dialogs, navigate workflows, or open menus. Use the existing button component or an established local variant; if a scoped button variant is needed, define the full visual contract in that scope:

- layout: `inline-flex`, centered content, stable `min-height`, and stable `min-width` or icon-only square dimensions;
- surface: explicit `background`, `border`, `border-radius`, text color, and disabled opacity/cursor;
- hierarchy: clear primary, secondary/subtle, destructive, or ghost treatment instead of two equal-looking text labels;
- interaction: hover and focus-visible states, with focus rings that remain visible on light and dimmed modal backdrops;
- responsive behavior: buttons must not collapse to bare text, overlap siblings, overflow their container, or change layout unexpectedly across desktop, tablet, and mobile widths.

Dialog footers, table row actions, topbar actions, card actions, and toast actions are common regression points. When changing them, add a focused DOM assertion for the intended button variant or class and run browser verification that captures the relevant state. The browser check should explicitly confirm that primary and secondary actions have visible surface styling, stable dimensions, and no horizontal overflow. Text-only actions are acceptable only for low-emphasis links or inline affordances, and should use a link/text-action class rather than masquerading as a button.

## Table Column Multi-Select Filter UX

Categorical column filters that support zero / one / many values must use the shared `ColumnFilter` pattern (quiet funnel trigger in the header + checkbox menu), not a permanent `<select>` or sort-arrow stand-in. Spec: [Table Column Multi-Select Filter UX](design-docs/ux-table-column-filter.md). Canonical code: `src/components/ColumnFilter.tsx`. Reference: `ParametersTable`, workbench module column in `DtsParameterWorkbenchTable`, and parameter-admin `ParameterSpecLibrary` / `ProjectAdminTable`.

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
