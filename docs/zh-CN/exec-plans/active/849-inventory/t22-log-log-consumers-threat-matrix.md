# T2.2-LOG 日志消费者 — 实施前威胁矩阵

> English: [English](../../../../exec-plans/active/849-inventory/t22-log-log-consumers-threat-matrix.md)

契约：#849/#853 T2.2-LOG、[API 过渡](../../../design-docs/parameter-catalog-api-transition.md) 日志分析行、T2.2-AGT [回执](t22-agt-agent-consumers-acceptance.md)。产品方向已定。本矩阵冻结 LOG 实施边界。

状态：**Spec PASS with P2 已收口。** 配套：[可实现设计](t22-log-log-consumers-design.md)。独立评审 `01a0afdf-99dd-7840-956c-d3c054c84433`。

## 车道与边界

- 工作树：`/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`，分支 `codex/849-853-t11-source-identity`。
- HEAD `f9c710f6a90d67462965a06abd47e33aa200e75e`。T1.1–T2.2-AGT 脏候选除 LOG 路径外不重写。
- 允许路径：`logs/**`、`LogAnalysisRepository.ts`、`logClient.ts`、`logDtos.ts`、其测试、`log-analysis.acceptance.spec.ts`、分片 `s12-log.json`。不抢 DBG／DTS／KNW／AGT／xiaoze。
- T2.2-LOG 后停止。不开 T2.2-DBG 及之后。不 commit。
- 默认不做 UI 扫描。
- 评审 grok-4.6（gpt-5.6-luna 不可用，须披露）。
- Helper PG 仅 55438。

## 受保护不变量

S12-LOG 每条运行时引用归为 canonical current、精确 canonical 历史或授权归档通知。推荐用 **canonical current binding pin**。历史分析记录不可变。未解析 related id **fail closed**，**不铸定义**。**禁止 `specification_key` 名称回退**，**禁止扫描器可见、运行时再改写的 SQL**。

## 接收（2026-09-17）

分片合计 **3513**。S12-LOG **10** 条：`dbToolBackends.ts` 7（raw-read）、`repository.ts` 2、`domainsRepository.ts` 1。规则：raw-read 7、unresolved 3。

活泄漏：`loadRelatedParameter` **源 SQL** 仍 `coalesce(psv.display_name, dps.property_key, ps.specification_key)`。运行时 `pinLogRelatedParameterQuery` 包装 `db.query`，执行时去掉 `specification_key`，扫描器仍看见回退。与 T2.2-FIL intercept 同类。`related_parameter_id` 已是 binding id。缺 binding → `null`，不铸定义。

## 归类冻结

日志 membership／binding 引用为 canonical current；精确 pin 为 display_name+property_key；测试／e2e 为历史；`specification_key` 回退与 intercept 为归档（删除）。

## 行

T22L-01 10 按 file×rule；T22L-02 源 SQL 无 `ps.specification_key` 名称回退；T22L-03 未解析 fail closed、不铸定义；T22L-04 删除 intercept（related-parameter **和** knowledge 查询都不得包装 `db.query`）；T22L-05 related id 仍是 binding；T22L-06 不改写历史分析 JSON；T22L-07 客户端／mock；T22L-08 比较测试改断言精确 SQL；T22L-09 ratchet 相对 10／3513，留下 intercept 即 Spec 失败（不论 delta）；诚实零仅当 intercept 已删且 checker 被挡住；T22L-10 默认无 UI；T22L-11 55438；T22L-12 非目标。

## 非目标

不清零 10；不 410 日志路由；不从日志证据铸定义；不改写历史分析；不改 T2.1 fixture／TOP relocation；不抢 DBG／AGT／xiaoze；不 commit。

## 自评限制

实现者自写。生产改动前必须独立 Spec 评审。
