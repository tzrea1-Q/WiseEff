# Project review role governance

> Chinese: [Chinese](../../zh-CN/exec-plans/active/2026-09-15-project-review-role-governance.md)

**Status:** In Progress (P1, P2, P3 completed; P4 browser acceptance and delivery underway).
**Source baseline:** `main@3a49ba62685523742bac0d212ea2d652ce3f8e88`, verified on 2026-09-15.  
**Goal:** An administrator can configure project review roles in the product; ordinary users can complete parameter submission, hardware review, software review and merge without terminal operations. Role edits must preserve unrelated grants and cannot expand authority beyond their scope.

## 1. Findings and scope

The reported missing-candidates message is a real prerequisite failure. The deployed project's actual role inventory remains unknown; source evidence establishes the product gap, not which employees should receive a role.

| Current evidence | Consequence |
| --- | --- |
| `server/modules/parameters/reviewWorkflowRepository.ts`: candidates require active users in the caller's organization with an exact project binding. Software committers also qualify for the software-user slot. | An organization-level MDE role alone does not populate the project's candidate list. |
| `src/UserPermissionsPage.tsx`, `src/infrastructure/http/userGovernanceClient.ts`: organization management submits a single role and projects the first returned binding into `roleId`. | There is no project role editor, and the UI loses the full scope model. |
| `server/modules/users/service.ts`, `repository.ts`: role replacement deletes all of a user's organization bindings. Registration-role approval uses the same replacement. | Changing an organization role can erase project assignments. Fix all production writers at the shared seam. |
| `server/modules/auth/repository.ts`: built-in permissions are unioned across organization and project bindings. | Adding a project MDE binding can add global capabilities. Configuration cannot ship before scope semantics are corrected. |
| `server/modules/parameter-kernel/policy.ts`, `parameters/service.ts`: stage authorization is role based; assignment is not an exclusive execution lock. Organization roles and an admin exception can authorize stages. | Candidate discovery, stage execution and the meaning of assignment must be specified together. |
| `docs/adr/0037-organization-administration-is-home-org-tenant-operations.md`, TD-121 | Project membership was deliberately excluded from organization administration. This proposal adds a bounded project review-role surface; it does not claim that a general ProjectMember or project visibility ACL product now exists. |

Deliver one complete workflow increment: scoped role writes and permissions, project configuration, candidate readiness, existing-request handling, and populated-environment acceptance. Reuse `user_role_bindings`, existing workflow states, audit and UI components. No custom roles, departments, organization switching, project invitations, general project visibility migration, bulk automatic grants or workflow engine replacement.

The proposal reopens ADR-0037's statement that project-scoped bindings are not a shipped product. Its home-organization boundary and exclusion from `/organization` remain. On acceptance, record the narrow successor decision and update TD-121 to separate review-role delivery from the remaining project ACL product. Do not mark TD-121 wholly complete.

## 2. Proposed product rules

These are recommended decisions for the implementation contract, not claims about already deployed behavior.

| Concept | Rule |
| --- | --- |
| Organization role | Account-level capabilities in the home organization. Editing it changes only organization-scoped built-in roles. |
| Project review role | An explicit built-in business role bound to one project; supplies parameter capabilities in that project and eligibility for its corresponding workflow slot. It does not grant global debugging, knowledge, log or administrator privileges. |
| Candidate pool | All active, same-organization users with the exact project role. Existence of an organization role, administrator status or an assignment on another project is insufficient. Deduplicate each pool by user ID. |
| Round assignee | The selected recipient responsible for a stage. Preserve the existing role-pool execution model: another currently eligible user in that project's stage can handle it. Selection does not introduce a new exclusive-executor rule. |
| Management authority | Active home-organization administrator with `users:manage` and organization-scoped `admin` or `platform-admin`. Check project and user ownership server-side. Project-scoped admin-shaped legacy rows cannot confer this authority. |
| Administrator intervention | Preserve an explicit, audited organization-admin intervention path for existing rounds. Show intervention separately from ordinary candidate eligibility; it never silently fills missing submission slots. |

