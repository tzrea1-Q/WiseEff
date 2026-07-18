# 前端开发

> English: [English](../FRONTEND.md)

WiseEff 前端是 Vite、React、TypeScript 单页应用。它同时支持 mock runtime 和 API runtime：mock 用于演示和组件测试，API runtime 用于产品化路径和全链路验收。

英文详细文档见 [FRONTEND.md](../FRONTEND.md)。

## 关键目录

- `src/app/`：路由、导航、权限和页面装配。
- `src/domain/`：角色、参数、日志、调试、审计、Agent 的类型和纯规则。
- `src/application/ports/`：前端调用业务能力的接口。
- `src/infrastructure/mock/`：mock state 和 mock repository/gateway。
- `src/infrastructure/http/`：HTTP API client、DTO、auth client、runtime mode。
- `src/components/`：复用 UI、表格、弹窗、过滤器、图表。
- `src/features/agent/`：Xiaoze（小泽）CopilotKit 表面（`XiaozeProvider`、`useXiaozePageContext`、`XiaozeApprovalCard`、前端工具）。
- `src/features/product-feedback/`：侧边栏 `FeedbackDialog` 与 `/feedback-admin` 反馈处理 UI。
- `src/test/setup.ts`：Vitest DOM 初始化。

## Runtime 模式

默认是 **API mode**。`npm run dev` 与 `npm run dev:all` 会注入 API runtime；`.env.example` 与之一致。

```text
VITE_WISEEFF_RUNTIME_MODE=api
VITE_WISEEFF_API_BASE_URL=http://127.0.0.1:8787
```

仅在纯前端演示或组件测试、且不需要调用后端时显式使用 mock：

```text
VITE_WISEEFF_RUNTIME_MODE=mock
```

生产构建不能把 mock data 当业务数据源。组件测试默认仍通过 `npm test` 覆盖为 mock，避免本地 `.env` 的 API 设置污染单测。

API mode 启动时会先调用 `/api/v1/me`。如果当前 token 缺失或被拒绝，前端显示 WiseEff 认证页，支持本地账号登录和注册。本地登录使用用户名和密码；注册会选择组织（`硬件部` / `软件部`）、姓名、允许自助选择的平台角色、用户名和密码。注册角色下拉不包含 Admin；申请 Hardware/Software Committer 时，后端会创建 inactive 账号、对应基础 User 角色和待审批申请，`/api/v1/auth/register` 返回 `202 pending_approval` 且不返回 session token，前端继续停留在认证页，展示待审批结果态且不再保留可编辑注册表单。只有登录或非 Committer 注册成功后，前端才把不透明的 `we_local_*` session token 存到 `localStorage` 的 `wiseeff.localAuthToken`；默认 API client 会优先使用 OIDC runtime token，若没有 OIDC token 再回退到本地 token。

顶部用户菜单提供“个人资料”和“退出登录”。个人资料保存调用 `PATCH /api/v1/me/profile`，退出登录调用 `POST /api/v1/auth/logout` 并清除本地 token。注册按所选组织和允许自助选择的平台角色创建本地账号；当前暂不支持邮箱验证。

本地账号注册的组织下拉固定为 `硬件部` 和 `软件部`。自助注册角色下拉使用：`guest`、`hardware-user`、`software-user`、`hardware-committer`、`software-committer`。`admin` 只能通过后台用户治理分配，不能在注册页自助选择。

## 端口和实现

前端页面不要直接拼业务写入逻辑，而是调用 application ports：

- 参数管理：`ParameterRepository`
- 参数看板：`ParameterDashboardRepository`
- DTS 结构化产品面：`DtsStructuredRepository`（`resolveDtsStructuredRepository` → mock / `dtsStructuredClient`）
- 日志分析：`LogAnalysisRepository`
- 产品反馈：`ProductFeedbackRepository`
- 设备调试：`DebuggingGateway`
每个 port 通常有两类实现：

- `src/infrastructure/mock/*`：本地演示和单测。
- `src/infrastructure/http/*`：API runtime，负责 `/api/v1` 请求和 DTO 映射。

