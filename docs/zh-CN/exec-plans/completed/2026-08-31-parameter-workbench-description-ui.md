# 参数工作台描述信息前端优化

英文原文：[English](../../../exec-plans/completed/2026-08-31-parameter-workbench-description-ui.md)

**状态：** 已完成

**基线：** `main@e895bedefa90c2d00c0dcc9e1f6e7496c060534d`

**分支：** `codex/parameter-workbench-description-ui-20260831`

## 目标与完成标准

优化 API 模式 `/parameters` 的“项目参数用户工作台”，且不改变搜索、模块导航、DTS 技术视图、导出、草稿、审阅和回写流程。

- 删除参数搜索旁的“显示 x / y 个参数”文案；DTS 源码查找时仍保留有用的匹配状态。
- 删除“带到参数调试”按钮及其跳转行为。
- 在语义参数列表增加“展示描述”列；无描述时显示“—”。
- 在参数查看弹窗和修改弹窗的每个参数卡片中，分别展示“参数说明”；无说明时显示“暂无参数说明”。
- 描述与说明必须来自 binding revision 固定的 `parameter_spec_version_id`，不能用不受约束的当前规格详情替代固定版本内容。
- 实现前先补 Red 回归，实现后 Green，并在桌面、平板、手机真实页面验证。

## 根因与设计

`DtsParameterWorkbench` 仍直接渲染旧计数和调试跳转。语义行模型只有 binding 与拓扑数据，主表和修改弹窗没有规格文案可显示。查看弹窗则将 `documentation` 与 `description` 合并成一个“参数含义”，丢失了“展示描述”和更完整“参数说明”的区别。

绑定列表查询已经关联固定的 binding revision。本次在该单次查询和 DTO 中补充固定 `parameter_spec_versions` 行的 nullable `displayName`、`description`、`documentation`；版本关联保持可选，确保没有固定版本的历史绑定仍然显示，只是文案字段为空。随后将字段透传到 HTTP mapper 和工作台行模型，并纳入搜索。表格显示 `description`；查看与修改界面用 `documentation` 显示“参数说明”。查看弹窗仍可按需加载约束、示例等丰富详情，但文案字段优先使用绑定行携带的固定版本投影。

## 范围

- 绑定列表投影与 API DTO：`server/modules/parameter-topology/bindingService.ts`、`service.ts`、`schemas.ts`、相关测试、HTTP mapper 与测试。
- 行模型：`src/domain/parameter-topology/workbenchTypes.ts`、`src/application/parameters/buildDtsWorkbenchRows.ts` 及测试/fixture。
- UI：`DtsParameterWorkbench.tsx`、`DtsParameterWorkbenchTable.tsx`、`DtsBindingDetailDialog.tsx`、`DtsBindingDraftDialog.tsx`、样式与组件测试。
- 仅在既有 `/parameters` 验收契约需要加强断言或生成契约需要刷新时调整验收/文档证据。

非目标：权限、草稿提交语义、设备调试、DTS reload、数据库 schema、参数定义治理、旧 mock 模式 `ParametersTable`。

## 实施任务

- [x] 检查工作区、保留已有修改、同步 `origin/main`、创建独立 feature worktree 并记录计划。
- [x] 为工具栏删除、表格描述、固定版本 DTO 映射、查看/修改参数说明添加失败测试。
- [x] 为固定 binding 列表投影和行模型补充 nullable 展示字段。
- [x] 实现工具栏、表格、查看弹窗、修改弹窗、响应式和空值效果。
- [x] 运行聚焦测试、服务端/客户端契约测试、相关前端测试、构建、lint、UI 和文档门禁。
- [x] 在 `1440x900`、`768x1024`、`390x844` 的真实 `/parameters` 验证搜索、查看、修改、console、数据加载、溢出、snapshot 和 screenshot。
- [x] 记录验证证据并归档中英文计划；下方明确保留与本次改动无关的验收套件失败。

## 交互与验收覆盖

