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

M2 日志与 M3 调试运行时/catalog API 以认证用户的 `organization_id` 为边界，不接受 `projectId` 查询参数或请求体字段。日志记录可含可选 `relatedParameterId` 作为指向 M1 定义的软链接。

`GET /api/v1/debugging/parameters?protocol=adb` 返回 enabled、未 archived 且所选协议 binding 启用的组织 catalog 行。鉴权仅使用组织级调试权限。

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

## 参数模块树

组织级参数模块为独立于调试模块树的层级分类。列表要求 `parameter:view`；创建/更新/移动/删除要求 `admin:access`。删除非空模块（仍有子模块或已挂参数）返回 `409`；循环移动返回 `409`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/parameter-modules` | 列出组织参数模块树节点。 |
| `POST` | `/api/v1/parameter-modules` | 创建模块（`name`，可选 `parentId`）。 |
| `PATCH` | `/api/v1/parameter-modules/:moduleId` | 更新模块元数据。 |
| `POST` | `/api/v1/parameter-modules/:moduleId/move` | 重新挂载父节点（`parentId`，根节点可为 null）。 |
| `DELETE` | `/api/v1/parameter-modules/:moduleId` | 删除空叶子模块。 |

`GET /api/v1/parameters` 支持 `moduleId` 与可选 `includeDescendants`（默认包含子树）。参数 DTO 提供 `moduleId` 与 `modulePath`。

调试管理 catalog 表补充：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/debugging/admin/modules` | 列出调试节点模块树。 |
| `POST` | `/api/v1/debugging/admin/modules` | 创建调试模块。 |
| `PATCH` | `/api/v1/debugging/admin/modules/:moduleId` | 更新调试模块。 |
| `POST` | `/api/v1/debugging/admin/modules/:moduleId/move` | 移动调试模块（循环 → `409`）。 |
| `DELETE` | `/api/v1/debugging/admin/modules/:moduleId` | 删除空模块（否则 `409`）。 |

`GET /api/v1/debugging/admin/nodes` 支持 `moduleId` 与 `includeDescendants` 子树筛选。

## DTS 重载调试

独立模块 `/api/v1/dts-reload/*`（勿与已退役的 `/api/v1/debugging/reload-targets` / `.../parameters/reload` 的 `410` 面混淆）。

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/v1/dts-reload/projects/:projectId/candidates` | `debugging:view` 或 `debugging:dts-reload` | 项目候选参数（可调试性、sensitiveMatch、lastReload）。具备非空绝对 `nodePath`、支持的重载值形态与库基线即可调试（含单段 `/label`，不再有 synthesised-anchor 路径形状拒绝）。已支持形态含 u32/u8/u16 cell（含 `/bits/ 8`）、目录 `string` 单字符串（如 `replace_sensor`）、`string-list`、GPIO 风格 `phandle-cells`。 |
| `POST` | `/api/v1/dts-reload/projects/:projectId/runs` | `debugging:dts-reload` | 启动运行（批量 targets；critical 可能需 `confirm-sensitive-reload`） |
| `POST` | `/api/v1/dts-reload/runs/:runId/deploy` | `debugging:dts-reload` | 进程内桥接部署；需 `confirm-dts-reload` |
| `GET` | `/api/v1/dts-reload/runs` / `.../:runId` | 查看路径 | 历史与含重载快照的详情 |
| `GET` | `/api/v1/dts-reload/residue` | 查看路径 | 设备残留记账 |
| `POST` | `/api/v1/dts-reload/projects/:projectId/restore-baseline` | `debugging:dts-reload` | 启动恢复基线运行 |
| `*` | `/api/v1/dts-reload/configuration*` | `debugging:admin` | 组织默认与设备覆盖 |

请求/响应 schema 以已提交的 OpenAPI（`docs/generated/openapi.json`）为准。

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
POST   /api/v1/parameter-import/parse-dts
POST   /api/v1/parameter-import-batches
POST   /api/v1/parameter-import-batches/:batchId/apply
GET    /api/v1/parameters/dashboard/summary
GET    /api/v1/parameters/dashboard/hotspots
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
| `POST` | `/api/v1/parameter-import/parse-dts` | 完整 `.dts` 服务端 CST 解析（`parseDts`/`resolveDts`）；含 `/include/` 时返回 `details.code=dts-include-unsupported` |
| `POST` | `/api/v1/parameter-import-batches` | 创建导入批次预览；可选 `reviewMetadata`（跳过原因等）写入 `batch-import` 审计 metadata |
| `POST` | `/api/v1/parameter-import-batches/:batchId/apply` | 应用导入；可选 `reviewMetadata` 合并进 apply 审计 |
| `GET` | `/api/v1/parameters/dashboard/summary` | 参数看板汇总：KPI、趋势、风险分布、工作台信号；另含 `personalKpis`（按 `perspectiveRoleId` 视角聚合的个人 KPI：`contributionCount`、`workflowCount`、`openItemCount`、`pendingTodoCount`、`highRiskTouchCount`）与 `personalTrend`（个人趋势，结构与 `trend` 相同，按同一视角聚合）；查询参数 `window`（默认 `30d`）、可选 `projectId`、可选 `perspectiveRoleId`（前端当前角色，用于个人 KPI 语义分支） |
| `GET` | `/api/v1/parameters/dashboard/hotspots` | 参数热榜；查询参数 `window`（默认 `30d`）、`dimension`（默认 `overall`）、可选 `projectId` |

`parse-dts` 返回行含 `name`、`module`、`sourceNodePath`、`rawText`、`normalizedValue`、`valueType`；身份语义与服务端 `nodePathToParameterIdentity` 对齐。默认内容上限 2MB。完整字段示例见英文版 `docs/design-docs/api-contract.md` § Parameter Import。

`/parameter-home` 前端通过 `ParameterDashboardRepository` 消费上述只读聚合接口；热榜评分为服务端确定性可解释打分，前端仅做展示与动作模板映射。

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

M2 日志合同锁定为组织级作用域（迁移 `0037` 移除 `projectId`）：

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
  "fileObjectId": "file_123",
  "fileName": "charging_thermal_trace.log",
  "analysisQuestion": "Why did fast charging fold back?",
  "relatedParameterId": "fast-charge-current"
}
```