| UI label | Stored role | Eligible slot |
| --- | --- | --- |
| Hardware MDE | `hardware-committer` | Hardware review |
| Software MDE | `software-committer` | Software review; also software merge |
| Software developer | `software-user` | Software merge |

Each pool may contain several users. Require at least one eligible user in all three pools before a new round is submitted. Software MDE can also perform software merge, so two configured users can cover all three slots. Preserve current support for one person holding multiple explicit roles; this increment adds no separation-of-duty rule or automatic self-review restriction. Administrators need explicit project business roles to appear as ordinary candidates.

Organization-wide parameter reading/editing grants remain valid, including the earlier parameter-read fix. For ordinary stage execution, require the exact project review role, matching discovery; the former organization-MDE fallback is deliberately removed. Project review-role removal revokes that project responsibility even if the account remains an organization MDE. Global account deactivation revokes all active execution immediately. Changing an organization role does not implicitly erase an independently granted project role; the account screen must explain this distinction.

## 3. User experience

1. Add **Review roles** to each row/card in the existing project administration list. Open a dedicated project-scoped view at proposed route `/parameter-admin/projects/:projectId/review-roles`, with a return link and reload/deep-link support. Keep source/configuration workbench interactions intact.
2. Show the three candidate pools, empty-role messages and a user editor with the three role checkboxes. Search existing home-organization users. Show inactive users already assigned as unavailable; only active users may receive new grants. Allow removal from inactive users. Save one user's project roles atomically, with before/after scope preview; there is no misleading all-project batch-save transaction.
3. Show review readiness when entering the parameter project and before submission. Name each missing pool. An authorized admin gets the project configuration link; other users get a precise instruction to contact an administrator. A request failure/loading state must not masquerade as an empty candidate pool.
4. Refresh candidate/readiness state after saving, on returning to the parameter project and immediately before submission. Retain still-valid choices; clear invalid choices with a reason. Preserve parameter values, staged drafts and the user's reason on readiness failure or a stale-role conflict. The server rechecks inside the submission transaction.
5. In organization management, display organization roles and project responsibilities distinctly. Project responsibilities link to project administration and are not edited as part of the organization-role form. Do not derive the displayed organization role from `roles[0]`; preserve all returned bindings and explicitly render legacy multiple organization roles.
6. Existing rounds retain submitted assignee and decision history. If the named recipient becomes unavailable, show that status and the remaining eligible stage pool. A replacement pool member or the explicit admin intervention path can continue; there is no silent reassignment, fabricated approval, automatic stage skip or reset of completed decisions. The existing submitter withdrawal remains available. Dedicated reassignment is unnecessary for this role-pool model.

## 4. Backend and API contract

### 4.1 Scoped persistence and compatibility

Reuse the users module as owner of role writes. Its new shared operation validates scope, locks the target user row, compares the normalized current role set with an expected set, updates only its owned subset, and writes audit in one transaction. Every production writer must use that lock discipline, including organization-role approval, activation and deletion. Establish one deterministic lock order before adding workflow locks and cover opposing interleavings with real PostgreSQL tests.

| Proposed API | Contract |
| --- | --- |
| `GET /api/v1/projects/:projectId/workflow-role-bindings` | Admin-only project role inventory, including inactive assignments and per-pool readiness. Use the existing authorized users directory for selection; do not expose account details to ordinary submitters. |
| `PUT /api/v1/projects/:projectId/workflow-role-bindings/:userId` | `{roles: RoleId[], expectedRoles: RoleId[]}`; allowed IDs are only the three roles above. Empty `roles` removes those roles for this user/project. The compared and changed subset is exactly those three IDs in this project. |
| `PUT /api/v1/users/:userId/organization-roles` | Same expected-set contract for organization-scoped built-in roles. Preserve every project binding and separately owned Catalog capability binding. Retain self-lockout and platform-admin grant/revoke protections. |
| Existing `PUT /api/v1/users/:userId/roles` | Compatibility adapter for organization-only payloads, preserving project/capability rows. Project-bearing payloads fail explicitly with an actionable deprecation error. Do not leave a second full-replacement write path. Migrate all first-party callers, including registration approval and account creation; public account creation cannot smuggle project grants. |
| Existing `GET /api/v1/projects/:projectId/parameter-workflow-assignees` | Keep three candidate arrays. Add server-owned readiness (`ready`, `missingRoles`) without exposing admin-only user inventory. Validate the project belongs to the caller's organization and enforce project read/edit scope. |

