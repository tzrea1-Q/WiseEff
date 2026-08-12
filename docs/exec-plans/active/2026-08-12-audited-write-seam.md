# Audited write seam — audit events commit with their domain write

Architecture-review candidate C2 (2026-08-12 backend review); design settled through a
six-decision grilling session; recorded as ADR-0027.

## Goal

Make "the audit event commits in the same transaction as the domain write" an interface
guarantee instead of call-site discipline. Measured baseline on 2026-08-12 main: 33 of 41
`createAuditEvent` call sites wrote audit evidence outside the write's transaction;
project creation wrote no audit at all; project update/delete committed first and audited
after; structured-edit submission audited before a submit that could fail; bulk conflict
arbitration ran N transactions with no compensation.

## Design (settled decisions)

1. **Seam + narrow brand.** `withAuditedWrite(db, auth, context, fn)` runs write + audit in
   one transaction (nested service transactions become savepoints via the #317 seam).
   `writeAuditEventInTx` accepts only the branded `AuditTx`; the brand's only sources are
   `withAuditedWrite` and the explicit `asAuditTx` escape hatch. `Database.transaction`
   keeps its ordinary type, so test fakes are untouched.
2. **Audit evidence is a return value.** `fn` returns `{ result, audit }` so evidence can
   reference created ids; `audit: null` states nothing auditable happened. Actor and
   organization fields derive from `auth`; `traceId` derives from a **mandatory**
   `context.requestId` (no `randomUUID()` fallback at the seam).
3. **Deprecated path retires by ratchet.** `createAuditEvent` stays compiling with a
   `@deprecated` pointer; `auditRatchet.test.ts` pins per-file direct-call counts so they
   can only decrease. When the allowlist reaches zero, delete `createAuditEvent` and the
   ratchet. (This realizes "compile-error for out-of-transaction audit" incrementally —
   the review's Q1(c) — without breaking the build mid-migration.)
4. **Bulk conflict arbitration is atomic** (one human decision): the eligible batch
   resolves in one transaction; mid-batch failure rolls everything back (api-contract.md
   updated, en + zh).
5. Correctness-gap fixes shipped with the seam (PR1): project create (audit added, in-tx),
   project update/delete (write + audit share the transaction), structured-edit submission
   (drafts + submit + audit in one transaction — a failed submit no longer leaves committed
   drafts or a misleading audit event), bulk conflict arbitration (atomic batch).

## PR1 (branch `refactor/audited-write-seam`) — landed in this change

- `server/modules/audit/auditedWrite.ts` (+ tests): seam, brand, escape hatch.
- `server/modules/audit/auditRatchet.test.ts`: migration ratchet.
- `server/modules/parameters/projectService.ts`: create/update/delete through the seam;
  `ProjectServiceContext` now requires `requestId`.
- `server/modules/parameters/service.ts`: `submitStructuredEdits` through the seam.
- `server/modules/parameter-files/conflictService.ts`: atomic bulk resolve.
- ADR-0027, CONTEXT.md glossary ("Audited write"), api-contract.md (en+zh).

Notes: `createParameterReviewAudit` call sites were re-verified as already in-transaction
(helper parameter is merely named `db`) — not gaps. `submitStructuredEdits` has no
queue-style unit test by design (that fake pattern is the C10 review finding); it is
covered by the seam's own transaction-order tests, type-level changes, and the
`dts-structured` acceptance spec.

## PR2+ migration inventory (ratchet allowlist, 41 direct calls in 27 files)

Migrate per module; each batch moves call sites to `withAuditedWrite`/`writeAuditEventInTx`
and lowers the ratchet. Suspected genuine gaps first:

1. `parameters/service.ts` (5: module-CRUD helper ×1 shared by 5 call sites, import
   preview, review helpers already in-tx via `tx` argument — verify each), 
   `parameters/initializationService.ts` (3), `parameters/sensitiveNode.ts` (1).
2. `parameter-files/*` (10 across 8 files — baselineService 3, candidate/configSet/
   conflict/export/service/validationGate/writeback 1 each).
3. `dts-reload/*` (4), `parameter-modules/service.ts` (2), `parameter-specs/
   driverSchemaOverlayService.ts` (1), `parameter-topology/governanceAudit.ts` (1).
4. `agent/*` (4), `users/service.ts` (2), `auth/*` (2), `logs/service.ts` (1), `knowledge/service.ts` (1),
   `product-feedback/service.ts` (1), `audit/routes.ts` (1).

Completion gate: ratchet allowlist empty → delete `createAuditEvent` + ratchet test →
move this plan to `completed/`.

## Verification

- `npx vitest run --config vitest.server.config.ts server/modules/audit
  server/modules/parameters/projectService.test.ts
  server/modules/parameters/projectAdminMutations.test.ts
  server/modules/parameter-files/conflictService.test.ts` — 35 passed.
- `npm run build`, `npm run docs:check` — must pass.
- Shared-dev-DB integration tests remain environmentally broken (schema drift, see #323
  notes); seam transaction semantics are pinned via `createDatabase`-backed order tests.

## Git & PR Workflow

- PR1: `refactor/audited-write-seam` from `origin/main`; parent agent reviews/merges.
- PR2+: one branch per migration batch (`refactor/audited-write-migrate-<module>`), each
  lowering the ratchet; no batch may raise it.

## Documentation Impact Matrix

| Area | File | Action | Note |
| --- | --- | --- | --- |
| Repository maps | `AGENTS.md`, `ARCHITECTURE.md` | No change | Write-path pattern text already mandates audit; seam is the enforcement |
| Planning | `docs/PLANS.md` | Update | Plan registered (done) |
| Domain glossary | `CONTEXT.md` | Update | "Audited write" row + ADR-0027 index (done) |
| ADR | `docs/adr/0025-…` | Update | New (done) |
| API contract | `docs/design-docs/api-contract.md` (+ zh) | Update | bulk-resolve atomicity (done) |
| Security | `docs/SECURITY.md`, `docs/security/*` | Review (PR2) | Audit-integrity section may cite ADR-0027 once migration completes |
| Product specs / frontend / quality / reliability / generated / references | — | No change | No product-visible behavior change beyond bulk atomicity documented above |

## Documentation Update Gate

PR1 rows are done as noted. Before this plan moves to `completed/`: resolve the
`Review (PR2)` security row and re-run `npm run docs:check`.

## UI Interaction Automation Review

No UI change. Bulk-resolve keeps its request/response shape; the only behavioral change
(mid-batch failure → whole batch 4xx/5xx instead of partial success) is server-side error
semantics on an existing error path already exercised by
`e2e/acceptance/dts-structured.acceptance.spec.ts` and the conflicts workbench specs; no
requirement/operation ID changes.
