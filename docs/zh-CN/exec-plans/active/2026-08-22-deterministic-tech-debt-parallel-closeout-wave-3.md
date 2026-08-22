# 确定性技术债并行收口——第三批

> 状态：**进行中**
> 日期：2026-08-22
> 规划基线：`origin/main@afa6095f9c9d27576f8f0b423fb438e2782a5e8d`
> 规划分支：`codex/deterministic-tech-debt-wave3-plan`
> English: [English](../../../exec-plans/active/2026-08-22-deterministic-tech-debt-parallel-closeout-wave-3.md)
> 追踪表：[技术债追踪表](../tech-debt-tracker.md)

## 目标

关闭一组彼此独立、无需 HDC/ADB 硬件、目标部署、专家标注日志、live 模型/provider、KMS 或未决产品决策的确定性技术债：

- **TD-072**：用真实 PostgreSQL 状态变化或纯 review policy 替换 `server/modules/parameters/service.test.ts` 最后三个 `QueuedResult` 数据库假件测试。
- **TD-110**：从 API 模式初态删除九个结构性 demo users，同时保留认证当前用户与受治理用户名录的 hydration 语义。
- **TD-031**：把 Xiaoze 专属环境变量族定为规范命名，保留一条明确的旧变量读取迁移路径，并同步模板、检查、健康门禁和运维文档；不要求 live LLM。
- **TD-112**：有条件地迁移真正进入配置工作台的 Admin list——`src/components/admin/ProjectAdminTable.tsx`——到 `admin/DataTable`，并保留现有响应式合同。

每一行都必须完成聚焦 red → green、相称的全量门禁、独立 Standards/Spec 双轴复审、独立 PR 与必要 CI，再经过共享 tracker/计划收口，才能关闭。TD-112 还受独立的范围与响应式门禁约束；门禁失败时必须保持 Open，不得为了关行扩大或改写范围。

## 审计基线与确定事实

### TD-072——三个 queue-fake 余量

- 在 `afa6095f`，仓库唯一的 `QueuedResult` 类型位于 `server/modules/parameters/service.test.ts:1109`，唯一对应 `createFakeDb` 从 1111 行开始。
- 只有三个测试使用这段假件：
  - 约 1316 行的 `submitParameterChanges rejects mixed working tips in one batch`；
  - 约 1399 行的 `submitParameterChanges creates enablement change requests from node-enablement drafts`；
  - 约 1508 行的 `rejects semantic merge when projectId is missing`。
- 前两项可通过既有公共接缝 `submitParameterChanges(Database, AuthContext, input)`，使用 `createInMemoryTestDatabase()`、`seedCoreGraph` / `seedSpecBindingGraph` 与测试局部 candidate/occurrence 验证。
- 第三项伪造了真实 schema 禁止的状态：`parameter_change_requests.project_id` 是 `NOT NULL`。长期合同应是由 `reviewChange` 消费的 semantic review subject/precondition policy，而不是排队 SQL 调用顺序。
- TD-096 已经关闭。TD-072 当前仍把余量交给 TD-096 的 tracker 文案已经过时，共享收口必须修正。

### TD-110——API boot 仍拥有 mock 身份

- `src/application/state/apiInitialState.ts:7-27` 定义并导出九个 demo users，36-67 行的 `createApiInitialState` 又把它们直接写入 API 初态。
- Mock seed 已在 `src/infrastructure/mock/prototypeState.ts`，但现在反向从 API-state 模块导入 users；`src/mockData.ts` 也从 API-state 模块重导出。
- 所需公共动作已经存在：`src/application/state/appState.ts` 的 `HYDRATE_AUTH_CONTEXT` / `HYDRATE_USERS`；`src/UserPermissionsPage.tsx` 已在 `listUsers()` 成功后 dispatch `HYDRATE_USERS`。
- API auth 检查中或失败时，`App` 渲染 skeleton/error/login，不渲染业务 shell。因此 API 空壳可从 `users: []`、`currentUserId: ""`、`activeRoleId: "guest"` 启动；认证成功后先写入真实当前用户，再显示受治理名录。
- 用户名录已经具备 loading、error/retry、ready 与 DataTable empty 呈现。本批不为了关闭卫生债而发明空洞的全局 section-status 抽象。

