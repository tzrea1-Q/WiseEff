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
| `POST` | `/api/v1/projects/:projectId/parameter-files/:fileId/sync` | 对当前或指定版本与 DB diff 并 upsert `file_sync` 草稿。返回 `{ item: syncSummary }`。 |
| `GET` | `/api/v1/projects/:projectId/parameter-file-conflicts` | 列出项目内 open 冲突。 |
| `POST` | `/api/v1/projects/:projectId/parameter-file-conflicts/:conflictId/resolve` | 裁决冲突。请求体：`{ "resolution": "file" \| "ui" }`。 |

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
| `GET` | `/api/v1/projects/:projectId/parameter-files/:fileId/versions/:versionId/structure` | 从 `dts_*` 读取某一文件版本的结构化模型（请求内不重解析）。返回 `{ nodes }`；节点含类型化 `properties`（`valueType`/`rawText`/`normalizedValue`）与 `phandleRefs`。需要 `parameter:view`。 |
| `GET` | `/api/v1/projects/:projectId/dts-search` | 在项目当前文件版本的 `dts_*` 上检索。查询：`q`（必填），`by` = `path`\|`address`\|`label`\|`compatible`\|`value`（默认 `path`）。返回 `{ hits }`。需要 `parameter:view`。 |
| `POST` | `/api/v1/projects/:projectId/dts-structured-edits/submit` | 将一条或多条结构化 DTS 属性编辑提交为参数提交轮次。请求体：`{ edits: [{ fileId, nodePath, propertyName, rawText, reason? }], reason?, assignees? }`。按 `source_file_name`/`source_node_path` 映射到 `project_parameter_value`，创建草稿并提交 CR；`targetValue` 使用 `rawText`（非 `normalizedValue`）。返回 `201 { item }`（含 CR 项的提交轮次）。需要 `parameter:edit`；敏感节点规则适用（关键路径需 `parameter:edit-critical`；Agent 写 critical 节点拒绝）。审计：`parameter-structured-edit-submit`。 |

### 变更请求 impact 扩展（P3）

`GET /api/v1/parameter-change-requests`（及相关详情）暴露 `impact[]`，kind 为 `module` \| `test` \| `parameter` \| `phandle` \| `compatible` \| `config-set`。项目值结构化绑定时，服务端附加 phandle / compatible / config-set 对等项；否则保留遗留模板。

敏感节点守卫作用于提交/合入/回写：缺少 `parameter:edit-critical` → `403`；Agent 写 `critical` 规则 → `403` 且 `requireHuman: true`，审计 `parameter-sensitive-node-denied`。

## 配置集、发布基线与校验门禁（P2）

