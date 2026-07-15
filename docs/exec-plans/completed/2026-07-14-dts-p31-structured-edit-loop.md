# DTS 结构化编辑回路闭合（P3.1）Implementation Plan

> **For agentic workers:** 逐任务执行「写失败测试 → FAIL → 实现 → PASS → 提交」。仅在特性分支提交，不开/合 PR。含用户可见前端，前端可见任务须按 `AGENTS.md` 的 playwright-cli 规则做真实浏览器验证并登记验收 ID。
>
> 隶属主计划：[DTS 参数管理结构化重构 · 主计划](2026-07-14-dts-management-program.md)。前置：**P3 已合并**。本计划闭合 P3 遗留的 TD-041（编辑→变更集→提交→回写回路）。

**Goal:** 打通「在浏览器里编辑结构化 DTS 值 → 聚成变更集 → 提交为变更请求 → 经既有审阅/合入 → P1 CST 无损回写」这条端到端回路，并修正回写载荷保真（用 `rawText` 而非 `normalizedValue`）。这是 DTS 管理程序"权威源 + 无损"承诺在**产品交互层**的收口。

**Architecture:**
- **不新建审批体系**：结构化编辑提交**复用现有变更流**——`parameter_drafts` → `parameter_submission_rounds` → `parameter_change_requests` → `reviewChange`（merge）→ `writebackMergedParameterValue`（P1 CST 回写）。见 `server/modules/parameters/service.ts` `reviewChange` L1364 与 `parameter-files/writebackService.ts` L211。
- **身份映射**：结构化节点/属性 → `project_parameter_values` 的 `source_file_name`/`source_node_path`（0041 增列），使变更集行不再落 `unmapped`。回写据此定位文件与 CST 节点。
- **保真**：变更集 `after` 展示可用 `normalizedValue`（对比无假 diff），但**提交回写的载荷用 `rawText`**；`writebackService` 已按 `rawText` 走 `classifyDtsValue`，避免把属性改写成规范化格式。
- **RBAC 复用**：回写路径已接 `assertSensitiveNodeWriteAllowed`（P3）；确认结构化提交路径同样命中（agent+critical 拒绝、critical 需 `parameter:edit-critical`）。

**Tech Stack:** Vite/React + Vitest（前端）、Node/tsx + Vitest（后端）、Playwright（验收）。复用 P1/P2/P3，无新迁移预期（如需仅极少量）。

**Scope:** 结构化编辑提交回路 + 变更集身份映射 + 回写保真 + 前端提交入口。**不含** Git 提交集成、容器化 dtc 沙箱/dt-schema（TD-040 后续）。

**Branch:** `feat/dts-structured-edit-loop`（P3 合并后从最新 `main` 拉出）。

---

## Contracts

- **提交映射**：结构化编辑单元 `{ fileId, nodePath, propertyName, rawText }` → 解析出 `sourceFileName`/`sourceNodePath` → 找到/创建对应 `project_parameter_values` → 建 `parameter_drafts`（`origin='file_sync'` 或新增 `origin='structured'`，二选一，保持既有 CHECK 兼容）→ 走提交轮次。
- **变更集**：一次逻辑改动（跨多节点/多文件）聚为一个提交轮次（`submission_round`）内的多个 CR；对比视图行必须映射到真实 `project_parameter_value`（消除 `unmapped`）。
- **回写载荷**：CR 的 `mergedValue` = 结构化编辑的 `rawText`；`compareBaseline`/差异展示仍用 `normalizedValue`。
- **RBAC**：提交与合入回写均经 `assertSensitiveNodeWriteAllowed`。

---

## File Map

| File | Responsibility |
| --- | --- |
| `server/modules/parameters/service.ts`（增补）| 结构化编辑 → draft/CR 的映射与提交入口（复用现有提交逻辑） |
| `server/modules/parameters/repository.ts`（增补）| 按 `source_file_name`/`source_node_path` 定位/创建 `project_parameter_values` |
| `src/application/ports/DtsStructuredRepository.ts`（增补）| `submitStructuredEdits(...)` 契约 |
| `src/infrastructure/http/dtsStructuredClient.ts` / `mock/...`（增补）| 提交实现（api + mock） |
| `src/components/parameters/StructuredValueEditor.tsx`（改）| 编辑产出 → 变更集 → 「提交变更请求」按钮接线 |
| `src/components/parameters/StructuredDiffView.tsx`（改）| 变更集行映射真实参数，去除 `unmapped` |
| `e2e/acceptance/*`（增补）| `PARAM-DTS-EDIT-*` 验收 |

---

## Git & PR Workflow

- Branch `feat/dts-structured-edit-loop` from latest `main`；开发智能体仅在分支提交；架构师评审/PR/合并/同步。

