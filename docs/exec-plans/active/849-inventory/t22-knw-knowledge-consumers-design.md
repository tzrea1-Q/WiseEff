# T2.2-KNW knowledge consumers — implementable design

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t22-knw-knowledge-consumers-design.md)

Companion to the [threat matrix](t22-knw-knowledge-consumers-threat-matrix.md). New picker links are canonical current. Stored chips stay. Missing specs are notice-only. Other tenants 404. Do not keep scanner-visible inner joins that runtime rewrite.

Status: **Spec PASS with P2 folded.** Independent review `01a0b039-d4ae-7730-8244-3dc0c277e5bc`. Implementation may start.

## 1. What T2.2-KNW is

Classify S12-KNW (50). Repair: `parameterReferences.ts` still projects `specification_key` tails and inner-joins `parameter_specs` while `pinK` rewrites executed SQL to LEFT JOIN and overlays mapping. Fail closed on picker. Do not steal MOD.

| Seam | Owner today | T2.2-KNW |
| --- | --- | --- |
| Load refs by entry | inner join + `pinK` LEFT JOIN intercept | **LEFT JOIN in source SQL; delete intercept** |
| Property-key projection | `ps.property_key` / dps / specification_key tail | **`coalesce(ps.property_key, dps.property_key)` only** |
| Picker `resolveReferenceableSpec` | org or platform-global; `pinK` wrap | Keep visibility; **no wrap**; unresolved 404 |
| Mapping overlay | `db.query` wrap + `lookupLegacyIdentifier` | **Explicit after query**, or drop wrap |
| Synthetic empty inject | `overlayKnowledgeReferenceRows` when `rows.length === 0` | **Delete** |
| Cross-org | `organization_id` + 404 other tenants | Keep |
| Knowledge routes / distill / search | existing | Keep |
| Comparison | intercept helper tests | Retarget to executed SQL |
| Client/mock | knowledge routes | Keep |
| Jobs/scripts | none in shard paths | Record none |

## 2. Classification method

Group `s12-knw.json` by `file` × `rule`. Labels: canonical-current-picker, canonical-current-stored-ref, notice-only-historical, exact-canonical-history, archived-notice (`pinK` / specification_key).

## 3. Repairs after Spec PASS

**A. Exact projection (`parameterReferences.ts`)**

`REFERENCE_SPEC_PROJECTION`: `coalesce(ps.property_key, dps.property_key) as property_key` (no `string_to_array(ps.specification_key)`). Keep attribution subject + preferred version.

**B. Historical load SQL**

`loadParameterReferencesByEntryIds`: **LEFT JOIN** `parameter_specs` in source SQL. Missing spec → notice-only chip (existing `propertyKey` fallback to spec id is notice-only for orphans, not picker selection).

**C. Delete intercept**

Delete `pinK`, `interceptKnowledgeReferenceSql` **entirely**, `__knwPin`, and empty-result synthetic inject. `resolveReferenceableSpec` / insert / delete must not wrap `db.query`.

If `mappingStatus` / `historicalOnly` remain on the DTO, apply `lookupLegacyIdentifier` **explicitly after the load query only** (never on picker/resolve empty results).

**D. Tests**

Retarget `parameterCatalogComparisonContribution.test.ts`: delete intercept-helper tests; assert executed load SQL is LEFT JOIN and has no specification_key property fallback. Keep existing org-isolation / 404 / deprecation-survives-reference tests in `parameterReferences.test.ts`.

**E. Out of family**

Do not start T2.2-MOD. Do not 410 knowledge routes. Do not rewrite stored reference rows. Do not edit T2.1 fixtures or TOP relocation.

## 4. Ratchet

1. Implement A–D.
2. Checker `--trusted-base-sha 9b3ba7df7e21f5589684bc92c872da593ad4c246` if it can complete. If T2.2-TOP `editService.ts` relocation still blocks, record that error; do not rewrite those fixtures.
3. Delete only vanished **KNW** shard entries. No growth, no checker weakening.
4. Receipt: KNW before **50**, total before **3513**, after counts, delta.

`pinK` / `interceptKnowledgeReferenceSql` wrap still present after repair is a Spec fail even if delta ≠ 0. Honest zero only when the wrap is gone and the checker is blocked.

## 5. Evidence

- `test:server -- parameterReferences.test.ts parameterCatalogComparisonContribution.test.ts` (and routes if touched).
- `git diff --check`. `tsc -b` if types change.
- Browser: default **no UI sweep**.
- Independent Standards + Spec implementation review.
- Bilingual acceptance with classification groups.

Helper PG 55438.

## 6. Order after Spec PASS

1. Exact projection + LEFT JOIN source SQL + delete wrap.
2. Retarget comparison tests.
3. Checker / KNW shard ratchet if possible.
4. Receipt; review; stop. No T2.2-MOD. No commit.

## PR Plan

This todo does not open a PR.

| Step | Title | Paths | Depends on |
| --- | --- | --- | --- |
| A | Exact pin + no wrap | `parameterReferences.ts`, tests | Spec PASS |
| B | Shard ratchet | `s12-knw.json` if tokens gone | A |
| C | Receipt | T2.2-KNW docs | B |
