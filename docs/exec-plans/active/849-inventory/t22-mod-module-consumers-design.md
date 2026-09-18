# T2.2-MOD module consumers — implementable design

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t22-mod-module-consumers-design.md)

Companion to the [threat matrix](t22-mod-module-consumers-threat-matrix.md). Placement and subject kind are canonical current. Registration/capacity stay. Module search/counts stay. Driver identity is the attribution subject, not a spec-key tail. Locators pin the current binding revision. Overlay stays DTS coverage. Do not keep scanner-visible `specification_key` splits or latest-revision fallbacks.

Status: **Spec PASS with P2 folded.** Independent review `01a0b05c-8e4a-7c21-9f3d-2a1b6e90c4d7`. Implementation may start.

## 1. What T2.2-MOD is

Classify S12-MOD (283). Repair: `repository.ts` still splits `ps.specification_key` for `driver_module` and takes observation from the newest logical-node revision, while the live overlay picker still lists `view=governance` specs. Fail closed. Do not steal OPS. Do not 410 overlay or parameter-specs governance handlers.

| Seam | Owner today | T2.2-MOD |
| --- | --- | --- |
| Recompute driver string | `string_to_array` / `split_part(ps.specification_key)` | **`asub.source_key` via `ps.attribution_subject_id`. Identity is `asub.id`. No spec-key split, no `display_name` lookup** |
| Recompute / discovery locator | `dts_logical_node_revisions order by config_revision_id desc limit 1` | **Pin `config_revision_id = br.config_revision_id` (current binding revision). Missing → omit** |
| Subject kind / placement / capacity | `driverPlacement.ts`, `driverRegistrationPlacement.ts`, `attributionSubjects.ts` | Keep |
| Registry search/counts | `readRegistry` + `subtreeCounts` | Keep (bindings / distinct spec id) |
| Overlay HTTP | parameter-specs overlay routes (CGH kept 2xx) | **Keep 2xx.** Module client remains a facade |
| Overlay port/client methods | `ParameterModuleRegistryRepository` overlay CRUD | Keep as **DTS coverage adapter**, not module identity |
| Overlay spec picker | `OrganizationModuleGovernancePanel.listLibrarySpecs` → `listSpecs({ view: "governance" })` | **Retarget** (catalog definitions, else effective list). Never governance view |
| `service.ts` overlay imports | parse coverage for `listDriverRegistry` | Keep as DTS coverage annotation until T1.4. Do not 410 |
| Comparison | already hits PG | Assert executed SQL; no intercept helper |
| Client/mock | module registry routes + overlay facade | Keep routes; picker caller changes |
| Jobs/scripts | none in shard paths | Record none |

## 2. Classification method

Group `s12-mod.json` by `file` × `rule`. Labels: canonical-current-subject-placement, canonical-current-registration-capacity, canonical-current-search-counts, canonical-current-dts-overlay-adapter, canonical-current-picker, exact-canonical-history, archived-notice (`specification_key` driver split, latest-revision locator, governance-list picker).

## 3. Repairs after Spec PASS

**A. Exact driver/subject pin (`repository.ts` `listBindingsForModuleRecompute`)**

Replace the `driver_module` CASE on `ps.specification_key` with a join:

```sql
left join attribution_subjects asub
  on asub.id = ps.attribution_subject_id
 and (asub.organization_id is null or asub.organization_id = b.organization_id)
```

Project `asub.source_key` as `driver_module` (scaffolding heuristic only). Remap identity is `asub.id` via `ps.attribution_subject_id`, already passed as `attributionSubjectId`. Do **not** `string_to_array` / `split_part` / `coalesce(..., ps.specification_key)`. Never join or look up subjects by `display_name`. If `attribution_subject_id` is missing or the subject is not visible to this org, `driver_module` is null. `resolveAttributionModuleForBinding` already treats a missing/scaffolding driver without inventing a spec-key tail; keep that fail-closed path.

**B. Locator pin (`repository.ts` recompute + both discovery queries)**

Same shape as T2.2-DTS candidate SQL:

