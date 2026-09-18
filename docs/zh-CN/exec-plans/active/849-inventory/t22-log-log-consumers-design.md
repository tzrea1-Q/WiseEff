# T2.2-LOG 日志消费者 — 可实现设计

> English: [English](../../../../exec-plans/active/849-inventory/t22-log-log-consumers-design.md)

配套[威胁矩阵](t22-log-log-consumers-threat-matrix.md)。日志推荐必须钉 canonical current binding。历史分析记录保留。不能靠运行时 intercept 掩盖 `specification_key` 回退。

状态：**Spec PASS with P2 已收口。** 独立评审 `01a0afdf-99dd-7840-956c-d3c054c84433`。可以实施。

## 1. 本 todo 做什么

给 S12-LOG（10）归类。修：`loadRelatedParameter` 源 SQL 仍 `coalesce(..., ps.specification_key)`，运行时 intercept。未解析 related id fail closed。不抢 DBG。

| 缝 | 今日所有者 | T2.2-LOG |
| --- | --- | --- |
| 上传／run／record／domain | repository／domainsRepository | 保持；related id 是 binding |
| `loadRelatedParameter` | coalesce + intercept | **源 SQL 精确 pin；删除 intercept** |
| 未解析 related id | 返回 `null` | 保持 fail closed；不铸定义 |
| 历史分析记录 | 已存 run／evidence | 不可变 |
| HTTP／DTO／mock | 日志路由 | 保持；不铸 spec |
| 比较贡献 | intercept 测试 | 改为精确 SQL 断言 |
| Jobs／scripts | 分片路径无 | 回执写明无 |

## 2. 归类方法

按 `file`×`rule`。标签：canonical-current-logs、canonical-current-exact-pin、exact-canonical-history、archived-notice（消失的 specification_key／intercept token）。

## 3. Spec PASS 后的修复

**A. 精确 pin（`dbToolBackends.ts`）**

`coalesce(psv.display_name, dps.property_key, ps.specification_key)` 改为 `coalesce(psv.display_name, dps.property_key)`。保留组织范围 binding 查找。删除 `pinLogRelatedParameterQuery`、`interceptExactRelatedParameterSql`。不得包装 `db.query`。不发明 spec id。

**B. 测试**

删掉 `interceptExactRelatedParameterSql` 测试；断言执行 SQL 无 `ps.specification_key` 名称回退。`dbToolBackends.test.ts` 必须证明 related-parameter **和** knowledge 查询都走原始 `query`（现有 `db.query === query` 挡不住新建 wrap）。保留缺行返回 `null`。

**C. 族外**

不改 T2.1 fixture、TOP relocation、AGT／xiaoze、DBG／DTS／KNW。不 410 日志路由。不改写已存分析 JSON。

## 4. Ratchet

先 A–B。再跑 checker（trusted-base `9b3ba7df7e21f5589684bc92c872da593ad4c246`）。若 T2.2-TOP `editService.ts` relocation 仍挡住，记录错误，不改写那些 fixture。只删消失的 LOG 条目。回执：LOG 10、总计 3513。修完后仍留 intercept／源 SQL specification_key 名称回退即 Spec 失败（不论 delta）。诚实零仅当 intercept 已删且 checker 被挡住。

## 5. 证据

`test:server -- dbToolBackends.test.ts parameterCatalogComparisonContribution.test.ts`。`git diff --check`。类型变化则 `tsc -b`。默认无 UI 扫描。独立 Standards+Spec 实现复审。中英回执。55438。

## 6. 顺序

Spec PASS → 精确 SQL + 删 intercept → 比较测试 → checker／分片 → 回执 → 复审 → 停止。不开 T2.2-DBG。不 commit。

## PR 计划

本 todo 不开 PR。

| 步骤 | 标题 | 路径 | 依赖 |
| --- | --- | --- | --- |
| A | 精确 pin SQL | `dbToolBackends.ts`、测试 | Spec PASS |
| B | 分片 ratchet | 仅当 token 消失时改 `s12-log.json` | A |
| C | 回执 | T2.2-LOG 文档 | B |
