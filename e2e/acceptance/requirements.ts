export type AcceptanceWorkflowId = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I";

export type AcceptanceRequirement = {
  id: string;
  workflow: AcceptanceWorkflowId;
  title: string;
  required: boolean;
};

export const acceptanceRequirements: AcceptanceRequirement[] = [
  {
    id: "AUTH-RUNTIME-001",
    workflow: "A",
    title: "API-mode browser runtime loads current user with the same auth contract used by local dev.",
    required: true
  },
  {
    id: "NOTIF-INBOX-001",
    workflow: "A",
    title: "TopBar notification bell opens the inbox panel and inbox APIs load for the current user.",
    required: true
  },
  {
    id: "NOTIF-READ-001",
    workflow: "A",
    title: "Notifications can be marked read through the backend inbox API.",
    required: true
  },
  {
    id: "PFB-SUBMIT-001",
    workflow: "I",
    title: "Active user submits product feedback from the sidebar with description and optional images; API persists it and the UI shows success.",
    required: true
  },
  {
    id: "PFB-ADMIN-001",
    workflow: "I",
    title: "Admin lists product feedback, opens detail, advances open to in_progress to closed, and sets an admin note.",
    required: true
  },
  {
    id: "PFB-AUTHZ-001",
    workflow: "I",
    title: "Non-Admin users cannot access product feedback admin APIs or the feedback-admin page.",
    required: true
  },
  {
    id: "SHELL-DIAG-001",
    workflow: "A",
    title: "Core routes fail acceptance on unexpected console, page, request, or critical API errors.",
    required: true
  },
  {
    id: "PARAM-REASON-001",
    workflow: "B",
    title: "Parameter drafts cannot be submitted with an empty or blank reason.",
    required: true
  },
  {
    id: "PARAM-ASSIGNEE-001",
    workflow: "B",
    title: "Parameter submission defaults to eligible assignees for every workflow slot.",
    required: true
  },
  {
    id: "PARAM-ASSIGNEE-002",
    workflow: "B",
    title: "Parameter submission dropdowns hide inactive, guest, admin-only, and role-ineligible users.",
    required: true
  },
  {
    id: "PARAM-ASSIGNEE-003",
    workflow: "B",
    title: "Forced invalid workflow assignees are rejected by the API and surfaced by the UI.",
    required: true
  },
  {
    id: "PARAM-HAPPY-001",
    workflow: "B",
    title: "Parameter search, draft, submit, review, merge, persistence, and audit happy path works.",
    required: true
  },
  {
    id: "PARAM-HOME-001",
    workflow: "B",
    title: "Parameter home dashboard loads summary and hotspots from API data and supports in-page window and dimension controls.",
    required: true
  },
  {
    id: "PARAM-ADMIN-001",
    workflow: "C",
    title: "Parameter admin import preview and audit drawer remain available to Admin.",
    required: true
  },
  {
    id: "PARAM-ADMIN-002",
    workflow: "C",
    title: "Admin can run the five-step parameter import wizard with target project selection, multi-format source, per-row review, batch preview, and apply.",
    required: false
  },
  {
    id: "PARAM-IMPORT-DTS-FULL-001",
    workflow: "C",
    title: "Admin full .dts import uses server parse-dts with distinct @address module paths; /include/ is rejected.",
    required: true
  },
  {
    id: "PARAM-IMPORT-REVIEW-META-001",
    workflow: "C",
    title: "Import preview with reviewMetadata.skippedRows persists that structure on batch-import audit metadata.",
    required: true
  },
  {
    id: "PARAM-DRAFT-EDIT-001",
    workflow: "B",
    title: "Parameter draft edit and remove operations work before final submission.",
    required: true
  },
  {
    id: "PARAM-REJECT-001",
    workflow: "B",
    title: "Parameter rejection records status, reason, and audit evidence.",
    required: true
  },
  {
    id: "LOG-HAPPY-001",
    workflow: "D",
    title: "Log upload, analysis progress, evidence, feedback, archive, and unsupported-file path work.",
    required: true
  },
  {
    id: "LOG-REANALYZE-001",
    workflow: "D",
    title: "Log reanalysis creates a new run with progress and audit evidence.",
    required: true
  },
  {
    id: "DEBUG-SIM-001",
    workflow: "E",
    title: "Simulator read, write, mismatch, rollback, and audit path work, including complex JSON value metadata.",
    required: true
  },
  {
    id: "DEBUG-PERM-001",
    workflow: "E",
    title: "Debugging write controls are hidden or blocked for roles without write permission.",
    required: true
  },
  {
    id: "DEBUG-ADMIN-001",
    workflow: "E",
    title: "Debugging admin can create, edit, archive, restore, and protocol-bind catalog parameters in API mode, including complex value metadata.",
    required: true
  },
  {
    id: "BRIDGE-WIN-001",
    workflow: "E",
    title: "Windows-first local bridge panel covers missing/pairing/startup/online states with same-origin download CTA.",
    required: false
  },
  {
    id: "BRIDGE-HDC-001",
    workflow: "E",
    title: "Real paired bridge HDC detect smoke runs when DEVICE_BRIDGE_HDC_AVAILABLE is enabled.",
    required: false
  },
  {
    id: "HDC-LAB-001",
    workflow: "F",
    title: "Real HDC device lab read/write smoke runs when explicitly enabled.",
    required: false
  },
  {
    id: "ADB-LAB-001",
    workflow: "F",
    title: "Real ADB device lab read-only smoke runs when explicitly enabled, with optional write and rollback.",
    required: false
  },
  {
    id: "XIAOZE-PERCEPTION-001",
    workflow: "G",
    title: "Xiaoze answers grounded read-only questions using page context and perception tools.",
    required: true
  },
  {
    id: "XIAOZE-PERCEPTION-AUTHZ-001",
    workflow: "G",
    title: "Out-of-scope Xiaoze questions return a safe non-data answer.",
    required: true
  },
  {
    id: "XIAOZE-ACTION-APPROVE-001",
    workflow: "G",
    title: "Xiaoze parameter change approval executes through the agent audit chain.",
    required: true
  },
  {
    id: "XIAOZE-ACTION-REJECT-001",
    workflow: "G",
    title: "Rejecting a Xiaoze action approval does not mutate parameter state.",
    required: true
  },
  {
    id: "XIAOZE-ACTION-AUTHZ-001",
    workflow: "G",
    title: "Users without edit permission cannot approve Xiaoze mutating actions.",
    required: true
  },
  {
    id: "XIAOZE-ACTION-RESUME-001",
    workflow: "G",
    title: "Xiaoze AG-UI native resume continues an approved mutating action without reopening a change request.",
    required: true
  },
  {
    id: "XIAOZE-PLAN-MULTISTEP-001",
    workflow: "G",
    title: "Xiaoze resumes a multi-step plan after approval and reports the observed execution result.",
    required: true
  },
  {
    id: "XIAOZE-PROACTIVE-001",
    workflow: "G",
    title: "Opt-in Xiaoze proactive suggestions are read-only, authz-bounded, and absent when disabled.",
    required: true
  },
  {
    id: "PERM-GOV-001",
    workflow: "H",
    title: "User governance page is Admin-only and active Admin cannot disable itself.",
    required: true
  },
  {
    id: "PERM-MATRIX-001",
    workflow: "H",
    title: "Role inclusion rules are enforced for visible UI operations.",
    required: true
  },
  {
    id: "PERM-MATRIX-002",
    workflow: "H",
    title: "Role inclusion and project-scoped workflow eligibility are enforced by API-backed operations.",
    required: true
  },
  {
    id: "PERM-USER-MGMT-001",
    workflow: "H",
    title: "Admin user-management mutation is covered with non-Admin denial and audit evidence.",
    required: true
  },
  {
    id: "MOD-TREE-PARAM-001",
    workflow: "C",
    title: "Admin creates nested parameter modules, assigns a parameter, and parent filtering includes the child subtree.",
    required: true
  },
  {
    id: "MOD-TREE-PARAM-002",
    workflow: "C",
    title: "Admin moves a parameter module to a new parent and cycle moves are rejected.",
    required: true
  },
  {
    id: "MOD-TREE-DEBUG-001",
    workflow: "E",
    title: "Admin creates nested debug node modules and parent filtering includes assigned child nodes.",
    required: true
  },
  {
    id: "MOD-TREE-AUTHZ-001",
    workflow: "C",
    title: "Non-admin cannot mutate module trees and deleting non-empty modules returns 409.",
    required: true
  },
  {
    id: "PARAM-FILE-ADMIN-001",
    workflow: "C",
    title: "Admin uploads a project parameter file, lists versions, and manual sync creates a file_sync draft with source binding.",
    required: true
  },
  {
    id: "PARAM-FILE-CONFLICT-001",
    workflow: "C",
    title: "Admin resolves an open file/UI draft conflict by keeping the file or UI value.",
    required: true
  },
  {
    id: "PARAM-DTS-STRUCTURE-001",
    workflow: "C",
    title: "Admin can read the structured DTS model (nodes/properties/phandles) for a file version.",
    required: true
  },
  {
    id: "PARAM-DTS-EDIT-001",
    workflow: "C",
    title: "Structured value editor contract is served by typed structure properties (value_type / rawText).",
    required: true
  },
  {
    id: "PARAM-DTS-EDIT-002",
    workflow: "C",
    title: "Structured edit submits a change request with rawText fidelity, advances review to merge, and CST writeback preserves rawText (no normalized rewrite).",
    required: true
  },
  {
    id: "PARAM-DTS-CONFIGSET-001",
    workflow: "C",
    title: "Admin can manage config sets and release baselines from the projects file dialog (workflow C).",
    required: true
  },
  {
    id: "PARAM-DTS-DIFF-001",
    workflow: "C",
    title: "Baseline compare returns structured diffs that render as a change-set view.",
    required: true
  },
  {
    id: "PARAM-DTS-SEARCH-001",
    workflow: "C",
    title: "Project DTS structured search returns hits by path/address/label/compatible/value and the search panel mounts.",
    required: true
  },
  {
    id: "PARAM-DTS-IMPACT-001",
    workflow: "B",
    title: "Change-request impact includes structural kinds (phandle/compatible/config-set) when DTS bindings exist.",
    required: true
  },
  {
    id: "PARAM-DTS-RBAC-001",
    workflow: "C",
    title: "Sensitive-node writes without parameter:edit-critical return 403; agent writes to critical nodes are denied.",
    required: true
  },
  {
    id: "PARAM-SPEC-GOVERN-001",
    workflow: "C",
    title: "Admin can search parameter specs, open detail, and resolve inference review tasks with audit evidence.",
    required: true
  },
  {
    id: "PARAM-TOPOLOGY-BROWSE-001",
    workflow: "B",
    title: "Users can toggle source/effective topology, search two gpio_int bindings, and open binding detail without path-as-identity.",
    required: true
  },
  {
    id: "PARAM-TOPOLOGY-EDIT-001",
    workflow: "B",
    title: "Typed binding edits surface schema diagnostics and reject stale base-revision edits.",
    required: true
  },
  {
    id: "PARAM-IDENTITY-MAP-001",
    workflow: "B",
    title: "Unresolved overlay targets and open identity mapping tasks block publish until resolved.",
    required: true
  },
  {
    id: "PARAM-CONFIG-PUBLISH-GATE-001",
    workflow: "B",
    title: "Publish is blocked by compiler/edit diagnostics; clean revisions validate/publish with audit and semantic persistence after reload.",
    required: true
  }
];
