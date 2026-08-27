# 前端开发

> English: [English](../FRONTEND.md)

WiseEff 前端是 Vite、React、TypeScript 单页应用。它同时支持 mock runtime 和 API runtime：mock 用于演示和组件测试，API runtime 用于产品化路径和全链路验收。

**工作流发现面（ADR-0036）。** 侧栏分组和首页寻路（卡片、流程 Tab、顶栏/页脚工作流链接，以及点名某工作流的推销文案）读取 `src/domain/workflowDiscovery.ts` 的 `VISIBLE_WORKFLOWS`。第一次名单是参数管理和调试。日志分析和知识库仍在页面目录中，直达可用；未写入名单前不出现在发现面。这不是权限变更，也不是 `NoEntryPage` 退役。

英文详细文档见 [FRONTEND.md](../FRONTEND.md)。

## 关键目录

- `src/app/`：路由、导航、权限、页面装配，以及组合根 `appRuntime.ts`——`createAppRuntime` 按运行时模式一次性选好全部适配器，页面经 `PageProps.runtime` 接收。
- `src/domain/`：角色、参数、日志、调试、审计、Agent 的类型和纯规则。
- `src/application/state/`：全局原型状态机——`AppAction`、`reducer`/`appReducer` 与仅供 reducer 使用的迁移助手。API 启动态是这里的 `createApiInitialState()`（#486）；状态类型一律从这里导入，禁止从 `@/App` 导入（ADR-0023）。
- `src/application/bridge/`：`/node-debugging` 与 `/dts-reload` 共用的 C5 protocol/bridge/target 类型与 helper（`bridgeTargetSession`，#488）。两套 session 仍分开；没有空的 `BridgeGateway` HTTP 端口。
- `src/application/debugging/`：`/node-debugging` session（`nodeDebuggingSession`，#485），形态与 dts-reload 相同。
- `src/application/ports/`：前端调用业务能力的接口。
- `src/infrastructure/mock/`：mock state 和 mock repository/gateway。失败经 `mockApiError` 抛 `WiseEffApiError`（TD-109；reattribute/rename 余量已在 #483 关闭）。`createPrototypeState` 在 `prototypeState.ts`（#486）；`src/mockData.ts` 只给测试做 re-export。
- `src/infrastructure/http/`：HTTP API client、DTO、auth client、runtime mode。
- `src/components/`：复用 UI、表格、弹窗、过滤器、图表。
- `src/features/agent/`：Xiaoze（小泽）CopilotKit 表面（`XiaozeProvider`、`useXiaozePageContext`、`XiaozeApprovalCard`、前端工具）。
- `src/features/log-analysis/`：`LogsPage`（上传、结论卡、证据链、原始日志查看器）与 `LogDashboardPage`。样式在同目录 `log-analysis.css`（由页面 import；#476）。
- `src/features/parameter-review/`：`ParameterReviewPage`、`ParameterSubmissionsPage`、提交历史 diff 与评审专用 UI 原子。样式在同目录 `parameter-review.css`（#479）。
- `src/components/project-configuration-workbench/`：配置工作台。样式在同目录 `configuration-workbench.css`（#484）；共享 `.workbench-page` / `.workbench-sheet` 仍在 `src/styles.css`。
- `src/features/product-feedback/`：应用壳层共享的 `FeedbackDialog` 与 `/feedback-admin` 反馈处理 UI。
- `src/features/knowledge/`：知识库页面（`/knowledge` 与 `/knowledge-admin`:列表、分栏编辑器、文件上传、修订历史）。
- `src/test/setup.ts`：Vitest DOM 初始化。

## Runtime 模式

默认是 **API mode**。`npm run dev` 与 `npm run dev:all` 会注入 API runtime；`.env.example` 与之一致。

```text
VITE_WISEEFF_RUNTIME_MODE=api
VITE_WISEEFF_API_BASE_URL=http://127.0.0.1:8787
```

项目配置工作台是**规范**项目运营体验（`/parameter-admin/projects/:projectId/configuration`）。原开发开关 `VITE_PROJECT_CONFIGURATION_WORKBENCH_ENABLED` 已退役并被忽略（#240）。详见 `.env.example` 与 `docs/zh-CN/developer/environment-variables.md`。

仅在纯前端演示或组件测试、且不需要调用后端时显式使用 mock：

```text
VITE_WISEEFF_RUNTIME_MODE=mock
```

生产构建不能把 mock data 当业务数据源。组件测试默认仍通过 `npm test` 覆盖为 mock，避免本地 `.env` 的 API 设置污染单测。

API 模式不再回退到 mock 数据：应用从 `createApiInitialState()`（保留结构性字段、业务数据切片全部为空，含 `auditEvents`；无用的 `developers` / `logAdminUsers` 已在 #474 退役）启动，首次同步完成前内容区顶部显示「正在连接雷泽服务…」提示条；任一域（参数/日志/调试）刷新失败时，经 `CLEAR_API_RUNTIME_DOMAIN` 清空该域业务切片，并在内容区顶部显示持久的「无法连接雷泽… API，当前无数据」错误横幅与重试按钮，绝不把演示数据当真实数据展示。参数域成功水合后，若演示项目 ID 不在服务端项目列表中，`activeProjectId` 会指向真实项目。#480 禁止参数页和 reducer 在 `configDraft.projects` 为空时回落到 `mockData.projects`；API boot 使用 `createEmptyPowerManagementConfig()`。#486 把 `createApiInitialState()` 建成显式空壳（不再调用 `createPrototypeState()`）。其中身份字段也以无用户、访客权限启动（`users: []`、`currentUserId: ""`、`activeRoleId: "guest"`）：`/api/v1/me` 只插入已认证当前用户，`/api/v1/users` 只在 `/organization/members` 水合治理名录。9 个演示用户及其它 mock 播种都归 `src/infrastructure/mock/prototypeState.ts` 所有。mock 模式行为不变。

API mode 启动时会先调用 `/api/v1/me`。如果当前 token 缺失或被拒绝，前端显示 WiseEff 认证页，支持本地账号登录和（在开放时）注册。认证 client 提供 `getLocalAuthConfig` 时，页面会先读取未认证的 `GET /api/v1/auth/local-config`。本地登录使用用户名和密码；注册收集姓名、允许自助选择的平台角色、用户名、密码和确认密码，没有组织下拉，新账号加入评估组织（有种子时是 ChargeLab，否则是唯一的 bootstrap Organization）。认证页说明加入规则、用户名规则（3–64 个字符，仅限字母、数字、点、下划线和连字符）以及一行角色提示。注册角色下拉不包含 Admin。`selfRegisterEnabled` 为 false 时隐藏「注册」页签；`hasLocalAdmin` 为 false 时显示 `npm run admin:bootstrap` 提示。申请 Hardware/Software Committer 时，后端会创建 inactive 账号、对应基础 User 角色和待审批申请，`/api/v1/auth/register` 返回 `202 pending_approval` 且不返回 session token，前端继续停留在认证页，展示待审批结果态且不再保留可编辑注册表单。只有登录或非 Committer 注册成功后，前端才把不透明的 `we_local_*` session token 存到 `localStorage` 的 `wiseeff.localAuthToken`；默认 API client 会优先使用 OIDC runtime token，若没有 OIDC token 再回退到本地 token。

顶部用户菜单提供“个人资料”和“退出登录”。个人资料保存调用 `PATCH /api/v1/me/profile`；认证 client 提供 `changePassword` 时，资料弹窗还会提交 `POST /api/v1/me/password`，并提示其它会话已退出。退出登录调用 `POST /api/v1/auth/logout` 并清除本地 token。注册按评估组织和允许自助选择的平台角色创建本地账号；当前暂不支持邮箱验证。

启动探测会区分“认证被拒绝”和“后端不可达”，避免后端重启或网络抖动把所有人登出。只有 `WiseEffApiError` 且 code 为 `UNAUTHENTICATED` / `FORBIDDEN` 才清除本地 token 并回到登录页；其他失败（fetch `TypeError`、超时、5xx）保留 token 并进入 `unreachable` 状态，渲染品牌化的「无法连接服务器」屏，其中「重试」按钮重跑探测（`authProbeAttempt`）并就地恢复会话——无需重新登录。探测进行中的 `checking` 状态渲染轻量的会话恢复屏（「正在恢复会话…」）而非可交互登录表单，刷新时不再闪现登录页。两个状态复用 `.auth-panel` 外观（`.auth-status-panel`）。

通知反馈（`state.notifications`，由 `ADD_NOTIFICATION` 推入）经由唯一渲染器上屏：`AppToastLayer`（`src/components/common/AppToastLayer.tsx`）是挂在 AppShell 的无 DOM 桥（**两种运行时都挂载**），把队列每一条倾倒进设计系统 `ToastProvider`（`useToast`），按词法推断 tone（失败词汇 → `danger`/`role="alert"`，完成词汇 → `success`，其余 `info`），并立即经 `DISMISS_NOTIFICATION` 消费队列。展示由 `ToastCard` 负责：约 4 秒自动消退、悬停暂停、在 `.toast-viewport`（`--z-toast` 层，位于弹窗与小泽聊天之上）栈叠，以及带 aria-label 的手动关闭按钮（关闭提示）。命令式 `useToast()` 与 reducer 通知从此共用一条视觉管线。这取代了此前 `LogsPage` 内仅 mock 模式渲染的 toast——那种写法让 API 模式所有成功/失败提示都不可见。详情选中支持深链：`/parameter-review?request=<id>` 恢复选中的审阅行并经 `history.replaceState` 保持地址栏同步；`/logs?logId=<id>`（「复制链接」的目标）在 API 数据水合后恢复选中日志，且不会被最新上传自动选中覆盖。变更审阅（`/parameter-review` 待审阅视图）支持检视阶段的批量通过：存在可操作行时出现复选框列（初始化审阅与合入阶段除外——合入需逐条填写合入链接），工具栏出现「批量通过」按钮，聚合确认对话框说明影响范围，执行按请求串行（`reviewChange` 传 `notifyOnFailure: false`），成功与失败各汇总为一条 toast；失败行保持勾选便于重试。同一页经 `formatWorkflowDisplayText` 把流程状态（含列表头筛选标签）显示为产品中文（如 `硬件Committer检视` → `硬件MDE检视`），并提供下方记录的无修饰键队列快捷键。经运行时通知透出的服务端失败统一走 `toUserErrorMessage`（`src/infrastructure/http/userErrorMessage.ts`）：按 `WiseEffApiError.code`（及已知 `details.reason`）映射中文话术并附短请求编号后缀；未知错误码保留服务端原文但仍可报障，fetch 层网络失败给连接话术。

审计中心（`/audit`）的筛选下推到 `GET /api/v1/audit-events`：文本搜索（`q`，服务端匹配操作/类型/对象/操作人）、时间窗（今天 / 近 7 天 / 近 30 天，经 `from`），加上既有的模块分组/项目/严重度/trace 筛选与游标分页。「导出 CSV」按当前筛选分页拉取全量（上限 2000 行）导出 UTF-8-BOM、中文表头的 CSV，模块/类型/操作/严重度均为中文标签，并保留原始类型标识列供机器筛选。mock 模式下相同筛选在客户端执行。

本地账号注册没有组织下拉；新账号加入评估组织（有种子时是 ChargeLab）。自助注册角色下拉使用：`guest`、`hardware-user`、`software-user`、`hardware-committer`、`software-committer`。`admin` 与 `platform-admin` 只能通过组织管理分配，且后者仅已持有 `platform-admin` 的调用方可以授予或撤销；不能在注册页自助选择。