## 7. Product Feedback

Internal Beta「问题反馈」与日志分析反馈分离，按认证用户的 `organization_id` 隔离。活跃登录用户可以从侧边栏 `FeedbackDialog` 提交；列表、详情、状态流转和附件读取只开放给具备 `admin:access` 的管理员。

```text
POST  /api/v1/product-feedback
GET   /api/v1/product-feedback
GET   /api/v1/product-feedback/:id
PATCH /api/v1/product-feedback/:id
GET   /api/v1/product-feedback/:id/attachments/:attachmentId/content
```

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/v1/product-feedback` | 创建问题反馈，可带图片附件；返回 `201 { item }`。 |
| `GET` | `/api/v1/product-feedback` | Admin 列表；支持 `status`、`feedbackType`、`q`、`pagePath`、`createdFrom`、`createdTo`、`cursor`、`limit`。 |
| `GET` | `/api/v1/product-feedback/:id` | Admin 详情，包含按顺序排列的附件 metadata。 |
| `PATCH` | `/api/v1/product-feedback/:id` | Admin 处理反馈，更新 `status` 和/或 `adminNote`。 |
| `GET` | `/api/v1/product-feedback/:id/attachments/:attachmentId/content` | Admin 读取单个图片附件内容。 |

创建反馈：

```json
{
  "pagePath": "/parameters",
  "pageTitle": "项目参数用户工作台",
  "feedbackType": "experience",
  "description": "移动端提交按钮不明显。",
  "attachments": [
    {
      "fileName": "mobile-layout.png",
      "contentType": "image/png",
      "contentBase64": "iVBORw0KGgo="
    }
  ]
}
```

`feedbackType` 可为 `experience`、`data`、`export_submit`、`feature`。`status` 可为 `open`、`in_progress`、`closed`，状态流转为 `open -> in_progress -> closed`；`closed` 后不允许继续更新。附件只接受 `image/png`、`image/jpeg`、`image/webp`，最多 5 张，单张 5 MB，总量 15 MB。

## 项目参数初始化

新建项目的一次性语义 binding 库初始化（`projects.initialization_status`）。创建者草稿/提交；Admin 批准/驳回。审计 kind：`project-initialization-submitted` / `approved` / `rejected`。

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/parameters/projects/:projectId/initialization` | 状态 + 可选草稿 |
| `PUT` | `/api/v1/parameters/projects/:projectId/initialization/draft` | 写入草稿（语义快照或 `emptyLibrary`） |
| `POST` | `/api/v1/parameters/projects/:projectId/initialization/preview` | 服务端主源/补充源合并预览 |
| `POST` | `/api/v1/parameters/projects/:projectId/initialization/submit` | 提交待审阅 |
| `GET` | `/api/v1/parameters/admin/initialization-reviews` | 待审列表（Admin） |
| `POST` | `/api/v1/parameters/admin/initialization-reviews/:reviewId/approve` | 批准并物化 binding |
| `POST` | `/api/v1/parameters/admin/initialization-reviews/:reviewId/reject` | 带原因驳回 |

当 `initialization_status` ≠ `initialized` 时，`POST /api/v1/parameter-submission-rounds` 失败关闭。

Admin 项目摘要（`GET/POST /api/v1/parameters/admin/projects`）同时返回运维态 `status`（`initialized` | `maintenance`）与 `initializationStatus`（`projects.initialization_status`）。项目清单状态列在 init 未完成时优先展示 init 状态。

## 项目参数文件

每项目可托管多个 DTS/JSON 文件，字节存对象存储，元数据与 `parsed_index` 存 PostgreSQL。上传请求体为 JSON `contentBase64`（非 multipart）。P1 单文件上限 2 MB。参数列表/详情 DTO 对已绑定项目值暴露可选 `sourceFileName`、`sourceNodePath`。