P3 / P3.1 新表面（均走 `DtsStructuredRepository`，勿在新面板里直接 new HTTP client）：

- `submitStructuredEdits`：经 `POST /api/v1/projects/:projectId/dts-structured-edits/submit` 提交结构化编辑；CR 与 CST 回写载荷用 `rawText`（非 `normalizedValue`）保真。
- `StructuredValueEditor`：按 `valueType` 编辑 `rawText`（与后端值类型对齐的客户端校验）。
- `DtsStructureBrowserPanel`：结构浏览、属性编辑、本地变更集聚合与「提交变更请求」；需 `parameter:edit`（`canEdit`），安全关键节点另需 `parameter:edit-critical`（`canEditCritical`）。
- `DtsSearchPanel`：路径 / `@地址` / 标签 / compatible / 值检索，挂在 `/parameter-admin/projects` 管理文件对话框。
- `ConfigSetBaselinePanel`：配置集 / 基线 / 对比 / 发布 / 导出，同对话框「配置集 / 基线」标签；对比变更集行映射真实参数并可走同一提交端口。
- `StructuredDiffView`：基线结构化差异与变更集行。

旧的 `ProjectParameterFilesPanel` / 冲突面板通过 `resolveParameterFileRepository(runtimeMode)` 注入 `ParameterFileRepository`（mock：`createMockParameterFileRepository`；API：`createParameterFileClient`），组件内禁止 `createParameterFileClient()`。mock 模式下可演示文件列表与冲突面板，不直连 `:8787`。

语义身份 UI 在 `src/components/parameter-topology/`：规格库与审核队列、源树/生效树浏览、类型化绑定编辑与正式提交、身份映射决议、失败关闭的配置 revision 校验。API 模式走 `/api/v2`；DTO 分字段暴露 `exampleValue` / `schemaDefault` / `policyTarget` / `effectiveValue`，无业务 `recommendedValue`。Cutover 后遗留扁平参数 ID 不做兼容投影。

API 模式 `/parameters` 只渲染 `ApiProjectTopologyWorkspace` 和 binding 草稿提交面板。遗留 `ParametersTable`、推荐值漂移文案、用 recommended value 初始化草稿、扁平详情与扁平导出均仅限 mock。类型化编辑必须填写原因并保留 API 返回的 draft/binding/spec/candidate 身份；submission wire item 发送 `draftId`、`projectParameterBindingId` 与 `parameterSpecId`，不得再让语义 binding 冒充遗留 `parameterId`。TopBar 切换项目时，工作区清除上一项目的 preferred candidate revision、pending draft、候选人状态、发布消息和映射消息；新项目从自身 `current` 开始加载。提交后由指定角色在 `/parameter-review` UI 推进。

- **未匹配规格审核：** `SpecReviewQueue` 对 unmatched 任务提供「创建规格」动作（resolve 时 `createSpec: true`）。库内决议若属性键与 occurrence 不一致，须在 UI 勾选确认后传 `confirmPropertyMismatch: true`，再调用 `POST .../parameter-spec-review-tasks/:taskId/resolve`。
- **草稿规格激活：** `ParameterSpecLibrary` 与 `DraftSpecActivatePanel` 供 Admin 保留完整推断 `valueShape`（bits/groups/cellsPerGroup/length，不得只留 kind 或默认 cells=1）并补齐 `constraints`/`documentation`，再调用 `POST /api/v2/parameter-specs/:specId/activate`。形状缺失/冲突时 UI 阻断激活。平台全局 draft 不对组织 Admin 展示可成功执行的激活操作（服务端亦返回 `403`）。resolve/release 在规格为 active 且约束完整前拒绝 draft。
- **Dashboard hotspot：** 租户项目的热榜须展示全局厂商规格（API 聚合 `organization_id IS NULL` 的规格）。

Provenance、绑定详情与映射/审核队列必须来自 API 响应（`sourceChain`、occurrence span、任务载荷）。API 模式下后端为空或出错时**不得**回退到教学/mock 拓扑数据。校验/发布文案须与门禁结果一致（`validated` vs fail-closed 撤销）；不得把 `schema-failed` 当作成功路径。