## 端口和实现

前端页面不要直接拼业务写入逻辑，而是调用 application ports：

- 参数管理：`ParameterRepository`
- 参数看板：`ParameterDashboardRepository`
- DTS 结构化产品面：`DtsStructuredRepository`（`resolveDtsStructuredRepository` → mock / `dtsStructuredClient`）
- 日志分析：`LogAnalysisRepository`
- 产品反馈：`ProductFeedbackRepository`
- 知识库：`KnowledgeRepository`
- 设备调试：`DebuggingGateway`
每个 port 通常有两类实现：

- `src/infrastructure/mock/*`：本地演示和单测。失败经 `mockApiError` 抛 `WiseEffApiError`，而不是裸 `Error`。
- `src/infrastructure/http/*`：API runtime，负责 `/api/v1` 请求和 DTO 映射。

P3 / P3.1 新表面（均走 `DtsStructuredRepository`，勿在新面板里直接 new HTTP client）：

- `submitStructuredEdits`：经 `POST /api/v1/projects/:projectId/dts-structured-edits/submit` 提交结构化编辑；CR 与 CST 回写载荷用 `rawText`（非 `normalizedValue`）保真。共享验收/CI 库为 post-cutover（语义身份）。`PROJ-CONFIG-EDIT-001` / `PARAM-DTS-EDIT-002` 在可丢弃 post-cutover 运行时上证明 live submit。
- `StructuredValueEditor`：按 `valueType` 编辑 `rawText`（与后端值类型对齐的客户端校验）。
- `DtsStructureBrowserPanel`：结构浏览、属性编辑、本地变更集聚合与「提交变更请求」；需 `parameter:edit`（`canEdit`），安全关键节点另需 `parameter:edit-critical`（`canEditCritical`）。
- 配置工作台统一检索：路径 / `@地址` / 标签 / compatible / 值检索，挂在规范路由 `/parameter-admin/projects/:projectId/configuration` 的源结构区（旧 `DtsSearchPanel` 页面式挂载已随 cutover 移除）。
- `ConfigSetBaselinePanel`：配置集 / 基线 / 对比 / 发布 / 导出，同对话框「配置集 / 基线」标签；对比变更集行映射真实参数并可走同一提交端口。
- `StructuredDiffView`：基线结构化差异与变更集行。

旧的 `ProjectParameterFilesPanel` / 冲突面板通过 `resolveParameterFileRepository(runtimeMode)` 注入 `ParameterFileRepository`（mock：`createMockParameterFileRepository`；API：`createParameterFileClient`），组件内禁止 `createParameterFileClient()`。mock 模式下可演示文件列表与冲突面板，不直连 `:8787`。

`AuditQuery` 是审计事件的只读端口（Activity 时间线等投影）；前端的审计写入走后端路由，不经前端端口。经 `resolveAuditQuery(runtimeMode)`（`src/application/parameters/auditQueryRuntime.ts`）解析：mock 返回空列表适配器（不打 HTTP）；API 包装 `createAuditClient`。项目配置工作台必须注入 `listAuditEvents`，页面模块内禁止 `createAuditClient()`。

配置工作台的领域动作以 Workbench session 形式落在 `src/application/project-configuration/`（见 `CONTEXT.md`）：`StructuredEditSession`（结构化草稿）、`CandidateVersionFlow`（候选版本）、`ReleaseBaselineSession`（发布就绪/基线）、`ConfigRevisionGateSession`（经拓扑接缝列出/选择配置修订并校验，把 `requiresConfirmation` 交给发布 ConfirmDialog）、`ConflictLocateFacade`（冲突加载与定位投影）、`ConfigSetOpsSession`（配置集创建/增删成员/导出/手动同步）、`WorkbenchNavigationSession`（URL/选区与统一搜索）、`WorkbenchWorkspaceLoadSession`（配置集/文件/成员/活跃源码/结构加载与重试）、`WorkbenchCanvasHistorySession`（历史/对比源码与工作画布快照）、`WorkbenchActivitySession`（活动时间线加载；事件定位仍经壳层 + Navigation）。对应 `use*` hook 仅为 `useSyncExternalStore` 适配；优先测会话命令接口。壳层（`ProjectConfigurationWorkbench`）保留 ConfirmDialog 所有权、跨会话桥接与展示适配器接线（`WorkbenchCommandBar`、`WorkbenchInspectorPanel`、`WorkbenchSourceTree`、`WorkbenchSourceCanvas`、`WorkbenchTaskDock`）；导航/加载/画布/活动生命周期状态机在上述 session（wave-3 / #258）。

正式参数管理后台在侧栏只有一个入口「参数后台」（`/parameter-admin`）。组织治理与项目运营通过范围切换；`/parameter-admin` 会重定向到 `/parameter-admin/specs`（保留查询串）。组织配置对等入口为 `/parameter-admin/specs`（参数定义管理：定义库 + 内嵌匹配审核；有节点对应任务时嵌套 `/parameter-admin/specs/identity-mapping`）与 `/parameter-admin/modules`（模块管理）。旧路径 `/parameter-admin/spec-review`、`/parameter-admin/identity-mapping` 永久重定向到新位置并保留 query（ADR-0015）。`/parameter-admin/projects`（规范深链 `/parameter-admin/projects/:projectId/configuration`；旧 `files`/`config-sets`/`structure`/`conflicts` 兼容重定向）仍可深链访问，并保持同一侧栏项高亮。面板只依赖 `createParameterAdminApplication` 门面（底层 `ParameterTopologyRepository`、`ParameterModuleRegistryRepository` 与导入 actions，mock/api 同源），跨面板状态在 `ParameterAdminProvider`，不读全局 `PrototypeState`。筛选/排序/选中以 URL 查询参数为唯一真相源。批量导入为组织子路由的 TopBar 操作；规格审核走 cursor 分页；参数库客户端分页（50/页）并默认隐藏 `#…` 结构属性。项目域以配置工作台为规范入口（清单 CTA「配置工作台」）；旧四视图页面式面板已移除。操作 ID `PARAM-IDENTITY-MAP-ADMIN-001` 跟踪后台侧身份映射覆盖（浏览器验收改挂见 #198）。`pageUsesProjectScope` 不含管理后台路由（ADR-0001：组织域与项目运营各自自有选择器，不挂 TopBar 项目选择器）。

项目清单入口打开 `/parameter-admin/projects/:projectId/configuration`（文案「配置工作台」）。该路由是全屏、源码主导的工作台：配置集/文件 query 选择 Working configuration；成员/未编组身份与 active source 在 mock/API 两种 runtime 中均经既有 `DtsStructuredRepository`、`ParameterFileRepository` 读取。源码定位导航（#229）在选中成员下嵌套结构节点树，经 `ProjectPrimaryDtsViewer` 滚动/高亮 CST span，提供按文件分组的统一搜索（省略 `by`=全维度）并可跨成员跳转，恢复 `configSet`/`file`/`node`/`property`/`sourceMode` 深链；树元数据与源码独立加载/重试。键盘辅助使用 Alt+F / Alt+N / Alt+G / Alt+1 / Alt+2（非输入时 `/`），不覆盖浏览器/系统快捷键。上下文检查（#230）按配置集/文件/节点/属性打开对应检查器内容，回退时保留源码选择；文件检查列出不可变版本（来源标签、操作者显示名或「未记录」、时间）并经 `ParameterFileRepository` 下载；Admin 经 ConfirmDialog → `rollbackVersion` 把历史版本恢复为当前（插入 `origin=rollback`，不倒带）；画布模式 `working` / `history` / `unified-diff` / `side-by-side` / `candidate` 保持只读，退出后恢复先前工作配置目标与滚动（`structured`/`raw` 仍为 Working 别名）。候选上传（#231）启用「上传候选」，经 `ParameterFileRepository.createCandidate` 创建暂存候选且不改变活跃版本或配置集成员，在候选源码模式与检查器中展示影响证据（文本/结构 diff、诊断、覆盖/映射、冲突、阻断），支持 blocked/stale 重算以及对 ready/blocked/failed/stale 的放弃，并保持工作配置/文件版本/候选/发布基线身份各自独立标注。候选激活（#232）增加影响确认对话框与 `ParameterFileRepository.activateCandidate`（expected-current-version CAS）；新文件激活需显式配置集成员角色；过期基保留工作配置并要求重算；blocked/failed/abandoned/stale 不可激活；成功后刷新文件/成员/源码且不做整页重置。结构化编辑会话（#233）在属性检查器中打开 `StructuredValueEditor`（`canEdit` / `canEditCritical`），把会话草稿收入任务坞，经 `submitStructuredEdits` / `aggregateLocalStructuredEdits` 校验并提交所选子集，树与源码装订线共享属性身份，源码画布保持只读（整文件替换仍走候选路径）；可恢复会话草稿（#234）在本地持久化补丁与变更原因（从不存整份 DTS 源码），按用户/组织/项目/配置集/文件/基线作用域：导航或刷新在基线匹配时还原，基线变更后草稿仍可检查/复制但阻断校验/提交直至重新确认，脏草稿离开经 ConfirmDialog，退出登录经 `clearSessionDraftsForLogout` 清空；缺少编辑能力时用产品语言锁定写入并保留只读上下文。文件与配置集操作（#236）支持 Admin 创建/配置配置集（含校验与重名处理）、以角色与顺序增删成员并经 ConfirmDialog 确认影响范围、未编组文件在明确编入前保持在工作配置/发布就绪度之外、经 `ParameterFileRepository.syncFile` 手动同步并写入任务证据、从命令栏经 `DtsStructuredRepository.exportConfigSet` 导出选中配置集；空配置集给出聚焦的候选上传/编入路径且不自动激活；`canAdmin=false` 拒绝变更但保留只读上下文。冲突裁决（#235）从任务条打开源码定位的三方冲突坞：基值 / 文件或候选值 / 待处理界面草稿带出处与可读版本标签，两侧等权「使用文件值」「保留界面值」经 ConfirmDialog 确认并可写审计原因，队列在源码上下文中前进，合格批量裁决须先看影响预览，空队列保持坞折叠而不单独空页；开放冲突继续阻断候选激活。发布就绪（#237）经 `getReleaseReadiness` 把唯一服务端权威结果写入命令栏摘要与 Issues 任务坞（有序阻断/警告、定位与 remediation）；创建/发布要求匹配的 `gateToken`，在阻断、不可用、过期或本机会话脏时失败关闭；前端不得用无关客户端计数重建发布权限。发布基线（#238）在检查器坞（`WorkbenchBaselineDock`）展示草稿/已发布/历史身份与钉住成员，可对 Working 或已发布 tip 做统一/并排源码对比（退出恢复先前 Working 位置），发布需警告确认与影响 ConfirmDialog（旧 tip → historical，刷新 drift/就绪），恢复经 blast-radius 预览与原子回滚且不改当前已发布 tip。检查器默认叠层，仅当测得工作台宽度使源码画布仍 ≥640px 时变为常驻（PCW-D15）。活动时间线（#239 / PCW-D11）在命令栏提供「活动」入口，打开基于 `listAuditEvents` 的项目范围审计投影检查器（参数治理相关 app）；事件以产品用语呈现操作者/动作/目标/结果/时间，可定位时恢复配置集/文件/候选/节点/属性上下文，缺失目标仍可读。旧 `/files` `/config-sets` `/structure` `/conflicts` 深链在兼容期内重定向到等价工作台上下文；`ProjectOperationsDialog` 与四视图页面式面板已移除（#240）。
只读工作台通过 `DtsStructuredRepository.listConfigSetFiles` 调用 `GET /api/v1/projects/:projectId/config-sets/:configSetId/files`，返回项目/组织范围内的成员角色、排序、格式与 active version 身份；页面不直接创建 HTTP client。

