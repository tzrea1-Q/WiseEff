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

Phase 1 配置工作台 tracer 在开发环境为**显式开启**（`VITE_PROJECT_CONFIGURATION_WORKBENCH_ENABLED=true`；默认 `false`）。生产构建强制关闭。详见 `.env.example` 与 `docs/zh-CN/developer/environment-variables.md`。

仅在纯前端演示或组件测试、且不需要调用后端时显式使用 mock：

```text
VITE_WISEEFF_RUNTIME_MODE=mock
```

生产构建不能把 mock data 当业务数据源。组件测试默认仍通过 `npm test` 覆盖为 mock，避免本地 `.env` 的 API 设置污染单测。

API mode 启动时会先调用 `/api/v1/me`。如果当前 token 缺失或被拒绝，前端显示 WiseEff 认证页，支持本地账号登录和注册。本地登录使用用户名和密码；注册会选择组织（`硬件部` / `软件部`）、姓名、允许自助选择的平台角色、用户名和密码。注册角色下拉不包含 Admin；申请 Hardware/Software Committer 时，后端会创建 inactive 账号、对应基础 User 角色和待审批申请，`/api/v1/auth/register` 返回 `202 pending_approval` 且不返回 session token，前端继续停留在认证页，展示待审批结果态且不再保留可编辑注册表单。只有登录或非 Committer 注册成功后，前端才把不透明的 `we_local_*` session token 存到 `localStorage` 的 `wiseeff.localAuthToken`；默认 API client 会优先使用 OIDC runtime token，若没有 OIDC token 再回退到本地 token。

顶部用户菜单提供“个人资料”和“退出登录”。个人资料保存调用 `PATCH /api/v1/me/profile`，退出登录调用 `POST /api/v1/auth/logout` 并清除本地 token。注册按所选组织和允许自助选择的平台角色创建本地账号；当前暂不支持邮箱验证。

本地账号注册的组织下拉固定为 `硬件部` 和 `软件部`。自助注册角色下拉使用：`guest`、`hardware-user`、`software-user`、`hardware-committer`、`software-committer`。`admin` 与 `platform-admin` 只能通过后台用户治理分配，且后者仅已持有 `platform-admin` 的调用方可以授予或撤销；不能在注册页自助选择。

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
- `DtsSearchPanel`：路径 / `@地址` / 标签 / compatible / 值检索，挂在 `/parameter-admin/projects/:projectId/files` 的文件列表下方（树形浏览/编辑仍在「结构浏览」页签）。
- `ConfigSetBaselinePanel`：配置集 / 基线 / 对比 / 发布 / 导出，同对话框「配置集 / 基线」标签；对比变更集行映射真实参数并可走同一提交端口。
- `StructuredDiffView`：基线结构化差异与变更集行。

旧的 `ProjectParameterFilesPanel` / 冲突面板通过 `resolveParameterFileRepository(runtimeMode)` 注入 `ParameterFileRepository`（mock：`createMockParameterFileRepository`；API：`createParameterFileClient`），组件内禁止 `createParameterFileClient()`。mock 模式下可演示文件列表与冲突面板，不直连 `:8787`。

正式参数管理后台在侧栏只有一个入口「参数后台」（`/parameter-admin`）。组织治理与项目运营通过范围切换；`/parameter-admin` 会重定向到 `/parameter-admin/specs`（保留查询串）。组织配置对等入口为 `/parameter-admin/specs`（参数定义管理：定义库 + 内嵌匹配审核；有节点对应任务时嵌套 `/parameter-admin/specs/identity-mapping`）与 `/parameter-admin/modules`（模块管理）。旧路径 `/parameter-admin/spec-review`、`/parameter-admin/identity-mapping` 永久重定向到新位置并保留 query（ADR-0015）。`/parameter-admin/projects`（及深链 `/parameter-admin/projects/:projectId/files`，另有 `config-sets` / `structure` / `conflicts`；开发 flag 开启时另有 canonical 只读 tracer `/configuration`）仍可深链访问，并保持同一侧栏项高亮。面板只依赖 `createParameterAdminApplication` 门面（底层 `ParameterTopologyRepository`、`ParameterModuleRegistryRepository` 与导入 actions，mock/api 同源），跨面板状态在 `ParameterAdminProvider`，不读全局 `PrototypeState`。筛选/排序/选中以 URL 查询参数为唯一真相源。批量导入为组织子路由的 TopBar 操作；规格审核走 cursor 分页；参数库客户端分页（50/页）并默认隐藏 `#…` 结构属性。项目域含清单、参数文件、配置集/基线、结构浏览与冲突裁决。操作 ID `PARAM-IDENTITY-MAP-ADMIN-001` 跟踪后台侧身份映射覆盖（浏览器验收改挂见 #198）。`pageUsesProjectScope` 不含管理后台路由（ADR-0001：组织域与项目运营各自自有选择器，不挂 TopBar 项目选择器）。