查看要求 `canViewParameters`；上传、新版本、同步与冲突裁决要求 `canAdminParameters`。裁决服务层另校验 `canReviewParameters`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/projects/:projectId/parameter-files` | 列出项目托管文件及当前版本元数据。 |
| `POST` | `/api/v1/projects/:projectId/parameter-files` | 上传新文件或首版。返回 `201 { item, version }`。 |
| `POST` | `/api/v1/projects/:projectId/parameter-files/:fileId/versions` | 上传下一版本。返回 `201 { item }`（版本 DTO）。 |
| `GET` | `/api/v1/projects/:projectId/parameter-files/:fileId/versions` | 单文件版本历史。 |
| `GET` | `/api/v1/projects/:projectId/parameter-files/:fileId/versions/:versionId/content` | 下载指定版本原始字节。 |
| `GET` | `/api/v1/projects/:projectId/parameter-file-candidates` | 列出暂存候选（`?fileId=&includeAbandoned=`）。返回不含 storage key 的 `{ items }`。 |
| `POST` | `/api/v1/projects/:projectId/parameter-file-candidates` | 创建暂存候选（`fileName`、`contentBase64`、可选 `fileId`）。不改变活跃版本或配置集成员。返回 `201 { item }`。 |
| `GET` | `/api/v1/projects/:projectId/parameter-file-candidates/:candidateId` | 读取单个候选生命周期 DTO。 |
| `GET` | `/api/v1/projects/:projectId/parameter-file-candidates/:candidateId/impact` | 读取候选影响证据（textDiff、structuralDiff、诊断、覆盖、冲突、阻断）。 |
| `GET` | `/api/v1/projects/:projectId/parameter-file-candidates/:candidateId/content` | 下载候选字节。 |
| `POST` | `/api/v1/projects/:projectId/parameter-file-candidates/:candidateId/abandon` | 放弃 ready/blocked/failed/stale 候选，不改变工作配置。 |
| `POST` | `/api/v1/projects/:projectId/parameter-file-candidates/:candidateId/recompute` | 重算 ready/blocked/failed/stale 候选影响；stale 会按当前活跃版本重定基。 |
| `POST` | `/api/v1/projects/:projectId/parameter-file-candidates/:candidateId/activate` | 以 `expectedCurrentVersionId` CAS 激活 ready 候选。新文件必须提供 `configSetId` + `role`。基过期返回 `409`（`reason: stale-base`），候选标为 `stale` 且保留工作配置。成功返回 `{ item, file, version }` 并审计。 |
| `POST` | `/api/v1/projects/:projectId/parameter-files/:fileId/sync` | 对当前或指定版本与 DB diff 并 upsert `file_sync` 草稿。返回 `{ item: syncSummary }`。 |
| `GET` | `/api/v1/projects/:projectId/parameter-file-conflicts` | 列出项目内 open 冲突。每条含 `baseValue`、`parameterName` / `parameterModule`、可读 `fileVersionLabel`（及版本号/时间）、来源身份（`fileId`、`fileName`、`configSetId`、`nodePath`、`propertyName`，可选 `source` 定位）。 |
| `POST` | `/api/v1/projects/:projectId/parameter-file-conflicts/:conflictId/resolve` | 裁决冲突。请求体：`{ "resolution": "file" \| "ui", "reason?" }`。可选 `reason` 去空白后写入 `parameter-file-conflict-resolve` 审计 metadata。 |
| `POST` | `/api/v1/projects/:projectId/parameter-file-conflicts/bulk-preview` | 批量裁决影响预览。请求体：`{ "resolution": "file" \| "ui", "conflictIds?" }`；省略 `conflictIds` 时预览项目全部 open 冲突。返回 `{ resolution, eligible, ineligible, impact }`。不合格原因：`not_found`、`already_resolved`、`wrong_project`、`missing_values`。 |
| `POST` | `/api/v1/projects/:projectId/parameter-file-conflicts/bulk-resolve` | 仅对合格冲突 ID 应用同一裁决。请求体：`{ "resolution": "file" \| "ui", "conflictIds", "reason?" }`。返回 `{ resolved, skipped }`。 |

上传请求体：

```json
{
  "fileName": "battery.dtsi",
  "contentBase64": "YmF0dGVyeSB7IHRlbXBf..."
}
```

同步请求体（可选）：

```json
{
  "versionId": "ppfv_123"
}
```

省略 `versionId` 时使用文件 `currentVersionId`。`origin=writeback` 的版本在同步时不生成新草稿。

审计动作：`parameter-file-upload`、`parameter-file-sync`、`parameter-file-conflict-open`、`parameter-file-conflict-resolve`、`parameter-writeback-to-file`。

### 结构化读取与 DTS 检索（P3）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/projects/:projectId/parameter-files/:fileId/versions/:versionId/structure` | 从 `dts_*` 读取某一文件版本的结构化模型（请求内不重解析）。返回 `{ nodes }`；节点含类型化 `properties`（`valueType`/`rawText`/`normalizedValue`）、`phandleRefs`，以及 ingest 时写入的可选 `source` 定位器（`startOffset`/`endOffset`/`startLine`/`startColumn`/`endLine`/`endColumn`）。需要 `parameter:view`。 |
| `GET` | `/api/v1/projects/:projectId/dts-search` | 在项目当前文件版本的 `dts_*` 上检索。查询：`q`（必填），可选 `by` = `path`\|`address`\|`label`\|`compatible`\|`value`\|`file`（省略 `by` 表示全维度含文件名）。返回 `{ hits }`，可含 `source` 定位器。需要 `parameter:view`。 |
Migration `0092_dts_structural_spans.sql` 在 `dts_nodes` / `dts_properties` 上持久化源码定位器，并在 structure/search 读取中返回（不重解析）。

| `POST` | `/api/v1/projects/:projectId/dts-structured-edits/submit` | 将一条或多条结构化 DTS 属性编辑提交为参数提交轮次。请求体：`{ edits: [{ fileId, nodePath, propertyName, rawText, reason? }], reason?, assignees? }`。按 `source_file_name`/`source_node_path` 映射到 `project_parameter_value`，创建草稿并提交 CR；`targetValue` 使用 `rawText`（非 `normalizedValue`）。返回 `201 { item }`（含 CR 项的提交轮次）。需要 `parameter:edit`；敏感节点规则适用（关键路径需 `parameter:edit-critical`；Agent 写 critical 节点拒绝）。审计：`parameter-structured-edit-submit`。 |

### 变更请求 impact 扩展（P3）

`GET /api/v1/parameter-change-requests`（及相关详情）暴露 `impact[]`，kind 为 `module` \| `test` \| `parameter` \| `phandle` \| `compatible` \| `config-set`。项目值结构化绑定时，服务端附加 phandle / compatible / config-set 对等项；否则保留遗留模板。

敏感节点守卫作用于提交/合入/回写：缺少 `parameter:edit-critical` → `403`；Agent 写 `critical` 规则 → `403` 且 `requireHuman: true`，审计 `parameter-sensitive-node-denied`。

## 配置集、发布基线与校验门禁（P2）

