# T2.2-CGH catalog/governance consumers — pre-implementation threat matrix

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t22-cgh-catalog-governance-threat-matrix.md)

Contract: #849/#853 T2.2-CGH, closed [#847](https://github.com/tzrea1-Q/WiseEff/issues/847), [API transition](../../../design-docs/parameter-catalog-api-transition.md), [ADR-0046](../../../adr/0046-source-occurrence-identity-spans-dts-and-software-configuration.md), T2.1 [acceptance](t21-parameter-ui-acceptance.md). Product direction (eleven families, classify every reference, repair then ratchet, measured reduction vs 3513) is already decided. This matrix freezes the CGH implementation boundary.

Status: **independent Spec re-review PASS with P2.** P2s folded here. Companion: [implementable design](t22-cgh-catalog-governance-design.md).

## Lane and boundaries

- Worktree: `/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`, branch `codex/849-853-t11-source-identity`.
- Inherited HEAD `f9c710f6a90d67462965a06abd47e33aa200e75e`; accepted main `46b6068693942b95f7cba28ee5de6748a97170fa`. T1.1–T2.1 remain uncommitted dirty candidates and are not rewritten.
- Risk **R2** (public Catalog/governance HTTP, authorization, identity). Independent Spec review of this matrix and the design precedes production edits.
- Stop after T2.2-CGH local delivery. No T2.2-TOP or later families, T1.4 zero-allowance, T3.x, commit, PR, merge, or Issue mutation.
- Viewport 1440x900 only if a visible Catalog/admin surface changes. POST-mint 410 is not expected to change CatalogPage.
- Reviewers: grok-4.6 (requested gpt-5.6-luna unavailable; disclose).
- Helper PG 55438 disposable DB only. Never `wiseeff_lane_849`, never compose `5432/wiseeff`.

## Invariant under protection

Every S12-CGH runtime read, write and reference is classified as **canonical current**, **exact canonical history**, or **authorized archived notice**. Product definition library, registration, lifecycle, search/details/counts and publication-facing references do not present `parameter_specs` as the current Catalog Definition. Repair behavior before deleting an allowance. The shared checker records the measured family and total counts; 3513 is the remeasure baseline, not proof that every remaining row is an active production call. Comparison adapters are not switched runtime consumers.

## Intake (measured 2026-09-17)

Allowlist shards currently total **3513**. S12-CGH shard `s12-cgh.json` has **1804** entries:

| Kind | Count | Notes |
| --- | --- | --- |
| Production `server/modules/parameter-specs/**` | 1193 | Dominated by `driverSchemaOverlayRepository.ts` (208), `service.ts` (167), `repository.ts` (114) |
| Tests | 609 | Cutover/reconciliation/overlay integration |
| E2E | 2 | `parameter-import-wizard.acceptance.spec.ts` |
| `parameterAdminClient.ts` | 0 | Already talks Catalog for definitions/registrations/review; `invokeRetiredLegacyWrite` is the 410 helper |

Rules in CGH: `legacy-parameter-spec-identifier` 670, `legacy-catalog-raw-read` 399, `legacy-overlay-catalog-contract` 312, `legacy-catalog-sql-write` 310, `legacy-effective-governance-contract` 65, `legacy-catalog-route` 36, `unresolved-boundary-expression` 11, `legacy-catalog-table-name` 1.

#847 CatalogPage on `/parameter-admin/specs` is the definition workspace when catalog ports are injected. `parameter-catalog-api` owns Catalog read/governance/publication/legacy lookup. Live `registerParameterSpecRoutes` is registered first; `GET/POST /api/v2/parameter-specs*` on that winning router still returns 200/201. Catalog-api isolation tests already 410 list `view=governance` and POST mint; those 410s are **not** the combined-app surface.

Transition doc wants `view=governance` and several mutations **410 immediately**. T2.2-CGH must not 410 the DTS spec-review / activate / **detail governance** path that T2.1 topology depends on (`semanticBindingFixture.ts` GET detail `?view=governance` then POST activate). Draft specs are absent from effective GET/detail.

## Classification freeze

| Class | Meaning in CGH | This todo |
| --- | --- | --- |
| Canonical current — Catalog | `parameter-catalog-api` + CatalogPage: definitions, subjects, registrations, placements, review items, publication | Prove; no second library |
| Canonical current — DTS spec | `parameter_specs` / spec-review-tasks / matcher / overlay coverage used by ingest; **list and detail `view=governance` HTTP**; PATCH/deprecate/restore/reattribute/cutover until TOP | **Keep**. Not Catalog Definitions. T1.4 retires the table, not T2.2-CGH |
| Exact canonical history | Cutover/reconciliation tests, comparison contribution, frozen spec IDs in fixtures | Keep allowances; do not treat as switched consumers |
| Archived notice | Retired **admin-library POST mint** on the winning router | **410** `legacy-surface-retired`, no payload leak |