**项目 tab 视觉约定：** 深链视图共用 `.param-admin-panel` 外框与 `.param-admin-panel__section` 分组（配置集/基线）；空队列用 `ParamAdminEmptyState`（`.param-admin-empty`）承载短状态、可选说明与下一步动作。作用域导航（`.parameter-admin-scope-nav`）视觉权重大于组织子导航（`.parameter-admin-subnav`），以表达包含关系：作用域用更大、实心主色选中 pill 并带轻阴影；子导航为更小的描边 pill，且每个对等项（含未选中）都有边框，避免被读成静态文案。项目列表页只保留权威标题「项目清单」；TopBar 副标题对应清单或深链视图名，不再重复「项目运营」。清单行展示治理信号（「冲突」开放数、「基线」已发布/无已发布），数据来自 `GET /api/v1/parameters/admin/projects`。参数文件页先文件列表、后结构化检索，检索文案指向「结构浏览」做树形编辑。

**项目运营是盖在清单上的深链弹窗（ADR-0001）：** `ProjectOperationsDialog` 在项目清单之上呈现四个视图，URL 仍为 `/parameter-admin/projects/:projectId/:view`。它接入共享的 `ModalDialog` 契约（portal、焦点陷阱、背景 `inert`、仅最顶层 Escape、遮罩关闭成对判定）。外壳是一个权威 `<h2>`（项目名）、共享视图导航（`.project-operations-nav`，`aria-current="page"`，支持左右/Home/End 移动焦点）、来自审计中心的最近事件投影（`recentAuditEvents` ← `listAuditEvents`，治理变更后刷新，不再使用本地 `PUSH_AUDIT_HINT`），以及可滚动的正文区。卡片固定高度（`min(88vh, 920px)`），只让正文滚动；≤768px 时变为全视口 sheet。四个面板统一使用 `<h3>`。访问过的视图保持挂载，因此筛选、选中节点与结构浏览的未提交草稿在视图间切换时不丢；关闭弹窗（或 Escape）且有未提交草稿时会先弹确认。未知项目 ID 在清单页渲染 not-found，不再把原始 ID 当弹窗标题。结构化检索命中会跳到结构浏览并选中该节点；若节点在别的文件，会明确说明。

**共享弹窗契约：** 弹窗统一使用 `ModalDialog`（`src/components/common/ModalDialog.tsx`），它 portal 到 `document.body`，并负责卡片上的 `role="dialog"` + `aria-modal`、自动生成的 `aria-labelledby` / `aria-describedby`、初始焦点、Tab 焦点陷阱、关闭后焦点归还触发元素、应用根节点 `inert`、只有最上层响应 Escape，以及 pointerdown/pointerup 成对判定的遮罩关闭（在卡片内按下、卡片外松开的文本选择不会关闭弹窗）。`ConfirmDialog` 在其之上承载不可撤销的治理操作（发布/回滚基线、把文件历史版本恢复为当前、移除配置集成员、冲突裁决），支持门禁返回 `requiresConfirmation` 时的确认勾选，以及可选的裁决原因并写入审计提示。由于 portal 把卡片移出了 `.param-admin-shell`，参数后台弹窗样式同时按遮罩类名生效（`.param-admin-modal-backdrop .button`、`… .dialog-actions`），由 `ModalDialog.styles.test.ts` 守住这对选择器。层级只用 `:root` 里声明的一套刻度（`--z-xiaoze-fab: 1100`、`--z-xiaoze-popup: 1140`、`--z-modal-backdrop: 1150`、`--z-modal-backdrop-nested: 1160`、`--z-xiaoze-approval: 1250`、`--z-toast: 1350`），不要再加临时 z-index 数字。业务弹窗因此会盖住无模态的小泽窗口，小泽审批卡和 toast 仍在其上。`XiaozeApprovalCardContent` 通过 `AlertDialogContent` 新增的可选 `overlayClassName` 把 `--z-xiaoze-approval` 同时应用到 overlay 和 content（其他 `AlertDialog` 消费方仍保持默认 `z-50`）。

**项目运营面板要点：** `DtsStructureBrowserPanel` 需要显式传入 `fileId` / `versionId` / `fileName`，都没有时显示指向真实下一步的空态，不再加载教学样例；权限受限时只用产品语言说明一次并锁定编辑器（不暴露权限 slug），安全关键节点的警示权重与写入风险匹配；`onDirtyChange` 上报未提交草稿供页面拦截导航，`focusRequest` 用于选中检索命中的节点。`ConfigSetBaselinePanel` 已随四视图面板在 #240 从产品面移除。规范发布表面是配置工作台检查器：经 `ParameterTopologyRepository.listConfigRevisions` 列出所选配置集的真实修订、选择列表中的 id（不发明 `revision-teaching-1`），再对该 id 运行 `validateRevision`；软通过且 `requiresConfirmation` 时，发布基线 ConfirmDialog 须勾选确认。`ParameterFileConflictPanel` 两侧动作等权重，展示出现时间与来源文件版本，标题带开放冲突计数，裁决经确认框并可填原因。`ProjectParameterFilesPanel` 已随四视图面板移除（#240）。配置工作台文件检查器列出版本号、当前版本标记、来源标签（含「版本回滚」）、时间、操作者**显示名**（`createdByDisplayName`，缺省「未记录」）与逐版本下载；Admin 经 ConfirmDialog（「恢复为当前」）把历史版本恢复为当前，API 插入 `origin=rollback` 指针版本且不倒带历史。验收 `PARAM-FILE-ROLLBACK-001` 为 planned（playwright-cli 证据 `work/ui-checks/param-file-rollback/`；共享 Playwright 等 TD-079）。

**定义库治理（`/parameter-admin/specs`）：** `OrganizationSpecGovernancePanel` 承载 `ParameterSpecLibrary` 与内嵌 `SpecReviewQueue`。**新建定义**打开 `SpecCreateDialog`（归属主体来自 `GET /api/v2/parameter-modules` 中带 `attributionSubjectId` 的驱动组/节点类型；创建体覆盖必填 `propertyKey` + `reason`，以及可选 `displayName` / `description` / `documentation` / `valueShape` / `constraints` / `units` / `exampleValue` / `overridePlatform`；可选 compatible 以便创建后带 `overlay-property` 类型 `coverageClaim` 激活），调用 `POST /api/v2/parameter-specs`。**软废弃/恢复**经 `ParameterSpecDetailDialog` 原因门禁（`POST .../deprecate`、`POST .../restore`）；创建/激活/废弃/恢复/完成版本切换/身份纠错成功路径以固定位置短 toast（`logs-feedback-toast`）反馈。定义库**默认隐藏 `deprecated`**（生命周期筛选可显式包含）；审核绑定选用仅允许 `active` 与本组织可激活 `draft`。库表**参数定义**列仅显示 `property_key`；**所属模块**列优先显示实测归属树路径，否则显示归属主体 displayName（API 字段 `driverModule` 仅在线上保留为展示字段）并标「未实测」，或「未归类」。`driverModule` 不再作为定义身份或 `?driverModule=` 筛选键；筛选走 `attributionSubjectId` / 所属模块列。定义库没有业务分类列（`?category=` 不往返）。弹窗内把实测所属模块路径与声明的归属主体分成两行：所属模块只报绑定观测；声明主体带「声明」标记。「修正归属」在任意生命周期纠正声明主体，不改模块树；「修正属性键」仅零引用时可用，有引用时禁用并给出引用数原因。有引用改名走编辑器内单独的**属性键源改写**面板（预检 → 启动 → 暂存文件草稿 → 人在配置工作台合入现行源 → 完成切换），不启用行内改键。暂存后，每个文件候选用文件名作为可操作入口，SPA 深链到该项目配置工作台的现有候选审阅（`/parameter-admin/projects/:projectId/configuration?configSet=…&sourceMode=candidate&candidate=…&inspector=file`）。面板用产品中文展示候选实况（已暂存 / 已合入现行源 / 已放弃），不会自动激活或合入现行源。再预检全部为「源已是新键」后才可完成切换。三元组冲突（含默认库隐藏的已废弃阻挡方）用产品中文展示占用方定义 id 与生命周期。引用数只在弹窗头部出现一次，没有「使用与历史」分组。值形状是封闭 kind 下拉，打开时不补历史缺失键。约束是带即时校验的 JSON 对象编辑器；示例值接受 DTS 或 JSON。保存/激活原因在确认步标为必填。废弃定义即使接了保存回调也使用只读眉标。弹窗外壳走 `ModalDialog`，遮罩类 `.param-admin-modal-backdrop`（`--z-modal-backdrop`，高于小泽 FAB 与无模态小泽聊天浮窗）。保存/生命周期/版本切换/身份确认叠层再加 `--nested`（`--z-modal-backdrop-nested`）。编辑区是滚动区域，与动作条用 `--border` 分隔；版本切换面板间距用 class，不用内联样式。**驱动登记/模块治理**在驱动组行只读展示 `driverNature` 与 `instanceCardinality`（来自 `GET .../driver-registry`）。独立 `ParameterAdminAuditBanner` 已移除——各面板经 `ParameterAdminProvider` 推送紧凑审计提示（`PUSH_AUDIT_HINT`）；项目运营面板仍可内联展示最近一条。**节点对应**（`/parameter-admin/specs/identity-mapping`）由 `IdentityMappingReview` 展示 `taskKind` 徽标（`identity-ambiguity` / `singleton-cardinality`）。歧义任务支持**确认对应**（`resolved`）、**声明新身份**（`new-identity`；多候选须勾选 `confirmAllCandidates`）与**驳回**（`dismissed`）。`singleton-cardinality` 任务仅展示登记/拓扑修复指引，不提供身份决议控件（API 返回 `409 singleton-cardinality-conflict`）。工作台仅提示发布阻断；完整处置仅在此后台路由。

已解决的节点对应历史会显示当前候选。歧义任务保存了上一节点/原选择连续性且还有另一候选时，同一候选选择器提供**受保护 re-resolve**；若相关节点已有下游草稿、提交或设备操作，服务端拒绝更正。对已应用映射，UI 不提供反向 undo 或 reopen（ADR-0033）。

语义身份 UI 在 `src/components/parameter-topology/`：参数库与审核队列、源树/生效树浏览、**节点启用状态**（拓扑树启用/禁用徽标与不可达标记、工作台参数行不生效提示、`DtsNodeEnablementDialog` 三态编辑并与 binding 草稿共享工作 tip）、类型化绑定编辑与正式提交、身份映射决议、配置修订列表/选择与失败关闭的配置 revision 校验（配置工作台检查器在发布基线表面恢复该门禁）。`DtsNodeEnablementDialog` 使用共享 `ModalDialog` 契约；校验进行中不提供 dismiss handler，Escape 和遮罩都不会中断待完成的草稿。API 模式走 `/api/v2`；DTO 分字段暴露 `exampleValue` / `schemaDefault` / `policyTarget` / `effectiveValue`，无业务 `recommendedValue`。Cutover 后遗留扁平参数 ID 不做兼容投影。本地 `npm run dev` / `dev:all` 默认处于 **post-cutover** 语义种子，类型化 binding 草稿可直接提交审核。

