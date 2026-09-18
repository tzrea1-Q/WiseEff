# T2.2-KNW 知识消费者 — 实施前威胁矩阵

> English: [English](../../../../exec-plans/active/849-inventory/t22-knw-knowledge-consumers-threat-matrix.md)

契约：#849/#853 T2.2-KNW、[API 过渡](../../../design-docs/parameter-catalog-api-transition.md) 知识定义选择器行、T2.2-DTS [回执](t22-dts-reload-consumers-acceptance.md)。产品方向已定。本矩阵冻结 KNW 实施边界。

状态：**Spec PASS with P2 已收口。** 配套：[可实现设计](t22-knw-knowledge-consumers-design.md)。独立评审 `01a0b039-d4ae-7730-8244-3dc0c277e5bc`。

## 车道与边界

- 工作树：`/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`，分支 `codex/849-853-t11-source-identity`。
- HEAD `f9c710f6a90d67462965a06abd47e33aa200e75e`。T1.1–T2.2-DTS 脏候选除 KNW 路径外不重写。
- 允许路径：`server/modules/knowledge/**`、`KnowledgeRepository.ts`、`knowledgeClient.ts`、`src/features/knowledge/**`、其测试、`knowledge.acceptance.spec.ts`、分片 `s12-knw.json`。不抢 MOD／OPS／AGT／LOG。
- T2.2-KNW 后停止。不开 T2.2-MOD 及之后。不 commit。
- 默认不做 UI 扫描。
- 评审 grok-4.6（gpt-5.6-luna 不可用，须披露）。
- Helper PG 仅 55438。

## 受保护不变量

S12-KNW 每条运行时引用归为 canonical current、精确 canonical 历史或授权归档通知。新选择是 canonical current（本组织或平台全局 spec）。已存引用行保留。缺失／退役 spec **notice-only**，不可选。其他租户 spec **404**。禁止扫描器可见 inner join、运行时改 LEFT JOIN。禁止 `specification_key` property-key 回退。

## 接收（2026-09-18）

分片合计 **3513**。S12-KNW **50** 条：`parameterReferences.ts` 16、routes 3、repository／logDomainRetrieval 4、客户端 1、测试／e2e 26。规则：raw-read 14、sql-write 14、catalog-route 12、identifier 5、unresolved 5。

活泄漏：投影仍 `string_to_array(ps.specification_key)`。load-by-entry 源 SQL inner join。运行时 `pinK` 把 inner 改 LEFT JOIN 并叠 `lookupLegacyIdentifier`。空结果可注入合成行。与 FIL/LOG/DTS intercept 同类。引用 CRUD 已按 `organization_id`；picker 已 404 他租户。

## 归类冻结

picker 为 canonical current；已存引用 LEFT JOIN；缺失 spec 为 notice-only；测试为历史；`pinK`／specification_key 为归档。

## 行

T22K-01 50 按 file×rule；T22K-02 投影无 specification_key 回退；T22K-03 load LEFT JOIN 源 SQL；T22K-04 删除 intercept／合成注入；T22K-05 picker 未解析不可选；T22K-06 跨租户不披露；T22K-07 不改写已存引用行；T22K-08 mapping 显式查询后处理；T22K-09 ratchet 相对 50／3513，留下 wrap 即 Spec 失败；T22K-10 默认无 UI；T22K-11 55438；T22K-12 非目标。

## 非目标

不清零 50；不 410 知识路由；不因 deprecation 删引用；picker 不选未解析 id；不 commit。

## 自评限制

实现者自写。生产改动前必须独立 Spec 评审。