### TD-031——跨运维面的命名迁移可以本地确定性验证

- live 变量仍是 `.env.example`、`ops/self-hosted` 模板/配置/检查、`server/config/env.ts`、Xiaoze model、health/readiness 与中英文运维文档中的 `AGENT_API_BASE_URL`、`AGENT_MODEL`、`AGENT_API_KEY`。
- `XIAOZE_MODEL` 又是一条 Xiaoze 专属 model override，因此当前合同同时存在两种 model 名称和一组历史 generic 名称。
- 本轨规范三键固定为：
  - `XIAOZE_LLM_API_BASE_URL`
  - `XIAOZE_LLM_MODEL`
  - `XIAOZE_LLM_API_KEY`
- `AGENT_API_BASE_URL`、`AGENT_MODEL`、`AGENT_API_KEY`、`XIAOZE_MODEL` 作为一个迁移窗口内的只读旧别名。解析必须**整组原子选择**：只要任一 canonical raw key 出现（空白也算），整组进入 canonical 模式；值先 trim，空白表示显式 unset，base/key 不回退，model 空白/缺失时用 `gpt-4o-mini`。只有三个 canonical raw key 全都不存在时，才进入 legacy 模式，model 优先级为 `XIAOZE_MODEL > AGENT_MODEL > gpt-4o-mini`。
- canonical 与 legacy 同时存在时，canonical 整组胜出；同值产生 `deprecated/ignored`，异值产生 `conflict/ignored`。诊断只含 key 名称/代码，绝不含值。legacy-only 在一个迁移窗口继续可用并告警，不虚构删除日期。模板与 setup 输出只写 canonical 三键。
- `XIAOZE_DETERMINISTIC=true` 仍可豁免 live base/key readiness，但不能吞掉迁移/冲突诊断。`AGENT_API_TIMEOUT_MS` 没有现行 runtime consumer，不纳入三键族；其接线或退役另行 review。
- 本地测试足以证明解析、优先级、不完整配置、secret redaction、health 映射、自托管生成和旧配置迁移。live provider 调用明确不属于关闭证据。
- `docs/exec-plans/active/td-031-xiaoze-run-timeline-streaming.md` 是误用同号的历史计划：实现已并入 TD-070，只剩中英文 persistence metadata 说明。共享收口必须完成说明并归档该 active 计划，使 TD-031 只指环境变量命名债。

### TD-112——范围是进入工作台的 Admin list，不是工作台画布

- `docs/FRONTEND.md` 规定 Admin **list** 使用 `src/components/admin/DataTable`，并把 TD-112 余量写成“project-configuration workbench tables”。
- 现行 `src/components/project-configuration-workbench/` 目录含 0 个 `<table>`。tree、timeline、inspector、source canvas、task dock 与卡片都不是列表表格。
- `src/components/admin/ProjectAdminTable.tsx` 是 360 行手写 Admin table。`src/components/parameter-admin-next/ProjectsOperationsPanel.tsx:324-341` 在 `/parameter-admin/projects` 渲染它，主动作“配置工作台”进入 `/parameter-admin/projects/:projectId/configuration`。它才是现行进入配置工作台的 Admin list shell。
- 当前只有 `ProjectAdminTable.layout.test.tsx` 和历史人工证据；`PARAM-ADMIN-003` 仍为 `future`。其中“≤960px card”已与现行 CSS 漂移，准确合同应为：390px card；768px 下 1080px 宽 scroll table + 16px 常显 rail；1440px 完整 table 且无页面级横向溢出。
- 排除 everyday `DtsParameterWorkbenchTable`：`CONTEXT.md` 把日常 Parameter workbench 与 Parameter admin governance 分开；前者的 draft-only selection/tray/detail-edit 语义不属于通用 Admin list。也排除 `docs/FRONTEND.md` 所称 mock-only legacy shell `ParametersTable`。

