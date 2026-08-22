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
- 仅为更新旧变量名而重写 completed 历史计划、`docs/design-docs/2026-06-26-xiaoze-sole-agent-cleanup-design.md`、`docs/zh-CN/design-docs/2026-06-26-xiaoze-sole-agent-cleanup-design.md` 或 `server/modules/agent/xiaoze/SPIKE.md`；只更新现行规范文档，历史保持历史。
- 将 `DtsParameterWorkbenchTable`、`ParametersTable`、`/logs` rawlog、PCW tree/timeline/cards、wizard、diff/source viewer 或所有剩余手写 `<table>` 并入 TD-112。
- 重写配置工作台，或修改其路由、domain session、selection、配置操作语义。

## Deep-module 接缝与依赖分类

| 轨道 | 公共/deep 接缝 | 依赖类别 | 边界规则 |
| --- | --- | --- | --- |
| TD-072 | `submitParameterChanges(Database, AuthContext, input)`，以及由 `reviewChange` 消费的纯 semantic review subject/precondition policy | PostgreSQL 经 per-worker in-memory harness 本地可替换；policy 为进程内 | 断言返回错误与提交后状态，不断言 SQL 文本、调用顺序或私有 helper；不在 PostgreSQL 伪造 `project_id=null`。 |
| TD-110 | `createApiInitialState`、`createPrototypeState`、`HYDRATE_AUTH_CONTEXT`、`HYDRATE_USERS` | 状态转换在进程内；directory HTTP 经 `userGovernanceActions` 本地可替换 | API boot 不拥有 demo 身份；mock seed 拥有 demo cast；auth 写入当前用户，directory hydration 补/换名录且不闪 demo、不跨路由预取。 |
| TD-031 | `server/config/xiaozeLlmConfig.ts` 导出纯 `resolveXiaozeLlmConfig(env)` TypeScript 接缝、key metadata、normalized config、source 与脱敏 diagnostics；`ops/self-hosted/scripts/setup.sh` 保留唯一非 TypeScript legacy reader，作为受审计 Bash migration adapter | 运维配置来自外部；解析/health/setup 本地可替换；live model 属外部且排除 | 所有 TypeScript production consumer 只消费 resolver 结果。Bash adapter 实现相同组原子表，并由 `ops/self-hosted/scripts/setup-selfhost.test.ts` 与 TypeScript seam 做 parity；setup 不硬引入 `tsx`。 |
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
| Worker 1 | TD-072 | `codex/td-072-parameters-service-pg` | `WiseEff-worktrees/wave3-td072` | 合入后只做 review/支持 |
| Worker 2 | TD-110 | `codex/td-110-api-users-empty-boot` | `WiseEff-worktrees/wave3-td110` | TD-110 review、合入并刷新 `main` 后复用为 TD-112 |
| Worker 3 | TD-031 | `codex/td-031-xiaoze-llm-env` | `WiseEff-worktrees/wave3-td031` | 合入后只做 review/支持 |
| Worker 2 第二段 | TD-112 | `codex/td-112-project-admin-datatable` | `WiseEff-worktrees/wave3-td112` | 从刷新后的 `main` 建立，不从 TD-110 分支接着做 |
| Parent/shared | 共享收口 | `codex/deterministic-td-wave3-closeout` | `WiseEff-worktrees/wave3-closeout` | tracker、计划归档、历史计划卫生、最终门禁 |

实现 worker 只在 feature branch commit，不得 push `main`、开/合 PR，也不得编辑 tracker 或本计划。

### 所有权与冲突矩阵