## 主要页面流

参数管理：

- `/parameters`：API 模式只保留真实源树/生效树、binding 详情、类型化草稿与 binding 提交面板；mock 模式才保留旧扁平参数表。提交面板通过 `GET /api/v1/projects/:projectId/parameter-workflow-assignees` 加载三类候选人；任一角色无 eligible candidate 时失败关闭，提交时服务端再次校验所选 ID。
- `/parameter-review`：查看待审请求、推进或拒绝流程。
- `/parameter-admin`：mock mode 下保留直接管理体验；API mode 下写入应走 import/review 流程。批量导入向导（`ParameterImportWizard`）对完整 `.dts` / `.dtsi` 通过 `ParameterRepository.parseDtsImport` → `POST /api/v1/parameter-import/parse-dts`（或 mock CST 派生）解析，**不再**对 `dts-full` 静默回退 `parseDtsFragment`；含 `/include/` 时展示可读错误。跳过行汇总为 `reviewMetadata` 挂到 create preview / apply。大于 2MB 的 DTS 提示「将使用服务端解析」。

## 多层级模块树

参数域与调试域各自维护独立的组织级模块树。共享选择器：`src/components/common/ModuleTreeSelect.tsx`。

- `/parameters`：模块筛选与分组使用 `moduleId` 子树包含；深链 `?module=<moduleId>`。
- `/parameter-admin`：`ModuleManagementDialog` 支持创建子模块、移动、受控删除；库筛选与导入预览使用树形选择。
- `/debugging-admin`：`DebugModuleManagementDialog` 管理调试节点模块树；节点目录与编辑弹窗通过 `ModuleTreeSelect` 选模块。

API mode 从 `/api/v1/parameter-modules` 与 `/api/v1/debugging/admin/modules` 加载；mock mode 由 `src/config/power-management.json` 的 `parent`/`path` 经 `buildPowerManagementModuleTree()` 派生。

mock mode 有意保留 12 个兼容参数，以保证组件测试与演示轻量。API mode 的 `db:seed:m1` 会在 seed 时额外派生 170 个 DTS 来源参数；每个落库项目值都包含 `sourceFileName=wiseeff-power-overlay.dts` 和含属性名的 `sourceNodePath`。修改基础 DTS 或项目差异后，运行 `npm run dts:seed:generate` 重新生成三份项目 fixture，再用 `npm run dtc:seed:compile` 验证。
- `/parameter-home`：参数看板首页。UI 位于 `src/features/parameter-home/`，通过 `ParameterDashboardRepository` 读取 `/api/v1/parameters/dashboard/summary` 与 `/api/v1/parameters/dashboard/hotspots`。页面内 `AnalysisContextControls` 负责时间窗口与热榜维度切换；`dashboardState` 为 `summary` 与 `hotspots` 维护独立异步分区（`idle | loading | ready | empty | error`）。`derivePersonalWorkbench.ts` 基于 `WorkbenchSignals` 与角色生成待办与场景入口。

日志分析：

- `/logs`：上传日志、轮询任务、展示报告和证据。
- `/log-admin`：反馈、归档、重跑、治理操作。

产品反馈：

- 全局「问题反馈」入口打开 `FeedbackDialog`，通过 `ProductFeedbackRepository.submit` 提交当前 `pagePath`、`pageTitle`、反馈类型、描述和图片文件。
- `/feedback-admin`：Admin-only 反馈处理页，通过同一 port 列表/搜索/筛选、查看详情与附件、填写 `adminNote`，并按 `open -> in_progress -> closed` 推进状态。
- mock mode 使用 `src/infrastructure/mock/mockProductFeedbackRepository.ts`；API mode 使用 `src/infrastructure/http/productFeedbackClient.ts`，对接 `/api/v1/product-feedback` 及附件内容路由。

设备调试：

