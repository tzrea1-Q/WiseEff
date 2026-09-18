# T2.2-FIL file consumers — implementable design

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t22-fil-file-consumers-design.md)

Companion to the [threat matrix](t22-fil-file-consumers-threat-matrix.md). File membership (candidate/version/config-set/baseline/export) stays. Sync match and writeback must pin binding + property occurrence, not specification_key fallback.

Status: **Spec PASS with P2 folded.** Independent review `01a0afa4-6152-77c2-947b-87f66c9304aa`. Implementation may start.

## 1. What T2.2-FIL is

Classify S12-FIL (56). Repair: (a) `findBindingBySource` source SQL still contains property-key `split_part` fallback while runtime intercepts it; (b) writeback/conflict coerce `parameterDefinitionId` into `parameterSpecId`. Fail closed on unresolved identity. Do not steal AGT.

| Seam | Owner today | T2.2-FIL |
| --- | --- | --- |
| Config-set / version / candidate / baseline / export | parameter-files services | Keep 2xx |
| `findBindingBySource` | `syncIdentity.ts` coalesce+`pinP` intercept | **Exact `dps.property_key` in source SQL; delete intercept** |
| Writeback overlay apply | `parameterSpecId ?? parameterDefinitionId` | **No coerce**; **required** spec id from locked binding |
| Writeback source SQL | `pinW` rewrites left join → inner join at runtime | **Inner join in source SQL; delete wrap** |
| Conflict insert | same coerce in semantic mode | **No coerce**; semantic callers pass `parameterSpecId` |
| `syncService` semantic conflict | `parameterDefinitionId` only | **Pass `parameterSpecId` from binding match** |
| File HTTP client | `/api/v1/projects/:id/parameter-files*` | Keep |
| Mock file repository | in-memory files | Keep; no spec mint |
| Comparison contribution | intercept tests | Retarget to exact-SQL assertion |
| Jobs/scripts | none in shard paths | Record none |

## 2. Classification method

Group `s12-fil.json` by `file` × `rule`. Labels: canonical-current-files, canonical-current-exact-pin, exact-canonical-history, archived-notice (vanished `split_part` / intercept tokens).

## 3. Repairs after Spec PASS

**A. Exact pin (`syncIdentity.ts`)**

Replace both `coalesce(dps.property_key, split_part(ps.specification_key, '/', 2)…)` expressions with `dps.property_key`. Keep locator+file-version match. Remove `pinP`, `__filExactPin`, and `interceptExactPropertyPinSql`. `findBindingBySource` must not wrap `db.query`.

Tests (`syncIdentity.test.ts`):

- Existing locator match still passes (fixture has `propertySpec.propertyKey`).
- New: spec with `specification_key` but **null/absent** `dts_property_specs.property_key` → `null` match (fail closed).
- Existing “does not query retired PPV/definitions” still passes; executed SQL must not contain `split_part(ps.specification_key`.

**B. Writeback (`writebackService.ts`)**

`applyLockedOverlayWriteback` requires `parameterSpecId: string`. Do **not** pass `input.parameterSpecId ?? input.parameterDefinitionId`. Load spec id from the locked binding (`project_parameter_bindings.parameter_spec_id` for the write-lock binding). Fail closed if missing. Never from `parameterDefinitionId`. Semantic writeback remains binding-id + write lock (`resolveLockedWritebackContext`).

Replace `loadSemanticWritebackSource` `left join dts_property_specs` with **inner join** in source SQL. Remove `pinW`, `__filExactPin`, and `interceptExactWritebackSourceSql`. Do not wrap `db.query`.

**C. Conflicts (`conflictService.ts`) and sync (`syncService.ts`)**

Do not set `parameterSpecId` from `parameterDefinitionId` in semantic mode. Pass `input.parameterSpecId` only (optional). Binding id may still fall back `projectParameterBindingId ?? projectParameterValueId` when that field is already the binding id (existing comment); do not invent a spec id.

Semantic `syncFileVersion` must pass `parameterSpecId` (and binding id) from `findBindingBySource`, not omit it so a later coerce fills a definition id.

**D. Comparison tests**

Retarget `parameterCatalogComparisonContribution.test.ts` intercept describe: delete tests of `interceptExactPropertyPinSql`; assert `findBindingBySource` executed SQL has no specification_key fallback.

**E. Out of family**

Do not edit T2.1 `semanticBindingFixture.ts`. Do not start T2.2-AGT. Do not 410 file routes. Do not rewrite T2.2-TOP relocation fixtures. `parameters/fileSyncConflictRepository.ts` coerce remains out of family unless a FIL caller still omits spec id (live path must not omit).

## 4. Ratchet

1. Implement A–D.
2. Checker `--trusted-base-sha 9b3ba7df7e21f5589684bc92c872da593ad4c246` if it can complete. If T2.2-TOP `editService.ts` relocation still blocks, record that error; do not rewrite those fixtures.
3. Delete only vanished **FIL** shard entries (`syncIdentity.ts` coalesce tokens). No growth, no checker weakening.
4. Receipt: FIL before **56**, total before **3513**, after counts, delta.

Zero delta **and** source SQL still containing `split_part` fallback is a Spec fail.

## 5. Evidence

- `test:server -- syncIdentity.test.ts` (and writeback/conflict tests if touched).
- `git diff --check`. `tsc -b` if types change.
- Browser: default **no UI sweep**.
- Independent Standards + Spec implementation review.
- Bilingual acceptance with classification groups.

Helper PG 55438.

## 6. Order after Spec PASS

1. Exact SQL + remove intercept + fail-closed test.
2. Writeback/conflict no coerce + tests.
3. Comparison test retarget.
4. Checker / FIL shard ratchet if possible.
5. Receipt; review; stop. No T2.2-AGT. No commit.

## PR Plan

This todo does not open a PR.

| Step | Title | Paths | Depends on |
| --- | --- | --- | --- |
| A | Exact pin SQL | `syncIdentity.ts`, tests | Spec PASS |
| B | Writeback/conflict identity | `writebackService.ts`, `conflictService.ts`, tests | Spec PASS |
| C | Comparison test | `parameterCatalogComparisonContribution.test.ts` | A |
| D | Shard ratchet | `scripts/parameter-catalog-allowlist/shards/s12-fil.json` if tokens gone | A–C |
| E | Receipt | T2.2-FIL docs | D |
