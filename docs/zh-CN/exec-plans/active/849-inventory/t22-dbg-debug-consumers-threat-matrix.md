# T2.2-DBG 调试消费者 — 实施前威胁矩阵

> English: [English](../../../../exec-plans/active/849-inventory/t22-dbg-debug-consumers-threat-matrix.md)

契约：#849/#853 T2.2-DBG、[API 过渡](../../../design-docs/parameter-catalog-api-transition.md) 节点／设备调试行、T2.2-LOG [回执](t22-log-log-consumers-acceptance.md)。产品方向已定。本矩阵冻结 DBG 实施边界。

状态：**Spec PASS with P2 已收口。** 配套：[可实现设计](t22-dbg-debug-consumers-design.md)。独立评审 `01a0aff9-7f3a-7f81-ad64-4132a6d2e2e6`。

## 车道与边界

- 工作树：`/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`，分支 `codex/849-853-t11-source-identity`。
- HEAD `f9c710f6a90d67462965a06abd47e33aa200e75e`。T1.1–T2.2-LOG 脏候选除 DBG 路径外不重写。
- 允许路径：`debugging/**`、`DebuggingGateway.ts`、`debuggingClient.ts`、`debuggingDtos.ts`、其测试、`debugging-admin.acceptance.spec.ts`、分片 `s12-dbg.json`。不抢 DTS-reload／AGT／LOG／FIL／xiaoze。
- T2.2-DBG 后停止。不开 T2.2-DTS 及之后。不 commit。
- 默认不做 UI 扫描。
- 评审 grok-4.6（gpt-5.6-luna 不可用，须披露）。
- Helper PG 仅 55438。

## 受保护不变量

S12-DBG 每条运行时引用归为 canonical current、精确 canonical 历史或授权归档通知。调试观测是 **操作 overlay**，**不得改定义库**。绑定身份要么精确（`project_parameter_binding_id`）要么 typed-block。未解析 fail closed。受批晋升成配置值走 **canonical draft**（若路径在 dts-reload 则归 T2.2-DTS）。设备写审批不变。禁止 values intercept。

## 接收（2026-09-17）

分片合计 **3513**。S12-DBG **17** 条：`repository.ts` 10、`catalogSplitRepository.ts` 4、`routes.ts` 2（debug-node admin catalog，不是 parameter-specs）、`service.test.ts` 1。规则：unresolved 12、identifier 3、catalog-route 2。

活泄漏：`exactDebugOperationValues` 运行时把猜测 spec 槽改成 null；`attachDebugPins`／`insertPinnedNodeOperation` 用 `binding: null` 的未绑定 snapshot 给每一行刷同一 pin。`writeNode` 的 definitionId reload 已 410，保持 GONE。本模块无 catalog 晋升。

## 归类冻结

设备写／debug-node catalog 为 overlay；精确 pin 为存储的 binding id 或 typed-block；测试为历史；values intercept／reload-definition 为归档。

## 行

T22D-01 17 按 file×rule；T22D-02 overlay 不铸 spec；T22D-03 精确 pin 或 typed-block，不用未绑定 snapshot 刷全表；T22D-04 删除 `exactDebugOperationValues`；T22D-05 insert 不拷未绑定 pin；T22D-06 reload 保持 410；T22D-07 晋升归 DTS；T22D-08 审批不变；T22D-09 debug-node catalog 保持 2xx；T22D-10 ratchet 相对 17／3513，留下 intercept 即 Spec 失败（不论 delta）；T22D-11 默认无 UI；T22D-12 55438；T22D-13 非目标。

## 非目标

不清零 17；不 410 设备写／debug-node catalog；不实现 DTS 晋升；不改审批；不 commit。

## 自评限制

实现者自写。生产改动前必须独立 Spec 评审。
