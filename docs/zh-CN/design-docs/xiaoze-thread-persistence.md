# 小泽对话 Thread 持久化设计

> English: [English](../../design-docs/xiaoze-thread-persistence.md)

日期：2026-06-24  
状态：已批准，进入实现计划

## 背景

小泽对话历史目前**仅保存在浏览器**（`localStorage` 键 `wiseeff.xiaoze.threads.v1`）。CopilotKit 将客户端生成的 `threadId` 传给 `POST /api/v1/agent/xiaoze`，LangGraph 规划图用该 id 配合进程内 `MemorySaver` checkpointer（TD-029）。两条路径都无法提供**跨设备**、**可审计**、**长期保留**的会话历史。

M4 已具备持久化表结构：

- `agent_sessions` — 会话元数据、组织/用户范围、标题、状态
- `agent_messages` — 追加式消息与 citations
- `agent_tool_calls` / `agent_approvals` / `agent_run_traces` — 执行与审计关联

当前小泽仅在**变更类工具**走 orchestrator 审批桥时**懒创建** `agent_sessions` 行，普通聊天轮次不会入库。

## 目标

- 用户登录后在任意设备看到相同的小泽对话历史。
- 每条 thread 与 message 在服务端按**组织 + 当前用户**隔离，权限可 enforcement。
- 历史在 API 重启后仍存在，并满足保留与审计要求（用户侧软删除，组织策略硬保留）。
- CopilotKit `threadId` 继续作为服务端 canonical id，不引入第二套 id。
- 复用现有 orchestrator 审计模式；不绕过 authz 与审批链。

## 非目标

- 本设计不替换 LangGraph checkpoint 存储（见 TD-029；共用 `threadId`，载荷不同）。
- v1 不向管理员暴露「查看他人聊天记录」UI（管理员走现有 audit API）。
- 不做多设备实时推送（WebSocket）；v1 为加载时拉取 + 每轮结束后追加。
- 不改造 WiseAgent（`/api/v1/agent/sessions`）既有 UI。

## 术语

| 术语 | 含义 |
| --- | --- |
| **Thread** | 一条小泽对话，对应 `page_key = 'xiaoze'` 的 `agent_sessions` 行。 |
| **threadId** | CopilotKit 客户端 UUID，等于 `agent_sessions.id`。 |
| **草稿 thread** | 已有 `threadId` 但尚无入库 session（无用户消息）。 |
| **历史 thread** | 至少有一条已持久化的 user 或 assistant 消息。 |

## 架构决策：复用 M4 表

v1 **不新建** `xiaoze_threads` 表。

| 关注点 | 选择 |
| --- | --- |
| 标识 | `agent_sessions.id` = CopilotKit `threadId` |
| 区分字段 | `page_key = 'xiaoze'` |
| 归属 | `actor_user_id = auth.user.id`，`organization_id = auth.organization.id` |
| 生命周期 | `status`：`active`（可见）\| `archived`（用户删除，仍保留） |
| 消息 | `agent_messages`；角色 `user`、`assistant`、`reasoning` |
| 工具/审批 | 变更类工具仍在同一 `session_id` 下关联现有行 |

理由：审批桥、tool call、run trace 与 audit 已以 `agent_sessions.id` 为键；第二张表会重复 scope 校验并增加 join 复杂度。

### Session `context` JSON（小泽扩展）

```json
{
  "path": "/parameters",
  "pageKey": "parameters",
  "projectId": "aurora",
  "roleId": "editor",
  "xiaoze": {
    "preview": "助手最后一句摘要…",
    "source": "copilotkit",
    "lastRunId": "uuid"
  }
}
```

`title` 仍为独立列（默认取自首条用户消息，可通过 PATCH 修改）。

## 数据流

```
前端（CopilotKit threadId）
    │
    ├─ GET /threads ─────────────► 列出 agent_sessions（page_key=xiaoze, active）
    │
    ├─ POST /agent/xiaoze (SSE) ─► 规划图（MemorySaver，TD-029）
    │         │
    │         └─ 轮次成功结束 ───► upsert session + append messages（同事务）
    │
    └─ 切换 thread ──────────────► GET /threads/:id，灌入 CopilotKit messages
```

**写入时机：** 每次 AG-UI run 成功结束后持久化（含审批 resume），而非每个 SSE token。用户消息来自请求体；assistant/reasoning 来自 agent 结果。失败 run 不写入 assistant 内容。

**空 thread：** 首条非空用户消息之前不插入 `agent_sessions`（与当前前端规则一致）。

**幂等：** AG-UI 提供稳定 message id；`appendAgentMessage` 使用 `ON CONFLICT (id) DO NOTHING`，重试不重复插入。

## REST API

基路径：`/api/v1/agent/xiaoze/threads`  
认证：与其他 `/api/v1` 相同的 bearer session。  
错误：遵循 `docs/api/errors.md` 结构化 envelope。

### `GET /api/v1/agent/xiaoze/threads`

列出当前用户 active 且非空的小泽 thread。

查询参数：

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `limit` | 30 | 最大 50 |
| `cursor` | — | 不透明游标；排序 `updated_at desc, id desc` |

响应 `items` 含 `id`、`title`、`preview`、`createdAt`、`updatedAt`、`messageCount`；`nextCursor` 分页。

Authz：`organization_id` + `actor_user_id` + `page_key = 'xiaoze'` + `status = 'active'`，排除零消息 session。