开发环境显式设置 `VITE_PROJECT_CONFIGURATION_WORKBENCH_ENABLED=true` 后，项目清单入口会打开 `/parameter-admin/projects/:projectId/configuration`。该路由是全屏、源码主导的工作台：配置集/文件 query 选择 Working configuration；成员/未编组身份与 active source 在 mock/API 两种 runtime 中均经既有 `DtsStructuredRepository`、`ParameterFileRepository` 读取。源码定位导航（#229）在选中成员下嵌套结构节点树，经 `ProjectPrimaryDtsViewer` 滚动/高亮 CST span，提供按文件分组的统一搜索（省略 `by`=全维度）并可跨成员跳转，恢复 `configSet`/`file`/`node`/`property`/`sourceMode` 深链；树元数据与源码独立加载/重试。键盘辅助使用 Alt+F / Alt+N / Alt+G / Alt+1 / Alt+2（非输入时 `/`），不覆盖浏览器/系统快捷键。上下文检查（#230）按配置集/文件/节点/属性打开对应检查器内容，回退时保留源码选择；文件检查列出不可变版本（来源、创建者/时间）并经 `ParameterFileRepository` 下载；画布模式 `working` / `history` / `unified-diff` / `side-by-side` / `candidate` 保持只读，退出后恢复先前工作配置目标与滚动（`structured`/`raw` 仍为 Working 别名）。候选上传（#231）启用「上传候选」，经 `ParameterFileRepository.createCandidate` 创建暂存候选且不改变活跃版本或配置集成员，在候选源码模式与检查器中展示影响证据（文本/结构 diff、诊断、覆盖/映射、冲突、阻断），支持 blocked 重算以及对 ready/blocked/failed 的放弃，并保持工作配置/文件版本/候选/发布基线身份各自独立标注。文件与配置集操作（#236）支持 Admin 创建/配置配置集（含校验与重名处理）、以角色与顺序增删成员并经 ConfirmDialog 确认影响范围、未编组文件在明确编入前保持在工作配置/发布就绪度之外、经 `ParameterFileRepository.syncFile` 手动同步并写入任务证据、从命令栏经 `DtsStructuredRepository.exportConfigSet` 导出选中配置集；空配置集给出聚焦的候选上传/编入路径且不自动激活；`canAdmin=false` 拒绝变更但保留只读上下文。检查器默认叠层，仅当测得工作台宽度使源码画布仍 ≥640px 时变为常驻（PCW-D15）。激活留给后续阶段。生产构建强制关闭该 flag，flag 关闭时四视图旧弹窗仍可访问。

只读工作台通过 `DtsStructuredRepository.listConfigSetFiles` 调用 `GET /api/v1/projects/:projectId/config-sets/:configSetId/files`，返回项目/组织范围内的成员角色、排序、格式与 active version 身份；页面不直接创建 HTTP client。

**项目 tab 视觉约定：** 深链视图共用 `.param-admin-panel` 外框与 `.param-admin-panel__section` 分组（配置集/基线）；空队列用 `ParamAdminEmptyState`（`.param-admin-empty`）承载短状态、可选说明与下一步动作。作用域导航（`.parameter-admin-scope-nav`）视觉权重大于组织子导航（`.parameter-admin-subnav`），以表达包含关系：作用域用更大、实心主色选中 pill 并带轻阴影；子导航为更小的描边 pill，且每个对等项（含未选中）都有边框，避免被读成静态文案。项目列表页只保留权威标题「项目清单」；TopBar 副标题对应清单或深链视图名，不再重复「项目运营」。清单行展示治理信号（「冲突」开放数、「基线」已发布/无已发布），数据来自 `GET /api/v1/parameters/admin/projects`。参数文件页先文件列表、后结构化检索，检索文案指向「结构浏览」做树形编辑。

