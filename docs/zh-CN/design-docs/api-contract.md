# WiseEff API 合同设计

> English: [English](../../design-docs/api-contract.md)

日期：2026-05-25

## 1. API 原则

正式 API 采用 REST + JSON。前端当前已有 `application/ports` 和 `infrastructure/http/dto.ts`，后续应让真实 API client 实现这些端口。

原则：

- 所有 API 使用 `/api/v1` 前缀。
- 所有写操作要求认证、权限、审计和幂等键。
- 列表接口支持分页、排序和过滤。
- 错误返回统一结构。
- 长任务使用任务状态接口或 SSE。
- API 合同进入 CI，前端 DTO 与 OpenAPI 保持一致。

## 2. 通用约定

请求头：

```http
Authorization: Bearer <token>
X-Request-Id: <uuid>
Idempotency-Key: <uuid>   # 写操作推荐
```

分页响应：

```json
{
  "items": [],
  "page": {
    "cursor": "next-cursor",
    "limit": 50,
    "hasMore": true
  }
}
```

错误响应：

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Target value is outside allowed range.",
    "details": {
      "field": "targetValue"
    },
    "requestId": "req_123"
  }
}
```

错误码：

- `UNAUTHENTICATED`
- `FORBIDDEN`
- `NOT_FOUND`
- `VALIDATION_FAILED`
- `CONFLICT`
- `PROCESSING`
- `RATE_LIMITED`
- `AGENT_TOOL_FAILED`
- `DEVICE_UNAVAILABLE`
- `INTERNAL_ERROR`

## M3.5 Route Manifest Guard

`server/modules/contracts/routeManifest.ts` is the static route manifest for the M1-M3 API surface and M3.5 operations endpoints. When a route path, method, or module ownership changes, update the manifest in the same change as the route handler and HTTP client/DTO mapper.

The manifest currently locks the commercial pilot critical paths:

- `parameters.reviewChangeRequest`: `POST /api/v1/parameter-change-requests/:requestId/review`
- `logs.upload`: `POST /api/v1/logs`
- `debugging.writeNode`: `POST /api/v1/debugging/nodes/write`
- `operations.live`: `GET /health/live`
- `operations.ready`: `GET /health/ready`

## M5 Committed OpenAPI Contract

`docs/generated/openapi.json` is the committed M5 API contract artifact. It is generated from `server/modules/contracts/routeManifest.ts` and `server/modules/contracts/schemaRegistry.ts` by running `npm run contract:openapi`.

Any PR that changes a route handler, route manifest entry, schema registry entry, frontend HTTP DTO/client behavior, or this API documentation must update the matching files in the same PR. The contract freshness gate is `npm run contract:check`; CI should run it before commercial-pilot builds are accepted. Semantic contract expectations such as path parameters, critical paths, success status codes, and error responses are covered by `server/modules/contracts/openapi.test.ts`.

The generated contract uses the documented WiseEff error envelope for every operation through `#/components/responses/ErrorResponse`, and the frontend API client must preserve `code`, `message`, `details`, and `requestId` when parsing error responses.

M5.1 documentation governance adds `npm run docs:check` for active plan metadata, but API compatibility still depends on `npm run contract:check` and the OpenAPI tests. Do not treat documentation governance as a substitute for contract freshness.

M6.2 adds OIDC-backed production auth and durable user-governance contract entries. Target production must use `AUTH_PROVIDER=oidc`; local HMAC bearer tokens are only accepted for development smoke/test profiles. User governance routes require `users:manage`, preserve the standard error envelope, and write audit records for each mutation in the same transaction as durable user/role state.

## 调试参数语义

`GET /api/v1/debugging/parameters?projectId=:projectId&protocol=adb` 只返回 enabled 且未 archived 的共享调试 catalog 行，以及属于请求项目的 legacy 行。`projectId` 查询参数用于鉴权和运行上下文化；它不是共享调试 catalog 行的所有权边界。

当请求提供 `parameterId` 时，读写节点 API 会从 `debugging_parameter_node_bindings` 解析对应协议的 `nodePath`。Catalog 参数请求不需要发送原始 node path。

### 调试管理 Catalog

