export type AcceptanceOperationPriority = "P0" | "P1" | "P2";
export type AcceptanceOperationCoverage = "automated" | "manual" | "conditional" | "future";
export type AcceptanceOperationAssertion = "ui" | "api" | "db" | "audit" | "screenshot";

export type AcceptanceOperation = {
  id: string;
  priority: AcceptanceOperationPriority;
  area: "auth" | "shell" | "parameters" | "logs" | "debugging" | "agent" | "permissions" | "notifications";
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
    roles: ["Hardware User"],
    action: "Default every workflow assignee slot to an eligible active user.",
    coverage: "automated",
    acceptanceIds: ["PARAM-ASSIGNEE-001"],
    specFiles: ["e2e/acceptance/parameters-negative.acceptance.spec.ts"],
    assertions: ["ui"]
  },
  {
    id: "PARAM-ASSIGNEE-002",
    priority: "P0",
    area: "parameters",
    route: "/parameters",
    roles: ["Hardware User"],
    action: "Hide inactive, guest, admin-only, and role-ineligible users from assignee dropdowns.",
    coverage: "automated",
    acceptanceIds: ["PARAM-ASSIGNEE-002"],
    specFiles: ["e2e/acceptance/parameters-negative.acceptance.spec.ts"],
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
    action: "Search, draft, submit, review, merge, persist, and audit a parameter change.",
    coverage: "automated",
    acceptanceIds: ["PARAM-HAPPY-001"],
    specFiles: ["e2e/acceptance/parameters.acceptance.spec.ts"],
    assertions: ["ui", "api", "db", "audit"]
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
    route: "/debugging-admin",
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
    specFiles: ["e2e/acceptance/debugging-local-bridge.acceptance.spec.ts"],
    assertions: ["ui", "api"],
    deferralReason: "Requires a real Windows bridge runtime and localhost health endpoint orchestration in acceptance."
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
  }
];
