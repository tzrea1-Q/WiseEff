# T2.2-TOP topology consumers — pre-implementation threat matrix

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t22-top-topology-consumers-threat-matrix.md)

Contract: #849/#853 T2.2-TOP, closed [#847](https://github.com/tzrea1-Q/WiseEff/issues/847), [API transition](../../../design-docs/parameter-catalog-api-transition.md) topology row, [ADR-0003](../../../adr/0003-node-enablement-is-not-a-parameter.md) structural vs parameter surface, T1.1 source-occurrence identity, T2.1 [acceptance](t21-parameter-ui-acceptance.md), T2.2-CGH [acceptance](t22-cgh-catalog-governance-acceptance.md). Product direction (eleven families, classify every reference, repair then ratchet, measured reduction vs 3513) is already decided. This matrix freezes the TOP implementation boundary.

Status: **independent Spec review PASS with P2.** P2s folded here. Companion: [implementable design](t22-top-topology-consumers-design.md).

## Lane and boundaries

- Worktree: `/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`, branch `codex/849-853-t11-source-identity`.
- Inherited HEAD `f9c710f6a90d67462965a06abd47e33aa200e75e`; accepted main `46b6068693942b95f7cba28ee5de6748a97170fa`. T1.1–T2.2-CGH remain uncommitted dirty candidates and are not rewritten except TOP-owned paths.
- Risk **R2** (topology HTTP, binding/occurrence identity, draft subject kind). Independent Spec review precedes production edits.
- Stop after T2.2-TOP local delivery. No T2.2-PRJ or later, T1.4 zero-allowance, T3.x, commit, PR, merge, or Issue mutation.
- Viewport 1440x900 only if a visible topology/admin surface changes. Default: no UI sweep if only HTTP/client/mock errors change.
- Reviewers: grok-4.6 (requested gpt-5.6-luna unavailable; disclose).
- Helper PG 55438 disposable DB only. Never `wiseeff_lane_849`, never compose `5432/wiseeff`. Prefer `wiseeff_t22_cgh` or a new `wiseeff_t22_top` on 55438.

## Invariant under protection

Every S12-TOP runtime read, write and reference is classified as **canonical current**, **exact canonical history**, or **authorized archived notice**. Topology owns **project bindings and source-occurrence write locks**, not Catalog Definitions. Value drafts (`POST .../parameter-bindings/:bindingId/drafts`) do not express node-enablement/`status`. Node-enablement drafts (`POST .../node-enablement-drafts`) do not write business parameter values. Repair behavior before deleting an allowance. 3513 is the remeasure baseline. Comparison adapters are not switched runtime consumers.

## Intake (measured 2026-09-17)

Allowlist shards still total **3513**. S12-TOP shard `s12-top.json` has **783** entries:

| Kind | Count | Notes |
| --- | --- | --- |
| Production `server/modules/parameter-topology/**` | 292 | Dominated by `migration.ts` (125), `bindingService.ts` (58), `editService.ts` (26) |
| Tests | 350 | migration/postCutover/editService/client |
| E2E | 83 | `parameter-topology.acceptance.spec.ts` |
| `parameterTopologyClient.ts` | 33 | Still POSTs mint `/api/v2/parameter-specs` (CGH 410) |
| `ParameterTopologyRepository.ts` | 1 | Port still includes spec create/lifecycle |
| Mock `mockParameterTopologyRepository.ts` | 0 shard rows | Still **mints** specs in mock; todolist requires mock ports in-family |

Rules in TOP: `legacy-parameter-spec-identifier` 310, `legacy-catalog-raw-read` 156, `legacy-catalog-sql-write` 122, `legacy-catalog-route` 82, `unresolved-boundary-expression` 56, `legacy-effective-governance-contract` 22, `legacy-catalog-table-name` 17, `legacy-catalog-module-import` 15, `legacy-overlay-catalog-contract` 3.

T2.2-CGH already 410s winning `POST /api/v2/parameter-specs` gone-first. PATCH/deprecate/restore/reattribute/cutover remain 2xx on CGH routes. T2.1 still uses spec-review `/resolve` + detail `view=governance` + activate + topology `createBindingDraft`. Post-cutover drafts already key on `project_parameter_binding_id` with `writeLock.propertyOccurrenceId`. Binding **identity tuple** is still `project × logicalNode × parameterSpecId × module` (`bindingService.ts`); rekeying that tuple is **not** this todo (T1.1/T1.4).

