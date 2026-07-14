# DTS 产品功能闭环（P3）Implementation Plan

> **For agentic workers:** 逐任务执行「写失败测试 → FAIL → 实现 → PASS → 提交」。仅在特性分支提交，不开/合 PR。本期含**用户可见前端**，凡前端可见任务必须按 `AGENTS.md` 的 playwright-cli 规则做真实浏览器验证并登记验收 ID。
>
> 隶属主计划：[DTS 参数管理结构化重构 · 主计划](2026-07-14-dts-management-program.md)。前置：**P2 已合并**（配置集/基线/门禁/导出后端 + `server/modules/dts/` 解析子域 + `dts_nodes/dts_properties/dts_phandle_refs`）。背景见[现状评估](../../design-docs/2026-07-14-dts-parameter-management-assessment.md)。

**Goal:** 把 P1/P2 的结构化能力**暴露为产品闭环**：结构化值编辑器、结构化变更集/差异、结构化检索、真实影响分析、节点级/风险分层 RBAC。让开发者在 WiseEff 里**显性、结构化地**管理 DTS 参数，而不再面对扁平键值与纯文本 diff。

**Architecture:**
- **打通结构化读取 seam（当前最大缺口）**：`dts_nodes/dts_properties/dts_phandle_refs` 已落库但**无 HTTP、无前端**。P3 先补结构化读取 API + 前端 Port/mock/api 两套实现（修正 TD-039 前端仍消费扁平 `parsed_index` 的现状）。
- **前端 Port 化**：现有 `ProjectParameterFilesPanel`/`ParameterFileConflictPanel` **绕过 Port 直接 new client**（TD-039）。P3 新增能力一律走 `application/ports` + `infrastructure/http` + `infrastructure/mock`，并接入 `runtimeMode`，保证 mock 演示/组件测试可用。
- **影响分析升级**：现 `ChangeRequest.impact` 为后端模板化 2 项（`repository.ts toChangeRequestDto`）。P3 基于 phandle / compatible / 配置集变体推导真实影响面，写入 `impact`。
- **节点级 RBAC（无先例，新建）**：安全关键节点（regulator/thermal/限流等）编辑需提升权限；约束 Agent（小择）对安全关键节点的写操作。

**Tech Stack:** Vite/React + Vitest（前端）、Node/tsx + PostgreSQL（后端）、Playwright（e2e/acceptance）。复用 P1/P2：`server/modules/dts/`、P2 配置集/基线/门禁/导出路由。

**Scope:** 结构化读取 API + 前端结构化编辑/差异/检索/影响/RBAC UI + 节点级授权 + AI 写约束。**不含** Git 提交集成（独立立项）、容器化 dtc 沙箱与 dt-schema 绑定校验（TD-040 后续）。

**Branch:** `feat/dts-structured-product`（P2 合并后从最新 `main` 拉出）。

---

## Locked Decisions（本期锁定）

| # | 决策点 | 结论 |
| --- | --- | --- |
| A | 结构化读取来源 | 新增只读 HTTP 直接查 `dts_*` 表（按 `file_version_id`）；**不**在请求内重解析，保证与落库一致。 |
| B | 前端接线 | 新能力走 Port + runtime；旧的 `parameterFileClient` 直连保留不动（避免回归），新增 `DtsStructuredRepository` port（含 mock）。 |
| C | 值编辑器契约 | 编辑产出 `rawText`，客户端用与后端 `valueTyping` **对齐的规则**做即时校验与 `normalizedValue` 预览；真值以后端回写为准（回写走 P1 CST `writebackService`）。 |
| D | 变更集 | 一次逻辑改动（跨多节点/多文件）聚为一个可审阅单元，映射到现有 `parameter_change_requests` 流（复用审阅/合入/回写），**不**新建平行审批体系。 |
| E | 影响分析 | 后端计算，作为 `ChangeRequest.impact` 的真实来源；模板化 2 项退化为「无结构化信息时」的兜底。 |
| F | 节点级 RBAC | 新增 org/项目级「敏感节点规则」表（按 `node_path`/`compatible` 模式匹配 → 风险层级 + 所需能力）+ 新能力位 `parameter:edit-critical`；安全关键写需该能力，Agent 一律被拒（需人工）。 |
| G | AI 写约束 | 小择（orchestrator）对命中敏感规则的节点写操作直接阻断并要求人工审批，写审计。 |

---

## Contracts（核心契约）

### 结构化读取
```
GET .../parameter-files/:fileId/versions/:versionId/structure
→ { nodes: [{ nodePath, name, unitAddress?, labels[], compatible?, status?,
              properties: [{ name, valueType, rawText, normalizedValue }],
              phandleRefs: [{ fromProperty, targetLabel, resolvedTargetPath? }] }] }
```

