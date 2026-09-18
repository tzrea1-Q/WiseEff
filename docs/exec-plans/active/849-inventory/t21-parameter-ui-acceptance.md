# T2.1 parameter UI on canonical data — local implementation receipt

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t21-parameter-ui-acceptance.md)

Status: **T2.1 local candidate complete.** Design Spec PASS with P2; implementation Standards PASS with P2; implementation Spec FAIL then PASS with P2 after topology apply staging (grok-4.6; requested gpt-5.6-luna unavailable). Formal SEALED, commit, PR, merge, Hosted, target and Issue updates are not performed.

Contract: [threat matrix](t21-parameter-ui-threat-matrix.md), [design](t21-parameter-ui-design.md), [design Spec review](t21-parameter-ui-spec-review.md), [implementation review](t21-parameter-ui-impl-review.md), #849/#853 T2.1, closed #847.

## Candidate

- Worktree: `/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`
- Branch: `codex/849-853-t11-source-identity`
- HEAD (unchanged): `f9c710f6a90d67462965a06abd47e33aa200e75e`
- Accepted main: `46b6068693942b95f7cba28ee5de6748a97170fa`
- T1.1–T2.4 remain uncommitted dirty work on the same tree. No commit.

## Behaviour delivered

1. Unmatched import rows are `status: "unmatched"`, visible, badge 不会应用, Skip only (no 预填并创建 / 通过). `toSourceItems` excludes them. Parse report: 未匹配（不会应用）.
2. FRONTEND.md / zh-CN tray delete documents `DELETE /api/v2/projects/:projectId/parameter-value-drafts/:draftId`.
3. PARAM-DRAFT-REMOVE-001 retargeted to canonical v2 list/delete; asserts `reason` and `updatedAt` after reload.
4. B5 GET/DELETE unions topology `parameter_drafts` when C4 is empty (typed DTS save still uses `writeTarget.role=base`). Tray survives reload; DELETE v2 removes the topology row.
5. Import preview: unique topology `propertyKey` match is **updated**, not mint/`added`. Unbound names stay **conflict**. Apply stages a topology typed draft (`createBindingDraft`) when C4 pins are absent; catalog rows still use C4 `createCanonicalValueDraft`.
6. #847 CatalogPage is the `/parameter-admin` workspace. Import is the TopBar 打开批量参数导入 control. PARAM-ADMIN-001 / PARAM-REASON-001 retargeted off the retired 参数定义库 region.

## Verification (do not sum)

Helper PG: `postgres://wiseeff:wiseeff@127.0.0.1:55438/…`. Not `wiseeff_lane_849`, not compose `5432/wiseeff`. Playwright webServers on 15173/18787 (do not reuse the other worktree on 5173/8787). Viewport 1440x900.

| Command | Result |
| --- | --- |
| `test:server` `catalogProjectValueRoutes.test.ts` | **20 passed** |
| PARAM-DRAFT-REMOVE-001 | **passed** (10.9s) |
| Unmatched import Playwright | **passed** (5.8s / 5.5s) |
| PARAM-ADMIN-002 five-step + unmatched | **3 passed** (warmup + apply stages `parameter_drafts` + unmatched ineligible) |
| PARAM-ADMIN-001, PARAM-REASON-001 | **passed** after #847 retarget |
| PARAM-REJECT-001 | **passed** |
| parameter-files uploads/lists/syncs + draft conflict | **passed**; rollback skipped |
| PARAM-DRAFT-EDIT | **409** missing-logical-node-revision |
| Catalog lane 847 Playwright | **401** without owned Gate0 HMAC |
| `git diff --check` (T2.1 files) | passed |

Mock ≠ acceptance. T1.3 124×3 was not used as the UI fixture.

## Remaining limits

- Topology stage proof is synthetic (`sourcePinId` overlay/draft id; replay checks `parameter_drafts` existence). No focused `importService` unit test for the C4-else-topology branch.
- v2 DELETE topology fallback is unaudited / not project-scoped (Standards P2).
- `parameterRuntime.refresh` still GET `/api/v1/parameter-drafts/mine`.
- Withdraw/resubmit have no Playwright owner. PARAM-INIT-* stay `future` (T2.2-PRJ / T3.2).
- Catalog archive/404 (#876) not re-proven (lane HMAC).
- Full `parameter-topology` PARAM-HAPPY not re-run this round (only tray remove).
- `new-confirmed` eligibility leftover after removing 预填并创建.

No commit/PR/seal. Next todo T2.2 is not started.
