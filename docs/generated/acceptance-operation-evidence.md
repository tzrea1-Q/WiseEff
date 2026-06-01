# Operation Evidence Index

- Status: `passed`
- Covered operations: `20`
- Missing operations: _none_
- Invalid evidence records: _none_

| Operation ID | Status | Role | Route | Assertions | Artifacts |
| --- | --- | --- | --- | --- | --- |
| `AGENT-APPROVAL-001` | passed | Admin | `/agent` | ui, api, audit | test-results\acceptance\operation-evidence\AGENT-APPROVAL-001-agent-approval-reject-execute-trace-audit.png |
| `AGENT-UNAUTH-001` | passed | Guest, Hardware User, Software User | `/agent` | api, audit | test-results\acceptance\operation-evidence\AGENT-UNAUTH-001-agent-direct-run-rejected-before-approval.png |
| `AUTH-RUNTIME-001` | passed | Admin | `/` | ui, api | test-results\acceptance\operation-evidence\AUTH-RUNTIME-001-api-mode-browser-auth-runtime-parity.png |
| `DEBUG-PERM-001` | passed | Guest, Hardware User, Software User | `/node-debugging` | ui, api | test-results\acceptance\operation-evidence\DEBUG-PERM-001-debugging-write-permission-denial-ui-and-api.png |
| `DEBUG-SIM-001` | passed | Hardware Committer, Admin | `/node-debugging` | ui, api, db, audit | test-results\acceptance\operation-evidence\DEBUG-SIM-001-debugging-simulator-read-write-mismatch-rollback-audit.png |
| `LOG-HAPPY-001` | passed | Software User, Software Committer, Admin | `/logs` | ui, api, db, audit | test-results\acceptance\operation-evidence\LOG-HAPPY-001-log-upload-complete-evidence-feedback-archive-unsupported.png |
| `LOG-REANALYZE-001` | passed | Software User, Software Committer, Admin | `/logs` | ui, api, db, audit | test-results\acceptance\operation-evidence\LOG-REANALYZE-001-completed-log-reanalysis-creates-rerun-job-progress-and-audit.png |
| `PARAM-ADMIN-001` | passed | Admin | `/parameter-admin` | ui, audit | test-results\acceptance\operation-evidence\PARAM-ADMIN-001-parameter-admin-import-preview-and-audit-drawer.png |
| `PARAM-ASSIGNEE-001` | passed | Hardware User | `/parameters` | ui | test-results\acceptance\operation-evidence\PARAM-ASSIGNEE-001-workflow-assignee-defaults-are-eligible.png |
| `PARAM-ASSIGNEE-002` | passed | Hardware User | `/parameters` | ui | test-results\acceptance\operation-evidence\PARAM-ASSIGNEE-002-workflow-assignee-dropdowns-hide-ineligible-users.png |
| `PARAM-ASSIGNEE-003` | passed | Hardware User | `/api/v1/parameter-submission-rounds` | api | test-results\acceptance\operation-evidence\PARAM-ASSIGNEE-003-forced-invalid-workflow-assignees-rejected.png |
| `PARAM-DRAFT-EDIT-001` | passed | Hardware User | `/parameters` | ui, api, db, audit | test-results\acceptance\operation-evidence\PARAM-DRAFT-EDIT-001-parameter-draft-edit-and-remove-before-submission.png |
| `PARAM-HAPPY-001` | passed | Hardware User, Hardware Committer, Software Committer, Software User, Admin | `/parameters` | ui, api, db, audit | test-results\acceptance\operation-evidence\PARAM-HAPPY-001-parameter-management-submit-review-merge-persistence-audit.png |
| `PARAM-REASON-001` | passed | Hardware User | `/parameters` | ui | test-results\acceptance\operation-evidence\PARAM-REASON-001-blank-parameter-draft-reason-blocked.png |
| `PARAM-REJECT-001` | passed | Hardware Committer, Software Committer | `/parameter-review` | ui, api, db, audit | test-results\acceptance\operation-evidence\PARAM-REJECT-001-parameter-review-rejection-reason-persistence-audit.png |
| `PERM-GOV-001` | passed | Admin | `/user-permissions` | ui, api | test-results\acceptance\operation-evidence\PERM-GOV-001-user-governance-admin-only-and-self-protection.png |
| `PERM-MATRIX-001` | passed | Guest, Hardware User, Software User, Hardware Committer, Software Committer, Admin | `core routes` | ui | test-results\acceptance\operation-evidence\PERM-MATRIX-001-visible-route-permissions-for-admin.png |
| `PERM-MATRIX-001` | passed | Guest, Hardware User, Software User, Hardware Committer, Software Committer, Admin | `core routes` | ui | test-results\acceptance\operation-evidence\PERM-MATRIX-001-visible-route-permissions-for-guest.png |
| `PERM-MATRIX-001` | passed | Guest, Hardware User, Software User, Hardware Committer, Software Committer, Admin | `core routes` | ui | test-results\acceptance\operation-evidence\PERM-MATRIX-001-visible-route-permissions-for-hardware-committer.png |
| `PERM-MATRIX-001` | passed | Guest, Hardware User, Software User, Hardware Committer, Software Committer, Admin | `core routes` | ui | test-results\acceptance\operation-evidence\PERM-MATRIX-001-visible-route-permissions-for-hardware-user.png |
| `PERM-MATRIX-001` | passed | Guest, Hardware User, Software User, Hardware Committer, Software Committer, Admin | `core routes` | ui | test-results\acceptance\operation-evidence\PERM-MATRIX-001-visible-route-permissions-for-software-committer.png |
| `PERM-MATRIX-001` | passed | Guest, Hardware User, Software User, Hardware Committer, Software Committer, Admin | `core routes` | ui | test-results\acceptance\operation-evidence\PERM-MATRIX-001-visible-route-permissions-for-software-user.png |
| `PERM-MATRIX-002` | passed | Hardware User, Hardware Committer, Software Committer, Software User, Admin | `/api/v1/parameter-submission-rounds` | api | test-results\acceptance\operation-evidence\PERM-MATRIX-002-api-workflow-eligibility-stricter-than-visible-role-inclusion.png |
| `PERM-USER-MGMT-001` | passed | Admin | `/user-permissions` | ui, api, audit | test-results\acceptance\operation-evidence\PERM-USER-MGMT-001-admin-user-management-ui-and-non-admin-denial.png |
| `SHELL-DIAG-001` | passed | Admin | `core routes` | ui | test-results\acceptance\operation-evidence\SHELL-DIAG-001-shell-route-debugging-admin.png |
| `SHELL-DIAG-001` | passed | Admin | `core routes` | ui | test-results\acceptance\operation-evidence\SHELL-DIAG-001-shell-route-debugging.png |
| `SHELL-DIAG-001` | passed | Admin | `core routes` | ui | test-results\acceptance\operation-evidence\SHELL-DIAG-001-shell-route-home.png |
| `SHELL-DIAG-001` | passed | Admin | `core routes` | ui | test-results\acceptance\operation-evidence\SHELL-DIAG-001-shell-route-log-admin.png |
| `SHELL-DIAG-001` | passed | Admin | `core routes` | ui | test-results\acceptance\operation-evidence\SHELL-DIAG-001-shell-route-logs.png |
| `SHELL-DIAG-001` | passed | Admin | `core routes` | ui | test-results\acceptance\operation-evidence\SHELL-DIAG-001-shell-route-node-debugging.png |
| `SHELL-DIAG-001` | passed | Admin | `core routes` | ui | test-results\acceptance\operation-evidence\SHELL-DIAG-001-shell-route-parameter-admin.png |
| `SHELL-DIAG-001` | passed | Admin | `core routes` | ui | test-results\acceptance\operation-evidence\SHELL-DIAG-001-shell-route-parameter-review.png |
| `SHELL-DIAG-001` | passed | Admin | `core routes` | ui | test-results\acceptance\operation-evidence\SHELL-DIAG-001-shell-route-parameters.png |
| `SHELL-DIAG-001` | passed | Admin | `core routes` | ui | test-results\acceptance\operation-evidence\SHELL-DIAG-001-shell-route-user-permissions.png |