本次优化已有工作台的读取/编辑展示，并删除一个旧导航动作，不新增业务操作 ID。

| 工作流 | 验收需求 | 操作 ID | 既有 spec | 本次处理 |
| --- | --- | --- | --- | --- |
| 语义参数浏览/搜索/详情 | `PARAM-TOPOLOGY-BROWSE-001` | `PARAM-TOPOLOGY-BROWSE-001` | `e2e/acceptance/parameter-topology.acceptance.spec.ts` | 保留流程，并在种子数据支持时加强描述/说明断言。 |
| 成熟参数草稿编辑 | `PARAM-DRAFT-EDIT-001` | `PARAM-DRAFT-EDIT-001` | `e2e/acceptance/parameters-negative.acceptance.spec.ts` | 保留编辑/移除行为，在组件边界锁定参数说明。 |
| 参数提交闭环 | `PARAM-HAPPY-001` | `PARAM-HAPPY-001` | `e2e/acceptance/parameter-topology.acceptance.spec.ts` | 确认工具栏清理不影响搜索、草稿、提交、审阅和回写。 |

## 验证矩阵

- Red/Green：`DtsParameterWorkbench`、表格、详情弹窗、草稿弹窗、行构建、HTTP client、拓扑 service/repository 的聚焦 Vitest。
- 相关前端/服务端：`ApiProjectTopologyWorkspace`、parameter-topology route/service/schema 测试，以及本地可运行时的相关验收 spec。
- 静态/构建：`npm run lint -- --no-cache`、`npm run build`、`npm run ui:check`、`git diff --check`。
- 文档/覆盖：`npm run docs:check`、`npm run acceptance:coverage`、`npm run acceptance:operations`。
- 浏览器：API 模式 `/parameters`，三个尺寸分别 snapshot、screenshot；操作搜索、查看、关闭、修改；检查说明字段、表格/卡片响应式、console error、失败 network 和页面横向溢出。证据放在 `work/ui-checks/parameter-workbench-description-ui-20260831/`。

## 文档影响矩阵

| 范围 | 状态 | 精确路径 | 说明 |
| --- | --- | --- | --- |
| 仓库索引 | Review | `AGENTS.md`、`ARCHITECTURE.md`、`docs/README.md` | 不改变索引或所有权。 |
| 计划文档 | Update | 本文件及英文对应文件；验证后归档 | 实施与证据记录。 |
| 产品规格 | Review | `docs/product-specs/prototype-functional-spec.md` 及中文对应文件 | 工作流不变，预计无需改写。 |
| 架构/API 文档 | Review | `docs/design-docs/api-contract.md`、中文对应文件、`docs/api/README.md` | binding 列表增加 nullable 展示字段；按契约工具要求刷新 OpenAPI。 |
| 质量/测试文档 | Review | `docs/developer/verification-matrix.md`、`docs/design-docs/testing-strategy.md` 及中文对应文件 | 现有门禁足够。 |
| 可靠性/运行手册 | No change | `docs/RELIABILITY.md`、`docs/runbooks/README.md` 及中文对应文件 | 无运行或运维变化。 |
| 安全/治理 | No change | `docs/SECURITY.md`、`docs/security/README.md` 及中文对应文件 | 无授权、审计或 mutation policy 变化。 |
| 前端/设计 | Review | `docs/FRONTEND.md`、`docs/zh-CN/frontend.md`、UI 设计系统中英文文件 | 沿用表格、响应式、文案、弹窗规则。 |
| 生成产物 | Review | `docs/generated/openapi.json`、验收操作证据 | 仅机械刷新受影响契约，不伪造验收证据。 |
| 参考资料 | Review | `docs/references/productization-api-contract-draft.md` | 仅在其中明确重复响应字段时更新。 |
| 浏览器验收 | Review | 中英文覆盖图和操作矩阵 | 沿用既有操作 ID，必要时加强断言。 |

## 文档更新门禁

