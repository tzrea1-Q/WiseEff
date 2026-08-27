# Issue #640 Guarded Permanent Deletion for Debug Nodes

> Chinese: [Chinese](../../zh-CN/exec-plans/completed/2026-08-27-issue-640-debug-node-delete.md)

**Goal:** Add an admin-only permanent deletion flow for logical debugging nodes while preserving reversible disablement and protecting every node referenced by `node_operations`.

**Branch:** `codex/issue-640-debug-node-delete`, checked out from the latest `main` at `8b6a2ad2d80e6bdd24af150863ef1c7293039dbe`. The primary worktree's unrelated `App.tsx` and `App.test.tsx` edits are outside this plan.

**Status:** Completed locally on 2026-08-27 on the feature branch. Parent-agent PR/merge/push work remains separate.

## Scope and Acceptance Coverage

- In scope: `DELETE /api/v1/debugging/admin/nodes/:nodeId`, organization-scoped permission/not-found handling, operation-history guard with a restrictive-FK race guard, binding cascade, redacted request-correlated audit, admin UI confirmation/loading/error/reconciliation states, mock-runtime state convergence, contract artifacts, documentation, and acceptance evidence updates.
- Out of scope: force/tombstone deletion, bulk or module deletion, device I/O changes, legacy operation migration, and changing disable/re-enable semantics.
- Acceptance coverage reviewed and updated: `DEBUG-ADMIN-001` in `e2e/acceptance/debugging-admin.acceptance.spec.ts`, `docs/developer/browser-acceptance-coverage-map.md`, `docs/developer/user-operation-coverage-matrix.md`, `e2e/acceptance/requirements.ts`, and `e2e/acceptance/operationMatrix.ts`.

## Architecture and Safety Contract

The service requires `debugging:admin` and resolves the organization from the authenticated context. It locks the organization-scoped node row, counts all scoped operation history before deletion, and returns a structured `409` with `reason=node-history-protection` and `operationCount` when history exists. The database's restrictive `node_operations.node_id` foreign key remains the final concurrent-insert guard and is translated only when the named node-operation FK rejects the delete. A successful delete removes HDC/ADB bindings through the existing `on delete cascade` relationship and records one `debug-node-admin-delete` event containing only node identity/status/module/binding-count metadata; raw paths, values, descriptions, and notes are excluded.

The UI keeps disablement as the reversible action, exposes deletion as a distinct danger action, requires explicit confirmation, prevents double submission, retains the dialog on history conflict, refreshes on a concurrent `404`, and removes deleted nodes from the derived catalog/KPI/module counts. Mock deletion dispatches the shared state action as well as updating the page-local optimistic view so navigation and runtime-derived lists converge.

## Implementation Tasks

- [x] Add repository deletion/count seams with row locking, binding cascade, and history protection.
- [x] Add the admin service and route with permission, organization scope, stable `204`/`404`/`409` behavior, audit redaction, and named-FK race translation.
- [x] Add the frontend client, danger action, canonical `ConfirmDialog` confirmation, loading/error/not-found reconciliation, and mock state convergence.
- [x] Add repository/service/route/client/page/table tests, including cascade, history protection, exact response status, encoded IDs, 404 refresh, and double-submit prevention.
- [x] Update OpenAPI/route parity artifacts, bilingual API/domain/acceptance documentation, and automated acceptance coverage/evidence.
- [x] Run final focused/full quality gates, complete independent Standards/Spec review, fix P0/P1 findings, and commit the feature branch.

## Verification

Targeted gates include the changed frontend tests, real-PostgreSQL debugging repository/service tests, contract route/OpenAPI tests, `npm run build`, `npm run lint`, `npm run ui:check`, `npm run docs:check`, `npm run contract:check`, and acceptance coverage/operation matrix checks. Full `npm run test:server` is required; the ordinary frontend suite is reported separately if unrelated timeout/navigation failures occur under contention.