### 结构化检索
```
GET .../projects/:projectId/dts-search?q=&by=path|address|label|compatible|value
→ { hits: [{ fileId, fileName, versionId, nodePath, propertyName?, snippet }] }
```

### 影响分析
```
ImpactItem 扩展 kind: "phandle" | "compatible" | "config-set"（保留 module/test/parameter 兼容）
后端在提交/对比路径推导：改动节点被哪些 phandle 引用、同 compatible 驱动绑定、配置集变体波及面。
```

### 节点级 RBAC
```
SensitiveNodeRule { id, org, projectId?, matchType:"path"|"compatible", pattern, riskTier:"high"|"critical", requiredCapability }
写操作前：解析目标 nodePath/compatible → 命中规则 → 校验 auth 能力；actorType=agent 命中 critical → 直接拒绝。
```

---

## File Map（新增/改动，引用真实 seam）

| File | Responsibility |
| --- | --- |
| `server/modules/parameter-files/structuralReadRepository.ts` | 按 `file_version_id` 读 `dts_*` 表组装结构 |
| `server/modules/parameter-files/structuralReadService.ts` + routes 增补 | 结构化读取 API（决策 A） |
| `server/modules/parameter-files/dtsSearchRepository.ts` + service/route | 检索 API（path/address/label/compatible/value） |
| `server/modules/parameters/impact.ts`（新）+ `repository.ts` 接线 | 真实影响分析，替换 `toChangeRequestDto` 模板 2 项 |
| `server/migrations/0045_dts_sensitive_node_rules.sql` | 敏感节点规则表（决策 F） |
| `server/modules/parameters/policy.ts`（增补）+ `sensitiveNode.ts` | `parameter:edit-critical`、规则匹配与 Agent 拦截 |
| `src/application/ports/DtsStructuredRepository.ts` | 前端 port（结构/检索/配置集/基线/导出） |
| `src/infrastructure/http/dtsStructuredClient.ts` + `src/infrastructure/mock/mockDtsStructuredRepository.ts` | api + mock 两套实现（决策 B） |
| `src/application/parameters/dtsStructuredRuntime.ts` | runtime 编排 + `runtimeMode` 接线 |
| `src/components/parameters/StructuredValueEditor.tsx` | 按 `valueType` 渲染编辑器（决策 C） |
| `src/components/parameters/DtsNodeTreeView.tsx` | 节点树浏览 |
| `src/components/admin/ConfigSetBaselinePanel.tsx` | 配置集/基线/对比/回滚/发布/导出 UI（挂 `ParameterAdminProjectsPage`） |
| `src/components/parameters/StructuredDiffView.tsx` + 变更集聚合 | 结构化差异 + 变更集 |
| `src/components/parameters/DtsSearchPanel.tsx` | 检索 UI |
| `e2e/acceptance/requirements.ts` / `operationMatrix.ts` / `dts-structured.acceptance.spec.ts` | 新增 `PARAM-DTS-*` 验收 |

> 复用：P2 路由（`parameter-files/routes.ts` L329–470）、`server/modules/dts/` barrel、教学 fixture。**禁止在前端 import 服务端模块**；值类型校验规则在前端**镜像实现**（不共享服务端代码），以单测对齐。

---

## Git & PR Workflow

- Branch: `feat/dts-structured-product` from latest `main`（P2 合并后）。
- 开发智能体仅在分支提交；架构师评审、验证、开 PR、合并、同步 `main`。
- **任务顺序**：Task 1–2（读取 API + 前端 Port/mock 地基）必须先行；Task 3–7（编辑器/UI/检索/差异）在地基上可较独立推进；Task 8（RBAC）贯穿写路径；Task 9（验收+文档）收口。

---

## Task 1: 结构化读取 API（后端）

**Files:** `structuralReadRepository.ts`, `structuralReadService.ts`, `routes.ts`（增补）, `schemas.ts` + tests

- [ ] **Step 1: 失败测试** — 对已 ingest 的教学 fixture 版本：读取返回节点/属性/phandle，`nodePath` 含 `@address`，`valueType`/`normalizedValue` 正确；`canViewParameters` 可读、越权 403。
- [ ] **Step 2: FAIL** → **Step 3: 实现** — 只查 `dts_*` 表组装（决策 A），新增 `GET .../versions/:versionId/structure`，Zod 出参。→ **Step 4: PASS** → 提交。

---

## Task 2: 前端 Port + mock/api 地基

**Files:** `DtsStructuredRepository.ts`, `dtsStructuredClient.ts`, `mockDtsStructuredRepository.ts`, `dtsStructuredRuntime.ts` + tests