## 非目标

- TD-062 壳层瘦身、TD-075 registry 统一、TD-076 fixture 收敛、TD-003/012 client/contract 扩面，或 TD-113 token/lint 存量波次。
- 在删除 TD-072 假件时修改 parameter submit/review 业务政策、SQL schema、角色或审计行为。
- 为 TD-110 新建 user-directory API、改权限，或在无关 API 页面提前加载完整用户名录。
- 立刻删除旧 Xiaoze env 别名、输出 secret，或用 TD-031 宣称 live-provider/目标环境就绪。
- 仅为更新旧变量名而重写 completed 历史计划、`docs/design-docs/2026-06-26-xiaoze-sole-agent-cleanup-design.md` 及其中文历史 companion，或 `server/modules/agent/xiaoze/SPIKE.md`；只更新现行规范文档，历史保持历史。
- 将 `DtsParameterWorkbenchTable`、`ParametersTable`、`/logs` rawlog、PCW tree/timeline/cards、wizard、diff/source viewer 或所有剩余手写 `<table>` 并入 TD-112。
- 重写配置工作台，或修改其路由、domain session、selection、配置操作语义。

## Deep-module 接缝与依赖分类

| 轨道 | 公共/deep 接缝 | 依赖类别 | 边界规则 |
| --- | --- | --- | --- |
| TD-072 | `submitParameterChanges(Database, AuthContext, input)`，以及由 `reviewChange` 消费的纯 semantic review subject/precondition policy | PostgreSQL 经 per-worker in-memory harness 本地可替换；policy 为进程内 | 断言返回错误与提交后状态，不断言 SQL 文本、调用顺序或私有 helper；不在 PostgreSQL 伪造 `project_id=null`。 |
| TD-110 | `createApiInitialState`、`createPrototypeState`、`HYDRATE_AUTH_CONTEXT`、`HYDRATE_USERS` | 状态转换在进程内；directory HTTP 经 `userGovernanceActions` 本地可替换 | API boot 不拥有 demo 身份；mock seed 拥有 demo cast；auth 写入当前用户，directory hydration 补/换名录且不闪 demo、不跨路由预取。 |
| TD-031 | 单一纯 `resolveXiaozeLlmConfig(env)`，返回 normalized config、source、secret-safe diagnostics 并导出 key metadata | 运维配置来自外部；解析/health/setup 本地可替换；live model 属外部且排除 | runtime、health、docs check、自托管工具消费同一结果/常量，不重复实现优先级；canonical output、legacy input only。 |
| TD-112 | 既有 `DataTable` controlled sort/row/action/toolbar/empty/pagination；`HorizontalDragScroll` 增 optional visible rail | React 行为在进程内；API route/browser 经本地 server 可替换 | `ProjectAdminTable` 只做组合，不再成为第二套 table framework；共享增加仅为 string-header `data-label` 与 optional rail。 |

四轨都不依赖硬件。TD-031 的生产输入由 operator 提供，但本批只证明解析和迁移；TD-110/112 的浏览器证据只使用本地 API runtime 与本地/可丢弃数据。

## TD-112 实现前范围门禁

TD-112 worker 必须在第一个 red test 前记录：

1. 在刷新后的基线上重跑 `rg -n '<table' src/components/project-configuration-workbench`，结果仍为空。
2. 确认 `ProjectAdminTable` 仍是 `/parameter-admin/projects` Admin list，主动作仍进入规范配置路由。
3. 确认共享接口只需：
   - `DataTable` 从 string header 为移动端生成 `td[data-label]`，row actions 使用“操作”；
   - `HorizontalDragScroll` 可选 visible rail，吸收 ProjectAdmin 当前 `ResizeObserver` 与 pointer-scroll 数学。
