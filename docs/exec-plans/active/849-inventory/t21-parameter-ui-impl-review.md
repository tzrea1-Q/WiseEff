# T2.1 implementation review

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t21-parameter-ui-impl-review.md)

Model: grok-4.6 (requested gpt-5.6-luna / max unavailable). Independent of the implementer. No edits, no commit.

Two-axis review of uncommitted T2.1 hunks against HEAD `f9c710f6a90d67462965a06abd47e33aa200e75e`. T1.1–T2.4 out of scope except as the data plane.

## Standards

**PASS with P2** — worst: v2 tray DELETE on C4 `NOT_FOUND` falls through to topology `deleteDraft` without project-id scope, rowCount, or audit (`docs/SECURITY.md` write-audit). Happy-path list/delete tests only.

Other P2s: `reconcileReviewedRows` duplicates `matchToLibrary`; `new-confirmed` / `onConfirmNew` remain after the card dropped 预填并创建; unmatched badge reuses `import-review-badge-new`.

## Spec

**FAIL then PASS with P2.** First independent Spec: **FAIL** because catalog-empty preview marked a wizard-matched isolated topology row **冲突**. Follow-up: unique topology `propertyKey` → `updated` (not mint); apply uses C4 when pins exist, else `createTopologyBindingDraft`. Re-review: **PASS with P2**. Live import wizard **3 passed**.

T21-02 live tray: PARAM-DRAFT-REMOVE-001 green on v2 GET/DELETE with `reason`/`updatedAt`. No network assert forbidding `/api/v1/parameter-drafts`; `parameterRuntime.refresh` still lists v1 mine. T21-12 unmatched Playwright green. T21-09 PARAM-INIT-* stay future. Withdraw/resubmit still have no Playwright owner.

## Summary

Standards: PASS with P2. Spec: FAIL then PASS with P2. Worst remaining Spec P2: synthetic topology stage proof; wizard is the owner, not an `importService` unit test.
