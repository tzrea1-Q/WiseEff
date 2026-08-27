# Debug Node Cascade Delete and Module Consistency

> Chinese: [Chinese](../../zh-CN/exec-plans/completed/2026-08-27-debug-node-cascade-delete-module-consistency.md)

## Goal

Change permanent debug-node deletion so an Admin explicitly deletes the node, its protocol bindings, and all `node_operations` rows that reference it in one transaction. Prevent debug-module deletion when legacy nodes still reference the module by name, and keep API-mode module filters sourced from the API registry even when that registry is empty.

## Branch and Boundaries

- Branch: `codex/frontend-ui-optimization-20260827` in `/Users/tzrea1/Develop/WiseEff-worktrees/frontend-ui-optimization-20260827`.
- Preserve the dirty primary worktree and existing services.
- Keep `debugging:admin`, organization scoping, explicit destructive confirmation, and redacted request-correlated audit.
- Delete node operations only for the locked target node. Keep shared debugging sessions and unrelated nodes/operations.
- Module deletion remains empty-leaf-only. A legacy name-only node reference counts as a reference; the module is not cascade-deleted with nodes.
- Do not open or merge a PR in this implementation session.

## Acceptance and Feedback Loops

- `npm run test:server -- server/modules/debugging/catalogSplitRepository.test.ts --run`: a node with one binding and one operation must delete all three rows.
- `npm test -- src/DebuggingAdminPage.test.tsx --run`: a legacy name-only node must not allow its real API module to be deleted and later reappear in the tree filter.
- Update `DEBUG-ADMIN-001` in `e2e/acceptance/debugging-admin.acceptance.spec.ts`, `docs/developer/browser-acceptance-coverage-map.md`, and `docs/developer/user-operation-coverage-matrix.md` from guarded deletion to audited cascade deletion.
- Validate `/debugging-admin/nodes` at `1440x900`, `768x1024`, and `390x844`, including filter and delete-dialog interactions, screenshots, snapshots, console errors, and relevant network responses.

## Implementation Tasks

- [x] Reproduce both reported behaviors with deterministic failing tests.
- [x] Confirm the history guard/FK contract and the module ID-versus-legacy-name mismatch.
- [x] Add repository/service/UI regression coverage before implementation.
- [x] Delete operation history and the node atomically; record operation and binding counts in the delete audit.
- [x] Count legacy name-only module references in backend and frontend delete guards.
- [x] Remove API-mode empty-registry fallback to mock parameter modules.
- [x] Update user-facing confirmation, API/domain documentation, OpenAPI, and acceptance metadata.
- [x] Run focused tests, build, documentation/contract gates, and real-browser verification.

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation agent | Edit, test, and commit the bounded change on `codex/frontend-ui-optimization-20260827`; do not push, open a PR, merge, or modify `main`. |
| Parent agent | Review and decide later PR/merge delivery. |

## Documentation Impact Matrix

| Area | Status | Files | Decision |
| --- | --- | --- | --- |
| Repository maps | Review | `AGENTS.md`, `ARCHITECTURE.md` | Unchanged: repository routing and component boundaries remain correct. |
| Planning docs | Update | this plan, Chinese companion, `docs/PLANS.md`, `docs/zh-CN/PLANS.md` | Track the superseding data semantics and evidence. |
| Product specs | Review | `docs/product-specs/prototype-functional-spec.md` | Unchanged: no separate guarded-delete product promise was found. |
| Architecture/domain | Update | `docs/design-docs/domain-model.md`, Chinese companion | Replace history protection with transactional operation cascade and clarify module reference integrity. |
| API contract | Update | `docs/design-docs/api-contract.md`, Chinese companion, `docs/generated/openapi.json` | Remove history-protection `409`; retain `204`, authz, not-found, and module conflict behavior. |
| Quality/testing | Update | `e2e/acceptance/debugging-admin.acceptance.spec.ts`, acceptance coverage/operation matrices | Preserve `DEBUG-ADMIN-001` with DB and audit evidence for cascade deletion. |
| Reliability/runbooks | Review | `docs/RELIABILITY.md`, `docs/runbooks/` | Unchanged: this is bounded transactional application behavior, with no operator procedure change. |
| Security/governance | Review | `docs/SECURITY.md`, `docs/security/` | Unchanged: existing Admin authorization and High-severity redacted audit remain sufficient. |
| Frontend/design | Review | `docs/FRONTEND.md`, `docs/developer/ui-quality-checklist.md` | Unchanged: existing module-delete guard and responsive visual gates apply; no design-system change. |
| Generated artifacts | Update | `docs/generated/openapi.json` | Regenerate or patch through the repository contract source. |
| References | Review | `docs/references/` | Unchanged: no stale guarded-delete contract was found. |

## Documentation Update Gate

This plan cannot move to `completed/` until every Update row is updated, every Review row has an explicit unchanged finding, bilingual pairs pass `npm run docs:check`, contract artifacts pass `npm run contract:check`, and `DEBUG-ADMIN-001` still has automated UI/API/DB/audit evidence. Any unresolvable legacy orphan data remediation must be recorded as technical debt rather than hidden by the filter.

Gate satisfied on 2026-08-27. No orphan-data remediation debt remains: unique legacy name references resolve to the registry module, ambiguous same-name references conservatively protect every matching registry module from deletion, and unmatched names remain legacy-only entries.

## Verification Evidence

- Focused frontend: 35/35 tests passed across module helpers, admin page, and node table.
- Focused server/contracts: 143/143 tests passed; the PostgreSQL deletion regression additionally proves operation, snapshot, event, binding, and node cleanup with one retained delete audit.
- Full server: 361 files passed, 1 skipped; 2777 tests passed, 4 skipped.
- `npm run build`, `npm run contract:check`, `npm run docs:check`, `npm run acceptance:coverage`, `npm run acceptance:operations`, `npm run acceptance:models`, and `npm run ui:check` passed. The DB-schema documentation subcheck reported its defined local skip because pgvector is unavailable; CI retains the canonical pgvector check.
- `npm run lint` completed with 0 errors and 300 pre-existing warnings; focused changed frontend files completed with 0 errors and 6 pre-existing React Compiler warnings.
- API-mode `/debugging-admin/nodes` was verified against the isolated frontend/API pair `5192`/`8792` with Playwright at `1440x900`, `768x1024`, and `390x844`. Delete confirmation, module tree filter, and referenced-module delete guard were exercised; console errors were 0 and relevant admin requests returned 200.