API 模式 `/parameters` 保留成熟的 `ParametersPage`/`WorkbenchLayout` 层级，在 `ApiProjectTopologyWorkspace` 内嵌 `DtsParameterWorkbench`。协调器继续负责真实 API 加载；工作台以**业务模块优先导航**（默认模块 → 参数；**`groupByDevice` 器件实例层已在生产启用**——无需每实例注册表行即可浏览 `hl7603@77` 等实例；默认只展开到第 2 层；若仅有一个业务包装根如 Power 则提升其子节点为导览根，精确名为「未分类」的并列根保留）为主，**技术视图**在保留左侧模块导览的同时将右侧结果区切换为只读项目主 DTS 源码，并在**工具栏下方**保留本轮修改区、**只读参数详情弹窗**（查看）、**本地草稿弹窗**（编辑 / 加入草稿）与 binding 提交面板；草稿卡对简单值用箭头预览，对复杂值用行级 `+/-` diff 与等宽编辑器；校验成功后卡内保留「服务端校验通过，草稿已创建」，并进入本轮修改托盘，主表同行显示「草稿」徽章。托盘值变更同样用 `ParameterValueDiff`，条目旁展示所属模块名（不再显示设置/删除属性动作标签），且不展示技术身份。模块归属来自注册表（`GET /api/v2/parameter-modules`：v1 模块 + DTS 映射）；模块 CRUD 仍走 `/api/v1/parameter-modules`，DTS 驱动/compatible/实例映射走 `/api/v2/parameter-modules/mappings`。未映射绑定按驱动兜底分组。默认应用**可管参数面**过滤（`isParameterSurfaceRow`），结构性 DTS 属性（`#address-cells`、`compatible`、总线脚手架 locator）不出现在主列表；仅技术诊断时传 `includeNonSurface: true`。拓扑 locator 缺失时 fail-closed（排除）。DTS 根级 `board_id` 作为可管面行落在 `Board Identity` / `board`——ingest 与种子不会在「未分类」下物化名为 `/` 的产品模块。脚手架驱动（`amba` / `gic` / `gpio` / `spmi` 及其「未分类 · …」临时桶）也不进入默认可管账本，WiseEff 不将其作为业务参数处理。主表列：参数名、所属模块、当前值、重要性、操作；器件/驱动与 DTS 路径/类型/源出处收进详情。重要性为主信号并可排序；健康 `valid` 绑定不渲染治理徽章（存储层 `matched`/`reviewed` 归一为 `valid`），仅在异常时显示「待处理」/`attention` 或「阻断」/`blocked`。`attention` 仅对应开放身份映射任务；provisional-surface 的 `schemaState=unreviewed`（纯 overlay / 无 `compatible` 时常见）**不**抬升为「待处理」——该积压归属 Admin 规格审核队列。`attention` 仍可标记与开放身份映射任务相关的 binding，但决议 UI 仅在 `/parameter-admin`；工作台通过发布阻断项提示，不再内嵌底部映射审核区。工具栏**不提供**独立的修订「校验」按钮（L2 仍仅作 Admin/导出辅助）。**项目主 DTS 写回：** 每个项目一份自洽主 DTS（seed 为 `{projectId}-board.dts`）；仅含单个 `base` 成员的 config revision 将参数编辑写回该文件文本（CST span 合并），产品路径不再依赖共享平台 base DTS。见 [`../design-docs/2026-07-21-project-primary-dts-contract-rfc.md`](../design-docs/2026-07-21-project-primary-dts-contract-rfc.md)。**工具链分层：** L0（解析 + occurrence 写回）在编辑**与合入/写回**热路径；L2（`dtc`/`dtschema`）仅在 Admin 校验/导出/发布辅助。工作台默认**不展示** `dtc` / `ranges_format` 编译诊断。已提交 seed 板级 DTS 为产品真相源；`npm run dtc:seed:compile` 为 CI/工具链佐证，不是日常参数维护正确性的前提。见 [`../design-docs/2026-07-21-dts-parameter-surface-boundary-rfc.md`](../design-docs/2026-07-21-dts-parameter-surface-boundary-rfc.md)。工具栏仅保留语义搜索（参数名、模块、compatible/驱动、地址、拓扑路径、源文件/节点路径与 raw 值）；左侧导航选中仍可缩小列表范围。表格勾选草稿驱动本轮修改区的**所见即所提**提交：草稿默认全部勾选，提交范围就是勾选集合（全部取消勾选则不可提交），提交按钮动态显示 `提交审核（N 项）`，与勾选 binding 同一工作版本而「搭车」提交的节点启用草稿会在条目上显式标注。托盘「移除」会删除服务端草稿（`DELETE /api/v1/parameter-drafts/:draftId`）并刷新草稿列表——被移除的草稿不会在刷新后复活，也不会被下次提交连带提交；删除失败在托盘内联报错。提交成功后清空已消费草稿、选择集与 preferred candidate revision，重新加载草稿与拓扑，并保留一条可关闭的成功提示（含「查看变更审阅」入口），已消费 draftId 不可能再次提交。支持语义 CSV 导出；API 模式仍禁止扁平 Excel 与 `recommendedValue`。

API 模式语义列表与 mock-only 的旧 `ParametersTable` 分离。推荐值漂移、recommended value 草稿初始化、扁平详情/导出、遗留身份和教学拓扑回退均禁止出现在 API 模式。类型化编辑必须填写原因并保留 API 返回的 draft/binding/spec/candidate 身份及 `set|delete` action；submission wire item 发送 `draftId`、`projectParameterBindingId`、`parameterSpecId` 与 `action`，不得再让语义 binding 冒充遗留 `parameterId`。返回的 delete draft 在面板中显示“删除属性”和空 tombstone target。当前工作区尚无 delete authoring 控件，因此 delete 验收通过公开 typed-draft/submission API 创建与提交，但三段角色审核和 merge 仍使用真实 UI。TopBar 切换项目时，工作区清除上一项目的 preferred candidate revision、pending draft、候选人状态、发布消息和映射消息；新项目从自身 `current` 开始加载。草稿请求会捕获所属项目；若响应到达前已切换项目，UI 必须忽略该响应，不能回灌提交面板或为错误项目加载候选人。提交后由指定角色在 `/parameter-review` UI 推进。

**共享工作 tip（类型化草稿轮次）：**

- 同一用户×项目下的开放草稿轮次共享一个工作 tip。
- 后续每次类型化编辑必须以该 tip 作为 `baseRevisionId` 提交；服务端将兄弟草稿 rebase 到新 tip。
- 本轮修改区健康态文案为 **「本轮 N 项」**（N 为草稿数）。轮次内混用多个 revision tip 属于异常态，托盘会以中文给出可操作的修复指引。

- **未匹配规格审核：** `SpecReviewQueue` 对 unmatched 任务提供「创建规格」动作（resolve 时 `createSpec: true`）。库内决议若属性键与 occurrence 不一致，须在 UI 勾选确认后传 `confirmPropertyMismatch: true`，再调用 `POST .../parameter-spec-review-tasks/:taskId/resolve`。
- **草稿规格激活：** `ParameterSpecLibrary` 与 `DraftSpecActivatePanel` 供 Admin 保留完整推断 `valueShape`（bits/groups/cellsPerGroup/length，不得只留 kind 或默认 cells=1）并补齐 `constraints`/`documentation`，再调用 `POST /api/v2/parameter-specs/:specId/activate`。形状缺失/冲突时 UI 阻断激活。平台全局 draft 不对组织 Admin 展示可成功执行的激活操作（服务端亦返回 `403`）。resolve/release 在规格为 active 且约束完整前拒绝 draft。
- **Dashboard hotspot：** 租户项目的热榜须展示全局厂商规格（API 聚合 `organization_id IS NULL` 的规格）。

Provenance、绑定详情与映射/审核队列必须来自 API 响应（`sourceChain`、occurrence span、任务载荷）。API 模式下后端为空或出错时**不得**回退到教学/mock 拓扑数据。校验/发布文案须与门禁结果一致（`validated` vs fail-closed 撤销）；不得把 `schema-failed` 当作成功路径。

### 绑定模块身份、历史与跨项目对比（阶段二）

阶段二把模块身份物化到 `project_parameter_bindings`，并移除“读时派生”的兜底（干净切换，无兼容层）：

- **物化 `module_id`（唯一真相源）。** 每条 binding 都带非空 `module_id`，外键指向 `parameter_modules(id)`；浏览唯一键为 `(project_id, logical_node_id, parameter_spec_id, module_id)`（迁移 `0067`）。写路径（ingest / `createOrReuseBinding`）经 `resolveModuleForBinding` 按 **compatible → node-type → 未分类根** 解析模块——绝不为 null。`module_id` 须指向驱动组、节点类型单元或组织未分类根；器件实例身份仅为 `logical_node_id`（ADR-0010）。种子始终写入 `module_id`，工作台不会读到没有模块的 binding。
- **工作台以 `binding.moduleId` 为准。** `/api/v2/projects/:projectId/parameter-bindings` DTO 暴露 `moduleId: string`；`buildDtsWorkbenchRows` 直接读取 `binding.moduleId`，再从注册表（`GET /api/v2/parameter-modules`）取名称/重要性/排序。当 binding 已带 `moduleId` 时**不再**重新派生模块；`deriveModuleAssignment` 仅保留给重算工具与测试。
- **显式重算（管理员，运维）。** `POST /api/v2/parameter-modules/recompute-bindings`（可选 `{ projectId, dryRun }`）为现有 binding 重新解析 `module_id`。`dryRun: true` 仅预览不写库。面板将其作为历史 drift、seed 纠偏或身份连续性后对齐的全量回填工具；日常归类与驱动登记/认领已在写事务内按范围应用，无需再跑全量重算。
- **真实详情历史 + 跨项目对比。** 详情弹窗打开时，`ApiProjectTopologyWorkspace` 加载 `GET /api/v2/projects/:projectId/bindings/:bindingId/history`（由 revision 推导的 `from -> to` 条目）与 `GET /api/v2/projects/:projectId/bindings/:bindingId/compare`（同组织内共享 `parameter_spec_id` + `module_id` 的其他项目，排除源项目）。历史仅来自 `project_parameter_binding_revisions`——绝不使用遗留扁平 `parameter_history_entries`。历史 API 会折叠相邻 config revision tip 中 raw 值未变的快照（存储层仍按 config revision 保留 tip）；初始 tip 保留且 `fromRawValue` 为 null。由于绑定 revision 表没有 per-revision 的 actor / 原因列，历史不暴露 actor/原因。对比对端按 `projectId` 去重。查看弹窗仅保留精简入口（覆盖率摘要 + **打开跨项目对比**）；成熟对比面（目标选择、文本差异、`+/-` raw diff、项目概览、**使用该项目配置加入草稿**）放在次级 `DtsBindingCompareDialog`。`DtsBindingHistoryDiffDialog` 与对比弹窗共用 `ModalDialog` 叠层，Escape 只关闭子层并把焦点还给详情入口。对端作草稿写入本地草稿袋并打开 `DtsBindingDraftDialog`。空态显示「暂无历史记录。」/「暂无其他项目的对比数据。」，不再出现阶段一占位文案。
- **查看弹窗规格含义。** 定义编辑器会加载 `GET /api/v2/parameter-specs/:specId`，展示显示名、documentation/description、示意性 `exampleValue`（绝不作为推荐值）、单位、约束，以及可选的 `schemaDefault`。定义弹窗不再编辑 `policyTarget`（SE-D1 / TD-055）；GET 仍可能从 `parameter_policy_targets` 返回产品作用域行。