**项目运营是盖在清单上的深链弹窗（ADR-0001）：** `ProjectOperationsDialog` 在项目清单之上呈现四个视图，URL 仍为 `/parameter-admin/projects/:projectId/:view`。它接入共享的 `ModalDialog` 契约（portal、焦点陷阱、背景 `inert`、仅最顶层 Escape、遮罩关闭成对判定）。外壳是一个权威 `<h2>`（项目名）、共享视图导航（`.project-operations-nav`，`aria-current="page"`，支持左右/Home/End 移动焦点）、来自审计中心的最近事件投影（`recentAuditEvents` ← `listAuditEvents`，治理变更后刷新，不再使用本地 `PUSH_AUDIT_HINT`），以及可滚动的正文区。卡片固定高度（`min(88vh, 920px)`），只让正文滚动；≤768px 时变为全视口 sheet。四个面板统一使用 `<h3>`。访问过的视图保持挂载，因此筛选、选中节点与结构浏览的未提交草稿在视图间切换时不丢；关闭弹窗（或 Escape）且有未提交草稿时会先弹确认。未知项目 ID 在清单页渲染 not-found，不再把原始 ID 当弹窗标题。结构化检索命中会跳到结构浏览并选中该节点；若节点在别的文件，会明确说明。

**共享弹窗契约：** 弹窗统一使用 `ModalDialog`（`src/components/common/ModalDialog.tsx`），它 portal 到 `document.body`，并负责卡片上的 `role="dialog"` + `aria-modal`、自动生成的 `aria-labelledby` / `aria-describedby`、初始焦点、Tab 焦点陷阱、关闭后焦点归还触发元素、应用根节点 `inert`、只有最上层响应 Escape，以及 pointerdown/pointerup 成对判定的遮罩关闭（在卡片内按下、卡片外松开的文本选择不会关闭弹窗）。`ConfirmDialog` 在其之上承载不可撤销的治理操作（发布/回滚基线、移除配置集成员、冲突裁决），支持门禁返回 `requiresConfirmation` 时的确认勾选，以及可选的裁决原因并写入审计提示。由于 portal 把卡片移出了 `.param-admin-shell`，参数后台弹窗样式同时按遮罩类名生效（`.param-admin-modal-backdrop .button`、`… .dialog-actions`），由 `ModalDialog.styles.test.ts` 守住这对选择器。层级只用 `:root` 里声明的一套刻度（`--z-xiaoze-fab: 1100`、`--z-modal-backdrop: 1150`、`--z-modal-backdrop-nested: 1160`、`--z-xiaoze-popup: 1200`），不要再加临时 z-index 数字。

**项目运营面板要点：** `DtsStructureBrowserPanel` 需要显式传入 `fileId` / `versionId` / `fileName`，都没有时显示指向真实下一步的空态，不再加载教学样例；权限受限时只用产品语言说明一次并锁定编辑器（不暴露权限 slug），安全关键节点的警示权重与写入风险匹配；`onDirtyChange` 上报未提交草稿供页面拦截导航，`focusRequest` 用于选中检索命中的节点。`ConfigSetBaselinePanel` 的成员角色与基线状态都用中文标签，所有写操作都有 pending/禁用态，名称为空时给出可见校验提示，发布/回滚/移除成员都经确认框；只有调用方给出真实 `revisionId` 时才提供修订校验，没有教学兜底，避免教学 ID 进入审计。`ParameterFileConflictPanel` 两侧动作等权重，展示出现时间与来源文件版本，标题带开放冲突计数，裁决经确认框并可填原因。`ProjectParameterFilesPanel` 版本历史展示版本号、当前版本标记、来源、时间、操作者、大小与逐版本下载；回滚到指定版本与把 `createdByUserId` 解析成人名记在 TD-056。

