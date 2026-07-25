# 参数管理首页生产级重设计方案

日期：2026-07-07
状态：**已实施**
适用范围：`/parameter-home`（组件 `ParameterHomePage`，特性目录 `src/features/parameter-home/`）

## 背景与问题

当前 `/parameter-home` 停留在原型/mock 阶段，三个层面都不达生产上线标准：

- **数据真实性**：参数更新趋势图完全用固定参考日（2026-05-10）的 LCG 伪随机序列生成，与真实变更历史无关；各项目风险分布图基于真实风险计数但叠加随机 jitter；"AI 评分拆解"实为前端硬编码的五维启发式公式，却以"AI"名义呈现。
- **后端接入**：页面无专用后端聚合接口，完全从全局 `PrototypeState` 同步派生；API 模式下部分工作台信号（配置脏态、账号需关注、待导出）仍来自 mock 残留字段。
- **前端工程与视觉**：单文件组件 591 行，全局 `styles.css` 已 11000+ 行；缺少 loading/空态/错误态；图表为手写 SVG；缺乏统一视觉令牌系统。

## 目标

将 `/parameter-home` 提升到生产上线标准：真实后端聚合数据 + 视觉/交互重设计，作为一次整体改造，分阶段交付。

## 已确认决策

| 决策点 | 选择 |
| --- | --- |
| 核心目标 | 后端真实数据 + 视觉/交互重设计，整体改造 |
| 后端数据架构 | 新增专用看板聚合接口，服务端 SQL 聚合，前端只渲染 |
| 热榜评分 | 服务端可解释确定性评分（不再叫 AI），可复现可审计 |
| 设计方向 | 更彻底的重设计，重新构思信息架构与页面叙事 |
| 图表实现 | 引入轻量图表库（Recharts） |
| 主要服务对象 | Guest / User / Committer / Admin 四角色均需生产级体验 |
| 交付方式 | 一份 spec，分阶段实施，每阶段可独立验证 |
| 功能取舍 | 以最优生产体验为准，现有能力均可重组 |

## 信息架构与页面叙事：自适应指挥台

页面核心问题按角色分层回答：operator（User/Committer）优先"我现在该做什么"，Admin/Guest 优先"参数态势如何"，但四角色共用同一骨架、同一组件与同一数据源，仅调整重心与默认展开状态。

统一信息架构（自上而下）：

### 1. 态势条 `SituationStrip`（真实数据，全角色）

- 一行紧凑 KPI：参数总量、管理项目数、近窗变更频次、近窗活跃贡献者、近窗高风险项。
- 数据来自新后端聚合接口，随 TopBar 项目选择 + 时间窗联动。
- 含 loading 骨架、空态、错误态（带重试）。

### 2. 主区 `WorkbenchPrimary`（角色感知，重心自适应）

- **operator 重心**：任务队列（"我的下一步"）占主视觉；右侧为权限过滤后的场景入口。
- **Admin 重心**：治理动作 + 高优异常摘要占主视觉；场景入口为直接管理入口，不显示解释型"我要治理"入口。
- **Guest 重心**：只读引导 + 可访问入口；不出现会被权限拒绝的动作。
- 任务队列的"脏态/账号异常/待导出"等信号改为来自真实后端，不再依赖 mock 残留字段。
- 所有行动与入口在视图模型阶段按权限过滤，不依赖路由权限页兜底。

### 3. 证据区 `InsightSection`（真实数据 + 图表库）

- 参数更新趋势（真实时序）、各项目风险分布（真实计数）、可解释热榜（服务端评分 + 真实证据）。
- Admin/Guest 默认展开；operator 首屏默认折叠（渐进披露），保持行动优先。
- 热榜维度切换（总/模块/项目/参数）与评分拆解保留，改为服务端计算、可审计。

### 分析上下文控件统一

解决当前"时间窗在 TopBar、热榜维度在页面内"的职责分裂：收敛为页面内统一的"分析上下文"控件区（时间窗 + 维度就近放置），TopBar 仅保留项目选择器。

