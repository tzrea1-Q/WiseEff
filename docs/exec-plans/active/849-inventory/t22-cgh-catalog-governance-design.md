# T2.2-CGH catalog/governance consumers — implementable design

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t22-cgh-catalog-governance-design.md)

Companion to the [threat matrix](t22-cgh-catalog-governance-threat-matrix.md). #847 workspace and `parameter-catalog-api` are reused. DTS `parameter_specs` matching is not reopened as a Catalog Definition store.

Status: **independent Spec re-review PASS with P2.** P2s folded here. Production edits follow this freeze.

## 0. Spec FAIL fold (do not re-open as 410)

Independent Spec review `01a0aeec-4759-7333-9c1f-517ee277ca54` **FAIL**. P1: 410ing **detail** `GET /api/v2/parameter-specs/:specId?view=governance` breaks T2.1 `semanticBindingFixture.ts` (draft-by-id after spec-review `createSpec`, then activate). Effective detail 404s drafts. This revision freezes a successor: **keep detail governance as canonical-current-dts-spec**. Do not invent `lifecycle=draft` and do not churn T2.1.

Confirmed on this tree: bare `POST /api/v2/parameter-specs` is **not** spec-review `createSpec`. `createSpec` is `POST /api/v2/parameter-spec-review-tasks/:taskId/resolve`. Bare-POST 410 remains the mint cut.

## 1. What T2.2-CGH is

Classify and bound the S12-CGH family. Repair the remaining **product** seams that still present spec-table identity as the current Catalog Definition. Keep DTS spec-review as the occurrence-matching owner until T1.4. Retire only allowances whose tokens disappear. Record the measured count.

| Seam | Owner today | T2.2-CGH change |
| --- | --- | --- |
| Definition library UI | #847 CatalogPage `/parameter-admin/specs` via `CatalogOrganizationSurface` when catalog ports exist | Reuse. `OrganizationSpecGovernancePanel` is mock/no-catalog fallback only |
| Catalog HTTP | `parameter-catalog-api` | Reuse |
| Admin client Catalog calls | `parameterAdminClient` (0 shard rows) | Reuse; prove `invokeRetiredLegacyWrite` still 410 |
| `GET /api/v2/parameter-specs` effective/list | DTS spec matching | Keep |
| `GET /api/v2/parameter-specs?view=governance` **list** | Competing product list **and** live MOD picker | **Keep 2xx** as canonical-current-dts-spec until T2.2-MOD. Live API caller: `OrganizationModuleGovernancePanel.listLibrarySpecs`. Catalog-api isolation already 410s this shape; the winning `registerParameterSpecRoutes` still 200s. Do not 410 the winning list handler in CGH |
| `GET /api/v2/parameter-specs/:specId?view=governance` **detail** | T2.1 ingest draft-by-id | **Keep 2xx** as canonical-current-dts-spec. Not a Catalog Definition detail |
| Undocumented list `view=raw` / `mode=raw` | catalog-api isolation already 410s | If the winning parameter-specs list parser accepts them, 410 those query modes only. `listParameterSpecsQuerySchema` currently allows only `effective\|governance`; extra keys are stripped. No new raw parser |
| `POST /api/v2/parameter-specs` admin mint | still 201 on the winning router | **410** `legacy-surface-retired` successor `/api/v2/catalog` |
| Spec-review `createSpec` | `POST .../parameter-spec-review-tasks/:taskId/resolve` | Keep |
| Activate | T2.1 ingest | Keep |
| PATCH / deprecate / restore / reattribute / rename-property-key / version cutover / property-key cutover | `parameterTopologyClient` (T2.2-TOP) | **Keep 2xx** until T2.2-TOP. Transition “410 immediately” is deferred; over-applying would break T2.1/TOP. Not a second Catalog mint |
| Overlay GET/POST | DTS coverage | Keep; classify as current DTS (T22C-06) |
| Comparison contribution | adapter | Not a switched consumer |
| Topology / Catalog mocks | T2.2-TOP | **None in CGH.** Admin client already 0 shard rows |

## 2. Classification method

Do not paste 1804 IDs. Group `s12-cgh.json` by `file` × `rule` and assign one class per group in the acceptance receipt:

- **canonical-current-catalog** — Catalog API / CatalogPage only (expected empty in the shard).
- **canonical-current-dts-spec** — production `parameter-specs` service/repository/routes/overlay/matcher/reviewApply used by ingest; **list and detail `view=governance` HTTP**; lifecycle/cutover mutations until TOP.
- **exact-canonical-history** — `*.test.ts`, cutover/reconciliation, comparison contribution.
- **archived-notice** — tokens removed because the winning **POST mint** now 410s.