**定义库治理（`/parameter-admin/specs`）：** `OrganizationSpecGovernancePanel` 承载 `ParameterSpecLibrary` 与内嵌 `SpecReviewQueue`。**新建定义**打开 `SpecCreateDialog`（归属主体来自 `GET /api/v2/parameter-modules` 中带 `attributionSubjectId` 的驱动组/节点类型；创建体覆盖必填 `propertyKey` + `reason`，以及可选 `displayName` / `description` / `documentation` / `valueShape` / `constraints` / `units` / `exampleValue` / `overridePlatform`；可选 compatible 以便创建后带 `overlay-property` 类型 `coverageClaim` 激活），调用 `POST /api/v2/parameter-specs`。**软废弃/恢复**经 `ParameterSpecDetailDialog` 原因门禁（`POST .../deprecate`、`POST .../restore`）；创建/激活/废弃/恢复/完成版本切换成功路径以固定位置短 toast（`logs-feedback-toast`）反馈。定义库**默认隐藏 `deprecated`**（生命周期筛选可显式包含）；审核绑定选用仅允许 `active` 与本组织可激活 `draft`。库表**参数定义**列仅显示 `property_key`；**驱动模块**列优先显示实测归属树路径，否则显示归属主体 displayName（API 字段 `driverModule`，仅展示）并标「未实测」，或「未归类」。`driverModule` 不再作为定义身份或 `?driverModule=` 筛选键；筛选走 `attributionSubjectId` / 归属模块列。详情分栏：属性键 / 驱动模块（主体或路径展示）/ 所属模块（路径）。**驱动登记/模块治理**在驱动组行只读展示 `driverNature` 与 `instanceCardinality`（来自 `GET .../driver-registry`）。独立 `ParameterAdminAuditBanner` 已移除——各面板经 `ParameterAdminProvider` 推送紧凑审计提示（`PUSH_AUDIT_HINT`）；项目运营面板仍可内联展示最近一条。**节点对应**（`/parameter-admin/specs/identity-mapping`）由 `IdentityMappingReview` 展示 `taskKind` 徽标（`identity-ambiguity` / `singleton-cardinality`）。歧义任务支持**确认对应**（`resolved`）、**声明新身份**（`new-identity`；多候选须勾选 `confirmAllCandidates`）与**驳回**（`dismissed`）。`singleton-cardinality` 任务仅展示登记/拓扑修复指引，不提供身份决议控件（API 返回 `409 singleton-cardinality-conflict`）。工作台仅提示发布阻断；完整处置仅在此后台路由。

语义身份 UI 在 `src/components/parameter-topology/`：参数库与审核队列、源树/生效树浏览、**节点启用状态**（拓扑树启用/禁用徽标与不可达标记、工作台参数行不生效提示、`DtsNodeEnablementDialog` 三态编辑并与 binding 草稿共享工作 tip）、类型化绑定编辑与正式提交、身份映射决议、失败关闭的配置 revision 校验。API 模式走 `/api/v2`；DTO 分字段暴露 `exampleValue` / `schemaDefault` / `policyTarget` / `effectiveValue`，无业务 `recommendedValue`。Cutover 后遗留扁平参数 ID 不做兼容投影。本地 `npm run dev` / `dev:all` 默认处于 **post-cutover** 语义种子，类型化 binding 草稿可直接提交审核。