| 轨道 | 实现所有权 | 共享/高冲突文件 | 控制方式 |
| --- | --- | --- | --- |
| TD-072 | `server/modules/parameters/service.test.ts`、`server/modules/parameters/service.ts`、`server/modules/parameters/reviewChangePolicy.ts`、`server/modules/parameters/reviewChangePolicy.test.ts` | 与本批其它代码无重叠 | pure policy 是 schema 不可能态的非 skip 合同；不改前端/env/tracker，不做宽泛 DB 重构。 |
| TD-110 | `src/application/state/apiInitialState.ts`、`src/infrastructure/mock/prototypeState.ts`、`src/mockData.ts`、`src/application/state/appState.ts`、`src/mockData.apiInitialState.test.ts`、`src/reducer.userPermissions.test.ts`、`src/App.test.tsx`、`src/UserPermissionsPage.test.tsx`、`docs/FRONTEND.md`、`docs/zh-CN/frontend.md` | `docs/FRONTEND.md`、`docs/zh-CN/frontend.md` | 在建 TD-112 分支前先合入；保留 mock exports 与无关 state slices。 |
| TD-031 | `server/config/xiaozeLlmConfig.ts`、`server/config/xiaozeLlmConfig.test.ts`、`server/config/env.ts`、`server/config/env.test.ts`、`server/config/envExample.test.ts`、`server/config/loadDotenv.test.ts`、`server/index.ts`、`server/app.test.ts`、`server/modules/agent/xiaoze/agUiEndpoint.ts`、`server/modules/agent/xiaoze/agUiEndpoint.test.ts`、`server/modules/agent/xiaoze/agUiEndpoint.assembly.test.ts`、`server/modules/agent/xiaoze/agUiEndpoint.concurrency.test.ts`、`server/modules/agent/xiaoze/perceptionAgent.stream.test.ts`、`server/modules/agent/xiaoze/planningGraph.test.ts`、`server/modules/agent/xiaoze/planningGraph.sink.test.ts`、`server/modules/agent/xiaoze/planningGraph.toolContext.test.ts`、`server/modules/operations/health.ts`、`server/modules/operations/health.test.ts`、`server/modules/operations/routes.ts`、`server/modules/operations/routes.test.ts`、`server/modules/knowledge/indexing/embeddingClient.ts`、`e2e/acceptance/xiaoze-perception.acceptance.spec.ts`、`e2e/acceptance/xiaoze-action.acceptance.spec.ts`、`.env.example`、`.env.local.example`、`ops/self-hosted/.env.example`、`ops/self-hosted/.env.ip-lab.example`、`ops/self-hosted/scripts/check-self-hosted-config.ts`、`ops/self-hosted/scripts/check-self-hosted-config.test.ts`、`ops/self-hosted/scripts/ip-lab-profile.ts`、`ops/self-hosted/scripts/ip-lab-profile.test.ts`、`ops/self-hosted/scripts/selfhost-answers.ts`、`ops/self-hosted/scripts/selfhost-profile.ts`、`ops/self-hosted/scripts/selfhost-profile.test.ts`、`ops/self-hosted/scripts/setup.sh`、`ops/self-hosted/scripts/setup-selfhost.test.ts`、`scripts/check-doc-governance.ts`、`scripts/check-doc-governance.test.ts`、`README.md`、`docs/zh-CN/root/README.md`、`docs/design-docs/full-stack-architecture.md`、`docs/zh-CN/design-docs/full-stack-architecture.md` 与 Documentation Impact Matrix 的精确文档路径 | `docs/FRONTEND.md`、`docs/zh-CN/frontend.md`、`README.md`、`docs/zh-CN/root/README.md`、`docs/design-docs/full-stack-architecture.md`、`docs/zh-CN/design-docs/full-stack-architecture.md`；main 上活跃 self-hosted 文件 | review/merge 前 rebase；共享运维文件只动 Xiaoze LLM key，保留其它 setup/upgrade 行为。 |
| TD-112 | `src/components/admin/ProjectAdminTable.tsx`、`src/components/admin/ProjectAdminTable.test.tsx`、`src/components/admin/ProjectAdminTable.layout.test.tsx`、`src/components/admin/DataTable.tsx`、`src/components/admin/DataTable.test.tsx`、`src/components/HorizontalDragScroll.tsx`、`src/components/HorizontalDragScroll.test.tsx`、`src/hooks/useParamAdminProjectsSearch.ts`、`src/hooks/useParamAdminProjectsSearch.test.tsx`、`src/ParameterAdminNextPage.test.tsx`、`src/styles.css`、`e2e/acceptance/parameter-admin-projects.acceptance.spec.ts`、`e2e/acceptance/requirements.ts`、`e2e/acceptance/operationMatrix.ts` 与 Documentation Impact Matrix 的精确验收/文档路径 | FRONTEND 双语页、acceptance registries/generated maps | TD-110 合入后才开始；若 TD-031 改 FRONTEND 则 review 前再 rebase；不改 `src/components/project-configuration-workbench/`。 |
| 共享收口 | `docs/exec-plans/tech-debt-tracker.md`、`docs/zh-CN/exec-plans/tech-debt-tracker.md` 与 Documentation Impact Matrix 中 Wave 3、PLANS、launch、persistence、stale-plan 的精确路径 | 所有 TD 编号与计划位置 | 全部拟关闭实现 PR 进入 `main` 后才开始，重核 TD/ADR/migration 编号。 |

## TDD 纵向切片

### Track A——TD-072

