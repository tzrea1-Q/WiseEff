export type AcceptanceWorkflowId = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H";

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
    id: "SHELL-DIAG-001",
    workflow: "A",
    title: "Core routes fail acceptance on unexpected console, page, request, or critical API errors.",
    required: true
  },
  {
    id: "API-STRICT-001",
    workflow: "A",
    title: "API mode never falls back to local demo business data when auth or required API hydration fails.",
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
    id: "PARAM-ADMIN-001",
    workflow: "C",
    title: "Parameter admin import preview and audit drawer remain available to Admin.",
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
    title: "Simulator read, write, mismatch, rollback, and audit path work.",
    required: true
  },
  {
    id: "DEBUG-PERM-001",
    workflow: "E",
    title: "Debugging write controls are hidden or blocked for roles without write permission.",
    required: true
  },
  {
    id: "HDC-LAB-001",
    workflow: "F",
    title: "Real HDC device lab read/write smoke runs when explicitly enabled.",
    required: false
  },
  {
    id: "AGENT-APPROVAL-001",
    workflow: "G",
    title: "Agent context, approval, rejection, execution, and evidence path work.",
    required: true
  },
  {
    id: "AGENT-UNAUTH-001",
    workflow: "G",
    title: "Direct execution of an unapproved Agent write tool is rejected.",
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
  }
];