### 模块归属管理（`/parameter-admin/modules`，页签 **模块归属**）

`OrganizationModuleGovernancePanel` 组装 `ParameterModuleMappingPanel`，默认以 `ModuleAttributionTree` 为主界面，归类时打开 `ClassifyCompatibleDialog`。种子与 ingest 构建**分类学树**：**业务分类 → {驱动组 | 节点类型单元} → 嵌套节点类型\***；总线/脚手架节点不进产品树。组织映射仅匹配 `compatible` 或 `node-type`（无 `driver` 或 `instance` 匹配类型——ADR-0010）。

- **放置辅助：** `src/domain/parameter-topology/modulePlacement.ts`（服务端镜像在 `server/modules/parameter-modules/`）。
- **绑定写入：** ingest 经 `ensureAttributionModuleForBinding` + `resolveModuleForBinding` 写入 `module_id`。有 compatible 证据解析到驱动组；无 compatible 的配置节点解析到节点类型单元（裸节点名）。未映射 compatible 与无法放置的节点类型进入未归类队列；无匹配 binding 停放在未分类根模块上。
- **未登记队列（次级）：** 有待归类项时，模块归属内才出现子菜单「归属树 / 未登记驱动」及数量徽标（`/parameter-admin/modules/queue`），树视图顶部有提示条；队列为空时不渲染该切换器。队列表示「实测到但未登记」的差集（ADR-0007）。归类走 `ClassifyCompatibleDialog`；**认领登记**打开预填 compatible 的登记对话框。归类调用 preview → 范围 apply。旧书签 `/parameter-admin/modules/registry` 会重定向到归属树。
- **树上的驱动覆盖：** 不再有独立的驱动登记路由。`GET /api/v2/parameter-modules/driver-registry` 仍提供解析/实测覆盖，但呈现在归属树：驱动组行显示覆盖徽标（「官方解析覆盖」/「组织级解析覆盖」/「平台级解析覆盖」/「被更高优先级覆盖」/「解析覆盖 N/M」/「解析未覆盖」），可用默认关闭的「仅显示解析未覆盖」筛选；`ModuleEditDialog` 在每条 compatible 规则旁展示覆盖明细。Admin 编辑驱动组时可改 `driverNature` / `instanceCardinality`（与分类树 `node-type` 正交；保存时在模块更新后调用 `PATCH /api/v2/parameter-modules/driver-registry/:moduleId`），还可改注册**默认业务分类**（`PATCH .../driver-registry/:moduleId/default-business-category`）并执行**从注册回放放置**（`POST .../replay-placement`）：auto 跟随默认，curated 冻结。解析未覆盖时提供「配置组织级解析」，会先关闭模块编辑再打开 `OrganizationDriverSchemaDialog`；「添加参数定义」进入嵌套的 `OverlaySpecPickerDialog`（嵌入定义库搜索与列筛选表，可新建）。保存并激活走 `/api/v2/organization-driver-schemas`。若已存在平台级解析覆盖，配置组织级解析会被拒绝。登记/认领仍走 `POST /api/v2/parameter-modules/driver-registry`（树上按驱动组新建，或队列认领），并将所选业务分类写入注册默认。binding 数为 0 的 curated 驱动组与节点类型单元在树上标「未实测」，可用默认关闭的「隐藏未实测」过滤。`DRV-REG-004` / `DRV-REG-005` 的补充 playwright-cli 证据在 `work/ui-checks/attribution-deferred/`。
- **平台控制台（`/platform-console`）：** 仅 `platform-admin` 可见。列出跨组织晋升候选、展示不合格项的贡献方形状差异，并以明确的跨租户影响面确认执行晋升/撤销（`platform:schema-promote`）。
- **上传前新建（统一入口）：** 归属树「新建模块」打开带类型选择的 `ModuleCreateDialog`（`business` / `driver-group` / `node-type`）。父级按类型规则过滤（业务分类：根或其他业务；驱动组与节点类型：业务；节点类型可嵌套于节点类型）。驱动组须至少 1 条 exact compatible，并走 `registerOrClaimDriver`；其余 kind 走 `POST /api/v1/parameter-modules` 且 `origin=curated`。节点类型可填可选 `sourceKey`（`nodetype:{name}`）。
- **按 kind 分级的树：** `ModuleAttributionTree` 展示 kind 徽标（`business` / `driver-group` / `node-type` / `unclassified`）、**定义数**（DTO `definitionCount`，子树互异规格）与**实测处数**（DTO `parameterCount`，子树绑定）分列计数——树上不再出现第三列「引用数」。定义库详情的**引用数**（`referenceCount` / UI `usageCount`）是同一绑定事实收窄到单定义，与废弃影响共用。驱动组解析覆盖徽标与仅业务行的重要性（注册表 `effectiveImportance`）。同级**上移** / **下移**经 `PATCH /api/v1/parameter-modules` 互换 `sortOrder`；已在首尾或 kind 守卫禁止时，菜单项 `disabled` 并附内联原因。操作遵循服务端 kind 守卫（节点类型可移动/改类型；驱动组删除=解散；未分类根只读；业务与驱动组可添加子模块）。编辑弹框可在 `{business, node-type}` 间受控改类型（ADR-0010）。驱动组行显示只读摘要「N 条 compatible」与覆盖徽标；匹配规则与逐条覆盖状态在 `ModuleEditDialog` 内维护，不在树上直接移除。**Overlay 废弃**在 `ModuleEditDialog` 内先调 `GET .../deprecation-impact` 再 `POST .../deprecate`，展示覆盖丢失、定义/项目计数与可选后继来源；覆盖将丢失时须显式确认。从队列归类 compatible 时，在所选业务分类下创建的是 **驱动组**（不是业务分类），并写入 `source_key = compatible:{normalized}`；match 值会去掉 DTS 外层引号，使 `"mt,mt5788"` 与 `mt,mt5788` 视为同一杠杆。
- **定义库列：** `OrganizationSpecGovernancePanel` 与 `ParameterSpecLibrary` 从 `GET /api/v2/parameter-specs` 的 `attributionModules` 渲染 **归属模块**（binding 陈述的事实，无 `（预测）` 后缀）。已登记但未实测的驱动组显示 **未实测**；真正未归属的规格显示 **未归类**。
- **上传驱动摘要：** DTS 文件上传响应可带 `driverSummary`（`matchedRegistered` / `newUnregistered`），对照文件内 compatible 与已登记映射；`ProjectParameterFilesPanel` 上传成功后弹出 `DriverUploadSummaryDialog`。
- **运维重算：** 仅管理员的 `recompute-bindings`（可选 `dryRun`）仍为回填工具。映射创建/删除与 `POST .../driver-registry`（登记/认领）均在同一写事务内做 scoped `planScopedMoves`。`db:seed:m1` 在 ingest 后仍可执行 `recomputeBindingModules`。

## 主要页面流

参数管理：

- `/parameters`：API 模式只保留真实源树/生效树、binding 详情、类型化草稿与 binding 提交面板；mock 模式才保留旧扁平参数表。提交面板通过 `GET /api/v1/projects/:projectId/parameter-workflow-assignees` 加载三类候选人；任一角色无 eligible candidate 时失败关闭，提交时服务端再次校验所选 ID。
- `/parameter-review`：查看待审请求、推进或拒绝流程。
- `/parameter-admin`：mock mode 下保留直接管理体验；API mode 下写入应走 import/review 流程。批量导入向导（`ParameterImportWizard`）对完整 `.dts` / `.dtsi` 通过 `ParameterRepository.parseDtsImport` → `POST /api/v1/parameter-import/parse-dts`（或 mock CST 派生）解析，**不再**对 `dts-full` 静默回退 `parseDtsFragment`；含 `/include/` 时展示可读错误。跳过行汇总为 `reviewMetadata` 挂到 create preview / apply。大于 2MB 的 DTS 提示「将使用服务端解析」。

### 项目参数初始化

新建项目默认 `initialization_status = not_initialized`。创建者通过 `ProjectParameterInitializationWizard` 做一次性**语义 binding** 快照（或显式空库），提交初始化审阅；Admin 在 `/parameter-review` 的初始化 Tab 批准/驳回。

- Port：`ParameterInitializationRepository`；API 模式走 HTTP + 项目切换 hydrate；mock 实现同一 Port。
- 未 `initialized` 时 `ParametersPage` 锁定常规编辑；服务端 `submitParameterChanges` 经 `assertProjectAllowsParameterSubmit` 失败关闭。
- 设计见 `docs/zh-CN/design-docs/2026-05-20-project-parameter-initialization-design.md`；验收 ID：`PARAM-INIT-*`。

## 多层级模块树

参数域与调试域各自维护独立的组织级模块树。共享选择器：`src/components/common/ModuleTreeSelect.tsx`（展开/折叠、搜索、路径标签、单选与多选）；共享树筛选由 `TreeFilterOptions` 和稳定 ID 选择工具提供，各业务域仍传入自己的注册表和范围。

- `/parameters`：模块筛选与分组使用 `moduleId` 子树包含；深链 `?module=<moduleId>`。
- `/parameter-admin/modules`：`ModuleAttributionTree` 管理业务分类 / 驱动组 / 节点类型单元归属；「新建模块」走带类型选择的 `ModuleCreateDialog`（父级过滤、驱动组 compatible、节点类型可选 sourceKey），修改走 `ModuleEditDialog`（名称、在 `{business, node-type}` 间受控改类型、业务分类重要性、描述、适用范围），并保留移动与受控删除；库筛选与导入预览使用树形选择。
- `/debugging-admin`：与参数后台同类的范围导航——**参数调试**（`/debugging-admin`）承载重载配置；**节点调试**（`/debugging-admin/nodes`）承载可调节点目录。`DebugModuleManagementDialog` 管理调试节点模块树；节点目录与编辑弹窗通过 `ModuleTreeSelect` 选模块。

API mode 从 `/api/v1/parameter-modules` 与 `/api/v1/debugging/admin/modules` 加载；mock mode 由 `src/config/power-management.json` 的 `parent`/`path` 经 `buildPowerManagementModuleTree()` 派生。

mock mode 有意保留 12 个兼容参数，以保证组件测试与演示轻量。API mode 的 `db:seed:m1` 会在 seed 时从已提交的 `aurora-board.dts` 模板额外派生 228 个 DTS 来源参数；每个落库项目值都包含 `sourceFileName=aurora-board.dts` 和含属性名的 `sourceNodePath`。修改基础 DTS 或项目差异后，运行 `npm run dts:seed:generate` 重新生成三份项目主 DTS fixture。可选：`npm run dtc:seed:compile` 在 CI 中用钉扎工具链验证 seed 板——不是产品正确性叙事的前提（seed 板为 SoT）。
- `/parameter-home`：参数看板首页。UI 位于 `src/features/parameter-home/`，通过 `ParameterDashboardRepository` 读取 `/api/v1/parameters/dashboard/summary` 与 `/api/v1/parameters/dashboard/hotspots`。页面内 `AnalysisContextControls` 负责时间窗口与热榜维度切换；`dashboardState` 为 `summary` 与 `hotspots` 维护独立异步分区（`idle | loading | ready | empty | error`）。`derivePersonalWorkbench.ts` 基于 `WorkbenchSignals` 与角色生成待办与场景入口。

日志分析：