New writes reject duplicate, malformed, unsupported and foreign identities. Audit actor, target organization/project/user, before/after grants and request ID; never store credentials or parameter values. A role mutation and its audit either both commit or both roll back. Use ordinary in-app notifications only where the existing workflow requires them.

For compare-and-set writes: lock, normalize, authorize, then compare. If desired state already equals actual state, return success without duplicate mutation/notification. Otherwise a stale expected set returns `CONFLICT` with a stable detail code such as `role-bindings-stale`; the UI refreshes and asks the operator to review the new diff. This is state-based concurrency control, not proof that no intervening edits occurred. A lost response is reconciled by readback; no blind full-list rollback. Organization-only legacy requests remain last-writer-wins within their explicit organization scope until migrated, but can never delete project roles.

Do not add a second role store or a generic authorization framework. A new database migration is not assumed. Normalize duplicate rows at the owned write seam and deduplicate reads; any need for a global uniqueness constraint must first inventory historical data and all writers.

### 4.2 Permission scope prerequisite

Built-in global permissions must derive from organization-scoped roles. Retain the existing separately governed Catalog capability resolver and its scope contract. Parameter operations with a project identity compute authority from organization grants plus matching project business grants; other-project grants never contribute. Project roles must not upgrade global device-write, knowledge-write, log or administrator authority.

Audit all callers of changed auth/policy helpers, not just the new page: auth context construction, `/me`, parameter read/edit/critical-edit/review/merge, Catalog project reads, Agent policy and frontend navigation/action projection. Project-only accounts must still enter and operate on their eligible project; simply removing permissions from the flat union without repairing these consumers is incomplete. Requests with no resolved project may discover allowed projects, but cannot authorize a project mutation using an unspecified scope. Verify representative debugging/log/knowledge refusals as regression boundaries; do not redesign those products.

Preserve user/Agent/system invocation provenance and sensitive-node merge gates. Never create a privileged synthetic actor to repair missing eligibility.

### 4.3 Discovery, submission and execution

Use one role-to-stage eligibility definition for discovery, submission validation and ordinary review/merge authorization. Resolve selected/acting users from current database state inside the transaction, validate organization/project/active state, and serialize with revocation. A revocation committed before stage authorization must win; a stage transaction authorized and serialized first may finish before revocation. Do not depend only on a request-start `AuthContext` snapshot.

On every new ordinary parameter submission, require all three pools and explicit eligible assignees, including direct HTTP calls and structured-edit adapters; omitting assignees is not a bypass. Inventory every `submitParameterChanges` caller and migrate it to this contract. Previously stored no-assignee rounds remain readable and use current-stage role-pool authorization; fixture creation is not a production exemption. Project initialization review has its own workflow and remains outside this change. On review, only current-stage eligibility is required; removing a previous reviewer does not invalidate an already committed decision. If a later stage lacks a candidate, keep the round blocked there until its pool is repaired; never erase its draft/value/history or synthesize a decision.

## 5. Implementation sequence and ownership

One feature branch and one coordinated release; the four tasks are dependency-ordered, not four independently deployable patches.

