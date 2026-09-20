# T2.2-PRJ 项目消费者 — 可实现设计

> English: [English](../../../../exec-plans/active/849-inventory/t22-prj-project-consumers-design.md)

配套[威胁矩阵](t22-prj-project-consumers-threat-matrix.md)。`/parameters` tray 已由 T2.1 `createCanonicalDraftTraySource`（v2）注水。`refresh` 仍列 v1 `/parameter-drafts/mine`。初始化 HTTP 已表达项目状态。PARAM-INIT Playwright 留 T3.2。

状态：**独立 Spec 评审 PASS with P2。** P2 已收口。随后按本冻结改生产代码。

## 1. 本 todo 做什么

给 S12-PRJ 归类。修工作台 **活草稿主人**：已知 `projectId` 时 refresh／discard 走 canonical v2 project-value-drafts。保留初始化状态。不 410 v1 GET/DELETE。不抢 FIL。不宣称 PARAM-INIT e2e。

| 缝 | 今日所有者 | T2.2-PRJ |
| --- | --- | --- |
| 工作台参数行 | `semanticParameterReads` `b.id` | 保留 |
| `/parameters` tray | T2.1 canonical tray v2 | 复用 |
| `parameterRuntime.refresh` 草稿 | `listDrafts()` → v1 `/mine` | **按项目 v2 list** |
| `parameterClient.listDrafts(projectId)` | v1 `/mine?projectId=` | **GET v2 `.../parameter-value-drafts`** |
| 带 projectId 的 `deleteDraft` | v1 DELETE | **有 projectId 时 v2 DELETE** |
| semantic `saveDraft` | 409 CONFLICT | 保留 |
| v1 GET/DELETE drafts HTTP | 仍 2xx | 保留（T2.1 helper） |
| 初始化 HTTP | 活 | 保持 2xx |
| PARAM-INIT-* Playwright | `coverage: "future"` | 仍 future（T3.2） |
| Submit `parameterSpecId` | binding 项必填 | 保留（T2.1）；不是行身份 |
| Mock | 内存草稿 | 保留；不铸定义 |
| Jobs/scripts | `s12-prj.json` 路径内无 | 回执写明无；`fileSync*` 归历史，不抢 FIL |

## 2. 归类方法

按 `file`×`rule` 写入回执。四标签：canonical-current-workbench、canonical-current-initialization、canonical-current-dts-spec、exact-canonical-history。仅当客户端离开 v1 mine 导致 token 消失才 archived-notice（预期小／零 delta；`routes.ts` 仍有 v1 字符串）。

## 3. Spec PASS 后的修复

**A. 客户端 list/delete（parameterClient.ts）**

- `listDrafts(projectId)` 非空：`GET /api/v2/projects/:projectId/parameter-value-drafts`。解析 **`projectValueDraftListResponseSchema` / `catalogBindingDraftDtoSchema`**，不用 `workbenchDraftListSchema`。映射：`projectId` 来自路径，`parameterId` ← `bindingId`，`projectParameterBindingId` ← `bindingId`，pin 来自 `effectiveRevisionId`／`currentValueId`。
- 无 projectId 的 `listDrafts()`：保持 v1 `/mine`。
- 端口：`deleteDraft(draftId, projectId?)`。有 projectId 则 v2 DELETE，否则 v1 DELETE。Mock 接受可选第二参。`parameterRuntime.test.ts` 的 `deleteDraft` 带 draft id **和** projectId。
- 不解析 spec-definition body。复用 T2.1 已有 catalog URL。除非 mapper 卡住，不改 `catalogProjectValueRoutes.ts`。

**B. Runtime refresh（parameterRuntime.ts）**

`listProjects()` 之后：`Promise.all(projects.map((p) => api.listDrafts(p.id))).then((g) => g.flat())`。refresh 路径不再无 projectId 调 `listDrafts()`。`discardDrafts` 已有 `projectId`，传入 `deleteDraft`。

**C. 测试**

- `parameterClient.test.ts`：`listDrafts("aurora")` 期望 v2 路径。
- `parameterRuntime.test.ts`：refresh 按项目 id 调 `listDrafts`。
- 无 projectId 的 v1 DELETE 测试保留。

**D. 族外**

不改 T2.1 `semanticBindingFixture.ts`。不 410 v1 草稿路由。不改写 initializationService 的 spec 字段。不改 PARAM-INIT 覆盖图。不开 T2.2-FIL。

## 4. Ratchet

先 A–C。再跑现有 checker（trusted-base `9b3ba7df7e21f5589684bc92c872da593ad4c246`）。若 T2.1／T2.2-TOP relocation 仍挡住，记录精确错误，不改写那些 fixture。只删消失的 PRJ 条目。回执：PRJ 422、总计 3513。允许诚实零 delta。

## 5. 证据

定向 `npm test -- parameterClient.test.ts parameterRuntime.test.ts`。端口／客户端变化则 `tsc -b`。`git diff --check`。仅当工作台草稿表（不只 T2.1 tray）可见变化时才 1440x900。默认不做 UI 扫描。独立 Standards+Spec 实现复审。中英回执。55438。

## 6. 顺序

Spec PASS → 客户端 v2 → refresh 按项目 → checker／分片 → 回执 → 复审 → 停止。不开 T2.2-FIL。不 commit。

## PR 计划

本 todo 不开 PR。

| 步骤 | 标题 | 路径 | 依赖 |
| --- | --- | --- | --- |
| A | 客户端 v2 草稿 | `parameterClient.ts`、测试 | Spec PASS |
| B | Refresh 按项目 | `parameterRuntime.ts`、测试 | A |
| C | 分片 ratchet | 仅当 token 消失时改 `s12-prj.json` | A–B |
| D | 回执 | T2.2-PRJ 文档 | C |