1. **Red：mixed tips。** 经 `submitParameterChanges` 构造两个真实 draft/candidate/occurrence，断言公共 `mixed-working-tips` 拒绝与持久状态不变。
2. **Green：接入 harness。** 用 `createInMemoryTestDatabase()` 和最小 seed graph 替换 queued result/SQL-call 断言。
3. **Red：node enablement。** 提交真实 enablement draft，断言返回 request 及落库 request/item/enablement 语义。
4. **Green：行为对等。** 复用生产 submit path，断言事务/rollback 后状态，不断言查询顺序。
5. **Red/green：不可能的 project-less merge。** 在 `server/modules/parameters/reviewChangePolicy.ts` 固化 semantic review subject/precondition，由 `reviewChange` 消费，并实际执行 `server/modules/parameters/reviewChangePolicy.test.ts` 的表测试；不得插入非法 DB row。
6. 删除 `QueuedResult`、`createFakeDb`、queue helpers、过时注释与该段剩余 SQL-text assertions，证明全仓 `QueuedResult` 为 0。

### Track B——TD-110

1. **Red：诚实 API 空壳。** `createApiInitialState()` 为 0 users，无 demo current-user id，auth 前是 guest-safe authority。
2. **Green：移动 cast。** 九个 demo users 归 `prototypeState.ts`；保留 `createPrototypeState`、`initialState` 与测试兼容导出，API boot 不再 import mock。
3. **Red：auth hydration。** 从空壳执行 `HYDRATE_AUTH_CONTEXT`，只写入真实当前用户与角色，不恢复 demo peers。
4. **Green：directory hydration。** 响应含当前用户时替换名录；不含时仅保留认证当前用户后拼接返回列表；loading/error/empty 继续诚实。
5. **Red/green：无闪现、无提前请求。** App/page tests 证明 auth 阶段不显示 demo 名称，无关 API route 不调用 `listUsers`。

### Track C——TD-031

1. **Red：优先级表。** 覆盖 canonical-only、legacy-only、canonical+legacy 同/异值、任一 canonical key 出现、canonical blank、不完整 live config、`XIAOZE_DETERMINISTIC`、model default；断言组原子选择与无值 diagnostics。
2. **Green：TypeScript deep resolver。** 在 `server/config/xiaozeLlmConfig.ts` 新增 dependency-light resolver/constants；model、health/readiness、routes、config validation、docs governance、TypeScript self-hosted profiles 与 `server/index.ts` 只消费 normalized result，不直读 legacy key。
3. **Red/green：受审计 Bash migration adapter。** `ops/self-hosted/scripts/setup.sh` 不能依赖 `tsx`，因此允许它作为唯一 production legacy 直读 fallback；Bash mapping 实现同一组原子 presence/blank/default/diagnostic 表，只写 canonical，并由 `ops/self-hosted/scripts/setup-selfhost.test.ts` 与 `server/config/xiaozeLlmConfig.test.ts` 共享 case matrix 做 parity。
4. **Red：输出。** root/self-hosted env template 与 setup/profile writer 只产 canonical 三键；读取旧 `.env` 后写回 canonical 且不丢其它配置。
5. **Green：迁移。** 旧别名保留一个窗口；任一 canonical raw key 使整组 canonical 生效，显式 blank 不回退；只有 canonical 全缺才读 legacy。health/error 只报规范语义/key，不含 secret value。
6. 更新当前规范性中英文 env/security/reliability/provider/setup/acceptance/deployment/contribution docs；两份 active target-evidence 计划只更新未来命令/示例并加 supersession note，不重写 completed 历史计划、sole-agent 历史设计或 Xiaoze spike。
7. 在一个 fresh、dedicated Playwright runtime 中通过两份既有 acceptance spec 证明 deterministic/offline startup、health、Xiaoze perception 与 action；运行时固定 `CI=true`、`XIAOZE_DETERMINISTIC=true`，不得复用既有 live runtime、提供或调用 live provider，也不得把缺失目标证据写成通过。

### Track D——TD-112（范围门禁通过后）

1. **Red：ProjectAdmin 公共行为与 URL 合同。** 覆盖状态筛选/清除、受控表头排序与 `aria-sort`、>10 行分页、空态、Enter/click 进入、edit/delete 不冒泡；search/status/sort 写入既有 `q`/`status`/`sort` query key，reload、`popstate`、浏览器 Back/Forward 恢复控件、rows 与 sort direction。
2. **Green：DataTable 组合。** 通过 `DataTable` 表达 columns、toolbar、controlled sort、row action、empty、pagination；删除本地 `<table>`、filter/sort 重复和 ProjectAdmin 自有 scroll math。
3. **Red/green：通用响应式能力。** `DataTable` 增 string-header `data-label`；`HorizontalDragScroll` 墰 optional visible rail；默认消费者不变。
4. **Red/green：三档布局。** 保留 390 card、768 1080px table + 16px rail、1440 无 page overflow；768 不得被替换为 mobile card。
5. 新增 `e2e/acceptance/parameter-admin-projects.acceptance.spec.ts` 自动化 `PARAM-ADMIN-003` 并修正旧 ≤960px 文案；跑 `PROJ-CONFIG-READ-001`，并覆盖 `q`/`status`/`sort` 写入、reload、`popstate`、Back/Forward 恢复。