### 移动端顺序

态势条 → 主区（先任务/动作，后入口）→ 证据区（热榜沿用 accordion）。

## 后端聚合 API 设计

新增子模块 `server/modules/parameters/dashboard/`（routes + service + repository + policy），挂载于现有 parameters 模块下。所有端点要求 `parameter:view` 权限，组织范围由鉴权上下文注入，项目范围由 `projectId` query 决定（参数仍是 project 维度，未受 migration 0037 影响）。

按刷新频率拆分为两个端点，减少无谓重算：

### 1. `GET /api/v1/parameters/dashboard/summary?projectId=&window=`

一次性返回与"维度"无关的全部区块，随项目/时间窗变化刷新：

- **KPI**（态势条）：参数总量、管理项目数、近窗变更频次、近窗活跃贡献者、近窗高风险项。
- **趋势序列**（真实时序）：按 `window` 用 `date_trunc` 对 `parameter_history_entries.changed_at`（叠加 `parameter_change_requests.created_at` 作为流程事件）分桶，7d/30d 按天、180d 按周，返回 `[{ bucketStart, changeCount, ... }]`。
- **风险分布**（真实计数）：`project_parameter_values` join `parameter_definitions.risk`，按项目 + 风险等级 `COUNT GROUP BY`，返回各项目 high/medium/low。
- **工作台信号**（真实后端）：待审阅数、我的草稿数、被退回数、等待合入数、未应用导入批次（脏态替代）、停用/待复核账号数，供主区任务队列消费，取代 mock 残留字段。

### 2. `GET /api/v1/parameters/dashboard/hotspots?projectId=&window=&dimension=`

仅热榜（维度相关），切换维度时单独刷新：

- 按 `dimension`（overall/module/project/parameter）在 SQL 侧聚合每组的变更频次、风险权重、影响范围、流程堆积、偏离度。
- **评分下沉到服务端**：沿用现有五维确定性公式（frequency/risk/impact/workflow/drift），改为基于真实聚合计算，返回 `score` + `scoreBreakdown` + `evidence[]` + `suggestedPath`，前端只渲染。
- **诚实命名**：接口与 UI 从"AI 评分拆解"改为"热度评分构成/依据"；评分可复现、可审计。

### 契约、治理与性能

- 这是 API 变更，须更新 OpenAPI 契约（`npm run contract:openapi` 生成、`contract:check` 校验），并在 `docs/design-docs/api-contract.md` 补充端点。
- 评分公式与分桶口径写入本设计文档，作为"可审计"的依据（见附录）。
- 聚合走 SQL + 现有索引（`parameter_history_value_idx`、`parameter_change_requests_project_status_idx` 等），必要时补索引；summary 与 hotspots 结果在 service 层按 `(org, project, window[, dimension])` 做短 TTL 缓存以抗频繁切换。

## 前端数据层设计

### 专用端口

新增 `ParameterDashboardRepository`（`src/application/ports/`），与参数写操作端口解耦，职责单一：

- `listDashboardSummary(projectId, window) → DashboardSummary`
- `listDashboardHotspots(projectId, window, dimension) → DashboardHotspot[]`

### 双适配器（保持 mock/api 双模契约一致）

- **HTTP 适配器**（`infrastructure/http/`）：调用两个新端点，映射为统一 view-model。
- **Mock 适配器**（`infrastructure/mock/`）：从 `MockRuntimeState` 计算相同形状结果，供 demo 与契约测试；**移除 LCG 趋势与 jitter**，改为基于 mock 种子数据的真实派生（趋势来自 mock 历史/变更时间戳，风险来自真实计数）。契约测试保证两适配器同形。

### 运行时编排

`parameterDashboardRuntime`：

- 加载时 / 项目切换 / 时间窗切换 → 拉取 `summary`。
- 维度切换 → 仅拉取 `hotspots`。
- dispatch 到独立的 dashboard state 分片，而非同步从 `PrototypeState` 派生。