板级配置集把项目下的参数文件聚合为一个可构建单元；发布基线对配置集做快照，支持对比/回滚/发布；校验门禁在基线发布前运行 `dtc`。以下路由均要求 `canAdminParameters`（`admin:access`）；非 Admin 调用返回 `403`。Admin UI 在 P3 提供（`/parameter-admin/projects` 的 `ConfigSetBaselinePanel`）。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/projects/:projectId/config-sets` | 列出项目的配置集。 |
| `GET` | `/api/v1/projects/:projectId/config-sets/:configSetId/files` | 读取项目范围内配置集成员、角色、格式、排序及当前 active version 身份。要求 `parameter:view`；配置集不属于项目/组织范围时返回 `404`。 |
| `POST` | `/api/v1/projects/:projectId/config-sets` | 创建配置集。请求体：`{ name, description?, derivedFromId? }`。返回 `201 { item }`；同项目内 `name` 重复报 `409`。 |
| `POST` | `/api/v1/projects/:projectId/config-sets/:configSetId/files` | 把参数文件加入配置集成员。请求体：`{ fileId, role, sortOrder? }`（`role` 为 `base`\|`overlay`\|`charging`\|`thermal`\|`misc`）。返回 `201 { item }`；文件已属于另一配置集报 `409`。 |
| `DELETE` | `/api/v1/projects/:projectId/config-sets/:configSetId/files/:fileId` | 从配置集移除文件。返回 `200 {}`。 |
| `GET` | `/api/v1/projects/:projectId/config-sets/:configSetId/baselines` | 列出配置集的基线。 |
| `GET` | `/api/v1/projects/:projectId/config-sets/:configSetId/release-readiness` | 配置集的服务端发布就绪结果。可选查询参数 `acknowledgedWarningIds`（逗号分隔）。返回 `200 { item }`，含 `available`、`level`（`blocked`\|`warning`\|`ready`\|`in-sync`）、有序 `blockers`/`warnings`（稳定目标、remediation、可选确认）、`gateToken`、`releasedBaselineId`，以及权威的 `canCreateBaseline`/`canRelease`。`in-sync` 要求 Working 成员与当前已发布 tip 对齐（版本 id 或相同 storage key）。仅 Admin；前端不得用客户端计数重建权限。 |
| `POST` | `/api/v1/projects/:projectId/config-sets/:configSetId/baselines` | 把配置集当前所有成员版本快照为新的 `draft` 基线。请求体：`{ name, notes?, gateToken, acknowledgedWarningIds? }`。返回 `201 { item }`；缺少/过期 `gateToken`、就绪阻断、成员无当前版本或基线重名报 `409`。不上传、不改写源文件。 |
| `GET` | `/api/v1/projects/:projectId/baselines/:baselineId` | 读取一条基线及其钉住成员。返回 `200 { item, members }`。 |
| `GET` | `/api/v1/projects/:projectId/baselines/:baselineId/compare` | 对比基线钉住的版本与 Working（`against=working`，默认）或当前已发布 tip（`against=released`）。返回 `200 { item: { baselineId, against, againstBaselineId?, members } }`；每个成员为 `unchanged`\|`version_changed`\|`file_added`\|`file_removed`；`version_changed` 的 dts 成员附带 `structuralDiff`。缺少已发布 tip 且 `against=released` → `409`。 |
| `GET` | `/api/v1/projects/:projectId/baselines/:baselineId/restore-preview` | 预览恢复 blast radius（不应用）。返回 `200 { item }`，含每成员 from/to、`action`（`noop`\|`rollback-pointer`）、`driftedCount` 与 `releasedBaselineUnchanged: true`。 |
| `POST` | `/api/v1/projects/:projectId/baselines/:baselineId/rollback` | 仅对漂移成员原子恢复（新建 `origin=rollback` 指针版本）；不删历史；不改变当前已发布 tip。返回 `200 { item: { baselineId, restored } }`。 |
| `POST` | `/api/v1/projects/:projectId/baselines/:baselineId/release` | 重新评估发布就绪（要求匹配的 `gateToken`），运行校验门禁，把同配置集先前 `released` tip 降为 `historical`，再把目标基线标为 `released`。请求体：`{ gateToken, acknowledgedWarningIds? }`。返回 `200 { item: baseline, gate }`。过期/阻断就绪或校验失败 → `409`。 |
| `GET` | `/api/v1/projects/:projectId/config-sets/:configSetId/export` | 导出无损 bundle：每个 dts 成员为 `serializeDts(parseDts(源))`。返回 `200 { manifest, files }`；`manifest.validation` 携带导出时刻的门禁结果（导出不会因门禁失败而阻断，这一点与 release 不同）。 |

校验门禁结果结构（`gate` / `manifest.validation`）：

```json
{
  "ok": true,
  "mode": "warn",
  "requiresConfirmation": true,
  "compiler": "dtc",
  "diagnostics": [{ "file": "board.dts", "line": 12, "severity": "error", "message": "syntax error" }]
}
```

`mode` 为 `block`（默认）、`warn` 或 `off`（`DTS_VALIDATION_MODE`；见 `docs/zh-CN/developer/environment-variables.md`）。`compiler` 为 `dtc` 或 `unavailable`（`PATH` 上找不到 `dtc` 二进制）。只要结果不是一次硬性 `dtc` 通过（即 `warn` 模式，或 `block`/`off` 下因编译器不可用而软放行），`requiresConfirmation` 就为 `true`。

审计 kind 与 action：`config-set`（`created`、`updated`、`member_changed`）、`baseline`（`created`、`rolled_back`、`released`）、`validation.gate`（`run`）、`export`（`file`、`config-set`）。

## 语义参数拓扑（`/api/v2`）

拓扑/Schema 程序的语义表面。生产对身份、dt-schema、`dtc`、`fdtoverlay` 失败关闭。维护窗口 cutover 后，遗留扁平参数 ID 返回 `410`（`details.code=legacy-parameter-id-retired`），不做兼容投影。

**ParameterSpec 身份（ADR-0013 / ADR-0014）：** 稳定目录身份为归属范围 + `attributionSubjectId`（驱动登记或节点类型定义）+ `property_key`。列表/详情 DTO 的 `lifecycle` 反映定义层 `definition_lifecycle`（`draft` \| `active` \| `deprecated`）。版本化内容在 `parameter_spec_versions`（`version_status`：`draft` \| `active` \| `superseded`）；`currentVersionId` / `currentVersion` 在有活跃内容时指向当前版本行。同 subject + key 时组织定义覆盖平台定义。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/v2/parameter-specs` | 按稳定 subject + 属性键列出参数规格。每项含 `attributionSubjectId`、`lifecycle`（定义层）、`currentVersionId` / `currentVersion`、`propertyKey`、仅作展示的 `driverModule`（有主体时取主体 displayName），以及 `attributionModules: Array<{ id, name, kind }>`——经 binding 实测到的归属单元（驱动组与节点类型单元）去重集合，由服务端计算。`attributionModules` 为空表示尚未实测。筛选：`?q=&sourceKind=&lifecycle=&attributionSubjectId=&propertyKey=`。规格层不重新执行 compatible 或 node-type 匹配（ADR-0010）。 |
| `POST` | `/api/v2/parameter-specs` | Admin 为 `attributionSubjectId` + `propertyKey` 创建本组织 **draft** 定义（subject 须为 driver-registration 或 node-type-definition）。请求体须含 `reason`；可选 `displayName`、`description`、`documentation`、`valueShape`、`constraints`、`units`、`exampleValue`。结构属性键（ADR-0003）→ `400`。组织内 subject+key 重复 → `409`。覆盖平台同名定义须 `overridePlatform: true`，否则 `409` 且 `confirmRequired`。返回 `{ item }`（`201`）。审计：`spec-draft-created`。 |
| `GET` | `/api/v2/parameter-specs/:specId` | 规格详情：定义层 `lifecycle`、版本指针、`attributionSubjectId`、example/default/policy 分字段（`exampleValue` 仅示意）。存在开放 cutover 时含可选 `cutover` 摘要（状态、版本指针、影响计数）。 |
| `PATCH` | `/api/v2/parameter-specs/:specId` | Admin 对 **active**（或平台全局）定义做原地内容更新——draft 不可 patch（`409`，应走 activate）。请求体：`documentation`、`reason`，及可选 `valueShape`、`constraints`、`displayName`、`description`、`units`、`exampleValue`。更新当前 `parameter_spec_version` 行。**不接受** `policyTarget`（产品作用域；见 TD-055）。审计：`spec-updated`。 |
| `GET` | `/api/v2/parameter-spec-review-tasks` | 组织范围、分页、按状态筛选的规格审核队列（`?status=&limit=&cursor=`） |
| `POST` | `/api/v2/parameter-specs/:specId/activate` | Admin 激活本组织 **draft**，或在 **active** 且内容变更时记录语义后继版本（ADR-0014）。请求体须含完整 `valueShape`、`constraints`、`documentation`、`reason`；可选 `displayName`、`description`、`coverageClaim`（subject 绑定 draft 且无既有 claim 时必填）。**本版本 `coverageClaim.kind` 仅支持 `overlay-property`**（`pinned-schema-property` **不支持**；覆盖声明保持 overlay-only）。平台全局 draft（`organization_id IS NULL`）→ `403`。跨组织 → `404`。形状缺失/冲突 → `400`/`409`。已废弃 → `409`。**分阶段切换：** active 定义内容变更时插入 draft 后继版本与 `parameter_spec_version_cutover_run`。当前版本 tip 无 binding 时**自动 finalize**（旧版 `superseded`、后继 `active`）。存在 tip binding 时运行态保持 `preparing` 直至 prepare/finalize。审计：`spec-activated`（自动 finalize 时含 cutover 审计）。 |
| `GET` | `/api/v2/parameter-specs/:specId/cutover` | 开放 cutover 影响摘要（`{ item: cutoverSummary }`）。无开放 run → `404`。查看权限。 |
| `POST` | `/api/v2/parameter-specs/:specId/cutover/prepare` | Admin 将 pending cutover 项标为 `ready`（复用 base revision id，不插入第二行 revision）。可选请求体 `{ reason? }`。全部就绪后 run → `ready`。审计：`spec-version-cutover-prepared`。 |
| `POST` | `/api/v2/parameter-specs/:specId/cutover/finalize` | Admin 在 prepare 后 finalize：更新 binding revision 的 `parameter_spec_version_id`、废弃旧版、激活后继。请求体 `{ reason }`。仍有 pending/incompatible → `409`。审计：`spec-version-cutover-finalized`。 |
| `POST` | `/api/v2/parameter-specs/:specId/deprecate` | Admin 在**定义层**软废弃（`definition_lifecycle → deprecated`；当前版本仍可供解析/发布读取）。本组织：组织 Admin；组织 Admin 对平台全局 → `403`；**`platform-admin` 可废弃平台全局定义**（ADR-0011 修订）。请求体 `{ reason }`。lifecycle 非 `draft`/`active` → `409`。审计：`spec-deprecated`。 |
| `POST` | `/api/v2/parameter-specs/:specId/restore` | Admin 恢复已废弃定义：本组织由组织 Admin 恢复；平台全局由 **`platform-admin`** 恢复。有 `activated_at` 则回到 `active`，否则回到 `draft`。请求体 `{ reason }`。非 `deprecated` → `409`。审计：`spec-restored`。 |
| `POST` | `/api/v2/parameter-spec-review-tasks/:taskId/resolve` | Admin 决议规格审核（`parameterSpecId` 须为本组织或全局，**或** 未匹配任务使用 `createSpec: true`）。服务端经租户作用域 join 校验 project/revision/occurrence/logical node 证据后应用决议——不得单独信任 raw evidence ID。`createSpec: true` 创建本组织 **draft** 规格（从 occurrence AST 推断类型）并返回 `draftCreated` 与须先激活的提示。仅 **active** 且约束完整的规格可 resolve/release。`resolved` 在同一事务中应用 occurrence→spec→binding 并持久化可复用 matcher override（作用域：`compatible` + **节点 locator 指纹** + 属性键）。库内决议若属性键与 occurrence 不一致，须显式 `confirmPropertyMismatch: true`，否则服务端拒绝。`dismissed` 失败关闭：不创建 binding，发布/校验仍阻断被 dismiss 的属性。审计：`parameter-topology-governance` / `spec-review-resolved`。 |
| `GET` | `/api/v2/projects/:projectId/config-sets/:configSetId/revisions/:revisionId/topology` | 源树或生效树（`?view=source\|effective`）。节点可含派生 `enablement`（`selfEnabled`、`override`、`reachable`、阻断祖先标签）——不是参数 binding。 |
| `GET` | `/api/v2/projects/:projectId/parameter-bindings` | 稳定项目绑定 |
| `GET` | `/api/v2/identity-mapping-tasks` | 身份映射任务列表（`?projectId=&status=`，`status` 为 `open` \| `resolved` \| `dismissed` \| `new_identity`）。项含 `taskKind`（`identity-ambiguity` \| `singleton-cardinality`）、候选与证据。 |
| `POST` | `/api/v2/identity-mapping-tasks/:taskId/resolve` | Admin 确认/驳回/声明新身份。请求体 `{ decision: resolved \| dismissed \| new-identity, reason, selectedLogicalNodeId?, confirmAllCandidates? }`。`resolved` 须 `selectedLogicalNodeId` 属于候选。多候选 `new-identity` 须 `confirmAllCandidates: true`。`singleton-cardinality` 任务拒绝身份决议（`409` `singleton-cardinality-conflict`）——须在登记/拓扑侧修复。`dismissed` 与开放 `singleton-cardinality` 仍为**发布阻断**；`resolved` 与 `new_identity` 清除阻断。审计：`identity-mapping-resolved` / `identity-mapping-dismissed` / `identity-mapping-new-identity`。 |
| `POST` | `/api/v2/identity-mapping-tasks/:taskId/reopen` | Admin 将 `dismissed` / `new_identity` 的 `identity-ambiguity` 任务重开为 `open`（`{ reason }`）。修订重新置为 `needs_mapping`。已应用的 `resolved` 映射走受保护 re-resolve，不可 reopen（`409`）。审计：`identity-mapping-reopened`。 |
| `POST` | `/api/v2/projects/:projectId/config-revisions/:revisionId/validate` | 失败关闭工具链校验。再次校验失败会**撤销**此前的 `validated` 标记；开放身份映射、**已驳回**身份映射、**singleton-cardinality** 映射阻断，或被 dismiss 且未匹配的规格审核，均 fail-closed。 |
| `POST` | `/api/v2/projects/:projectId/parameter-bindings/:bindingId/drafts` | 类型化绑定草稿 + **精确 occurrence** Config Set 回写：锁定 binding revision、occurrence、文件版本、checksum 与 CST span（默认强制 schema；**base** binding revision 不可变；合入值在 **candidate** revision）。身份过期 → `409`。Cutover 后语义合并在缺 `objectStore`、项目范围、write lock 或真实 DTC 工具链时失败关闭——生产路径无 `WISEEFF_WRITEBACK_SKIP_TOOLCHAIN`。Cutover 后草稿不得再创建 shadow `project_parameter_values` / `parameter_definitions`。 |
| `POST` | `/api/v2/projects/:projectId/node-enablement-drafts` | 共享工作 tip 管线上的节点启用草稿。请求体：`{ logicalNodeId, baseRevisionId, target: force-enabled\|force-disabled\|unstated, reason, acknowledgeNonstandard?, spellingOverride? }`。在锁定的 overlay 文件上写入或删除 DTS `status`；与 binding 草稿共享 candidate revision 协调（混用 tip → `409 mixed-working-tips`）。要求 `parameter:edit`；适用 `dts_sensitive_node_rules`。审计：`parameter-topology-governance` / `enablement-changed`。 |
| `GET` | `/api/v2/parameter-modules` | 组织模块注册表：`{ item: { modules, mappings } }`。模块 DTO 含 `kind`、`origin`、`sourceKey`、`attributionSubjectId`（驱动组/节点类型目录 subject）、`effectiveImportance`、`parameterCount`（及 `name`、`parentId`、`sortOrder`、`importance`）。模块 CRUD 仍走 v1。 |
| `GET` | `/api/v2/parameter-modules/discovery-hints` | 从 binding 观测未映射 `compatible`（`{ item: { compatibles: [{ compatible, bindingCount, projectCount, suggestedGroupName }], total } }`），排除已忽略与脚手架标签。 |
| `POST` | `/api/v2/parameter-modules/discovery-hints/dismissals` | Admin 从队列忽略 compatible（`{ compatible, reason? }`）；返回刷新后的 hints。审计：`parameter-module-compatible-dismissed`。 |
| `DELETE` | `/api/v2/parameter-modules/discovery-hints/dismissals/:compatible` | Admin 恢复已忽略的 compatible。审计：`parameter-module-compatible-restored`。 |
| `POST` | `/api/v2/parameter-modules/mappings/preview` | Admin 映射干跑（`{ moduleId, matchKind, matchValue, priority? }`）；`matchKind` 仅 `compatible` \| `node-type`。返回 `{ item: MappingApplyPreview }`，不落库。 |
| `POST` | `/api/v2/parameter-modules/mappings` | Admin 创建映射并**按规则范围应用**到匹配 binding。返回 `{ item: registry, apply: MappingApplyPreview }`（`201`）。审计：`parameter-module-mapping-created`。 |
| `DELETE` | `/api/v2/parameter-modules/mappings/:mappingId` | Admin 删除映射并对受影响 binding 做范围重停放。返回 `{ item: registry, apply: MappingApplyPreview }`。审计：`parameter-module-mapping-deleted`。 |
| `POST` | `/api/v2/parameter-modules/recompute-bindings` | Admin 全组织或单项目重算（可选 `{ projectId, dryRun }`）。`dryRun: true` 返回 `{ updated, conflicts, dryRun: true, preview }` 不写库。正式应用返回 `{ updated, conflicts, preview? }`；唯一键冲突 → `409`。运维/回填（历史 drift 或 seed 纠偏）——日常归类与驱动登记/认领走按范围应用，而非全量重算。审计：`parameter-module-bindings-recomputed`。 |
| `GET` | `/api/v2/parameter-modules/driver-registry` | 组织驱动登记视图：`{ items: DriverRegistryEntry[], total }`。每项为驱动组模块，含 exact compatible、`origin`、当前树业务分类、权威 `defaultBusinessCategoryId`（注册默认，可与当前父节点不同）、参数/实测覆盖、可通过 PATCH 编辑的 `driverNature` / `instanceCardinality`（已链接 `driver_registrations` 时；GET 本身只读）及逐条 compatible 解析覆盖（钉住 schema 模式 **或** 活跃组织 overlay；`source`/`driverId` 标识来源）。排除脚手架标签。 |
| `POST` | `/api/v2/parameter-modules/driver-registry` | Admin 登记或认领驱动（`{ displayName, businessCategoryId, compatibles[], notes? }`）。创建 curated 驱动组 + exact compatible 映射，或认领已有映射组（移动 + 重命名 + 提升）。将 `businessCategoryId` 写入注册 `defaultBusinessCategoryId`。同一事务内对每个 compatible 做 scoped binding 重算（语义同映射创建）。返回 `{ mode: 'registered'\|'claimed', item, apply }`（`201`）；唯一键冲突 → `409`。审计：`parameter-module-driver-registered`（metadata 含 `affectedBindings`）。 |
| `PATCH` | `/api/v2/parameter-modules/driver-registry/:moduleId` | Admin 更新驱动登记属性（`{ driverNature?, instanceCardinality? }`；至少一项）。组织 Admin 仅可编辑**组织**主体；**platform-admin** 可编辑平台**与**组织主体。同事务：登记更新 + 审计（`parameter-module-driver-registration-updated`，组织 id = 主体组织，使 platform-admin 编辑出现在组织审计）+ 对 tip 修订重同步 singleton-cardinality 阻断任务（仅阻断发布；不改写拓扑）。返回 `{ moduleId, driverNature, instanceCardinality, attributionSubjectId }`。 |
| `PATCH` | `/api/v2/parameter-modules/driver-registry/:moduleId/default-business-category` | Admin 更新注册默认业务分类（`{ defaultBusinessCategoryId }`）。同事务审计，并回放该 subject 下 **auto** 驱动组到新默认（curated 冻结）。返回 `{ item, defaultBusinessCategoryId, replay: { moved, skippedCurated, skippedMissingDefault } }`。审计：`parameter-module-driver-default-business-category-updated`。独立路径，避免与 `PATCH .../driver-registry/:moduleId`（nature/cardinality）冲突。 |
| `POST` | `/api/v2/parameter-modules/driver-registry/:moduleId/replay-placement` | 显式 Admin「从注册回放放置」：将 **auto** 驱动组重挂到注册默认；curated 跳过。返回 `{ moduleId, moved, skippedCurated, skippedMissingDefault }`。审计：`parameter-module-driver-placement-replayed`。 |
| `GET` | `/api/v2/organization-driver-schemas` | 列出本组织手工驱动 schema overlay（`{ items, total }`）。 |
| `GET` | `/api/v2/organization-driver-schemas/:schemaId` | 获取单个 overlay（`{ item }`）。 |
| `POST` | `/api/v2/organization-driver-schemas` | Admin 创建 draft overlay（`{ compatible, displayName, notes?, properties[] }`）。属性可为 `{ parameterSpecId }`（链接定义库）或 `{ propertyKey, valueShape, … }`（创建/确保组织手工 ParameterSpec 后链接）。仅 exact compatible；钉住可发布 schema 已覆盖时拒绝（`409`）。返回 `{ item }`（`201`）。 |
| `PATCH` | `/api/v2/organization-driver-schemas/:schemaId` | Admin 更新 draft overlay 元数据/属性（同上链接/创建形态）。已激活属性集不可变。 |
| `POST` | `/api/v2/organization-driver-schemas/:schemaId/activate` | 激活 overlay：合并进组织 schema 注册表，原地升级匹配的手工规格，并决议相关开放审核任务。返回 `{ schema, upgradedSpecIds, resolvedReviewTaskIds }`。 |
| `GET` | `/api/v2/organization-driver-schemas/:schemaId/deprecation-impact` | Admin 预览 overlay 退役影响：`{ item: { schemaId, compatible, coverageLoss, definitionCount, projectCount, successorSource? } }`。 |
| `POST` | `/api/v2/organization-driver-schemas/:schemaId/deprecate` | 废弃 overlay，使其不再参与匹配。预览报告 `coverageLoss` 时请求体须 `confirmCoverageLoss: true`，否则 `409` 且 `confirmRequired`。活跃**平台** overlay 已覆盖 compatible 时拒绝新建/激活。 |
| `GET` | `/api/v2/platform/driver-schemas/promotion-candidates` | 仅 `platform:schema-promote`。按 `lower(compatible)` 聚合跨组织活跃 overlay 的固定投影：compatible、贡献组织 id、属性键/形状、等价判定、分歧（如有）、既有平台 overlay id。**不**返回完整 overlay 记录。 |
| `POST` | `/api/v2/platform/driver-schemas/promotions` | `platform:schema-promote`。请求体 `{ compatible, documentationSourceOrganizationId? }`。要求贡献方等价。写入平台 overlay（`organization_id IS NULL`），原地提升链接 ParameterSpec，标记贡献方为 `superseded`，失效各组织 schema 注册表缓存，并扇出平台 + 租户审计。 |
| `POST` | `/api/v2/platform/driver-schemas/promotions/:promotionId/revert` | `platform:schema-promote`。废弃平台 overlay 并将贡献方 overlay 恢复为 `active`。 |

