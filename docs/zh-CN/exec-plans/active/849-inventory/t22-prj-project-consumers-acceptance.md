# T2.2-PRJ 项目消费者 — 本地实施回执

> English: [English](../../../../exec-plans/active/849-inventory/t22-prj-project-consumers-acceptance.md)

状态：**T2.2-PRJ 本地候选完成。** 设计 Spec PASS with P2；实现 Standards PASS with P2；实现 Spec PASS with P2。不做 SEALED、commit、PR、合并、Hosted、target 或 Issue 更新。

契约：[威胁矩阵](t22-prj-project-consumers-threat-matrix.md)、[设计](t22-prj-project-consumers-design.md)、[设计 Spec 评审](t22-prj-project-consumers-spec-review.md)、[实现复审](t22-prj-project-consumers-impl-review.md)。

## 已交付

`listDrafts(projectId)` 走 v2 project-value-drafts，`parameterId` ← `bindingId`。带 projectId 的 `deleteDraft` 走 v2，否则 v1。`refresh` 按项目拉草稿。`saveDraft` semantic 仍 CONFLICT。初始化 HTTP 未改。PARAM-INIT Playwright 仍 future。S12-PRJ 路径无 jobs/scripts。

## 归类

422 条、88 组，表见 [英文分类](../../../../exec-plans/active/849-inventory/t22-prj-project-consumers-classification.md)。workbench 212、initialization 27、dts-spec 2、history 181、archived-notice 0。

## Ratchet

422→422，3513→3513。checker 未跑完（T2.2-TOP `editService.ts` relocation blob）。

## 验证

`parameterClient`+`parameterRuntime` **33 passed**；mock **25 passed**；`tsc -b` 通过；`git diff --check` 通过。无 UI 扫描。

## 剩余

v1 mine／DELETE 仍挂着；submit 仍要 `parameterSpecId`；PARAM-INIT e2e 属 T3.2。无 projectId 的 `listDrafts()` 缺专项客户端测试；双项目 refresh 测试未断言 `listDrafts` 扇出。Mock `applyImportBatch` 仍无 projectId 调 `listDrafts()`。无 T2.2-FIL，无 commit。