4. 用一次可丢弃 render spike 证明可保留 390 card、768 的 1080px table + 16px rail、1440 无 page overflow。

任一条件失败都要停止 TD-112 实现并保持 tracker Open；不得扩大到 Dts、PCW tree/timeline/cards 或无关表格，也不得靠改文档解释强行关闭。

## Worker 调度与文件所有权

本计划合入后刷新 `main`，先启动三个隔离 worktree worker：

| 槽位 | 首个任务 | 分支 | Worktree | 后续 |
| --- | --- | --- | --- | --- |
| Worker 1 | TD-072 | `test/td-072-parameters-service-pg` | `WiseEff-worktrees/wave3-td072` | 合入后只做 review/支持 |
| Worker 2 | TD-110 | `refactor/td-110-api-users-empty-boot` | `WiseEff-worktrees/wave3-td110` | TD-110 review、合入并刷新 `main` 后复用为 TD-112 |
| Worker 3 | TD-031 | `chore/td-031-xiaoze-llm-env` | `WiseEff-worktrees/wave3-td031` | 合入后只做 review/支持 |
| Worker 2 第二段 | TD-112 | `refactor/td-112-project-admin-datatable` | `WiseEff-worktrees/wave3-td112` | 从刷新后的 `main` 建立，不从 TD-110 分支接着做 |
| Parent/shared | 共享收口 | `docs/deterministic-td-wave3-closeout` | `WiseEff-worktrees/wave3-closeout` | tracker、计划归档、历史计划卫生、最终门禁 |

实现 worker 只在 feature branch commit，不得 push `main`、开/合 PR，也不得编辑 tracker 或本计划。

### 所有权与冲突矩阵

| 轨道 | 实现所有权 | 共享/高冲突文件 | 控制方式 |
| --- | --- | --- | --- |
| TD-072 | `server/modules/parameters/service.test.ts`、`service.ts`；仅在接缝确有需要时新增窄名 review-policy module/test | 与本批其它代码无重叠 | 不改前端/env/tracker，不做宽泛 DB 重构。 |
| TD-110 | `apiInitialState.ts`、`prototypeState.ts`、`mockData.ts`、`appState.ts` 及聚焦初态/reducer/App/user-directory tests | 若需改 `docs/FRONTEND.md` / `docs/zh-CN/frontend.md` | 在建 TD-112 分支前先合入；保留 mock exports 与无关 state slices。 |
| TD-031 | canonical env resolver/constants、server config/Xiaoze/health consumers/tests、root/self-hosted env templates、相关 setup/profile/check scripts/tests 与精确中英文运维文档 | `docs/FRONTEND.md` / 中文页；main 上活跃 self-hosted 文件 | review/merge 前 rebase；共享运维文件只动 Xiaoze LLM key，保留其它 setup/upgrade 行为。 |
| TD-112 | `ProjectAdminTable.tsx` 与新行为测试、`DataTable.tsx`/tests、`HorizontalDragScroll.tsx`/tests、局部 CSS、route-level tests、新 acceptance spec/registry/maps | FRONTEND 双语页、acceptance registries/generated maps | TD-110 合入后才开始；若 TD-031 改 FRONTEND 则 review 前再 rebase；不改 `project-configuration-workbench/`。 |
| 共享收口 | 中英文 tracker、本计划、PLANS indexes、launch closeout 当前态、Xiaoze persistence metadata 与旧计划归档 | 所有 TD 编号与计划位置 | 全部拟关闭实现 PR 进入 `main` 后才开始，重核 TD/ADR/migration 编号。 |

## TDD 纵向切片

### Track A——TD-072