| Task | Changes and principal seams | Exit evidence |
| --- | --- | --- |
| P1 — Scope and write safety (R3) | `server/modules/auth/{repository,policy}.ts`; `server/modules/users/{routes,schemas,service,repository}.ts`; `server/modules/parameter-kernel/policy.ts`; direct policy consumers. Freeze the role/permission matrix and every writer before implementing. | Real PostgreSQL Red→Green for preservation, privilege boundaries, stale writes, concurrent revocation and audit rollback. |
| P2 — Project role configuration (R2, depends P1) | `src/components/parameter-admin-next/ProjectsOperationsPanel.tsx`; `src/components/admin/ProjectAdminTable.tsx`; new project review-role view; user governance port/client/types and `src/UserPermissionsPage.tsx`; API wiring. | Actual admin configuration, non-admin denial, conflict recovery and organization-role preservation through UI/API. |
| P3 — Workflow integration (R3 seam + R2 UI, depends P1/P2) | `server/modules/parameters/{service,reviewWorkflowRepository}.ts`; `src/application/ports/ParameterRepository.ts`; `src/infrastructure/http/parameterClient.ts`; `ApiProjectTopologyWorkspace.tsx`, `DtsBindingDraftTray.tsx`; review-page consumers. | Candidate discovery/submit/review use the same rules; deactivation/removal mid-round has a tested recovery path; drafts survive failures. |
| P4 — Upgrade and acceptance (depends P1–P3) | Existing acceptance specs, bilingual contracts/security/runbook, populated-data rehearsal. | New and existing projects work after upgrade and restart; full ordinary-user workflow plus permissions regression and rollback rehearsal. |

## 6. Threat and acceptance matrix

Implementation owner supplies executable tests; the independent Spec reviewer challenges this matrix before P1/P3 implementation. The operator owns deployment-only observations. Every automated command must collect a nonzero intended case count; skipped DB/browser cases do not satisfy an acceptance row.

| ID | Scenario | Required observation |
| --- | --- | --- |
| R01 | Empty project pools; one missing pool; software MDE covers two software slots; duplicate legacy bindings | Exact missing roles; no phantom readiness; unique candidate IDs; valid three-slot submission succeeds. |
| R02 | Organization-only MDE; other-project MDE; foreign/inactive user; forged project/admin role | No ordinary candidate/stage privilege; management rejects forbidden grants without writes or audit-success rows. |
| R03 | Organization role changed or registration approved after project configuration | Project/capability grants survive; organization scope changes only as previewed; full DTO survives the client. |
| R04 | Two admins edit same subset; different projects edited; response lost then retried | Stale change conflicts; disjoint changes survive; retries/readback converge without duplicate side effects. |
| R05 | Role removed or account deactivated during submission/review/merge; deletion races | Defined serialization, no stale-authority execution, no deadlock; history retained and UI explains recovery. |
| R06 | Project-only MDE, organization guest + project MDE, project-shaped legacy admin | Intended project parameter flow works; other-project and global device/knowledge/log/admin privilege does not appear. Organization-wide valid grants still work. |
| R07 | Audit/DB failure; invalid user/project; malformed/empty role set | Atomic rollback; empty set removes only its scoped subset; no cross-scope data loss. |
| R08 | Named assignee unavailable, another candidate handles current stage; admin intervention; no candidates remain | Actor and intervention are truthful in audit; completed decisions unchanged; empty pool blocks ordinary execution. |
| R09 | Populated upgrade, old organization-only client, obsolete full-role client, restart, application rollback | Existing grants/data persist; old safe client preserves project roles; unsafe payload rejected; neither the older destructive writer nor project-to-global permission expansion can return to service. |
| R10 | Config → ordinary-user edit → submit → hardware/software review → merge → reload | Actual source/version and values persist, audit matches actors, prior structural-index and unchanged-baseline fixes remain valid. |

Extend existing server suites `server/modules/users/service.test.ts`, `server/modules/parameters/reviewWorkflowRepository.test.ts`, `server/modules/parameters/serviceReviewWorkflow.integration.test.ts`, and auth/parameter policy tests. Add real-PostgreSQL scoped-write/concurrency cases at the users service seam. Extend frontend client/page/tray tests. Use exact discovered test paths in each task packet; build once after the integrated TypeScript changes.

```bash
npm run test:server -- server/modules/users/service.test.ts server/modules/parameters/reviewWorkflowRepository.test.ts server/modules/parameters/serviceReviewWorkflow.integration.test.ts
npx vitest run src/infrastructure/http/userGovernanceClient.test.ts src/components/parameter-topology/DtsBindingDraftTray.test.tsx
npm run build
npm run docs:check
```

These existing-file commands are a starting set, not the whole future suite. Add newly created scope/concurrency/view tests to the sealed command list. Use an owned PostgreSQL database with migrations and purpose-built non-admin fixtures; never run seed/repair tests against deployment data.

