# T2.2-DBG 调试消费者 — 可实现设计

> English: [English](../../../../exec-plans/active/849-inventory/t22-dbg-debug-consumers-design.md)

配套[威胁矩阵](t22-dbg-debug-consumers-threat-matrix.md)。调试观测保持 overlay。绑定身份精确或 typed-block。不能靠 values intercept 或未绑定 snapshot 刷假 pin。

状态：**Spec PASS with P2 已收口。** 独立评审 `01a0aff9-7f3a-7f81-ad64-4132a6d2e2e6`。可以实施。

## 1. 本 todo 做什么

给 S12-DBG（17）归类。修：(a) `exactDebugOperationValues` 运行时清空猜测 spec 槽；(b) `attachDebugPins`／`insertPinnedNodeOperation` 用 `binding: null` 给每行刷同一 pin。未解析 fail closed。不抢 DTS 晋升。

| 缝 | 今日所有者 | T2.2-DBG |
| --- | --- | --- |
| 设备读写／回滚 | service + 审批 | 保持 overlay |
| definitionId reload | 已 410 | 保持 GONE |
| debug-node admin catalog | `/api/v1/debugging/admin/catalog/*` | 保持 2xx |
| `exactDebugOperationValues` | values intercept | **删除** |
| 列表／操作 pin | 未绑定 snapshot | **存储 binding id 或 typed-block** |
| `insertPinnedNodeOperation` | 拷未绑定 pin.bindingId | **不拷** |
| Catalog 晋升 | 不在本模块 | 回执写明 T2.2-DTS |
| 比较测试 | intercept helper | 改断言 |
| Client／mock | debugging 路由 | 保持；不铸 spec |
| Jobs／scripts | 分片路径无 | 回执写明无 |

## 2. 归类方法

按 `file`×`rule`。标签：canonical-current-debug-overlay、canonical-current-exact-pin、exact-canonical-history、archived-notice。

## 3. Spec PASS 后的修复

**A.** 删除 `exactDebugOperationValues`。不包装 `db.query`，不事后改 insert values。

**B.** 禁止 `readProtectedReference(..., binding: null)`／`DBG_UNBOUND_SNAPSHOT`。`listDebugParameters` 必须 SELECT 存储的 `project_parameter_binding_id`。有则 canonical-pin 该 binding；否则 typed-block `missing-binding`。不从 `parameterDefinitionId` 发明 spec id。`attachDebugPins` 按行。

**C.** `insertPinnedNodeOperation` 不把未绑定 `pin.bindingId` 写入操作。只持久化调用方／存储的 binding。`parameterSpecId` 不得从 definitionId 强转。

**D.** 比较测试删 intercept helper；断言 pin 为 binding-or-block。reload 410 与设备写审批测试保留。

**E.** 不实现 dts-reload 晋升。不 410 debug-node catalog／设备写。不改 T2.1 fixture／TOP relocation／FIL。默认无 UI 扫描。

## 4. Ratchet

先 A–D。再跑 checker（trusted-base `9b3ba7df7e21f5589684bc92c872da593ad4c246`）。若 T2.2-TOP `editService.ts` relocation 仍挡住，记录错误，不改写那些 fixture。只删消失的 DBG 条目。回执：DBG 17、总计 3513。留下 `exactDebugOperationValues` 即 Spec 失败（不论 delta）。诚实零仅当 helper 已删且 checker 被挡住。

## 5. 证据

受影响 `test:server`。`git diff --check`。类型变化则 `tsc -b`。默认无 UI 扫描。独立 Standards+Spec 实现复审。中英回执。55438。

## 6. 顺序

Spec PASS → 删 intercept + 精确／block pin → 比较测试 → checker／分片 → 回执 → 复审 → 停止。不开 T2.2-DTS。不 commit。

## PR 计划

本 todo 不开 PR。
