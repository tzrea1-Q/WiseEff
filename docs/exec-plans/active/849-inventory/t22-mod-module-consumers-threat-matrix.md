# T2.2-MOD module consumers — pre-implementation threat matrix

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t22-mod-module-consumers-threat-matrix.md)

Contract: #849/#853 T2.2-MOD, [API transition](../../../design-docs/parameter-catalog-api-transition.md) Module/driver registry row, [inventory](../../../references/parameter-catalog-contract-inventory.md) Module registry row, T2.2-CGH [design](t22-cgh-catalog-governance-design.md) governance-list freeze, T2.2-KNW [acceptance](t22-knw-knowledge-consumers-acceptance.md). Product direction (eleven families, classify, repair then ratchet, vs 3513) is decided. This matrix freezes the MOD implementation boundary.

Status: **Spec PASS with P2 folded.** Companion: [implementable design](t22-mod-module-consumers-design.md). Independent review `01a0b05c-8e4a-7c21-9f3d-2a1b6e90c4d7`.

## Lane and boundaries

- Worktree: `/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`, branch `codex/849-853-t11-source-identity`.
- HEAD `f9c710f6a90d67462965a06abd47e33aa200e75e`; accepted main `46b6068693942b95f7cba28ee5de6748a97170fa`. T1.1–T2.2-KNW remain uncommitted; do not rewrite except MOD-owned paths.
- Allowed paths: `server/modules/parameter-modules/**`, `src/application/ports/ParameterModuleRegistryRepository.ts`, `src/infrastructure/http/parameterModuleRegistryClient.ts` (+ test), `e2e/acceptance/hierarchical-modules.acceptance.spec.ts`, `scripts/parameter-catalog-allowlist/shards/s12-mod.json`. Live picker adapter `src/components/parameter-admin-next/OrganizationModuleGovernancePanel.tsx` is in-family even though it is not a shard path (CGH deferred the `view=governance` caller here). Classify in-family; do not steal OPS or rewrite parameter-specs overlay/governance handlers.
- Stop after T2.2-MOD. No T2.2-OPS or later, T1.4, commit, PR, merge, Issue mutation.
- Viewport 1440x900 only if the module mapping overlay picker empty/copy/selection surface changes. Default: one PC check of that picker if the retarget lands; no tablet/mobile sweep.
- Reviewers: grok-4.6 (requested gpt-5.6-luna unavailable; disclose).
- Helper PG 55438 disposable only. Never `wiseeff_lane_849`, never `5432/wiseeff`. Prefer `wiseeff_t22_cgh` or `wiseeff_t22_mod`.

## Invariant under protection

Every S12-MOD runtime read and write is classified as **canonical current** (subject kind, declared placement, registration/capacity, module search/counts), **exact canonical history**, or **authorized archived notice**. Driver/subject identity for recompute and discovery comes from **`attribution_subjects`**, not `parameter_specs.specification_key` split. Observation locators pin **the current binding revision's `config_revision_id`**, not latest-revision `order by … desc`. Missing subject or missing locator **fails closed** (omit the row; do not invent). Overlay HTTP stays DTS coverage; the module registry does **not** claim Organization-schema structural ownership. The live overlay spec picker does **not** call `listSpecs({ view: "governance" })`. There is **no** new `db.query` intercept/wrap. Repair source SQL and the picker caller before deleting an allowance.

## Intake (measured 2026-09-18)

Shards still total **3513**. S12-MOD `s12-mod.json` has **283** entries in **51** file×rule groups:

| Kind | Count | Notes |
| --- | --- | --- |
| Production `repository.ts` | 38 | raw-read 20, sql-write 9, identifier 9 — includes `specification_key` split + latest-revision fallback |
| Production `service.ts` | 18 | raw-read 8, identifier 4, overlay-contract 2, module-import 3, sql-write 1 |
| Production placement | 41 | `driverRegistrationPlacement.ts` 21, `driverPlacement.ts` 20 — already join `attribution_subjects` |
| Production other | 26 | `ensureAttributionModuleForBinding.ts` 9, `resolveAttributionSubject.ts` 9, `attributionSubjectRepository.ts` 5, `resolveModuleForBinding.ts` 3, `subtreeCounts.ts` 2, `routes.ts` 13 |
| Client / port | 55 | `parameterModuleRegistryClient.ts` 28, `ParameterModuleRegistryRepository.ts` 27 — mostly overlay-catalog-contract |
| Tests / e2e | 92 | service/driverRegistration/placement/subtree/recompute/e2e |

Rules: raw-read 108, sql-write 58, overlay-catalog-contract 53, identifier 37, catalog-route 15, table-name 5, unresolved 4, module-import 3.

Live leaks:

- `listBindingsForModuleRecompute` in `repository.ts` derives `driver_module` from `string_to_array(ps.specification_key)` / `split_part`, and takes compatible/instance from `dts_logical_node_revisions order by config_revision_id desc limit 1` (no pin). Callers: mapping recompute / disband in `service.ts`.
- `listObservedCompatiblesForDiscovery` and `listDismissedCompatiblesForDiscovery` repeat the latest-revision fallback.
- `service.ts` still imports `../parameter-specs/{schemaRegistryCache,driverSchemaOverlayRepository,parseCoverage}` for driver-registry parse coverage (CGH overlay kept as DTS coverage until T1.4; not 410 here).
- Live picker: `OrganizationModuleGovernancePanel.listLibrarySpecs` calls `application.listSpecs({ view: "governance" })`. CGH froze that list 2xx until this family retargets the picker.