## 每轨验证门禁

TD-072 另有阻断式 preflight，因为 PostgreSQL suite 使用 `describe.skipIf(!databaseAvailable)`。worker 必须先让 local PostgreSQL 可经 `TEST_DATABASE_URL`、`DATABASE_URL` 或仓库默认地址访问，并运行：

```bash
npx tsx -e 'import("./server/testing/testDatabase.ts").then(async ({ isTestDatabaseAvailable }) => { if (!(await isTestDatabaseAvailable())) process.exit(1); })'
```

该命令必须 exit 0。随后 verbose focused run 必须显示 mixed-tip、node-enablement 与 project-less pure-policy 三个行为实际执行，且这三项 **0 skip**。PostgreSQL suite 被跳过、只执行 policy，或 CI 没有具名 test 证据，都不能关闭 TD-072。

| 轨道 | 聚焦/组件 | 全量/静态 | 浏览器 | 验收/证据 |
| --- | --- | --- | --- | --- |
| TD-072 | 先过 PostgreSQL preflight，再运行 `npx vitest run --reporter=verbose --config vitest.server.config.ts server/modules/parameters/service.test.ts server/modules/parameters/reviewChangePolicy.test.ts server/modules/parameters/serviceReviewWorkflow.integration.test.ts server/modules/parameter-topology/postCutoverWorkflow.integration.test.ts`；记录三个具名行为与 0 skip | `npm run test:server`、`npx tsc -b`、`npm run build`、`npm run docs:check`、`git diff --check` | 不适用：无可见 UI | 本地真实 DB 行为 + in-process policy；不宣称 target DB |
| TD-110 | `npx vitest run src/mockData.apiInitialState.test.ts src/reducer.userPermissions.test.ts src/UserPermissionsPage.test.tsx src/App.test.tsx` | `npm test`、`npm run acceptance:quality`、typecheck、build、docs、diff | API `/organization/members` 1440×900、768×1024、390×844 各 snapshot+screenshot；reload 无 demo flash；`/api/v1/me` 与 directory 200；console error=0 | `e2e/acceptance/permissions.acceptance.spec.ts` 的 `PERM-USER-MGMT-001`，保留非 Admin 拒绝、API、DB、audit |
| TD-031 | `npx vitest run --config vitest.server.config.ts server/config/xiaozeLlmConfig.test.ts server/config/env.test.ts server/config/envExample.test.ts server/config/loadDotenv.test.ts server/modules/agent/xiaoze/agUiEndpoint.test.ts server/modules/agent/xiaoze/agUiEndpoint.assembly.test.ts server/modules/agent/xiaoze/agUiEndpoint.concurrency.test.ts server/modules/agent/xiaoze/perceptionAgent.stream.test.ts server/modules/agent/xiaoze/planningGraph.test.ts server/modules/agent/xiaoze/planningGraph.sink.test.ts server/modules/agent/xiaoze/planningGraph.toolContext.test.ts server/modules/operations/health.test.ts server/modules/operations/routes.test.ts`；`npx vitest run --config vitest.scripts.config.ts ops/self-hosted/scripts/check-self-hosted-config.test.ts ops/self-hosted/scripts/ip-lab-profile.test.ts ops/self-hosted/scripts/selfhost-profile.test.ts ops/self-hosted/scripts/setup-selfhost.test.ts scripts/check-doc-governance.test.ts`；`CI=true XIAOZE_DETERMINISTIC=true WISEEFF_ACCEPTANCE_FRONTEND_URL=http://127.0.0.1:5193 VITE_WISEEFF_API_BASE_URL=http://127.0.0.1:8931 npm run acceptance:e2e -- e2e/acceptance/xiaoze-perception.acceptance.spec.ts e2e/acceptance/xiaoze-action.acceptance.spec.ts` | `npm run test:server`、`npm run test:scripts`、`npm run selfhost:check`、`npm run contract:check`、docs、typecheck、build、diff | 不适用：无 UI/route 交互变化 | 只认 offline/deterministic health、perception、action 与 self-host config；下述 dedicated-runtime gate 必须证明 fresh Xiaoze deterministic-ready 并记录 0 external-provider request，不使用或宣称 live provider credentials、target readiness、secret provisioning |
| TD-112 | `npx vitest run src/components/admin/ProjectAdminTable.test.tsx src/components/admin/ProjectAdminTable.layout.test.tsx src/components/admin/DataTable.test.tsx src/components/HorizontalDragScroll.test.tsx src/hooks/useParamAdminProjectsSearch.test.tsx src/ParameterAdminNextPage.test.tsx` | `npm test`、`npm run acceptance:quality`、`npm run acceptance:a11y`、`npm run acceptance:visual`、`npm run acceptance:responsive`、lint、ui:check、typecheck、build、docs、diff | API `/parameter-admin/projects` 1440/768/390 各 snapshot+screenshot；search/filter/sort/pagination/Enter/edit/delete；验证 reload/`popstate`/Back/Forward 后的 `q`/`status`/`sort`；390 card、768 rail、1440 无 page overflow；console error=0、相关 API 200 | 先跑 `npm run acceptance:operations`，再用 focused Playwright 运行 `e2e/acceptance/parameter-admin-projects.acceptance.spec.ts` 的 `PARAM-ADMIN-003` 与 `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts` 的 `PROJ-CONFIG-READ-001`，最后用 `npm run acceptance:evidence -- --run <runDir> --require PARAM-ADMIN-003` 校验实际证据；不能只靠重生成 maps 关闭 |