- 中英文计划语义一致并互相链接。
- 每个 `Update`/`Review` 项都完成更新或记录无需更新的证据。
- OpenAPI 漂移通过仓库生成器解决，不手改 JSON。
- 归档前 `docs:check`、验收覆盖和操作覆盖通过。
- `active/` 与 `completed/` 中不保留同名计划。

## Git 与 PR 流程

所有实现仅在 `codex/parameter-workbench-description-ui-20260831`，基于上述最新 `origin/main` 精确 SHA。`/Users/tzrea1/Develop/WiseEff` 的已有脏工作区保持不动。当前请求未授权创建或合并 PR；只有用户后续明确要求时才提交并进行 GitHub 交付。

## 验证记录

### Red 到 Green

- 工具栏回归测试首次因旧的“显示 4 / 4 个参数”仍存在而失败；删除计数和调试跳转后通过。
- 展示字段投影的四项聚焦测试首次分别因缺少固定版本 DTO 字段、“展示描述”列、详情拆分标签和修改卡片说明而失败；实现后四项全部通过。
- 历史兼容性：CI 视觉审查暴露出版本 inner join 会隐藏没有 `parameter_spec_version_id` 的历史绑定；查询已改为可选版本关联，服务端回归测试覆盖“绑定保留、展示文案为空”的行为。
- 相关前端测试 8 个文件 / 178 项通过；最终工作台与 workspace 回归 2 个文件 / 53 项通过。
- 服务端 PostgreSQL 聚焦测试使用全新临时数据库，2 个文件 / 21 项通过；验证后数据库已删除。
- 全量前端回归 421 个文件 / 3,171 项全部通过。

### 静态与治理门禁

- `npm run build`、`npm run contract:check`、`npm run ui:check`、`npm run docs:check`、`npm run acceptance:coverage`、`npm run acceptance:operations`、`git diff --check` 通过。
- `npm run lint -- --no-cache` 为 0 error，保留仓库已有 301 条 warning。
- `docs:check` 明确报告本机没有 pgvector，因此规范化 pgvector schema 产物仍由 CI 验证。
- 文档影响复核确认：仓库索引、产品流程、架构、安全、runbook、质量矩阵和参考契约均无需更新；OpenAPI 已是最新，不新增验收/操作 ID。

### 真实浏览器

- 临时 API 模式地址：`http://127.0.0.1:5194/parameters?project=aurora`；后端使用全新迁移并灌入 M0/M1 数据的临时 PostgreSQL 数据库。
- 尺寸：`1440x900`、`768x1024`、`390x844`；Browser control 与 `playwright-cli` 均完成 snapshot 和 screenshot。
- 操作：搜索 `gpio_int`，确认两条 binding 行；打开/关闭查看弹窗和修改弹窗；确认“展示描述”和“参数说明”及其内容。旧计数和“带到参数调试”元素数量均为 0。
- 布局：三个尺寸下 page scroll width 均等于 viewport width；目标状态未发现重叠、裁切或页面级横向滚动。
- Console/数据：0 个 browser error；binding 列表、详情、历史、对比数据正常载入。仅保留两条既有 CopilotKit 本地许可证 warning，目标交互未出现 API 失败。
- 截图：`work/ui-checks/parameter-workbench-description-ui-20260831/` 包含桌面列表/详情/修改、平板列表、手机列表/详情/修改以及独立 `playwright-cli` 截图。
- 验证后临时 API、Vite 进程和浏览器数据库均已停止并删除。

### 验收套件边界

`parameter-topology.acceptance.spec.ts` 已运行到既有 review-task 流程，但在创建 occurrence-derived 草稿规格时失败（`create draft spec for review ...`），不位于本次修改的 binding 列表/展示链路。该运行还暴露了 macOS `/var` 与 `/private/var` 临时路径保护，以及进程清理后保留两个测试资源的问题。两个精确临时数据库均先核验 `parameter-topology` 标记和匹配 cutover run 再删除；残留测试进程已终止，精确临时对象存储根目录已移入废纸篓。本次不将该验收套件声明为通过。