1. **Red：mixed tips。** 经 `submitParameterChanges` 构造两个真实 draft/candidate/occurrence，断言公共 `mixed-working-tips` 拒绝与持久状态不变。
2. **Green：接入 harness。** 用 `createInMemoryTestDatabase()` 和最小 seed graph 替换 queued result/SQL-call 断言。
3. **Red：node enablement。** 提交真实 enablement draft，断言返回 request 及落库 request/item/enablement 语义。
4. **Green：行为对等。** 复用生产 submit path，断言事务/rollback 后状态，不断言查询顺序。
5. **Red/green：不可能的 project-less merge。** 把 semantic review subject/precondition 固化为 `reviewChange` 使用的纯 policy table；或经 review 证明分支不可达并删除冗余测试/分支。不得插入非法 DB row。
6. 删除 `QueuedResult`、`createFakeDb`、queue helpers、过时注释与该段剩余 SQL-text assertions，证明全仓 `QueuedResult` 为 0。

### Track B——TD-110

1. **Red：诚实 API 空壳。** `createApiInitialState()` 为 0 users，无 demo current-user id，auth 前是 guest-safe authority。
2. **Green：移动 cast。** 九个 demo users 归 `prototypeState.ts`；保留 `createPrototypeState`、`initialState` 与测试兼容导出，API boot 不再 import mock。
3. **Red：auth hydration。** 从空壳执行 `HYDRATE_AUTH_CONTEXT`，只写入真实当前用户与角色，不恢复 demo peers。
4. **Green：directory hydration。** 响应含当前用户时替换名录；不含时仅保留认证当前用户后拼接返回列表；loading/error/empty 继续诚实。
5. **Red/green：无闪现、无提前请求。** App/page tests 证明 auth 阶段不显示 demo 名称，无关 API route 不调用 `listUsers`。

### Track C——TD-031

1. **Red：优先级表。** 覆盖 canonical-only、legacy-only、canonical+legacy 同/异值、任一 canonical key 出现、canonical blank、不完整 live config、`XIAOZE_DETERMINISTIC`、model default；断言组原子选择与无值 diagnostics。
2. **Green：deep resolver。** 在 `server/config/xiaozeLlmConfig.ts` 新增 dependency-light `resolveXiaozeLlmConfig(env)` 与 key constants；model、health/readiness、routes、config validation、docs governance、自托管 reader 都消费它；resolver 之外 production 直接读取 legacy key 必须为 0。
3. **Red：输出。** root/self-hosted env template 与 setup/profile writer 只产 canonical 三键；读取旧 `.env` 后写回 canonical 且不丢其它配置。
4. **Green：迁移。** 旧别名保留一个窗口；任一 canonical raw key 使整组 canonical 生效，显式 blank 不回退；只有 canonical 全缺才读 legacy。health/error 只报规范语义/key，不含 secret value。
5. 更新当前规范性中英文 env/security/reliability/provider/setup/acceptance/deployment docs；两份 active target-evidence 计划只更新未来命令/示例并加 supersession note，不重写 completed 历史计划、sole-agent 历史设计或 Xiaoze spike。
6. 证明 deterministic/offline startup/health；不调用 live LLM，不把缺失目标证据写成通过。

### Track D——TD-112（范围门禁通过后）

1. **Red：ProjectAdmin 公共行为。** 覆盖状态筛选/清除、受控表头排序与 `aria-sort`、>10 行分页、空态、Enter/click 进入、edit/delete 不冒泡。
2. **Green：DataTable 组合。** 通过 `DataTable` 表达 columns、toolbar、controlled sort、row action、empty、pagination；删除本地 `<table>`、filter/sort 重复和 ProjectAdmin 自有 scroll math。
3. **Red/green：通用响应式能力。** `DataTable` 增 string-header `data-label`；`HorizontalDragScroll` 墰 optional visible rail；默认消费者不变。
4. **Red/green：三档布局。** 保留 390 card、768 1080px table + 16px rail、1440 无 page overflow；768 不得被替换为 mobile card。
5. 新增专门的 `PARAM-ADMIN-003` 自动化并修正旧 ≤960px 文案；跑 `PROJ-CONFIG-READ-001` 证明 row 仍进入规范工作台。