浏览器产物分别放 `work/ui-checks/wave3-td110/`、`work/ui-checks/wave3-td112/`。每个可见轨 PR 必须记录 URL、三视口、交互、截图路径、console/network、发现/修复的问题与既有非 error warning。

TD-031 focused acceptance 固定预留 frontend `5193`、API `8931`；实施时两端口均空闲。`5193` 位于仓库既有 localhost CORS allowlist（`5173–5199`）内，本门禁不得扩张该 allowlist。实际运行前必须用只读探针再次确认：

```bash
! lsof -nP -iTCP:5193 -sTCP:LISTEN
! lsof -nP -iTCP:8931 -sTCP:LISTEN
```

任一端口占用时，不得杀掉、重启或复用该进程。另选一对空闲 dedicated ports，在 PR 证据中记录精确替代值，并在以下所有 URL 中一致替换。`CI=true` 使 `reuseExistingServer=false`；frontend `--strictPort` 和 API bind 都必须在端口占用时失败，不能附着既有 runtime。两份 spec 在一次命令中运行，由 Playwright 持有同一个 fresh runtime：

```bash
CI=true XIAOZE_DETERMINISTIC=true WISEEFF_ACCEPTANCE_FRONTEND_URL=http://127.0.0.1:5193 VITE_WISEEFF_API_BASE_URL=http://127.0.0.1:8931 npm run acceptance:e2e -- e2e/acceptance/xiaoze-perception.acceptance.spec.ts e2e/acceptance/xiaoze-action.acceptance.spec.ts
```

Playwright 启动 API/frontend webServer 后、两份 Xiaoze 场景执行前，acceptance precondition 必须抓取 dedicated API 的 `/health/ready`，要求 `dependencies.xiaozeLlm.status=ready` 且 message 明确 deterministic mode。保留 fresh-process/server log 或等价 focused artifact，并记录未发生 external provider request。复用 runtime、占用端口 fallback、缺少 deterministic-ready health 证据或出现任何 external provider request，都阻断 TD-031 关闭。

TD-112 focused acceptance 必须创建稳定的 focused run ID 并保留实际输出的 run directory。Playwright 前校验 operation matrix，把两份相关 spec 绑定到同一 run，之后对具体目录做证据校验：

```bash
npm run acceptance:operations
WISEEFF_ACCEPTANCE_EVIDENCE_RUN_ID=<focused-run-id> WISEEFF_ACCEPTANCE_EVIDENCE_RUN_KIND=focused npm run acceptance:e2e -- e2e/acceptance/parameter-admin-projects.acceptance.spec.ts e2e/acceptance/project-configuration-workbench.acceptance.spec.ts
npm run acceptance:evidence -- --run <runDir> --require PARAM-ADMIN-003
```

## Git & PR Workflow

