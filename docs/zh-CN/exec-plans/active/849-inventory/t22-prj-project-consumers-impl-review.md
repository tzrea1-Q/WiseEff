# T2.2-PRJ 实现复审

> English: [English](../../../../exec-plans/active/849-inventory/t22-prj-project-consumers-impl-review.md)

模型：grok-4.6（要求的 gpt-5.6-luna 不可用）
对未提交 T2.2-PRJ 草稿主人改动的独立 Standards 与 Spec。评审者未写代码。不 commit、不开 T2.2-FIL、不 SEAL。

HEAD `f9c710f6a90d67462965a06abd47e33aa200e75e`。

## Standards

结论：**PASS with P2**

范围限于六个命名文件。v2 list 用 catalog schema。`parameterId` ← `bindingId`。v1 GET/DELETE 仍是回退。

P2：无 projectId 的 `listDrafts()` 缺客户端测试；双项目 refresh 未断言扇出；mock applyImportBatch 仍无 projectId 调 listDrafts。

## Spec

结论：**PASS with P2**

refresh 按项目走 v2。未 410 v1 DELETE。PARAM-INIT 仍 future。未改 T2.1 fixture。88 组／422。诚实零 delta。checker 被 T2.2-TOP editService blob 挡住（允许）。

可以报告本地候选。不把 T2.2-PRJ 标 SEALED／已提交。
