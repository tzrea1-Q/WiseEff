# T2.2-TOP 拓扑消费者 — 实施前威胁矩阵

> English: [English](../../../../exec-plans/active/849-inventory/t22-top-topology-consumers-threat-matrix.md)

契约：#849/#853 T2.2-TOP、已关闭 [#847](https://github.com/tzrea1-Q/WiseEff/issues/847)、[API 过渡](../../../design-docs/parameter-catalog-api-transition.md) 拓扑行、[ADR-0003](../../../../adr/0003-node-enablement-is-not-a-parameter.md) 结构键与参数表面、T1.1 source-occurrence、T2.1 [回执](t21-parameter-ui-acceptance.md)、T2.2-CGH [回执](t22-cgh-catalog-governance-acceptance.md)。产品方向（十一族、每条引用归类、先修再收 ratchet、相对 3513 复测）已经决定。本矩阵冻结 TOP 实施边界。

状态：**独立 Spec 评审 PASS with P2。** P2 已收口。配套：[可实现设计](t22-top-topology-consumers-design.md)。

## 车道与边界

- 工作树：`/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`，分支 `codex/849-853-t11-source-identity`。
- 继承 HEAD `f9c710f6a90d67462965a06abd47e33aa200e75e`；已接受 main `46b6068693942b95f7cba28ee5de6748a97170fa`。T1.1–T2.2-CGH 仍是未提交脏候选；除 TOP 归属路径外不重写。
- 风险 **R2**。独立 Spec 评审通过后才改生产代码。
- T2.2-TOP 本地交付后停止。不做 T2.2-PRJ 及之后、T1.4 清零 allowance、T3.x、commit、PR、合并或 Issue 变更。
- 仅当拓扑／后台可见表面变化时才做 1440x900。默认：只改 HTTP／客户端／mock 错误则不做 UI 扫描。
- 评审模型 grok-4.6（要求的 gpt-5.6-luna 不可用，须披露）。
- Helper PG 仅 55438。不用 `wiseeff_lane_849`，不用 compose `5432/wiseeff`。优先 `wiseeff_t22_cgh` 或新建 `wiseeff_t22_top`。

## 受保护不变量

S12-TOP 的每条运行时读／写／引用归为 **canonical current**、**精确 canonical 历史** 或 **授权归档通知**。拓扑拥有 **项目 binding 与 source-occurrence 写锁**，不是 Catalog Definition。值草稿不表达节点启用／`status`。节点启用草稿不写业务参数值。先修行为再删 allowance。3513 是复测基线。比较适配器不是已切换运行时消费者。

## 接收（2026-09-17 实测）

分片合计仍 **3513**。S12-TOP **783** 条：生产 292（`migration.ts` 125、`bindingService.ts` 58、`editService.ts` 26）、测试 350、E2E 83、`parameterTopologyClient.ts` 33、端口 1、mock 分片 0 行（但 mock 仍会铸定义）。

规则：`legacy-parameter-spec-identifier` 310、`legacy-catalog-raw-read` 156、`legacy-catalog-sql-write` 122、`legacy-catalog-route` 82、`unresolved-boundary-expression` 56、`legacy-effective-governance-contract` 22、`legacy-catalog-table-name` 17、`legacy-catalog-module-import` 15、`legacy-overlay-catalog-contract` 3。

T2.2-CGH 已对获胜 `POST /api/v2/parameter-specs` 先 gone 410。PATCH／deprecate／restore／reattribute／cutover 在 CGH 路由仍 2xx。T2.1 仍用 spec-review `/resolve`、详情 `view=governance`、activate、拓扑 `createBindingDraft`。cutover 后草稿已按 `project_parameter_binding_id` + `writeLock.propertyOccurrenceId`。Binding 身份元组仍是 `project × logicalNode × parameterSpecId × module`；**本 todo 不重键**（T1.1／T1.4）。

`createBindingDraft` 未调用 `isStructuralPropertyKey`。对 `status` binding 走值草稿会绕过节点启用。`createNodeEnablementDraft` 已写死 `propertyKey: "status"` 与 `editSubjectKind: "node-enablement"`。

## 归类冻结

| 类 | TOP 含义 | 本 todo |
| --- | --- | --- |
| Canonical current — topology | binding／拓扑／校验／值草稿／节点启用／identity-mapping | **保持 2xx** |
| Canonical current — DTS spec via topology client | list/get/review/activate，T2.1 ingest | **保留**。不是 Catalog Definition |
| 精确 canonical 历史 | 测试、migration、e2e、比较贡献 | 保留 allowance |
| 归档通知 | 拓扑 HTTP／mock **铸定义**（`createParameterSpec`） | 类型化 **410/GONE** `legacy-surface-retired`；mock 不得铸定义 |

## 行

T22T-01 清单 783 按 file×rule 四个标签；T22T-02 拓扑 HTTP 保持 2xx；T22T-03 DTS 经拓扑客户端保留，不改 T2.1 fixture；T22T-04 拓扑客户端铸定义类型化 GONE；T22T-05 mock 铸定义抛 GONE，不插入 spec；T22T-06 PATCH／生命周期保持到 T1.4，不改 CGH `parameter-specs/routes.ts`；T22T-07 值草稿拒绝结构键（status → 409 指向节点启用；其它结构键 409）；T22T-08 节点启用只写 `status`；T22T-09 草稿主人仍是 binding id + occurrence 锁，不重键 `ProjectPropertyBindingKey`；T22T-10 比较适配器不切换；T22T-11 先修再删 allowance，相对 783／3513；诚实零 delta 允许；T22T-12 仅可见 GONE 才 1440x900；T22T-13 55438；T22T-14 非目标。

## 非目标

不清零 783 条；不重键 binding 身份；不从工作台删除 `parameterSpecId`（T2.2-PRJ）；不 410 CGH PATCH／governance 列表／详情；不 410 T2.1 用的 spec-review／activate；不改 overlay／CatalogPage／ingest；不 commit。

## 自评限制

实现者自写。生产改动前必须独立 Spec 评审。
