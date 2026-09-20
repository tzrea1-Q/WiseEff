# T2.2-DTS reload 消费者 — 实施前威胁矩阵

> English: [English](../../../../exec-plans/active/849-inventory/t22-dts-reload-consumers-threat-matrix.md)

契约：#849/#853 T2.2-DTS、[API 过渡](../../../design-docs/parameter-catalog-api-transition.md) DTS reload 行、T2.2-DBG [回执](t22-dbg-debug-consumers-acceptance.md)。产品方向已定。本矩阵冻结 DTS 实施边界。

状态：**Spec PASS with P2 已收口。** 配套：[可实现设计](t22-dts-reload-consumers-design.md)。独立评审 `01a0b01e-21b9-79e1-a8cf-75485959fd8e`。

## 车道与边界

- 工作树：`/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`，分支 `codex/849-853-t11-source-identity`。
- HEAD `f9c710f6a90d67462965a06abd47e33aa200e75e`。T1.1–T2.2-DBG 脏候选除 DTS 路径外不重写。
- 允许路径：`server/modules/dts-reload/**`、`DtsReloadRepository.ts`、`dtsReloadClient.ts`、其测试、`dts-reload-deploy.acceptance.spec.ts`、分片 `s12-dts.json`。handoff／promote e2e 可归类。不抢 KNW／MOD／OPS／DBG／AGT／xiaoze。
- T2.2-DTS 后停止。不开 T2.2-KNW 及之后。不 commit。
- 默认不做 UI 扫描。
- 评审 grok-4.6（gpt-5.6-luna 不可用，须披露）。
- Helper PG 仅 55438。

## 受保护不变量

S12-DTS 每条运行时引用归为 canonical current、精确 canonical 历史或授权归档通知。候选／校验／晋升钉 **binding + 精确 property_key + 钉住的 config revision**。未解析 fail closed。晋升只建 **canonical draft**，不写配置库值。overlay 成员仅 DTS。禁止扫描器可见、运行时再改写的 SQL。

## 接收（2026-09-18）

分片合计 **3513**。S12-DTS **54** 条：`repository.ts` 18、`behaviouralVerify.ts` 3、测试 29、e2e 4。规则：raw-read 25、sql-write 24、identifier 3、unresolved 2。

活泄漏：候选 SQL 仍 `specification_key` 回退与最新 revision locator；verify 仍可用 spec id 匹配 debug 节点。运行时 `pinDtsReloadQueryable` 包装 `db.query`。与 FIL/LOG intercept 同类。overlay 已 `format='dts'`。promote 已走 `createBindingDraft`。HANDOFF/PROMOTE Playwright 仍 skip（有单测）。

## 归类冻结

reload 流程为 canonical current；精确 pin 为 property_key + config revision + binding-only verify；promote 为 draft；测试为历史；intercept／specification_key／spec-id 回退为归档。

## 行

T22R-01 54 按 file×rule；T22R-02 源 SQL 只用 `dps.property_key`；T22R-03 locator 钉 config revision；T22R-04 删除 intercept；T22R-05 verify 只按 binding id；T22R-06 promote 只建草稿；T22R-07 overlay 仅 dts；T22R-08 Playwright 本族不作为完成门；T22R-09 ratchet 相对 54／3513，留下 intercept 即 Spec 失败（不论 delta）；T22R-10 默认无 UI；T22R-11 55438；T22R-12 非目标。

## 非目标

不清零 54；不以 unskip Playwright 为完成门；晋升不写配置值；overlay 不含软件 JSON；不 commit。

## 自评限制

实现者自写。生产改动前必须独立 Spec 评审。