- [ ] **Step 1: 失败测试** — port 契约测试；mock 返回教学 fixture 派生的结构（结构/检索/配置集/基线）；`runtimeMode=mock` 用 mock、`api` 用 http（复用 `runtimeMode.ts`）。
- [ ] **Step 2: FAIL** → **Step 3: 实现** — 定义 port（结构读取/检索/配置集 CRUD/基线/对比/回滚/发布/导出，映射 P2 路由）+ 两套实现 + runtime 接线。→ **Step 4: PASS** → 提交。

> 修正 TD-039：新能力经 Port 注入，不再直连 client；旧面板暂不动。

---

## Task 3: 结构化值编辑器

**Files:** `StructuredValueEditor.tsx`, `dtsValueClient.ts`（前端值校验，镜像 `valueTyping`）+ tests

- [ ] **Step 1: 失败测试** — 各 `valueType` 渲染对应控件：`u32-array`（多 cell/矩阵表）、`bytes`（`/bits/` 字节）、`string-list`、`phandle-list`（label 选择）、`bool`（开关）、`mixed`/枚举；编辑产出 `rawText`，即时校验非法输入，`normalizedValue` 预览与后端一致（对齐用例）。
- [ ] **Step 2: FAIL** → **Step 3: 实现** → **Step 4: PASS** → 提交。**（前端可见：本任务及其后需 playwright-cli 验证，见 Task 9）**

---

## Task 4: 配置集 / 基线管理 UI

**Files:** `ConfigSetBaselinePanel.tsx`（挂 `ParameterAdminProjectsPage.tsx`）+ tests

- [ ] **Step 1: 失败测试** — 列/建配置集、加/移成员并设角色、建基线、列基线、触发发布（展示门禁 `block/warn requiresConfirmation` 结果）、导出下载入口；mock 模式可交互，api 模式打真实路由；非管理员不可见/禁用。
- [ ] **Step 2: FAIL** → **Step 3: 实现** → **Step 4: PASS** → 提交。**（前端可见）**

---

## Task 5: 结构化差异 + 变更集

**Files:** `StructuredDiffView.tsx`, 变更集聚合（前端 + 复用后端 `compareBaseline`）+ tests

- [ ] **Step 1: 失败测试** — 基线对比渲染**节点/属性级**增删改（非纯文本 diff），等价重排（hex/多组）不显示为变更；跨多节点/多文件的一次逻辑改动聚为一个变更集单元，映射到现有变更请求流（决策 D）。
- [ ] **Step 2: FAIL** → **Step 3: 实现** → **Step 4: PASS** → 提交。**（前端可见）**

---

## Task 6: 结构化检索

**Files:** `dtsSearchRepository.ts` + service/route（后端）、`DtsSearchPanel.tsx`（前端）+ tests

- [ ] **Step 1: 失败测试** — 后端按 `path/@address/label/compatible/value` 查 `dts_*` 命中正确、org 隔离、`canViewParameters`；前端检索面板展示命中并可跳转节点。
- [ ] **Step 2: FAIL** → **Step 3: 实现** → **Step 4: PASS** → 提交。**（前端可见）**

---

## Task 7: 影响分析

**Files:** `server/modules/parameters/impact.ts` + `repository.ts` 接线 + tests

- [ ] **Step 1: 失败测试** — 改动某节点属性 → impact 含：引用它的 phandle 来源、同 `compatible` 绑定、配置集变体波及；无结构化信息时退回模板兜底（现有行为不回归）。前端审阅页展示新 `impact` 分类。
- [ ] **Step 2: FAIL** → **Step 3: 实现**（`toChangeRequestDto` 改为调用 `impact.ts`）→ **Step 4: PASS** → 提交。

---

## Task 8: 节点级 / 风险分层 RBAC + AI 写约束

**Files:** `0045_dts_sensitive_node_rules.sql`, `sensitiveNode.ts`, `policy.ts`（增补）, 写路径接入 + tests

- [ ] **Step 1: 失败测试**
  - 迁移 smoke；规则匹配（path/compatible 模式 → riskTier + requiredCapability）。
  - 无 `parameter:edit-critical` 的用户写安全关键节点 → 403；有则放行。
  - `actorType=agent` 命中 `critical` → **拒绝**并要求人工，写审计（决策 G）。
- [ ] **Step 2: FAIL** → **Step 3: 实现** — 在合入/回写（`service.ts reviewChange` → `writebackMergedParameterValue`）与结构化编辑提交路径接入匹配与鉴权；小择 orchestrator 写工具接入同一守卫。→ **Step 4: PASS** → 提交。

---

## Task 9: 验收（浏览器）+ 文档

**Files:** `requirements.ts`/`operationMatrix.ts`/`dts-structured.acceptance.spec.ts` + 文档

