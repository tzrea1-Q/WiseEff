# T2.2-FIL 文件消费者 — 可实现设计

> English: [English](../../../../exec-plans/active/849-inventory/t22-fil-file-consumers-design.md)

配套[威胁矩阵](t22-fil-file-consumers-threat-matrix.md)。文件 membership 保留。同步匹配与写回必须钉 binding + property occurrence，不能靠 specification_key 回退。

状态：**Spec PASS with P2 已收口。** 独立评审 `01a0afa4-6152-77c2-947b-87f66c9304aa`。可以实施。

## 1. 本 todo 做什么

给 S12-FIL（56）归类。修：(a) `findBindingBySource` 源 SQL 仍含 property-key `split_part` 回退，运行时 intercept；(b) 写回／冲突把 `parameterDefinitionId` 当成 `parameterSpecId`。未解析身份 fail closed。不抢 AGT。

| 缝 | 今日所有者 | T2.2-FIL |
| --- | --- | --- |
| Config-set／version／candidate／baseline／export | parameter-files | 保持 2xx |
| `findBindingBySource` | coalesce + `pinP` intercept | **源 SQL 用精确 `dps.property_key`；删除 intercept** |
| 写回 overlay | `parameterSpecId ?? parameterDefinitionId` | **不强转**；从锁定 binding 取必填 spec id |
| 写回源 SQL | `pinW` 运行时改 left→inner | **源 SQL inner join；删除 wrap** |
| 冲突插入 | semantic 同样强转 | **不强转** |
| `syncService` 语义冲突 | 只传 definitionId | **从 binding 匹配传 `parameterSpecId`** |
| 文件 HTTP 客户端 | `/api/v1/projects/:id/parameter-files*` | 保留 |
| Mock | 内存文件 | 保留；不铸定义 |
| 比较贡献 | intercept 测试 | 改为精确 SQL 断言 |
| Jobs/scripts | 分片路径无 | 回执写明无 |

## 2. 归类方法

按 `file`×`rule`。标签：canonical-current-files、canonical-current-exact-pin、exact-canonical-history、archived-notice（消失的 split_part／intercept token）。

## 3. Spec PASS 后的修复

**A. 精确 pin（`syncIdentity.ts`）**

两处 `coalesce(dps.property_key, split_part(ps.specification_key, '/', 2)…)` 改为 `dps.property_key`。保留 locator+file-version 匹配。删除 `pinP`、`__filExactPin`、`interceptExactPropertyPinSql`。`findBindingBySource` 不得包装 `db.query`。

测试：现有 locator 匹配仍过；新增缺 `dts_property_specs.property_key` → `null`；执行 SQL 不得含 `split_part(ps.specification_key`。

**B. 写回（`writebackService.ts`）**

`applyLockedOverlayWriteback` 必填 `parameterSpecId`。不要 `input.parameterSpecId ?? input.parameterDefinitionId`。从锁定 binding 的 `parameter_spec_id` 读取，缺则 fail closed。写回源 SQL 的 `dts_property_specs` 改为 inner join。删除 `pinW`／`interceptExactWritebackSourceSql`。

**C. 冲突（`conflictService.ts`）与同步（`syncService.ts`）**

semantic 模式不要用 `parameterDefinitionId` 填 `parameterSpecId`。只传 `input.parameterSpecId`（可选）。binding id 仍可用 `projectParameterBindingId ?? projectParameterValueId`（该字段已是 binding id 时）；不发明 spec id。语义同步必须从 binding 匹配传 `parameterSpecId`。

**D. 比较测试**

删掉 `interceptExactPropertyPinSql` 测试；断言 `findBindingBySource` 执行 SQL 无 specification_key 回退。

**E. 族外**

不改 T2.1 `semanticBindingFixture.ts`。不开 T2.2-AGT。不 410 文件路由。

## 4. Ratchet

先 A–D。再跑 checker（trusted-base `9b3ba7df7e21f5589684bc92c872da593ad4c246`）。若 T2.2-TOP `editService.ts` relocation 仍挡住，记录错误，不改写那些 fixture。只删消失的 FIL 条目。回执：FIL 56、总计 3513。源 SQL 仍含 split_part 回退则 Spec 失败。

## 5. 证据

`test:server -- syncIdentity.test.ts`（及触及的 writeback／conflict）。`git diff --check`。类型变化则 `tsc -b`。默认无 UI 扫描。独立 Standards+Spec 实现复审。中英回执。55438。

## 6. 顺序

Spec PASS → 精确 SQL + 删 intercept → 写回／冲突不强转 → 比较测试 → checker／分片 → 回执 → 复审 → 停止。不开 T2.2-AGT。不 commit。

## PR 计划

本 todo 不开 PR。

| 步骤 | 标题 | 路径 | 依赖 |
| --- | --- | --- | --- |
| A | 精确 pin SQL | `syncIdentity.ts`、测试 | Spec PASS |
| B | 写回／冲突身份 | writeback／conflict、测试 | Spec PASS |
| C | 比较测试 | contribution 测试 | A |
| D | 分片 ratchet | 仅当 token 消失时改 `s12-fil.json` | A–C |
| E | 回执 | T2.2-FIL 文档 | D |