API 模式 `/parameters` 保留成熟的 `ParametersPage`/`WorkbenchLayout` 层级，在 `ApiProjectTopologyWorkspace` 内嵌 `DtsParameterWorkbench`。协调器继续负责真实 API 加载；工作台以**业务模块优先导航**（默认模块 → 参数；**`groupByDevice` 器件实例层已在生产启用**——无需每实例注册表行即可浏览 `hl7603@77` 等实例；默认只展开到第 2 层；若仅有一个业务包装根如 Power 则提升其子节点为导览根，精确名为「未分类」的并列根保留）为主，**技术视图**在保留左侧模块导览的同时将右侧结果区切换为只读项目主 DTS 源码，并在**工具栏下方**保留本轮修改区、**只读参数详情弹窗**（查看）、**本地草稿弹窗**（编辑 / 加入草稿）与 binding 提交面板；草稿卡对简单值用箭头预览，对复杂值用行级 `+/-` diff 与等宽编辑器；校验成功后卡内保留「服务端校验通过，草稿已创建」，并进入本轮修改托盘，主表同行显示「草稿」徽章。托盘值变更同样用 `ParameterValueDiff`，条目旁展示所属模块名（不再显示设置/删除属性动作标签），且不展示技术身份。模块归属来自注册表（`GET /api/v2/parameter-modules`：v1 模块 + DTS 映射）；模块 CRUD 仍走 `/api/v1/parameter-modules`，DTS 驱动/compatible/实例映射走 `/api/v2/parameter-modules/mappings`。未映射绑定按驱动兜底分组。默认应用**可管参数面**过滤（`isParameterSurfaceRow`），结构性 DTS 属性（`#address-cells`、`compatible`、总线脚手架 locator）不出现在主列表；仅技术诊断时传 `includeNonSurface: true`。拓扑 locator 缺失时 fail-closed（排除）。DTS 根级 `board_id` 作为可管面行落在 `Board Identity` / `board`——ingest 与种子不会在「未分类」下物化名为 `/` 的产品模块。脚手架驱动（`amba` / `gic` / `gpio` / `spmi` 及其「未分类 · …」临时桶）也不进入默认可管账本，WiseEff 不将其作为业务参数处理。主表列：参数名、所属模块、当前值、重要性、操作；器件/驱动与 DTS 路径/类型/源出处收进详情。重要性为主信号并可排序；健康 `valid` 绑定不渲染治理徽章（存储层 `matched`/`reviewed` 归一为 `valid`），仅在异常时显示「待处理」/`attention` 或「阻断」/`blocked`。`attention` 仅对应开放身份映射任务；provisional-surface 的 `schemaState=unreviewed`（纯 overlay / 无 `compatible` 时常见）**不**抬升为「待处理」——该积压归属 Admin 规格审核队列。`attention` 仍可标记与开放身份映射任务相关的 binding，但决议 UI 仅在 `/parameter-admin`；工作台通过发布阻断项提示，不再内嵌底部映射审核区。工具栏**不提供**独立的修订「校验」按钮（L2 仍仅作 Admin/导出辅助）。**项目主 DTS 写回：** 每个项目一份自洽主 DTS（seed 为 `{projectId}-board.dts`）；仅含单个 `base` 成员的 config revision 将参数编辑写回该文件文本（CST span 合并），产品路径不再依赖共享平台 base DTS。见 [`../design-docs/2026-07-21-project-primary-dts-contract-rfc.md`](../design-docs/2026-07-21-project-primary-dts-contract-rfc.md)。**工具链分层：** L0（解析 + occurrence 写回）在编辑**与合入/写回**热路径；L2（`dtc`/`dtschema`）仅在 Admin 校验/导出/发布辅助。工作台默认**不展示** `dtc` / `ranges_format` 编译诊断。已提交 seed 板级 DTS 为产品真相源；`npm run dtc:seed:compile` 为 CI/工具链佐证，不是日常参数维护正确性的前提。见 [`../design-docs/2026-07-21-dts-parameter-surface-boundary-rfc.md`](../design-docs/2026-07-21-dts-parameter-surface-boundary-rfc.md)。工具栏仅保留语义搜索（参数名、模块、compatible/驱动、地址、拓扑路径、源文件/节点路径与 raw 值）；左侧导航选中仍可缩小列表范围。表格勾选草稿会驱动本轮修改区的选择性提交（未勾选则提交全部）。支持语义 CSV 导出；API 模式仍禁止扁平 Excel 与 `recommendedValue`。

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
- **真实详情历史 + 跨项目对比。** 详情弹窗打开时，`ApiProjectTopologyWorkspace` 加载 `GET /api/v2/projects/:projectId/bindings/:bindingId/history`（由 revision 推导的 `from -> to` 条目）与 `GET /api/v2/projects/:projectId/bindings/:bindingId/compare`（同组织内共享 `parameter_spec_id` + `module_id` 的其他项目，排除源项目）。历史仅来自 `project_parameter_binding_revisions`——绝不使用遗留扁平 `parameter_history_entries`。历史 API 会折叠相邻 config revision tip 中 raw 值未变的快照（存储层仍按 config revision 保留 tip）；初始 tip 保留且 `fromRawValue` 为 null。由于绑定 revision 表没有 per-revision 的 actor / 原因列，历史不暴露 actor/原因。对比对端按 `projectId` 去重。查看弹窗仅保留精简入口（覆盖率摘要 + **打开跨项目对比**）；成熟对比面（目标选择、文本差异、`+/-` raw diff、项目概览、**使用该项目配置加入草稿**）放在次级 `DtsBindingCompareDialog`。对端作草稿写入本地草稿袋并打开 `DtsBindingDraftDialog`。空态显示「暂无历史记录。」/「暂无其他项目的对比数据。」，不再出现阶段一占位文案。
- **查看弹窗规格含义。** 定义编辑器会加载 `GET /api/v2/parameter-specs/:specId`，展示显示名、documentation/description、示意性 `exampleValue`（绝不作为推荐值）、单位、约束，以及可选的 `schemaDefault`。定义弹窗不再编辑 `policyTarget`（SE-D1 / TD-055）；GET 仍可能从 `parameter_policy_targets` 返回产品作用域行。

