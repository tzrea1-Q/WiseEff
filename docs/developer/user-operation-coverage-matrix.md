# User Operation Coverage Matrix

> Chinese: [Chinese](../zh-CN/developer/user-operation-coverage-matrix.md)

This file is generated from `e2e/acceptance/operationMatrix.ts`.

| Operation ID | Priority | Area | Coverage | Route | Roles | Assertions | Specs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `AUTH-RUNTIME-001` | P0 | auth | automated | `/` | Admin | ui, api | `e2e/acceptance/auth-runtime.acceptance.spec.ts` |
| `SHELL-DIAG-001` | P0 | shell | automated | `core routes` | Admin | ui | `e2e/acceptance/shell-navigation.acceptance.spec.ts` |
| `PARAM-REASON-001` | P0 | parameters | automated | `/parameters` | Hardware User | ui | `e2e/acceptance/parameters-negative.acceptance.spec.ts` |
| `PARAM-ASSIGNEE-001` | P0 | parameters | automated | `/parameters` | Hardware User | ui | `e2e/acceptance/parameters-negative.acceptance.spec.ts` |
| `PARAM-ASSIGNEE-002` | P0 | parameters | automated | `/parameters` | Hardware User | ui | `e2e/acceptance/parameters-negative.acceptance.spec.ts` |
| `PARAM-ASSIGNEE-003` | P0 | parameters | automated | `/api/v1/parameter-submission-rounds` | Hardware User | api | `e2e/acceptance/parameters-negative.acceptance.spec.ts` |
| `PARAM-HAPPY-001` | P0 | parameters | automated | `/parameters` | Hardware User, Hardware Committer, Software Committer, Software User, Admin | ui, api, db, audit | `e2e/acceptance/parameters.acceptance.spec.ts` |
| `PARAM-ADMIN-001` | P1 | parameters | automated | `/parameter-admin` | Admin | ui, audit | `e2e/acceptance/parameters.acceptance.spec.ts` |
| `PARAM-DRAFT-EDIT-001` | P1 | parameters | automated | `/parameters` | Hardware User | ui, api, db | `e2e/acceptance/parameters-negative.acceptance.spec.ts` |
| `PARAM-REJECT-001` | P1 | parameters | automated | `/parameter-review` | Hardware Committer, Software Committer | ui, api, db, audit | `e2e/acceptance/parameters.acceptance.spec.ts` |
| `LOG-HAPPY-001` | P0 | logs | automated | `/logs` | Software User, Software Committer, Admin | ui, api, db, audit | `e2e/acceptance/log-analysis.acceptance.spec.ts` |
| `LOG-REANALYZE-001` | P1 | logs | automated | `/logs` | Software User, Software Committer, Admin | ui, api, db, audit | `e2e/acceptance/log-analysis.acceptance.spec.ts` |
| `DEBUG-SIM-001` | P0 | debugging | automated | `/node-debugging` | Hardware Committer, Admin | ui, api, db, audit | `e2e/acceptance/debugging-simulator.acceptance.spec.ts` |
| `DEBUG-PERM-001` | P1 | debugging | automated | `/node-debugging` | Guest, Hardware User, Software User | ui, api | `e2e/acceptance/debugging-simulator.acceptance.spec.ts` |
| `HDC-LAB-001` | P1 | debugging | conditional | `/node-debugging` | Hardware Committer, Admin | ui, api, audit | `e2e/acceptance/hdc-device-lab.acceptance.spec.ts` |
| `ADB-LAB-001` | P1 | debugging | conditional | `/node-debugging` | Hardware Committer, Admin | ui, api, audit | `e2e/acceptance/adb-device-lab.acceptance.spec.ts` |
| `AGENT-APPROVAL-001` | P0 | agent | automated | `/agent` | Admin | ui, api, audit | `e2e/acceptance/agent.acceptance.spec.ts` |
| `AGENT-UNAUTH-001` | P1 | agent | automated | `/agent` | Guest, Hardware User, Software User | api, audit | `e2e/acceptance/agent.acceptance.spec.ts` |
| `PERM-GOV-001` | P0 | permissions | automated | `/user-permissions` | Admin | ui | `e2e/acceptance/permissions.acceptance.spec.ts` |
| `PERM-MATRIX-001` | P0 | permissions | automated | `core routes` | Guest, Hardware User, Software User, Hardware Committer, Software Committer, Admin | ui | `e2e/acceptance/permissions-matrix.acceptance.spec.ts` |
| `PERM-MATRIX-002` | P0 | permissions | automated | `/api/v1/parameter-submission-rounds` | Hardware User, Hardware Committer, Software Committer, Software User, Admin | api | `e2e/acceptance/permissions-matrix.acceptance.spec.ts` |
| `PERM-USER-MGMT-001` | P1 | permissions | automated | `/user-permissions` | Admin | ui, api, db, audit | `e2e/acceptance/permissions.acceptance.spec.ts` |

## Deferred Or Conditional Operations

- `HDC-LAB-001`: Requires DEBUG_DEVICE_GATEWAY_MODE=hdc and HDC_DEVICE_LAB_AVAILABLE=true with hardware attached.
- `ADB-LAB-001`: Requires DEBUG_DEVICE_GATEWAY_MODE=adb and ADB_DEVICE_LAB_AVAILABLE=true with exactly one ready ADB device, one ADB inventory row, and one shared default ADB smoke binding.
