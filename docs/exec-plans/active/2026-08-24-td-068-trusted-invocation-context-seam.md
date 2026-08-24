# TD-068 trusted invocation context seam (#610)

> Chinese: [中文](../../zh-CN/exec-plans/active/2026-08-24-td-068-trusted-invocation-context-seam.md)

Status: active prefactor on `codex/td-068-trusted-invocation-context`. This slice establishes the server-internal context and its policy/audit seams; TD-068 remains open until the DTS reload and parameter-sensitive migrations land.

## Goal

Provide one branded, server-owned `user` / `agent` / `system` trusted invocation context without changing legacy call sites or public request contracts.

## Scope and implementation

- `server/modules/auth/trustedInvocation.ts`: discriminated context, immutable authenticated-principal snapshots, strict constructors, runtime brand validation, and Agent approval correlation.
- `server/modules/auth/trustedInvocationPolicy.ts`: required-context human-required policy seam with stable `403` refusal details.
- `server/modules/audit/trustedAudit.ts` and `server/modules/audit/auditedWrite.ts`: actor/audit projection plus transaction and pool refusal writers that preserve system null-user semantics.
- Focused tests cover constructor invariants, policy outcomes, actor/audit projection, platform-scoped system audit, and malformed-context failure before a query.
- Existing optional `actorType` callers remain unchanged for later migration tickets. No request DTO, header, body, `/me`, or OpenAPI contract is changed.

## Verification

- Focused trusted-context tests.
- `npm run test:server`.
- `npm run test:scripts`.
- `npm run bridge:test`.
- `npm run build`.
- `npm run contract:check`.
- `npm run docs:check`.
- `git diff --check`.
- The repository frontend suite was attempted; four unrelated existing UI tests timed out, so that failure is recorded rather than called green.

## Follow-up boundary

The next tickets construct context at HTTP/Xiaoze/system entry points and migrate the five DTS reload mutations and parameter-sensitive production writes. This plan does not close TD-068, refactor unrelated audits, or claim target/device readiness.

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
- [x] Verification commands and the full-test frontend timeout boundary are recorded above.
- [ ] Move this plan to `completed/` only after the complete TD-068 migration and closure evidence land.

## Git & PR Workflow

This implementation is committed on `codex/td-068-trusted-invocation-context`, with inherited user documentation changes kept unstaged and untouched. The parent/session owner retains responsibility for any PR, CI exception, merge, and main synchronization.