`DriverRegistryParseCoverage` 在已覆盖时含 `scope: "platform" | "organization"` 及可选 `shadowedBy[]`（输给所选层级的低优先级匹配）。

`MappingApplyPreview`：`{ affectedBindings, byProject: [{ projectId, count }], fromModules: [{ moduleId, moduleName, count }], toModuleId, emptiedModules, conflicts }`。

**Binding 模块身份（Phase 2，ADR-0010）：** 每条 `project_parameter_bindings` 行持久化非空 `module_id`，外键指向 `parameter_modules(id)`（迁移 `0067`）；浏览唯一键为 `(project_id, logical_node_id, parameter_spec_id, module_id)`。写路径经单一解析器：**compatible → node-type → 未分类根**——绝不为 null。`module_id` 必须指向**驱动组**或**节点类型单元**（或组织未分类根）；业务分类不接 binding。器件实例身份仅为 **`logical_node_id`**——同一驱动的多个实例共享定义、值由实例区分。binding DTO 暴露 `moduleId`；工作台以其为浏览真相源（不做 derive-on-read）。干净切换，无双读兼容层。

值拆分：`exampleValue` / `schemaDefault` / `policyTarget` / `effectiveValue` 分字段；不得折叠为业务 `recommendedValue`。拓扑载荷携带 API provenance（`sourceChain` / occurrence span）；API 模式下客户端不得发明教学回退数据。