Final local evidence: the focused frontend suite passed 3 files / 27 tests; the focused debugging/contracts server suite passed 4 files / 135 tests; full `npm run test:server` passed 361 files / 2,776 tests with 1 file and 4 tests skipped; full `npm run test:scripts` passed 69 files / 948 tests with 5 skipped; `npm run build`, `npm run contract:check`, `npm run acceptance:coverage`, and `npm run acceptance:operations` passed; `npm run ui:check` passed; and `npm run lint` exited with 0 errors (299 existing warnings). The ordinary frontend suite previously had 44 unrelated navigation/timeout failures under concurrent load, while all changed frontend tests were green.

Browser evidence is stored under `work/ui-checks/issue-640/` for `/debugging-admin/nodes` in mock runtime at `1440x900`, `768x1024`, and `390x844`, with snapshots, screenshots, delete-dialog warning/cancel/Escape focus restoration, console-error inspection, and mock network behavior. Representative final screenshots are `cli-desktop-1440x900.png`, `cli-delete-dialog-1440x900.png`, `cli-tablet-768x1024.png`, and `cli-mobile-390x844.png`; the clean mock walkthrough reported 0 console errors. API-mode database behavior, exact 204/409 responses, no-side-effect protection, cascade, and request-correlated audit are covered by real PostgreSQL/service/route and acceptance-spec assertions. A standalone API browser process could not be used as acceptance evidence because this workstation lacks the repository database environment; it returned the documented missing-DB/permission boundary and made no product claim.

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation agent | Commit ticket changes on `codex/issue-640-debug-node-delete`; do not push, open a GitHub PR, merge, or fast-forward `main`. |
| Parent agent | Review this branch, open/merge the GitHub PR when approved, then sync local `main`. |

## Documentation Impact Matrix

| Area | Status | Files | Notes |
| --- | --- | --- | --- |
| Repository maps | Review | `AGENTS.md`, `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` | Existing ownership and frontend seams remain valid; no map rewrite required. |
| Planning docs | Update | this plan and Chinese companion | Record scope, branch, gates, and evidence. |
| Product specs | Review | `docs/product-specs/prototype-functional-spec.md` | Existing guarded-delete module behavior is consistent; node-admin deletion is an additive governance path. |
| Architecture docs | Update | `docs/design-docs/domain-model.md`, `docs/zh-CN/design-docs/domain-model.md` | Record lifecycle/delete guard, locking, cascade, and FK race semantics. |
| API contract | Update | `docs/design-docs/api-contract.md`, `docs/zh-CN/design-docs/api-contract.md`, `docs/generated/openapi.json` | Record DELETE response and stable conflict details. |
| Quality/testing docs | Review | `docs/developer/verification-matrix.md`, `docs/developer/ui-quality-checklist.md` | Existing gates apply; no new command or exception introduced. |
| Reliability/runbooks | Review | `docs/RELIABILITY.md`, `docs/runbooks/` | No deployment or recovery procedure changes; deletion is an application transaction. |
| Security/governance docs | Review | `docs/SECURITY.md`, `docs/security/` | Existing admin authorization/audit rules apply; audit metadata is deliberately redacted. |
| Frontend/design docs | Review | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md`, `docs/design-docs/ui-design-system.md` | Existing table/modal primitives are reused. |
| Generated artifacts | Update | `docs/generated/openapi.json` | Regenerated from the route/schema registry. |
| References | No change | `docs/references/` | No external reference contract is required. |
| Browser acceptance | Update | `e2e/acceptance/debugging-admin.acceptance.spec.ts`, `docs/developer/browser-acceptance-coverage-map.md`, `docs/developer/user-operation-coverage-matrix.md`, `scripts/check-acceptance-operation-matrix.ts` | Extend DEBUG-ADMIN-001 with guarded deletion and operation evidence; render the operation action in the generated English matrix. |

## Documentation Update Gate

- [x] English and Chinese API/domain documentation describe permanent deletion, binding cascade, history protection, and stable errors.
- [x] Acceptance and operation coverage identify `DEBUG-ADMIN-001`; the acceptance spec records `204` success and `409` history protection.
- [x] OpenAPI/contract artifacts are regenerated and checked.
- [x] `npm run docs:check` passes with the repository-documented local pgvector verification skip.
- [x] Final review and verification evidence are recorded above; both language copies are moved to `completed/` after the final checks.