- `/node-debugging`：通过 API mode gateway 读写节点、生成快照和审计（当前主入口）。
- `/debugging`：**暂时下线**（2026-07-01）；路由显示不可用页并引导至节点调试，因设备参数重载能力尚未就绪。`DebuggingPage` 组件保留供后续恢复与组件测试。
- `/debugging-admin`：API mode 下通过 `src/infrastructure/http/debuggingAdminClient.ts` 管理调试 catalog，可查询、新增、更新、归档、恢复并维护 HDC/ADB bindings；mock mode 保留本地 `configDraft` 和 JSON 编辑路径，用于演示和组件测试。

### 本地 Device Bridge（Phase A）

`/node-debugging` 使用三步向导（**安装 Bridge → 连接本机 → 插入 USB 设备**），组件位于 `src/components/LocalDeviceBridgeWizard.tsx`。面板通过 `deviceBridgeClient` 读取 `/api/v1/device-bridges/releases`，经 `pickBridgeReleaseForHost()` 优先选择 `artifactKind: "installer"` 的安装包；配对码来自 `/api/v1/device-bridges/pairing-codes`；设备代理列表来自 `/api/v1/device-bridges/mine`。

主连接流程：点击 **连接本地设备** → 首次可选确认（`wiseeff.bridgeSchemeConfirm`）→ `launchBridgeConnect()` 打开 `wiseeff-bridge://connect?...` → `pollLocalBridgeHealth()` 最多 30 秒轮询 `http://127.0.0.1:18787/health` → `connected: true` 后自动 detect。工具函数在 `src/infrastructure/http/bridgeConnectLauncher.ts`。

Phase B（Step ③ 工具）：health 含 `tools.adb` / `tools.hdc`；所选协议工具缺失时显示 `tools_missing` 与 **安装调试工具**（`bridgeToolInstallLauncher.ts`，`wiseeff-bridge://install-tools`，120 秒轮询）。detect 报错若指向 adb/hdc 缺失，提示安装工具而非「Bridge 未安装」。

`pair` / `start` / `connect` 命令行说明折叠在 **高级 · 命令行方式**；便携包下载在 **其他平台**。

浏览器 health 探测仅作 UI 引导；Bridge 设备执行仍由后端 session 与审计控制。Phase 2 的重命名/撤销与多 Bridge 目标选择行为不变。

### 调试管理后台 UI

页面壳在 `src/DebuggingAdminPage.tsx`；主区域为全宽**节点目录**表，模块树由 `DebugModuleManagementDialog` 管理，节点/参数库筛选使用 `ModuleTreeSelect`。

- `DebugNodeLibraryTable` — 工具栏搜索、模块树筛选、协议覆盖与行操作。
- `DebugNodeEditorDialog` — 逻辑节点元数据与模块归属。
- `DebugNodeBindingsDialog` — 每协议 HDC/ADB 路径 binding 编辑。

（遗留 `DebugParameterLibraryTable` 等参数 catalog 弹窗仅 mock/测试路径保留；API mode 管理面向逻辑节点目录。）

复杂调试参数通过 `src/debugValueKind.ts` 在管理端与运行时共享辅助逻辑。`DebugParameterDefinitionDialog` 提供值类型、格式、规范化模式，以及复杂当前值/目标值的多行代码编辑器。`DebugParameterLibraryTable` 显示紧凑格式徽章。`/node-debugging` 以紧凑预览和格式徽章展示复杂值，在宽 sheet 中打开查看/编辑，并在操作历史中显示 preview 与 digest，而不是完整 payload。

筛选与弹窗深链由 `useDebugAdminSearch` 同步 URL。mock mode 在表格下方保留可折叠的 **配置源预览**（`power-management.json` 导出/同步）。

Xiaoze（小泽，唯一 Agent）：

