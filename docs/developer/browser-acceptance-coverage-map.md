# Browser Acceptance Coverage Map

> Chinese: [Chinese](../zh-CN/developer/browser-acceptance-coverage-map.md)

This map is the source of truth for requirement-level browser acceptance coverage. Any plan or PR that changes user-facing UI/API interaction behavior must name the affected acceptance IDs below. If no ID exists for the changed behavior, add one before implementation.

For operation-level coverage, also review [user-operation-coverage-matrix.md](user-operation-coverage-matrix.md). Requirement IDs explain the behavior that must be covered; operation IDs explain the concrete user action, role, route, assertion types, and automation status that prove it.

| ID | Workflow | Blocking | Expected User Behavior | Spec Owner |
| --- | --- | --- | --- | --- |
| `AUTH-RUNTIME-001` | A | Yes | API-mode browser runtime loads the current user with the same auth contract used by local development. | `e2e/acceptance/auth-runtime.acceptance.spec.ts` |
| `SHELL-DIAG-001` | A | Yes | Core routes fail acceptance on unexpected console errors, page errors, request failures, or critical WiseEff API `4xx/5xx` responses. | `e2e/acceptance/shell-navigation.acceptance.spec.ts`; shared diagnostics helper |
| `PARAM-REASON-001` | B | Yes | Parameter drafts cannot be submitted with an empty or blank reason. | `e2e/acceptance/parameters-negative.acceptance.spec.ts` |
| `PARAM-ASSIGNEE-001` | B | Yes | The binding-centric submission panel defaults every workflow slot to an eligible active non-admin user. | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `PARAM-ASSIGNEE-002` | B | Yes | Binding-centric workflow assignee dropdowns hide inactive, guest, admin-only, and role-ineligible users. | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `PARAM-ASSIGNEE-003` | B | Yes | Forced invalid workflow assignees are rejected at the API boundary and surfaced by the UI flow. | `e2e/acceptance/parameters-negative.acceptance.spec.ts` |
| `PARAM-HAPPY-001` | B | Yes | The mature `/parameters` workbench searches semantic bindings, shows the current-edits tray, submits a typed draft through visible assignee selection and role-specific review, then proves semantic merge/writeback, reload, persistence, and audit. | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `PARAM-HOME-001` | B | Yes | Parameter home dashboard loads summary/hotspots from API data and supports in-page window and hotspot-dimension controls. | `e2e/acceptance/parameter-home.acceptance.spec.ts` |
| `PARAM-ADMIN-001` | C | Yes | Parameter admin import preview and audit drawer remain available to Admin. | `e2e/acceptance/parameters.acceptance.spec.ts` |
| `PARAM-ADMIN-002` | C | No | Admin can run the five-step parameter import wizard (target project, multi-format source, per-row review, batch preview, apply). | `e2e/acceptance/parameter-import-wizard.acceptance.spec.ts` |
| `PARAM-IMPORT-DTS-FULL-001` | C | Yes | Admin full `.dts` import uses server `parse-dts` with distinct `@address` module paths; `/include/` is rejected; wizard shows server-parse hint. | `e2e/acceptance/parameter-import-dts-td035.acceptance.spec.ts` |
| `PARAM-IMPORT-REVIEW-META-001` | C | Yes | Import preview with `reviewMetadata.skippedRows` persists that structure on `batch-import` audit metadata. | `e2e/acceptance/parameter-import-dts-td035.acceptance.spec.ts` |
| `LOG-HAPPY-001` | D | Yes | Log upload, analysis progress, evidence, feedback, archive, and unsupported-file path work. | `e2e/acceptance/log-analysis.acceptance.spec.ts` |
| `DEBUG-SIM-001` | E | Yes | Simulator read, write, mismatch, rollback, and audit path work, including complex JSON value metadata. | `e2e/acceptance/debugging-simulator.acceptance.spec.ts` |
| `DEBUG-ADMIN-001` | E | Yes | Debugging admin can create, edit, archive, restore, and protocol-bind catalog parameters in API mode, including complex value metadata. | `e2e/acceptance/debugging-admin.acceptance.spec.ts` |
| `BRIDGE-WIN-001` | E | No | Node debugging Windows-first local bridge panel can show bridge-missing, pairing, startup, and online states with the same-origin Windows download CTA. | `e2e/acceptance/debugging-local-bridge.acceptance.spec.ts` |
| `BRIDGE-TOOLS-001` | C | No | Connected bridge with `tools.adb.available: false` shows tools-missing copy and install-tools CTA (not bridge-missing copy). | `src/NodeDebuggingPage.test.tsx` |
| `HDC-LAB-001` | F | No | Real HDC device lab read/write smoke runs when explicitly enabled. | `e2e/acceptance/hdc-device-lab.acceptance.spec.ts` |
| `XIAOZE-PERCEPTION-001` | G | Yes | Xiaoze answers grounded read-only questions using page context and perception tools. | `e2e/acceptance/xiaoze-perception.acceptance.spec.ts` |
| `XIAOZE-PERCEPTION-AUTHZ-001` | G | Yes | Out-of-scope Xiaoze questions return a safe non-data answer. | `e2e/acceptance/xiaoze-perception.acceptance.spec.ts` |
| `XIAOZE-ACTION-APPROVE-001` | G | Yes | Xiaoze parameter change approval executes through the agent audit chain. | `e2e/acceptance/xiaoze-action.acceptance.spec.ts` |
| `XIAOZE-ACTION-REJECT-001` | G | Yes | Rejecting a Xiaoze action approval does not mutate parameter state. | `e2e/acceptance/xiaoze-action.acceptance.spec.ts` |
| `XIAOZE-ACTION-AUTHZ-001` | G | Yes | Users without edit permission cannot approve Xiaoze mutating actions. | `e2e/acceptance/xiaoze-action.acceptance.spec.ts` |
| `XIAOZE-PLAN-MULTISTEP-001` | G | Yes | Xiaoze resumes a multi-step plan after approval and reports the observed execution result. | `e2e/acceptance/xiaoze-planning.acceptance.spec.ts` |
| `XIAOZE-PROACTIVE-001` | G | Yes | Opt-in Xiaoze proactive suggestions are read-only, authz-bounded, and absent when disabled. | `e2e/acceptance/xiaoze-planning.acceptance.spec.ts` |
| `PERM-GOV-001` | H | Yes | User governance page is Admin-only and the active Admin cannot disable itself. | `e2e/acceptance/permissions.acceptance.spec.ts` |
| `PERM-MATRIX-001` | H | Yes | Role inclusion rules are enforced for visible UI operations. | `e2e/acceptance/permissions-matrix.acceptance.spec.ts` |
| `PERM-MATRIX-002` | H | Yes | Role inclusion and project-scoped workflow eligibility are enforced by API-backed operations. | `e2e/acceptance/permissions-matrix.acceptance.spec.ts` |
| `NOTIF-INBOX-001` | A | Yes | TopBar notification bell opens the inbox panel and notification list APIs load for the current user. | `e2e/acceptance/notifications.acceptance.spec.ts` |
| `NOTIF-READ-001` | A | Yes | Notifications can be marked read through the backend inbox API without cross-user access. | `e2e/acceptance/notifications.acceptance.spec.ts` |
| `PFB-SUBMIT-001` | I | Yes | Active user submits feedback from the sidebar with description and optional images; API persists the item; success UI is shown. | `e2e/acceptance/product-feedback.acceptance.spec.ts` |
| `PFB-ADMIN-001` | I | Yes | Admin lists `/feedback-admin`, opens detail, advances open to in_progress to closed, and sets an admin note. | `e2e/acceptance/product-feedback.acceptance.spec.ts` |
| `PFB-AUTHZ-001` | I | Yes | Non-Admin users cannot access product feedback admin APIs or the feedback-admin page. | `e2e/acceptance/product-feedback.acceptance.spec.ts` |
| `MOD-TREE-PARAM-001` | C | Yes | Admin creates nested parameter modules, assigns a parameter, and parent filtering includes the child subtree. | `e2e/acceptance/hierarchical-modules.acceptance.spec.ts` |
| `MOD-TREE-PARAM-002` | C | Yes | Admin moves a parameter module to a new parent and cycle moves are rejected. | `e2e/acceptance/hierarchical-modules.acceptance.spec.ts` |
| `MOD-TREE-DEBUG-001` | E | Yes | Admin creates nested debug node modules and parent filtering includes assigned child nodes. | `e2e/acceptance/hierarchical-modules.acceptance.spec.ts` |
| `MOD-TREE-AUTHZ-001` | C | Yes | Non-admin cannot mutate module trees and deleting non-empty modules returns 409. | `e2e/acceptance/hierarchical-modules.acceptance.spec.ts` |
| `MOD-ATTR-QUEUE-001` | C | Yes | The unclassified compatible queue lists only non-scaffolding, non-dismissed compatibles with parameter and project counts; dismissing removes an entry and restoring brings it back, both audited. | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `MOD-ATTR-CLASSIFY-001` | C | Yes | Classifying a compatible shows the impact preview, applies on confirm, moves parameters into the new driver group, and removes the emptied unclassified bucket. | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `MOD-ATTR-BULK-001` | C | Yes | Several selected compatibles are filed into one business category in a single confirmed action. | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `MOD-ATTR-TREE-001` | C | Yes | Tree actions are kind-scoped: instance and logical modules offer no delete, logical modules can move, renaming an auto module adopts it, and the adopted name survives a re-ingest. | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `MOD-ATTR-RECLASSIFY-001` | C | Yes | Admin reclassifies a logical module to a business category in the edit dialog; the tree kind badge and filters update, and re-ingest does not revert the curated kind. | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `MOD-ATTR-IMPORTANCE-001` | C | Yes | Importance set on a business category is inherited by its driver groups and instances and drives the workbench importance filter. | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `DRV-REG-001` | C | Yes | Admin registers a driver before any DTS upload; it appears in the module tree as a not-yet-observed curated driver group with a parse-coverage chip. | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `DRV-REG-002` | C | Yes | Admin claims an observed-but-unregistered driver from the queue or module tree; the driver group origin becomes curated. | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `DRV-REG-003` | C | Yes | After a DTS upload, the one-shot ingest summary reports matched registered drivers and newly observed unregistered compatibles. | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `DRV-SCHEMA-001` | C | Yes | Admin authors a draft organization overlay schema from an uncovered driver group, activates it, and sees the coverage chip change to organization-covered. | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `DRV-SCHEMA-002` | C | Yes | Uploading a DTS whose compatible only the organization overlay claims binds typed properties and does not open unmatched review tasks for those properties. | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `DRV-SCHEMA-003` | C | Yes | Activating an overlay for a compatible a pinned schema already covers is rejected with an explanation. | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `DRV-SCHEMA-004` | C | Yes | Activating an overlay for an already-uploaded device upgrades existing provisional specs in place without a re-upload and closes related review tasks. | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `MOD-ATTR-CREATE-KIND-001` | C | Yes | Admin creates empty business, driver-group, instance, or logical modules from the attribution tree with parent-kind rules, required compatibles for driver groups, and not-yet-observed markers on empty curated nodes. | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `PLAT-ROLE-001` | C | No | Platform admin sees `/platform-console` in the sidebar; other roles get permission-denied on direct navigation. | — |
| `PLAT-ROLE-002` | C | No | Organization Admin cannot grant `platform-admin` and the control is not rendered. | — |
| `PLAT-ROLE-003` | C | No | Platform admin access to another organization's parameters, logs, and users remains denied. | — |
| `DRV-PROMOTE-001` | C | No | Overlay shadowed by pinned or platform schema names the replacing tier. | — |
| `DRV-PROMOTE-002` | C | No | Promoted overlay reads as promoted and links the platform row. | — |
| `DRV-PROMOTE-003` | C | No | Authoring overlay when platform row covers compatible is refused with reason. | — |
| `DRV-PROMOTE-004` | C | No | After promotion, org without overlay sees platform-covered compatible on attribution tree. | — |
| `DRV-PROMOTE-005` | C | No | Console promotion shows cross-tenant blast radius; revert restores contributors. | — |
| `PARAM-FILE-ADMIN-001` | C | Yes | Admin uploads a project parameter file, lists versions, manual sync creates a `file_sync` draft, and the project files panel renders in `/parameter-admin/projects`. | `e2e/acceptance/parameter-files.acceptance.spec.ts` |
| `PARAM-FILE-CONFLICT-001` | C | Yes | Admin resolves an open file/UI draft conflict by keeping the file or UI value. | `e2e/acceptance/parameter-files.acceptance.spec.ts` |
| `PARAM-SPEC-GOVERN-001` | C | Yes | Admin searches ingested parameter specs (distinct sc8562/mt5788 `gpio_int`), opens detail, and resolves a spec review task with governance audit. | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `PARAM-TOPOLOGY-BROWSE-001` | B | Yes | Inside the integrated DTS workbench, users toggle real source/effective views, select the nested `amba` → `i2c@FDF5E000` → `sc8562@6E` context, search two `gpio_int` semantic rows, and open the mature detail dialog with path, raw value, shape, and provenance; topology API must return 200 with expected nodes. | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `PARAM-TOPOLOGY-EDIT-001` | B | Yes | Typed binding drafts surface schema cell-count diagnostics, reject stale revision with HTTP 409, and exercise fail-closed compiler/toolchain validate on a throwaway Config Set. | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `PARAM-IDENTITY-MAP-001` | B | Yes | Open identity mapping blocks validate (`open-mapping`); resolve clears the blocker with governance audit evidence. | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `PARAM-IDENTITY-MAP-ADMIN-001` | B | Yes | Admin resolves identity mapping tasks from `/parameter-admin` with candidate evidence and governance audit. | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `PARAM-CONFIG-PUBLISH-GATE-001` | B | Yes | Real toolchain validate succeeds on golden/candidate Config Set after status=okay + vendor linux-bindings (not schema-failed-as-success); bindingId + provenance persist from DB after reload. | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `PARAM-ENABLE-GATE-001` | B | Yes | Structural properties (including `status`) produce no spec review task and do not block candidate promotion or migration finalize; pre-existing structural tasks dismissed with a systemic reason. | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `PARAM-ENABLE-VISIBLE-001` | B | Yes | Topology tree shows enabled/disabled badges and unreachable markers; workbench rows under a disabled node show the no-effect notice. | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `PARAM-ENABLE-TOGGLE-001` | B | Yes | Disable requires reason and confirmation; enablement draft submits in the same round as a binding edit without `mixed-working-tips`; distinct `enablement-changed` audit. | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| `PARAM-ENABLE-GUARD-001` | B | Yes | Non-standard `status` values render read-only; secondary override requires explicit acknowledgement before write. | `e2e/acceptance/parameter-topology.acceptance.spec.ts` |

## Interpretation

- `Blocking = Yes` means the ID must be covered by a Playwright acceptance marker before `npm run acceptance:coverage` can pass.
- `Blocking = No` means the ID is tracked, but may be skipped when the required external dependency is explicitly out of scope. Today this includes the HDC device lab and Windows local bridge runtime coverage.
- Coverage markers use comments in acceptance specs: `// @acceptance PARAM-REASON-001`.
- A workflow-level pass does not imply every row above is covered. The generated browser evidence must report requirement-level coverage before this map can be treated as satisfied.
- Operation markers use comments in acceptance specs: `// @operation PARAM-REASON-001`. Automated P0/P1 operation IDs must produce operation evidence under `docs/generated/acceptance-operation-evidence.md`.

## Supplemental Manual Evidence (Xiaoze P2)

Playwright acceptance covers `XIAOZE-PLAN-MULTISTEP-001` and `XIAOZE-PROACTIVE-001` at the API/SSE layer. Real-auth browser screenshots (development session, deterministic provider) are archived under `work/ui-checks/xiaoze-p2-*` and indexed in `docs/exec-plans/completed/2026-06-24-xiaoze-p2-planning.md` (Manual Browser Evidence).