### `POST /api/v1/agent/xiaoze/threads`

可选：在首条消息前向服务端申请 id。

Body 可选 `{ "id": "client-uuid", "context": { … } }`。  
响应 `201` 返回 thread 元数据。

列表可见行仍建议在首条用户消息或首次 AG-UI 成功 turn 时创建（与懒创建策略一致）。

### `GET /api/v1/agent/xiaoze/threads/:threadId`

返回 thread 元数据 + 有序 messages，供前端 hydration。

非本人或无记录返回 404。

### `PATCH /api/v1/agent/xiaoze/threads/:threadId`

Body：`{ "title": "自定义标题" }`（1–80 字符）。  
审计：`agent-session` / `updated`。

### `DELETE /api/v1/agent/xiaoze/threads/:threadId`

软删除：`status = 'archived'`。数据保留以满足审计。审计：`agent-session` / `archived`。

不删除 LangGraph checkpoint（TD-029 后续）。

## 服务端模块

| 文件 | 职责 |
| --- | --- |
| `server/modules/agent/xiaoze/threadRepository.ts` | 列表/详情/upsert/归档；幂等 append |
| `server/modules/agent/xiaoze/threadSchemas.ts` | Zod 校验 |
| `server/modules/agent/xiaoze/threadRoutes.ts` | REST 注册 |
| `server/modules/agent/xiaoze/threadPersistence.ts` | `agUiEndpoint` 轮次结束后调用 |
| `server/modules/agent/xiaoze/agUiEndpoint.ts` | 挂载 persistence hook |

在 `registerXiaozeRoutes` 中与 AG-UI、suggest 一并注册。

## 审计事件

| 场景 | kind | action | target |
| --- | --- | --- | --- |
| 首条消息创建 session | `agent-session` | `started` | `agent_session` |
| 轮次消息入库 | `agent-message` | `appended` | `agent_message` |
| 修改标题 | `agent-session` | `updated` | `agent_session` |
| 用户从历史删除 | `agent-session` | `archived` | `agent_session` |

工具审批继续使用既有 `agent-tool` 审计事件，同一 `session_id`。

## 前端集成

| 区域 | 变更 |
| --- | --- |
| `src/infrastructure/http/xiaozeThreadsClient.ts` | list / get / patch / delete |
| `src/features/agent/XiaozeThreadContext.tsx` | `api` 模式下以服务端为准 |
| `src/features/agent/xiaozeThreadStorage.ts` | `mock` 模式 + 可选一次性导入 |
| CopilotKit | 继续传 `threadId`；切换 thread 时 GET 预加载 messages |

**运行模式：**

- `VITE_WISEEFF_RUNTIME_MODE=api`（默认）：服务端为真相源。
- `mock`：保持 localStorage 行为。

**可选迁移：** 登录后若 localStorage 有历史且服务端列表为空，可提供导入提示（bulk API 可后续再做）。

## 安全

- 所有查询过滤 `organization_id` 与 `actor_user_id`。
- 消息内容按组织机密数据分类，与 `docs/security/` 中 agent session 一致。
- DELETE 仅软删；硬 purge 由运维/保留策略 job 处理。
- 持久化 hook 仅在 AG-UI 认证通过后执行。

## 与 TD-029（LangGraph Checkpoint）的关系

| 层 | 存储 | 用途 |
| --- | --- | --- |
| 对话历史（本设计） | Postgres `agent_messages` | 用户可见 transcript、跨设备 |
| 规划 checkpoint（TD-029） | Postgres LangGraph saver（未来） | interrupt 后图状态恢复 |

共用 `threadId`，实现上不得把 checkpoint JSON 与 message 行混用。

## 数据库迁移（v1）

1. 列表查询索引：

```sql
create index if not exists agent_sessions_xiaoze_actor_idx
  on agent_sessions (organization_id, actor_user_id, page_key, status, updated_at desc)
  where page_key = 'xiaoze';
```

2. `agent_messages.id` 冲突时 `DO NOTHING`（应用层）。

3. TypeScript 中 `AgentMessageDto.role` 扩展 `"reasoning"`（库表无 role CHECK）。

## 验收

- 服务端：`npm run test:server -- threadRepository threadRoutes threadPersistence agUiEndpoint`
- 前端：`npm test -- src/features/agent src/infrastructure/http/xiaozeThreadsClient`
- 契约：更新 OpenAPI；`npm run contract:check`
- 浏览器：历史列表、切换、新对话、删除、刷新后仍可见（`playwright-cli`，见 AGENTS.md）
- 文档：`npm run docs:check`

## 待定项（v1 默认）

| 问题 | 默认 |
| --- | --- |
| 每用户 thread 上限 | 30（与当前 localStorage 一致） |
| 每 thread 消息上限 | 500（超出截断可记 TD） |
| 管理员看他人聊天 | 不在范围 |
| localStorage 批量导入 | 可选后续 endpoint |

## 参考

- M4 schema：`server/migrations/0008_m4_agent.sql`
- AG-UI：`server/modules/agent/xiaoze/agUiEndpoint.ts`
- 前端 thread UX：`src/features/agent/xiaozeThreadStorage.ts`
- 小泽整体设计：`docs/superpowers/specs/2026-06-24-xiaoze-agent-design.md`
- TD-029：`docs/exec-plans/tech-debt-tracker.md`