`/api/v1/debugging/admin/*` 专用于 Admin catalog governance，要求 `debugging:admin` 权限。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/debugging/admin/parameters` | 查询完整调试 catalog；`includeArchived=true` 时包含 disabled 或 archived 行。 |
| `POST` | `/api/v1/debugging/admin/parameters` | 创建调试参数和可选 HDC/ADB bindings。 |
| `PATCH` | `/api/v1/debugging/admin/parameters/:parameterId` | 更新调试参数 metadata。 |
| `POST` | `/api/v1/debugging/admin/parameters/:parameterId/archive` | 归档参数，但不删除历史引用。 |
| `POST` | `/api/v1/debugging/admin/parameters/:parameterId/restore` | 恢复已归档参数。 |
| `PUT` | `/api/v1/debugging/admin/parameters/:parameterId/bindings/:protocol` | Upsert HDC 或 ADB node binding。 |
| `PATCH` | `/api/v1/debugging/admin/parameters/:parameterId/bindings/:protocol` | 更新 HDC 或 ADB node binding。 |
| `POST` | `/api/v1/debugging/admin/parameters/:parameterId/bindings/:protocol/archive` | 禁用单个 protocol binding。 |

运行时 `/api/v1/debugging/parameters?protocol=...` 只返回启用、未归档，且所选协议 binding 启用的参数。管理列表 API 可返回缺失或已归档的 bindings，供 `/debugging-admin` 展示 HDC/ADB 覆盖标签。

运行时与管理端调试参数 DTO 包含可选值元数据：

- `valueKind`：`scalar | complex`（legacy 行默认为 `scalar`）
- `valueFormat`：`raw | json | dts | line-list | kv-list`
- `normalizationMode`：`exact | trim | line-ending-normalized | json-canonical`
- `maxValueBytes`：正整数，用于限制写入 payload 大小

管理端 `POST`/`PATCH` 会校验组合关系：标量默认 `raw`/`trim`；`json-canonical` 要求 `valueFormat=json`；复杂 JSON 目标值必须可解析。节点写入请求仍使用 `value: string`；服务层根据参数元数据解析格式、规范化、digest、preview 和比较规则。

节点操作 DTO 可包含 `valueKind`、`valueFormat`、`normalizationMode`、`valuePreview` 以及值 digest，用于复杂写入的列表视图，而不返回完整大 payload。

## 3. Auth 与用户

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/me` | 当前用户、组织、角色和权限 |
| `GET` | `/api/v1/users` | 用户列表 |
| `POST` | `/api/v1/users` | 创建用户 |
| `PATCH` | `/api/v1/users/:userId` | 更新用户状态或资料 |
| `PUT` | `/api/v1/users/:userId/roles` | 更新角色绑定 |

`GET /me` 响应必须足够驱动前端权限裁剪：

```json
{
  "user": {
    "id": "u_1",
    "name": "Xu Yun",
    "email": "xu@example.com"
  },
  "organization": {
    "id": "org_1",
    "name": "ChargeLab"
  },
  "roles": [
    {
      "projectId": "aurora",
      "roleId": "admin"
    }
  ],
  "permissions": ["parameter.view", "parameter.edit", "admin.access"]
}
```

## 4. Projects

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/projects` | 项目列表 |
| `POST` | `/api/v1/projects` | 创建项目 |
| `GET` | `/api/v1/projects/:projectId` | 项目详情 |
| `PATCH` | `/api/v1/projects/:projectId` | 更新项目 |
| `GET` | `/api/v1/projects/:projectId/modules` | 项目模块 |

## 5. Parameters

M1 endpoint shape is locked as:

```text
GET    /api/v1/projects
GET    /api/v1/projects/:projectId/modules
GET    /api/v1/parameters
GET    /api/v1/parameters/:parameterId
GET    /api/v1/parameters/:parameterId/history
POST   /api/v1/parameter-drafts
GET    /api/v1/parameter-drafts/mine
DELETE /api/v1/parameter-drafts/:draftId
POST   /api/v1/parameter-submission-rounds
GET    /api/v1/parameter-submission-rounds
GET    /api/v1/parameter-change-requests
POST   /api/v1/parameter-change-requests/:requestId/review
POST   /api/v1/parameter-import-batches
POST   /api/v1/parameter-import-batches/:batchId/apply
```

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/parameters` | 参数列表，支持 projectId、module、risk、q |
| `GET` | `/api/v1/parameters/:parameterId` | 参数详情 |
| `GET` | `/api/v1/parameters/:parameterId/history` | 参数历史 |
| `POST` | `/api/v1/parameter-drafts` | 创建或更新草稿 |
| `GET` | `/api/v1/parameter-drafts/mine` | 我的草稿 |
| `DELETE` | `/api/v1/parameter-drafts/:draftId` | 删除草稿 |
| `POST` | `/api/v1/parameter-submission-rounds` | 提交一轮参数变更 |
| `GET` | `/api/v1/parameter-submission-rounds` | 提交轮次列表 |
| `GET` | `/api/v1/parameter-change-requests` | 变更请求列表 |
| `POST` | `/api/v1/parameter-change-requests/:requestId/review` | 审阅、推进或打回 |
| `POST` | `/api/v1/parameter-import-batches` | 创建导入批次 |
| `POST` | `/api/v1/parameter-import-batches/:batchId/apply` | 应用导入 |

