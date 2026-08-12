export type AcceptanceOperationPriority = "P0" | "P1" | "P2";
export type AcceptanceOperationCoverage = "automated" | "manual" | "conditional" | "future";
export type AcceptanceOperationAssertion = "ui" | "api" | "db" | "audit" | "screenshot";

export type AcceptanceOperation = {
  id: string;
  priority: AcceptanceOperationPriority;
  area: "auth" | "shell" | "parameters" | "logs" | "debugging" | "agent" | "permissions" | "notifications" | "product-feedback" | "platform";
  route: string;
  roles: string[];
  action: string;
  coverage: AcceptanceOperationCoverage;
  acceptanceIds: string[];
  specFiles: string[];
  assertions: AcceptanceOperationAssertion[];
  deferralReason?: string;
};

export const acceptanceOperations: AcceptanceOperation[] = [
  {
    id: "AUTH-RUNTIME-001",
    priority: "P0",
    area: "auth",
    route: "/",
    roles: ["Admin"],
    action: "Load API-mode browser runtime with the local dev auth contract.",
    coverage: "automated",
    acceptanceIds: ["AUTH-RUNTIME-001"],
    specFiles: ["e2e/acceptance/auth-runtime.acceptance.spec.ts"],
    assertions: ["ui", "api"]
  },
  {
    id: "NOTIF-INBOX-001",
    priority: "P1",
    area: "notifications",
    route: "/parameters",
    roles: ["Admin"],
    action: "Open the TopBar notification inbox and load inbox APIs for the current user.",
    coverage: "automated",
    acceptanceIds: ["NOTIF-INBOX-001"],
    specFiles: ["e2e/acceptance/notifications.acceptance.spec.ts"],
    assertions: ["ui", "api"]
  },
  {
    id: "NOTIF-READ-001",
    priority: "P1",
    area: "notifications",
    route: "/api/v1/notifications/mark-all-read",
    roles: ["Admin"],
    action: "Mark inbox notifications read through the backend API.",
    coverage: "automated",
    acceptanceIds: ["NOTIF-READ-001"],
    specFiles: ["e2e/acceptance/notifications.acceptance.spec.ts"],
    assertions: ["api"]
  },
  {
    id: "PFB-SUBMIT-001",
    priority: "P1",
    area: "product-feedback",
    route: "/parameters",
    roles: ["Admin"],
    action: "Submit product feedback from the sidebar with a required description and optional pasted image.",
    coverage: "automated",
    acceptanceIds: ["PFB-SUBMIT-001"],
    specFiles: ["e2e/acceptance/product-feedback.acceptance.spec.ts"],
    assertions: ["ui", "api", "db", "audit", "screenshot"]
  },
  {
    id: "PFB-ADMIN-001",
    priority: "P1",
    area: "product-feedback",
    route: "/feedback-admin",
    roles: ["Admin"],
    action: "List product feedback, open detail, advance status from open to in_progress to closed, and save an admin note.",
    coverage: "automated",
    acceptanceIds: ["PFB-ADMIN-001"],
    specFiles: ["e2e/acceptance/product-feedback.acceptance.spec.ts"],
    assertions: ["ui", "api", "db", "audit", "screenshot"]
  },
  {
    id: "PFB-AUTHZ-001",
    priority: "P1",
    area: "product-feedback",
    route: "/feedback-admin",
    roles: ["Hardware User"],
    action: "Deny non-Admin access to product feedback admin list/detail/update APIs and the feedback-admin page.",
    coverage: "automated",
    acceptanceIds: ["PFB-AUTHZ-001"],
    specFiles: ["e2e/acceptance/product-feedback.acceptance.spec.ts"],
    assertions: ["ui", "api", "db", "screenshot"]
  },
  {
    id: "SHELL-DIAG-001",
    priority: "P0",
    area: "shell",
    route: "core routes",
    roles: ["Admin"],
    action: "Load every primary route and fail on unexpected browser/runtime/API diagnostics.",
    coverage: "automated",
    acceptanceIds: ["SHELL-DIAG-001"],
    specFiles: ["e2e/acceptance/shell-navigation.acceptance.spec.ts"],
    assertions: ["ui"]
  },
  {
    id: "PARAM-REASON-001",
    priority: "P0",
    area: "parameters",
    route: "/parameters",
    roles: ["Hardware User"],
    action: "Block blank draft reasons before API submission.",
    coverage: "automated",
    acceptanceIds: ["PARAM-REASON-001"],
    specFiles: ["e2e/acceptance/parameters-negative.acceptance.spec.ts"],
    assertions: ["ui"]
  },
  {
    id: "PARAM-ASSIGNEE-001",
    priority: "P0",
    area: "parameters",
    route: "/parameters",
    roles: ["Software User"],
    action: "Default every workflow assignee slot to an eligible active user.",
    coverage: "automated",
    acceptanceIds: ["PARAM-ASSIGNEE-001"],
    specFiles: ["e2e/acceptance/parameter-topology.acceptance.spec.ts"],
    assertions: ["ui"]
  },
  {
    id: "PARAM-ASSIGNEE-002",
    priority: "P0",
    area: "parameters",
    route: "/parameters",
    roles: ["Software User"],
    action: "Hide inactive, guest, admin-only, and role-ineligible users from assignee dropdowns.",
    coverage: "automated",
    acceptanceIds: ["PARAM-ASSIGNEE-002"],
    specFiles: ["e2e/acceptance/parameter-topology.acceptance.spec.ts"],
    assertions: ["ui"]
  },
  {
    id: "PARAM-ASSIGNEE-003",
    priority: "P0",
    area: "parameters",
    route: "/api/v1/parameter-submission-rounds",
    roles: ["Hardware User"],
    action: "Reject forced invalid workflow assignees at the API boundary.",
    coverage: "automated",
    acceptanceIds: ["PARAM-ASSIGNEE-003"],
    specFiles: ["e2e/acceptance/parameters-negative.acceptance.spec.ts"],
    assertions: ["api"]
  },
  {
    id: "PARAM-HAPPY-001",
    priority: "P0",
    area: "parameters",
    route: "/parameters",
    roles: ["Hardware User", "Hardware Committer", "Software Committer", "Software User", "Admin"],
    action: "Search a semantic binding, create a typed draft, submit it, review by assigned roles, merge, persist, and audit the writeback.",
    coverage: "automated",
    acceptanceIds: ["PARAM-HAPPY-001"],
    specFiles: ["e2e/acceptance/parameter-topology.acceptance.spec.ts"],
    assertions: ["ui", "api", "db", "audit"]
  },
  {
    id: "PARAM-HOME-001",
    priority: "P1",
    area: "parameters",
    route: "/parameter-home",
    roles: ["Admin"],
    action: "Load parameter-home dashboard summary and hotspots APIs, render insight sections, and switch time window and hotspot dimension in-page.",
    coverage: "automated",
    acceptanceIds: ["PARAM-HOME-001"],
    specFiles: ["e2e/acceptance/parameter-home.acceptance.spec.ts"],
    assertions: ["ui", "api"]
  },
  {
    id: "PARAM-ADMIN-001",
    priority: "P1",
    area: "parameters",
    route: "/parameter-admin",
    roles: ["Admin"],
    action: "Open parameter admin import preview and audit drawer.",
    coverage: "automated",
    acceptanceIds: ["PARAM-ADMIN-001"],
    specFiles: ["e2e/acceptance/parameters.acceptance.spec.ts"],
    assertions: ["ui", "audit"]
  },
  {
    id: "PARAM-ADMIN-002",
    priority: "P1",
    area: "parameters",
    route: "/parameter-admin",
    roles: ["Admin"],
    action: "Run the five-step parameter import wizard through target project selection, multi-format upload, per-row review, batch preview, and apply.",
    coverage: "automated",
    acceptanceIds: ["PARAM-ADMIN-002"],
    specFiles: ["e2e/acceptance/parameter-import-wizard.acceptance.spec.ts"],
    assertions: ["ui", "audit"]
  },
  {
    id: "PARAM-ADMIN-003",
    priority: "P1",
    area: "parameters",
    route: "/parameter-admin/projects",
    roles: ["Admin"],
    action: "Open the project list and confirm status, counts, last-updated, and row actions remain visible in the ≤960px card layout.",
    coverage: "future",
    acceptanceIds: ["PARAM-ADMIN-003"],
    specFiles: ["src/components/admin/ProjectAdminTable.tsx"],
    assertions: ["ui", "screenshot"],
    deferralReason:
      "Batch 1 ships CSS fix + playwright-cli three-viewport evidence under work/ui-checks/param-admin-ux-polish-batch1/; dedicated e2e viewport assertion follows in a later batch."
  },
  {
    id: "PARAM-INIT-WIZARD-001",
    priority: "P1",
    area: "parameters",
    route: "/parameter-admin",
    roles: ["Admin"],
    action: "Complete the project parameter initialization wizard with sources and selection into pending review.",
    coverage: "future",
    acceptanceIds: ["PARAM-INIT-WIZARD-001"],
    specFiles: [
      "src/ProjectParameterInitializationWizard.test.tsx",
      "src/appReducer.parameterAdmin.test.ts",
      "server/modules/parameters/initializationService.test.ts"
    ],
    assertions: ["ui", "api", "audit", "screenshot"],
    deferralReason:
      "Unit/reducer/server cover submit→pending; playwright-cli evidence under work/ui-checks/param-init/; full browser e2e follows after semantic wizard binding picker lands."
  },
  {
    id: "PARAM-INIT-EMPTY-001",
    priority: "P1",
    area: "parameters",
    route: "/api/v1/parameters/projects/:projectId/initialization",
    roles: ["Admin"],
    action: "Submit and approve an explicit empty-library initialization to initialized with zero bindings.",
    coverage: "future",
    acceptanceIds: ["PARAM-INIT-EMPTY-001"],
    specFiles: [
      "src/infrastructure/mock/mockParameterInitializationRepository.test.ts",
      "server/modules/parameters/initializationService.test.ts"
    ],
    assertions: ["api", "db", "audit"],
    deferralReason:
      "Server and mock Port tests cover empty approve; dedicated e2e API+UI path follows with wizard empty-mode CTA."
  },
  {
    id: "PARAM-INIT-REVIEW-001",
    priority: "P1",
    area: "parameters",
    route: "/parameter-review",
    roles: ["Admin"],
    action: "Approve a pending initialization review and unlock the project with materialized bindings.",
    coverage: "future",
    acceptanceIds: ["PARAM-INIT-REVIEW-001"],
    specFiles: ["src/App.tsx", "server/modules/parameters/initializationService.test.ts"],
    assertions: ["ui", "api", "db", "audit"],
    deferralReason:
      "API-mode App handlers call Port approve; server materialize + audit covered in initializationService tests; full browser evidence follows."
  },
  {
    id: "PARAM-INIT-REJECT-001",
    priority: "P1",
    area: "parameters",
    route: "/parameter-review",
    roles: ["Admin"],
    action: "Reject initialization with a required reason and allow creator revision.",
    coverage: "future",
    acceptanceIds: ["PARAM-INIT-REJECT-001"],
    specFiles: ["src/appReducer.parameterAdmin.test.ts", "server/modules/parameters/initializationService.test.ts"],
    assertions: ["ui", "api", "audit"],
    deferralReason:
      "Reducer and server reject paths covered; dedicated browser reject/resubmit e2e follows."
  },
  {
    id: "PARAM-INIT-LOCK-001",
    priority: "P1",
    area: "parameters",
    route: "/parameters",
    roles: ["Software User", "Admin"],
    action: "Confirm non-initialized projects cannot submit normal typed binding change rounds.",
    coverage: "future",
    acceptanceIds: ["PARAM-INIT-LOCK-001"],
    specFiles: ["src/ParametersPage.test.tsx", "server/modules/parameters/service.test.ts"],
    assertions: ["ui", "api"],
    deferralReason:
      "UI lock + submitParameterChanges assertProjectAllowsParameterSubmit covered by unit tests; browser lock evidence follows."
  },
  {
    id: "PROJ-OPS-001",
    priority: "P1",
    area: "parameters",
    route: "/parameter-admin/projects/:projectId/configuration",
    roles: ["Admin"],
    action:
      "Superseded by PROJ-CONFIG-CUTOVER-001: legacy deep links redirect to equivalent workbench contexts; unknown project ids still show not-found.",
    coverage: "automated",
    acceptanceIds: ["PROJ-OPS-001", "PROJ-CONFIG-CUTOVER-001"],
    specFiles: [
      "e2e/acceptance/project-configuration-workbench.acceptance.spec.ts",
      "src/ParameterAdminNextPage.test.tsx",
      "src/components/parameter-admin-next/projectOperationsCutover.test.ts"
    ],
    assertions: ["ui", "screenshot"],
  },
  {
    id: "PROJ-OPS-002",
    priority: "P1",
    area: "parameters",
    route: "/parameter-admin/projects/:projectId/configuration",
    roles: ["Admin"],
    action:
      "Superseded by PROJ-CONFIG-READ-001 / PROJ-CONFIG-CUTOVER-001: three-viewport workbench layout without clipping or page-level horizontal overflow.",
    coverage: "automated",
    acceptanceIds: ["PROJ-OPS-002", "PROJ-CONFIG-READ-001", "PROJ-CONFIG-CUTOVER-001"],
    specFiles: ["e2e/acceptance/project-configuration-workbench.acceptance.spec.ts"],
    assertions: ["ui", "screenshot"],
  },
  {
    id: "PROJ-OPS-003",
    priority: "P1",
    area: "parameters",
    route: "/parameter-admin/projects/:projectId/configuration",
    roles: ["Admin"],
    action:
      "Superseded by PROJ-CONFIG-BASELINE-001 / PROJ-CONFIG-OPS-001 / PROJ-CONFIG-CONFLICT-001: baseline, membership, and conflict confirmations in workbench source context.",
    coverage: "automated",
    acceptanceIds: [
      "PROJ-OPS-003",
      "PROJ-CONFIG-BASELINE-001",
      "PROJ-CONFIG-OPS-001",
      "PROJ-CONFIG-CONFLICT-001"
    ],
    specFiles: ["e2e/acceptance/project-configuration-workbench.acceptance.spec.ts"],
    assertions: ["ui", "api", "screenshot"]
  },
  {
    id: "PROJ-CONFIG-READ-001",
    priority: "P1",
    area: "parameters",
    route: "/parameter-admin/projects/:projectId/configuration",
    roles: ["Admin"],
    action:
      "Enter from the project list, resolve URL/default Config-set context, distinguish member and ungrouped files, select an active DTS source, and exercise responsive tree/inspector/task sheets.",
    coverage: "automated",
    acceptanceIds: ["PROJ-CONFIG-READ-001"],
    specFiles: ["e2e/acceptance/project-configuration-workbench.acceptance.spec.ts"],
    assertions: ["ui", "api", "screenshot"]
  },
  {
    id: "PROJ-CONFIG-SOURCE-001",
    priority: "P1",
    area: "parameters",
    route: "/parameter-admin/projects/:projectId/configuration",
    roles: ["Admin"],
    action:
      "Select structure nodes/properties to focus source spans, run unified search grouped by file with cross-file navigation, restore node/property/sourceMode deep links, and retry failed structure reads independently.",
    coverage: "automated",
    acceptanceIds: ["PROJ-CONFIG-SOURCE-001"],
    specFiles: ["e2e/acceptance/project-configuration-workbench.acceptance.spec.ts"],
    assertions: ["ui", "api", "screenshot"]
  },
  {
    id: "PROJ-CONFIG-INSPECT-001",
    priority: "P1",
    area: "parameters",
    route: "/parameter-admin/projects/:projectId/configuration",
    roles: ["Admin"],
    action:
      "Inspect config-set/file/node/property context, walk inspector back while preserving source, browse immutable file history with download, enter history/diff source modes with restore, and verify overlay vs persistent inspector layout.",
    coverage: "automated",
    acceptanceIds: ["PROJ-CONFIG-INSPECT-001"],
    specFiles: ["e2e/acceptance/project-configuration-workbench.acceptance.spec.ts"],
    assertions: ["ui", "api", "screenshot"]
  },
  {
    id: "PROJ-CONFIG-CANDIDATE-001",
    priority: "P1",
    area: "parameters",
    route: "/parameter-admin/projects/:projectId/configuration",
    roles: ["Admin"],
    action:
      "Upload a candidate file version, review impact evidence in candidate source/inspector, observe parse-failure diagnostics with abandon, and confirm active version plus Config set membership stay unchanged.",
    coverage: "automated",
    acceptanceIds: ["PROJ-CONFIG-CANDIDATE-001"],
    specFiles: ["e2e/acceptance/project-configuration-workbench.acceptance.spec.ts"],
    assertions: ["ui", "api", "screenshot"]
  },
  {
    id: "PROJ-CONFIG-EDIT-001",
    priority: "P1",
    area: "parameters",
    route: "/parameter-admin/projects/:projectId/configuration",
    roles: ["Admin"],
    action:
      "Select an editable property into the typed inspector, accumulate session-changes with shared tree/gutter identity, validate and submit a selected subset through submitStructuredEdits on the shared pre-cutover acceptance DB, while the source canvas stays read-only. Permission denial and submit-failure draft retention are proven by component tests.",
    coverage: "automated",
    acceptanceIds: ["PROJ-CONFIG-EDIT-001"],
    specFiles: ["e2e/acceptance/project-configuration-workbench.acceptance.spec.ts"],
    assertions: ["ui", "api", "screenshot"]
  },
  {
    id: "PROJ-CONFIG-DRAFT-001",
    priority: "P1",
    area: "parameters",
    route: "/parameter-admin/projects/:projectId/configuration",
    roles: ["Admin"],
    action:
      "Edit a property into the session dock, restore compatible drafts and reason after reload when the base matches, confirm leave when dirty, prove stale-base blocks validate/submit via localStorage base mutation while drafts stay inspectable, and prove logout clears drafts on the next sign-in. Cross-user/org/project isolation is covered by component/storage tests.",
    coverage: "automated",
    acceptanceIds: ["PROJ-CONFIG-DRAFT-001"],
    specFiles: ["e2e/acceptance/project-configuration-workbench.acceptance.spec.ts"],
    assertions: ["ui", "api", "screenshot"]
  },
  {
    id: "PROJ-CONFIG-ACTIVITY-001",
    priority: "P1",
    area: "parameters",
    route: "/parameter-admin/projects/:projectId/configuration",
    roles: ["Admin"],
    action:
      "Open Activity from the command bar, read scoped server audit events in product language, restore targetable workbench context or fail gracefully, and keep toast + timeline refresh without a permanent audit banner.",
    coverage: "automated",
    acceptanceIds: ["PROJ-CONFIG-ACTIVITY-001"],
    specFiles: ["e2e/acceptance/project-configuration-workbench.acceptance.spec.ts"],
    assertions: ["ui", "api", "screenshot"]
  },
  {
    id: "PROJ-CONFIG-ACTIVATE-001",
    priority: "P1",
    area: "parameters",
    route: "/parameter-admin/projects/:projectId/configuration",
    roles: ["Admin"],
    action:
      "Activate ready existing-file and new-file candidates with impact confirmation and expected-current-version CAS; prove stale-base preserves Working configuration and requires recompute; never activate blocked/failed/abandoned/stale.",
    coverage: "automated",
    acceptanceIds: ["PROJ-CONFIG-ACTIVATE-001"],
    specFiles: ["e2e/acceptance/project-configuration-workbench.acceptance.spec.ts"],
    assertions: ["ui", "api", "screenshot"]
  },
  {
    id: "PROJ-CONFIG-OPS-001",
    priority: "P1",
    area: "parameters",
    route: "/parameter-admin/projects/:projectId/configuration",
    roles: ["Admin"],
    action:
      "Create/configure a Config set with validation and duplicate-name handling, add/remove members with role and sortOrder plus ConfirmDialog blast-radius, keep ungrouped files outside Working/Release until assigned, run manual sync with task-dock evidence, export from the command context, and exercise empty-set upload/assignment without auto-activation plus non-admin denial with read context retained.",
    coverage: "automated",
    acceptanceIds: ["PROJ-CONFIG-OPS-001"],
    specFiles: ["e2e/acceptance/project-configuration-workbench.acceptance.spec.ts"],
    assertions: ["ui", "api", "screenshot"]
  },

  {
    id: "PROJ-CONFIG-CONFLICT-001",
    priority: "P1",
    area: "parameters",
    route: "/parameter-admin/projects/:projectId/configuration",
    roles: ["Admin"],
    action:
      "Open source-located three-way Conflicts arbitration from the workbench task dock; resolve with equal-weight file and UI outcomes plus optional audit reason; advance the queue in source context; preview and apply eligible bulk resolution; prove open conflicts block candidate activation; keep the dock collapsed when the queue is empty.",
    coverage: "automated",
    acceptanceIds: ["PROJ-CONFIG-CONFLICT-001"],
    specFiles: ["e2e/acceptance/project-configuration-workbench.acceptance.spec.ts"],
    assertions: ["ui", "api", "screenshot"]
  },
  {
    id: "PROJ-CONFIG-READINESS-001",
    priority: "P1",
    area: "parameters",
    route: "/parameter-admin/projects/:projectId/configuration",
    roles: ["Admin"],
    action:
      "Inspect the server-owned release readiness summary in the command bar; open Issues dock remediations; prove create/release stay fail-closed when blocked, unavailable, stale, or local session dirty; confirm the UI does not invent permission from client counts.",
    coverage: "automated",
    acceptanceIds: ["PROJ-CONFIG-READINESS-001"],
    specFiles: ["e2e/acceptance/project-configuration-workbench.acceptance.spec.ts"],
    assertions: ["ui", "api", "screenshot"]
  },
  {
    id: "PROJ-CONFIG-BASELINE-001",
    priority: "P1",
    area: "parameters",
    route: "/parameter-admin/projects/:projectId/configuration",
    roles: ["Admin"],
    action:
      "Create, compare, acknowledge warnings, release, and restore baselines in the configuration workbench source context; preview restore blast radius; prove atomic restore leaves the released tip unchanged and refreshes readiness.",
    coverage: "automated",
    acceptanceIds: ["PROJ-CONFIG-BASELINE-001"],
    specFiles: ["e2e/acceptance/project-configuration-workbench.acceptance.spec.ts"],
    assertions: ["ui", "api", "screenshot"]
  },
  {
    id: "PROJ-CONFIG-CUTOVER-001",
    priority: "P1",
    area: "parameters",
    route: "/parameter-admin/projects/:projectId/configuration",
    roles: ["Admin"],
    action:
      "Legacy /files|/config-sets|/structure|/conflicts deep links redirect to equivalent workbench contexts preserving focus query params; new links use only /configuration; three viewports prove no lost capability.",
    coverage: "automated",
    acceptanceIds: ["PROJ-CONFIG-CUTOVER-001"],
    specFiles: [
      "e2e/acceptance/project-configuration-workbench.acceptance.spec.ts",
      "src/ParameterAdminNextPage.test.tsx",
      "src/components/parameter-admin-next/projectOperationsCutover.test.ts"
    ],
    assertions: ["ui", "screenshot", "api"]
  },

  {
    id: "PARAM-ADMIN-DIALOG-001",
    priority: "P1",
    area: "parameters",
    route: "/parameter-admin/projects",
    roles: ["Admin"],
    action:
      "Open the project edit, project delete, and governance confirmation dialogs and exercise focus entry, Tab containment, Escape with stacked dialogs, focus restore, and press-inside/release-outside.",
    coverage: "future",
    acceptanceIds: ["PARAM-ADMIN-DIALOG-001"],
    specFiles: ["src/components/common/ModalDialog.test.tsx"],
    assertions: ["ui", "screenshot"],
    deferralReason:
      "The modal contract is covered by unit tests on the shared primitive plus playwright-cli evidence; a keyboard-focused e2e spec follows."
  },
  {
    id: "PARAM-IMPORT-DTS-FULL-001",
    priority: "P1",
    area: "parameters",
    route: "/parameter-admin",
    roles: ["Admin"],
    action: "Parse a full .dts via parameter-import/parse-dts with @address module paths and reject /include/.",
    coverage: "automated",
    acceptanceIds: ["PARAM-IMPORT-DTS-FULL-001"],
    specFiles: ["e2e/acceptance/parameter-import-dts-td035.acceptance.spec.ts"],
    assertions: ["ui", "api"]
  },
  {
    id: "PARAM-IMPORT-REVIEW-META-001",
    priority: "P1",
    area: "parameters",
    route: "/parameter-admin",
    roles: ["Admin"],
    action: "Create an import preview with reviewMetadata.skippedRows and verify batch-import audit metadata.",
    coverage: "automated",
    acceptanceIds: ["PARAM-IMPORT-REVIEW-META-001"],
    specFiles: ["e2e/acceptance/parameter-import-dts-td035.acceptance.spec.ts"],
    assertions: ["api", "db", "audit"]
  },
  {
    id: "PARAM-DRAFT-EDIT-001",
    priority: "P1",
    area: "parameters",
    route: "/parameters",
    roles: ["Hardware User"],
    action: "Edit and remove draft items before final submission.",
    coverage: "automated",
    acceptanceIds: ["PARAM-DRAFT-EDIT-001"],
    specFiles: ["e2e/acceptance/parameters-negative.acceptance.spec.ts"],
    assertions: ["ui", "api", "db"]
  },
  {
    id: "PARAM-REJECT-001",
    priority: "P1",
    area: "parameters",
    route: "/parameter-review",
    roles: ["Hardware Committer", "Software Committer"],
    action: "Reject a parameter review and show status, reason, and audit evidence.",
    coverage: "automated",
    acceptanceIds: ["PARAM-REJECT-001"],
    specFiles: ["e2e/acceptance/parameters.acceptance.spec.ts"],
    assertions: ["ui", "api", "db", "audit"]
  },
  {
    id: "LOG-HAPPY-001",
    priority: "P0",
    area: "logs",
    route: "/logs",
    roles: ["Software User", "Software Committer", "Admin"],
    action: "Upload, complete analysis, inspect evidence, send feedback, archive, and handle unsupported files.",
    coverage: "automated",
    acceptanceIds: ["LOG-HAPPY-001"],
    specFiles: ["e2e/acceptance/log-analysis.acceptance.spec.ts"],
    assertions: ["ui", "api", "db", "audit"]
  },
  {
    id: "LOG-REANALYZE-001",
    priority: "P1",
    area: "logs",
    route: "/logs",
    roles: ["Software User", "Software Committer", "Admin"],
    action: "Rerun log analysis and verify a new run, progress, and audit record.",
    coverage: "automated",
    acceptanceIds: ["LOG-REANALYZE-001"],
    specFiles: ["e2e/acceptance/log-analysis.acceptance.spec.ts"],
    assertions: ["ui", "api", "db", "audit"]
  },
  {
    id: "DEBUG-SIM-001",
    priority: "P0",
    area: "debugging",
    route: "/node-debugging",
    roles: ["Hardware Committer", "Admin"],
    action: "Read, write, detect mismatch, rollback, and audit simulator node changes, including complex JSON value metadata.",
    coverage: "automated",
    acceptanceIds: ["DEBUG-SIM-001"],
    specFiles: ["e2e/acceptance/debugging-simulator.acceptance.spec.ts"],
    assertions: ["ui", "api", "db", "audit"]
  },
  {
    id: "DEBUG-PERM-001",
    priority: "P1",
    area: "debugging",
    route: "/node-debugging",
    roles: ["Guest", "Hardware User", "Software User"],
    action: "Verify roles without write permission cannot perform node write operations.",
    coverage: "automated",
    acceptanceIds: ["DEBUG-PERM-001"],
    specFiles: ["e2e/acceptance/debugging-simulator.acceptance.spec.ts"],
    assertions: ["ui", "api"]
  },
  {
    id: "DEBUG-ADMIN-001",
    priority: "P1",
    area: "debugging",
    route: "/debugging-admin/nodes",
    roles: ["Admin"],
    action: "Create, edit, archive, restore, and protocol-bind a debugging catalog parameter, including complex value kind and format metadata.",
    coverage: "automated",
    acceptanceIds: ["DEBUG-ADMIN-001"],
    specFiles: ["e2e/acceptance/debugging-admin.acceptance.spec.ts"],
    assertions: ["ui", "api", "db", "audit"]
  },
  {
    id: "BRIDGE-WIN-001",
    priority: "P1",
    area: "debugging",
    route: "/node-debugging",
    roles: ["Hardware Committer", "Admin"],
    action: "Use the Windows-first local bridge panel to download, pair, and reconnect local debugging targets.",
    coverage: "future",
    acceptanceIds: ["BRIDGE-WIN-001"],
    specFiles: [
      "e2e/acceptance/debugging-local-bridge.acceptance.spec.ts",
      "e2e/acceptance/local-device-bridge.acceptance.spec.ts"
    ],
    assertions: ["ui", "api"],
    deferralReason: "Requires a real Windows bridge runtime and localhost health endpoint orchestration in acceptance."
  },
  {
    id: "BRIDGE-HDC-001",
    priority: "P1",
    area: "debugging",
    route: "/node-debugging",
    roles: ["Hardware Committer", "Admin"],
    action: "Run real paired-bridge HDC detect when DEVICE_BRIDGE_HDC_AVAILABLE is enabled.",
    coverage: "conditional",
    acceptanceIds: ["BRIDGE-HDC-001"],
    specFiles: ["e2e/acceptance/local-device-bridge.acceptance.spec.ts"],
    assertions: ["ui", "api"],
    deferralReason: "Requires a pre-paired bridge process, hdc on PATH, USB device, and DEVICE_BRIDGE_HDC_AVAILABLE=true."
  },
  {
    id: "DTS-RELOAD-DEPLOY-001",
    priority: "P0",
    area: "debugging",
    route: "/dts-reload",
    roles: ["Hardware Committer", "Admin"],
    action: "Deploy a validated reload overlay through a fake local device bridge (mount, pushFile, trigger, readKernelLog).",
    coverage: "automated",
    acceptanceIds: ["DTS-RELOAD-DEPLOY-001"],
    specFiles: ["e2e/acceptance/dts-reload-deploy.acceptance.spec.ts"],
    assertions: ["api"]
  },
  {
    id: "DTS-RELOAD-KERNEL-001",
    priority: "P0",
    area: "debugging",
    route: "/dts-reload",
    roles: ["Hardware Committer", "Admin"],
    action: "Capture unjudged kernel log evidence after a successful reload trigger via debug.readKernelLog.",
    coverage: "automated",
    acceptanceIds: ["DTS-RELOAD-KERNEL-001"],
    specFiles: ["e2e/acceptance/dts-reload-deploy.acceptance.spec.ts"],
    assertions: ["api"]
  },
  {
    id: "DTS-RELOAD-VERIFY-001",
    priority: "P0",
    area: "debugging",
    route: "/dts-reload",
    roles: ["Hardware Committer", "Admin"],
    action:
      "After successful trigger, read bound parameters via debug.readNode. The acceptance spec asserts the unbound path (no debug.readNode, run stays unverifiable); graduation to verified/contradicted is asserted by server tests.",
    coverage: "automated",
    acceptanceIds: ["DTS-RELOAD-VERIFY-001"],
    specFiles: [
      "e2e/acceptance/dts-reload-deploy.acceptance.spec.ts",
      "server/modules/dts-reload/deploy.test.ts"
    ],
    assertions: ["api"]
  },
  {
    id: "DTS-RELOAD-RESIDUE-001",
    priority: "P0",
    area: "debugging",
    route: "/dts-reload",
    roles: ["Hardware Committer", "Admin"],
    action:
      "Record reload residue after post-device-write terminals. The acceptance spec asserts residue is recorded and readable for the deployed device; the compensating restore-baseline run and clear-only-on-success rule are asserted by server tests.",
    coverage: "automated",
    acceptanceIds: ["DTS-RELOAD-RESIDUE-001"],
    specFiles: [
      "e2e/acceptance/dts-reload-deploy.acceptance.spec.ts",
      "server/modules/dts-reload/residue.test.ts",
      "server/modules/dts-reload/restoreBaseline.test.ts"
    ],
    assertions: ["api"]
  },
  {
    id: "DTS-RELOAD-DEPLOY-HW-001",
    priority: "P1",
    area: "debugging",
    route: "/dts-reload",
    roles: ["Hardware Committer", "Admin"],
    action: "Deploy a reload overlay to a real HDC target through a paired local device bridge.",
    coverage: "conditional",
    acceptanceIds: ["DTS-RELOAD-DEPLOY-HW-001"],
    specFiles: ["e2e/acceptance/dts-reload-deploy.acceptance.spec.ts"],
    assertions: ["api"],
    deferralReason: "Requires DEVICE_BRIDGE_HDC_AVAILABLE=true, a paired bridge with mountTarget/pushFile/readKernelLog, USB device, and an approved lab reload destination."
  },
  {
    id: "HDC-LAB-001",
    priority: "P1",
    area: "debugging",
    route: "/node-debugging",
    roles: ["Hardware Committer", "Admin"],
    action: "Run the real HDC device-lab read/write smoke when explicitly enabled.",
    coverage: "conditional",
    acceptanceIds: ["HDC-LAB-001"],
    specFiles: ["e2e/acceptance/hdc-device-lab.acceptance.spec.ts"],
    assertions: ["ui", "api", "audit"],
    deferralReason: "Requires DEBUG_DEVICE_GATEWAY_MODE=hdc and HDC_DEVICE_LAB_AVAILABLE=true with hardware attached."
  },
  {
    id: "ADB-LAB-001",
    priority: "P1",
    area: "debugging",
    route: "/node-debugging",
    roles: ["Hardware Committer", "Admin"],
    action: "Run the real ADB device-lab read-only smoke when explicitly enabled, with optional write/readback/rollback.",
    coverage: "conditional",
    acceptanceIds: ["ADB-LAB-001"],
    specFiles: ["e2e/acceptance/adb-device-lab.acceptance.spec.ts"],
    assertions: ["ui", "api", "audit"],
    deferralReason: "Requires DEBUG_DEVICE_GATEWAY_MODE=adb, ADB_DEVICE_LAB_AVAILABLE=true, exactly one ready ADB device, one ADB inventory row, and one shared default ADB smoke binding."
  },
  {
    id: "XIAOZE-PERCEPTION-001",
    priority: "P0",
    area: "agent",
    route: "/parameters",
    roles: ["Admin"],
    action: "Ask Xiaoze a grounded read-only question on a workflow page.",
    coverage: "automated",
    acceptanceIds: ["XIAOZE-PERCEPTION-001"],
    specFiles: ["e2e/acceptance/xiaoze-perception.acceptance.spec.ts"],
    assertions: ["ui", "api"]
  },
  {
    id: "XIAOZE-PERCEPTION-AUTHZ-001",
    priority: "P0",
    area: "agent",
    route: "/parameters",
    roles: ["Guest"],
    action: "Reject out-of-scope Xiaoze questions without leaking protected data.",
    coverage: "automated",
    acceptanceIds: ["XIAOZE-PERCEPTION-AUTHZ-001"],
    specFiles: ["e2e/acceptance/xiaoze-perception.acceptance.spec.ts"],
    assertions: ["ui", "api"]
  },
  {
    id: "XIAOZE-ACTION-APPROVE-001",
    priority: "P1",
    area: "agent",
    route: "/parameters",
    roles: ["Admin"],
    action: "Approve a Xiaoze parameter change and persist agent-audited change request.",
    coverage: "automated",
    acceptanceIds: ["XIAOZE-ACTION-APPROVE-001"],
    specFiles: ["e2e/acceptance/xiaoze-action.acceptance.spec.ts"],
    assertions: ["api", "audit"]
  },
  {
    id: "XIAOZE-ACTION-EDITEDARGS-001",
    priority: "P1",
    area: "agent",
    route: "/parameters",
    roles: ["Admin"],
    action: "Approve a Xiaoze parameter change with edited arguments and persist the edited payload.",
    coverage: "automated",
    acceptanceIds: ["XIAOZE-ACTION-EDITEDARGS-001"],
    specFiles: ["e2e/acceptance/xiaoze-action.acceptance.spec.ts"],
    assertions: ["api", "audit"]
  },
  {
    id: "XIAOZE-ACTION-REJECT-001",
    priority: "P1",
    area: "agent",
    route: "/parameters",
    roles: ["Admin"],
    action: "Reject a Xiaoze parameter change without creating a change request.",
    coverage: "automated",
    acceptanceIds: ["XIAOZE-ACTION-REJECT-001"],
    specFiles: ["e2e/acceptance/xiaoze-action.acceptance.spec.ts"],
    assertions: ["api"]
  },
  {
    id: "XIAOZE-ACTION-RESUME-001",
    priority: "P1",
    area: "agent",
    route: "/parameters",
    roles: ["Admin"],
    action: "Resume an approved Xiaoze AG-UI native mutating action without reopening a change request.",
    coverage: "automated",
    acceptanceIds: ["XIAOZE-ACTION-RESUME-001"],
    specFiles: ["e2e/acceptance/xiaoze-action.acceptance.spec.ts"],
    assertions: ["api"]
  },
  {
    id: "XIAOZE-ACTION-AUTHZ-001",
    priority: "P1",
    area: "agent",
    route: "/parameters",
    roles: ["Guest"],
    action: "Deny Xiaoze mutating approval for users without parameter edit permission.",
    coverage: "automated",
    acceptanceIds: ["XIAOZE-ACTION-AUTHZ-001"],
    specFiles: ["e2e/acceptance/xiaoze-action.acceptance.spec.ts"],
    assertions: ["api"]
  },
  {
    id: "XIAOZE-PLAN-MULTISTEP-001",
    priority: "P2",
    area: "agent",
    route: "/parameters",
    roles: ["Admin"],
    action: "Complete a multi-step Xiaoze plan through approval and checkpoint resume.",
    coverage: "automated",
    acceptanceIds: ["XIAOZE-PLAN-MULTISTEP-001"],
    specFiles: ["e2e/acceptance/xiaoze-planning.acceptance.spec.ts"],
    assertions: ["api"]
  },
  {
    id: "XIAOZE-PROACTIVE-001",
    priority: "P2",
    area: "agent",
    route: "/parameters",
    roles: ["Admin"],
    action: "Surface opt-in grounded proactive suggestions on a workflow page.",
    coverage: "automated",
    acceptanceIds: ["XIAOZE-PROACTIVE-001"],
    specFiles: ["e2e/acceptance/xiaoze-planning.acceptance.spec.ts"],
    assertions: ["api"]
  },
  {
    id: "PERM-GOV-001",
    priority: "P0",
    area: "permissions",
    route: "/user-permissions",
    roles: ["Admin"],
    action: "Load user governance, show role/status, and prevent active Admin self-disable.",
    coverage: "automated",
    acceptanceIds: ["PERM-GOV-001"],
    specFiles: ["e2e/acceptance/permissions.acceptance.spec.ts"],
    assertions: ["ui"]
  },
  {
    id: "PERM-MATRIX-001",
    priority: "P0",
    area: "permissions",
    route: "core routes",
    roles: ["Guest", "Hardware User", "Software User", "Hardware Committer", "Software Committer", "Admin"],
    action: "Enforce role inclusion rules for visible UI operations.",
    coverage: "automated",
    acceptanceIds: ["PERM-MATRIX-001"],
    specFiles: ["e2e/acceptance/permissions-matrix.acceptance.spec.ts"],
    assertions: ["ui"]
  },
  {
    id: "PERM-MATRIX-002",
    priority: "P0",
    area: "permissions",
    route: "/api/v1/parameter-submission-rounds",
    roles: ["Hardware User", "Hardware Committer", "Software Committer", "Software User", "Admin"],
    action: "Enforce role inclusion and project-scoped workflow eligibility in API-backed operations.",
    coverage: "automated",
    acceptanceIds: ["PERM-MATRIX-002"],
    specFiles: ["e2e/acceptance/permissions-matrix.acceptance.spec.ts"],
    assertions: ["api"]
  },
  {
    id: "PERM-USER-MGMT-001",
    priority: "P1",
    area: "permissions",
    route: "/user-permissions",
    roles: ["Admin"],
    action: "Admin can create or update a non-self user's role through backend governance APIs while non-Admin cannot access the same operation.",
    coverage: "automated",
    acceptanceIds: ["PERM-USER-MGMT-001"],
    specFiles: ["e2e/acceptance/permissions.acceptance.spec.ts"],
    assertions: ["ui", "api", "db", "audit"]
  },
  {
    id: "MOD-TREE-PARAM-001",
    priority: "P0",
    area: "parameters",
    route: "/parameter-admin",
    roles: ["Admin"],
    action: "Create nested parameter modules, assign a parameter to a child module, and filter by parent with subtree include.",
    coverage: "automated",
    acceptanceIds: ["MOD-TREE-PARAM-001"],
    specFiles: ["e2e/acceptance/hierarchical-modules.acceptance.spec.ts"],
    assertions: ["api", "db"]
  },
  {
    id: "MOD-TREE-PARAM-002",
    priority: "P0",
    area: "parameters",
    route: "/parameter-admin",
    roles: ["Admin"],
    action: "Move a parameter module to a new parent and reject cycle moves.",
    coverage: "automated",
    acceptanceIds: ["MOD-TREE-PARAM-002"],
    specFiles: ["e2e/acceptance/hierarchical-modules.acceptance.spec.ts"],
    assertions: ["api"]
  },
  {
    id: "MOD-TREE-DEBUG-001",
    priority: "P0",
    area: "debugging",
    route: "/debugging-admin/nodes",
    roles: ["Admin"],
    action: "Create nested debug node modules, assign a node to a child module, and filter by parent with subtree include.",
    coverage: "automated",
    acceptanceIds: ["MOD-TREE-DEBUG-001"],
    specFiles: ["e2e/acceptance/hierarchical-modules.acceptance.spec.ts"],
    assertions: ["api"]
  },
  {
    id: "MOD-TREE-AUTHZ-001",
    priority: "P0",
    area: "parameters",
    route: "/parameter-admin",
    roles: ["Hardware User", "Admin"],
    action: "Reject non-admin module tree mutations and block deleting modules that still have children or assigned parameters.",
    coverage: "automated",
    acceptanceIds: ["MOD-TREE-AUTHZ-001"],
    specFiles: ["e2e/acceptance/hierarchical-modules.acceptance.spec.ts"],
    assertions: ["api"]
  },
  {
    id: "PARAM-FILE-UPLOAD-001",
    priority: "P1",
    area: "parameters",
    route: "/parameter-admin/projects",
    roles: ["Admin"],
    action: "Upload a JSON project parameter file and list it with version metadata.",
    coverage: "automated",
    acceptanceIds: ["PARAM-FILE-ADMIN-001"],
    specFiles: ["e2e/acceptance/parameter-files.acceptance.spec.ts"],
    assertions: ["ui", "api", "db"]
  },
  {
    id: "PARAM-FILE-SYNC-001",
    priority: "P1",
    area: "parameters",
    route: "/api/v1/projects/:projectId/parameter-files/:fileId/sync",
    roles: ["Admin"],
    action: "Manual file sync creates a file_sync draft when parsed file value differs from the current DB value.",
    coverage: "automated",
    acceptanceIds: ["PARAM-FILE-ADMIN-001"],
    specFiles: ["e2e/acceptance/parameter-files.acceptance.spec.ts"],
    assertions: ["api", "db"]
  },
  {
    id: "PARAM-FILE-RESOLVE-001",
    priority: "P1",
    area: "parameters",
    route: "/api/v1/projects/:projectId/parameter-file-conflicts/:conflictId/resolve",
    roles: ["Admin"],
    action: "Resolve an open file/UI draft conflict by keeping the file or UI draft value.",
    coverage: "automated",
    acceptanceIds: ["PARAM-FILE-CONFLICT-001"],
    specFiles: ["e2e/acceptance/parameter-files.acceptance.spec.ts"],
    assertions: ["api", "db"]
  },
  {
    id: "PARAM-DTS-STRUCTURE-001",
    priority: "P1",
    area: "parameters",
    route: "/api/v1/projects/:projectId/parameter-files/:fileId/versions/:versionId/structure",
    roles: ["Admin"],
    action: "Read structured DTS nodes, typed properties, and phandle refs for a uploaded file version.",
    coverage: "automated",
    acceptanceIds: ["PARAM-DTS-STRUCTURE-001"],
    specFiles: ["e2e/acceptance/dts-structured.acceptance.spec.ts"],
    assertions: ["api"]
  },
  {
    id: "PARAM-DTS-EDIT-001",
    priority: "P1",
    area: "parameters",
    route: "/api/v1/projects/:projectId/parameter-files/:fileId/versions/:versionId/structure",
    roles: ["Admin"],
    action: "Confirm structure payload carries typed properties (valueType/rawText) consumed by StructuredValueEditor.",
    coverage: "automated",
    acceptanceIds: ["PARAM-DTS-EDIT-001"],
    specFiles: ["e2e/acceptance/dts-structured.acceptance.spec.ts"],
    assertions: ["api"]
  },
  {
    id: "PARAM-DTS-EDIT-002",
    priority: "P1",
    area: "parameters",
    route: "/api/v1/projects/:projectId/dts-structured-edits/submit",
    roles: ["Admin"],
    action: "Submit structured edits as change requests with rawText fidelity, advance review to merge, and verify CST writeback preserves rawText.",
    coverage: "automated",
    acceptanceIds: ["PARAM-DTS-EDIT-002"],
    specFiles: ["e2e/acceptance/dts-structured.acceptance.spec.ts"],
    assertions: ["api", "ui", "db"]
  },
  {
    id: "PARAM-DTS-CONFIGSET-001",
    priority: "P1",
    area: "parameters",
    route: "/parameter-admin/projects",
    roles: ["Admin"],
    action: "Create a config set and baseline via API and open the configuration workbench (`/parameter-admin/projects/:id/configuration?inspector=config-set`).",
    coverage: "automated",
    acceptanceIds: ["PARAM-DTS-CONFIGSET-001"],
    specFiles: ["e2e/acceptance/dts-structured.acceptance.spec.ts"],
    assertions: ["ui", "api"]
  },
  {
    id: "PARAM-DTS-DIFF-001",
    priority: "P1",
    area: "parameters",
    route: "/api/v1/projects/:projectId/baselines/:baselineId/compare",
    roles: ["Admin"],
    action: "Compare a release baseline and surface structured member diffs / change-set payload.",
    coverage: "automated",
    acceptanceIds: ["PARAM-DTS-DIFF-001"],
    specFiles: ["e2e/acceptance/dts-structured.acceptance.spec.ts"],
    assertions: ["api", "ui"]
  },
  {
    id: "PARAM-DTS-SEARCH-001",
    priority: "P1",
    area: "parameters",
    route: "/api/v1/projects/:projectId/dts-search",
    roles: ["Admin"],
    action: "Search structured DTS nodes by path on the configuration workbench (`/parameter-admin/projects/:id/configuration`).",
    coverage: "automated",
    acceptanceIds: ["PARAM-DTS-SEARCH-001"],
    specFiles: ["e2e/acceptance/dts-structured.acceptance.spec.ts"],
    assertions: ["ui", "api"]
  },
  {
    id: "PARAM-DTS-IMPACT-001",
    priority: "P1",
    area: "parameters",
    route: "/api/v1/parameter-change-requests",
    roles: ["Admin", "Hardware Committer"],
    action: "Submit a source-bound parameter change and assert impact includes structural kinds when DTS facts exist.",
    coverage: "automated",
    acceptanceIds: ["PARAM-DTS-IMPACT-001"],
    specFiles: ["e2e/acceptance/dts-structured.acceptance.spec.ts"],
    assertions: ["api"]
  },
  {
    id: "PARAM-DTS-RBAC-001",
    priority: "P0",
    area: "parameters",
    route: "/api/v1/parameter-submission-rounds",
    roles: ["Hardware User", "Admin"],
    action: "Reject sensitive-node submits without parameter:edit-critical and assert critical agent deny semantics.",
    coverage: "automated",
    acceptanceIds: ["PARAM-DTS-RBAC-001"],
    specFiles: ["e2e/acceptance/dts-structured.acceptance.spec.ts"],
    assertions: ["api", "db"]
  },
  {
    id: "PARAM-SPEC-GOVERN-001",
    priority: "P1",
    area: "parameters",
    route: "/parameter-admin",
    roles: ["Admin"],
    action: "Search ingested parameter specs, open detail, and confirm unmatched surface props stay provisional without review tasks.",
    coverage: "automated",
    acceptanceIds: ["PARAM-SPEC-GOVERN-001"],
    specFiles: ["e2e/acceptance/parameter-topology.acceptance.spec.ts"],
    assertions: ["ui", "api", "db"]
  },
  {
    id: "PARAM-ADMIN-IA-001",
    priority: "P1",
    area: "parameters",
    route: "/parameter-admin/specs",
    roles: ["Admin"],
    action: "Organization sub-nav offers definition management and module management; review queue embeds under specs; identity mapping nests and redirects from legacy routes.",
    coverage: "future",
    acceptanceIds: ["PARAM-ADMIN-IA-001"],
    specFiles: [],
    deferralReason: "Unit-covered in ParameterAdminNextPage and organization path tests; dedicated Playwright marker deferred.",
    assertions: ["ui"]
  },
  {
    id: "PARAM-TOPOLOGY-BROWSE-001",
    priority: "P0",
    area: "parameters",
    route: "/parameters",
    roles: ["Admin", "Hardware User"],
    action: "Toggle real source/effective trees, search two gpio_int bindings, and require topology API 200 with expected nodes.",
    coverage: "automated",
    acceptanceIds: ["PARAM-TOPOLOGY-BROWSE-001"],
    specFiles: ["e2e/acceptance/parameter-topology.acceptance.spec.ts"],
    assertions: ["ui", "api"]
  },
  {
    id: "PARAM-TOPOLOGY-EDIT-001",
    priority: "P0",
    area: "parameters",
    route: "/parameters",
    roles: ["Software User", "Hardware Committer", "Software Committer", "Admin"],
    action: "Apply typed binding drafts with schema diagnostics, reject stale revisions with 409, submit through UI, and fail-closed semantic merge/writeback validation.",
    coverage: "automated",
    acceptanceIds: ["PARAM-TOPOLOGY-EDIT-001"],
    specFiles: ["e2e/acceptance/parameter-topology.acceptance.spec.ts"],
    assertions: ["ui", "api", "db", "audit"]
  },
  {
    id: "PARAM-IDENTITY-MAP-001",
    priority: "P1",
    area: "parameters",
    route: "/parameters",
    roles: ["Admin"],
    action: "Block validate on open identity mapping, then resolve the mapping task with audit evidence.",
    coverage: "automated",
    acceptanceIds: ["PARAM-IDENTITY-MAP-001"],
    specFiles: ["e2e/acceptance/parameter-topology.acceptance.spec.ts"],
    assertions: ["ui", "api", "db", "audit"]
  },
  {
    id: "PARAM-IDENTITY-MAP-ADMIN-001",
    priority: "P1",
    area: "parameters",
    route: "/parameter-admin",
    roles: ["Admin"],
    action:
      "Resolve identity mapping tasks from the parameter admin with evidence and governance audit.",
    coverage: "automated",
    acceptanceIds: ["PARAM-IDENTITY-MAP-ADMIN-001"],
    specFiles: ["e2e/acceptance/parameter-topology.acceptance.spec.ts"],
    assertions: ["ui", "api", "db", "audit"]
  },
  {
    id: "PARAM-CONFIG-PUBLISH-GATE-001",
    priority: "P0",
    area: "parameters",
    route: "/parameters",
    roles: ["Admin"],
    action: "Validate a clean config revision via real toolchain and persist bindingId plus value across reload.",
    coverage: "automated",
    acceptanceIds: ["PARAM-CONFIG-PUBLISH-GATE-001"],
    specFiles: ["e2e/acceptance/parameter-topology.acceptance.spec.ts"],
    assertions: ["ui", "api", "db", "audit"]
  },
  {
    id: "PARAM-ENABLE-GATE-001",
    priority: "P1",
    area: "parameters",
    route: "/parameters",
    roles: ["Admin"],
    action: "Structural properties do not create spec review tasks or block candidate promotion or migration finalize.",
    coverage: "future",
    acceptanceIds: ["PARAM-ENABLE-GATE-001"],
    specFiles: ["e2e/acceptance/parameter-topology.acceptance.spec.ts"],
    deferralReason: "Browser automation placeholder only; pending disposable-DB / Playwright coverage before gating CI.",
    assertions: ["api", "db"]
  },
  {
    id: "PARAM-ENABLE-VISIBLE-001",
    priority: "P0",
    area: "parameters",
    route: "/parameters",
    roles: ["Admin", "Hardware User"],
    action: "Browse topology enablement badges and workbench no-effect notices for disabled nodes.",
    coverage: "future",
    acceptanceIds: ["PARAM-ENABLE-VISIBLE-001"],
    specFiles: ["e2e/acceptance/parameter-topology.acceptance.spec.ts"],
    deferralReason: "Browser automation placeholder only; pending disposable-DB / Playwright coverage before gating CI.",
    assertions: ["ui", "api"]
  },
  {
    id: "PARAM-ENABLE-TOGGLE-001",
    priority: "P0",
    area: "parameters",
    route: "/parameters",
    roles: ["Software User", "Admin"],
    action: "Disable a node with reason and confirmation; submit enablement draft in the same round as a binding edit.",
    coverage: "future",
    acceptanceIds: ["PARAM-ENABLE-TOGGLE-001"],
    specFiles: ["e2e/acceptance/parameter-topology.acceptance.spec.ts"],
    deferralReason: "Browser automation placeholder only; pending disposable-DB / Playwright coverage before gating CI.",
    assertions: ["ui", "api", "db", "audit"]
  },
  {
    id: "PARAM-ENABLE-GUARD-001",
    priority: "P1",
    area: "parameters",
    route: "/parameters",
    roles: ["Admin"],
    action: "Non-standard status values stay read-only until an explicit acknowledgement override.",
    coverage: "future",
    acceptanceIds: ["PARAM-ENABLE-GUARD-001"],
    specFiles: ["e2e/acceptance/parameter-topology.acceptance.spec.ts"],
    deferralReason: "Browser automation placeholder only; pending disposable-DB / Playwright coverage before gating CI.",
    assertions: ["ui"]
  },
  {
    id: "MOD-ATTR-QUEUE-001",
    priority: "P1",
    area: "parameters",
    route: "/parameter-admin",
    roles: ["Admin"],
    action:
      "Browse the unclassified compatible queue with parameter/project counts; dismiss and restore entries with audit.",
    coverage: "future",
    acceptanceIds: ["MOD-ATTR-QUEUE-001"],
    specFiles: ["e2e/acceptance/parameter-topology.acceptance.spec.ts"],
    deferralReason: "Browser automation placeholder only; pending disposable-DB / Playwright coverage before gating CI.",
    assertions: ["ui", "api", "audit"]
  },
  {
    id: "MOD-ATTR-CLASSIFY-001",
    priority: "P1",
    area: "parameters",
    route: "/parameter-admin",
    roles: ["Admin"],
    action:
      "Classify one compatible with impact preview, confirm scoped apply, and collect emptied unclassified buckets.",
    coverage: "future",
    acceptanceIds: ["MOD-ATTR-CLASSIFY-001"],
    specFiles: ["e2e/acceptance/parameter-topology.acceptance.spec.ts"],
    deferralReason: "Browser automation placeholder only; pending disposable-DB / Playwright coverage before gating CI.",
    assertions: ["ui", "api", "audit"]
  },
  {
    id: "MOD-ATTR-BULK-001",
    priority: "P1",
    area: "parameters",
    route: "/parameter-admin",
    roles: ["Admin"],
    action: "Bulk-select compatibles and file them into one business category in a single confirm.",
    coverage: "future",
    acceptanceIds: ["MOD-ATTR-BULK-001"],
    specFiles: ["e2e/acceptance/parameter-topology.acceptance.spec.ts"],
    deferralReason: "Browser automation placeholder only; pending disposable-DB / Playwright coverage before gating CI.",
    assertions: ["ui", "api", "audit"]
  },
  {
    id: "MOD-ATTR-TREE-001",
    priority: "P1",
    area: "parameters",
    route: "/parameter-admin",
    roles: ["Admin"],
    action:
      "Exercise kind-scoped tree actions: no delete on node-type or driver-group nodes, move allowed on node-type, rename adopts auto modules, adopted names survive re-ingest.",
    coverage: "future",
    acceptanceIds: ["MOD-ATTR-TREE-001"],
    specFiles: ["e2e/acceptance/parameter-topology.acceptance.spec.ts"],
    deferralReason: "Browser automation placeholder only; pending disposable-DB / Playwright coverage before gating CI.",
    assertions: ["ui", "api"]
  },
  {
    id: "MOD-ATTR-RECLASSIFY-001",
    priority: "P1",
    area: "parameters",
    route: "/parameter-admin",
    roles: ["Admin"],
    action:
      "Reclassify a node-type module to business via the edit dialog; verify kind badge/filters and that re-ingest keeps the curated kind.",
    coverage: "future",
    acceptanceIds: ["MOD-ATTR-RECLASSIFY-001"],
    specFiles: ["e2e/acceptance/parameter-topology.acceptance.spec.ts"],
    deferralReason: "Browser automation placeholder only; pending disposable-DB / Playwright coverage before gating CI.",
    assertions: ["ui", "api"]
  },
  {
    id: "MOD-ATTR-IMPORTANCE-001",
    priority: "P1",
    area: "parameters",
    route: "/parameter-admin",
    roles: ["Admin"],
    action:
      "Set importance on a business category and confirm inheritance on driver groups/node-type units and the workbench filter.",
    coverage: "future",
    acceptanceIds: ["MOD-ATTR-IMPORTANCE-001"],
    specFiles: ["e2e/acceptance/parameter-topology.acceptance.spec.ts"],
    deferralReason: "Browser automation placeholder only; pending disposable-DB / Playwright coverage before gating CI.",
    assertions: ["ui", "api"]
  },
  {
    id: "DRV-REG-001",
    priority: "P1",
    area: "parameters",
    route: "/parameter-admin",
    roles: ["Admin"],
    action:
      "Register a driver before any upload and confirm it appears as a not-yet-observed curated driver group with a parse-coverage chip in the tree.",
    coverage: "future",
    acceptanceIds: ["DRV-REG-001"],
    specFiles: ["e2e/acceptance/parameter-topology.acceptance.spec.ts"],
    deferralReason: "Browser automation placeholder only; pending disposable-DB / Playwright coverage before gating CI.",
    assertions: ["ui", "api"]
  },
  {
    id: "DRV-REG-002",
    priority: "P1",
    area: "parameters",
    route: "/parameter-admin",
    roles: ["Admin"],
    action:
      "Claim an observed-but-unregistered driver from the queue or module tree and confirm origin becomes curated.",
    coverage: "future",
    acceptanceIds: ["DRV-REG-002"],
    specFiles: ["e2e/acceptance/parameter-topology.acceptance.spec.ts"],
    deferralReason: "Browser automation placeholder only; pending disposable-DB / Playwright coverage before gating CI.",
    assertions: ["ui", "api"]
  },
  {
    id: "DRV-REG-003",
    priority: "P1",
    area: "parameters",
    route: "/parameter-admin",
    roles: ["Admin"],
    action:
      "Upload a DTS and confirm the one-shot ingest summary reports matched registered drivers and new unregistered compatibles.",
    coverage: "future",
    acceptanceIds: ["DRV-REG-003"],
    specFiles: ["e2e/acceptance/parameter-topology.acceptance.spec.ts"],
    deferralReason: "Browser automation placeholder only; pending disposable-DB / Playwright coverage before gating CI.",
    assertions: ["ui", "api"]
  },
  {
    id: "DRV-REG-004",
    priority: "P1",
    area: "parameters",
    route: "/parameter-admin",
    roles: ["Admin", "Platform Admin"],
    action:
      "Edit driverNature / instanceCardinality on an org registration; confirm platform-admin edits appear in org audit, Org Admin cannot edit platform-tier subjects, and singleton-per-project only opens/refreshes publish blockers.",
    coverage: "future",
    acceptanceIds: ["DRV-REG-004"],
    specFiles: ["e2e/acceptance/parameter-topology.acceptance.spec.ts"],
    deferralReason:
      "Unit/server coverage lands with PR1; browser e2e pending disposable-DB / Playwright evidence before gating CI.",
    assertions: ["ui", "api", "audit"]
  },
  {
    id: "DRV-SCHEMA-001",
    priority: "P1",
    area: "parameters",
    route: "/parameter-admin",
    roles: ["Admin"],
    action:
      "Author and activate an organization overlay schema from an uncovered driver group; confirm the coverage chip shows organization coverage.",
    coverage: "future",
    acceptanceIds: ["DRV-SCHEMA-001"],
    specFiles: ["e2e/acceptance/parameter-topology.acceptance.spec.ts"],
    deferralReason: "Browser automation placeholder only; pending disposable-DB / Playwright coverage before gating CI.",
    assertions: ["ui", "api"]
  },
  {
    id: "DRV-SCHEMA-002",
    priority: "P1",
    area: "parameters",
    route: "/parameter-admin",
    roles: ["Admin"],
    action:
      "Upload a DTS claimed only by an active organization overlay and confirm typed bindings without unmatched review tasks for defined properties.",
    coverage: "future",
    acceptanceIds: ["DRV-SCHEMA-002"],
    specFiles: ["e2e/acceptance/parameter-topology.acceptance.spec.ts"],
    deferralReason: "Browser automation placeholder only; pending disposable-DB / Playwright coverage before gating CI.",
    assertions: ["ui", "api"]
  },
  {
    id: "DRV-SCHEMA-003",
    priority: "P1",
    area: "parameters",
    route: "/parameter-admin",
    roles: ["Admin"],
    action:
      "Attempt to activate an overlay for a compatible already covered by a pinned schema and confirm a clear rejection.",
    coverage: "future",
    acceptanceIds: ["DRV-SCHEMA-003"],
    specFiles: ["e2e/acceptance/parameter-topology.acceptance.spec.ts"],
    deferralReason: "Browser automation placeholder only; pending disposable-DB / Playwright coverage before gating CI.",
    assertions: ["ui", "api"]
  },
  {
    id: "DRV-SCHEMA-004",
    priority: "P1",
    area: "parameters",
    route: "/parameter-admin",
    roles: ["Admin"],
    action:
      "Activate an overlay for an already-uploaded device and confirm provisional specs upgrade in place without re-upload.",
    coverage: "future",
    acceptanceIds: ["DRV-SCHEMA-004"],
    specFiles: ["e2e/acceptance/parameter-topology.acceptance.spec.ts"],
    deferralReason: "Browser automation placeholder only; pending disposable-DB / Playwright coverage before gating CI.",
    assertions: ["ui", "api"]
  },
  {
    id: "MOD-ATTR-CREATE-KIND-001",
    priority: "P1",
    area: "parameters",
    route: "/parameter-admin",
    roles: ["Admin"],
    action:
      "Create empty business or driver-group modules from the attribution tree with parent-kind rules and required driver-group compatibles; confirm empty curated nodes show not-yet-observed (node-type is ingest-only).",
    coverage: "future",
    acceptanceIds: ["MOD-ATTR-CREATE-KIND-001"],
    specFiles: ["e2e/acceptance/parameter-topology.acceptance.spec.ts"],
    deferralReason: "Browser automation placeholder only; pending disposable-DB / Playwright coverage before gating CI.",
    assertions: ["ui", "api"]
  },
  {
    id: "PLAT-ROLE-001",
    priority: "P1",
    area: "platform",
    route: "/platform-console",
    roles: ["Platform Admin"],
    action: "Open platform console from sidebar and confirm access; other roles denied.",
    coverage: "automated",
    acceptanceIds: ["PLAT-ROLE-001"],
    specFiles: ["e2e/acceptance/permissions-matrix.acceptance.spec.ts"],
    assertions: ["ui"]
  },
  {
    id: "PLAT-ROLE-002",
    priority: "P1",
    area: "platform",
    route: "/user-permissions",
    roles: ["Admin"],
    action: "Confirm platform-admin grant control is hidden and API rejects self-grant.",
    coverage: "automated",
    acceptanceIds: ["PLAT-ROLE-002"],
    specFiles: ["e2e/acceptance/permissions-matrix.acceptance.spec.ts"],
    assertions: ["ui", "api"]
  },
  {
    id: "PLAT-ROLE-003",
    priority: "P1",
    area: "platform",
    route: "/api/v1/users",
    roles: ["Platform Admin"],
    action: "Confirm platform-admin user listing stays home-organization scoped.",
    coverage: "automated",
    acceptanceIds: ["PLAT-ROLE-003"],
    specFiles: ["e2e/acceptance/permissions-matrix.acceptance.spec.ts"],
    assertions: ["api"]
  },
  {
    id: "DRV-PROMOTE-005",
    priority: "P1",
    area: "platform",
    route: "/platform-console",
    roles: ["Platform Admin"],
    action: "Promote compatible with blast-radius confirmation and revert to restore contributors.",
    coverage: "manual",
    acceptanceIds: ["DRV-PROMOTE-005"],
    specFiles: [],
    deferralReason:
      "Multi-org promote fixtures are not in local seed; blast-radius UI smoke archived under work/ui-checks/governance-closeout-* per 2026-08-01 closeout plan.",
    assertions: ["ui", "api"]
  },
  {
    id: "SPEC-DEPRECATE-001",
    priority: "P1",
    area: "parameters",
    route: "/parameter-admin/specs",
    roles: ["Admin"],
    action: "Soft-deprecate a definition with reason and confirm it leaves the default library.",
    coverage: "future",
    acceptanceIds: ["SPEC-DEPRECATE-001"],
    specFiles: [],
    deferralReason: "Covered by unit tests today; Playwright path deferred to a follow-up after closeout browser smoke.",
    assertions: ["ui", "api"]
  },
  {
    id: "SPEC-RESTORE-001",
    priority: "P1",
    area: "parameters",
    route: "/parameter-admin/specs",
    roles: ["Admin"],
    action: "Restore a deprecated definition to the activated_at-implied state.",
    coverage: "future",
    acceptanceIds: ["SPEC-RESTORE-001"],
    specFiles: [],
    deferralReason: "Unit-covered; Playwright deferred after closeout smoke.",
    assertions: ["ui", "api"]
  },
  {
    id: "SPEC-EDIT-DIFF-001",
    priority: "P2",
    area: "parameters",
    route: "/parameter-admin/specs",
    roles: ["Admin"],
    action: "Show value_shape/constraints diff before saving an active definition.",
    coverage: "future",
    acceptanceIds: ["SPEC-EDIT-DIFF-001"],
    specFiles: [],
    deferralReason: "Unit-covered; Playwright deferred after closeout smoke.",
    assertions: ["ui"]
  },
  {
    id: "IDMAP-NEWID-001",
    priority: "P1",
    area: "parameters",
    route: "/parameter-admin/specs/identity-mapping",
    roles: ["Admin"],
    action: "Confirm-as-new-identity releases revision; remaining rejection keeps it blocked.",
    coverage: "future",
    acceptanceIds: ["IDMAP-NEWID-001"],
    specFiles: [],
    deferralReason: "Unit/server covered; dedicated Playwright marker deferred.",
    assertions: ["ui", "api"]
  },
  {
    id: "IDMAP-HISTORY-001",
    priority: "P2",
    area: "parameters",
    route: "/parameter-admin/specs/identity-mapping",
    roles: ["Admin"],
    action: "Browse non-open identity mapping history outcomes.",
    coverage: "future",
    acceptanceIds: ["IDMAP-HISTORY-001"],
    specFiles: [],
    deferralReason: "Browser smoke in closeout; automated marker deferred.",
    assertions: ["ui"]
  },
  {
    id: "IDMAP-REOPEN-001",
    priority: "P2",
    area: "parameters",
    route: "/parameter-admin/specs/identity-mapping",
    roles: ["Admin"],
    action: "Reopen non-destructive mapping outcomes; refuse reopen on resolved.",
    coverage: "future",
    acceptanceIds: ["IDMAP-REOPEN-001"],
    specFiles: [],
    deferralReason: "Server unit covered; Playwright deferred.",
    assertions: ["ui", "api"]
  },
  {
    id: "MOD-QUEUE-RESTORE-001",
    priority: "P2",
    area: "parameters",
    route: "/parameter-admin/modules",
    roles: ["Admin"],
    action: "Restore a dismissed unclassified compatible from Admin.",
    coverage: "future",
    acceptanceIds: ["MOD-QUEUE-RESTORE-001"],
    specFiles: [],
    deferralReason: "Browser smoke in closeout; automated marker deferred.",
    assertions: ["ui", "api"]
  },
  {
    id: "OVERLAY-RETIRE-001",
    priority: "P1",
    area: "parameters",
    route: "/parameter-admin/modules",
    roles: ["Admin"],
    action: "Show parse-coverage impact before retiring an overlay.",
    coverage: "future",
    acceptanceIds: ["OVERLAY-RETIRE-001"],
    specFiles: [],
    deferralReason: "Browser smoke in closeout; automated marker deferred.",
    assertions: ["ui", "api"]
  },
  {
    id: "MOD-ATTR-SORT-001",
    priority: "P2",
    area: "parameters",
    route: "/parameter-admin/modules",
    roles: ["Admin"],
    action: "Reorder modules with up/down actions via sortOrder PATCH.",
    coverage: "future",
    acceptanceIds: ["MOD-ATTR-SORT-001"],
    specFiles: [],
    deferralReason: "Browser smoke in closeout; automated marker deferred.",
    assertions: ["ui", "api"]
  }
];