E2E import-wizard two rows stay history/test unless the tokens vanish from a T2.1-related string (do not churn T2.1).

## 3. HTTP repairs

Use existing `catalogLegacyGoneResult` / `CatalogLegacyGoneResponse` / `reason: "legacy-surface-retired"` / successor `/api/v2/catalog` from `parameter-catalog-api/legacy/gone.ts`. Do not invent a parallel error. `registerParameterSpecRoutes` is registered before catalog-api; equal-static first-match keeps the parameter-specs handler. Catalog-api isolation 410s are **not** this surface. T2.2-CGH 410s the **winning** POST mint handler.

**410 in this todo**

- Winning `POST /api/v2/parameter-specs` (admin definition-library mint). **Gone-first:** return `catalogLegacyGoneResult(request.requestId, LEGACY_WRITE_GONE_MESSAGE)` before `requireDb`, `getCurrentAuthContext` / `requireCanAdmin`, and `createParameterSpecBodySchema`. Unauthenticated and invalid-body POSTs are 410, not 401/400. Isolation catalog-api 410s already behave this way.
- Winning list handler only if query `view=raw` or `mode=raw` is actually accepted (today it is not; do not add a parser to 410 it).

**Keep 2xx**

- `GET /api/v2/parameter-specs` default/effective **and** `view=governance` list.
- `GET /api/v2/parameter-specs/:specId` default/effective **and** `view=governance` detail.
- Spec-review task list/resolve (`createSpec: true` stays on `/resolve`).
- Spec activate used by ingest.
- Overlay GET/POST (T22C-06).
- PATCH, deprecate, restore, reattribute, rename-property-key, version cutover, property-key cutover.

Do not rewrite `OrganizationModuleGovernancePanel` or `OrganizationSpecGovernancePanel` in this todo. Mapping Catalog definitions onto `ParameterSpecLibraryRow` is a T2.2-MOD adapter, not a CGH mint cut.

## 4. Ratchet

1. Implement POST-mint 410 + tests (red/green on route tests that today assert 201 for bare create).
2. Run `npm run parameter-catalog-boundaries:check` with the existing trusted-base contract (do not invent flags).
3. Delete only CGH shard entries whose exact token/span is gone. No growth, no checker weakening, no fixture rewrite.
4. Receipt: CGH before **1804**, total before **3513**, after counts, delta.

A zero delta is **allowed** after 410 when the same file still contains other honest legacy SQL/identifiers. A zero delta **and** 410 not landed is a Spec fail. Expect a small delta on `routes.ts` / tests around the mint POST, not 1804.

## 5. Evidence

- Focused `test:server` on `parameter-specs` routes (or equivalent): POST mint 410 vs kept 2xx for effective list, governance list, governance detail, review resolve, activate.
- Catalog client `invokeRetiredLegacyWrite` still 410.
- `parameter-catalog-boundaries:check` exact counts.
- `git diff --check`. `npm run build` if shared types/routes change.
- Browser: only if Catalog/admin UI shows the new 410. Then 1440x900 once. **API mode injects catalog ports**, so `/parameter-admin/specs` is CatalogPage and does not POST mint. `OrganizationSpecGovernancePanel.createParameterSpec` is the mock/no-catalog fallback; if that fallback is hit without catalog ports, POST mint 410 is the archived notice, not a CatalogPage change. Default: **no UI sweep**.
- Independent Standards + Spec implementation review.
- Bilingual acceptance receipt with classification groups and counts.

Helper PG 55438. Catalog lane 847 only if HMAC is supplied; 401 is not CGH acceptance.

## 6. Order after Spec PASS

1. Winning POST-mint 410 + tests.
2. Update tests that required admin-library create as current (not review `createSpec`).
3. Checker; shard ratchet.
4. Classification table in the receipt.
5. Review; stop. No T2.2-TOP, no list/detail governance 410, no overlay 410, no commit.

## PR Plan

This todo does not open a PR.

| Step | Title | Paths | Depends on |
| --- | --- | --- | --- |
| A | Admin-mint POST 410 | `parameter-specs/routes.ts`, tests (`parameterSpecHttpAdapter.test.ts` and any create-201 owner) | Spec PASS |
| B | Shard ratchet | `s12-cgh.json` only if tokens gone | A |
| C | Receipt + classification | T2.2-CGH docs | B |
