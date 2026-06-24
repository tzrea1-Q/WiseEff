# 通用 Agent「小泽」设计

> English: [English](../../../superpowers/specs/2026-06-24-xiaoze-agent-design.md)

日期：2026-06-24
状态：已认可，可进入实施计划

## 背景

WiseEff 已有一个受控的、后端编排的 Agent（WiseAgent / `UnifiedAgent`）。其架构合理，但能力被刻意限制得很窄：

- 分层 seam 清晰：`Provider`（产出助手文案 + 工具请求）→ `Orchestrator`（持久化 session/message/trace、门控审批）→ `ToolRegistry`（唯一可执行业务工具的入口）→ 各 module service（服务端强制 authz + 审计）。
- 仅有 9 个工具，全为 **read** 或 **preparation** 类型。Agent **不能**执行写操作（合入、设备写、回滚被明确排除；`prepareRollback` 只返回计划）。
- 默认 provider 为 `deterministic`（规则引擎，非 LLM）；`live`（OpenAI 兼容 HTTP / Pi `@earendil-works/pi-ai`）可选，且生产环境强制。
- 安全由服务端强制：写操作必须经 authz + 审批记录 + 审计；前端 `canPerform` / 禁用按钮仅是 UX。

产品展望是一个名为**小泽（Xiaoze）**的通用 Agent，能够大幅协助甚至替代用户操作平台。小泽须具备：

1. **感知能力** —— 用户能看到的所有信息它都能看到，并能为用户总结信息、解疑答惑。
2. **行动能力** —— 能执行用户在前端能进行的所有操作（如提交参数变更）。
3. **意图与规划能力** —— 通过对话识别用户意图，主动感知相关信息，规划给用户的建议与动作。例如用户提出"xxx 项目充电慢"，小泽基于当前参数与节点信息给出"调节 xxx 参数"的建议，用户同意后帮助用户调试、修改、提交参数变更。

这并非小修小补。该展望要求扩展 Agent 的能力边界与执行模型，而这恰是当前设计刻意禁止的。产品负责人的首要约束：**充分利用成熟开源项目/框架、避免重复造轮子。**

## 术语

| 术语 | 含义 |
| --- | --- |
| **小泽（Xiaoze）** | 新的通用 Agent，产品对外名称。取代/扩展现有 WiseAgent。 |
| **AG-UI** | 开源、事件驱动的 Agent↔用户交互协议（CopilotKit 团队出品），标准化 Agent/前端边界。 |
| **CopilotKit** | 开源 React 前端栈，实现 AG-UI 客户端能力（可读上下文、前端动作、人审环节）。 |
| **规划引擎** | 运行 plan-act-observe 循环的 LangGraph.js 图；实现于现有 `AgentProvider` seam 之后。 |
| **感知工具** | 新增的只读后端工具，让小泽跨页拉取用户权限可访问的数据。 |
| **Orchestrator / ToolRegistry / 审批 / 审计** | 现有后端 Agent 基础设施，作为执行、审批、审计的系统记录复用。 |

## 决策

- 在三个方案中选 **方案 A**（AG-UI/CopilotKit 前端协议 + 后端规划引擎），优于纯后端工具扩展（B）和纯 MCP 工具总线（C）。MCP 可在后期作为可选的能力暴露层叠加。
- **规划引擎选 LangGraph.js**（`@langchain/langgraph`），因其一等的 human-in-the-loop interrupt、checkpoint/持久化，以及复杂多分支任务的图表达力。
- 规划引擎仅当**大脑**；现有 Orchestrator 仍是执行/审批/审计的**系统记录**。不丢弃既有安全资产。
- **执行模型（假设，实施规划时需确认）：** 小泽在用户同意后**确实执行**动作。高风险写（参数合入/提交、设备写、回滚）仍由显式人工审批 + 审计门控，遵循现有安全模型。只读/低风险感知经 authz 后自动执行。
- **感知是跨页且受权限约束的：** 小泽既感知当前页实时状态，也能通过后端感知工具读取**用户权限**允许的其他页面/领域数据。其可感知范围等于用户授权范围，绝不越权。
- 小泽的每个动作都映射到**显式注册的工具或前端动作**，绝不自由点击 DOM。可控、可审计、可测试。
- 保留 `deterministic` provider 作为离线测试替身；生产环境继续强制 live provider。

## 目标