- `/logs`：上传日志、轮询任务、展示报告和证据。上传弹窗含可选「业务域」下拉（API mode 经 `logActions.listLogDomains()` 拉取活跃域；默认「未分类（通用分析）」，域选择绝不阻塞上传；mock mode 仅显示默认项）。结论卡按 additive 的 `analysisSource` / `degradedReason` 渲染来源徽标：`rules-fallback` 显示醒目的琥珀色「降级分析 · 规则回退」徽标与原因说明；P2 提前收敛的 agent 结论（`analysisSource: "agent"` 且带 `degradedReason`）显示「降级分析 · 提前收敛」徽标与说明，绝不冒充完整分析；完整 `agent` 结果显示轻量「Agent 分析」徽标，绑定业务域时显示业务域标签；无来源的历史规则报告不渲染徽标。置信度**数字始终展示**（`/logs` 结论卡 `ConfidenceBar`、`/log-admin` 表格与 `LogRecordDrawer`）；文案由 `src/domain/logs/confidenceProvenance.ts` 的 `confidenceCaption` 按 `analysisSource` 映射：`agent` →「模型自估」（未校准的模型自估）、`rules-fallback` →「规则评分」（确定性规则引擎分数），无来源的历史报告保留原有文案（`/logs` 为「AI置信度」，`/log-admin` 为「置信度」）。管理表失败行仍显示 `-`。不隐藏数字，也不改成分档-only 展示；来源徽标与该文案相互独立。任务轮询改为自适应退避（1s×30 → 2s×45 → 5s，计划轮询总时长上限约 5 分钟，对齐 p95 ≤ 3min SLO 加余量），并保留按日志的 generation 守卫。「反馈分析质量」对话框在 API 模式下经 `submitFeedback`（`POST /api/v1/logs/:id/feedback`）真实落库：评级映射高→`helpful`、其余→`not_helpful`，问题描述作为 `note`；对话框带提交中/内联错误态，服务端接受后才关闭（mock 模式保留本地通知）。
- `/log-admin`：反馈、归档、重跑、治理操作；新增「业务域治理」区（列表 + 新建/编辑表单 + 画像 JSON 校验 + 归档），前端按 `logs.admin-domains`（Admin）门控，后端路由强制真实 `logs:admin-domains` 权限。业务域列表走 `admin/DataTable`（排序 + `aria-sort`、空态、行操作、状态下 `ColumnFilter`）；`/logs` 的 rawlog 表是行查看器，不是列表外壳，不要迁到 DataTable。`LogRecordDrawer` 同样展示来源/降级徽标，表格与抽屉的置信度数字文案按 `analysisSource` 区分（见上）。P2 起每个活跃域行提供「知识条目」编辑器（`DomainKnowledgeLinksEditor`）：从知识仓储列出**已发布**条目（带标题筛选）供勾选关联；条目不再是已发布的失效关联被标注并在整组替换保存时移除。关联集合限定分析 agent 的 `read_domain_knowledge` 检索（为空时退化为组织内通用检索）。与其余域治理一样仅 API mode 可用。新增「已归档」视图（经 `refresh({ includeArchived: true })` 加载）并提供行内「恢复」，归档随时可逆；归档后的撤销窗口延长为 10 秒。
- P3 分析质量与标注入口：`/log-admin` 新增只读「分析质量」区（`FeedbackQualityInsightsSection`）——`GET /api/v1/logs/feedback-insights` 的 DataTable（按业务域 × 分析来源 × Prompt 版本聚合有帮助率），跟随页面共享时间窗口，抽屉反馈提交后自动刷新；无数据时诚实显示「暂无反馈」，mock mode 显示 API 模式提示。`LogRecordDrawer` 对已完成记录提供「导出评测案例草稿」：`buildEvalCaseDraft`（`src/domain/logs/evalCaseDraft.ts`）组装金标准集 `case.yaml` 草稿（realLog: true、**deIdentified: false**、rootCauseCategory TODO、预填证据行号/根因要点/建议动作）与 `log.txt`，纯前端双文件下载；弹层展示 README 脱敏清单并声明必须人工脱敏、把 `deIdentified` 改为 true 后才可进入 `eval-cases/logs`——刻意不做自动入库/自动提交。上传弹窗文本日志口径为 `.log` / `.txt` / `.csv` / `.json`（与服务端 `supportedLogExtensions` 一致）；API mode 另声明压缩包支持（单文件 `.gz`、单条目 `.zip`，服务端解压），前端预检接受这些文件名，格式失败仍以服务端为准。mock mode 不假装解压压缩包。
- P3b 结果回调与按域模型覆盖：每个活跃域行提供「结果回调」编辑器（`DomainWebhookEditor`）——仅 https 的 URL、只写签名密钥（UI 只显示已配置状态与末四位；输入留空保持现有密钥）、启用开关、带审计的「发送测试投递」按钮，以及最近投递列表（按次一行：时间、结果/测试、第几次、已送达/重试中/投递失败、HTTP 码或错误）。保存走 `PUT /api/v1/log-domains/:domainId/webhook`；被 SSRF 拒绝的 URL 显示可读的内联错误。业务域表单新增「模型覆盖」字段（placeholder 留空使用全局模型），经域 PATCH 持久化（`modelOverride`；留空清回全局模型——端点/key/预算仍全局）；域列表新增「模型」「结果回调」状态列。与其余域治理一样仅 API mode 可用。

产品反馈：

- 应用壳层持有唯一的 `FeedbackDialog`；侧边栏和页面末尾的 `AppFooter` 都只触发这一实例，通过 `ProductFeedbackRepository.submit` 提交当前 `pagePath`、`pageTitle`、反馈类型、描述和图片文件。
- 普通认证页面在主滚动容器内渲染语义化页脚；全高项目配置工作台不渲染。营销首页在原有丰富页脚内嵌非 landmark 变体，避免嵌套 footer。
- `src/config/appFooterConfig.ts` 在构建时解析公开的版权所有者、版本和可选联系方式；联系方式不是绝对 `https:` 或 `mailto:` 时失败关闭并隐藏。
- `/feedback-admin`：Admin-only 反馈处理页，通过同一 port 列表/搜索/筛选、查看详情与附件、填写 `adminNote`，并按 `open -> in_progress -> closed` 推进状态。
- mock mode 使用 `src/infrastructure/mock/mockProductFeedbackRepository.ts`；API mode 使用 `src/infrastructure/http/productFeedbackClient.ts`，对接 `/api/v1/product-feedback` 及附件内容路由。

知识库：

- `/knowledge`（侧栏分组「知识库」）：条目列表用共享 `ColumnFilter` 做状态/标签列筛选;检索框只命中 `published` 条目,结果如实标注检索模式（语义 + 全文 vs 仅全文）;分栏编辑/预览的 Markdown 编辑器（`src/domain/knowledge/markdown.ts` 先转义再渲染）;文件条目上传后展示提取状态徽章;修订历史支持「恢复为新修订」。API 模式额外提供「问知识库(小泽)」入口,派发小泽打开 handoff——mock 模式无 Agent UI,入口隐藏。`?entryId=…` 深链（小泽引用使用）直接打开条目详情。
- `/knowledge-admin`：Agent 草稿发布队列（Phase 3）——`list({ status: "draft", sourceType: "agent" })` 行含创建人、会话来源、来源深链（日志来源为 `/logs?logId=…`,重载来源为 `/dts-reload?runId=…`）与创建时间;逐行审阅（`/knowledge?entryId=…`）、发布、以及 `ConfirmDialog` 确认后的拒绝归档（`rejectAgentDraft`）;另有已归档条目恢复、manage 门控的彻底删除（带确认勾选的 `ConfirmDialog`）,以及检索索引健康区——诚实的检索模式横幅（pgvector/嵌入可用性）、逐条目索引状态与失败原因、单条重试与全量重建。条目详情对话框展示同样的来源链接。
- 沉淀为知识（Phase 3）:日志分析结果页（`src/features/log-analysis/LogsPage.tsx`）在分析完成且用户持有 `knowledge:edit` 时显示「沉淀为知识」;点击调用 `KnowledgeRepository.distillFromLog(logId)`,随后经 `/knowledge?entryId=…` 深链交接到草稿详情审阅并发布。mock 模式用 `src/domain/knowledge/distill.ts` 从原型日志记录构建同样的预填草稿（端口形状一致）;服务端预填只耦合已存储的分析记录 DTO。
- 重载运行沉淀为知识（延后路线图第 3 项）:`/dts-reload` 运行结果区仅在**终态**运行（已验证 / 不可验证 / 矛盾 / 失败）且用户持有 `knowledge:edit` 时显示「沉淀为知识」;点击调用 `KnowledgeRepository.distillFromReloadRun(runId)`,经 `/knowledge?entryId=…` 深链交接到草稿详情。`/dts-reload?runId=…` 深链打开历史运行详情,知识条目的来源链接由此回指证据。mock 模式用 `src/domain/knowledge/distillReload.ts` 从运行时共享的 mock `DtsReloadRepository` 实例构建同样的预填草稿;两侧预填都只耦合已存储的运行/快照 DTO,并诚实陈述结局。
- 晋升为草稿（ADR-0035 / TD-063）：同一运行结果区在普通 `verified` 运行，以及经 `ConfirmDialog` 确认后的普通 `unverifiable` 运行上显示「晋升为草稿」。点击调用 `DtsReloadRepository.promoteToDrafts`（`POST /api/v1/dts-reload/runs/:runId/promote-to-drafts`），再交接到返回的 `/parameters?project=` 工作台深链。**不**提交变更请求，也不做 CR UI。矛盾、失败与恢复基线运行不显示该按钮。UI 门控为 `debugging:dts-reload` 或 `admin:access` 加 `parameter:edit`；安全边界仍在服务端。晋升资格仅在 `src/domain/dtsReload/promotionGuard.ts` 单点定义；服务端与 mock adapter 分别把机器可读拒绝结果映射为既有英文/中文文案，数据库/内存幂等细节继续留在各自 adapter。
- 日志结果页相关知识:已完成的分析对持有 `knowledge:view` 的用户渲染「相关知识」区块（`src/features/log-analysis/RelatedKnowledgeSection.tsx`）。调用 `KnowledgeRepository.relatedToLog(logId)`（API 模式:`GET /api/v1/knowledge/related-to-log`;mock 模式:对已发布 fixtures 做字符 bigram 重叠打分——同样的仅已发布 + 相关度截断语义）,以 `/knowledge?entryId=…` 深链列出相关已发布条目,如实标注检索模式,并提供加载/错误态与诚实的「暂无相关知识」空态。
- 参数定义引用:条目详情以 chips 渲染条目的结构化定义引用（`src/features/knowledge/KnowledgeParameterReferenceChips.tsx`——显示名、归属模块与如实的生命周期徽章;已废弃定义按 ADR-0011 保留 chip 并显示「已废弃」）,深链到 `/parameter-admin?spec=…`。条目编辑器对既有条目提供「关联参数定义」选择器:搜索走注入的 `searchParameterSpecs` 缝（`ParameterTopologyRepository.listSpecs`,在 `src/app/routes.tsx` 仅当角色持有 `parameter.view` 时接线）,添加/移除即时调用 `KnowledgeRepository.addParameterReference` / `removeParameterReference`（服务端审计,独立于 markdown 保存;编辑器持有自己的引用状态,添加引用不会重置未保存的正文）。定义详情对话框（`ParameterSpecDetail`）新增「相关知识」区,由 `KnowledgeRepository.relatedToSpec(specId)` 提供数据（服务端 published-only）,经 `ParameterAdminProvider.relatedKnowledge` 注入且仅当调用者持有 `knowledge:view`——否则整个区块隐藏。
- 端口 `KnowledgeRepository`:mock 用 `src/infrastructure/mock/mockKnowledgeRepository.ts`（fixtures 覆盖草稿/已发布/已归档、提取失败文件与两条 Agent 草稿队列态,并模拟索引状态与参数定义引用,端口形状一致）;API 用 `src/infrastructure/http/knowledgeClient.ts` 对接 `/api/v1/knowledge/*`（含 `distill-from-log`、`distill-from-reload-run`、`related-to-log`、`related-to-spec`、`entries/:id/parameter-references/:specId`、`entries/:id/reject`、`index/status`、`index/rebuild`、`entries/:id/index/retry`）。过期保存映射为 `KnowledgeRevisionConflictError`,编辑器渲染为可读的刷新重试冲突提示,绝不静默覆盖。
- 能力接线:`App.tsx` 由 `/api/v1/me` 权限（API mode 的 `knowledge:view` / `knowledge:edit` / `knowledge:manage`）或角色检查（mock mode,`canView` 在 mock 下为成员默认）构造 `KnowledgeCapability`（`userId`、`canView`、`canEdit`、`canManage`）;UI 门控仅是 UX,后端路由才是安全边界。纯生命周期/可见性规则在 `src/domain/knowledge/rules.ts`。
- 小泽回答在助手 markdown 下渲染引用来源（`src/features/agent/XiaozeCitationSources.tsx`）：turn-reply 自定义事件与持久化线程消息携带 `citations`,知识引用深链到 `/knowledge?entryId=…`。

