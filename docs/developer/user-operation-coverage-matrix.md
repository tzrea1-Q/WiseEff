# User Operation Coverage Matrix

> Chinese: [Chinese](../zh-CN/developer/user-operation-coverage-matrix.md)

This file is generated from `e2e/acceptance/operationMatrix.ts`.

| Operation ID | Priority | Area | Coverage | Route | Roles | Assertions | Specs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `AUTH-RUNTIME-001` | P0 | auth | automated | `/` | Admin | ui, api | `e2e/acceptance/auth-runtime.acceptance.spec.ts` |
| `NOTIF-INBOX-001` | P1 | notifications | automated | `/parameters` | Admin | ui, api | `e2e/acceptance/notifications.acceptance.spec.ts` |
| `NOTIF-READ-001` | P1 | notifications | automated | `/api/v1/notifications/mark-all-read` | Admin | api | `e2e/acceptance/notifications.acceptance.spec.ts` |
| `PFB-SUBMIT-001` | P1 | product-feedback | automated | `/parameters` | Admin | ui, api, db, audit, screenshot | `e2e/acceptance/product-feedback.acceptance.spec.ts` |
| `PFB-ADMIN-001` | P1 | product-feedback | automated | `/feedback-admin` | Admin | ui, api, db, audit, screenshot | `e2e/acceptance/product-feedback.acceptance.spec.ts` |
| `PFB-AUTHZ-001` | P1 | product-feedback | automated | `/feedback-admin` | Hardware User | ui, api, db, screenshot | `e2e/acceptance/product-feedback.acceptance.spec.ts` |
| `SHELL-DIAG-001` | P0 | shell | automated | `core routes` | Admin | ui | `e2e/acceptance/shell-navigation.acceptance.spec.ts` |
| `PARAM-REASON-001` | P0 | parameters | automated | `/parameters` | Hardware User | ui | `e2e/acceptance/parameters-negative.acceptance.spec.ts` |
| `PARAM-ASSIGNEE-001` | P0 | parameters | automated | `/parameters` | Hardware User | ui | `e2e/acceptance/parameters-negative.acceptance.spec.ts` |
| `PARAM-ASSIGNEE-002` | P0 | parameters | automated | `/parameters` | Hardware User | ui | `e2e/acceptance/parameters-negative.acceptance.spec.ts` |
| `PARAM-ASSIGNEE-003` | P0 | parameters | automated | `/api/v1/parameter-submission-rounds` | Hardware User | api | `e2e/acceptance/parameters-negative.acceptance.spec.ts` |
| `PARAM-HAPPY-001` | P0 | parameters | automated | `/parameters` | Hardware User, Hardware Committer, Software Committer, Software User, Admin | ui, api, db, audit | `e2e/acceptance/parameters.acceptance.spec.ts` |
| `PARAM-HOME-001` | P1 | parameters | automated | `/parameter-home` | Admin | ui, api | `e2e/acceptance/parameter-home.acceptance.spec.ts` |
| `PARAM-ADMIN-001` | P1 | parameters | automated | `/parameter-admin` | Admin | ui, audit | `e2e/acceptance/parameters.acceptance.spec.ts` |
| `PARAM-ADMIN-002` | P1 | parameters | automated | `/parameter-admin` | Admin | ui, audit | `e2e/acceptance/parameter-import-wizard.acceptance.spec.ts` |
| `PARAM-DRAFT-EDIT-001` | P1 | parameters | automated | `/parameters` | Hardware User | ui, api, db | `e2e/acceptance/parameters-negative.acceptance.spec.ts` |
| `PARAM-REJECT-001` | P1 | parameters | automated | `/parameter-review` | Hardware Committer, Software Committer | ui, api, db, audit | `e2e/acceptance/parameters.acceptance.spec.ts` |
| `LOG-HAPPY-001` | P0 | logs | automated | `/logs` | Software User, Software Committer, Admin | ui, api, db, audit | `e2e/acceptance/log-analysis.acceptance.spec.ts` |
| `LOG-REANALYZE-001` | P1 | logs | automated | `/logs` | Software User, Software Committer, Admin | ui, api, db, audit | `e2e/acceptance/log-analysis.acceptance.spec.ts` |
| `DEBUG-SIM-001` | P0 | debugging | automated | `/node-debugging` | Hardware Committer, Admin | ui, api, db, audit | `e2e/acceptance/debugging-simulator.acceptance.spec.ts` |
| `DEBUG-PERM-001` | P1 | debugging | automated | `/node-debugging` | Guest, Hardware User, Software User | ui, api | `e2e/acceptance/debugging-simulator.acceptance.spec.ts` |
| `DEBUG-ADMIN-001` | P1 | debugging | automated | `/debugging-admin` | Admin | ui, api, db, audit | `e2e/acceptance/debugging-admin.acceptance.spec.ts` |
| `BRIDGE-WIN-001` | P1 | debugging | future | `/node-debugging` | Hardware Committer, Admin | ui, api | `e2e/acceptance/debugging-local-bridge.acceptance.spec.ts` |
| `HDC-LAB-001` | P1 | debugging | conditional | `/node-debugging` | Hardware Committer, Admin | ui, api, audit | `e2e/acceptance/hdc-device-lab.acceptance.spec.ts` |
| `ADB-LAB-001` | P1 | debugging | conditional | `/node-debugging` | Hardware Committer, Admin | ui, api, audit | `e2e/acceptance/adb-device-lab.acceptance.spec.ts` |
| `XIAOZE-PERCEPTION-001` | P0 | agent | automated | `/parameters` | Admin | ui, api | `e2e/acceptance/xiaoze-perception.acceptance.spec.ts` |
| `XIAOZE-PERCEPTION-AUTHZ-001` | P0 | agent | automated | `/parameters` | Guest | ui, api | `e2e/acceptance/xiaoze-perception.acceptance.spec.ts` |
| `XIAOZE-ACTION-APPROVE-001` | P1 | agent | automated | `/parameters` | Admin | api, audit | `e2e/acceptance/xiaoze-action.acceptance.spec.ts` |
| `XIAOZE-ACTION-REJECT-001` | P1 | agent | automated | `/parameters` | Admin | api | `e2e/acceptance/xiaoze-action.acceptance.spec.ts` |
| `XIAOZE-ACTION-AUTHZ-001` | P1 | agent | automated | `/parameters` | Guest | api | `e2e/acceptance/xiaoze-action.acceptance.spec.ts` |
| `XIAOZE-PLAN-MULTISTEP-001` | P2 | agent | automated | `/parameters` | Admin | api | `e2e/acceptance/xiaoze-planning.acceptance.spec.ts` |
| `XIAOZE-PROACTIVE-001` | P2 | agent | automated | `/parameters` | Admin | api | `e2e/acceptance/xiaoze-planning.acceptance.spec.ts` |
| `PERM-GOV-001` | P0 | permissions | automated | `/user-permissions` | Admin | ui | `e2e/acceptance/permissions.acceptance.spec.ts` |
| `PERM-MATRIX-001` | P0 | permissions | automated | `core routes` | Guest, Hardware User, Software User, Hardware Committer, Software Committer, Admin | ui | `e2e/acceptance/permissions-matrix.acceptance.spec.ts` |
| `PERM-MATRIX-002` | P0 | permissions | automated | `/api/v1/parameter-submission-rounds` | Hardware User, Hardware Committer, Software Committer, Software User, Admin | api | `e2e/acceptance/permissions-matrix.acceptance.spec.ts` |
| `PERM-USER-MGMT-001` | P1 | permissions | automated | `/user-permissions` | Admin | ui, api, db, audit | `e2e/acceptance/permissions.acceptance.spec.ts` |
| `MOD-TREE-PARAM-001` | P0 | parameters | automated | `/parameter-admin` | Admin | api, db | `e2e/acceptance/hierarchical-modules.acceptance.spec.ts` |
| `MOD-TREE-PARAM-002` | P0 | parameters | automated | `/parameter-admin` | Admin | api | `e2e/acceptance/hierarchical-modules.acceptance.spec.ts` |
| `MOD-TREE-DEBUG-001` | P0 | debugging | automated | `/debugging-admin` | Admin | api | `e2e/acceptance/hierarchical-modules.acceptance.spec.ts` |
| `MOD-TREE-AUTHZ-001` | P0 | parameters | automated | `/parameter-admin` | Hardware User, Admin | api | `e2e/acceptance/hierarchical-modules.acceptance.spec.ts` |
| `PARAM-FILE-UPLOAD-001` | P1 | parameters | automated | `/parameter-admin/projects` | Admin | ui, api, db | `e2e/acceptance/parameter-files.acceptance.spec.ts` |
| `PARAM-FILE-SYNC-001` | P1 | parameters | automated | `/api/v1/projects/:projectId/parameter-files/:fileId/sync` | Admin | api, db | `e2e/acceptance/parameter-files.acceptance.spec.ts` |
| `PARAM-FILE-RESOLVE-001` | P1 | parameters | automated | `/api/v1/projects/:projectId/parameter-file-conflicts/:conflictId/resolve` | Admin | api, db | `e2e/acceptance/parameter-files.acceptance.spec.ts` |

## Deferred Or Conditional Operations

- `BRIDGE-WIN-001`: Requires a real Windows bridge runtime and localhost health endpoint orchestration in acceptance.
- `HDC-LAB-001`: Requires DEBUG_DEVICE_GATEWAY_MODE=hdc and HDC_DEVICE_LAB_AVAILABLE=true with hardware attached.
- `ADB-LAB-001`: Requires DEBUG_DEVICE_GATEWAY_MODE=adb, ADB_DEVICE_LAB_AVAILABLE=true, exactly one ready ADB device, one ADB inventory row, and one shared default ADB smoke binding.