Already good: `driverPlacement.ts` / `driverRegistrationPlacement.ts` inner-join `attribution_subjects` with `subject_kind` and org isolation. `listDriverRegistry` / `updateDriverRegistration` join `attribution_subjects` + `driver_registrations` + placements. Kind/parent rules live in `attributionSubjects.ts`. Comparison contribution already queries real PostgreSQL (no `pinM` intercept). Overlay HTTP is **not** owned by `parameter-modules/routes.ts`; the module client is a facade over `/api/v2/organization-driver-schemas*`.

No `pinM` / intercept helper exists. Do not add one.

## Classification freeze

| Class | Meaning in MOD | This todo |
| --- | --- | --- |
| Canonical current — subject/placement | `attribution_subjects`, `driver_registrations`, `driver_registration_placements`, module kind | Keep; pin recompute driver from subject |
| Canonical current — registration/capacity | driver nature, instance cardinality, default business category, replay | Keep |
| Canonical current — search/counts | `readRegistry` + `subtreeCounts` (bindings = parameterCount; distinct spec id = definitionCount) | Keep; counts stay binding facts, not spec-key tails |
| Canonical current — DTS overlay adapter | port/client overlay CRUD + parse-coverage reads | Keep as **DTS coverage**, not module identity. Do not 410 overlay HTTP |
| Canonical current — picker | overlay spec library for linking overlay properties | **Retarget** off `view=governance` |
| Exact canonical history | tests, e2e, comparison | Keep / retarget SQL assertions |
| Archived notice | `specification_key` driver split; latest-revision locator fallback; governance-list picker caller | **Remove** |

## Rows

| ID | Dimension | Expected observation | Evidence owner |
| --- | --- | --- | --- |
| T22M-01 | Inventory | 283 entries classified by file×rule | receipt table |
| T22M-02 | Exact driver/subject pin | Recompute SQL does not split `ps.specification_key`. Join `attribution_subjects` on `ps.attribution_subject_id`; project `asub.source_key` as `driver_module` (scaffolding only). Identity is `asub.id`. Never `display_name`. Missing subject → null, fail closed | `repository.ts` + tests |
| T22M-03 | Locator pin | Recompute and discovery locators use `config_revision_id = br.config_revision_id` for the current binding revision. No `order by config_revision_id desc limit 1` fallback | `repository.ts` + comparison/service tests |
| T22M-04 | Fail closed | Binding/discovery row without current revision or matching logical-node revision is omitted, not guessed | tests |
| T22M-05 | No intercept | No `pinM` / `db.query` wrap. Source SQL is the executed SQL | grep + comparison test |
| T22M-06 | Picker retarget | Pass `runtime.parameterCatalogRepository` into the panel. API mode: `listDefinitions()`. Mock/no-catalog only: default/effective `listSpecs()`. Never `view: "governance"`. Fallback is not Catalog current | panel + test |
| T22M-07 | Overlay HTTP | Do **not** 410 `/api/v2/organization-driver-schemas*` or parameter-specs governance list/detail. Overlay stays DTS coverage | no overlay-route rewrite |
| T22M-08 | Module identity | Kind, registration, capacity, declared placement, search/counts remain canonical current. Module registry does not mint Organization-schema structural truth | existing registration tests |
| T22M-09 | Cross-org | Placement/subject reads stay org-or-platform-global; no other-tenant disclosure | existing placement tests |
| T22M-10 | Ratchet | Repair first; vs 283/3513. Leftover spec-key split or latest-revision fallback is Spec fail even if delta ≠ 0. Honest zero only if those leaks are gone and checker blocked | shard + checker if runnable |
| T22M-11 | UI | 1440x900 of overlay spec picker if retarget lands. No tablet/mobile | receipt |
| T22M-12 | Environment | 55438 disposable | receipt |
| T22M-13 | Non-goals | T2.2-OPS, T1.4, T2.1 fixture, TOP relocation, Hosted, commit; 410 of parameter-modules routes; 410 of overlay/governance handlers | receipt |

## Non-goals

- Zeroing 283 MOD allowances.
- 410 of `/api/v2/parameter-modules` read/navigation or mapping writes (T1.4 final behavior).
- 410 of overlay HTTP or `GET /api/v2/parameter-specs?view=governance` list/detail (parameter-specs / CGH leftover; T1.4).
- Removing overlay CRUD from `ParameterModuleRegistryRepository` in this todo (DTS coverage adapter stays; it does not define module identity).
- Rewriting stored `project_parameter_bindings.parameter_spec_id` or T2.1 `semanticBindingFixture.ts` / T2.2-TOP relocation fixtures.
- Starting T2.2-OPS.
- Commit, PR, merge, Hosted, target, Issue mutation.

## Self-review limit

Written by the coordinating implementer. Independent Spec review is required before production edits.
