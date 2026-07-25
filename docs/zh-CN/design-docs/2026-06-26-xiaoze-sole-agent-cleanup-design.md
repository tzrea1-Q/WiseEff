# 小泽作为唯一 Agent — WiseAgent 清理设计

> English: not available

日期：2026-06-26  
状态：已认可，可进入实施计划

## 背景

WiseEff 当前并行维护两套 Agent：

- **WiseAgent（M4）** — `UnifiedAgent` UI、`AgentGateway`、5 个 `/api/v1/agent/sessions/*` REST 路由、`AgentProvider.planTurn`。
- **小泽（Xiaoze）** — CopilotKit/AG-UI UI、`/api/v1/agent/xiaoze`、LangGraph 规划，共享 `ToolRegistry` 与 orchestrator 审批链。

小泽开启时 WiseAgent 会隐藏 FAB，但 M4 代码、路由、配置、测试与文档仍完整保留。产品方向是 **小泽成为唯一 Agent**，彻底移除 WiseAgent 遗留面。

## 决策（brainstorming 结论）

| 议题 | 决策 |
| --- | --- |
| mock 运行时 | `VITE_WISEEFF_RUNTIME_MODE=mock` 下 **无 Agent UI** |
| M4 REST API | **硬删除** 5 个 session 路由；无兼容期；无外部消费者 |
| 删 M4 是否影响小泽 | **不影响**；小泽审批走 `approvalBridge` → orchestrator 内部调用 |
| 功能开关 | 删除 `VITE_XIAOZE_ENABLED`、`XIAOZE_RUNTIME_ENABLED`；**无运维 kill switch** |
| API 模式 | `runtimeMode === 'api'` 时 **始终挂载小泽** |
| 交付方式 | **阶段 A 行为切换 → 阶段 B 删 dead code → 阶段 C 文档/运维** |
| 范围外 | 不改小泽能力、不做 TD-029、本轮不重命名 `AGENT_API_*` |

## 目标

- API 模式下小泽为 **唯一** Agent（聊天、工具、审批、线程）。
- 移除 WiseAgent UI、M4 会话 API、M4 provider 栈及相关配置/文档/测试。
- mock 模式不出现任何 Agent FAB/面板/API 调用。
- health/pilot-readiness 改为探测小泽 LLM 就绪，而非 M4 `AgentProvider`。

## 非目标

- 修改 LangGraph 规划行为或工具目录语义。
- Postgres checkpoint 持久化（TD-029）。
- 将 `AGENT_API_*` 重命名为小泽专用变量名（后续项）。
- 删除 `agent_sessions` 表、`repository`、orchestrator 审批方法或 `ToolRegistry`。
- 移除主动建议开关（`XIAOZE_PROACTIVE_*`、`VITE_XIAOZE_PROACTIVE_*`）。

## 目标架构

```
mock 模式
  └─ 无 Agent UI，前端不发起 Agent HTTP

api 模式
  前端
    XiaozeProvider + CopilotKit（runtimeMode === 'api' 时始终挂载）
    XiaozePageContextRegistrar（由 App.tsx 直接挂载，不经 UnifiedAgent）
  后端
    POST /api/v1/agent/xiaoze（+ suggest + threads）
    ToolRegistry → tools/*
    approvalBridge → orchestrator.approveToolCall / rejectToolCall
    LangChain ChatOpenAI ← AGENT_API_*（+ 可选 XIAOZE_MODEL）

已删除
  UnifiedAgent、AgentGateway、agentClient、mockAgentGateway、createAgentPlan（M4 动作）
  POST /api/v1/agent/sessions/*
  AgentProvider.planTurn、providerRegistry、liveProvider（M4 专用）
  VITE_XIAOZE_ENABLED、XIAOZE_RUNTIME_ENABLED
  AGENT_PROVIDER、AGENT_API_FORMAT、AGENT_PROMPT_VERSION
```

## 共享基础设施（必须保留）

