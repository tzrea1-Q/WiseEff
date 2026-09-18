# T2.1 实现复审

> English: [English](../../../../exec-plans/active/849-inventory/t21-parameter-ui-impl-review.md)

模型：grok-4.6（要求的 gpt-5.6-luna / max 不可用）。与实现者独立。无生产改动、无 commit。

对照 HEAD `f9c710f6a90d67462965a06abd47e33aa200e75e` 的未提交 T2.1 片段。T1.1–T2.4 不在范围内，只作数据面约束。

## Standards

**PASS with P2** — 最重：C4 `NOT_FOUND` 时 v2 托盘 DELETE 落到 topology `deleteDraft`，无 projectId、rowCount、审计（`docs/SECURITY.md` 写审计）。测试只覆盖成功路径。

其他 P2：`reconcileReviewedRows` 复制 `matchToLibrary`；卡片去掉「预填并创建」后仍留 `new-confirmed` / `onConfirmNew`；未匹配徽章复用 `import-review-badge-new`。

## Spec

**先 FAIL 后 PASS with P2。** 第一次独立 Spec：**FAIL**，因为 catalog 为空时把向导已匹配的孤立 topology 行标成 **冲突**。后续：唯一 topology `propertyKey` → `updated`（不铸定义）；有 C4 钉走 C4，否则 `createTopologyBindingDraft`。复审：**PASS with P2**。现场导入向导 **3 passed**。

T21-02 现场托盘：PARAM-DRAFT-REMOVE-001 在 v2 GET/DELETE 上绿，断言 `reason`/`updatedAt`。没有禁止 `/api/v1/parameter-drafts` 的网络断言；`parameterRuntime.refresh` 仍打 v1 mine。T21-12 未匹配 Playwright 绿。T21-09 PARAM-INIT-* 仍是 future。撤回/再提交仍无 Playwright 属主。

## 摘要

Standards：PASS with P2。Spec：先 FAIL 后 PASS with P2。剩余最重 Spec P2：合成 topology 暂存证明；属主是向导现场，不是 `importService` 单测。