Browser coverage: extend `e2e/acceptance/parameter-admin-projects.acceptance.spec.ts`, `permissions.acceptance.spec.ts`, `permissions-matrix.acceptance.spec.ts`, `parameter-topology.acceptance.spec.ts`, and `parameters-negative.acceptance.spec.ts`. Existing requirement/operation IDs: `PARAM-ADMIN-003`, `PERM-USER-MGMT-001`, `PARAM-ASSIGNEE-001/002/003`, `PARAM-HAPPY-001`, `PLAT-ROLE-002/003`. Before implementation register proposed `PROJ-REVIEW-ROLES-001` (configure/revoke/conflict) and `PROJ-REVIEW-READINESS-001` (missing roles, refresh, recovery) in both coverage maps and Chinese companions, initially marked planned/future rather than automated. Generate operation evidence with the existing acceptance runner.

Real browser proof must exercise the API-mode routes at **1440×900, 768×1024, 390×844**, with snapshot, screenshots, keyboard/form/deep-link interactions, console and network inspection. Browser success must include real persistence, not only a mock role list. The full acceptance runner and any unrelated existing failures are reported separately from focused evidence.

## 7. Deployment, migration and rollback

1. Read-only inventory: per-project candidate counts, duplicate/foreign/orphaned bindings, inactive assigned users, project-only accounts and open rounds. Report scope issues without exporting credentials or parameter values. Keep detailed names locally for authorized administrators.
2. No auto-grant from organization roles and no production reseeding. Preserve all valid existing project roles, including any earlier operator configuration. Admins select actual responsible people through the new UI. Ambiguous/cross-organization records are explicitly repaired by their owner before enablement; do not silently normalize them into global grants.
3. Deploy the compatible backend and frontend together after the P1–P4 local gate. Older cached organization-only clients remain safe; obsolete project-bearing full-replacement payloads receive the documented refusal. Refresh frontend assets. Re-read auth state from the database so revocation does not wait for a user logout.
4. On Aurora, an administrator verifies pools in the UI; ordinary role accounts execute R10. Recheck after API/container restart and after an organization-role edit. These are operator-run target acceptance steps, not evidence obtainable from the agent's local workspace.
5. Back up before upgrade. No planned data transformation requires deleting bindings, users, drafts or history. Rollback must retain a backend with the corrected scoped authorization and safe role writes. The old backend cannot return to service with project bindings: even with role writes fenced, it immediately expands project roles into global permissions. If backend rollback is unavoidable, keep maintenance isolation until the authorization boundary is repaired and verified; reverting only compatible frontend assets is preferable. Also fence the destructive legacy role endpoint. Rehearse rollback with an organization-guest/project-MDE account and prove that global privileges do not reappear. If an unavoidable schema/data migration is later added, design and rehearse its exact restore procedure before delivery. Never restore an old role-list snapshot over concurrent changes.

Release success requires the scoped-authorization matrix, UI configuration, full review workflow and data-preserving restart evidence. A locally green build or a PR merge alone is not deployment acceptance.

## Git & PR Workflow

- Planning lane: `codex/project-review-role-plan`, isolated from clean `main`; editable paths are this bilingual plan, bilingual plan indexes and their inventory only. No product implementation, GitHub issue publication, PR merge or server changes in this planning round.
- Implementation Scratch branch: proposed `codex/project-review-role-governance`, created from refreshed `origin/main` after the plan is accepted. P1 → P2 → P3 → P4 on one branch, development WIP 1. Reserve separate Standards and Spec reviewers for R2/R3 sealing; R3 threat review precedes production edits.
- Seal only after all chosen focused tests, real PostgreSQL cases, build, browser evidence, docs and independent reviews pass on the exact candidate. Run broader checks only where the verification matrix requires them. Record failures/skips without silently fixing unrelated main failures.
- The earlier instruction to merge without waiting for CI is not implementation authorization for this planning-only turn. For a later authorized delivery, record any accepted CI waiver separately from local checks and GitHub branch protection; do not label absent Hosted results as passed.
- Stop boundary for this round: a reviewable bilingual proposal and documentation checks. Future implementation stops at integration-ready unless its delivery instruction authorizes publication/merge. Target verification remains operator-owned.