## 每轨验证门禁

| 轨道 | 聚焦/组件 | 全量/静态 | 浏览器 | 验收/证据 |
| --- | --- | --- | --- | --- |
| TD-072 | `npx vitest run --config vitest.server.config.ts server/modules/parameters/service.test.ts server/modules/parameters/serviceReviewWorkflow.integration.test.ts server/modules/parameter-topology/postCutoverWorkflow.integration.test.ts` | `npm run test:server`、`npx tsc -b`、`npm run build`、`npm run docs:check`、`git diff --check` | 不适用：无可见 UI | 不适用：真实 DB integration 足够；不宣称 target DB |
| TD-110 | `npx vitest run src/mockData.apiInitialState.test.ts src/reducer.userPermissions.test.ts src/UserPermissionsPage.test.tsx src/App.test.tsx` | `npm test`、typecheck、build、docs、diff | API `/organization/members` 1440×900、768×1024、390×844 各 snapshot+screenshot；reload 无 demo flash；`/api/v1/me` 与 directory 200；console error=0 | `e2e/acceptance/permissions.acceptance.spec.ts` 的 `PERM-USER-MGMT-001`，保留非 Admin 拒绝、API、DB、audit |
| TD-031 | 聚焦 server config/health/Xiaoze tests 与 `ops/self-hosted/scripts/{check-self-hosted-config,selfhost-profile,selfhost-answers,ip-lab-profile,setup-selfhost}.test.ts` | `npm run test:server`、`npm run test:scripts`、`npm run selfhost:check`、`npm run contract:check`、docs、typecheck、build、diff | 不适用：无 UI/route 交互变化 | 只认 offline/deterministic health/self-host config；live provider、target readiness、secret provisioning 排除 |
| TD-112 | DataTable、HorizontalDragScroll、ProjectAdmin 行为/布局、ParameterAdminNextPage 聚焦测试 | `npm test`、lint、ui:check、typecheck、build、docs、diff | API `/parameter-admin/projects` 1440/768/390 各 snapshot+screenshot；search/filter/sort/pagination/Enter/edit/delete；390 card 完整、768 rail、1440 无 page overflow；console error=0、相关 API 200 | 独立 spec 自动化 `PARAM-ADMIN-003`，并跑 `PROJ-CONFIG-READ-001`；重生成/校验 coverage 与 operation evidence |

浏览器产物分别放 `work/ui-checks/wave3-td110/`、`work/ui-checks/wave3-td112/`。每个可见轨 PR 必须记录 URL、三视口、交互、截图路径、console/network、发现/修复的问题与既有非 error warning。

## Review、PR、CI 与合入顺序

1. 先合入本规划 PR；实现分支不得早于合入后的规划基线。
2. 从刷新后的 `main` 并行启动 TD-072、TD-110、TD-031。
3. 每条实现分支都必须：记录 red/green 证据；parent fetch/rebase 并复跑 typecheck/受影响测试；由非实现者两个 agent 并行做 Standards 与 Spec review；修完后复审到 0 findings；只有 parent push/开 PR，等待全部 required CI 后合入并同步本地 `main`。
4. 第一波优先合入 TD-072 → TD-110 → TD-031。TD-110 若先绿可先合，随即把该 worker 槽位复用为 TD-112，从刷新后的 `main` 建分支。
5. TD-112 review 前 rebase 到所有已合第一波，尤其要吸收 TD-031 对 FRONTEND 的修改，并复跑 typecheck/受影响测试。
6. TD-112 只有 scope gate、三视口、`PARAM-ADMIN-003`、`PROJ-CONFIG-READ-001`、两轴 0 finding、全部 required CI 都绿后才合入。
7. 最后从刷新后的 `main` 建 shared closeout；实现 worker 不改 tracker/计划状态。