设备调试：

- `/node-debugging`：所有节点操作（检测/会话、读、写、快照回滚）都经 `DebuggingGateway` 端口，由 `resolveDebuggingGateway(runtimeMode)`（`src/application/debugging/debuggingGatewayRuntime.ts`）按运行时模式选择适配器：API mode 走共享 `apiClient` 的 HTTP gateway（读写节点、生成快照和审计，当前主入口）；mock mode 通过 `src/infrastructure/mock/mockDebuggingGateway.ts` 以同一端口提供种子化设备故事（2026-08-13 恢复 ADR-0002：Mock Bridge + 多协议 Aurora 设备、设备侧漂移值、诚实读写回读、`confirm-high-risk-write` / `confirm-rollback` 同款令牌门禁），路由同时注入 `createMockDebuggingBridgeSeams()` 使 Bridge 面板无 HTTP 探测。页面原有的裸 `/api/hdc/*` 回退（`src/hdcClient.ts`）已删除。
- `/dts-reload`：参数调试（产品名；技术能力仍为 DTS overlay 重载，与已退役的「参数重载」无关）。壳层与 `/node-debugging` 同族 workbench 节奏（`workbench-page` / `workbench-one-col`）：表前协议切换与共享 `LocalDeviceBridgePanel`（安装/配对/连接向导）、多目标时同款 `bridge-target-picker`（`targetRef`/`deviceId` 由 Bridge 检测与所选代理推导，不再单独放部署目标卡）、候选区 **左模块导航 + 右表**（`DtsReloadCandidateTable` 走 `admin/DataTable`：排序 + `aria-sort`、分页、键盘行；复用参数修改页的 `DtsTopologyNavigator` 与 `buildModuleTree`：模块注册表嵌套 + `groupByDevice` 器件层，可展开树状；选中节点按子树 binding 过滤表格；表头 **模块** 列另接共享 `ColumnFilter` 多选筛选；末列 **操作**：不可调试显示阻断原因，可调试显示铅笔「编辑」，打开 `WorkbenchSheet` 侧栏查看详情、上次重载历史并填写调试值，确认后写入本轮重载托盘；表内不再单独放「上次重载」列）、**本轮重载** 托盘对齐参数工作台「本轮已修改」：仅在有选中项时显示，并作为独立区块放在「可调试参数」上方（`Reload batch` eyebrow、基线→调试值 diff、就地编辑、主 CTA「下发参数」）、有运行时的结果面板，以及**默认折叠**的运行历史；标题依赖 shell（`appConfig`），页内不再重复 `h2`。Bridge 就绪 UI 与节点调试复用同一组件（`src/components/LocalDeviceBridgePanel.tsx`）。API mode 下列出项目候选参数、下发参数、预检 overlay、以 `confirm-dts-reload`（critical 敏感命中另需 `confirm-sensitive-reload`）部署，并展示重载快照、残留、恢复基线与运行历史。Mock mode 通过 `src/infrastructure/mock/mockDtsReloadRepository.ts` 以同一端口提供同一语义模型（2026-08-13 恢复 ADR-0002）：候选覆盖全部已支持值形态、可完整走通的运行生命周期（含重载快照证据）、分页运行历史、残留与恢复基线，并镜像同样的确认令牌闸门；端口用 `resolveDtsReloadRepository(runtimeMode)`（`src/application/dts-reload/dtsReloadRuntime.ts`）选择，路由在 mock 下注入稳定的 Bridge/目标/配对码座席，部署流程无需真机即可走通。配置 CRUD 在 `/debugging-admin`（参数调试范围）。客户端：`src/infrastructure/http/dtsReloadClient.ts`。编排状态机：**DtsReloadRunSession**（`src/application/dts-reload/dtsReloadRunSession.ts` + `useDtsReloadRunSession`，Workbench session 同款：snapshot + subscribe + 命令动词，逐方法窄 `Pick<DtsReloadRepository, …>` 依赖；候选加载、URL run 参数再水化、本轮编辑校验、启动、部署确认——`confirm-dts-reload` 只在显式确认命令中附加——恢复基线、部署目标与运行/历史/残留加载分页都在 session 内；优先对 session 命令接口做单元测试）。重叠的 protocol/bridge/target 类型与 helper 在 `src/application/bridge/bridgeTargetSession.ts`（#488）；reload 侧保留 `DtsReloadDeployProtocol` / bridge 摘要别名。实现：`src/features/dts-reload/DtsReloadPage.tsx` 已是 session hook 之上的渲染层，候选网格是 `DtsReloadCandidateTable`（`admin/DataTable`），展示辅助在同目录 `dtsReloadPresentation.tsx`，纯调试值预检在 `src/domain/dtsReload/debugValue.ts`（TD-069 拆分，计划 `2026-08-13-dts-reload-run-session.md`）。工作台交接（TD-064）：`/parameters` **带到参数调试** 生成 `/dts-reload?project=<id>&bindingIds=<id1,id2>`——优先草稿勾选，否则当前搜索/模块收窄结果，绝不整表倾倒。`/dts-reload` 按这些 id 过滤候选、显示横幅，且**不**自动填入本轮托盘（基线值会使下发变成空操作）。`?runId=` / `?run=` 仍独立；写回 run id 的 `replaceState` 会保留 `project` 与 `bindingIds`。晋升为草稿（TD-063 / ADR-0035）：成功的普通运行可把已存调试值写成参数草稿（「晋升为草稿」）；命令停在草稿，提交/审阅仍在 `/parameters`。它不是沉淀为知识，也不写库 binding。已支持重载值形态（TD-065）：u32/u8/u16 cell（含 `/bits/ 8`）、单字符串、字符串列表、GPIO 风格 `phandle-cells`、裸 phandle 列表（`<&gic>`）、布尔、空属性、mixed 字符串+cell，以及显式 `/delete-property/`。禁止从属性名猜编码。当前 `dtc`/`fdtoverlay` 把 plugin 里的 `/delete-property/` 编成空 fragment；预检拒绝该空操作，不把它当作已删除发出。
- `/debugging`：**产品下线**（TD-032）；路由显示不可用页并引导至节点调试。迁移 `0037` 已删除 `parameter_reload_bindings`；遗留 HTTP 仍返回 `410`。`DebuggingPage` 组件仅供历史组件测试保留，不可与 `/dts-reload`（现 UI 标题「参数调试」）混淆。
- `/debugging-admin`：范围导航拆为参数调试（重载配置）与节点调试（`/debugging-admin/nodes`）。API mode 下节点范围通过 `src/infrastructure/http/debuggingAdminClient.ts` 管理调试 catalog，可查询、新增、更新、归档、恢复并维护 HDC/ADB bindings。mock mode 保留本地 `configDraft` 和 JSON 编辑路径，用于演示和组件测试。

### 本地 Device Bridge（Phase A）

`/node-debugging` 与 `/dts-reload` 共用 `LocalDeviceBridgePanel`（`src/components/LocalDeviceBridgePanel.tsx`），其中三步向导（**安装 Bridge → 连接本机 → 插入 USB 设备**）位于 `src/components/LocalDeviceBridgeWizard.tsx`。面板通过 `deviceBridgeClient` 读取 `/api/v1/device-bridges/releases`，经 `pickBridgeReleaseForHost()` 优先选择 `artifactKind: "installer"` 的安装包；配对码来自 `/api/v1/device-bridges/pairing-codes`；设备代理列表来自 `/api/v1/device-bridges/mine`。

主连接流程：点击 **连接本地设备** → 首次可选确认（`wiseeff.bridgeSchemeConfirm`）→ `launchBridgeConnect()` 打开 `wiseeff-bridge://connect?...` → `pollLocalBridgeHealth()` 最多 30 秒轮询 `http://127.0.0.1:18787/health` → `connected: true` 后自动 detect。工具函数在 `src/infrastructure/http/bridgeConnectLauncher.ts`。

Phase B（Step ③ 工具）：health 含 `tools.adb` / `tools.hdc`；所选协议工具缺失时显示 `tools_missing` 与 **安装调试工具**（`bridgeToolInstallLauncher.ts`，`wiseeff-bridge://install-tools`，120 秒轮询）。detect 报错若指向 adb/hdc 缺失，提示安装工具而非「Bridge 未安装」。

`pair` / `start` / `connect` 命令行说明折叠在 **高级 · 命令行方式**；便携包下载在 **其他平台**。

浏览器 health 探测仅作 UI 引导；Bridge 设备执行仍由后端 session 与审计控制。Phase 2 的重命名/撤销与多 Bridge 目标选择行为不变。

### 调试管理后台 UI

页面壳在 `src/DebuggingAdminPage.tsx`；主区域为全宽**节点目录**表，模块树由 `DebugModuleManagementDialog` 管理，节点/参数库筛选使用 `ModuleTreeSelect`。

- `DebugNodeLibraryTable` — `admin/DataTable` 外壳（排序 + `aria-sort`、分页、键盘行）；工具栏搜索、模块树筛选、协议覆盖与行操作。导入/导出仍在标题区。
- `DebugNodeEditorDialog` — 逻辑节点元数据与模块归属。
- `DebugNodeBindingsDialog` — 每协议 HDC/ADB 路径 binding 编辑。

（API mode 的管理面只暴露逻辑节点目录；遗留参数 Admin HTTP/client 接口已退役，历史表与证据仍在服务端保留。Mock mode 继续从本地参数 fixture 派生精简节点目录用于 demo/组件测试。）

复杂调试参数通过 `src/debugValueKind.ts` 在管理端与运行时共享辅助逻辑。`DebugParameterDefinitionDialog` 提供值类型、格式、规范化模式，以及复杂当前值/目标值的多行代码编辑器。`DebugParameterLibraryTable` 显示紧凑格式徽章。`/node-debugging` 以紧凑预览和格式徽章展示复杂值，在宽 sheet 中打开查看/编辑，并在操作历史中显示 preview 与 digest，而不是完整 payload。

筛选与弹窗深链由 `useDebugAdminSearch` 同步 URL。mock mode 在表格下方保留可折叠的 **配置源预览**（`power-management.json` 导出/同步）。

Xiaoze（小泽，唯一 Agent）：

