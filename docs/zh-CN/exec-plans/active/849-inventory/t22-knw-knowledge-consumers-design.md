# T2.2-KNW 知识消费者 — 可实现设计

> English: [English](../../../../exec-plans/active/849-inventory/t22-knw-knowledge-consumers-design.md)

配套[威胁矩阵](t22-knw-knowledge-consumers-threat-matrix.md)。新 picker 链接是 canonical current。已存芯片保留。缺失 spec 为 notice-only。他租户 404。不能靠 runtime intercept 把 inner join 改成 LEFT JOIN。

状态：**Spec PASS with P2 已收口。** 独立评审 `01a0b039-d4ae-7730-8244-3dc0c277e5bc`。可以实施。

## 1. 本 todo 做什么

给 S12-KNW（50）归类。修：`parameterReferences.ts` 仍投影 `specification_key` 尾段，源 SQL inner join，`pinK` 运行时改 LEFT JOIN 并叠 mapping。picker fail closed。不抢 MOD。

| 缝 | 今日所有者 | T2.2-KNW |
| --- | --- | --- |
| 按条目加载引用 | inner join + intercept | **源 SQL LEFT JOIN；删除 intercept** |
| property-key 投影 | specification_key 尾段 | **只用 `ps.property_key`／`dps.property_key`** |
| picker | 本组织或平台全局 | 保持可见性；不 wrap；未解析 404 |
| mapping overlay | `db.query` wrap | **查询后显式处理** |
| 空结果合成行 | overlay 注入 | **删除** |
| 跨租户 | `organization_id` | 保持 |
| 比较测试 | intercept helper | 改断言执行 SQL |
| Client／mock | 知识路由 | 保持 |
| Jobs／scripts | 分片路径无 | 回执写明无 |

## 2. 归类方法

按 `file`×`rule`。标签：canonical-current-picker、canonical-current-stored-ref、notice-only-historical、exact-canonical-history、archived-notice。

## 3. Spec PASS 后的修复

**A.** 投影改为 `coalesce(ps.property_key, dps.property_key)`，去掉 `string_to_array(ps.specification_key)`。

**B.** `loadParameterReferencesByEntryIds` 源 SQL **LEFT JOIN** `parameter_specs`。缺失 spec 为 notice-only。

**C.** 彻底删除 `pinK`、`interceptKnowledgeReferenceSql`、`__knwPin`、空结果合成注入。insert／delete／picker 不 wrap。mapping 仅在 **load 查询之后** 显式调用，绝不在 picker／resolve 空结果上。孤儿 `propertyKey`→spec id 仅 notice-only，不是 picker 选择。

**D.** 比较测试改断言 LEFT JOIN 与无 specification_key 回退。保留 org 隔离／404／deprecation 测试。

**E.** 不开 T2.2-MOD。不 410 知识路由。不改写已存引用行。不改 T2.1 fixture／TOP relocation。

## 4. Ratchet

先 A–D。再跑 checker（trusted-base `9b3ba7df7e21f5589684bc92c872da593ad4c246`）。若 T2.2-TOP `editService.ts` relocation 仍挡住，记录错误，不改写那些 fixture。只删消失的 KNW 条目。回执：KNW 50、总计 3513。留下 wrap 即 Spec 失败（不论 delta）。诚实零仅当 wrap 已删且 checker 被挡住。

## 5. 证据

`test:server -- parameterReferences.test.ts parameterCatalogComparisonContribution.test.ts`。`git diff --check`。类型变化则 `tsc -b`。默认无 UI 扫描。独立 Standards+Spec 实现复审。中英回执。55438。

## 6. 顺序

Spec PASS → 精确投影 + LEFT JOIN + 删 wrap → 比较测试 → checker／分片 → 回执 → 复审 → 停止。不开 T2.2-MOD。不 commit。

## PR 计划

本 todo 不开 PR。