1. 先合入本规划 PR；上表所有 `codex/` feature branch 与 worktree 都从其后的最新 `origin/main` 建立，不得早于合入后的规划基线。
2. 从刷新后的 `main` 并行启动 TD-072、TD-110、TD-031。
3. 每条实现分支都必须：实现 subagent 在被分配的 `codex/` 分支记录 red/green 证据并 commit；parent fetch/rebase 并复跑 typecheck/受影响测试；由非实现者两个 agent 并行做 Standards 与 Spec review；修完后复审到 0 findings；subagent 不开/合 PR、不 push/fast-forward `main`；只有 parent push feature branch、开 PR、等待全部 required CI、合入，再在 parent main worktree 执行 `git pull origin main`。
4. 第一波优先合入 TD-072 → TD-110 → TD-031。TD-110 若先绿可先合，随即把该 worker 槽位复用为 TD-112，从刷新后的 `main` 建分支。
5. TD-112 review 前 rebase 到所有已合第一波，尤其要吸收 TD-031 对 FRONTEND 的修改，并复跑 typecheck/受影响测试。
6. TD-112 只有 scope gate、三视口、`PARAM-ADMIN-003`、`PROJ-CONFIG-READ-001`、两轴 0 finding、全部 required CI 都绿后才合入。
7. 最后从刷新后的 `main` 建 shared closeout；实现 worker 不改 tracker/计划状态。

pending CI 不是可合入。target/HDC/provider job 可按路径诚实 skip，但不能作为 readiness 证据。

## 共享 tracker 与 active-plan 卫生收口

1. 只把成功合入并有完整证据的 TD-072/110/031/112 从中英文 Open 移到 Completed；TD-112 scope gate 失败则保持 Open 并写原因。
2. 修正 TD-072 对已关 TD-096 的过时依赖；只在核验后写全仓 `QueuedResult=0`。
3. 在 `docs/design-docs/xiaoze-thread-persistence.md` 与 `docs/zh-CN/design-docs/xiaoze-thread-persistence.md` 补齐已实现的 assistant-message run-step metadata。
4. 将 `docs/exec-plans/active/td-031-xiaoze-run-timeline-streaming.md` 归档为 `docs/exec-plans/completed/2026-08-22-xiaoze-run-timeline-streaming-metadata-closeout.md`，并新建 `docs/zh-CN/exec-plans/completed/2026-08-22-xiaoze-run-timeline-streaming-metadata-closeout.md`。
5. 更新 `docs/PLANS.md`、`docs/zh-CN/PLANS.md`、`docs/exec-plans/active/2026-08-17-launch-actionable-tech-debt-closeout.md`、`docs/zh-CN/exec-plans/active/2026-08-17-launch-actionable-tech-debt-closeout.md`；历史实现证据保留，不重写。
6. 所有 Update/Review 行与组合门禁通过后，把 `docs/exec-plans/active/2026-08-22-deterministic-tech-debt-parallel-closeout-wave-3.md` 移到 `docs/exec-plans/completed/2026-08-22-deterministic-tech-debt-parallel-closeout-wave-3.md`，把中文 active companion 移到 `docs/zh-CN/exec-plans/completed/2026-08-22-deterministic-tech-debt-parallel-closeout-wave-3.md`；不得在 active/completed 同时存在。

## 成功标准