### 显式分区状态（生产级关键改动）

dashboard 不再是同步纯函数派生，而是异步数据 + 每区块独立状态机：

- 每个区块（KPI / 趋势 / 风险 / 热榜 / 工作台信号）各自持有 `idle | loading | ready | empty | error`。
- 慢或失败的区块不阻塞其他区块；错误态提供"重试"，空态给出引导文案。
- operator 首屏优先渲染工作台，证据区可延迟加载。

### 视图模型职责

保留 `derivePersonalWorkbench` 作为纯函数，但输入改为真实工作台信号（来自 summary 端点）+ 已 hydrate 的变更请求/草稿；热榜评分不再在前端计算（已下沉服务端）。页面组件只负责渲染与导航，不含业务排序/评分。

### mock 模式定位

仍可用于前端 demo 与组件测试，但不再作为"生产数据来源"；API 模式下所有区块均为真实后端数据。

## 组件架构与视觉系统

### 组件拆分

新建特性目录 `src/features/parameter-home/`，替代当前单文件组件：

- `ParameterHomePage.tsx`：容器，接线 runtime + 分区状态，负责编排不含业务逻辑。
- `SituationStrip.tsx`：KPI 态势条。
- `WorkbenchPrimary.tsx`：角色感知主区，组合 `NextActionQueue.tsx` + `ScenarioEntries.tsx`。
- `InsightSection.tsx`：证据区容器，组合 `UpdateTrendChart` / `ProjectRiskChart` / `HotspotLeaderboard`。
- `HotspotLeaderboard.tsx` + `HotspotScorePanel.tsx`（由"AI 评分拆解"更名为"热度评分构成"）。
- `AnalysisContextControls.tsx`：统一的时间窗 + 热榜维度控件。
- 共享态组件：`SectionSkeleton` / `SectionEmpty` / `SectionError`。

### 图表（Recharts）

- 趋势：`LineChart`/`AreaChart`，带坐标轴、tooltip、响应式容器。
- 风险分布：堆叠 `BarChart`（high/medium/low），沿用红/橙/蓝语义色。
- Recharts 主题与设计令牌统一（颜色、字号、网格线）。

### 视觉系统

- 基于现有 shadcn/ui + Tailwind v4 令牌，定义一套页面级令牌：面板圆角/描边/层级、间距节奏、风险语义色（高/中/低）、评分色阶（正常/关注/高）。
- 统一 `Panel` 卡片基元，取代当前散落的 `.homepage-panel` 手写样式。

### CSS 策略（解决 styles.css 膨胀）

- 新组件优先用 Tailwind 工具类 + shadcn 基元；少量定制样式就近放在 `src/features/parameter-home/*.css`。
- 迁移完成后删除 `styles.css` 中旧的 `.parameter-homepage*` / `.personal-workbench*` / `.hotspot-*` 块。

### 状态与交互

loading 骨架、空态引导文案、错误态带重试；operator 首屏先渲染工作台，证据区渐进加载。

### 响应式

桌面 1440 / 平板 768 / 移动 390 三档；态势条自动换行，证据区图表堆叠，热榜沿用 accordion。

### 无障碍

保留热榜键盘导航与 ARIA；图表提供 `aria-label` + 视觉隐藏的数据表兜底；评分维度用 `progressbar` 语义；异步分区状态用 `aria-live` 播报。

## 分阶段实施路线

一份 spec，五个可独立验证的阶段：

- **阶段 0 · 地基**：引入 Recharts 依赖；搭建 `src/features/parameter-home/` 骨架；定义统一 view-model 类型与 `ParameterDashboardRepository` 端口签名；契约桩。
- **阶段 1 · 后端聚合 API**：dashboard 子模块（routes/service/repository/policy），SQL 分桶聚合、服务端可解释评分、必要索引；更新 OpenAPI 契约；server 单测。
- **阶段 2 · 前端接入真实数据**：HTTP + mock 双适配器、runtime 编排、独立 dashboard 分区状态机；移除 LCG/jitter；适配器同形契约测试。
- **阶段 3 · 视觉/交互重设计**：组件拆分、Recharts 图表、视觉令牌系统、loading/空/错误态、响应式与无障碍、统一分析上下文控件、角色自适应重心；样式迁出 styles.css。
- **阶段 4 · 清理与文档**：删除过时代码/样式/测试；更新 `docs/FRONTEND.md`、`docs/design-docs/api-contract.md`；跑 `docs:check`。