`createBindingDraft` does not call `isStructuralPropertyKey`. A value draft on a `status` binding would bypass node-enablement. `createNodeEnablementDraft` already hardcodes `propertyKey: "status"` and `editSubjectKind: "node-enablement"`.

## Classification freeze

| Class | Meaning in TOP | This todo |
| --- | --- | --- |
| Canonical current — topology | Bindings, history/compare, topology tree, validate, value drafts, node-enablement drafts, identity-mapping tasks | **Keep 2xx**. Occurrence lock stays |
| Canonical current — DTS spec via topology client | `listSpecs`/`getSpec`/`listSpecReviewTasks`/`resolveSpecReviewTask`/`activateParameterSpec` used by T2.1 ingest | **Keep**. Not Catalog Definitions. T1.4 retires spec table |
| Exact canonical history | `*.test.ts`, `migration.ts` tests, e2e fixtures, comparison contribution | Keep allowances |
| Archived notice | Topology HTTP/mock **definition mint** (`createParameterSpec`) | Typed **410/GONE** `legacy-surface-retired`; mock must not mint |

## Rows

| ID | Dimension | Expected observation | Evidence owner |
| --- | --- | --- | --- |
| T22T-01 | Inventory | 783 TOP entries classified by file×rule into four labels. No unexplained shard row | receipt table (grouped) |
| T22T-02 | Topology current | Binding/topology/validate/history/compare/value-draft/node-enablement HTTP stay 2xx | focused `test:server` topology routes |
| T22T-03 | DTS via topology | Client `listSpecs`/`getSpec`/`resolve`/`activate` stay callable; T2.1 fixture unchurned | no edit to `semanticBindingFixture.ts` |
| T22T-04 | Competing mint on topology client | `createHttpParameterTopologyRepository.createParameterSpec` surfaces typed GONE (`legacy-surface-retired`, successor `/api/v2/catalog`), does not parse a 201 body | client tests |
| T22T-05 | Mock port | `mockParameterTopologyRepository.createParameterSpec` throws GONE, does not insert a spec. No mock-only governance mint | mock tests |
| T22T-06 | Spec lifecycle on topology client | PATCH/deprecate/restore/reattribute/cutover **stay** as DTS until T1.4. Do not 410 CGH `parameter-specs` routes from this family | no `parameter-specs/routes.ts` edits |
| T22T-07 | Value vs structural | `createBindingDraft` refuses `isStructuralPropertyKey` (status → 409 pointing at node-enablement; other structural keys 409 not a value draft) | `editService` tests |
| T22T-08 | Node-enablement scope | Node-enablement drafts write only `status` on a logical node; not a binding value draft | existing enablement tests plus T22T-07 |
| T22T-09 | Occurrence ownership | Post-cutover draft owner remains `project_parameter_binding_id` + occurrence write lock. Do not rekey `ProjectPropertyBindingKey`. `parameterSpecId` on DTOs is DTS current, not Catalog Definition | no binding-key rewrite |
| T22T-10 | Comparison | `parameterCatalogComparisonContribution.ts` stays an adapter | no production read through it |
| T22T-11 | Ratchet | Repair first; delete only vanished TOP tokens. Record vs 783/3513. Honest zero delta allowed if tokens remain in family files. No checker weakening | shard + checker if it can run |
| T22T-12 | UI | 1440x900 only if visible surface shows the new GONE. Mock ≠ acceptance. Default: no sweep | catalog/admin/topology specs only if UI changes |
| T22T-13 | Environment | 55438 disposable. Not `wiseeff_lane_849`, not `5432/wiseeff` | receipt |
| T22T-14 | Non-goals | T2.2-PRJ…OPS, T1.4, workbench `parameterSpecId` removal (PRJ), Hosted, target, commit | receipt |

## Non-goals

- Zeroing 783 TOP allowances.
- Rekeying bindings off `parameterSpecId` (T1.4 / leftover identity).
- Removing `parameterSpecId` from the project workbench (T2.2-PRJ).
- 410 on CGH PATCH/deprecate/list/detail governance.
- 410 on spec-review/activate used by T2.1.
- Rewriting overlay, CatalogPage, or ingest matching.
- Commit, PR, merge, Hosted, target, Issue mutation.

## Self-review limit

Written by the coordinating implementer. Independent Spec review is required before production edits; this file is not that review.
