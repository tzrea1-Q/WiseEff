# T2.2-AGT Agent 消费者 — 可实现设计

> English: [English](../../../../exec-plans/active/849-inventory/t22-agt-agent-consumers-design.md)

配套[威胁矩阵](t22-agt-agent-consumers-threat-matrix.md)。Agent catalog 读保持主体范围。参数变更是受批 binding 草稿，不能走 legacy PPV／定义写。

状态：**Spec PASS with P2 已收口。** 独立评审 `01a0afc7-92e3-7393-af5a-442594f0cc6c`。可以实施。

## 1. 本 todo 做什么

给 S12-AGT（30）归类。修：`action.submitParameterChange` 在 identity mode `legacy` 时仍 `submitLegacyParameterChange`，过期 checkpoint／editedArgs 可能复活扁平写。未解析身份 fail closed。不抢 LOG／xiaoze。

| 缝 | 今日所有者 | T2.2-AGT |
| --- | --- | --- |
| Perception | 受保护读、binding pin | 保持 |
| 语义 submit | binding + `createBindingDraft` | 保持 |
| legacy submit | `submitLegacyParameterChange` | **删除**；非 semantic 拒绝 |
| submit `parameterSpecId` | 来自 draft | 保持 |
| 审批／可信调用 | durable session + tool-call + approval | 保持 |
| 结构写工具 | `toolMetadata.ts` 无 | 保持无 |
| 知识草稿 | `createKnowledgeDraft` | 保持；不铸 spec |
| Xiaoze checkpointer | 分片外 | 回执写明；工具层闸门归 AGT |
| 比较贡献 | 适配器 | 保持 |
| Mock／jobs | 分片路径无 | 回执写明无 |

## 2. 归类方法

按 `file`×`rule`。标签：canonical-current-agent-read、canonical-current-agent-draft、exact-canonical-history、archived-notice（消失的 legacy submit token）。

## 3. Spec PASS 后的修复

**A. 删除 legacy Agent 写（`actionTools.ts`）**

删除 `submitLegacyParameterChange`。始终：durable invocation → 非 semantic 则 CONFLICT（不调 `getProjectParameterForUpdate`、不扁平 submit）→ 否则现有 binding 路径。未知 id 仍 NOT_FOUND。不发明 spec id。不包装 `db.query`。不 intercept TOP SQL。

**B. 测试（仅 `actionTools.test.ts`）**

改掉「legacy 扁平提交」用例。新增：identity mode `legacy` → CONFLICT，且不调 legacy 读／submit。保留 invocation／binding submit／DTS 解析／跨项目 404／缺 revision／草稿清理。不清零 14 条 integration sql-write。不改 xiaoze 里未用的 `getProjectParameterForUpdate` mock。e2e 已用 binding id，保持。

**C. 族外**

不改 `xiaoze/**`、`orchestrator.ts`、T2.1 fixture、TOP writeLock。不开 T2.2-LOG。不 410 Agent 工具。

## 4. Ratchet

先 A–B。再跑 checker（trusted-base `9b3ba7df7e21f5589684bc92c872da593ad4c246`）。若 T2.2-TOP `editService.ts` relocation 仍挡住，记录错误，不改写那些 fixture。只删消失的 AGT 条目。回执：AGT 30、总计 3513。修完后仍留 `submitLegacyParameterChange` 即 Spec 失败（不论 delta）。诚实零仅当该函数已删且 checker 被挡住。

## 5. 证据

`test:server -- actionTools.test.ts`（及触及的 integration／registry）。`git diff --check`。类型变化则 `tsc -b`。默认无 UI 扫描。独立 Standards+Spec 实现复审。中英回执。55438。

## 6. 顺序

Spec PASS → 删 legacy 写 + 测试 → checker／分片 → 回执 → 复审 → 停止。不开 T2.2-LOG。不 commit。

## PR 计划

本 todo 不开 PR。

| 步骤 | 标题 | 路径 | 依赖 |
| --- | --- | --- | --- |
| A | 删除 legacy Agent 写 | `actionTools.ts`、测试 | Spec PASS |
| B | 分片 ratchet | 仅当 token 消失时改 `s12-agt.json` | A |
| C | 回执 | T2.2-AGT 文档 | B |