- `server/modules/agent/toolRegistry.ts` 与 `tools/*`
- `server/modules/agent/orchestrator.ts` — 瘦身后仅保留 **审批 + 工具执行** 路径
- `server/modules/agent/repository.ts`、`policy.ts`、`types.ts`
- `server/modules/agent/xiaoze/*` 全部
- `approvalBridge.ts`
- 迁移 `0008_m4_agent.sql`、`0010_*`、`0024_*`、`0025_*`（小泽线程复用 `agent_sessions`）
- `AGENT_API_*`、`XIAOZE_MODEL`、`XIAOZE_DETERMINISTIC`、主动建议相关变量
- `AgentInsightBar` 与 `.agent-insight-*` CSS

## 阶段 A — 行为切换

### 前端

1. 从 `App.tsx` 直接挂载 `XiaozePageContextRegistrar`（与当前 `UnifiedAgent` 小泽分支相同 props）。
2. 仅在 `runtimeMode === 'api'` 时挂载 `XiaozeProvider`（移除 `xiaozeEnabled` 门控）。
3. 停止渲染 WiseAgent FAB/面板；注册逻辑迁出后可于阶段 B 删除 `UnifiedAgent`。
4. Logs 等 `onAskAgent`（原点击 `.agent-fab`）改为打开小泽（toggle 或 CopilotKit `setModalOpen`）。
5. mock 模式测试断言无 Agent 入口。

### 后端

阶段 A 可不删路由（可与阶段 B 合并为一个 PR）。

### 测试

- API 模式：断言从「打开 WiseAgent」改为小泽 toggle/popup。
- mock 模式：断言无 Agent 按钮。

**阶段 A 完成标准：** API 仅小泽；mock 无 Agent；主流程无 WiseAgent 文案。

## 阶段 B — 删除 dead code

### 前端（删除）

- `UnifiedAgent.tsx` + test
- `AgentGateway`、`agentClient`、`agentDtos`、`agentRuntime`、`mockAgentGateway` 及测试
- `domain/agent/types.ts`（无引用时）
- `runtimeMode.ts` / `vite-env.d.ts` 中的 `parseXiaozeEnabled`、`VITE_XIAOZE_ENABLED`
- `styles.css` 中 `.agent-fab`、`.agent-panel` 及相关响应式块

### 后端（删除）

- `routes.ts` + `routes.test.ts`
- `app.ts` 中 `registerAgentRoutes`
- `provider.ts`、`liveProvider.ts`、`providerRegistry.ts` 及测试
- `server/index.ts` 中 M4 `createAgentProviderFromEnv` 接线
- registry 中仅 M4 使用的 9 个旧工具名

### 后端（瘦身保留）

- `orchestrator.ts`：删 `startSession`、`sendMessage`、M4 `planTurn`；保留 `approveToolCall`、`rejectToolCall` 及 `approvalBridge` 依赖。
- `agUiEndpoint.ts`：去掉 `XIAOZE_RUNTIME_ENABLED` 门控，API 服务始终注册小泽路由。
- `health.ts` / `pilotReadiness.ts`：`checkAgentProvider` 改为小泽 LLM 配置检查。

### 契约 / 生成物

- 从 `routeManifest`、`openapi.json`、`api-contract.md` 移除 5 个 M4 路由。

### E2E / 脚本

- 删除 `e2e/agent.api.spec.ts`、`agent.acceptance.spec.ts`、`npm run test:m4`
- 重写 quality E2E 中的小泽 popup 交互
- 清理 `operationMatrix.ts` 中 M4 行

**阶段 B 完成标准：** build + test:all + test:server + xiaoze acceptance 通过；生产代码中 ripgrep 无 `UnifiedAgent`、`/agent/sessions`、`AgentGateway`。

## 阶段 C — 文档与运维

