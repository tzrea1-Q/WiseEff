# User Operation Coverage Matrix

> Chinese: [Chinese](../zh-CN/developer/user-operation-coverage-matrix.md)

This file is generated from `e2e/acceptance/operationMatrix.ts`.

| Operation ID | Priority | Area | Coverage | Route | Roles | Assertions | Specs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `AUTH-RUNTIME-001` | P0 | auth | automated | `/` | Admin | ui, api | `e2e/acceptance/auth-runtime.acceptance.spec.ts` |
| `AUTH-LOCAL-PASSWORD-001` | P1 | auth | future | `/` | Admin | ui, api | `src/App.test.tsx`<br>`src/infrastructure/http/authClient.test.ts`<br>`server/modules/auth/localAuth.test.ts`<br>`server/modules/auth/routes.test.ts`<br>`e2e/acceptance/auth-runtime.acceptance.spec.ts` |
| `AUTH-LOCAL-ADMIN-RESET-001` | P1 | auth | future | `/organization/members` | Admin | ui, api | `src/UserPermissionsPage.test.tsx`<br>`src/infrastructure/http/userGovernanceClient.test.ts`<br>`server/modules/users/service.test.ts`<br>`server/modules/users/routes.test.ts`<br>`e2e/acceptance/auth-runtime.acceptance.spec.ts` |
| `AUTH-LOCAL-SELF-REGISTER-001` | P1 | auth | future | `/` | Guest | ui, api | `src/App.test.tsx`<br>`server/modules/auth/localAuth.test.ts`<br>`e2e/acceptance/auth-runtime.acceptance.spec.ts` |
| `AUTH-LOCAL-BOOTSTRAP-HINT-001` | P1 | auth | future | `/` | Guest | ui | `src/App.test.tsx`<br>`e2e/acceptance/auth-runtime.acceptance.spec.ts` |
| `NOTIF-INBOX-001` | P1 | notifications | automated | `/parameters` | Admin | ui, api | `e2e/acceptance/notifications.acceptance.spec.ts` |
| `NOTIF-READ-001` | P1 | notifications | automated | `/api/v1/notifications/mark-all-read` | Admin | api | `e2e/acceptance/notifications.acceptance.spec.ts` |
| `PFB-SUBMIT-001` | P1 | product-feedback | automated | `/parameters` | Admin | ui, api, db, audit, screenshot | `e2e/acceptance/product-feedback.acceptance.spec.ts` |
| `PFB-ADMIN-001` | P1 | product-feedback | automated | `/feedback-admin` | Admin | ui, api, db, audit, screenshot | `e2e/acceptance/product-feedback.acceptance.spec.ts` |
| `PFB-AUTHZ-001` | P1 | product-feedback | automated | `/feedback-admin` | Hardware User | ui, api, db, screenshot | `e2e/acceptance/product-feedback.acceptance.spec.ts` |
| `KB-READ-001` | P1 | knowledge | automated | `/knowledge` | Hardware User | ui, api, db | `e2e/acceptance/knowledge.acceptance.spec.ts` |
| `KB-EDIT-001` | P1 | knowledge | automated | `/knowledge` | Hardware User | ui, api, db, audit | `e2e/acceptance/knowledge.acceptance.spec.ts` |
| `KB-FILE-001` | P1 | knowledge | automated | `/knowledge` | Hardware User | ui, api, db, audit | `e2e/acceptance/knowledge.acceptance.spec.ts` |
| `KB-ASK-001` | P1 | knowledge | automated | `/knowledge` | Hardware User | ui, api | `e2e/acceptance/knowledge.acceptance.spec.ts` |
| `KB-INDEX-001` | P1 | knowledge | automated | `/knowledge-admin` | Admin | ui, api, db | `e2e/acceptance/knowledge.acceptance.spec.ts` |
| `KB-DISTILL-001` | P1 | knowledge | automated | `/logs` | Hardware User | ui, api, db, audit | `e2e/acceptance/knowledge.acceptance.spec.ts` |
| `KB-DISTILL-002` | P1 | knowledge | automated | `/dts-reload` | Hardware Committer | ui, api, db, audit | `e2e/acceptance/knowledge.acceptance.spec.ts` |
| `KB-ADMIN-001` | P1 | knowledge | automated | `/knowledge-admin` | Admin | ui, api, db, audit | `e2e/acceptance/knowledge.acceptance.spec.ts` |
| `KB-REC-001` | P1 | knowledge | automated | `/logs` | Hardware User | ui, api, db | `e2e/acceptance/knowledge.acceptance.spec.ts` |
| `KB-XREF-001` | P1 | knowledge | automated | `/knowledge` | Hardware User | ui, api, db, audit | `e2e/acceptance/knowledge.acceptance.spec.ts` |
| `SHELL-DIAG-001` | P0 | shell | automated | `core routes` | Admin | ui | `e2e/acceptance/shell-navigation.acceptance.spec.ts` |
| `SHELL-FOOTER-001` | P1 | shell | automated | `included routes plus auth, error, download, and configuration-workbench exclusions` | Admin | ui, screenshot | `e2e/acceptance/shell-navigation.acceptance.spec.ts`<br>`src/config/appFooterConfig.test.ts`<br>`src/components/common/AppFooter.test.tsx`<br>`src/App.test.tsx` |
| `SHELL-DISCOVERY-001` | P1 | shell | future | `/` | Admin | ui, screenshot | `src/domain/workflowDiscovery.test.ts`<br>`src/App.test.tsx`<br>`src/linear-template/SubAppEntryRow.test.tsx`<br>`src/linear-template/PlatformFlowSection.test.tsx` |
| `PARAM-REASON-001` | P0 | parameters | automated | `/parameters` | Hardware User | ui | `e2e/acceptance/parameters-negative.acceptance.spec.ts` |
| `PARAM-ASSIGNEE-001` | P0 | parameters | automated | `/parameters` | Software User | ui | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `PARAM-ASSIGNEE-002` | P0 | parameters | automated | `/parameters` | Software User | ui | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `PARAM-ASSIGNEE-003` | P0 | parameters | automated | `/api/v1/parameter-submission-rounds` | Hardware User | api | `e2e/acceptance/parameters-negative.acceptance.spec.ts` |
| `PARAM-HAPPY-001` | P0 | parameters | automated | `/parameters` | Hardware User, Hardware Committer, Software Committer, Software User, Admin | ui, api, db, audit | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `PARAM-HOME-001` | P1 | parameters | automated | `/parameter-home` | Admin | ui, api | `e2e/acceptance/parameter-home.acceptance.spec.ts` |
| `PARAM-ADMIN-001` | P1 | parameters | automated | `/parameter-admin` | Admin | ui, audit | `e2e/acceptance/parameters.acceptance.spec.ts` |
| `PARAM-ADMIN-002` | P1 | parameters | automated | `/parameter-admin` | Admin | ui, audit | `e2e/acceptance/parameter-import-wizard.acceptance.spec.ts` |
| `PARAM-ADMIN-003` | P1 | parameters | automated | `/parameter-admin/projects` | Admin | ui, api, screenshot | `e2e/acceptance/parameter-admin-projects.acceptance.spec.ts` |
| `PARAM-INIT-WIZARD-001` | P1 | parameters | future | `/parameter-admin` | Admin | ui, api, audit, screenshot | `src/ProjectParameterInitializationWizard.test.tsx`<br>`src/appReducer.parameterAdmin.test.ts`<br>`server/modules/parameters/initializationService.test.ts` |
| `PARAM-INIT-EMPTY-001` | P1 | parameters | future | `/api/v1/parameters/projects/:projectId/initialization` | Admin | api, db, audit | `src/infrastructure/mock/mockParameterInitializationRepository.test.ts`<br>`server/modules/parameters/initializationService.test.ts` |
| `PARAM-INIT-REVIEW-001` | P1 | parameters | future | `/parameter-review` | Admin | ui, api, db, audit | `src/App.tsx`<br>`server/modules/parameters/initializationService.test.ts` |
| `PARAM-INIT-REJECT-001` | P1 | parameters | future | `/parameter-review` | Admin | ui, api, audit | `src/appReducer.parameterAdmin.test.ts`<br>`server/modules/parameters/initializationService.test.ts` |
| `PARAM-INIT-LOCK-001` | P1 | parameters | future | `/parameters` | Software User, Admin | ui, api | `src/ParametersPage.test.tsx`<br>`server/modules/parameters/service.test.ts` |
| `PROJ-OPS-001` | P1 | parameters | automated | `/parameter-admin/projects/:projectId/configuration` | Admin | ui, screenshot | `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts`<br>`src/ParameterAdminNextPage.test.tsx`<br>`src/components/parameter-admin-next/projectOperationsCutover.test.ts` |
| `PROJ-OPS-002` | P1 | parameters | automated | `/parameter-admin/projects/:projectId/configuration` | Admin | ui, screenshot | `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts` |
| `PROJ-OPS-003` | P1 | parameters | automated | `/parameter-admin/projects/:projectId/configuration` | Admin | ui, api, screenshot | `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts` |
| `PROJ-CONFIG-READ-001` | P1 | parameters | automated | `/parameter-admin/projects/:projectId/configuration` | Admin | ui, api, screenshot | `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts` |
| `PROJ-CONFIG-SOURCE-001` | P1 | parameters | automated | `/parameter-admin/projects/:projectId/configuration` | Admin | ui, api, screenshot | `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts` |
| `PROJ-CONFIG-INSPECT-001` | P1 | parameters | automated | `/parameter-admin/projects/:projectId/configuration` | Admin | ui, api, screenshot | `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts` |
| `PROJ-CONFIG-CANDIDATE-001` | P1 | parameters | automated | `/parameter-admin/projects/:projectId/configuration` | Admin | ui, api, screenshot | `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts` |
| `PROJ-CONFIG-EDIT-001` | P1 | parameters | automated | `/parameter-admin/projects/:projectId/configuration` | Admin | ui, api, screenshot | `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts` |
| `PROJ-CONFIG-DRAFT-001` | P1 | parameters | automated | `/parameter-admin/projects/:projectId/configuration` | Admin | ui, api, screenshot | `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts` |
| `PROJ-CONFIG-ACTIVITY-001` | P1 | parameters | automated | `/parameter-admin/projects/:projectId/configuration` | Admin | ui, api, screenshot | `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts` |
| `PROJ-CONFIG-ACTIVATE-001` | P1 | parameters | automated | `/parameter-admin/projects/:projectId/configuration` | Admin | ui, api, screenshot | `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts` |
| `PROJ-CONFIG-OPS-001` | P1 | parameters | automated | `/parameter-admin/projects/:projectId/configuration` | Admin | ui, api, screenshot | `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts` |
| `PROJ-CONFIG-CONFLICT-001` | P1 | parameters | automated | `/parameter-admin/projects/:projectId/configuration` | Admin | ui, api, screenshot | `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts` |
| `PROJ-CONFIG-READINESS-001` | P1 | parameters | automated | `/parameter-admin/projects/:projectId/configuration` | Admin | ui, api, screenshot | `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts` |
| `PROJ-CONFIG-BASELINE-001` | P1 | parameters | automated | `/parameter-admin/projects/:projectId/configuration` | Admin | ui, api, screenshot | `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts` |
| `PROJ-CONFIG-REVISION-GATE-001` | P1 | parameters | future | `/parameter-admin/projects/:projectId/configuration` | Admin | ui, api | `e2e/acceptance/config-set-revision-gate.acceptance.spec.ts`<br>`src/components/project-configuration-workbench/ProjectConfigurationWorkbench.test.tsx`<br>`src/application/project-configuration/configRevisionGateSession.test.ts`<br>`src/infrastructure/mock/mockParameterTopologyRepository.test.ts`<br>`src/infrastructure/http/parameterTopologyClient.test.ts`<br>`server/modules/parameter-topology/service.test.ts`<br>`server/modules/parameter-topology/routes.test.ts` |
| `PROJ-CONFIG-CUTOVER-001` | P1 | parameters | automated | `/parameter-admin/projects/:projectId/configuration` | Admin | ui, screenshot, api | `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts`<br>`src/ParameterAdminNextPage.test.tsx`<br>`src/components/parameter-admin-next/projectOperationsCutover.test.ts` |
| `PARAM-ADMIN-DIALOG-001` | P1 | parameters | future | `/parameter-admin/projects` | Admin | ui, screenshot | `src/components/common/ModalDialog.test.tsx` |
| `PARAM-IMPORT-DTS-FULL-001` | P1 | parameters | automated | `/parameter-admin` | Admin | ui, api | `e2e/acceptance/parameter-import-dts-td035.acceptance.spec.ts` |
| `PARAM-IMPORT-REVIEW-META-001` | P1 | parameters | automated | `/parameter-admin` | Admin | api, db, audit | `e2e/acceptance/parameter-import-dts-td035.acceptance.spec.ts` |
| `PARAM-DRAFT-EDIT-001` | P1 | parameters | automated | `/parameters` | Hardware User | ui, api, db | `e2e/acceptance/parameters-negative.acceptance.spec.ts` |
| `PARAM-REJECT-001` | P1 | parameters | automated | `/parameter-review` | Hardware Committer, Software Committer | ui, api, db, audit | `e2e/acceptance/parameters.acceptance.spec.ts` |
| `LOG-HAPPY-001` | P0 | logs | automated | `/logs` | Software User, Software Committer, Admin | ui, api, db, audit | `e2e/acceptance/log-analysis.acceptance.spec.ts` |
| `LOG-REANALYZE-001` | P1 | logs | automated | `/logs` | Software User, Software Committer, Admin | ui, api, db, audit | `e2e/acceptance/log-analysis.acceptance.spec.ts` |
| `LOG-DOMAIN-001` | P1 | logs | automated | `/log-admin` | Admin | ui, api, db, audit | `e2e/acceptance/log-analysis.acceptance.spec.ts` |
| `LOG-DOMAIN-KNOWLEDGE-001` | P1 | logs | automated | `/log-admin` | Admin | ui, api, db, audit | `e2e/acceptance/log-analysis.acceptance.spec.ts` |
| `LOG-DEGRADED-001` | P1 | logs | automated | `/logs` | Software User, Software Committer, Admin | ui, api, db | `e2e/acceptance/log-analysis.acceptance.spec.ts` |
| `LOG-FEEDBACK-INSIGHTS-001` | P1 | logs | automated | `/log-admin` | Admin | ui, api, db | `e2e/acceptance/log-analysis.acceptance.spec.ts` |
| `LOG-EVAL-DRAFT-001` | P1 | logs | automated | `/log-admin` | Admin | ui | `e2e/acceptance/log-analysis.acceptance.spec.ts` |
| `LOG-ARCHIVE-UPLOAD-001` | P1 | logs | automated | `/logs` | Software User, Software Committer, Admin | ui, api, db | `e2e/acceptance/log-analysis.acceptance.spec.ts` |
| `LOG-DOMAIN-WEBHOOK-001` | P1 | logs | automated | `/log-admin` | Admin | ui, api, db, audit | `e2e/acceptance/log-analysis.acceptance.spec.ts` |
| `LOG-DOMAIN-MODEL-001` | P1 | logs | automated | `/log-admin` | Admin | ui, api, db, audit | `e2e/acceptance/log-analysis.acceptance.spec.ts` |
| `DEBUG-SIM-001` | P0 | debugging | automated | `/node-debugging` | Hardware Committer, Admin | ui, api, db, audit | `e2e/acceptance/debugging-simulator.acceptance.spec.ts` |
| `DEBUG-PERM-001` | P1 | debugging | automated | `/node-debugging` | Guest, Hardware User, Software User | ui, api | `e2e/acceptance/debugging-simulator.acceptance.spec.ts` |
| `DEBUG-ADMIN-001` | P1 | debugging | automated | `/debugging-admin/nodes` | Admin | ui, api, db, audit | `e2e/acceptance/debugging-admin.acceptance.spec.ts` |
| `BRIDGE-WIN-001` | P1 | debugging | future | `/node-debugging` | Hardware Committer, Admin | ui, api | `e2e/acceptance/local-device-bridge.acceptance.spec.ts`<br>`e2e/acceptance/local-device-bridge.acceptance.spec.ts` |
| `BRIDGE-HDC-001` | P1 | debugging | conditional | `/node-debugging` | Hardware Committer, Admin | ui, api | `e2e/acceptance/local-device-bridge.acceptance.spec.ts` |
| `DTS-RELOAD-DEPLOY-001` | P0 | debugging | automated | `/dts-reload` | Hardware Committer, Admin | api | `e2e/acceptance/dts-reload-deploy.acceptance.spec.ts` |
| `DTS-RELOAD-KERNEL-001` | P0 | debugging | automated | `/dts-reload` | Hardware Committer, Admin | api | `e2e/acceptance/dts-reload-deploy.acceptance.spec.ts` |
| `DTS-RELOAD-VERIFY-001` | P0 | debugging | automated | `/dts-reload` | Hardware Committer, Admin | api | `e2e/acceptance/dts-reload-deploy.acceptance.spec.ts`<br>`server/modules/dts-reload/deploy.test.ts` |
| `DTS-RELOAD-RESIDUE-001` | P0 | debugging | automated | `/dts-reload` | Hardware Committer, Admin | api | `e2e/acceptance/dts-reload-deploy.acceptance.spec.ts`<br>`server/modules/dts-reload/residue.test.ts`<br>`server/modules/dts-reload/restoreBaseline.test.ts` |
| `DTS-RELOAD-DEPLOY-HW-001` | P1 | debugging | conditional | `/dts-reload` | Hardware Committer, Admin | api | `e2e/acceptance/dts-reload-deploy.acceptance.spec.ts` |
| `DTS-RELOAD-HANDOFF-001` | P1 | debugging | future | `/dts-reload` | Hardware Committer, Admin | ui | `e2e/acceptance/dts-reload-handoff.acceptance.spec.ts` |
| `DTS-RELOAD-PROMOTE-001` | P1 | debugging | future | `/dts-reload` | Hardware Committer, Admin | ui, api | `e2e/acceptance/dts-reload-promote.acceptance.spec.ts` |
| `HDC-LAB-001` | P1 | debugging | conditional | `/node-debugging` | Hardware Committer, Admin | ui, api, audit | `e2e/acceptance/hdc-device-lab.acceptance.spec.ts` |
| `ADB-LAB-001` | P1 | debugging | conditional | `/node-debugging` | Hardware Committer, Admin | ui, api, audit | `e2e/acceptance/adb-device-lab.acceptance.spec.ts` |
| `XIAOZE-PERCEPTION-001` | P0 | agent | automated | `/parameters` | Admin | ui, api | `e2e/acceptance/xiaoze-perception.acceptance.spec.ts` |
| `XIAOZE-PERCEPTION-AUTHZ-001` | P0 | agent | automated | `/parameters` | Guest | ui, api | `e2e/acceptance/xiaoze-perception.acceptance.spec.ts` |
| `XIAOZE-ACTION-APPROVE-001` | P1 | agent | automated | `/parameters` | Admin | api, audit | `e2e/acceptance/xiaoze-action.acceptance.spec.ts`<br>`e2e/acceptance/xiaoze-action-semantic.acceptance.spec.ts` |
| `XIAOZE-APPROVAL-CARD-001` | P0 | agent | automated | `/parameters` | Admin | ui, db | `e2e/acceptance/xiaoze-action.acceptance.spec.ts` |
| `XIAOZE-ACTION-EDITEDARGS-001` | P1 | agent | automated | `/parameters` | Admin | api, audit | `e2e/acceptance/xiaoze-action.acceptance.spec.ts` |
| `XIAOZE-ACTION-REJECT-001` | P1 | agent | automated | `/parameters` | Admin | api | `e2e/acceptance/xiaoze-action.acceptance.spec.ts` |
| `XIAOZE-ACTION-RESUME-001` | P1 | agent | automated | `/parameters` | Admin | api | `e2e/acceptance/xiaoze-action.acceptance.spec.ts` |
| `XIAOZE-ACTION-EDITEDARGS-001` | P1 | agent | automated | `/parameters` | Admin | api | `e2e/acceptance/xiaoze-action.acceptance.spec.ts` |
| `XIAOZE-ACTION-AUTHZ-001` | P1 | agent | automated | `/parameters` | Guest | api | `e2e/acceptance/xiaoze-action.acceptance.spec.ts` |
| `XIAOZE-APPROVAL-EXEC-FAIL-001` | P1 | agent | future | `/parameters` | Admin | ui, api | `e2e/acceptance/xiaoze-action.acceptance.spec.ts` |
| `XIAOZE-PLAN-MULTISTEP-001` | P2 | agent | automated | `/parameters` | Admin | api | `e2e/acceptance/xiaoze-planning.acceptance.spec.ts` |
| `XIAOZE-PROACTIVE-001` | P2 | agent | automated | `/parameters` | Admin | api | `e2e/acceptance/xiaoze-planning.acceptance.spec.ts` |
| `PERM-GOV-001` | P0 | permissions | automated | `/organization/members` | Admin | ui | `e2e/acceptance/permissions.acceptance.spec.ts` |
| `PERM-MATRIX-001` | P0 | permissions | automated | `core routes` | Guest, Hardware User, Software User, Hardware Committer, Software Committer, Admin | ui | `e2e/acceptance/permissions-matrix.acceptance.spec.ts` |
| `PERM-MATRIX-002` | P0 | permissions | automated | `/api/v1/parameter-submission-rounds` | Hardware User, Hardware Committer, Software Committer, Software User, Admin | api | `e2e/acceptance/permissions-matrix.acceptance.spec.ts` |
| `PERM-USER-MGMT-001` | P1 | permissions | automated | `/organization/members` | Admin | ui, api, db, audit | `e2e/acceptance/permissions.acceptance.spec.ts` |
| `ORG-ADMIN-RENAME-001` | P1 | permissions | automated | `/organization` | Admin | ui, api, db, audit | `e2e/acceptance/permissions.acceptance.spec.ts` |
| `MOD-TREE-PARAM-001` | P0 | parameters | automated | `/parameter-admin` | Admin | api, db | `e2e/acceptance/hierarchical-modules.acceptance.spec.ts` |
| `MOD-TREE-PARAM-002` | P0 | parameters | automated | `/parameter-admin` | Admin | api | `e2e/acceptance/hierarchical-modules.acceptance.spec.ts` |
| `MOD-TREE-DEBUG-001` | P0 | debugging | automated | `/debugging-admin/nodes` | Admin | api | `e2e/acceptance/hierarchical-modules.acceptance.spec.ts` |
| `MOD-TREE-AUTHZ-001` | P0 | parameters | automated | `/parameter-admin` | Hardware User, Admin | api | `e2e/acceptance/hierarchical-modules.acceptance.spec.ts` |
| `PARAM-FILE-UPLOAD-001` | P1 | parameters | automated | `/parameter-admin/projects` | Admin | ui, api, db | `e2e/acceptance/parameter-files.acceptance.spec.ts` |
| `PARAM-FILE-SYNC-001` | P1 | parameters | automated | `/api/v1/projects/:projectId/parameter-files/:fileId/sync` | Admin | api, db | `e2e/acceptance/parameter-files.acceptance.spec.ts` |
| `PARAM-FILE-RESOLVE-001` | P1 | parameters | automated | `/api/v1/projects/:projectId/parameter-file-conflicts/:conflictId/resolve` | Admin | api, db | `e2e/acceptance/parameter-files.acceptance.spec.ts` |
| `PARAM-FILE-ROLLBACK-001` | P1 | parameters | future | `/parameter-admin/projects/:projectId/configuration` | Admin | ui, api | `e2e/acceptance/parameter-files.acceptance.spec.ts`<br>`src/components/project-configuration-workbench/ProjectConfigurationWorkbench.test.tsx`<br>`src/infrastructure/mock/mockParameterFileRepository.test.ts`<br>`server/modules/parameter-files/service.test.ts` |
| `PARAM-DTS-STRUCTURE-001` | P1 | parameters | automated | `/api/v1/projects/:projectId/parameter-files/:fileId/versions/:versionId/structure` | Admin | api | `e2e/acceptance/dts-structured.acceptance.spec.ts` |
| `PARAM-DTS-EDIT-001` | P1 | parameters | automated | `/api/v1/projects/:projectId/parameter-files/:fileId/versions/:versionId/structure` | Admin | api | `e2e/acceptance/dts-structured.acceptance.spec.ts` |
| `PARAM-DTS-EDIT-002` | P1 | parameters | automated | `/api/v1/projects/:projectId/dts-structured-edits/submit` | Admin | api, ui, db | `e2e/acceptance/dts-structured.acceptance.spec.ts` |
| `PARAM-DTS-CONFIGSET-001` | P1 | parameters | automated | `/parameter-admin/projects` | Admin | ui, api | `e2e/acceptance/dts-structured.acceptance.spec.ts` |
| `PARAM-DTS-DIFF-001` | P1 | parameters | automated | `/api/v1/projects/:projectId/baselines/:baselineId/compare` | Admin | api, ui | `e2e/acceptance/dts-structured.acceptance.spec.ts` |
| `PARAM-DTS-SEARCH-001` | P1 | parameters | automated | `/api/v1/projects/:projectId/dts-search` | Admin | ui, api | `e2e/acceptance/dts-structured.acceptance.spec.ts` |
| `PARAM-DTS-IMPACT-001` | P1 | parameters | automated | `/api/v1/parameter-change-requests` | Admin, Hardware Committer | api | `e2e/acceptance/dts-structured.acceptance.spec.ts` |
| `PARAM-DTS-RBAC-001` | P0 | parameters | automated | `/api/v1/parameter-submission-rounds` | Hardware User, Admin | api, db | `e2e/acceptance/dts-structured.acceptance.spec.ts` |
| `PARAM-SPEC-GOVERN-001` | P1 | parameters | automated | `/parameter-admin` | Admin | ui, api, db | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `PARAM-SPEC-EDIT-001` | P1 | parameters | future | `/parameter-admin/specs` | Admin | ui | `src/components/parameter-topology/ParameterSpecDetailDialog.test.tsx`<br>`src/components/parameter-topology/ParameterSpecDetail.test.ts` |
| `PARAM-SPEC-EDIT-002` | P1 | parameters | future | `/parameter-admin/specs` | Admin | ui, screenshot | `src/components/common/ModalDialog.test.tsx`<br>`src/components/parameter-topology/ParameterSpecDetailDialog.test.tsx` |
| `PARAM-SPEC-IDENTITY-001` | P1 | parameters | future | `/parameter-admin/specs` | Admin | ui | `src/components/parameter-topology/ParameterSpecDetailDialog.test.tsx` |
| `PARAM-SPEC-IDENTITY-002` | P1 | parameters | future | `/parameter-admin/specs` | Admin | ui | `src/components/parameter-topology/ParameterSpecDetailDialog.test.tsx`<br>`src/infrastructure/http/presentError.test.ts`<br>`src/infrastructure/mock/mockParameterTopologyRepository.test.ts` |
| `PARAM-ADMIN-IA-001` | P1 | parameters | future | `/parameter-admin/specs` | Admin | ui |  |
| `PARAM-TOPOLOGY-BROWSE-001` | P0 | parameters | automated | `/parameters` | Admin, Hardware User | ui, api | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `PARAM-TOPOLOGY-EDIT-001` | P0 | parameters | automated | `/parameters` | Software User, Hardware Committer, Software Committer, Admin | ui, api, db, audit | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `PARAM-DRAFT-REMOVE-001` | P0 | parameters | automated | `/parameters` | Software User | ui, api | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `PARAM-IDENTITY-MAP-001` | P1 | parameters | automated | `/parameters` | Admin | ui, api, db, audit | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `PARAM-IDENTITY-MAP-ADMIN-001` | P1 | parameters | automated | `/parameter-admin` | Admin | ui, api, db, audit | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `PARAM-CONFIG-PUBLISH-GATE-001` | P0 | parameters | automated | `/parameters` | Admin | ui, api, db, audit | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `PARAM-ENABLE-GATE-001` | P1 | parameters | automated | `/parameters` | Admin | api, db | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `PARAM-ENABLE-VISIBLE-001` | P0 | parameters | automated | `/parameters` | Admin, Hardware User | ui, api | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `PARAM-ENABLE-TOGGLE-001` | P0 | parameters | automated | `/parameters` | Software User, Admin | ui, api, db, audit | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `PARAM-ENABLE-GUARD-001` | P1 | parameters | automated | `/parameters` | Admin | ui | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `MOD-ATTR-QUEUE-001` | P1 | parameters | future | `/parameter-admin` | Admin | ui, api, audit | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `MOD-ATTR-CLASSIFY-001` | P1 | parameters | future | `/parameter-admin` | Admin | ui, api, audit | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `MOD-ATTR-BULK-001` | P1 | parameters | future | `/parameter-admin` | Admin | ui, api, audit | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `MOD-ATTR-TREE-001` | P1 | parameters | future | `/parameter-admin` | Admin | ui, api | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `MOD-ATTR-RECLASSIFY-001` | P1 | parameters | future | `/parameter-admin` | Admin | ui, api | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `MOD-ATTR-IMPORTANCE-001` | P1 | parameters | future | `/parameter-admin` | Admin | ui, api | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `DRV-REG-001` | P1 | parameters | future | `/parameter-admin` | Admin | ui, api | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `DRV-REG-002` | P1 | parameters | future | `/parameter-admin` | Admin | ui, api | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `DRV-REG-003` | P1 | parameters | future | `/parameter-admin` | Admin | ui, api | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `DRV-REG-004` | P1 | parameters | future | `/parameter-admin` | Admin, Platform Admin | ui, api, audit | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `DRV-REG-005` | P1 | parameters | future | `/parameter-admin/modules` | Admin | ui, api | `e2e/acceptance/parameter-topology.acceptance.spec.ts`<br>`src/components/admin/ModuleEditDialog.test.tsx`<br>`src/infrastructure/mock/mockParameterModuleRegistryRepository.test.ts` |
| `DRV-SCHEMA-001` | P1 | parameters | future | `/parameter-admin` | Admin | ui, api | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `DRV-SCHEMA-002` | P1 | parameters | future | `/parameter-admin` | Admin | ui, api | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `DRV-SCHEMA-003` | P1 | parameters | future | `/parameter-admin` | Admin | ui, api | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `DRV-SCHEMA-004` | P1 | parameters | future | `/parameter-admin` | Admin | ui, api | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `MOD-ATTR-CREATE-KIND-001` | P1 | parameters | future | `/parameter-admin` | Admin | ui, api | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `PLAT-ROLE-001` | P1 | platform | automated | `/platform-console` | Platform Admin | ui | `e2e/acceptance/permissions-matrix.acceptance.spec.ts` |
| `PLAT-ROLE-002` | P1 | platform | automated | `/organization/members` | Admin | ui, api | `e2e/acceptance/permissions-matrix.acceptance.spec.ts` |
| `PLAT-ROLE-003` | P1 | platform | automated | `/api/v1/users` | Platform Admin | api | `e2e/acceptance/permissions-matrix.acceptance.spec.ts` |
| `DRV-PROMOTE-005` | P1 | platform | manual | `/platform-console` | Platform Admin | ui, api |  |
| `SPEC-DEPRECATE-001` | P1 | parameters | future | `/parameter-admin/specs` | Admin | ui, api |  |
| `SPEC-RESTORE-001` | P1 | parameters | future | `/parameter-admin/specs` | Admin | ui, api |  |
| `SPEC-EDIT-DIFF-001` | P2 | parameters | future | `/parameter-admin/specs` | Admin | ui |  |
| `IDMAP-NEWID-001` | P1 | parameters | future | `/parameter-admin/specs/identity-mapping` | Admin | ui, api |  |
| `IDMAP-HISTORY-001` | P2 | parameters | future | `/parameter-admin/specs/identity-mapping` | Admin | ui |  |
| `IDMAP-REOPEN-001` | P2 | parameters | future | `/parameter-admin/specs/identity-mapping` | Admin | ui, api |  |
| `MOD-QUEUE-RESTORE-001` | P2 | parameters | future | `/parameter-admin/modules` | Admin | ui, api |  |
| `OVERLAY-RETIRE-001` | P1 | parameters | future | `/parameter-admin/modules` | Admin | ui, api |  |
| `MOD-ATTR-SORT-001` | P2 | parameters | future | `/parameter-admin/modules` | Admin | ui, api |  |

