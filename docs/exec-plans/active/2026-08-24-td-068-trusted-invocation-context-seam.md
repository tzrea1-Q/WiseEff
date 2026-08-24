# TD-068 trusted invocation context seam (#610)

> Chinese: [中文](../../zh-CN/exec-plans/active/2026-08-24-td-068-trusted-invocation-context-seam.md)

Status: #610 implementation and final-tree local CI are complete on `codex/td-068-trusted-invocation-context`; merge-ready under the owner's documented full-local-CI exception while the monthly GitHub Actions quota is exhausted. This plan remains active as the shared migration record: the slice establishes the server-internal context and policy/audit seams, while TD-068 stays Open until #611–#615 land.

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
- After rebasing onto repaired main `a57a88806`, the complete final-tree matrix passed: frontend 408 files / 3022 tests; scripts 69 files / 830 passed / 5 skipped; bridge 21 files / 138 tests; server 355 files passed / 1 skipped and 2739 tests passed / 4 skipped.
- `npm run build`, `npm run contract:check`, `npm run docs:check`, `npm run acceptance:ci`, the required DTS toolchain check (dtc/fdtoverlay 1.8.1 and dtschema 2026.6), and the three-project DTS seed compile passed against an isolated pgvector database.
- `npm run lint` completed with 0 errors and the 299-warning frontend baseline. `git diff --check origin/main...HEAD` passed.
- `npm run ui:check` passed with every ratchet at baseline. `npm run logs:eval` passed 16/16 scenarios and 4/4 meta checks; generated timestamps were restored and not committed.
- The inherited main-red visual failures were repaired independently by #617 / PR #619 without changing any committed PNG. On this final #610 tree, workflow-equivalent MCR Playwright from an empty pgvector database and isolated object root passed `acceptance:quality` and all 97/97 quality tests. A separate empty database and object root passed `acceptance:smoke` 4/4 under the CI production-HMAC profile.
- Final Standards and Spec reviews were run separately against `origin/main...HEAD`; each reported zero findings. GitHub checks that cannot run because of the exhausted quota are not described as green; the owner explicitly approved the complete final-tree local matrix as merge authority.

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
- [x] Resolved the inherited acceptance-quality failures through #617 / PR #619 and reran the complete required local CI on the rebased final tree.
- [x] Obtained zero-finding final Standards and Spec reviews before merge.
- [ ] Move this plan to `completed/` only after the complete TD-068 migration and closure evidence land.

## Git & PR Workflow

Implementation and review fixes are committed separately from this documentation record on `codex/td-068-trusted-invocation-context`. The parent/session owner retains responsibility for the PR, the owner-approved full-local-CI exception, merge, and main synchronization.
