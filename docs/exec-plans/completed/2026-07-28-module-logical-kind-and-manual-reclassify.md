# Module logical kind and manual reclassify — execution plan
> Status: **Completed 2026-08-17 (archive round 2)** — implementation is on `main`.

## Goal

Add `kind = "logical"` for DTS nodes without compatible evidence, and open controlled kind correction on the module edit path so ADR-0004's "edit to fix a wrong guess" consequence is reachable (ADR-0006).

## Git & PR Workflow

- Feature branch: `feat/module-logical-kind` (from current module-attribution UI work).
- Implementation commits on the feature branch only.
- Parent agent opens/merges the GitHub PR; do not push to `main` from this plan.

## Domain decisions

- `instance` = hardware evidence (compatible present). `logical` = no compatible. `board` stays `instance`.
- No SQL bulk backfill — constraint-only migration `0075`. Kind asserted at ingest for auto rows; curated never overwritten.
- Manual reclassify whitelist: `{business, instance, logical}` only. Driver-group and unclassified are out.

## Batches

1. Migration `0075` + migrationInvariant.
2. Types + `updateParameterModuleBodySchema` kind field.
3. Ingest writes `logical` for Type C; reassert kind on auto `source_key` hits.
4. Repository/service kind update with promote + parent/child guards + audit `previousKind`.
5. Frontend labels, filters, styles, mock.
6. Guards: move logical, no delete, `canReclassifyModule`.
7. Edit dialog kind select; port/HTTP/mock update.
8. Acceptance IDs `MOD-ATTR-TREE-001` (extended) + `MOD-ATTR-RECLASSIFY-001`.
9. ADR-0006, ADR-0004 follow-up, FRONTEND EN/ZH, TD-045 scaffolding leftovers.

## UI Interaction Automation

| ID | Behavior | Status |
| --- | --- | --- |
| `MOD-ATTR-TREE-001` | Kind-scoped actions include logical move / no-delete | Registered (stub pending Playwright) |
| `MOD-ATTR-RECLASSIFY-001` | Edit-dialog logical→business; curated survives re-ingest | Registered (stub pending Playwright) |

## Documentation Impact Matrix

| Area | Action | Paths | Status |
| --- | --- | --- | --- |
| ADR | Update | `docs/adr/0006-*.md` (new), `docs/adr/0004-*.md` | Done |
| Frontend | Update | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` | Done |
| Acceptance maps | Update | `docs/developer/browser-acceptance-coverage-map.md`, `docs/developer/user-operation-coverage-matrix.md` | Done |
| Tech debt | Update | `docs/exec-plans/tech-debt-tracker.md`, `docs/zh-CN/exec-plans/tech-debt-tracker.md` | Done (TD-045) |
| Domain model | Review | `docs/design-docs/domain-model.md` | Review — kind vocabulary lives in ADR-0004/0006; no domain-model rewrite required unless cutover docs mention only four kinds |
| Generated schema | Review | `docs/generated/db-schema.md` | Review — constraint change; regenerate when TD-004 tooling runs |
| Product specs | No change | — | — |
| Security / reliability | No change | — | — |

## Documentation Update Gate

Blocking until ADR-0006, bilingual frontend, acceptance maps, and TD-045 are updated. Run `npm run docs:check` before completing.

## Verification

```bash
npx vitest run server/shared/database/migrationInvariant.test.ts server/modules/parameter-modules/ensureInstanceModuleForBinding.test.ts src/components/parameter-topology/moduleAttributionTreeUtils.test.ts
npm run test:server -- --run server/modules/parameter-modules
npm run build
npm run docs:check
# playwright-cli: /parameter-admin/modules at 1440x900, 768x1024, 390x844
```

## Deferred

- TD-045: remove scaffolding modules mis-created by 0072.
- Proactive driver registry (declare supported compatibles before DTS upload) — separate ADR/plan.