提交参数变更：

```json
{
  "projectId": "aurora",
  "items": [
    {
      "parameterId": "fast-charge-current",
      "targetValue": "3200",
      "reason": "Reduce thermal risk during fast charging."
    }
  ]
}
```

审阅请求：

```json
{
  "decision": "advance",
  "note": "Hardware review passed.",
  "expectedVersion": 3
}
```

## 6. Logs

M2 日志合同锁定为：

```text
POST /api/v1/log-files
POST /api/v1/logs
GET  /api/v1/logs
GET  /api/v1/logs/:logId
GET  /api/v1/logs/:logId/runs
POST /api/v1/logs/:logId/rerun
POST /api/v1/logs/:logId/archive
POST /api/v1/logs/:logId/unarchive
POST /api/v1/logs/:logId/feedback
GET  /api/v1/jobs/:jobId
GET  /api/v1/jobs/:jobId/events
```

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/v1/log-files` | 创建上传凭证或直接上传 |
| `POST` | `/api/v1/logs` | 创建日志分析记录 |
| `GET` | `/api/v1/logs` | 日志列表 |
| `GET` | `/api/v1/logs/:logId` | 日志详情 |
| `GET` | `/api/v1/logs/:logId/runs` | 分析 run 列表 |
| `POST` | `/api/v1/logs/:logId/rerun` | 重新分析 |
| `POST` | `/api/v1/logs/:logId/archive` | 归档 |
| `POST` | `/api/v1/logs/:logId/unarchive` | 取消归档 |
| `POST` | `/api/v1/logs/:logId/feedback` | 用户反馈 |

`POST /api/v1/log-files` 在 M2 接受 JSON base64 内容，后续可替换为签名上传凭证而不改变 `POST /api/v1/logs` 的分析合同。

创建日志文件：

```json
{
  "projectId": "aurora",
  "fileName": "charging_thermal_trace.log",
  "contentType": "text/plain",
  "contentBase64": "V0FSTiB0ZW1wPTc1",
  "analysisQuestion": "Why did fast charging fold back?",
  "relatedParameterId": "fast-charge-current"
}
```

创建日志分析：

```json
{
  "projectId": "aurora",
  "fileObjectId": "file_123",
  "fileName": "charging_thermal_trace.log",
  "analysisQuestion": "Why did fast charging fold back?",
  "relatedParameterId": "fast-charge-current"
}
```

## 7. Jobs 与进度

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/jobs/:jobId` | 查询任务状态 |
| `GET` | `/api/v1/jobs/:jobId/events` | SSE 进度事件 |

任务状态：

```json
{
  "id": "job_1",
  "kind": "log-analysis",
  "logId": "log_1",
  "runId": "run_1",
  "status": "processing",
  "progress": 65,
  "currentStage": "rootcause",
  "error": null,
  "updatedAt": "2026-05-25T02:05:00.000Z"
}
```

## 8. Debugging

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/debugging/devices` | 设备列表 |
| `POST` | `/api/v1/debugging/targets/detect` | 检测目标 |
| `GET` | `/api/v1/debugging/parameters` | 可调参数列表 |
| `POST` | `/api/v1/debugging/sessions` | 创建调试会话 |
| `GET` | `/api/v1/debugging/sessions/:sessionId` | 调试会话详情 |
| `GET` | `/api/v1/debugging/sessions/:sessionId/events` | 调试会话事件 |
| `POST` | `/api/v1/debugging/nodes/read` | 读取节点 |
| `POST` | `/api/v1/debugging/nodes/write` | 写入节点 |
| `POST` | `/api/v1/debugging/snapshots/:snapshotId/rollback` | 回滚 |

写入节点：

```json
{
  "sessionId": "dbg_1",
  "parameterId": "dbg-fast-charge-current",
  "nodePath": "/sys/class/power_supply/battery/constant_charge_current",
  "value": "3100",
  "readBack": true,
  "confirmationToken": "confirm-high-risk-write"
}
```

回滚快照：

```json
{
  "confirmationToken": "confirm-rollback"
}
```

## 9. Agent

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/v1/agent/sessions` | 创建会话 |
| `POST` | `/api/v1/agent/sessions/:sessionId/messages` | 发送消息 |
| `POST` | `/api/v1/agent/sessions/:sessionId/tool-calls/:toolCallId/run` | 执行无需审批的工具 |
| `POST` | `/api/v1/agent/sessions/:sessionId/approvals/:approvalId/approve` | 批准工具调用 |
| `POST` | `/api/v1/agent/sessions/:sessionId/approvals/:approvalId/reject` | 拒绝工具调用 |