---

## Task 1: 后端结构化编辑提交映射

**Files:** `service.ts`, `repository.ts` + tests

- [x] **Step 1: 失败测试** — 给定 `{fileId,nodePath,propertyName,rawText}`：解析 `source_file_name/source_node_path` → 定位/创建 `project_parameter_values` → 建 draft → 提交轮次产 CR；`mergedValue` 载荷为 `rawText`；命中敏感规则时按 RBAC 拒绝/放行。
- [x] **Step 2: FAIL** → **Step 3: 实现**（复用现有 draft/submission/review 逻辑，不新建审批）→ **Step 4: PASS** → 提交。

---

## Task 2: 前端 Port + 提交实现

**Files:** `DtsStructuredRepository.ts`, `dtsStructuredClient.ts`, `mockDtsStructuredRepository.ts` + tests

- [x] **Step 1: 失败测试** — `submitStructuredEdits` 契约；mock 模拟提交返回轮次/CR；api 打真实端点。
- [x] **Step 2: FAIL** → **Step 3: 实现** → **Step 4: PASS** → 提交。

---

## Task 3: 编辑器提交接线 + 变更集映射

**Files:** `StructuredValueEditor.tsx`, `StructuredDiffView.tsx` + tests

- [x] **Step 1: 失败测试** — 编辑一个/多个结构化值 → 聚成变更集 → 点「提交变更请求」→ 走 Port 提交；对比视图行映射真实参数（无 `unmapped`）；RBAC 禁用态正确。
- [x] **Step 2: FAIL** → **Step 3: 实现** → **Step 4: PASS** → 提交。**（前端可见）**

---

## Task 4: 端到端 + 验收 + 文档

**Files:** acceptance spec + 文档

- [x] **Step 1: E2E** — 上传结构化 dts → 编辑值 → 提交 → 审阅合入 → CST 回写产生新版本 → 再解析幂等；回写属性为 `rawText` 格式（非规范化改写）。
- [x] **Step 2: 浏览器验证（强制）** — `playwright-cli` 三视口（1440×900/768×1024/390×844）走编辑→提交流程，snapshot+screenshot+console，证据入 `work/ui-checks/`。
- [x] **Step 3:** 文档更新 + 登记 `PARAM-DTS-EDIT-*` → `npm test` + `npm run test:server` + `npm run build` + `npm run acceptance:e2e` + `npm run docs:check` → 提交。（验收 E2E / docs:check 由父智能体 gate）

---

## Verification Matrix

| Check | Command |
| --- | --- |
| 后端提交映射/回写保真 | `npm run test:server -- server/modules/parameters server/modules/parameter-files --run` |
| 前端编辑/提交 | `npm test` |
| Build | `npm run build` |
| 验收 | `npm run acceptance:e2e` + `npm run acceptance:coverage` |
| 浏览器可见性（强制） | `playwright-cli`（三视口，见 Task 4） |
| Docs | `npm run docs:check` |

---

## Documentation Impact Matrix

| Area | Path | Action |
| --- | --- | --- |
| 主计划 | `docs/exec-plans/active/2026-07-14-dts-management-program.md` | Update（P3.1 状态） |
| 前端指南 | `docs/FRONTEND.md` | **Update**（结构化编辑提交回路） |
| API 契约（中英） | `docs/design-docs/api-contract.md` / zh | **Update**（结构化提交端点） |
| 领域模型（中英） | `docs/design-docs/domain-model.md` / zh | Review（结构化编辑 → CR 映射） |
| 技术债 | `docs/exec-plans/tech-debt-tracker.md` | **Update**（关闭 TD-041） |
| 计划登记 | `docs/PLANS.md` / `docs/zh-CN/PLANS.md` | **Update** |

## Documentation Update Gate

移入 `completed/` 前：
- [x] FRONTEND / api-contract（中英）已更新
- [x] TD-041 标记关闭
- [x] `PARAM-DTS-EDIT-*` 验收登记（`acceptance:coverage` 待父智能体 gate）
- [x] playwright-cli 三视口证据已附
- [x] `docs/PLANS.md` 与 `docs/zh-CN/PLANS.md` 一致
- [ ] `npm run docs:check` 通过（父智能体 gate）

---

## Spec Coverage Self-Review（对 TD-041）

| 缺口 | 本期解决 | Task |
| --- | --- | --- |
| 编辑器仅本地预览、不写回 | ✅ 编辑→提交→合入→CST 回写 | 1,2,3,4 |
| 变更集行落 `unmapped`、提交按钮未挂 | ✅ 身份映射 + 提交接线 | 1,3 |
| `targetValue` 用 normalized 影响保真 | ✅ 回写载荷用 `rawText` | 1,4 |
