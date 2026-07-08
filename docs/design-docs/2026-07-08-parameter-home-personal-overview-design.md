# 参数首页：个人/整体概览切换

**日期**：2026-07-08  
**状态**：已批准（设计评审通过，待实现计划）  
**范围**：参数管理首页（`/parameter-home`）概览区

## 背景与目标

当前参数首页「概览」区仅展示组织/项目维度的全库 KPI（参数总量、管理项目、变更频次、活跃贡献者、高风险参数）及全库更新趋势。用户希望增加**个人数据概览**，并与现有整体概览在前端切换。

### 成功标准

- 所有非 guest 角色进入首页时，概览区**默认显示个人视角**。
- guest 角色**默认显示整体视角**（只读，无个人贡献数据）。
- 用户可通过概览面板内的切换控件在「个人 / 整体」之间切换。
- 切换同时影响左侧 KPI 卡片与右侧趋势图。
- 时间窗口与项目范围过滤器对个人/整体指标均生效。
- API 模式与 mock 模式行为一致。

## 非目标

- 不改变热榜维度的作用范围（热榜不受概览视角切换影响）。
- 不将概览视角切换提升到页面级（不影响工作台、热榜等其他区块）。
- 不持久化用户的视角选择（仅当前会话内 `dashboardState` 记忆）。
- 不为 guest 单独隐藏「个人」选项（保持 UI 结构一致，个人视角展示空态）。

## 交互设计

### 切换控件（方案 A）

- **位置**：左侧「概览」面板标题行右侧，复用 `Panel` 的 `actions` 插槽。
- **形态**：与时间窗口同风格的小型分段切换（`个人` / `整体`），`aria-label="概览视角"`。
- **副标题**：
  - 个人：`我的关键指标`
  - 整体：`参数库关键指标`（保持现有文案）

### 默认视角

| 角色 | 默认 `overviewScope` |
|------|------------------------|
| user / committer / admin | `personal` |
| guest | `overall` |

角色切换时重置：`guest → overall`，其他 → `personal`。

### 右侧趋势图

| 视角 | 面板标题 | 数据来源 | 图例 |
|------|----------|----------|------|
| 整体 | 参数更新趋势 | `summary.trend` | 参数变更 / 流程事件（现有） |
| 个人 | 我的变更趋势 | `summary.personalTrend` | 我的变更 / 我的流程（新文案） |

### 过滤器联动

- **时间窗口**（7d / 30d / 180d）：个人 KPI 与个人趋势均按窗口起止时间过滤。
- **项目范围**（全部项目 / 具体项目）：个人 KPI 与个人趋势均按 `projectScope` 过滤。
- **热榜维度**：不受影响。

### 空态与 guest

- 个人 KPI 全为 0：显示「当前时间窗口暂无个人活动」。
- guest 切到个人视角：在上述空态基础上追加「当前为只读视角，暂无个人贡献数据」。
- 个人趋势全 0：仍渲染坐标轴，不报错。

## 数据模型

### 新增类型（`src/domain/parameters/dashboardTypes.ts`）

```ts
export type OverviewScope = "personal" | "overall";

export type PersonalDashboardKpis = {
  contributionCount: number;   // 我的贡献活动
  workflowCount: number;       // 我的流程参与
  openItemCount: number;       // 我的打开项
  pendingTodoCount: number;    // 我的待办
  highRiskTouchCount: number;  // 我的高风险经手
};
```

### 扩展 `DashboardSummary`

```ts
export type DashboardSummary = {
  // ...existing fields
  personalKpis: PersonalDashboardKpis;
  personalTrend: TrendPoint[];  // 结构同 trend
};
```

### 角色化 KPI 展示文案

后端返回统一数值字段；前端按 `WorkbenchRoleView` 映射展示标签：

| 字段 | user | committer | admin |
|------|------|-----------|-------|
| `contributionCount` | 我的变更 | 我的审阅完成 | 我的治理操作 |
| `workflowCount` | 我的提交 | 我处理的流程 | 我发起的导入 |
| `openItemCount` | 我的草稿 | 待我审阅 | 待应用导入 |
| `pendingTodoCount` | 待处理事项 | 队列高风险 | 待复核账号 |
| `highRiskTouchCount` | 高风险经手 | 高风险审阅 | 高风险治理 |

映射逻辑放在 `deriveOverviewPresentation(roleView, scope)`（新建，纯函数，可单测）。

### 各字段聚合语义（后端）

所有查询在 `organizationId` + 可选 `projectId` + `windowStart`/`windowEnd` 范围内执行，并按 `userId` 过滤。

| 字段 | user | committer | admin |
|------|------|-----------|-------|
| `contributionCount` | `parameter_history_entries` 中 `changed_by_user_id = userId` 的记录数 | 审阅记录中 `reviewed_by_user_id = userId` 且状态为通过/退回的数 | 审计/治理写操作中 `actor_user_id = userId` 的数（导入应用、用户状态变更等） |
| `workflowCount` | `parameter_change_requests` 中 `created_by_user_id = userId` 的数 | 审阅队列中由当前用户在本窗口内处理的变更请求数 | 导入批次中 `created_by_user_id = userId` 的数 |
| `openItemCount` | 当前未提交草稿数（`parameter_drafts`，`user_id = userId`） | 当前待当前用户审阅的开放变更请求数 | 未应用导入批次数 |
| `pendingTodoCount` | 被退回变更数 + 待合入数（复用 `workbenchSignals.returnedChanges + waitingMerge`） | 待审队列中涉及高风险参数的项数 | 停用/待复核账号数（`workbenchSignals.inactiveAccounts`） |
| `highRiskTouchCount` | 上述个人变更中 `risk = High` 的参数涉及数 | 上述审阅中高风险参数涉及数 | 治理操作中触及高风险参数的次数 |

