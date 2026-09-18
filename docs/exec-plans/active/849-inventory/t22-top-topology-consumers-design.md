# T2.2-TOP topology consumers — implementable design

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t22-top-topology-consumers-design.md)

Companion to the [threat matrix](t22-top-topology-consumers-threat-matrix.md). Topology HTTP already owns bindings, occurrence write locks, value drafts and node-enablement drafts. Catalog Definitions stay on #847 CatalogPage. T2.2-CGH already 410s admin spec mint on the winning spec router.

Status: **independent Spec review PASS with P2.** P2s folded here. Production edits follow this freeze.

## 1. What T2.2-TOP is

Classify and bound S12-TOP. Repair remaining seams that (a) still mint ParameterSpecs through the topology port/mock, or (b) let a value draft express structural/`status` enablement. Keep DTS spec-review/activate and binding occurrence locks. Do not rekey `ProjectPropertyBindingKey`. Do not steal T2.2-PRJ workbench `parameterSpecId` removal.

| Seam | Owner today | T2.2-TOP |
| --- | --- | --- |
| Binding/topology/history/compare/validate HTTP | `parameter-topology/routes.ts` | Keep 2xx |
| Value draft | `POST .../parameter-bindings/:bindingId/drafts` | Keep; refuse structural keys |
| Node-enablement draft | `POST .../node-enablement-drafts` | Keep; `status` only |
| Topology client spec mint | `createParameterSpec` → POST `/api/v2/parameter-specs` | **Typed GONE** (server already 410) |
| Mock spec mint | `mockParameterTopologyRepository.createParameterSpec` inserts | **GONE**; no mock-only mint |
| Topology client list/get/review/activate | T2.1 ingest | Keep |
| Topology client PATCH/deprecate/restore/reattribute/cutover | CGH routes still 2xx | **canonical-current-dts-spec until T1.4**, not archived-notice this family. Keep port signatures for `adapterParity`. Do not edit CGH routes |
| Binding identity tuple | `project × node × parameterSpecId × module` | Classify DTS current; **do not rekey** |
| Comparison contribution | adapter | Not a switched consumer |

## 2. Classification method

Do not paste 783 IDs. Group `s12-top.json` by `file` × `rule` in the receipt:

- **canonical-current-topology** — binding/topology/draft/enablement HTTP and editService occurrence lock.
- **canonical-current-dts-spec** — spec list/get/review/activate on the topology port; `parameterSpecId` fields on binding DTOs; ingest matching.
- **exact-canonical-history** — tests, migration, e2e, comparison contribution.
- **archived-notice** — tokens removed because topology mint now GONE (client/mock/tests).

## 3. Repairs after Spec PASS

**A. Value vs node-enablement (editService)**

In `createBindingDraft`, after binding context is loaded, if `isStructuralPropertyKey(binding.property_key)`:

- `status` → `ApiError` CONFLICT, `reason: "structural-status-use-node-enablement"`, message pointing at `POST /api/v2/projects/:projectId/node-enablement-drafts`. No draft row.
- other structural keys (`phandle`, `#address-cells`, …) → CONFLICT `reason: "structural-property-not-value-draft"`. No draft row.

Reuse `isStructuralPropertyKey` from `src/domain/parameter-topology/parameterSurface.ts` (ADR-0003). Do not invent a second structural list.

`createNodeEnablementDraft` stays `propertyKey: "status"` + `editSubjectKind: "node-enablement"`. Do not accept `bindingId` as the owner.

**B. Topology HTTP mint (client)**

`createHttpParameterTopologyRepository.createParameterSpec` throws typed `WiseEffApiError` GONE (`reason: "legacy-surface-retired"`, successor `/api/v2/catalog`, `retryable: false`) **without parsing a 201 spec body** and without a POST-or-map fork. Keep the port method (throws; `adapterParity`). Do not delete `listSpecs`/`activate`/`resolve`. PATCH/deprecate/restore/reattribute/cutover methods stay on the port until T1.4.

**C. Mock port**

`createMockParameterTopologyRepository.createParameterSpec` throws GONE (`legacy-surface-retired`), does not `store.specs.set`. Tests that used mint as fixture setup for `activateParameterSpec` must seed a draft spec from the mock store (e.g. `spec-draft-mystery`) instead of calling `createParameterSpec`. `OrganizationSpecGovernancePanel` mock fallback will show the archived error; do not rewrite that panel this todo (API mode is CatalogPage).

**D. Out of family**

Do not edit `server/modules/parameter-specs/routes.ts`. Do not 410 list/detail governance. Do not churn T2.1 `semanticBindingFixture.ts`.

## 4. Ratchet

1. Implement A–C + tests.
2. Run `npm run parameter-catalog-boundaries:check -- --trusted-base-sha 9b3ba7df7e21f5589684bc92c872da593ad4c246` if it can complete. If T2.1 import-wizard relocation still blocks, record that exact error; do not rewrite T2.1 relocation.
3. Delete only TOP shard entries whose exact token/span is gone. No growth, no checker weakening, no fixture rewrite.
4. Receipt: TOP before **783**, total before **3513**, after counts, delta.

Honest zero delta is allowed when 410/GONE landed and remaining SQL/identifiers stay in family files. Zero delta **and** repairs not landed is a Spec fail.

## 5. Evidence

- Focused `test:server` `editService` / topology `routes` : structural value-draft 409; node-enablement still 201; binding value draft still 201.
- Client test: `createParameterSpec` GONE, not 201.
- Mock test: mint GONE, no inserted spec.
- Existing topology route tests that list bindings / create binding draft / node-enablement still pass.
- `tsc -b` if ports/clients change.
- `git diff --check`.
- Browser: only if a visible control shows GONE. Then 1440x900 once. Default **no UI sweep**.
- Independent Standards + Spec implementation review.
- Bilingual acceptance with classification groups and counts.

Helper PG 55438. Catalog lane 847 401 is not TOP acceptance.

## 6. Order after Spec PASS

1. editService structural refusal + tests.
2. HTTP client mint GONE + tests.
3. Mock mint GONE + tests.
4. Checker / shard ratchet if possible.
5. Receipt classification table.
6. Review; stop. No T2.2-PRJ. No commit.

## PR Plan

This todo does not open a PR.

| Step | Title | Paths | Depends on |
| --- | --- | --- | --- |
| A | Structural vs value draft | `editService.ts`, `editService.test.ts` | Spec PASS |
| B | Topology client mint GONE | `parameterTopologyClient.ts`, client tests | Spec PASS |
| C | Mock mint GONE | `mockParameterTopologyRepository.ts`, mock tests | Spec PASS |
| D | Shard ratchet | `s12-top.json` only if tokens gone | A–C |
| E | Receipt | T2.2-TOP docs | D |