pending CI 不是可合入。target/HDC/provider job 可按路径诚实 skip，但不能作为 readiness 证据。

## 共享 tracker 与 active-plan 卫生收口

1. 只把成功合入并有完整证据的 TD-072/110/031/112 从中英文 Open 移到 Completed；TD-112 scope gate 失败则保持 Open 并写原因。
2. 修正 TD-072 对已关 TD-096 的过时依赖；只在核验后写全仓 `QueuedResult=0`。
3. 在 `docs/design-docs/xiaoze-thread-persistence.md` 与中文 companion 补齐已实现的 assistant-message run-step metadata。
4. 将误导性的 `docs/exec-plans/active/td-031-xiaoze-run-timeline-streaming.md` 改为正确标题并归档到 `docs/exec-plans/completed/2026-08-22-xiaoze-run-timeline-streaming-metadata-closeout.md`，同时新增中文 completed companion。
5. 更新两份 PLANS 与 launch actionable closeout 当前态；历史实现证据保留，不重写。
6. 所有 Update/Review 文档行解决且组合门禁通过后，才把本计划中英文从 `active/` 移到 `completed/`；不得两处同时存在。

## 成功标准

- 第一波三个 worker 并行且代码所有权不重叠；TD-112 从刷新后的 `main` 复用 TD-110 槽位。
- 全仓 `QueuedResult=0`，三个余量行为/policy 仍有覆盖，没有用 SQL-text/call-order 冒充行为证据。
- API 初态没有 demo user/authority；mock 保留九人 cast；API auth/directory hydration 正确且无 demo 闪现。
- 当前模板/setup 只用 `XIAOZE_LLM_*`；旧名只在单一 resolver fallback 与迁移文档出现；错误/诊断不泄露值；不宣称 live provider readiness。
- `ProjectAdminTable` 组合 `DataTable`，不再拥有手写 `<table>`/scroll math，保留 390/768/1440 及 entry/action/filter/sort/pagination。
- TD-112 有条件、以证据关闭；Dts、legacy ParametersTable、PCW 非表格表面明确排除。
- 每个实现与共享收口均经独立 Standards/Spec 复审到 0 finding，required PR CI 全绿后合入。
- 中英文 tracker、PLANS、计划位置、acceptance registries/maps 与 Xiaoze timeline 计划卫生在最终 `main` 一致。

## 最终组合验证

从全部实现 PR 合入后的刷新 `main` 运行：

```bash
npx tsc -b
npm test -- --maxWorkers=4
npm run test:server
npm run build
npm run lint
npm run ui:check
npm run test:scripts
npm run selfhost:check
npm run contract:check
npm run acceptance:coverage
npm run docs:check
git diff --check
```

同时从最终合入路由复跑 TD-110/112 API-mode 浏览器门禁。completed 计划和 tracker 记录精确测试数、skip、warning、截图、network/console、CI check、PR 与 merge SHA。

## Documentation Impact Matrix