- 更新 `FRONTEND.md`、`zh-CN/frontend.md` — 小泽为唯一 Agent。
- 更新 `environment-variables.md`（中英文）— 删除已废弃变量。
- 更新 `ARCHITECTURE.md`、`full-stack-architecture.md`（中英文）。
- 更新 `QUALITY_SCORE.md`、verification matrix、runbooks。
- `ops/self-hosted/.env.example`：移除 `AGENT_PI_PROVIDER`、`VITE_XIAOZE_ENABLED`、`XIAOZE_RUNTIME_ENABLED`。
- Docker / compose / `selfhost:check` 对齐新 env 集合。

## 环境变量

### 删除

| 变量 | 原因 |
| --- | --- |
| `VITE_XIAOZE_ENABLED` | API 模式始终挂载小泽 |
| `XIAOZE_RUNTIME_ENABLED` | 无 kill switch |
| `AGENT_PROVIDER` | 仅 M4 planTurn |
| `AGENT_API_FORMAT` | M4 provider 传输 |
| `AGENT_PROMPT_VERSION` | M4 trace 元数据 |
| `AGENT_PI_PROVIDER` | 已从代码移除，清理示例 |

### 保留

| 变量 | 用途 |
| --- | --- |
| `AGENT_API_BASE_URL`、`AGENT_API_KEY`、`AGENT_MODEL` | 小泽 LangChain LLM |
| `XIAOZE_MODEL`、`XIAOZE_DETERMINISTIC` | 模型覆盖与测试 fake |
| `XIAOZE_PROACTIVE_*`、`VITE_XIAOZE_PROACTIVE_*` | opt-in 主动建议 |
| `VITE_XIAOZE_PROMPT_DEBUG` 等 | 仅开发 |

## 测试策略

| 门禁 | 命令 / 产物 |
| --- | --- |
| 单元/组件 | `npm test -- src/features/agent`、更新后的 `App.test.tsx` |
| 服务端 | `npm run test:server -- xiaoze orchestrator toolRegistry` |
| 构建 | `npm run build` |
| 验收 | `e2e/acceptance/xiaoze-*.acceptance.spec.ts` |
| 自托管元数据 | `npm run selfhost:check` |
| mock 回归 | mock 模式无 Agent FAB / 无小泽挂载 |

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 测试仍断言 WiseAgent | 阶段 A 先改断言 |
| 删除 `AgentProvider` 后 health 失败 | 阶段 B 先接小泽 LLM 探测再删 provider |
| 大批量删除遗留 import | 阶段 B 结束 ripgrep 门禁 |
| Logs「问 Agent」失效 | 阶段 A 改绑小泽 toggle |
| mock 演示失去 Agent | 产品已接受；在开发文档中说明 |

## 文档影响矩阵

| 文档 | 动作 |
| --- | --- |
| `docs/FRONTEND.md` | 重写 Agent 章节为小泽唯一 |
| `docs/zh-CN/frontend.md` | 同上（中文） |
| `docs/developer/environment-variables.md` | 删除废弃变量 |
| `docs/zh-CN/developer/environment-variables.md` | 同上 |
| `ARCHITECTURE.md` | 移除 M4 并列描述 |
| `docs/design-docs/api-contract.md` | 移除 5 个 M4 路由 |
| `docs/QUALITY_SCORE.md` | M4 门禁改为小泽 |
| `ops/self-hosted/.env.example` | 对齐新 env |

## 成功标准

1. API 模式：仅小泽入口；无 WiseAgent FAB/面板/文案。
2. mock 模式：无 Agent UI。
3. 服务端与 OpenAPI 无 `/api/v1/agent/sessions`。
4. 代码与示例中无 `VITE_XIAOZE_ENABLED` / `XIAOZE_RUNTIME_ENABLED`。
5. CI 与 acceptance 在无 `test:m4` 下通过。

## 下一步

spec 审阅通过后，调用 **writing-plans** 在 `docs/exec-plans/active/` 编写分阶段实施计划（含 Documentation Update Gate：`npm run docs:check`）。