> 注：`openItemCount` 与 `pendingTodoCount` 的部分子项为**当前快照**（非窗口累计），与 `workbenchSignals` 语义一致；窗口敏感项（`contributionCount`、`workflowCount`、`highRiskTouchCount`）严格按时间窗过滤。

### 个人趋势 `personalTrend`

结构与 `TrendPoint` 相同，按时间桶聚合：

- `changeCount`：该桶内 `parameter_history_entries.changed_by_user_id = userId` 的数量。
- `workflowEventCount`：该桶内 `parameter_change_requests.created_by_user_id = userId` 的数量（committer/admin 可扩展为审阅完成事件，首版与 user 同口径以保持一致性）。

首版 committer/admin 的 `workflowEventCount` 与个人 KPI 的 `workflowCount` 使用相同用户过滤口径，避免趋势与 KPI 数字对不上。

## 后端改动

### 仓储（`server/modules/parameters/dashboard/repository.ts`）

新增：

- `countPersonalKpis(db, { organizationId, projectId, userId, windowStart, roleLevel })`
- `aggregatePersonalTrend(db, { organizationId, projectId, userId, windowStart, windowEnd, granularity })`

`roleLevel` 用于在仓储层选择 committer/admin 的不同计数 SQL（或通过独立的小函数按角色分支）。

### 服务（`server/modules/parameters/dashboard/service.ts`）

`getDashboardSummary` 并行拉取：

```ts
const [kpis, trendRaw, riskBuckets, workbenchSignals, personalKpis, personalTrendRaw] = await Promise.all([
  countKpis(...),
  aggregateTrend(...),
  aggregateRiskDistribution(...),
  aggregateWorkbenchSignals(...),
  countPersonalKpis(...),
  aggregatePersonalTrend(...)
]);
```

返回体增加 `personalKpis` 与 `personalTrend`。

### 契约与测试

- 更新 `server/modules/parameters/dashboard/routes.test.ts`：summary 响应含 `personalKpis` / `personalTrend`。
- 新增 repository 级测试：用户过滤、项目过滤、时间窗、不同角色计数分支。
- 更新 `docs/design-docs/api-contract.md` 中 dashboard summary 字段（若该端点有文档条目）。

## 前端改动

### 状态（`dashboardState.ts`）

```ts
export type DashboardState = {
  // ...existing
  overviewScope: OverviewScope;
};

export type DashboardAction =
  | { type: "DASHBOARD_SET_OVERVIEW_SCOPE"; scope: OverviewScope }
  // ...
```

初始值在 `ParameterHomePage`（或 `App`）按角色设定，不写入 `initialDashboardState` 硬编码。

### 组件

| 文件 | 改动 |
|------|------|
| `OverviewScopeToggle.tsx` | 新建，分段切换 |
| `deriveOverviewPresentation.ts` | 新建，角色化 KPI 标签映射 |
| `SituationStrip.tsx` | 接收 scope、双 KPI 源、roleView；标题 actions 放切换器 |
| `OverviewRow.tsx` | 透传 scope、personal 数据、回调 |
| `UpdateTrendChart.tsx` | 可选：接收自定义图例文案 props |
| `ParameterHomePage.tsx` | 管理 overviewScope、传 roleView |

### Mock 运行时

`createMockParameterDashboardRepository` 从 `PrototypeState` 按当前用户派生 `personalKpis` / `personalTrend`，过滤逻辑与后端语义对齐（至少覆盖 user 路径；committer/admin 用 `workbenchSignals` + 本地 changeRequests 近似）。

## 错误处理

- `personalKpis` / `personalTrend` 与整体数据同包在 summary 请求中；summary 加载失败时概览区统一 error + 重试，不单独处理个人数据错误。
- summary 成功但个人指标全 0：走空态，不视为 error。

## 测试计划

### 后端

- `countPersonalKpis`：用户隔离、项目过滤、时间窗、角色分支。
- `aggregatePersonalTrend`：桶对齐、用户过滤。
- `routes.test.ts`：summary 契约含新字段。

### 前端

- `deriveOverviewPresentation.test.ts`：各角色标签映射。
- `OverviewScopeToggle.test.tsx`：切换回调。
- `SituationStrip.test.tsx`：personal/overall 渲染不同 KPI。
- `ParameterHomePage.test.tsx`：默认 personal、guest 默认 overall、切换后趋势数据源变化。
- `App.test.tsx`：概览区存在「概览视角」切换。

### 浏览器验证

- 桌面 1440×900 + 移动 390×844。
- 验证：默认视角、切换 KPI 与趋势、过滤器联动、guest 空态、无 console 错误。

## 实现顺序建议

1. 域类型 + `dashboardState.overviewScope`
2. 后端 repository / service / 路由测试
3. Mock repository 对齐
4. `OverviewScopeToggle` + `deriveOverviewPresentation`
5. `SituationStrip` / `OverviewRow` / `UpdateTrendChart` 接线
6. `ParameterHomePage` 默认逻辑与测试补齐
7. 浏览器验证

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| committer/admin 个人指标 SQL 复杂 | 首版 `openItemCount`/`pendingTodoCount` 复用已有 `workbenchSignals`，减少新查询 |
| 个人趋势与 KPI 数字不一致 | 趋势与 KPI 使用相同用户过滤字段与项目/时间窗条件 |
| guest 个人视角困惑 | 明确空态文案 + 默认 overall |