- 用户可在任意 workflow 页面与小泽对话，针对其有权查看的一切（当前页 + 跨页数据）获得有依据的摘要/答复。
- 小泽可在显式用户批准后执行前端等价操作（含提交参数变更等写操作），并具备完整的服务端 authz 与审计。
- 小泽能识别意图、主动感知相关数据、给出带引用的建议，并执行可在中断后恢复的多步任务。
- 实现复用 CopilotKit（前端）与 LangGraph.js（后端规划），而非自建感知/行动/HITL 基础设施。
- 保留全部现有安全保障（服务端 authz、审批链、审计 `actorType=agent`、设备写 token/lease/snapshot）。

## 非目标

- 自由 DOM 自动化或让模型随意点击 UI 元素。
- 绕过任何现有审批、authz、snapshot、lease、readback 闸门。
- 替换现有 Orchestrator / ToolRegistry / 审批 / 审计基础设施。
- 将所有平台能力做成完整 MCP server 暴露（延后，作为可选层）。
- 本期不做多 Agent（A2A）协作。
- 移除 deterministic provider（保留为测试替身）。

## 架构

推荐方案：**AG-UI/CopilotKit 前端协议 + LangGraph.js 规划引擎，叠加在现有后端外壳之上。**

```
┌─────────────────────────── 前端 (React/Vite) ───────────────────────────┐
│  CopilotKit Provider + 小泽 Chat 面板                                      │
│   ├─ 感知: useCopilotReadable  → 声明每页可见状态 (项目/参数/日志/节点/队列)  │
│   ├─ 行动: useCopilotAction     → 暴露"前端可执行动作"(复用现有 runtime)     │
│   └─ 审批: HITL interrupt UI    → 高风险写的界面内确认                       │
└───────────────────────────────│ AG-UI 协议 (SSE 事件流) │──────────────────┘
                                 ▼
┌─────────────────────── 后端 (Node/TS, 现有 modular monolith) ─────────────┐
│  AG-UI Runtime 端点  (/api/v1/agent/ag-ui)  ← 新增, 包住现有 gateway        │
│      ▼                                                                     │
│  规划引擎 (LangGraph.js) —— 作为新的 AgentProvider 实现                     │
│      intent → perceive → suggest → (interrupt/审批) → act → observe 循环    │
│      ▼ 仍然套在现有外壳里 ▼                                                  │
│  Orchestrator (现有) → ToolRegistry (扩展) → Approval (现有) → Audit (现有) │
│      ▼                                                                      │
│  参数/日志/调试/审计 各 module service (现有, authz 服务端强制)              │
└────────────────────────────────────────────────────────────────────────┘
```

### 能力映射

**① 感知能力（双通道）**

- **当前页通道（实时、细粒度）：** CopilotKit `useCopilotReadable` 把用户此刻屏幕状态喂给小泽（选中项目、正在编辑的参数草稿、当前日志结论、节点读数）。"用户看得到的，它都看得到。"
- **跨页通道（按权限、全域）：** 后端新增一组只读**感知工具**，让小泽主动拉取用户权限可访问的其他页面/领域数据。例如用户在参数页问"充电慢"，小泽可主动查节点调试信息、历史日志结论、审阅队列。
- **统一权限边界：** 感知工具复用现有服务端 authz（`requireAgentPermission` + 项目 scope）。小泽可感知范围 = 用户授权范围。前端 `useCopilotReadable` 只暴露用户确实能看到的内容。

**② 行动能力（前端动作 + 后端工具）**

- **前端动作**（`useCopilotAction`，复用现有 runtime handler）：导航到某页、把推荐值填入表单、定位某参数/节点 —— 低风险 UI 编排。
- **后端工具**（扩展现有 `ToolRegistry`）：真正的写 —— 提交参数变更、设备节点写、回滚准备/执行 —— 按现有 `kind`（read / preparation / mutating）分级。

**③ 意图与规划能力（plan-act-observe 循环）**

- 规划引擎把单回合 `planTurn` 升级为多步循环：识别意图 → 主动感知（调感知工具）→ 产出建议 → 等用户批准 → 执行写工具 → 观测结果 → 回报/继续。
- 主动建议：进入页面或感知到异常时，小泽可经现有 `AgentInsightBar` 主动提示。

## 数据流（以"充电慢"为例）

