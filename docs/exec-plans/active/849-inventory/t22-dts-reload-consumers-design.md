# T2.2-DTS reload consumers — implementable design

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t22-dts-reload-consumers-design.md)

Companion to the [threat matrix](t22-dts-reload-consumers-threat-matrix.md). Reload selection/verify/promote must pin canonical binding + property occurrence + config revision. Overlay stays DTS. Do not keep scanner-visible fallbacks that runtime intercepts.

Status: **Spec PASS with P2 folded.** Independent review `01a0b01e-21b9-79e1-a8cf-75485959fd8e`. Implementation may start.

## 1. What T2.2-DTS is

Classify S12-DTS (54). Repair: `listReloadCandidateRows` / `getReloadCandidateRow` / `behaviouralVerify` source SQL still contain specification_key and latest-revision / spec-id fallbacks while `pinDtsReloadQueryable` rewrites executed SQL. Fail closed. Do not steal KNW.

| Seam | Owner today | T2.2-DTS |
| --- | --- | --- |
| Candidate list/get | coalesce + intercept | **Exact `dps.property_key` + exact config revision in source SQL; delete intercept** |
| Behavioural verify match | binding id **or** spec id | **Binding id only** |
| Promote | `createBindingDraft` | Keep; no catalog value write |
| Overlay members | `format = 'dts'` | Keep |
| Residue / restore | existing server tests | Keep |
| `pinDtsReloadQueryable` | wraps all `db.query` | **Delete** |
| HANDOFF/PROMOTE Playwright | `test.skip(true)` | Stay planned; unit coverage exists |
| Client/mock | dts-reload routes | Keep |
| Jobs/scripts | none in shard paths | Record none |

## 2. Classification method

Group `s12-dts.json` by `file` × `rule`. Labels: canonical-current-reload, canonical-current-exact-pin, canonical-current-promote, exact-canonical-history, archived-notice (vanished intercept / fallback tokens).

## 3. Repairs after Spec PASS

**A. Exact pins (`repository.ts`)**

In `listReloadCandidateRows` and `getReloadCandidateRow`:

- `property_key`: `dps.property_key` only. **Inner join** `dts_property_specs` (required, fail closed). No `string_to_array(ps.specification_key)` / `coalesce(..., ps.specification_key)`.
- `display_name`: `coalesce(psv.display_name, dps.property_key)` (no `ps.specification_key`).
- Locator lateral: `where … and config_revision_id = br.config_revision_id` in source SQL (not latest-revision order-by fallback).
- `order by` uses `dps.property_key`, not specification_key coalesce.

Delete `interceptExactReloadPinSql`, `pinDtsReloadQueryable`, `__dtsExactPin`. `service.ts` / `deploy.ts` / `promote.ts` must use `db` unwrapped.

**B. Verify match (`behaviouralVerify.ts`)**

Join `debugging_parameters` only on `dp.project_parameter_binding_id = b.id`. Remove `dp.parameter_spec_id = b.parameter_spec_id` fallback.

**C. Tests**

Retarget `parameterCatalogComparisonContribution.test.ts`: delete intercept-helper tests; assert executed candidate SQL has exact `dps.property_key`, `config_revision_id = br.config_revision_id`, and no `specification_key` in `property_key`, `display_name`, or `order by`. Keep promote/deploy/residue server tests. HANDOFF/PROMOTE Playwright stay planned (T3.2).

**D. Out of family**

Do not unskip HANDOFF/PROMOTE Playwright as a completion gate. Do not edit T2.1 fixtures, TOP relocation, DBG/LOG intercepts already repaired. Do not start T2.2-KNW.

## 4. Ratchet

1. Implement A–C.
2. Checker `--trusted-base-sha 9b3ba7df7e21f5589684bc92c872da593ad4c246` if it can complete. If T2.2-TOP `editService.ts` relocation still blocks, record that error; do not rewrite those fixtures.
3. Delete only vanished **DTS** shard entries. No growth, no checker weakening.
4. Receipt: DTS before **54**, total before **3513**, after counts, delta.

`interceptExactReloadPinSql` / source specification_key property fallback still present after repair is a Spec fail even if delta ≠ 0. Honest zero only when the intercept is gone and the checker is blocked.

## 5. Evidence

- `test:server --` `repository` comparison contribution + promote/deploy if touched.
- `git diff --check`. `tsc -b` if types change.
- Browser: default **no UI sweep**. Do not treat unskipped Playwright as this todo's gate.
- Independent Standards + Spec implementation review.
- Bilingual acceptance with classification groups.

Helper PG 55438.

## 6. Order after Spec PASS

1. Exact SQL + delete intercept + binding-only verify match.
2. Retarget comparison tests.
3. Checker / DTS shard ratchet if possible.
4. Receipt; review; stop. No T2.2-KNW. No commit.

## PR Plan

This todo does not open a PR.

| Step | Title | Paths | Depends on |
| --- | --- | --- | --- |
| A | Exact pin SQL | `repository.ts`, `behaviouralVerify.ts`, tests | Spec PASS |
| B | Shard ratchet | `s12-dts.json` if tokens gone | A |
| C | Receipt | T2.2-DTS docs | B |