| 区域 | 状态 | 精确文件 / 证据要求 |
| --- | --- | --- |
| 仓库地图 | Review | `AGENTS.md`、`docs/zh-CN/root/AGENTS.md`、`ARCHITECTURE.md`、`docs/zh-CN/root/ARCHITECTURE.md`、`docs/README.md`、`docs/zh-CN/README.md`；导航/runtime boundary 未变则记录 unchanged。 |
| 规划 | Update | 本计划中英文、`docs/PLANS.md`、`docs/zh-CN/PLANS.md`、launch actionable closeout 中英文、Shared closeout 指定的 stale timeline source/destination。 |
| 技术债 | Update | `docs/exec-plans/tech-debt-tracker.md`、`docs/zh-CN/exec-plans/tech-debt-tracker.md`；只移动有合入证据的行。 |
| 领域语境 | Review | `CONTEXT.md`、`docs/adr/`；保留 everyday Parameter workbench 与 Parameter admin/configuration-workbench 区分；只有 durable decision 变化才加 ADR。 |
| 产品规格 | No change | `docs/product-specs/index.md`、`product-spec.md` 及中文 companions；本计划不改 workflow/permission 决策。 |
| 前端架构 | Update | `docs/FRONTEND.md`、`docs/zh-CN/frontend.md`；删除 API demo-user 描述、明确 TD-112 Admin-list closure，并更新其中 Xiaoze env 名称。 |
| 质量/测试 | Review | `docs/QUALITY_SCORE.md`、中文页、testing-strategy 中英文、verification-matrix 中英文；若全仓 gate 不变则记录 unchanged。 |
| 浏览器验收 | Update | `e2e/acceptance/requirements.ts`、`operationMatrix.ts`、新 TD-112 spec、browser-acceptance-coverage-map 中英文、生成的 user-operation-coverage-matrix 中英文；`PARAM-ADMIN-003` 改 automated 且 breakpoints 准确，保留 `PROJ-CONFIG-READ-001`。 |
| 环境/runtime | Update | `.env.example`、`ops/self-hosted/.env.example`、`.env.ip-lab.example`、environment-variables 中英文、local-development 中英文、`docs/zh-CN/backend-runtime.md`；canonical output、legacy migration input。 |
| 可靠性/runbook | Update | `docs/RELIABILITY.md` 及中文、agent-provider/observability-operations/manual-acceptance/m5-commercial-pilot-readiness 中英文、deployment-operations 中英文；保留 local/target 证据边界。 |
| 活跃 target-evidence 计划 | Update | 2026-05-29 staging-pilot 与 non-HDC-target-evidence 计划中英文；示例改 canonical，不伪造目标证据。 |
| 安全/治理 | Update | `docs/SECURITY.md` 及中文、secrets-management 中英文、`scripts/check-doc-governance.ts` 与测试；规范键仍满足 redaction/no-commit。 |
| 前端/design | Review | ui-design-system 中英文、ui-quality-checklist 中英文；TD-112 三视口绿后才可记录 unchanged。 |
| API/generated | No change | API README 中英文、api-contract 中英文、`docs/generated/openapi.json`；无 HTTP contract 变化，`contract:check` 证明无 drift。 |
| Xiaoze persistence | Update | `docs/design-docs/xiaoze-thread-persistence.md` 与中文 companion；归档旧 active plan 前补已实现 run-step metadata。 |
| References | Review | `docs/references/productization-api-contract-draft.md`、`docs/references/pi-agent-provider-evidence.md`；若发现当前 env 例子则改，否则记录 unchanged。 |

## Documentation Update Gate

该门禁阻断完成：

- 所有 `Update` 行完成修改；有 companion 的必须双语；所有 `Review` 行要么修改，要么以 commit/diff 证据明确 unchanged；
- 用 `rg` 清点 canonical/legacy Xiaoze env：当前模板/运维说明只用 canonical，legacy 只在迁移/历史语境；production 直接读取 legacy 为 0；
- `PARAM-ADMIN-003` requirement、operation registry、generated maps、自动化 spec 与三视口证据对 390/768/1440 合同一致；
- TD-072/110/031/112 tracker 状态与合入代码/CI 一致；TD-112 scope gate 失败必须 Open；
- stale Xiaoze timeline metadata 完成，计划只在 `completed/` 且有中文 companion；
- 本 Wave 3 文件在有剩余工作时只位于 `active/`，完成后只位于 `completed/`；
- 移动计划前 `npm run docs:check`、`npm run acceptance:coverage`、`npm run contract:check`、`git diff --check` 全绿；
- deferred target/HDC/live-provider evidence 继续明确，不得转写为本地完成声明。