## 测试策略

- **后端**：聚合口径与评分确定性单测、鉴权/策略测试（`npm run test:server`）。
- **前端**：view-model 纯函数测试（工作台由真实信号派生）、适配器双模同形契约测试、组件分区状态测试（loading/空/错误/就绪 × 四角色）、无障碍断言。
- **契约**：`npm run contract:openapi` + `contract:check`。
- **构建**：`npm run build`。
- **浏览器验证**（AGENTS.md 强制）：playwright-cli 在 1440/768/390 三视口 × 四角色跑 snapshot + screenshot，检查 console/network，新增 parameter-home 真实数据路径 E2E。
- **回归**：更新/移除针对旧 class 的 CSS 契约断言等过时测试。

## 验收标准

- 图表/热榜/工作台信号全部来自真实后端，无合成/jitter/前端"AI"。
- 四角色首屏均达生产级（含加载/空/错误/响应式/无障碍）。
- 评分可复现、可审计；分桶与评分口径有文档。
- 新增 API 有 OpenAPI 契约与服务端测试。
- 旧合成逻辑（LCG/jitter）与冗余样式被清理。
- 所有入口按权限过滤，不让用户从首页点入无权限页面。

## 不做（Out of Scope）

- 不改造参数修改、参数审阅、管理后台等子页面本身。
- 不接入真实 LLM/Agent 生成热榜评分（评分为服务端确定性计算）。
- 不为六个角色分别实现六套页面（仍按四类视角）。
- 不引入除图表库外的新前端框架。

## 文档影响矩阵（Documentation Impact Matrix）

| 文档 | 影响 | 阶段 |
| --- | --- | --- |
| `docs/design-docs/api-contract.md` | 新增 dashboard 端点契约 | 阶段 1 |
| `docs/FRONTEND.md` | 新增 dashboard 数据层与特性目录说明 | 阶段 3 |
| `docs/design-docs/2026-05-24-parameter-personal-workbench-design.md` | 标注被本方案取代/演进的部分 | 阶段 4 |
| OpenAPI 契约产物 | 重新生成并校验 | 阶段 1 |
| 本 spec 的中英镜像 | 视需要补英文镜像 | 阶段 4 |

**Documentation Update Gate**：完成前运行 `npm run docs:check`，确保文档与实现同步。

## 附录：评分与分桶口径（可审计基准）

- **五维评分**（服务端确定性计算，输入均为真实聚合值）：
  - `frequency`：组内参数数与近窗关联变更请求数的加权和。
  - `risk`：组内各参数风险等级权重和（High=3 / Medium=2 / Low=1，乘以系数）。
  - `impact`：去重参数定义数与关联日志信号数的加权和。
  - `workflow`：关联变更请求数与高风险数的加权和。
  - `drift`：组内各参数当前值与推荐值的相对偏离百分比之和。
  - `score = frequency + risk + impact + workflow + drift`，各时间窗使用固定权重档（沿用现有 `timeWindowProfiles` 口径，去除随机成分）。
- **趋势分桶**：7d/30d 按天 `date_trunc('day', changed_at)`，180d 按周 `date_trunc('week', changed_at)`；桶内计数为 `parameter_history_entries` 变更数（可叠加 `parameter_change_requests` 流程事件数，作为独立系列或合并计数，实施时在 spec 附录固化口径）。
- **风险分布**：`COUNT(*) GROUP BY project, risk`，直接来自 `parameter_definitions.risk`，无缩放、无 jitter。