## Documentation Impact Matrix

All paths below are implementation obligations unless marked as this-round planning work. Companion paths are explicit to avoid a second unmaintained specification.

| Area | Action | Exact paths and purpose |
| --- | --- | --- |
| Repository maps | Review | `AGENTS.md`, `ARCHITECTURE.md`, `CONTEXT.md`, `docs/zh-CN/root/AGENTS.md`, `docs/zh-CN/root/ARCHITECTURE.md`: keep modules/glossary small; update only if ownership changes. |
| Planning | Update | This EN/ZH plan; `docs/PLANS.md`, `docs/zh-CN/PLANS.md`, `scripts/bilingual-docs.ts` (this round); `docs/exec-plans/tech-debt-tracker.md`, `docs/zh-CN/exec-plans/tech-debt-tracker.md` (TD-121 scope at implementation). |
| Product | Update | `docs/product-specs/product-spec.md`, `docs/zh-CN/product-specs/product-spec.md`: project roles, slot readiness and role-pool execution. |
| Architecture/API | Update | `docs/design-docs/domain-model.md`, `docs/design-docs/api-contract.md`, `docs/design-docs/2026-08-19-organization-administration-design.md` and respective files under `docs/zh-CN/design-docs/`: scope and compatibility contract. |
| Quality/testing | Update | `docs/developer/browser-acceptance-coverage-map.md`, `docs/developer/user-operation-coverage-matrix.md`, their companions under `docs/zh-CN/developer/`; review `docs/developer/verification-matrix.md` and `docs/zh-CN/developer/verification-matrix.md`. |
| Reliability/runbook | Update | `docs/runbooks/identity-provider.md`, `docs/zh-CN/runbooks/identity-provider.md`: inventory, UI operation, rollout and rollback role-write fence. |
| Security/governance | Update | `docs/SECURITY.md`, `docs/zh-CN/SECURITY.md`, `docs/security/user-permission-design.md`, `docs/zh-CN/security/user-permission-design.md`; link a narrow successor to `docs/adr/0037-organization-administration-is-home-org-tenant-operations.md` after the proposal is accepted. Allocate an ADR number only at implementation. |
| Frontend/design | Review | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md`, `docs/design-docs/ui-design-system.md`, `docs/developer/ui-quality-checklist.md`: ports, navigation, shared components and completion evidence. |
| Generated artifacts | Review | `docs/generated/db-schema.md`, `scripts/bilingual-docs.ts`: schema regeneration only if a migration becomes necessary; inventory links in this round. |
| References | Review | `docs/api/examples.md`, `docs/zh-CN/api/examples.md`, `docs/references/productization-api-contract-draft.md`: eliminate unsafe full-role replacement examples if present. |

## Documentation Update Gate

Keep this plan active until implementation and target acceptance finish. Every Update/Review row must be updated or explicitly marked unchanged with evidence before moving to completed; deferred required work goes into the debt tracker. This proposal does not itself alter accepted product/security contracts or close debt. Maintain separate linked EN/ZH pages and run `npm run docs:check`; distinguish documentation governance from a skipped generated-schema check.

## Planning control record

- Instruction discovery: checked `AGENTS.override.md` then `AGENTS.md` at the worktree root, `docs/`, `docs/exec-plans/`, its `active/`, and the equivalent `docs/zh-CN/` chain. Only root `AGENTS.md` was selected. User-supplied Ponytail rules also apply.
- Base `3a49ba62685523742bac0d212ea2d652ce3f8e88`; original checkout clean and untouched. Risk R1 for the documentation change; future P1/P3 are R3. No deletion/rename, runtime/config/schema changes or remote execution.
- Planning verification: `npm run docs:check` documentation governance PASS; generated database-schema check SKIP because local PostgreSQL lacks pgvector. `npm run build` PASS with browser-externalization/chunk-size warnings; `git diff --check` PASS. Independent combined Standards/Spec review by `/root/unchanged_gate_spec` PASS after correcting rollback authorization. EN/ZH contract literals and R01–R10 IDs match. Product behavior/PG/browser/Hosted/target evidence: not run in this planning round; the build is not workflow acceptance.