Config Set revision 持久化完整 manifest（`entryFile`、`includeSearchPaths`、overlay 顺序、成员角色）。历史 revision 缺失时从钉住的 `dts_config_revision_members` 回填。`manifestState=needs_review` 对校验、类型化编辑、发布、回写失败关闭，直至修复。校验与客户端须重载该 manifest，禁止硬编码 `includeSearchPaths=["."]`。

Dashboard hotspot（`GET /api/v1/parameters/dashboard/hotspots`）对租户绑定项目须同时包含**全局厂商规格**（`organization_id IS NULL`）与本组织规格。

**迁移 CLI（仅维护窗口）：** `npm run parameter-identities:migrate` 支持 `dry-run`（默认）、`--stage-review`（可运维推断暂存事务）、`--finalize --migration-run-id <id>`（原子活动 FK 写入）。Cutover 仅接受 `finalized` 运行。见 `docs/runbooks/parameter-identity-cutover.md`。

**第四轮证据：** 厂商 dt-schema 在黄金 DTB 上通过真实 `dt-validate`；黄金拓扑计数 **176** 属性 occurrence / 排除结构键后匹配 **120** / seed **684** 行 `dts_properties`（服务端测试锁定）。审核阻断遵守 `blocker_scope`；matcher override 含 locator 指纹。