- Lateral current binding revision `br` on `project_parameter_binding_revisions` where `binding_id = b.id` (existing newest-created tip is acceptable **only** as the binding's own tip, not as a node-revision fallback).
- Logical-node revision `where logical_node_id = b.logical_node_id and config_revision_id = br.config_revision_id`.
- **Delete** `order by config_revision_id desc limit 1` in these three queries.

Fail closed: if `br` or matching `lnr` is missing, the recompute/discovery row contributes no compatible/instance (omit from discovery aggregates; recompute sees null compatible/locator and must not guess another revision).

**C. Picker retarget (`OrganizationModuleGovernancePanel.tsx`)**

`listLibrarySpecs` must not call `application.listSpecs({ view: "governance" })`.

1. Pass `runtime.parameterCatalogRepository` from `ParameterAdminNextPage` into the panel (Catalog is not on `useParameterAdmin()`). NextPage/Provider pass-through is in-family.
2. If that port is present (API mode), map `listDefinitions()` onto `ParameterSpecLibraryRow` by definition id / `propertyKey`. Do not invent a second Catalog HTTP client inside the panel.
3. Else (mock/no-catalog only) call `application.listSpecs()` with default/effective view. Fallback is not Catalog current.
4. Keep `mapParameterSpecToLibraryRow` for DTS spec-shaped rows. Catalog mapping must not recover identity from `specificationKey` tails.

Do **not** 410 `GET /api/v2/parameter-specs?view=governance` from this family (handler is parameter-specs / CGH leftover). After this retarget, MOD is no longer a live caller of that list.

Do **not** 410 overlay HTTP. Overlay create/activate/deprecate on the module port stays a DTS coverage adapter.

**D. Tests**

- Retarget `parameterCatalogComparisonContribution.test.ts` and focused `service.test.ts` / `repository` assertions: executed recompute SQL has no `specification_key` driver split and has `config_revision_id = br.config_revision_id`; discovery SQL likewise. No intercept-helper tests (none exist; do not add).
- Add/keep a fail-closed case: extra newer logical-node revision on a different config revision does not win.
- Panel/unit: `listLibrarySpecs` does not request `view: "governance"`.
- Keep existing registration/placement/capacity/kind tests.
- `hierarchical-modules.acceptance.spec.ts` stays history unless a token vanishes; do not expand e2e into T3.2.

**E. Out of family**

Do not start T2.2-OPS. Do not 410 parameter-modules routes. Do not 410 overlay or parameter-specs governance handlers. Do not edit T2.1 fixtures or TOP relocation. Do not rewrite unpublished Scratch 0151–0153.

## 4. Ratchet

1. Implement A–D.
2. Checker `--trusted-base-sha 9b3ba7df7e21f5589684bc92c872da593ad4c246` if it can complete. If T2.2-TOP `editService.ts` relocation still blocks, record that error; do not rewrite those fixtures.
3. Delete only vanished **MOD** shard entries. No growth, no checker weakening.
4. Receipt: MOD before **283**, total before **3513**, after counts, delta.

`specification_key` driver split, latest-revision locator fallback, or `listSpecs({ view: "governance" })` picker still present after repair is a Spec fail even if delta ≠ 0. Honest zero only when those leaks are gone and the checker is blocked.

Overlay-catalog-contract tokens on the port/client may remain (DTS coverage adapter). Module-import tokens for parse coverage may remain until T1.4. That is not a cheat if A–C landed.

## 5. Evidence

- `test:server --` `parameterCatalogComparisonContribution.test.ts` plus `service.test.ts` / `driverRegistration.test.ts` / `driverPlacement.test.ts` if touched. `DATABASE_URL=postgres://wiseeff:wiseeff@127.0.0.1:55438/<disposable>`.
- Panel/unit for picker retarget if the TSX test harness exists; otherwise a focused component test.
- `git diff --check`. `tsc -b` if types change.
- Browser: 1440x900 of the module mapping overlay spec picker if the retarget lands. Default no other UI sweep.
- Independent Standards + Spec implementation review.
- Bilingual acceptance with classification groups.

Helper PG 55438.

## 6. Order after Spec PASS

1. Exact subject pin + locator pin in `repository.ts` (A–B).
2. Retarget picker (C) + tests (D).
3. Checker / MOD shard ratchet if possible.
4. Receipt; review; stop. No T2.2-OPS. No commit.

## Key Decisions

1. **Subject over spec-key.** Remap identity is `asub.id`. Project `asub.source_key` only as the scaffolding `driver_module` string. Never `display_name`. Spec-key split is archived notice.
2. **Locator is the binding tip's config revision.** Same pin as T2.2-DTS. Latest-across-revisions is not a pin.
3. **Overlay HTTP stays.** CGH/DTS coverage. Module port overlay methods are an adapter, not Organization-schema structural ownership of the registry.
4. **Governance list is not this family's 410.** Retarget the live picker so MOD is not a caller. Handler 410 is T1.4 / leftover CGH.
5. **Catalog definitions preferred for the picker; effective list is the no-catalog fallback.** Never `view=governance`.
6. **Kind/registration/capacity/counts stay.** Product of this family.
7. **Honest zero allowed** if leaks are gone and the checker is blocked by T2.2-TOP relocation fixtures.

## Open Questions

None. Overlay-port removal vs adapter is decided: adapter until T1.4. Governance-list 410 is out of family.

## PR Plan

This todo does not open a PR.

| Step | Title | Paths | Depends on |
| --- | --- | --- | --- |
| A | Exact subject + locator pin | `server/modules/parameter-modules/repository.ts`, tests | Spec PASS |
| B | Picker retarget | `OrganizationModuleGovernancePanel.tsx`, tests | Spec PASS |
| C | Shard ratchet | `s12-mod.json` if tokens gone | A, B |
| D | Receipt | T2.2-MOD docs | C |
