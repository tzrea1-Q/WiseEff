# Attribution subjects + versioned parameter definitions

> Status: active implementation  
> Branch: `feat/attribution-subject-versioned-specs`  
> Date: 2026-07-30  
> Supersedes merge intent of open PRs #212–#214 (reusable commits only; not merged as-is)

## Goal

Close the domain gaps found while grilling ADR-0010 / governance state machines:

1. Stable catalog identity for drivers and node types (`AttributionSubject`).
2. Explicit `driverNature` / `instanceCardinality` on driver registrations.
3. Versioned parameter definition content with soft retirement at the definition layer.
4. Mature create / migrate / identity-mapping / governance UX in later batches.

## Git & PR Workflow

Feature branch from `main`: `feat/attribution-subject-versioned-specs`.

Stacked delivery on one branch (split to GitHub PRs by the parent agent if needed):

| Batch | Commit theme | Status |
| --- | --- | --- |
| PR0 | OpenAPI `listPromotionCandidates` | done |
| PR1 | Structural cohort removal (`0081`) | done |
| PR2 | Attribution subjects (`0082`, ADR-0013) | done |
| PR3 | Versioned specs backend (`0083`, ADR-0014) | done |
| PR4 | Create entry + staged version cutover | done |
| PR5 | Identity mapping + singleton gate | done |
| PR6 | Governance UI convergence | pending |

Implementation agents commit on this branch only; parent opens/merges GitHub PRs.

## Locked decisions (grilling)

- Nesting: business → {business\|driver-group\|node-type}; driver-group → node-type; node-type → node-type.
- Spec attribution target: `DriverRegistration | NodeTypeDefinition` — never a project `logical_node_id`.
- DriverRegistration is a first-class subject; module tree only places it.
- Spec identity: owner scope + subject + property_key; content is versioned.
- Org overrides platform; platform is fallback.
- Activate v2 uses staged atomic cutover (prepare binding revisions, then switch).
- `new_identity` with multiple candidates keeps all; singleton conflicts block release.
- Overlay retirement allowed without successor after impact confirmation.
- Superseded overlays stay visible read-only on org surface.
- Success feedback: short toast, no audit banner prose.
- Structural cleanup fail-closed with typed FK report (no audit cascade delete).

## Documentation Impact Matrix

| Area | Action | Paths |
| --- | --- | --- |
| ADR | Update | `docs/adr/0003`, `0013`, `0014`, `README` |
| Domain / API | Update | `docs/design-docs/domain-model.md`, `docs/zh-CN/design-docs/domain-model.md`, api-contract EN/ZH (as endpoints land) |
| CONTEXT | Update | `CONTEXT.md` glossary terms |
| Plans | Update | this file; retire/supersede note on `2026-07-30-parameter-governance-state-machine-completion.md` when batches absorb it |
| Tech debt | Review | close structural TD items when 0081 verified |
| Product specs | Review | only if create-entry UX copy changes in PR4 |

## Documentation Update Gate

Block completion until: ADR 0013/0014 linked from README; EN+ZH domain model mention subjects; `npm run docs:check` green; deferred questions D1/D7 status updated.

## Verification

```bash
npm run test:server -- server/modules/contracts/openapi.test.ts
npm run test:server -- server/shared/database/migrationInvariant.test.ts
npm run test:server -- server/modules/parameter-topology/schemaMigration.test.ts
npm run test:server -- server/modules/parameter-specs/
npm test -- src/components/parameter-topology/moduleAttributionTreeUtils.test.ts
npm run build
npm run docs:check
```

Browser (from PR4/PR6): `/parameter-admin/specs`, `/parameter-admin/modules`, `/parameter-admin/identity-mapping` at 1440/768/390.