- API mode（`VITE_WISEEFF_RUNTIME_MODE=api`）始终挂载 `XiaozeProvider`（CopilotKit V2 + `HttpAgent`），SSE 对接 `POST /api/v1/agent/xiaoze`；`XiaozePageContextRegistrar` 声明 `wiseeff.page` 上下文。
- mock mode 不挂载任何 Agent UI，前端也不发起 Agent HTTP 请求。
- P0：`perception.*` 只读工具。
- P1：`XiaozeApprovalCard`（`useInterrupt`）处理 mutating `action.submitParameterChange` 提案（批准 / 拒绝 / 改值）；低风险前端工具 `navigateTo`、`prefillParameterValue`（`useFrontendTool`，不写库）。
- P2：后端 LangGraph 规划循环（intent → perceive → plan → act → observe）与 checkpoint resume；`VITE_XIAOZE_PROACTIVE_ENABLED=true`（且 API `XIAOZE_PROACTIVE_ENABLED=true`）时，`useXiaozeSuggestions` 调用 `POST /api/v1/agent/xiaoze/suggest`，在 `AgentInsightBar` 展示只读主动建议；点击建议可预填打开小泽聊天。
- live LLM 使用 `AGENT_API_BASE_URL`、`AGENT_MODEL`、`AGENT_API_KEY`（OpenAI-compatible）；验收可用 `XIAOZE_DETERMINISTIC=true`。

用户和身份：

- `/api/v1/me` 在 OIDC、HMAC smoke 和本地账号下返回同一类 `AuthContext`。
- `/user-permissions` 在 API mode 下通过 `/api/v1/users` 读取和写入用户治理数据，并通过 `/api/v1/users/registration-role-requests` 处理待审批的 Committer 注册申请。管理员在“添加用户”中创建的是本地账号：表单使用姓名、用户名、可选职务、初始密码和初始角色，不再把邮箱作为账号标识。该账号会加入当前管理员所在组织并立即启用；密码只提交给后端创建凭据，前端用户状态不会保存明文密码。
- 前端权限检查只是 UX，后端仍必须执行 authz、self-lockout 防护和 audit。

## 按钮和操作样式

按钮必须看起来就是按钮。不要依赖裸 `.button` class、浏览器默认 `<button>` 样式，或把会写入状态、提交表单、关闭弹窗、推进流程、打开菜单的操作做成纯文字。优先复用已有 Button 组件或本地已有变体；如果某个区域需要局部按钮变体，必须在该作用域内补齐完整视觉契约：

- 布局：使用居中对齐的 `inline-flex`，并设置稳定的 `min-height`，以及稳定的 `min-width` 或 icon-only 方形尺寸。
- 表面：显式定义 `background`、`border`、`border-radius`、文字颜色、禁用态透明度和 cursor。
- 层级：区分 primary、secondary/subtle、destructive、ghost 等层级，不能让两个关键操作看起来只是两段等权重文字。
- 交互：提供 hover 和 focus-visible 状态；在浅色页面和带遮罩的弹窗上，焦点环都必须可见。
- 响应式：桌面、平板、手机下按钮不能退化成裸文字，不能互相重叠，不能溢出容器，也不能因为文字或状态变化导致布局跳动。

弹窗底部、表格行操作、顶部栏操作、卡片操作和 toast 操作是高频回归点。修改这些区域时，单测应加入目标按钮变体或 class 的 DOM 断言；浏览器验收应截取对应状态，并明确检查主/次按钮有可见表面样式、尺寸稳定且页面无水平溢出。低强调的内联跳转或辅助操作可以使用文本式样式，但应使用 link/text-action class，不要伪装成普通按钮。

## 测试建议

开发时优先跑目标测试：

```bash
npm test -- src/path/to/test.tsx
```

前端影响较大时跑：

```bash
npm test
npm run build
```

API-mode E2E 依赖 PostgreSQL 和 seed data：

```bash
npm run db:migrate
npm run db:seed:m0
npm run db:seed:m1
npm run db:seed:m2
npm run db:seed:m3
npm run test:e2e
```

如果本地 `.env` 设置了 `VITE_WISEEFF_RUNTIME_MODE=api`，运行前端单测时建议显式覆盖为 mock，避免组件测试被真实 API 环境污染：

```bash
VITE_WISEEFF_RUNTIME_MODE=mock npm test
```
