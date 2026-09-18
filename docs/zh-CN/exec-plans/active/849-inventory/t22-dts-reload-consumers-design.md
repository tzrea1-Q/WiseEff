# T2.2-DTS reload 消费者 — 可实现设计

> English: [English](../../../../exec-plans/active/849-inventory/t22-dts-reload-consumers-design.md)

配套[威胁矩阵](t22-dts-reload-consumers-threat-matrix.md)。reload 选择／校验／晋升必须钉 canonical binding + property occurrence + config revision。overlay 仅 DTS。不能靠 runtime intercept 掩盖回退 SQL。

状态：**Spec PASS with P2 已收口。** 独立评审 `01a0b01e-21b9-79e1-a8cf-75485959fd8e`。可以实施。

## 1. 本 todo 做什么

给 S12-DTS（54）归类。修：候选 SQL 仍含 `specification_key`／最新 revision 回退，verify 仍可用 spec id 匹配，`pinDtsReloadQueryable` 运行时改写。fail closed。不抢 KNW。

| 缝 | 今日所有者 | T2.2-DTS |
| --- | --- | --- |
| 候选 list/get | coalesce + intercept | **源 SQL 精确 pin；删除 intercept** |
| behavioural verify | binding **或** spec id | **只用 binding id** |
| promote | `createBindingDraft` | 保持；不写配置值 |
| overlay 成员 | `format = 'dts'` | 保持 |
| residue／restore | 已有服务端测试 | 保持 |
| intercept wrap | service／deploy／promote | **删除** |
| HANDOFF/PROMOTE e2e | skip(true) | 本族保持 planned；有单测 |
| Client／mock | dts-reload 路由 | 保持 |
| Jobs／scripts | 分片路径无 | 回执写明无 |

## 2. 归类方法

按 `file`×`rule`。标签：canonical-current-reload、canonical-current-exact-pin、canonical-current-promote、exact-canonical-history、archived-notice。

## 3. Spec PASS 后的修复

**A. `repository.ts`**

`property_key` 只用 `dps.property_key`（**必须** inner join `dts_property_specs`）。`display_name` 为 `coalesce(psv.display_name, dps.property_key)`。locator 子查询 `config_revision_id = br.config_revision_id` 写进源 SQL。删除 `interceptExactReloadPinSql`、`pinDtsReloadQueryable`、`__dtsExactPin`。

**B. `behaviouralVerify.ts`**

只按 `dp.project_parameter_binding_id = b.id` 匹配。去掉 spec id 回退。

**C. 测试**

比较测试改断言执行 SQL。不 unskip Playwright 作为完成门。

**D. 族外**

不改 T2.1 fixture、TOP relocation。不开 T2.2-KNW。

## 4. Ratchet

先 A–C。再跑 checker（trusted-base `9b3ba7df7e21f5589684bc92c872da593ad4c246`）。若 T2.2-TOP `editService.ts` relocation 仍挡住，记录错误，不改写那些 fixture。只删消失的 DTS 条目。回执：DTS 54、总计 3513。留下 intercept 即 Spec 失败（不论 delta）。诚实零仅当 intercept 已删且 checker 被挡住。

## 5. 证据

受影响 `test:server`。`git diff --check`。类型变化则 `tsc -b`。默认无 UI 扫描。独立 Standards+Spec 实现复审。中英回执。55438。

## 6. 顺序

Spec PASS → 精确 SQL + 删 intercept → 比较测试 → checker／分片 → 回执 → 复审 → 停止。不开 T2.2-KNW。不 commit。

## PR 计划

本 todo 不开 PR。
