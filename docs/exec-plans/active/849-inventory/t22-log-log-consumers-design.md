# T2.2-LOG log consumers — implementable design

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t22-log-log-consumers-design.md)

Companion to the [threat matrix](t22-log-log-consumers-threat-matrix.md). Log recommendations must pin canonical current bindings. Historical analysis records stay. Do not keep scanner-visible `specification_key` fallback that runtime intercepts.

Status: **Spec PASS with P2 folded.** Independent review `01a0afdf-99dd-7840-956c-d3c054c84433`. Implementation may start.

## 1. What T2.2-LOG is

Classify S12-LOG (10). Repair: `loadRelatedParameter` source SQL still `coalesce(psv.display_name, dps.property_key, ps.specification_key)` while `pinLogRelatedParameterQuery` rewrites executed SQL. Fail closed on unresolved related ids. Do not steal DBG.

| Seam | Owner today | T2.2-LOG |
| --- | --- | --- |
| Log upload/run/record/domain | `logs/repository.ts`, `domainsRepository.ts` | Keep; `related_parameter_id` is binding id |
| `loadRelatedParameter` | coalesce + intercept | **Exact name pin in source SQL; delete intercept** |
| Unresolved related id | returns `null` | Keep fail closed; no definition mint |
| Historical analysis records | stored runs/evidence | Keep immutable |
| HTTP client / DTO / mock | log routes | Keep; no spec mint |
| Comparison contribution | intercept tests | Retarget to exact-SQL assertion |
| Jobs/scripts | none in shard paths | Record none |
| E2E `log-analysis.acceptance.spec.ts` | in-family | Keep; default no new Playwright |

## 2. Classification method

Group `s12-log.json` by `file` × `rule`. Labels: canonical-current-logs, canonical-current-exact-pin, exact-canonical-history, archived-notice (vanished `specification_key` / intercept tokens).

## 3. Repairs after Spec PASS

**A. Exact pin (`dbToolBackends.ts`)**

Replace `coalesce(psv.display_name, dps.property_key, ps.specification_key)` with `coalesce(psv.display_name, dps.property_key)`. Keep org-scoped binding lookup (`b.organization_id` + `b.id`). Remove `pinLogRelatedParameterQuery`, `interceptExactRelatedParameterSql`. `createDbLogAnalysisToolBackends` must not wrap `db.query`.

Do not invent a spec id. Do not fall back to `ps.specification_key` for display name.

**B. Tests**

Retarget `parameterCatalogComparisonContribution.test.ts` intercept describe: delete tests of `interceptExactRelatedParameterSql`; assert `loadRelatedParameterContext` executed SQL has no `ps.specification_key` name fallback and contains `coalesce(psv.display_name, dps.property_key)`.

`dbToolBackends.test.ts`: `expect(db.query).toBe(query)` does **not** catch a new Queryable wrap. Prove related-parameter **and** knowledge-search queries call the original `query` with unwrapped SQL (no intercept). Keep null-on-missing-row. Grep wrap helpers gone.

**C. Out of family**

Do not edit T2.1 `semanticBindingFixture.ts`, T2.2-TOP relocation fixtures, AGT/xiaoze, DBG/DTS/KNW. Do not 410 log routes. Do not rewrite stored analysis JSON.

## 4. Ratchet

1. Implement A–B.
2. Checker `--trusted-base-sha 9b3ba7df7e21f5589684bc92c872da593ad4c246` if it can complete. If T2.2-TOP `editService.ts` relocation still blocks, record that error; do not rewrite those fixtures.
3. Delete only vanished **LOG** shard entries (`dbToolBackends.ts` specification_key / intercept tokens). No growth, no checker weakening.
4. Receipt: LOG before **10**, total before **3513**, after counts, delta.

`interceptExactRelatedParameterSql` / source `specification_key` name fallback still present after repair is a Spec fail even if delta ≠ 0. Honest zero is allowed only when the intercept is gone and the checker is blocked.

## 5. Evidence

- `test:server -- dbToolBackends.test.ts parameterCatalogComparisonContribution.test.ts` (and other log tests if touched).
- `git diff --check`. `tsc -b` if types change.
- Browser: default **no UI sweep**.
- Independent Standards + Spec implementation review.
- Bilingual acceptance with classification groups.

Helper PG 55438.

## 6. Order after Spec PASS

1. Exact SQL + remove intercept + retarget comparison tests.
2. Checker / LOG shard ratchet if possible.
3. Receipt; review; stop. No T2.2-DBG. No commit.

## PR Plan

This todo does not open a PR.

| Step | Title | Paths | Depends on |
| --- | --- | --- | --- |
| A | Exact pin SQL | `dbToolBackends.ts`, tests | Spec PASS |
| B | Shard ratchet | `s12-log.json` if tokens gone | A |
| C | Receipt | T2.2-LOG docs | B |