板级配置集把项目下的参数文件聚合为一个可构建单元；发布基线对配置集做快照，支持对比/回滚/发布；校验门禁在基线发布前运行 `dtc`。以下路由均要求 `canAdminParameters`（`admin:access`）；非 Admin 调用返回 `403`。Admin UI 在 P3 提供（`/parameter-admin/projects` 的 `ConfigSetBaselinePanel`）。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/projects/:projectId/config-sets` | 列出项目的配置集。 |
| `POST` | `/api/v1/projects/:projectId/config-sets` | 创建配置集。请求体：`{ name, description?, derivedFromId? }`。返回 `201 { item }`；同项目内 `name` 重复报 `409`。 |
| `POST` | `/api/v1/projects/:projectId/config-sets/:configSetId/files` | 把参数文件加入配置集成员。请求体：`{ fileId, role, sortOrder? }`（`role` 为 `base`\|`overlay`\|`charging`\|`thermal`\|`misc`）。返回 `201 { item }`；文件已属于另一配置集报 `409`。 |
| `DELETE` | `/api/v1/projects/:projectId/config-sets/:configSetId/files/:fileId` | 从配置集移除文件。返回 `200 {}`。 |
| `GET` | `/api/v1/projects/:projectId/config-sets/:configSetId/baselines` | 列出配置集的基线。 |
| `POST` | `/api/v1/projects/:projectId/config-sets/:configSetId/baselines` | 把配置集当前所有成员版本快照为新的 `draft` 基线。请求体：`{ name, notes? }`。返回 `201 { item }`；成员无当前版本或基线重名报 `409`。 |
| `GET` | `/api/v1/projects/:projectId/baselines/:baselineId/compare` | 对比基线钉住的版本与配置集当前版本。返回 `200 { item: { baselineId, members } }`；每个成员为 `unchanged`\|`version_changed`\|`file_added`\|`file_removed`；`version_changed` 的 dts 成员附带节点/属性级、类型感知的 `structuralDiff`。 |
| `POST` | `/api/v1/projects/:projectId/baselines/:baselineId/rollback` | 原子地把每个已漂移成员指回钉住版本（不删历史；漂移成员会得到一个新的 `origin=rollback` 版本）。返回 `200 { item: { baselineId, restored } }`。 |
| `POST` | `/api/v1/projects/:projectId/baselines/:baselineId/release` | 对当前成员内容运行校验门禁，门禁放行后把基线标记 `released`。返回 `200 { item: baseline, gate }`。**门禁阻断 → `409`**，`error.details = { code: 'dts-validation-failed', diagnostics, mode, compiler }`。 |
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

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/v2/parameter-specs` | 列出版本化参数规格 |
| `GET` | `/api/v2/parameter-specs/:specId` | 规格详情（example/default/policy 分字段） |
| `GET` | `/api/v2/parameter-spec-review-tasks` | 组织范围、分页、按状态筛选的规格审核队列（`?status=&limit=&cursor=`） |
| `POST` | `/api/v2/parameter-specs/:specId/activate` | Admin 激活本组织 **draft** 规格（`valueShape`、`constraints`、`documentation`、`reason`）。仅 `lifecycle=draft`；形状不完整或不支持 → `409`。审计：`parameter-topology-governance` / `spec-activated`。 |
| `POST` | `/api/v2/parameter-spec-review-tasks/:taskId/resolve` | Admin 决议规格审核（`parameterSpecId` 须为本组织或全局，**或** 未匹配任务使用 `createSpec: true`）。服务端经租户作用域 join 校验 project/revision/occurrence/logical node 证据后应用决议——不得单独信任 raw evidence ID。`createSpec: true` 创建本组织 **draft** 规格（从 occurrence AST 推断类型）并返回 `draftCreated` 与须先激活的提示。仅 **active** 且约束完整的规格可 resolve/release。`resolved` 在同一事务中应用 occurrence→spec→binding 并持久化可复用 matcher override（作用域：`compatible` + **节点 locator 指纹** + 属性键）。库内决议若属性键与 occurrence 不一致，须显式 `confirmPropertyMismatch: true`，否则服务端拒绝。`dismissed` 失败关闭：不创建 binding，发布/校验仍阻断被 dismiss 的属性。审计：`parameter-topology-governance` / `spec-review-resolved`。 |
| `GET` | `/api/v2/projects/:projectId/config-sets/:configSetId/revisions/:revisionId/topology` | 源树或生效树（`?view=source\|effective`） |
| `GET` | `/api/v2/projects/:projectId/parameter-bindings` | 稳定项目绑定 |
| `GET` | `/api/v2/identity-mapping-tasks` | 身份映射任务列表 |
| `POST` | `/api/v2/identity-mapping-tasks/:taskId/resolve` | Admin 决议映射 |
| `POST` | `/api/v2/projects/:projectId/config-revisions/:revisionId/validate` | 失败关闭工具链校验。再次校验失败会**撤销**此前的 `validated` 标记；开放身份映射或被 dismiss 且未匹配的规格审核保持 fail-closed。 |
| `POST` | `/api/v2/projects/:projectId/parameter-bindings/:bindingId/drafts` | 类型化绑定草稿 + **精确 occurrence** Config Set 回写：锁定 binding revision、occurrence、文件版本、checksum 与 CST span（默认强制 schema；**base** binding revision 不可变；合入值在 **candidate** revision）。身份过期 → `409`。Cutover 后语义合并在缺 `objectStore`、项目范围、write lock 或真实 DTC 工具链时失败关闭——生产路径无 `WISEEFF_WRITEBACK_SKIP_TOOLCHAIN`。Cutover 后草稿不得再创建 shadow `project_parameter_values` / `parameter_definitions`。 |

值拆分：`exampleValue` / `schemaDefault` / `policyTarget` / `effectiveValue` 分字段；不得折叠为业务 `recommendedValue`。拓扑载荷携带 API provenance（`sourceChain` / occurrence span）；API 模式下客户端不得发明教学回退数据。

Config Set revision 持久化完整 manifest（`entryFile`、`includeSearchPaths`、overlay 顺序、成员角色）。历史 revision 缺失时从钉住的 `dts_config_revision_members` 回填。`manifestState=needs_review` 对校验、类型化编辑、发布、回写失败关闭，直至修复。校验与客户端须重载该 manifest，禁止硬编码 `includeSearchPaths=["."]`。

Dashboard hotspot（`GET /api/v1/parameters/dashboard/hotspots`）对租户绑定项目须同时包含**全局厂商规格**（`organization_id IS NULL`）与本组织规格。

**迁移 CLI（仅维护窗口）：** `npm run parameter-identities:migrate` 支持 `dry-run`（默认）、`--stage-review`（可运维推断暂存事务）、`--finalize --migration-run-id <id>`（原子活动 FK 写入）。Cutover 仅接受 `finalized` 运行。见 `docs/runbooks/parameter-identity-cutover.md`。

**第四轮证据：** 厂商 dt-schema 在黄金 DTB 上通过真实 `dt-validate`；黄金拓扑计数 **173** 属性 occurrence / **519** 行 seed `dts_properties`（服务端测试锁定）。审核阻断遵守 `blocker_scope`；matcher override 含 locator 指纹。

**第五轮证据（分支 `fix/parameter-topology-round5-review-blockers`）：** base/candidate binding revision 不可变合入回写；缺 `objectStore`/项目/write lock/工具链时语义合并失败关闭；`parameter_identity_migration_phases` 不可变 phase 行与 `migration_run_id` 任务关联；租户作用域 resolve；手工规格 draft→`activate`→resolve；验收辅助 `acceptanceTaskLookup` / `semanticFixtureCleanup`（无 `items[0]` fallback）。

切换流程见 `docs/runbooks/parameter-identity-cutover.md`。在干净非客户快照整库演练完成前，**TD-042 仍为 BLOCKER**——第四轮与第五轮修复均不构成生产 cutover 就绪声明。

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
