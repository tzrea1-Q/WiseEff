# Effective driver parameter definitions and twin-spec reconciliation

## Goal

Make API-mode parameter catalog output and all DTS/schema write paths converge on one
effective active definition per `(Organization, canonical DriverRegistration, property_key)`.
Every effective definition must retain a canonical driver subject and exactly one
organization driver-group placement. Unknown and ambiguous evidence remains explicit
governance work and must not create a recognized binding. Existing organization draft /
platform-active twins are repaired by an audited, dry-run-capable, idempotent migration
that preserves history and binding revision meaning.

## Architecture and bounded scope

- Add a driver-parameter-definition coordination seam used by ingest, schema catalog sync,
  review resolution, effective listing, and reconciliation.
- Preserve owner-scoped platform rows and intentional organization overrides as storage/history;
  effective selection is lifecycle-aware (`organization active > platform active > none`).
- Link persisted driver schema versions to canonical attribution subjects and specialize common
  properties only after a concrete driver is resolved.
- Add organization-scoped driver placement with one driver-group and organization default category;
  retain compatibility with existing placement callers during expand/reconcile/contract.
- Add persisted audited reconciliation runs with per-organization bounded transactions, blockers,
  dry-run/apply, and idempotent reruns.
- Keep unresolved evidence and existing review-task semantics; no key-only dedupe or history deletion.

## Work breakdown

1. **Red contract tests** at the coordination seam against real PostgreSQL: clean seed, dirty twin,
   lifecycle precedence, missing/ambiguous evidence, common-property specialization, placement
   ownership, effective/governance projections, migration dry-run/apply/idempotence/rollback,
   release blocking, and tenant isolation.
2. **Expand schema and domain types**: driver-schema subject linkage, organization placement,
   effective-definition projection metadata, reconciliation run/item tables, and write-boundary
   guards; update generated schema documentation.
3. **Implement coordination and catalog graph synchronization**: resolve driver first, retain
   driver/property context, attach subjects, create active vendor properties only when complete,
   and remove provisional unmatched binding/spec creation from production ingest.
4. **Unify effective selection and APIs**: server-owned precedence, declared placement versus
   observed modules, effective default listing plus explicit governance/raw listing, and client/UI
   fields for driver identity, placement, and observation state. Platform overlay promotion
   materializes subject-scoped platform copies instead of changing contributor ownership in place.
5. **Implement reconciliation command/service**: preflight classification, audited dry-run/apply,
   canonical subject correction, staged successor-version cutover for uniquely matched provisional
   drafts, blockers for conflicts/incompatible values, bounded rollback, and idempotence.
6. **Contract rollout and documentation**: enable constraints only after verification, retire legacy
   writers/defaults, update ADR/domain/API and bilingual developer docs, run docs gate, commit on
   this feature branch without opening or merging a PR.

## Verification commands and expected outcomes

- Focused pure matcher/precedence tests: all pass.
- Focused real PostgreSQL coordination, ingest, API, and reconciliation tests: all pass.
- `npm run test:server`: pass with no unexpected skips; report environment skips separately.
- `npm test`, `npm run test:scripts`, `npm run bridge:test`, and `npm run build`: pass.
- `npm run docs:check`, `npm run db:schema-doc:check`, and relevant API-mode smoke/browser checks:
  pass with route, viewport, console, network, and screenshot evidence when UI/API projections change.
- Verification SQL reports zero effective active subjectless property definitions, recognized draft
  tips, recognized vendor unreviewed tips, duplicate effective keys, missing/multiple placements,
  and subject mismatches.

## Documentation Impact Matrix

