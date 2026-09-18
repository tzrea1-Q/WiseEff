# T2.2-MOD design Spec review

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t22-mod-module-consumers-spec-review.md)

Model: grok-4.6 (requested gpt-5.6-luna unavailable)
Verdict: **PASS with P2**

Independent Spec review of [t22-mod-module-consumers-design.md](t22-mod-module-consumers-design.md) and [t22-mod-module-consumers-threat-matrix.md](t22-mod-module-consumers-threat-matrix.md). Reviewer did not write the design. No production edits, commit, or T2.2-OPS in this review.

Review `01a0b05c-8e4a-7c21-9f3d-2a1b6e90c4d7` **PASS with P2**. P2s folded into the design/matrix before production edits.

## P1

None open. Spec-key split and latest-revision locator are repaired in source SQL, not wrapped. Overlay and parameter-specs governance HTTP are not 410ed here. T2.1/TOP fixtures stay out. Leftover `specification_key` driver split, `order by config_revision_id desc limit 1`, or `listSpecs({ view: "governance" })` picker after repair is Spec fail even if delta ≠ 0.

## P2 (folded before implementation)

1. **Subject projection.** Remap identity is `asub.id` via `ps.attribution_subject_id`, not the `driver_module` string. `display_name` is not unique (`unique (organization_id, source_key)` only; ADR-0004 name is display-only). Fold: project `asub.source_key` as `driver_module` (scaffolding heuristic only). Never join/lookup subjects by `display_name`. Missing subject → null, fail closed. Locator `br` is the binding’s own tip (`order by created_at desc limit 1` where `binding_id = b.id`), then `lnr.config_revision_id = br.config_revision_id` (DTS shape). Delete the three latest-revision fallbacks.

2. **Picker wiring.** Catalog is `runtime.parameterCatalogRepository` on `ParameterAdminNextPage`, not `useParameterAdmin()`. Fold: pass that port into `OrganizationModuleGovernancePanel` (NextPage/Provider pass-through is in-family; CGH deferred the `view=governance` caller here even though the panel is not a `s12-mod.json` path). API mode uses `listDefinitions()` mapped onto `ParameterSpecLibraryRow` by definition id / propertyKey. Effective `application.listSpecs()` is mock/no-catalog only. Never `view=governance`. Fallback is not Catalog current.

3. **CGH “until T2.2-MOD”.** Means retarget this live caller, not 410 winning `GET /api/v2/parameter-specs?view=governance` on `registerParameterSpecRoutes`. Remaining governance list is `OrganizationSpecGovernancePanel` mock/no-catalog (CGH leftover). Do not 410 overlay HTTP or `/api/v2/parameter-modules` routes.

4. **ZH parity.** Picker never governance; insert/delete intercept N/A (none exists; do not add); quote inventory Module row; T2.1/TOP out of family; leftover spec-key split / latest-revision / governance picker after repair is Spec fail even if delta ≠ 0. Align ZH A. with `source_key` projection.

## Checked and accepted

- **(a) Overlay adapter vs structural ownership.** Transition: retire module/Organization-schema structural ownership; overlay HTTP 410 is final/T1.4. CGH froze overlay GET/POST as DTS coverage (not 410 in CGH). Keeping overlay CRUD on `ParameterModuleRegistryRepository` as a facade over `/api/v2/organization-driver-schemas*` does not mint module identity (kind, declared placement, registration/capacity, search/counts stay canonical current). 410ing overlay HTTP in MOD would steal parameter-specs/CGH. Accepted as DTS coverage adapter until T1.4; not a P1.

- **(b) Governance list.** CGH: keep list `GET /api/v2/parameter-specs?view=governance` **2xx until T2.2-MOD** because the live caller is `OrganizationModuleGovernancePanel.listLibrarySpecs`. Retarget-only is enough. 410 of the winning list handler would steal parameter-specs/CGH.

- **(c) Locator.** Newest-created binding tip is honest only as that binding’s tip. Pinning `lnr` to `br.config_revision_id` cannot pick a newer node revision on another config the way `order by config_revision_id desc limit 1` does. Fail closed: omit the row. Not a P1.

- **(d) Driver pin.** Live leak is `string_to_array` / `split_part(ps.specification_key)` in `listBindingsForModuleRecompute`. Downstream remap already uses `attributionSubjectId` + placement; `driverModule` is scaffolding-only. Collision of `display_name` is not a dishonest subject pin if P2-1 is folded.

- **(e–f)** Product matches todolist (placement/subject kind, registration/capacity, search/counts) and inventory Module row. No intercept exists; do not add. T2.1/TOP out of family. Panel edit is in-family.

**Implementation may start** (P2s folded). Do not start T2.2-OPS. Do not mark T2.2-MOD complete from this review.