```
用户(参数页): "xxx 项目充电慢"
  → CopilotKit 把当前页可读状态 + prompt 经 AG-UI POST 到后端
  → LangGraph 图: intent 节点识别意图 = 诊断 + 优化
  → perceive 节点: 调感知工具(读当前参数 + 跨页读节点/历史日志, 受 authz 约束)
  → suggest 节点: 产出"建议将 xxx 调至 yyy", 附 citations(参数/日志/节点引用)
  → [interrupt] 经 AG-UI 推 HITL 卡片到前端, 等用户批准/编辑
  用户: 同意
  → resume → act 节点: 经 Orchestrator → ToolRegistry 执行 mutating 工具
      (事务内重校验 authz + 业务态 → 写 → 审计 actorType=agent)
  → observe 节点: 读回执行结果/快照 → 回报"已提交, 变更单#123, 可在审阅页跟进"
```

LangGraph 的 `interrupt` 在 act 前暂停；`checkpoint` 保证多步任务可恢复 —— 支撑复杂任务。

## 安全与审批模型

复用现有资产，零妥协：

- **感知（read）：** 经服务端 authz 后自动执行；范围严格等于用户权限。
- **准备（preparation）：** 生成草稿/计划/预览，不改生产状态，记审计。
- **写（mutating）：** 必须创建审批记录并等人工批准；批准时现有 Orchestrator 在事务内重校验 authz + 业务态再执行。
- **高风险设备写/回滚：** 继续要求 `confirmationToken`（`confirm-high-risk-write` / `confirm-rollback`）+ device lease + 预写 snapshot + readback，与 `debugging/service.ts` 一致。小泽不绕过任何闸门。
- **审批 UI：** AG-UI HITL interrupt 渲染界面内确认卡（批准/拒绝/编辑参数），回写现有 `agent_approvals` 表；审计 `actorType: "agent"`。
- **生产强制：** 继续要求 `AGENT_PROVIDER=live`；mock 仅用于前端演示/测试。

## 组件与边界

| 单元 | 职责 | 依赖 |
| --- | --- | --- |
| CopilotKit provider + 小泽面板 | 声明可读上下文、暴露前端动作、渲染 HITL 审批 UI | AG-UI 协议、现有 runtime handler、`AgentInsightBar` |
| AG-UI runtime 端点 | AG-UI 事件 ↔ 后端 agent turn 转换；SSE 流 | Orchestrator |
| LangGraph 规划引擎（作为 `AgentProvider`） | 运行 intent→perceive→suggest→act→observe；interrupt；checkpoint | 现有 OpenAI 兼容 / Pi chat model 端点；感知 + 行动工具 |
| 感知工具（新增、只读） | 跨页、受权限约束的 grounding 读 | module service、`requireAgentPermission` |
| 扩展 ToolRegistry（mutating 工具） | 在 authz + 审批下执行前端等价写 | module service、Orchestrator、Approval |
| Orchestrator / 审批 / 审计（现有） | 执行、审批、审计的系统记录 | DB（agent 表） |

各单元经明确定义的接口通信（AG-UI 事件、`AgentProvider` seam、`ToolRegistry` 契约），可独立测试。

## 复用 / 新增依赖

- **复用：** Orchestrator、ToolRegistry、`agent_approvals` 审批链、审计 `actorType=agent`、`AgentProvider` seam、`AgentInsightBar`、各 module service authz。
- **新增（前端）：** `@copilotkit/react-core`、`@copilotkit/react-ui`（AG-UI 客户端）。
- **新增（后端）：** `@langchain/langgraph` 与 `@ag-ui/*` runtime 适配器；LangGraph 复用现有 OpenAI 兼容 / Pi 端点作为 chat model。

## 分期

每期独立可上线。

- **P0 感知：** 接入 CopilotKit + 跨页只读感知工具 + 摘要/答疑。纯读，零写风险，快速见效。
- **P1 行动：** 扩展 ToolRegistry mutating 工具 + 前端动作 + 把 AG-UI HITL 审批接入现有审批链。
- **P2 规划：** LangGraph plan-act-observe 图 + 主动建议 + 多步复杂任务 + checkpoint 恢复。

## 测试策略

- 感知工具 authz 单测（越权访问必拒）。
- HITL 审批 e2e，沿用现有 `agent.acceptance.spec.ts` 模式。
- LangGraph 图节点单测（intent/suggest 节点注入 fake chat model）。
- 端到端跑通"充电慢"场景。
- 保留 deterministic provider 作为离线测试替身。

## 待解问题

- 实施规划时确认执行模型假设（小泽在同意后执行，高风险写审批门控）。
- 确定 P1 首批暴露的 mutating 工具/前端动作精确集合（从最小开始：参数提交 + 单个低风险前端动作）。
- 确定主动建议是否按用户/角色开关（opt-in）。