## Rows

| ID | Dimension | Expected observation | Evidence owner |
| --- | --- | --- | --- |
| T22C-01 | Inventory | Written classification of all 1804 CGH entries by file/rule into **four labels**: canonical-current-catalog, canonical-current-dts-spec, exact-canonical-history, archived-notice. “Three classes” in the invariant means current / history / archived; current is split Catalog vs DTS. No unexplained shard row | receipt table (grouped, not 1804 prose rows) |
| T22C-02 | Catalog current | Registration, definition search/details/counts, publication-facing reads stay on `/api/v2/catalog*` and CatalogPage. No new definition table | existing catalog client + no new page |
| T22C-03 | DTS spec current | `GET /api/v2/parameter-specs` default/effective, **list `view=governance`**, **detail `view=governance`**, spec-review resolve/activate used by ingest remain 2xx. Not advertised as Catalog Definitions | topology/spec-review tests; T2.1 fixture unchanged |
| T22C-04 | Governance view | **List** `view=governance` stays 2xx until T2.2-MOD (live `OrganizationModuleGovernancePanel`). **Detail** `view=governance` stays 2xx as DTS draft-by-id (T2.1). Catalog-api isolation 410 is not the winning router. Do not 410 either query on `registerParameterSpecRoutes` in this todo | focused route tests that governance list/detail are **not** 410 |
| T22C-05 | Competing mint | Admin-library `POST /api/v2/parameter-specs` on the winning router is retired (410 `legacy-surface-retired`, successor `/api/v2/catalog`). **Gone-first** (before auth and body parse): unauthenticated and invalid-body POSTs are 410, not 401/400. Spec-review `createSpec` on `/resolve` stays | route tests distinguish POST mint vs `/resolve`; unauthenticated POST 410 |
| T22C-06 | Overlay | Org driver-schema overlay remains DTS coverage authoring (current until T2.2-MOD / T1.4). Not 410 in this todo | no overlay rewrite |
| T22C-07 | Comparison | `parameterCatalogComparisonContribution.ts` stays a comparison adapter, not a switched runtime consumer | no production read through it |
| T22C-08 | Ratchet | Repair first, then delete only allowances whose token no longer exists. Record CGH count and total vs 3513/1804. No checker weakening, no allowance growth. Honest zero delta after 410 is allowed if remaining SQL stays in the same files | `parameter-catalog-boundaries:check` + shard diff |
| T22C-09 | Archive honesty | 410/404/409 follow transition: archived 410 without payload; unknown 404; no archive id in body | POST-mint route tests |
| T22C-10 | Tests | Update CGH tests that required admin-library create as current. Do not delete coverage by skipping. Do not rewrite tests that require governance list/detail as DTS current | focused `test:server` |
| T22C-11 | UI | Visible Catalog/admin copy only if a 410 surfaces in UI. 1440x900. Mock ≠ acceptance. **API mode injects catalog ports** so CatalogPage is the library; `OrganizationSpecGovernancePanel.createParameterSpec` is mock/no-catalog fallback. Default: no UI sweep for POST-mint 410 | catalog/admin specs only if UI changes |
| T22C-12 | Environment | 55438 disposable or catalog lane 847 with HMAC. Not `wiseeff_lane_849`, not `5432/wiseeff` | receipt |
| T22C-13 | Non-goals | T2.2-TOP…OPS, T1.4 zero-allowance, retiring `parameter_specs` table, Hosted, target, commit | receipt |
| T22C-14 | Lifecycle mutations | PATCH/deprecate/restore/reattribute/rename-property-key/cutover stay 2xx until T2.2-TOP (`parameterTopologyClient` still calls them). Not 410 in CGH | no mutation of those handlers |
| T22C-15 | Mock ports | No CGH mock-port work. Topology mock is T2.2-TOP. Admin client shard rows remain 0 | no mock rewrite |

## Non-goals

- Zeroing 1804 CGH allowances in this todo.
- 410 on DTS spec-review/activate/list used by ingest.
- 410 on list or detail `view=governance` on the winning router.
- 410 on PATCH/deprecate/restore/reattribute/cutover.
- Rewriting overlay repositories, `OrganizationModuleGovernancePanel`, or #847.
- T1.4 production-role denial of all legacy SQL.
- Commit, PR, merge, Hosted, target, Issue mutation.

## Self-review limit

Written by the coordinating implementer. Independent Spec review is required before production edits; this file is not that review.