**第五轮证据（分支 `fix/parameter-topology-round5-review-blockers`）：** base/candidate binding revision 不可变合入回写；缺 `objectStore`/项目/write lock/工具链时语义合并失败关闭；`parameter_identity_migration_phases` 不可变 phase 行与 `migration_run_id` 任务关联；租户作用域 resolve；手工规格 draft→`activate`→resolve；验收辅助 `acceptanceTaskLookup` / `semanticFixtureCleanup`（无 `items[0]` fallback）。

`GET /api/v1/projects/:projectId/config-sets` 只读调用要求 `parameter:view`，供普通用户拓扑工作区加载；Config Set 修改、baseline、export 与 release 仍仅限 Admin。`GET /api/v1/projects/:projectId/parameter-workflow-assignees` 要求 `parameter:edit`，仅返回调用者组织、目标项目、active 且角色匹配的硬件提交人/软件提交人/软件用户；提交 API 会再次校验所选 ID。

`POST /api/v1/parameter-submission-rounds` 使用三种不可混合的 item。遗留扁平提交 `{ parameterId, targetValue, reason }` **仅可在语义 cutover 前使用**。Cutover 后 binding 提交为 `{ draftId, projectParameterBindingId, parameterSpecId, action, targetValue, reason }`（可选 `editSubjectKind: binding`）。节点启用提交为 `{ draftId, editSubjectKind: "node-enablement", logicalNodeId, action, targetValue, reason }`。binding item 不得再发送 `parameterId`；`action` 为 `set|delete`，`set` 要求非空 target，`delete` 要求 `targetValue: ""`。启用与 binding 草稿在共享同一工作 tip 时可同轮提交。服务端锁定用户所属 draft、candidate 与 evidence 行，复核组织/项目/Config Set、binding/spec/action/value/reason 和 write lock，然后原子推进 candidate `draft -> pending_approval`。迁移 `0063` 在返回的 submission item 和 change request 上持久化同一个 `candidateConfigRevisionId`，submit audit 同步记录。Merge 在 history/writeback 前再次锁定并验证 exact `pending_approval` candidate 及 set-value/delete-tombstone proof。身份缺失、状态/value/action proof 已变化，或历史 request 早于 `0063` 时返回 `409`，且不写成功 history/audit。跨项目或 draft 不存在返回 `404`；lock 过期返回 `409`。