- API mode（`VITE_WISEEFF_RUNTIME_MODE=api`）始终挂载 `XiaozeProvider`（CopilotKit V2 + `HttpAgent`），SSE 对接 `POST /api/v1/agent/xiaoze`；`XiaozePageContextRegistrar` 声明 `wiseeff.page` 上下文。
- mock mode 不挂载任何 Agent UI，前端也不发起 Agent HTTP 请求。
- 视口宽度不少于 `768px` 时，小泽悬浮球可在完整的 `16px` 视口安全区内自由拖动；跨过移动阈值的拖动不会误触打开或关闭。独立位置只属于当前页面生命周期：正常松手，以及发生有效移动后由触控取消或 pointer capture 丢失结束的松手，都会保留最后坐标；展开或收起小泽及 SPA 路由切换后也保持不变，浏览器刷新后才恢复右下角默认位置。展开后拖动悬浮球时，弹窗会根据可用空间智能附着到球的上、下、左或右侧，因此两者持续可见，悬浮球也不会再被弹窗尺寸限制。中部品牌区仍支持指针拖动和方向键移动（默认 `8px`，Shift 加速到 `32px`）。页面保持可操作，点击外部和 SPA 路由切换都不会关闭；Home 或复位按钮恢复右下角默认布局，右下角手柄在固定弹窗左上角的前提下调整大小。弹窗矩形继续写入 `wiseeff.xiaoze.popup.layout.v2`，仅在手势提交时落盘。小于 `768px` 时保持全屏模态，停用悬浮球/弹窗拖动和缩放且不覆盖桌面布局。桌面 Escape 只有在焦点位于小泽或其审批层内时才关闭。
- P0：`perception.*` 只读工具。
- P1：`XiaozeApprovalCard`（`useInterrupt`）处理 mutating `action.submitParameterChange` 提案；低风险前端工具仅保留 `navigateTo`（`useFrontendTool`，不写库）——原 `prefillParameterValue` 因注册表无任何页面消费、会让小泽虚报「已预填」而被移除。审批卡已全中文化（批准 / 拒绝 / 目标值），payload 携带理由时渲染「变更理由」区块；拒绝提供可选理由输入（默认「在小泽对话中被拒绝」），随 interrupt resolve 的 `reason` 字段回传。`on_interrupt` emitter、审批卡与服务端 Zod schema 都编译依赖零依赖协议包中唯一的 `XiaozeInterruptPayload` shape。
- P2：后端 LangGraph 规划循环（intent → perceive → plan → act → observe）与 checkpoint resume；`VITE_XIAOZE_PROACTIVE_ENABLED=true`（且 API `XIAOZE_PROACTIVE_ENABLED=true`）时，`src/infrastructure/http/xiaozeSuggestionsClient.ts` 负责带认证的 `POST /api/v1/agent/xiaoze/suggest` 请求与响应合同解析；`useXiaozeSuggestions` 只消费类型化建议，并在失败时关闭为空 insight 列表。点击建议可预填打开小泽聊天。
- live LLM 使用 atomic `XIAOZE_LLM_API_BASE_URL`、`XIAOZE_LLM_MODEL`、`XIAOZE_LLM_API_KEY` 组三键（OpenAI-compatible）；验收可用 `XIAOZE_DETERMINISTIC=true`。

用户和身份：

- `/api/v1/me` 在 OIDC、HMAC smoke 和本地账号下返回同一类 `AuthContext`。
- 组织管理是一个侧栏入口、两条范围对等页（与调试后台相同）：`/organization`（组织档案，`GET`/`PATCH /api/v1/organization`）和 `/organization/members`（人员管理）。页面 key 仍是 `user-permissions`。`/user-permissions` 永久重定向到 `/organization/members` 并保留查询串。人员页在 API mode 下通过 `/api/v1/users` 读写用户治理，并通过 `/api/v1/users/registration-role-requests` 处理待审批的 Committer 注册申请。管理员在“添加用户”中创建的是本地账号：表单使用姓名、用户名、可选职务、初始密码和初始角色，不再把邮箱作为账号标识。该账号会加入当前管理员所在组织并立即启用；密码只提交给后端创建凭据，前端用户状态不会保存明文密码。若目录响应不含当前调用者，状态只保留 `/api/v1/me` 返回的真实当前用户以稳定外壳身份，不会恢复演示用户。治理 action 提供 `resetUserPassword` 时，成员行可打开重置密码弹窗，提交 `POST /api/v1/users/:userId/password`，并提示该用户全部会话已退出。
- 前端权限检查只是 UX，后端仍必须执行 authz、self-lockout 防护和 audit。

## 快捷键与地标

应用壳和 `/parameter-review` 遵循 macOS 感知的快捷键约定（TD-097 切片；其它页保持既有辅助键）：

- 平台主键在 Apple 上是 ⌘，其它系统是 Ctrl（`src/app/keyboardShortcuts.ts` 的 `formatPrimaryShortcut` / `isPrimaryModifier`）。
- 新的产品快捷键不要绑定 ⌘/Ctrl+字母，那些留给浏览器和系统。页面辅助使用 Alt+字母，或在非输入时使用无修饰键（与配置工作台 Alt+F/N/G/1/2 同一原则）。
- 应用壳提供「跳到主内容」skip-link（指向 `#main-content`）、带标签的 `header` banner、带标签的 `nav`，以及 `main` 地标。`/parameter-review` 的 main 名称来自 TopBar 页标题。
- `/parameter-review` 补齐队列/详情的 landmark 与 heading，队列行可用键盘激活，J/K 或方向键移动选中行（Enter 打开提交详情）。状态筛选与徽章使用同一套中文标签（`硬件MDE检视`），不再露出 `Committer`/`User`。

## UI 设计系统与质量门禁

所有产品界面遵循 [UI 设计系统](design-docs/ui-design-system.md) 的可执行视觉标准:设计令牌是视觉取值的唯一来源、单一 accent、强制交互状态、共享原语(`.button` 基础层 + `ui/button`、所有弹窗走 `ModalDialog`/`ConfirmDialog`、唯一 toast 管线 `src/components/common/toast` 的 `useToast()`、标准列表外壳 `admin/DataTable`、`ColumnFilter`、加载/空/错误与认证启动走 `SectionState` + `AppShellSkeleton`)、令牌化动效与中文优先的产品语言。所有前端可见变更在宣称完成前必须通过 [UI 质量检查清单](developer/ui-quality-checklist.md) 的完成门禁。把存量界面收敛到该标准的迁移纲领已归档于 `docs/zh-CN/exec-plans/completed/2026-08-12-frontend-aesthetics-uplift.md`;剩余字面量/表格/文案存量由技术债追踪器的 TD-111–TD-115 清偿。

## 按钮和操作样式

按钮必须看起来就是按钮。不要依赖裸 `.button` class、浏览器默认 `<button>` 样式，或把会写入状态、提交表单、关闭弹窗、推进流程、打开菜单的操作做成纯文字。优先复用已有 Button 组件或本地已有变体；如果某个区域需要局部按钮变体，必须在该作用域内补齐完整视觉契约：

- 布局：使用居中对齐的 `inline-flex`，并设置稳定的 `min-height`，以及稳定的 `min-width` 或 icon-only 方形尺寸。
- 表面：显式定义 `background`、`border`、`border-radius`、文字颜色、禁用态透明度和 cursor。
- 层级：区分 primary、secondary/subtle、destructive、ghost 等层级，不能让两个关键操作看起来只是两段等权重文字。
- 交互：提供 hover 和 focus-visible 状态；在浅色页面和带遮罩的弹窗上，焦点环都必须可见。
- 响应式：桌面、平板、手机下按钮不能退化成裸文字，不能互相重叠，不能溢出容器，也不能因为文字或状态变化导致布局跳动。

弹窗底部、表格行操作、顶部栏操作、卡片操作和 toast 操作是高频回归点。修改这些区域时，单测应加入目标按钮变体或 class 的 DOM 断言；浏览器验收应截取对应状态，并明确检查主/次按钮有可见表面样式、尺寸稳定且页面无水平溢出。低强调的内联跳转或辅助操作可以使用文本式样式，但应使用 link/text-action class，不要伪装成普通按钮。

## 表格列多选筛选 UX

支持选 0 / 1 / 多个分类值的列表头筛选，必须使用共享的 `ColumnFilter`（安静的漏斗触发器 + 勾选菜单），不要用常驻 `<select>` 或用排序箭头冒充筛选。层级模块列使用 `ColumnFilter` 树模式，底层复用数据无关的 `src/domain/tree-filter/treeFilter.ts` 与 `src/components/common/TreeFilterOptions.tsx`；`ModuleTreeSelect` 也复用同一套树构造和选择语义。规格：[表格列多选筛选 UX](design-docs/ux-table-column-filter.md)。规范实现：`src/components/ColumnFilter.tsx`。参考接入：`ParametersTable`、工作台 `DtsParameterWorkbenchTable` 的「所属模块」、参数后台 `ParameterSpecLibrary` / `ProjectAdminTable`，以及 `/log-admin` 业务域列表的「状态」列。

管理端**列表**表格使用 `src/components/admin/DataTable`（排序 + `aria-sort`、分页、键盘行、空态、可选 `ColumnFilter`）。列宽超出卡片时，内层 `.data-table-scroll` 保持 `overflow-x: auto`（指针拖动 + 触控板/触摸滑动）；表头 `ColumnFilter` 菜单是 `position: fixed`，不得再把滚动层改成 `overflow-visible`。其他会溢出的表滚动层复用同一套 `HorizontalDragScroll` / `useHorizontalDragScroll`（`ParametersTable`、审阅 `Table`、参数后台库表、调试表、初始化/导入预览、平台控制台候选体）；列表需要常显横向滚动条时，也由这个公共接缝按需提供。页面外壳仍不得造成整页横向滚动。已接入：`/organization/members` 成员表、`/log-admin` 业务域列表、`/log-admin` 分析质量、`/debugging-admin` 节点/参数库表、`/dts-reload` 候选网格，以及 `/parameter-admin/projects` 管理端项目清单。项目清单在 390px 使用卡片，在 768px 使用 1080px 宽表格加 16px 常显横向滚动条，在 1440px 完整显示且页面不横向溢出。`/logs` 的 `rawlog-table` 是行查看器，不是列表外壳。TD-112 在管理端列表边界闭环：规范项目配置工作台本身没有表格；日常工作的 `DtsParameterWorkbenchTable` 与仅 mock 使用的旧 `ParametersTable` 产品语义不同，不属于这条列表合同。

## 共享模块导航

`DtsTopologyNavigator` 是参数修改、参数调试及 `/parameter-admin/specs` 共用的模块优先树。定义管理适配器按实测归属路径构树、对定义数去重汇总；选中节点会筛选完整子树并写入 `?moduleNode=`，再次点击当前节点清除范围。

模块名保持单行。桌面端导航宽度随内容增长至布局令牌上限，超出后只在导航内部横向滚动；低于双栏断点时占满可用宽度，页面本身不得产生横向溢出。

层级列表头筛选统一使用共享 `ColumnFilter mode="tree"`：`/parameter-review` 的变更审阅、`/parameter-admin/specs` 的参数定义库与内嵌审阅队列、`/node-debugging` 的节点调试参数表、`/dts-reload` 的参数调试候选表，以及 `/debugging-admin/nodes` 的节点目录都使用受页面作用域约束的模块树。若审阅任务接口只提供模块名称而没有归属路径，筛选器只展示可证实的模块层级，不推测不存在的祖先关系。

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