### 模块归属管理（`/parameter-admin/modules`，页签 **模块归属**）

`OrganizationModuleGovernancePanel` 组装 `ParameterModuleMappingPanel`，默认以 `ModuleAttributionTree` 为主界面，归类时打开 `ClassifyCompatibleDialog`。种子与 ingest 构建**分类学树**：**业务分类 → {驱动组 | 节点类型单元} → 嵌套节点类型\***；总线/脚手架节点不进产品树。组织映射仅匹配 `compatible` 或 `node-type`（无 `driver` 或 `instance` 匹配类型——ADR-0010）。

- **放置辅助：** `src/domain/parameter-topology/modulePlacement.ts`（服务端镜像在 `server/modules/parameter-modules/`）。
- **绑定写入：** ingest 经 `ensureAttributionModuleForBinding` + `resolveModuleForBinding` 写入 `module_id`。有 compatible 证据解析到驱动组；无 compatible 的配置节点解析到节点类型单元（裸节点名）。未映射 compatible 与无法放置的节点类型进入未归类队列；无匹配 binding 停放在未分类根模块上。
- **未登记队列（次级）：** 有待归类项时，模块归属内才出现子菜单「归属树 / 未登记驱动」及数量徽标（`/parameter-admin/modules/queue`），树视图顶部有提示条；队列为空时不渲染该切换器。队列表示「实测到但未登记」的差集（ADR-0007）。归类走 `ClassifyCompatibleDialog`；**认领登记**打开预填 compatible 的登记对话框。归类调用 preview → 范围 apply。旧书签 `/parameter-admin/modules/registry` 会重定向到归属树。
- **树上的驱动覆盖：** 不再有独立的驱动登记路由。`GET /api/v2/parameter-modules/driver-registry` 仍提供解析/实测覆盖，但呈现在归属树：驱动组行显示覆盖徽标（「官方解析覆盖」/「组织级解析覆盖」/「平台级解析覆盖」/「被更高优先级覆盖」/「解析覆盖 N/M」/「解析未覆盖」），可用默认关闭的「仅显示解析未覆盖」筛选；`ModuleEditDialog` 在每条 compatible 规则旁展示覆盖明细。Admin 编辑驱动组时可改 `driverNature` / `instanceCardinality`（与分类树 `node-type` 正交；保存时在模块更新后调用 `PATCH /api/v2/parameter-modules/driver-registry/:moduleId`），还可改注册**默认业务分类**（`PATCH .../driver-registry/:moduleId/default-business-category`）并执行**从注册回放放置**（`POST .../replay-placement`）：auto 跟随默认，curated 冻结。解析未覆盖时提供「配置组织级解析」，会先关闭模块编辑再打开 `OrganizationDriverSchemaDialog`；「添加参数定义」进入嵌套的 `OverlaySpecPickerDialog`（嵌入定义库搜索与列筛选表，可新建）。保存并激活走 `/api/v2/organization-driver-schemas`。若已存在平台级解析覆盖，配置组织级解析会被拒绝。登记/认领仍走 `POST /api/v2/parameter-modules/driver-registry`（树上按驱动组新建，或队列认领），并将所选业务分类写入注册默认。binding 数为 0 的 curated 驱动组与节点类型单元在树上标「未实测」，可用默认关闭的「隐藏未实测」过滤。
- **平台控制台（`/platform-console`）：** 仅 `platform-admin` 可见。列出跨组织晋升候选、展示不合格项的贡献方形状差异，并以明确的跨租户影响面确认执行晋升/撤销（`platform:schema-promote`）。
- **上传前新建（统一入口）：** 归属树「新建模块」打开带类型选择的 `ModuleCreateDialog`（`business` / `driver-group` / `node-type`）。父级按类型规则过滤（业务分类：根或其他业务；驱动组与节点类型：业务；节点类型可嵌套于节点类型）。驱动组须至少 1 条 exact compatible，并走 `registerOrClaimDriver`；其余 kind 走 `POST /api/v1/parameter-modules` 且 `origin=curated`。节点类型可填可选 `sourceKey`（`nodetype:{name}`）。
- **按 kind 分级的树：** `ModuleAttributionTree` 展示 kind 徽标（`business` / `driver-group` / `node-type` / `unclassified`）、**定义数**与**实测处数**分列计数、驱动组解析覆盖徽标与仅业务行的重要性（注册表 `effectiveImportance`）。同级**上移** / **下移**经 `PATCH /api/v1/parameter-modules` 互换 `sortOrder`；已在首尾或 kind 守卫禁止时，菜单项 `disabled` 并附内联原因。操作遵循服务端 kind 守卫（节点类型可移动/改类型；驱动组删除=解散；未分类根只读；业务与驱动组可添加子模块）。编辑弹框可在 `{business, node-type}` 间受控改类型（ADR-0010）。驱动组行显示只读摘要「N 条 compatible」与覆盖徽标；匹配规则与逐条覆盖状态在 `ModuleEditDialog` 内维护，不在树上直接移除。**Overlay 废弃**在 `ModuleEditDialog` 内先调 `GET .../deprecation-impact` 再 `POST .../deprecate`，展示覆盖丢失、定义/项目计数与可选后继来源；覆盖将丢失时须显式确认。从队列归类 compatible 时，在所选业务分类下创建的是 **驱动组**（不是业务分类），并写入 `source_key = compatible:{normalized}`；match 值会去掉 DTS 外层引号，使 `"mt,mt5788"` 与 `mt,mt5788` 视为同一杠杆。
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