**第六轮证据（分支 `fix/parameter-topology-round6-review-blockers`）：** 已覆盖 0058 scope 校正、无损手工身份、global authz、完整 valueShape、租户 cleanup、稳定 `test:all`，以及迁移 `0059`–`0062` 的 exact draft/all-origin invalidation/set-delete 工作流。新增 `0063` 持久化提交后的 candidate identity；提交锁定并推进 candidate，merge 再次复核。可丢弃数据库 acceptance 跑通真实 set/delete 角色链，并断言 request/item candidate ID 与 `pending_approval` 状态。该结果仅为实现验收；TD-042 继续阻断生产 cutover 就绪声明。

切换流程见 `docs/runbooks/parameter-identity-cutover.md`。在干净非客户快照整库演练完成前，**TD-042 仍为 BLOCKER**——第四至第六轮修复均不构成生产 cutover 就绪声明。

## 8. Jobs 与进度

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

## 9. Debugging

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

## 10. Agent (Xiaoze)

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/v1/agent/xiaoze` | AG-UI SSE agent run |
| `POST` | `/api/v1/agent/xiaoze/suggest` | 只读主动建议（opt-in） |
| `GET` | `/api/v1/agent/xiaoze/threads` | 列出持久化 thread |
| `POST` | `/api/v1/agent/xiaoze/threads` | 创建 thread |
| `GET` | `/api/v1/agent/xiaoze/threads/:threadId` | thread 详情 |
| `PATCH` | `/api/v1/agent/xiaoze/threads/:threadId` | 更新 thread 元数据 |
| `DELETE` | `/api/v1/agent/xiaoze/threads/:threadId` | 删除 thread |

小泽 mutating 工具通过 AG-UI interrupt 与 orchestrator approval 链执行；不再暴露 `/api/v1/agent/sessions/*` REST 路由。

工具调用治理：

- `requiresApproval=false` 的读工具仍需权限校验。
- `requiresApproval=true` 的工具只能生成 approval。
- 批准时必须重新校验权限和业务状态。

Agent-specific errors：

- `APPROVAL_REQUIRED`：approval 尚未完成时尝试执行 mutating tool。
- `INVALID_APPROVAL_STATE`：approval 已非 pending。
- `FORBIDDEN`：缺少权限、项目访问或 active user 状态。
- `VALIDATION_FAILED`：请求体、未知 tool 或 payload 校验失败。

## 11. Audit

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
