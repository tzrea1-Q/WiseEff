# T2.1 parameter UI on canonical data — implementable design

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t21-parameter-ui-design.md)

Companion to the [threat matrix](t21-parameter-ui-threat-matrix.md). #847, B5 wiring, and existing Playwright owners are reused. Product questions already closed by ADR-0046 and T1.3 are not reopened.

Status: **design Spec PASS with P2 (grok-4.6).** Implementation local candidate complete: [acceptance](t21-parameter-ui-acceptance.md). No commit.

## 1. What T2.1 is

T2.1 is **integration and live evidence** of the parameter UI on canonical Catalog data, plus two honesty repairs (B5 live tray, unmatched import preview). It is not a new workbench and not T2.2.

| Seam | Owner today | T2.1 change |
| --- | --- | --- |
| Definition workspace | #847 `CatalogPage` on `/parameter-admin/specs` | Reuse; no second workspace |
| Draft tray list/delete | `createCanonicalDraftTraySource` | Prove **live** after typed save + reload; keep unit tests |
| Typed edit / submit / review | `ApiProjectTopologyWorkspace`, `ParameterReviewPage`, `CanonicalProjectValueReviewPanel` | Exercise on disposable post-cutover canonical fixtures; fill gaps found |
| Import preview | `matchToLibrary` + wizard | Unmatched rows are ineligible, not “pending new” |
| FRONTEND.md | stale v1 tray DELETE | Document canonical v2 list/delete |
| Browser | existing `e2e/acceptance/parameter-*.spec.ts` | Extend, do not replace Gate0 |

## 2. Data plane

Use the **existing disposable post-cutover acceptance runtime** (canonical identity, real API, real PostgreSQL, 1440x900). That is canonical data for T2.1.

Do **not** require T1.3’s 124×3 materialize inside Gate0. T1.3 remains seed evidence. If a JSON ConfigurationSchema binding is absent from the disposable fixture, T21-10 JSON is proven by the existing JSON source/file path (parameter-files + pointer edit) rather than by inventing a 372-row UI database.

Mock mode is not T2.1 acceptance.

## 3. Unmatched import (T21-12)

Today `matchToLibrary` sets unmatched rows to `status: "pending"` without `existingParameter`, and tests call that “pending new candidates”. On canonical Catalog, import cannot mint a Definition.

Specified behavior:

- Unmatched rows get an explicit ineligible status (for example `unmatched` / not selectable), copy that they will not apply, and `isEligibleImportItem` returns false.
- Apply of a selection that includes only unmatched rows stages **zero** drafts and creates **zero** Definitions.
- The user is pointed at the governed observation/authoring path (workbench typed edit on a matched binding, or Admin definition workspace), not at “import will create the parameter”.

Do not silently drop unmatched rows from the preview table; hiding them is also misleading. Show them disabled.

## 4. B5 live tray (T21-02)

Keep `createCanonicalDraftTraySource`. Add a Playwright case (or extend topology/parameters) that:

1. Signs in as a parameter editor at 1440x900.
2. Opens `/parameters` for the disposable project.
3. Creates a typed canonical draft with a reason.
4. Reloads the page.
5. Asserts the tray lists that draft (`reason` visible; no invented `parameterId`).
6. Removes it from the tray; reload; it is gone.
7. Network: `GET`/`DELETE` `/api/v2/projects/.../parameter-value-drafts`; no `/api/v1/parameter-drafts`.

If that path already exists in a spec, retarget it onto canonical URLs and record the operation id. Do not add a second tray.

## 5. Operation coverage

Map T2.1 verbs onto **existing** operation IDs in `e2e/acceptance/operationMatrix.ts` / coverage map. Run the owning specs against this candidate’s disposable runtime:

- topology: create/edit, source diff, history, compare, DTS writeback
- parameters: submit, reject, withdraw, resubmit, actor separation
- catalog: #847 search/filter/pagination/counts
- files: baseline, export, reimport
- import wizard: after T21-12
- negative: archived notice, 404

Add only the missing live B5 case and unmatched-import assertions. Do not duplicate a full S1 suite (T3.1).

## 6. Docs

Update English/Chinese `FRONTEND.md` tray-delete sentence to the canonical v2 route. Do not rewrite the workbench chapter.

## 7. Evidence

- Focused frontend tests for `matchToLibrary` / wizard eligibility
- Existing + extended Playwright at 1440x900 with real API (Gate0 disposable runtime)
- `npm test` for touched UI files, `npm run build`, `npm run ui:check` if styling/copy, `git diff --check`
- Screenshots only for changed appearance/layout; interaction-only B5 can use operation evidence without a gallery
- Console/network in the spec diagnostics helper
- Independent Standards + Spec implementation review
- Bilingual acceptance receipt

Helper PG 55438 only if extra server tests are needed. Not `wiseeff_lane_849`.

## 8. Implementation order (after Spec PASS)

1. Unmatched import status + wizard copy + tests.
2. FRONTEND.md B5 URL honesty.
3. B5 live Playwright case.
4. Run owning parameter acceptance specs at 1440x900; fix regressions found.
5. Independent implementation review; bilingual receipt; stop.

## PR Plan

This todo does not open a PR.

| Step | Title | Paths | Depends on |
| --- | --- | --- | --- |
| A | Unmatched import honesty | `matchToLibrary`, wizard, tests | Spec PASS |
| B | FRONTEND.md B5 URLs | FRONTEND.md + zh-CN | Spec PASS |
| C | B5 live tray acceptance | e2e parameter topology/parameters | A |
| D | Run owning specs; receipts | acceptance + T2.1 docs | C |
