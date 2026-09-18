# T2.1 design Spec review

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t21-parameter-ui-spec-review.md)

Model: grok-4.6 (requested gpt-5.6-luna / max unavailable)
Verdict: **PASS with P2**

Independent Spec review of [t21-parameter-ui-design.md](t21-parameter-ui-design.md) and [t21-parameter-ui-threat-matrix.md](t21-parameter-ui-threat-matrix.md). Reviewer did not write the design. No production edits, commit, or T2.1 completion. Chinese twins spot-checked: decision parity holds.

## P1

None. Implementation may start; fold the P2s below with the first commits.

## P2

1. **Initialization evidence owner.** Todolist T2.1: “registration, initialization and honest empty/error states.” T21-09 names “existing negative/init spec.” Independent check: `PARAM-INIT-*` in `operationMatrix.ts` are `coverage: "future"` (coverage map Blocking: No); no Playwright owner. Design §5 “Add only the missing live B5 case and unmatched-import assertions” would skip them. Name a T2.1 Playwright owner **or** an explicit deferral to T2.2-PRJ / T3.2. Do not claim an existing init spec.

2. **Unmatched-import locators.** Todolist: “Remove misleading unmatched-import preview outcomes through the existing governed observation/authoring path.” Spot-check: `matchToLibrary` sets unmatched rows `status: "pending"` with no `existingParameter` (test: “pending new candidates”). The minting UI is `ImportReviewCard` (`pending && !existingParameter` → 预填并创建), `new-confirmed`, `toSourceItems` (sends approved/new-confirmed), StepParseReport 「新增候选」, and StepRowReview `RESOLVED_STATUSES`. `isEligibleImportItem` keys off batch `added`/`updated`, not row status. A new `unmatched` status falling through the card `default` would show Approve. Point wizard copy at those seams; keep unmatched visible and disabled. `reconcileReviewedRows` currently rematches unresolved rows to `pending`.

3. **T21-02 `updatedAt`.** Matrix: reload shows the draft with `reason` and `updatedAt`. Design §4 step 5: `reason` visible; no invented `parameterId`. Align the Playwright case with the matrix. Existing `PARAM-DRAFT-REMOVE-001` still waits on `DELETE /api/v1/parameter-drafts/` after a canonical POST draft — retarget as specified.

## Checked and accepted

- #847 is closed. `CatalogPage` on `/parameter-admin/specs` is the workspace. Remaining decision-6 editor fields (`schemaDefault`, editable constraints, editor examples) are not T2.1 unless they block the operation list.
- B5: `createCanonicalDraftTraySource` lists/deletes `GET|DELETE /api/v2/projects/:projectId/parameter-value-drafts`. `ParametersPage` injects it in API mode. Unit tests forbid `/api/v1/parameter-drafts`. Live browser proof is the named gap.
- `docs/FRONTEND.md` and `docs/zh-CN/frontend.md` still document tray delete as `DELETE /api/v1/parameter-drafts/:draftId`.
- Data plane: existing disposable post-cutover runtime; not T1.3 124×3 in Gate0; mock ≠ acceptance; 1440x900; helper PG 55438, not `wiseeff_lane_849`.
- Reuse existing Playwright owners; no second workbench; no T2.2/T1.4/T3.x; this todo does not open a PR.
- T21-10 JSON fallback via parameter-files + pointer edit is acceptable when the disposable fixture has no ConfigurationSchema binding.
- Chinese twins match (unmatched ineligible, B5 live tray, #847 reuse, T21 rows, stop boundary).

Start implementation against design §3–§5 and matrix T21-01…T21-18. Fold P2s in the same docs pass or first implementation commits.