- [x] **Step 1:** 登记新验收 `PARAM-DTS-*`（结构读取、值编辑、配置集/基线、差异/变更集、检索、影响、RBAC），扩 acceptance spec + `recordOperationEvidence`。
- [ ] **Step 2: 真实浏览器验证（强制，AGENTS.md 规则）** — 用 `playwright-cli` 走每个前端可见页面/面板：
  - 视口 `1440x900` / `768x1024` / `390x844` 均验证；每页 `snapshot` + `screenshot`（存 `work/ui-checks/`）。
  - 真实交互：编辑各类型值、建配置集/基线、发布触发门禁、看结构化 diff、检索、影响展示、RBAC 禁用态。
  - `console error` 检查；数据流相关看 network。
  - 记录：URL/路由、视口、交互、截图路径、console/network 结果、发现并修复的问题。
- [x] **Step 3 (docs + registration):** 文档更新（见下）→ 本部分提交；全量 `npm test` / `test:server` / `build` / `acceptance:e2e` 可在完整 Task 9 收尾时再跑。

---

## Verification Matrix

| Check | Command |
| --- | --- |
| 后端结构读取/检索/影响/RBAC | `npm run test:server -- server/modules/parameter-files server/modules/parameters --run` |
| 迁移 | `npm run db:migrate` + `migration.test.ts` |
| 前端组件 | `npm test` |
| Build | `npm run build` |
| E2E / 验收 | `npm run test:e2e` + `npm run acceptance:e2e` + `npm run acceptance:coverage` |
| 浏览器可见性（强制） | `playwright-cli`（三视口 snapshot+screenshot+console，见 Task 9） |
| Docs | `npm run docs:check` |

---

## Documentation Impact Matrix

| Area | Path | Action |
| --- | --- | --- |
| 主计划 | `docs/exec-plans/active/2026-07-14-dts-management-program.md` | Update（P3 状态） |
| 前端指南 | `docs/FRONTEND.md` | **Update**（结构化编辑/差异/检索/配置集 UI + 新 Port） |
| 领域模型（中英） | `docs/design-docs/domain-model.md` / `docs/zh-CN/.../domain-model.md` | **Update**（影响分析结构、敏感节点规则、变更集） |
| API 契约（中英） | `docs/design-docs/api-contract.md` / zh | **Update**（结构读取/检索路由、impact 扩展） |
| 生成 schema | `docs/generated/db-schema.md` | **Update**（迁移 `0045`） |
| 安全（中英） | `docs/SECURITY.md` / zh | **Update**（节点级 RBAC、Agent 对安全关键节点写约束） |
| 技术债 | `docs/exec-plans/tech-debt-tracker.md` | **Update**（TD-039 前端 Port 化闭环；`(name,module)` 回退处置） |
| 架构总览 | `ARCHITECTURE.md` | Review（结构化产品面闭环） |
| 计划登记 | `docs/PLANS.md` / `docs/zh-CN/PLANS.md` | **Update** |

## Documentation Update Gate

移入 `completed/` 前：
- [x] FRONTEND / domain-model（中英）/ api-contract（中英）/ SECURITY（中英）已更新
- [x] db-schema 已手写更新（迁移 `0044`/`0045`；仓库无 regenerate script）
- [x] tech-debt-tracker 记录 TD-039 前端 Port 化闭环与回退处置
- [x] 新 `PARAM-DTS-*` 验收已登记（`requirements`/`operationMatrix`/`dts-structured.acceptance.spec.ts`）；`missingRequiredIds` 已清空 — 完整 `acceptance:coverage` 仍受既有 unknownId 影响；`acceptance:e2e` + evidence 待跑
- [ ] playwright-cli 三视口验证证据已附（URL/交互/截图/console/network）
- [x] `docs/PLANS.md` 与 `docs/zh-CN/PLANS.md` 一致（P2/P3 状态纠偏）
- [x] `npm run docs:check` 通过（本提交验证）

---

## Spec Coverage Self-Review（对主计划 P3 边界）

| 目标 | 本期解决 | Task |
| --- | --- | --- |
| 结构化值编辑器（按 value_type） | ✅ | 1,2,3 |
| 结构化变更集 + 结构化差异（替换纯文本 diff） | ✅ | 5 |
| 检索（path/@address/label/compatible/value） | ✅ | 6 |
| 影响分析（phandle/compatible/配置集变体 → impact） | ✅ | 7 |
| 节点级 / 风险分层 RBAC + 约束 AI 安全关键写 | ✅ | 8 |
| 前端 Port 化闭环（TD-039） | ✅ | 2 |

**留待后续：** Git 提交集成（独立立项）；容器化 dtc 沙箱 + dt-schema 绑定校验（TD-040 后续）；`(name,module)` 兼容回退最终下线（TD-038/039）。