- 第一波三个 worker 并行且代码所有权不重叠；TD-112 从刷新后的 `main` 复用 TD-110 槽位。
- 全仓 `QueuedResult=0`，local PostgreSQL preflight 通过，两个转换后的 DB 行为与 pure project-less policy test 实际执行且 0 skip，没有用 SQL-text/call-order 冒充行为证据。
- API 初态没有 demo user/authority；mock 保留九人 cast；API auth/directory hydration 正确且无 demo 闪现。
- 当前模板/setup 只用 `XIAOZE_LLM_*`；legacy 直读只允许出现在 `server/config/xiaozeLlmConfig.ts`、受审计的 `ops/self-hosted/scripts/setup.sh` Bash adapter、精确测试与显式迁移/历史文档，其余 production 为 0；TypeScript/Bash parity 通过，错误/诊断不泄露值，不宣称 live provider readiness。
- `ProjectAdminTable` 组合 `DataTable`，不再拥有手写 `<table>`/scroll math，保留 390/768/1440、entry/action/filter/sort/pagination，以及 reload/`popstate`/Back/Forward 下 `q`/`status`/`sort` 恢复。
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
npm run acceptance:operations
npm run acceptance:quality
npm run acceptance:a11y
npm run acceptance:visual
npm run acceptance:responsive
npm run acceptance:browser -- --mode local-non-hdc
npm run acceptance:evidence
npm run docs:check
git diff --check
```

同时复跑 TD-072 local PostgreSQL preflight/具名 0-skip 门禁，以及最终合入路由上的 TD-110/112 API-mode 浏览器门禁。completed 计划和 tracker 记录精确测试数、skip、TD-072 具名 case、warning、截图、network/console、CI check、PR 与 merge SHA。

## Documentation Impact Matrix

| 区域 | 状态 | 精确文件 / 证据要求 |
| --- | --- | --- |
| 仓库地图 | Review | `AGENTS.md`、`docs/zh-CN/root/AGENTS.md`、`ARCHITECTURE.md`、`docs/zh-CN/root/ARCHITECTURE.md`、`docs/README.md`、`docs/zh-CN/README.md`；后两者作为 docs 知识库索引成对 Review；导航/runtime boundary 未变则记录 unchanged。 |
| 架构入口 | Update | `README.md`、`docs/zh-CN/root/README.md`、`docs/design-docs/full-stack-architecture.md`、`docs/zh-CN/design-docs/full-stack-architecture.md`；对齐 Xiaoze canonical runtime/configuration 入口，保留 local-deterministic 与 live-provider 证据边界。 |
| 规划 | Update | `docs/exec-plans/active/2026-08-22-deterministic-tech-debt-parallel-closeout-wave-3.md`、`docs/zh-CN/exec-plans/active/2026-08-22-deterministic-tech-debt-parallel-closeout-wave-3.md`、closeout destinations `docs/exec-plans/completed/2026-08-22-deterministic-tech-debt-parallel-closeout-wave-3.md` 与 `docs/zh-CN/exec-plans/completed/2026-08-22-deterministic-tech-debt-parallel-closeout-wave-3.md`、`docs/PLANS.md`、`docs/zh-CN/PLANS.md`、`docs/exec-plans/active/2026-08-17-launch-actionable-tech-debt-closeout.md`、`docs/zh-CN/exec-plans/active/2026-08-17-launch-actionable-tech-debt-closeout.md`、stale source `docs/exec-plans/active/td-031-xiaoze-run-timeline-streaming.md`、archive destinations `docs/exec-plans/completed/2026-08-22-xiaoze-run-timeline-streaming-metadata-closeout.md` 与 `docs/zh-CN/exec-plans/completed/2026-08-22-xiaoze-run-timeline-streaming-metadata-closeout.md`。 |
| 技术债 | Update | `docs/exec-plans/tech-debt-tracker.md`、`docs/zh-CN/exec-plans/tech-debt-tracker.md`；只移动有合入证据的行。 |
| 领域语境 | Review | `CONTEXT.md`、`docs/adr/README.md`；保留 everyday Parameter workbench 与 Parameter admin/configuration-workbench 区分；durable decision 不变时不加 ADR。 |
| 产品规格 | No change | `docs/product-specs/index.md`、`docs/product-specs/product-spec.md`、`docs/zh-CN/product-specs/index.md`、`docs/zh-CN/product-specs/product-spec.md`；本计划不改 workflow/permission 决策。 |
| 前端架构 | Update | `docs/FRONTEND.md`、`docs/zh-CN/frontend.md`；删除 API demo-user 描述、明确 TD-112 Admin-list closure，并更新其中 Xiaoze env 名称。 |
| 质量/测试 | Review | `docs/QUALITY_SCORE.md`、`docs/zh-CN/QUALITY_SCORE.md`、`docs/design-docs/testing-strategy.md`、`docs/zh-CN/design-docs/testing-strategy.md`、`docs/developer/verification-matrix.md`、`docs/zh-CN/developer/verification-matrix.md`；若全仓 gate 不变则记录 unchanged。 |
| 浏览器验收 | Update | `e2e/acceptance/requirements.ts`、`e2e/acceptance/operationMatrix.ts`、`e2e/acceptance/parameter-admin-projects.acceptance.spec.ts`、`docs/developer/browser-acceptance-coverage-map.md`、`docs/zh-CN/developer/browser-acceptance-coverage-map.md`、`docs/developer/user-operation-coverage-matrix.md`、`docs/zh-CN/developer/user-operation-coverage-matrix.md`；`PARAM-ADMIN-003` 改 automated 并覆盖准确 breakpoints/URL history，保留 `PROJ-CONFIG-READ-001`，通过 `npm run acceptance:operations`、focused evidence 命令、`npm run acceptance:quality`、`npm run acceptance:a11y`、`npm run acceptance:visual`、`npm run acceptance:responsive`。 |
| 环境/runtime/contribution | Update | `.env.example`、`.env.local.example`、`ops/self-hosted/.env.example`、`ops/self-hosted/.env.ip-lab.example`、`CONTRIBUTING.md`、`docs/zh-CN/root/CONTRIBUTING.md`、`docs/developer/environment-variables.md`、`docs/zh-CN/developer/environment-variables.md`、`docs/developer/local-development.md`、`docs/zh-CN/developer/local-development.md`、`docs/zh-CN/backend-runtime.md`；canonical output、legacy migration input。 |
| 可靠性/runbook | Update | `docs/RELIABILITY.md`、`docs/zh-CN/RELIABILITY.md`、`docs/runbooks/agent-provider.md`、`docs/zh-CN/runbooks/agent-provider.md`、`docs/runbooks/observability-operations.md`、`docs/zh-CN/runbooks/observability-operations.md`、`docs/runbooks/manual-acceptance.md`、`docs/zh-CN/manual-acceptance.md`、`docs/runbooks/m5-commercial-pilot-readiness.md`、`docs/zh-CN/runbooks/m5-commercial-pilot-readiness.md`、`docs/design-docs/deployment-operations.md`、`docs/zh-CN/design-docs/deployment-operations.md`；保留 local/target 证据边界。 |
| 活跃 target-evidence 计划 | Update | `docs/exec-plans/active/2026-05-29-wiseeff-m5-2-staging-pilot-evidence-execution.md`、`docs/exec-plans/active/2026-05-29-wiseeff-m5-2-non-hdc-target-evidence-closure.md`；这两份历史 evidence-execution 计划没有直接中文 companion，只更新英文中的 future 示例和 supersession note，不伪造目标证据。当前运维说明仍由上方环境、runbook、可靠性与安全行保持双语。 |
| 安全 secrets/治理 | Update | `docs/security/secrets-management.md`、`docs/zh-CN/security/secrets-management.md`、`docs/zh-CN/security-reliability.md`、`scripts/check-doc-governance.ts`、`scripts/check-doc-governance.test.ts`；规范键仍满足 redaction/no-commit。 |
| 安全地图 | Review | `docs/SECURITY.md`、`docs/zh-CN/SECURITY.md`、`docs/security/README.md`、`docs/zh-CN/security/README.md`；trust/authz/audit/secret classification 不变则记录 unchanged。 |
| 前端/design | Review | `docs/design-docs/ui-design-system.md`、`docs/zh-CN/design-docs/ui-design-system.md`、`docs/developer/ui-quality-checklist.md`、`docs/zh-CN/developer/ui-quality-checklist.md`；TD-112 三视口绿后才可记录 unchanged。 |
| API/generated | No change | `docs/api/README.md`、`docs/zh-CN/api/README.md`、`docs/design-docs/api-contract.md`、`docs/zh-CN/design-docs/api-contract.md`、`docs/generated/openapi.json`；无 HTTP contract 变化，`contract:check` 证明无 drift。 |
| Xiaoze persistence | Update | `docs/design-docs/xiaoze-thread-persistence.md`、`docs/zh-CN/design-docs/xiaoze-thread-persistence.md`；归档旧 active plan 前补已实现 run-step metadata。 |
| References | Review | `docs/references/productization-api-contract-draft.md`、`docs/references/pi-agent-provider-evidence.md`；若发现当前 env 例子则改，否则记录 unchanged。 |

## Documentation Update Gate

该门禁阻断完成：

- 所有 `Update` 行完成修改；有 companion 的必须双语；所有 `Review` 行要么修改，要么以 commit/diff 证据明确 unchanged；
- 用 `rg` 清点 canonical/legacy Xiaoze env：当前模板/运维说明只用 canonical；legacy 直读限于 `server/config/xiaozeLlmConfig.ts`、`ops/self-hosted/scripts/setup.sh`、精确测试与迁移/历史文档；TypeScript/Bash parity 通过；
- `PARAM-ADMIN-003` requirement、operation registry、generated maps、`e2e/acceptance/parameter-admin-projects.acceptance.spec.ts` 与三视口证据对 390/768/1440 + `q`/`status`/`sort` history 合同一致；`npm run acceptance:operations` 通过，且 focused run directory 通过 `npm run acceptance:evidence -- --run <runDir> --require PARAM-ADMIN-003`；
- TD-072/110/031/112 tracker 状态与合入代码/CI 一致；TD-112 scope gate 失败必须 Open；
- stale Xiaoze timeline metadata 完成，计划只在 `completed/` 且有中文 companion；
- 本 Wave 3 文件在有剩余工作时只位于 `active/`，完成后只位于 `completed/`；
- 移动计划前 `npm run docs:check`、`npm run acceptance:coverage`、`npm run acceptance:operations`、`npm run acceptance:quality`、`npm run acceptance:a11y`、`npm run acceptance:visual`、`npm run acceptance:responsive`、`npm run acceptance:browser -- --mode local-non-hdc`、`npm run acceptance:evidence`、`npm run contract:check`、`git diff --check` 全绿；
- deferred target/HDC/live-provider evidence 继续明确，不得转写为本地完成声明。