| Surface | Status | Exact path / rationale |
| --- | --- | --- |
| Repository map / onboarding | Reviewed; no change | `ARCHITECTURE.md`, `CONTEXT.md`, `docs/README.md` — the existing parameter-spec/driver graph map remains accurate; durable vocabulary is linked from the updated domain/API/ADR docs. |
| Planning / tracker | Update | this plan; move to `docs/exec-plans/completed/` only after the update gate. |
| Product specs | Reviewed; no change | `docs/product-specs/product-spec.md` — this repair tightens the existing parameter-governance contract and adds no new product workflow or scope. |
| Architecture / domain / ADR | Update | `docs/design-docs/domain-model.md`, `docs/design-docs/api-contract.md`, new or amended `docs/adr/` decision. |
| Quality / testing | Updated | `docs/design-docs/testing-strategy.md`; focused PostgreSQL seams and CLI gates are recorded below. `docs/developer/verification-matrix.md` receives the new commands. |
| Reliability / runbooks | Updated | `docs/RELIABILITY.md` and bilingual `docs/runbooks/effective-driver-parameter-catalog-reconciliation.md` document the unchanged 0117 base migration, Issue #649 migrations 0118→0125, checksum-audited legacy aliases, snapshot, transaction, stop, and restore boundaries. |
| Security / governance | Updated | `docs/SECURITY.md` and Chinese companion document server-owned identity, trusted system audit, and fail-closed release checks; no separate `docs/security/` page needed. |
| Frontend / design | Updated | `docs/FRONTEND.md` documents effective/governance API projection and server-owned DTO fields. No route, layout, styling, or interaction contract changed; browser requirement is recorded as data-projection coverage in the map. |
| Generated artifacts | Updated | `docs/generated/db-schema.md` is regenerated from the migration set and checked with `npm run db:schema-doc:check`. |
| References / bilingual docs | Updated | ADR, domain, API, testing, reliability, security, frontend, runbook, and plan updates have paired English/Chinese developer-facing pages. |

## Documentation Update Gate

Before moving this plan to `completed/`, inspect every matrix row, update or record an
evidence-backed no-change decision in this plan, run `npm run docs:check`, and ensure no
deferred documentation work remains untracked. Browser-interaction coverage must name the
affected acceptance requirement and operation IDs, or add them before completion.

### Documentation update evidence

- `PARAM-SPEC-GOVERN-001` remains the affected governance operation; its existing browser
  route and server acceptance cover the same `/parameter-admin/specs` surface. This change
  alters only the API projection selected by the two admin panels (`view=governance`), with
  no new route, control, layout, or responsive interaction. The effective projection and
  governance/raw distinction are documented in `docs/FRONTEND.md` and the API contract.
- Verification commands added to the matrix are `npm run parameter-definitions:reconcile`
  (dry-run/apply) and `npm run parameter-definitions:check`; the reconciliation runbook is
  the operator evidence/rollback source of truth.

### Final verification evidence

- A fresh PostgreSQL/pgvector schema rehearsal applied all 124 migrations through
  `0126_guard_binding_spec_version_owner.sql`; rerunning
  `npm run db:migrate` on that rehearsal returned `Applied 0 migration(s): none`, confirming
  the recorded checksums are stable. `npm run db:schema-doc:check` reports the generated schema
  artifact current.
- On isolated PostgreSQL rehearsal databases, the reconciliation dry-run/apply integration
  exercised the draft/platform twin and returned an audited, idempotent correction; the
  verification gate returned `status: ready` with all checks at zero after the correction.
  A fresh empty rehearsal also returned zero pending migrations and a clean verification gate.
  These databases are local test data, not a production cutover; the target database still
  requires the runbook's snapshot, dry-run review, per-organization apply, and post-migration gate.
- `TEST_DATABASE_URL=... VITEST_SERVER_MAX_WORKERS=1 npm run test:server -- --run --maxWorkers=1`:
  365 files passed and 2,843 tests passed; 1 file/4 tests were skipped by the existing
  environment gates (pgvector and the optional Xiaoze checkpoint proof). `npm test
  -- --maxWorkers=1`: 421 files and 3,164 tests passed. `npm run test:scripts -- --maxWorkers=1`:
  69 files, 948 passed, 5 environment skips. `npm run bridge:test`: 21 files, 138 passed.
  `npm run build` and `git diff --check` passed (build emitted only existing chunk-size and
  browser-externalization warnings).
- API-mode browser smoke reached `http://127.0.0.1:5173/parameter-admin/specs` and showed the
  login gate. No credentials were available, so authenticated interactions, all three required
  viewports, screenshots, console/network assertions, and operation evidence remain target-
  environment work; this is explicitly not reported as a browser pass.
- No production database or object store was touched. The operator must follow the runbook's
  snapshot, write-freeze, dry-run approval, per-organization apply, verification, and restore
  procedure during the actual maintenance window.

## Git & PR Workflow

Feature branch: `codex/issue-649-effective-driver-definitions`, checked out from the latest
`origin/main` in `/Users/tzrea1/Develop/WiseEff-worktrees/issue-649-effective-driver-definitions`.
The implementation agent commits this branch only. It does not push `main`, open a PR, merge,
or modify the user's original dirty worktree.
