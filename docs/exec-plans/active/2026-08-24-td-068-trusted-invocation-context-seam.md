# TD-068 trusted invocation context seam (#610)

> Chinese: [中文](../../zh-CN/exec-plans/active/2026-08-24-td-068-trusted-invocation-context-seam.md)

Status: #610 implementation complete on `codex/td-068-trusted-invocation-context`, but merge-blocked by the required local acceptance-quality gate described below; retained active as the shared migration record. This slice establishes the server-internal context and its policy/audit seams; TD-068 remains open until #611–#615 land.

## Goal

Provide one branded, server-owned `user` / `agent` / `system` trusted invocation context without changing legacy call sites or public request contracts.

## Scope and implementation

- `server/modules/auth/trustedInvocation.ts`: discriminated context, immutable authenticated-principal snapshots, strict constructors, runtime brand validation, and Agent approval correlation.
- `server/modules/auth/trustedInvocationPolicy.ts`: required-context human-required policy seam with stable `403` refusal details.
- `server/modules/audit/trustedAudit.ts` and `server/modules/audit/auditedWrite.ts`: actor/audit projection plus transaction and pool refusal writers that preserve system null-user semantics.
- Focused tests cover constructor invariants, policy outcomes, actor/audit projection, platform-scoped system audit, and malformed-context failure before a query.
- Existing optional `actorType` callers remain unchanged for later migration tickets. No request DTO, header, body, `/me`, or OpenAPI contract is changed.

## Verification

- Focused trusted-context tests: 3 files, 15 tests passed.
- Complete final-tree matrix passed without skipped suites: frontend 407 files / 3019 tests (`npm test -- --maxWorkers=4`, retaining the original per-test timeout); scripts 69 files / 811 passed / 5 skipped; bridge 21 files / 138 passed; server 354 files / 2735 passed / 8 skipped (plus 2 skipped files).
- Earlier default-parallel runs were not called green: one reached the server suite and hit an unrelated randomized assertion when a generated session UUID contained `9999`; another stopped in the frontend suite on three unrelated five-second UI timeouts. The affected files passed targeted reruns, and limiting frontend workers removed resource contention without skipping tests or extending timeouts.
- `npm run build`, `npm run contract:check`, `npm run docs:check`, and `npm run acceptance:ci` passed. The database-schema documentation subcheck reported its existing local pgvector-extension skip; this change has no schema impact.
- `npm run lint` completed with 0 errors and the 299-warning frontend baseline. `git diff --check origin/main...HEAD` passed.
- `npm run ui:check` passed with every ratchet equal to its baseline. `npm run logs:eval` passed 16/16 scenarios and 4/4 meta checks; its generated timestamps were not committed. `npm run acceptance:quality` passed, and `npm run acceptance:smoke` passed 4/4 in a clean detached worktree against an isolated pgvector database seeded with the CI production-HMAC profile.
- `npm run acceptance:quality-run` is **not green** and still blocks the owner-approved full-local-CI exception. A clean MCR Playwright Linux run passed 94/97 tests; the aggregate interaction a11y timeout passed on targeted rerun, but the project-configuration-workbench and Xiaoze-popup Linux screenshots remained different by about 3% and 4%. The same two diffs reproduced on untouched `origin/main` with identical arm64 pixel counts, and the feature branch reproduced them under amd64 too. No snapshot was updated because the repository makes the GitHub runner artifact the adoption authority. Do not push or merge #610 until this required gate is repaired or the owner explicitly documents a narrower exception.

## Follow-up boundary

Tickets #611–#615 construct context at HTTP/Xiaoze/system entry points and migrate the five DTS reload mutations and parameter-sensitive production writes. This plan does not close TD-068, refactor unrelated audits, or claim target/device readiness.

## Documentation Impact Matrix

| Area | Status | Evidence |
| --- | --- | --- |
| Repository maps and agent guidance | Review | `AGENTS.md`; it already routes security/auth/audit work to the relevant docs. |
| Planning and technical-debt tracking | Review | `docs/PLANS.md`, `docs/exec-plans/tech-debt-tracker.md`; both retain TD-068 Open and its migration boundary. |
| Product and API contracts | No change | `docs/design-docs/api-contract.md`, `server/modules/contracts/`; no route, request DTO, `/me`, header, body, or OpenAPI surface changed. |
| Architecture and domain model | Review | `docs/adr/0038-trusted-invocation-provenance-separates-principal-and-initiator.md`, `docs/design-docs/full-stack-architecture.md`, `docs/design-docs/domain-model.md`. |
| Security and audit guidance | Review | `docs/SECURITY.md`, `server/modules/audit/auditedWrite.ts`; trusted-context and no-default-user rules remain a partial migration. |
| Quality and verification docs | No change | `docs/QUALITY_SCORE.md`, `docs/developer/verification-matrix.md`; existing server, contract, docs, build, and diff gates apply. |
| Chinese developer docs | Review | `docs/zh-CN/SECURITY.md`, `docs/zh-CN/design-docs/full-stack-architecture.md`, `docs/zh-CN/design-docs/domain-model.md`, `docs/zh-CN/PLANS.md`. |
| Generated artifacts, runbooks, frontend/design, references | No change | `docs/generated/`, `docs/runbooks/`, `src/`, `docs/references/`; no generated schema, operation, runtime, UI, or operator-procedure change. |

## Documentation Update Gate

- [x] ADR-0038 and the bilingual security/architecture/domain/API planning references were reviewed against the implemented seam.
- [x] No public contract or frontend documentation became stale.
- [x] The failed first full run and the successful exact-tree full rerun are recorded without calling the failed run green.
- [ ] Resolve the two inherited acceptance-quality visual failures, rerun the complete required local CI on the final tree, and obtain a zero-finding Standards re-review before merge.
- [ ] Move this plan to `completed/` only after the complete TD-068 migration and closure evidence land.

## Git & PR Workflow

Implementation and review fixes are committed separately from this documentation record on `codex/td-068-trusted-invocation-context`. The parent/session owner retains responsibility for the PR, the owner-approved full-local-CI exception, merge, and main synchronization.
