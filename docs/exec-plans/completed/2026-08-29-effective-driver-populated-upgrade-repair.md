# Effective driver populated-upgrade repair

> Chinese: [Chinese](../../zh-CN/exec-plans/completed/2026-08-29-effective-driver-populated-upgrade-repair.md)

## Goal

Repair the Issue #649 populated-database upgrade path so API-mode parameter
administration exposes one active, placed definition per canonical driver property.
Preserve unresolved legacy rows as governance history instead of treating a shared
property key as driver identity.

Target evidence from the 2026-08-29 self-hosted database is: 23 active driver
properties across four canonical registrations, 59 subjectless active DTS surface
rows, 19 subjectless driver-schema roots, and no driver-group placement for the 12
organization/registration pairs. Migrations `0118` through `0126` are immutable.

## Architecture and boundaries

- Add append-only migration `0127`. It may repair canonical root identity, retire
  unresolved active staging surfaces to governance-only draft state, and materialize
  deterministic top-level driver-group modules/placements. It must not delete history,
  guess a business category, or match a driver by property key alone.
- Keep node-type taxonomy separate from the effective driver catalog. Existing
  node-type modules remain authoritative; missing node-type placement remains taxonomy
  governance and never masquerades as a driver definition.
- Make the ordinary parameter library use the effective projection. Governance/raw
  history remains available only through an explicit governance request.
- Make the supported self-hosted upgrade fail closed when the populated catalog is not
  ready after migration; liveness/readiness alone is insufficient.

## Confirmed public test seams

The operator confirmed these TDD seams before implementation:

1. A real PostgreSQL database populated in the pre-`0127` server shape and upgraded
   through the public migration runner.
2. The reconciliation/verification CLI result after upgrade.
3. Effective-by-default and explicit-governance parameter library API/UI behavior.
4. The self-hosted upgrade command's catalog-readiness gate.

## Work breakdown

1. Add the populated PostgreSQL red fixture and prove the current migration leaves the
   effective catalog empty/blocked.
2. Add `0127` with deterministic, idempotent, owner-safe repair and rerun the fixture.
   Preserve the invariant for later organization creation and lazy platform catalog
   materialization in the same transaction.
3. Add API/application red coverage for effective default projection and retain an
   explicit governance path.
4. Add upgrade-script red coverage for catalog verification failure and success.
5. Run focused PostgreSQL, frontend/application, script, migration-invariant, docs,
   schema-doc, build, and browser gates. Target-server re-application remains pending
   until the merged upgrade is rerun against its snapshot.

## Expected outcomes

- The populated fixture has zero active subjectless DTS surface definitions and zero
  driver-schema root owner mismatches after migration.
- Each organization/canonical-registration pair has exactly one top-level driver-group
  module and placement; business category remains null without authoritative evidence.
- Effective output contains only active, versioned, uniquely placed canonical driver
  properties. Governance output retains legacy draft evidence.
- A self-hosted upgrade cannot report completed while the independent parameter
  definition gate is blocked.

## Outcome and evidence

- `0127` repairs the populated server shape without deleting rows, and installs
  deterministic maintenance triggers for later organizations/platform properties.
- Real PostgreSQL: `effectiveDefinition.integration.test.ts` plus
  `populatedUpgrade.integration.test.ts` passed 18/18, including pre-`0127` blocked
  evidence, post-upgrade ready evidence, idempotent replay, binding rehome, and both
  future insertion orders. A fresh migrate-through-`0127` then M0/M1 seed rehearsal
  reached `--catalog-only` ready with all seven checks at zero, without replaying the
  migration. Migration/invariant suites passed 77/77.
- Frontend projection tests passed 45/45; self-hosted upgrade tests passed 183/183.
  Documentation/schema, acceptance coverage/operations, OpenAPI contract, self-hosted
  configuration, UI standards, and production build all passed.
- Browser acceptance at `/parameter-admin/specs` covered `1440x900`, `768x1024`, and
  `390x844`: the default effective view returned 53 active placed rows; explicit
  `?catalogView=governance` returned 114 history rows and used the same projection for
  detail/edit. Relevant network requests were 200 and console errors were zero.
  Screenshots are under `work/ui-checks/issue-649-populated-upgrade/`.
- The original self-hosted server has not yet received this follow-up migration. Its
  successful `upgrade.sh` rerun and target `--catalog-only` output remain external
  acceptance evidence, not a local pass.

## Git & PR Workflow

Feature branch: `codex/issue-649-populated-upgrade-fix`, created from the latest
`origin/main`. Implementation and commits stay on this branch. PR creation, merge,
and local-main synchronization remain parent-agent responsibilities.

## Documentation Impact Matrix

| Surface | Status | Exact path / rationale |
| --- | --- | --- |
| Repository map / onboarding | No change | `ARCHITECTURE.md` and `CONTEXT.md` remain accurate; no module-map change. |
| Planning / tracker | Updated | this plan and Chinese companion; the original completed plan remains historical evidence. |
| Product specs | No change | existing effective-catalog promise already states the user-visible result. |
| Architecture / domain / ADR | Updated | ADR-0039 and Chinese companion record populated repair and steady-state placement invariant; domain entities did not change. |
| Quality / testing | Updated | testing strategy, verification matrix, and Chinese companions cover populated upgrade. |
| Reliability / runbooks | Updated | parameter reconciliation and self-hosted upgrade runbooks plus Chinese companions. |
| Security / governance | No change | no auth surface changed; the existing no-guessed-ownership invariant is preserved. |
| Frontend / design | Updated | `docs/FRONTEND.md`, API contract, acceptance and operation coverage. |
| Generated artifacts | Updated | `docs/generated/db-schema.md` regenerated from all 125 migrations through `0127`. |
| References / bilingual docs | Updated | every changed developer document with a companion was updated in both languages. |

## Documentation Update Gate

Before completion, resolve every `Update`/`Review` row with an edit or explicit
evidence-backed no-change decision, run `npm run docs:check` and
`npm run db:schema-doc:check`, move both plan files to `completed/`, and record target
server proof as an external acceptance boundary rather than a local pass.