参数域与调试域各自维护独立的组织级模块树。共享选择器：`src/components/common/ModuleTreeSelect.tsx`。

- `/parameters`：模块筛选与分组使用 `moduleId` 子树包含；深链 `?module=<moduleId>`。
- `/parameter-admin/modules`：`ModuleAttributionTree` 管理业务分类 / 驱动组 / 节点类型单元归属；「新建模块」走带类型选择的 `ModuleCreateDialog`（父级过滤、驱动组 compatible、节点类型可选 sourceKey），修改走 `ModuleEditDialog`（名称、在 `{business, node-type}` 间受控改类型、业务分类重要性、描述、适用范围），并保留移动与受控删除；库筛选与导入预览使用树形选择。
- `/debugging-admin`：`DebugModuleManagementDialog` 管理调试节点模块树；节点目录与编辑弹窗通过 `ModuleTreeSelect` 选模块。

API mode 从 `/api/v1/parameter-modules` 与 `/api/v1/debugging/admin/modules` 加载；mock mode 由 `src/config/power-management.json` 的 `parent`/`path` 经 `buildPowerManagementModuleTree()` 派生。

mock mode 有意保留 12 个兼容参数，以保证组件测试与演示轻量。API mode 的 `db:seed:m1` 会在 seed 时从已提交的 `aurora-board.dts` 模板额外派生 228 个 DTS 来源参数；每个落库项目值都包含 `sourceFileName=aurora-board.dts` 和含属性名的 `sourceNodePath`。修改基础 DTS 或项目差异后，运行 `npm run dts:seed:generate` 重新生成三份项目主 DTS fixture。可选：`npm run dtc:seed:compile` 在 CI 中用钉扎工具链验证 seed 板——不是产品正确性叙事的前提（seed 板为 SoT）。
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

## 表格列多选筛选 UX

支持选 0 / 1 / 多个分类值的列表头筛选，必须使用共享的 `ColumnFilter`（安静的漏斗触发器 + 勾选菜单），不要用常驻 `<select>` 或用排序箭头冒充筛选。规格：[表格列多选筛选 UX](design-docs/ux-table-column-filter.md)。规范实现：`src/components/ColumnFilter.tsx`。参考接入：`ParametersTable`、工作台 `DtsParameterWorkbenchTable` 的「所属模块」，以及参数后台 `ParameterSpecLibrary` / `ProjectAdminTable`。

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