## Deferred Or Conditional Operations

- `AUTH-LOCAL-PASSWORD-001`: Covered by unit tests. Shared acceptance still injects HMAC smoke and does not exercise the local login form or profile password dialog.
- `AUTH-LOCAL-ADMIN-RESET-001`: Covered by unit tests. Shared acceptance still injects HMAC smoke and does not exercise local-account password reset on /organization/members.
- `AUTH-LOCAL-SELF-REGISTER-001`: Covered by unit tests. Shared acceptance still injects HMAC smoke and does not load the unauthenticated local auth screen.
- `AUTH-LOCAL-BOOTSTRAP-HINT-001`: Covered by unit tests. Shared acceptance still injects HMAC smoke and does not load the unauthenticated local auth screen.
- `SHELL-DISCOVERY-001`: Covered by unit tests and playwright-cli evidence under work/ui-checks/workflow-discovery/; no dedicated e2e acceptance spec in this slice.
- `PARAM-INIT-WIZARD-001`: Unit/reducer/server cover submit→pending; playwright-cli evidence under work/ui-checks/param-init/; full browser e2e follows after semantic wizard binding picker lands.
- `PARAM-INIT-EMPTY-001`: Server and mock Port tests cover empty approve; dedicated e2e API+UI path follows with wizard empty-mode CTA.
- `PARAM-INIT-REVIEW-001`: API-mode App handlers call Port approve; server materialize + audit covered in initializationService tests; full browser evidence follows.
- `PARAM-INIT-REJECT-001`: Reducer and server reject paths covered; dedicated browser reject/resubmit e2e follows.
- `PARAM-INIT-LOCK-001`: UI lock + submitParameterChanges assertProjectAllowsParameterSubmit covered by unit tests; browser lock evidence follows.
- `PROJ-CONFIG-REVISION-GATE-001`: Unit/server/mock coverage plus playwright-cli evidence under work/ui-checks/td-057-config-set-revision-gate/. A blocking Playwright marker is deferred so this does not enlarge the shared pre-cutover CI acceptance suite (TD-079).
- `PARAM-ADMIN-DIALOG-001`: The modal contract is covered by unit tests on the shared primitive plus playwright-cli evidence; a keyboard-focused e2e spec follows.
- `BRIDGE-WIN-001`: Requires a real Windows bridge runtime and localhost health endpoint orchestration in acceptance.
- `BRIDGE-HDC-001`: Requires a pre-paired bridge process, hdc on PATH, USB device, and DEVICE_BRIDGE_HDC_AVAILABLE=true.
- `DTS-RELOAD-DEPLOY-HW-001`: Requires DEVICE_BRIDGE_HDC_AVAILABLE=true, a paired bridge with mountTarget/pushFile/readKernelLog, USB device, and an approved lab reload destination.
- `DTS-RELOAD-HANDOFF-001`: Browser Playwright automation is pending; unit coverage and playwright-cli evidence land with TD-064.
- `DTS-RELOAD-PROMOTE-001`: Browser Playwright automation is pending; API and page unit coverage land with TD-063.
- `HDC-LAB-001`: Requires DEBUG_DEVICE_GATEWAY_MODE=hdc and HDC_DEVICE_LAB_AVAILABLE=true with hardware attached.
- `ADB-LAB-001`: Requires DEBUG_DEVICE_GATEWAY_MODE=adb, ADB_DEVICE_LAB_AVAILABLE=true, exactly one ready ADB device, one ADB inventory row, and one shared default ADB smoke binding.
- `XIAOZE-APPROVAL-EXEC-FAIL-001`: A true browser path needs a stale-working-tip / unresolvable-overlay fixture that is too brittle for this slice. Graph, orchestrator, and AG-UI assembly tests are the blocking gate; this ID is an honest planned stub.
- `PARAM-FILE-ROLLBACK-001`: Unit/server/mock coverage plus playwright-cli evidence under work/ui-checks/param-file-rollback/. A blocking Playwright marker is deferred so this does not enlarge the shared pre-cutover CI acceptance suite (TD-079).
- `PARAM-SPEC-EDIT-001`: Round-trip is covered by ParameterSpecDetailDialog RTL plus buildSpecEditorSavePayload unit tests and specLifecycle integration; a blocking Playwright marker is deferred so this does not enlarge the shared pre-cutover CI acceptance suite (TD-079).
- `PARAM-SPEC-EDIT-002`: Reachability and keyboard contract are covered by ModalDialog unit tests plus playwright-cli evidence under work/ui-checks/param-spec-editor-batch4/. Mock has no Xiaoze FAB; stacking is the token ladder 1100 < 1150 < 1200. A keyboard-focused e2e spec follows the PARAM-ADMIN-DIALOG-001 pattern.
- `PARAM-SPEC-IDENTITY-001`: Re-attribution is covered by ParameterSpecDetailDialog RTL plus mock/HTTP collision seams and playwright-cli evidence under work/ui-checks/param-spec-identity/; a blocking Playwright marker is deferred so this does not enlarge the shared pre-cutover CI acceptance suite (TD-079).
- `PARAM-SPEC-IDENTITY-002`: Rename gate, collision copy, and deprecated blockers are covered by RTL, presentError, and mock repository tests plus playwright-cli evidence under work/ui-checks/param-spec-identity/; a blocking Playwright marker is deferred so this does not enlarge the shared pre-cutover CI acceptance suite (TD-079).
- `PARAM-ADMIN-IA-001`: Unit-covered in ParameterAdminNextPage and organization path tests; dedicated Playwright marker deferred.
- `MOD-ATTR-QUEUE-001`: Browser automation placeholder only; pending disposable-DB / Playwright coverage before gating CI.
- `MOD-ATTR-CLASSIFY-001`: Browser automation placeholder only; pending disposable-DB / Playwright coverage before gating CI.
- `MOD-ATTR-BULK-001`: Browser automation placeholder only; pending disposable-DB / Playwright coverage before gating CI.
- `MOD-ATTR-TREE-001`: Browser automation placeholder only; pending disposable-DB / Playwright coverage before gating CI.
- `MOD-ATTR-RECLASSIFY-001`: Browser automation placeholder only; pending disposable-DB / Playwright coverage before gating CI.
- `MOD-ATTR-IMPORTANCE-001`: Browser automation placeholder only; pending disposable-DB / Playwright coverage before gating CI.
- `DRV-REG-001`: Browser automation placeholder only; pending disposable-DB / Playwright coverage before gating CI.
- `DRV-REG-002`: Browser automation placeholder only; pending disposable-DB / Playwright coverage before gating CI.
- `DRV-REG-003`: Browser automation placeholder only; pending disposable-DB / Playwright coverage before gating CI.
- `DRV-REG-004`: Unit/server coverage landed with PR1; playwright-cli evidence under work/ui-checks/attribution-deferred/. A blocking Playwright marker is deferred so this does not enlarge the shared pre-cutover CI acceptance suite (TD-079).
- `DRV-REG-005`: Unit/mock coverage plus playwright-cli evidence under work/ui-checks/attribution-deferred/. A blocking Playwright marker is deferred so this does not enlarge the shared pre-cutover CI acceptance suite (TD-079).
- `DRV-SCHEMA-001`: Browser automation placeholder only; pending disposable-DB / Playwright coverage before gating CI.
- `DRV-SCHEMA-002`: Browser automation placeholder only; pending disposable-DB / Playwright coverage before gating CI.
- `DRV-SCHEMA-003`: Browser automation placeholder only; pending disposable-DB / Playwright coverage before gating CI.
- `DRV-SCHEMA-004`: Browser automation placeholder only; pending disposable-DB / Playwright coverage before gating CI.
- `MOD-ATTR-CREATE-KIND-001`: Browser automation placeholder only; pending disposable-DB / Playwright coverage before gating CI.
- `DRV-PROMOTE-005`: Multi-org promote fixtures are not in local seed; blast-radius UI smoke archived under work/ui-checks/governance-closeout-* per 2026-08-01 closeout plan.
- `SPEC-DEPRECATE-001`: Covered by unit tests today; Playwright path deferred to a follow-up after closeout browser smoke.
- `SPEC-RESTORE-001`: Unit-covered; Playwright deferred after closeout smoke.
- `SPEC-EDIT-DIFF-001`: Unit-covered; Playwright deferred after closeout smoke.
- `IDMAP-NEWID-001`: Unit/server covered; dedicated Playwright marker deferred.
- `IDMAP-HISTORY-001`: Browser smoke in closeout; automated marker deferred.
- `IDMAP-REOPEN-001`: Server unit covered; Playwright deferred.
- `MOD-QUEUE-RESTORE-001`: Browser smoke in closeout; automated marker deferred.
- `OVERLAY-RETIRE-001`: Browser smoke in closeout; automated marker deferred.
- `MOD-ATTR-SORT-001`: Browser smoke in closeout; automated marker deferred.