Agent 会话上下文：

```json
{
  "context": {
    "path": "/parameters",
    "pageKey": "parameters",
    "projectId": "aurora",
    "roleId": "hardware-user"
  }
}
```

工具调用治理：

- `requiresApproval=false` 的读工具仍需权限校验。
- `requiresApproval=true` 的工具只能生成 approval。
- 批准时必须重新校验权限和业务状态。

M4 Agent endpoints return a shared turn envelope:

```json
{
  "turn": {
    "session": {
      "id": "agent-session-1",
      "context": { "path": "/parameters", "pageKey": "parameters", "projectId": "aurora", "roleId": "admin" },
      "messages": []
    },
    "messages": [
      {
        "id": "agent-msg-1",
        "role": "assistant",
        "content": "I will call governed tools for this context.",
        "citations": [{ "type": "parameter", "id": "change-1", "label": "Fast charge current" }],
        "confidence": 0.78,
        "createdAt": "2026-05-28T00:00:00.000Z"
      }
    ],
    "toolCalls": [
      {
        "id": "tool-call-1",
        "name": "parameter.submitChangeDraft",
        "label": "Create parameter draft",
        "payload": { "projectId": "aurora", "reason": "Prepare a draft" },
        "requiresApproval": true,
        "status": "pending_approval",
        "approvalId": "approval-1"
      }
    ],
    "approvals": [
      {
        "id": "approval-1",
        "toolCallId": "tool-call-1",
        "title": "Create parameter draft",
        "message": "Approve before WiseAgent creates a human-review draft.",
        "status": "pending"
      }
    ]
  }
}
```

Request and response envelopes:

```text
POST /api/v1/agent/sessions
Request:  { "context": { "path": "/parameters", "pageKey": "parameters", "projectId": "aurora", "roleId": "admin" } }
Response: 201 { "turn": AgentTurn }

POST /api/v1/agent/sessions/:sessionId/messages
Request:  { "message": "Summarize the review queue and prepare a draft." }
Response: 200 { "turn": AgentTurn }

POST /api/v1/agent/sessions/:sessionId/tool-calls/:toolCallId/run
Request:  {}
Response: 200 { "turn": AgentTurn }

POST /api/v1/agent/sessions/:sessionId/approvals/:approvalId/approve
Request:  { "expectedToolCallStatus": "pending_approval" }
Response: 200 { "turn": AgentTurn }

POST /api/v1/agent/sessions/:sessionId/approvals/:approvalId/reject
Request:  { "reason": "Need clearer evidence." }
Response: 200 { "turn": AgentTurn }
```

The reject endpoint transitions the approval from `pending` to `rejected`, marks the linked tool call `rejected`, appends an assistant message, and does not execute the tool.

Tool governance:

- `requiresApproval=false` read/preparation tools still run permission, project access, and payload validation.
- `requiresApproval=true` tools create `agent_approvals` and remain `pending_approval` until an approval endpoint is called.
- Approval-time execution re-checks authz and current business state before running the tool.
- `parameter.submitChangeDraft` creates a human-review draft only; it does not merge or apply production values.
- API-mode quick prompts/actions enter through `sendMessage`; the persisted run endpoint is for existing backend-created toolCall ids.

Agent-specific errors:

- `APPROVAL_REQUIRED`: returned when a caller tries to run an approval-required tool through the run endpoint.
- `INVALID_APPROVAL_STATE`: returned when an approval is no longer pending.
- `FORBIDDEN`: returned when the actor lacks the required permission, project access, or active user state.
- `VALIDATION_FAILED`: returned for invalid request bodies, unknown tools, or missing required tool payload fields.

## 10. Audit

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/audit-events` | 审计事件查询 |
| `GET` | `/api/v1/audit-events/:eventId` | 审计详情 |

过滤条件：

- `projectId`
- `app`
- `kind`
- `actorUserId`
- `targetType`
- `targetId`
- `from`
- `to`
