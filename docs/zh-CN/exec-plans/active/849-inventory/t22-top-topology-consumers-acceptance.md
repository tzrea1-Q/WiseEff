# T2.2-TOP 拓扑消费者 — 本地实施回执

> English: [English](../../../../exec-plans/active/849-inventory/t22-top-topology-consumers-acceptance.md)

状态：**T2.2-TOP 本地候选完成。** 设计 Spec PASS with P2；实现 Standards PASS with P2；实现 Spec PASS with P2（grok-4.6；要求的 gpt-5.6-luna 不可用）。不做 SEALED、commit、PR、合并、Hosted、target 或 Issue 更新。

契约：[威胁矩阵](t22-top-topology-consumers-threat-matrix.md)、[设计](t22-top-topology-consumers-design.md)、[设计 Spec 评审](t22-top-topology-consumers-spec-review.md)、[实现复审](t22-top-topology-consumers-impl-review.md)。

## 候选

- 工作树：`/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`
- 分支：`codex/849-853-t11-source-identity`
- HEAD（未变）：`f9c710f6a90d67462965a06abd47e33aa200e75e`
- 已接受 main：`46b6068693942b95f7cba28ee5de6748a97170fa`
- T1.1–T2.2-CGH 仍是未提交脏工作。无 commit。

## 已交付行为

1. `createBindingDraft` 拒绝结构键：`status` → 409 `structural-status-use-node-enablement`（successor 节点启用路由）；其它结构键 → 409 `structural-property-not-value-draft`。不写草稿行。
2. 拓扑 HTTP `createParameterSpec` 抛类型化 GONE，不 fetch、不解析 201。
3. Mock `createParameterSpec` 同样 GONE，不插入 spec。Activate 后继测试用 `spec-draft-mystery`。
4. 拓扑 binding／历史／比较／校验／值草稿／节点启用保持 2xx。不改 CGH PATCH。不重键 binding 元组。

## 归类（T22T-01）

S12-TOP 仍 **783** 条，**80** 个 file×rule 组。**0 未解释。** 四个标签：canonical-current-topology 167、canonical-current-dts-spec 34、exact-canonical-history 582、archived-notice 0。完整 80 组表见 [英文分类表](../../../../exec-plans/active/849-inventory/t22-top-topology-consumers-classification.md)（路径与 rule 不翻译）。

## Ratchet（T22T-11）

TOP 783→783，总计 3513→3513，delta 0。诚实零 delta：修复已落地，端口上仍有 `createParameterSpec` 标识符。未改分片。

`parameter-catalog-boundaries:check` **未跑完**：`editService.ts` relocation 目标 blob 不匹配。未改写 relocation fixture。

## 验证（不要加总）

Helper PG `127.0.0.1:55438/wiseeff_t22_cgh`。`editService.test.ts` **32 passed**；topology `routes.test.ts` **22 passed**；客户端+mock **54 passed**；`tsc -b` 通过；`git diff --check` 通过。无 UI 扫描。

## 剩余限制

Binding 身份元组仍含 `parameterSpecId`（T1.4）；工作台 `parameterSpecId` 删除属 T2.2-PRJ；拓扑客户端 PATCH／生命周期留到 T1.4；列表 governance 留到 T2.2-MOD；checker 被本 todo 的 `editService.ts` relocation blob 挡住。无 T2.2-PRJ，无 commit。
