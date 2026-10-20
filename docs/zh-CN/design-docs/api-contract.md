# WiseEff API 合同设计

> English: [English](../../design-docs/api-contract.md)

日期：2026-05-25

## 1. API 原则

正式 API 采用 REST + JSON。前端通过 `application/ports` 和 `infrastructure/http` 中的 API client、DTO 映射访问后端。

原则：

- API 使用 `/api/v1` 及文档定义的 `/api/v2` 路由族；规范参数目录使用 `/api/v2/catalog/*` 与组织治理路径。S8-CON 冻结 PCAT-API-01 到 PCAT-API-12 的 OpenAPI、DTO、路由、错误与客户端合同；在源码基线 `67d4a77325b6009b77c2373bd788298a6d022bcf`，`server/app.ts` 已通过 `server/modules/parameter-catalog-api/productionWire.ts` 注册读取、治理及 legacy handler。运行时就绪仍依赖已安装版本和必需的数据库及内部能力。详见 [parameter-catalog-api-transition.md](parameter-catalog-api-transition.md)。
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

M2 日志与 M3 调试运行时/catalog API 以认证用户的 `organization_id` 为边界。新日志关联必须提供 `relatedParameterPin: { kind: "canonical-pin", projectId, bindingId, definitionId?, definitionRevisionId? }`；服务端鉴权该精确项目 Binding，并为每次分析冻结 canonical Value、DefinitionRevision 与来源 pin。重新分析再次解析当前 Binding；旧 run 快照及报告保留为历史。新上传不能只传 `relatedParameterId`，存量缺少已验证项目范围的软链接不得当作当前值。无关联日志上传与调试 API 不接受顶层 `projectId` 字段。

`GET /api/v1/debugging/parameters?protocol=adb` 返回 enabled、未 archived 且所选协议 binding 启用的组织 catalog 行。鉴权仅使用组织级调试权限。

当请求提供 `parameterId` 时，读写节点 API 会从 `debugging_parameter_node_bindings` 解析对应协议的 `nodePath`。Catalog 参数请求不需要发送原始 node path。

普通 `POST /api/v1/debugging/nodes/write` 响应与 `node_operations` 使用两个独立结果：`writeOutcome` 为 `executed | failed | unknown`，`readbackOutcome` 为 `observed | failed | unsupported | not_requested | unknown`。回读成功只是观测证据，服务端不把其字符串表示与请求值比较。`targetValue` 保留请求值，`currentValue` 仅在成功观测后更新；回读技术失败保留旧当前值。`verified` 与 operation 状态 `readback_mismatch` 为可空、废弃的历史证据，新普通写入不再产生 mismatch。`POST /api/v1/debugging/nodes/read` 可带 `relatedOperationId`，把一次只读重试关联到同会话、同节点的写操作。RW 写入仍要求写前快照；WO 写入被拒绝。快照回滚有意保留严格比较语义。

### 调试管理 Catalog

`/api/v1/debugging/admin/*` 专用于 Admin catalog governance，要求 `debugging:admin` 权限。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/debugging/admin/nodes` | 查询逻辑调试节点；`includeArchived=true` 时包含 disabled 或 archived 行，可按 `moduleId` 子树筛选。 |
| `POST` | `/api/v1/debugging/admin/nodes` | 创建逻辑调试节点和可选 HDC/ADB bindings。 |
| `PATCH` | `/api/v1/debugging/admin/nodes/:nodeId` | 更新逻辑节点 metadata。 |
| `DELETE` | `/api/v1/debugging/admin/nodes/:nodeId` | 在同一事务永久删除启用或禁用节点、其全部 `node_operations`、对应 operation event、不再共享的 snapshot 与 HDC/ADB binding；共享 session/snapshot、无关 operation 和审计证据保留。成功返回 `204`。 |
| `PUT` / `PATCH` | `/api/v1/debugging/admin/nodes/:nodeId/bindings/:protocol` | Upsert 或更新 HDC/ADB 节点 binding。 |
| `POST` | `/api/v1/debugging/admin/nodes/:nodeId/bindings/:protocol/archive` | 禁用单个 protocol binding，不影响节点及另一协议。 |
| `GET` | `/api/v1/debugging/admin/catalog/export` | 导出本组织**全部**调试节点目录（所有模块、所有已持久化节点（含归档/禁用/无绑定）、所有 binding）为 `wiseeff.debug-node-catalog.v2`。响应的 `item` 含 `document`、`counts`（`modules`/`nodes`/`bindings`）、`organizationId` 与 `fileBytes`；文档内 `counts` 始终与对象集合一致。导出结果不受搜索、模块、协议、分页或树展开状态影响。要求 `debugging:admin`。写入 `debug-node-catalog-export` 审计（仅计数、字节数与格式，不含原始 node path）。超过 20 MiB 文件容量约定时整次导出返回 `413 PAYLOAD_TOO_LARGE`，不产出截断文件。 |
| `POST` | `/api/v1/debugging/admin/catalog/import-preview` | 只读服务端预览 v1 或 v2 目录文档：把每个模块、节点、binding 分类为 `created`/`updated`/`unchanged`，返回阻断 `conflicts`、`warnings`、逐对象字段差异与 `previewDigest`。不写节点库、不写导入审计。要求 `debugging:admin`。格式、字段或引用错误返回 `400 VALIDATION_FAILED` 并带对象/数组/字段定位；超过 20 MiB 返回 `413`。 |
| `POST` | `/api/v1/debugging/admin/catalog/import` | 原子合并导入已预览的目录文档。请求体为 `{ document, previewDigest }`；`import-preview` 返回的摘要为必填，原始文档无法绕过预览（`400 VALIDATION_FAILED`），文件或目标在预览后变化返回 `409 CONFLICT` 且 `details.reason: "stale-preview"`。匹配顺序为源节点 ID 优先，其次唯一「完整模块名称路径 + 节点名称」；模块按完整路径匹配，binding 按目标节点 + 协议匹配。缺失节点新增，唯一匹配节点原地更新（保留目标 ID 与历史引用），目标端独有模块、节点与 binding 永不删除或覆盖；已有目标的归档状态保持不变。所有模块、节点、binding 与 `debug-node-catalog-import` 审计在同一事务提交，中途失败全部回滚。要求 `debugging:admin`。 |

遗留 `/api/v1/debugging/admin/parameters*` 已退役并返回 `404`，不再出现在 route manifest、OpenAPI 或前端 Admin client 中。这里只移除无人使用的治理接口；`debugging_parameters`、`debugging_parameter_node_bindings`、repository/service、历史行、binding、operation 与审计证据继续保留，用于历史解释和迁移。

运行时 `/api/v1/debugging/parameters?protocol=...` 与上述 Admin 接口分开保留，只返回启用、未归档且所选协议 binding 启用的 legacy 参数。产品 `/node-debugging` 使用逻辑节点运行时接口。

Legacy 运行时调试参数 DTO 包含可选值元数据：

- `valueKind`：`scalar | complex`（legacy 行默认为 `scalar`）
- `valueFormat`：`raw | json | dts | line-list | kv-list`
- `normalizationMode`：`exact | trim | line-ending-normalized | json-canonical`
- `maxValueBytes`：正整数，用于限制写入 payload 大小

节点写入请求仍使用 `value: string`；服务层根据已存 metadata 解析格式、规范化、digest、preview 和比较规则。

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

保留的 v1 列表仅投影当前账号有权读取的当前 canonical Binding（`pbind_` 身份），不再镜像旧参数规格或值。外壳项目发现（`GET /api/v1/projects`）排除归档项目，并采用受保护 Binding 读取器的项目范围：组织级角色可见该组织全部未归档项目，项目级角色仅可见其授权的未归档项目。管理后台项目列表保留归档项目，供管理和恢复。应用外壳直接读取 `GET /api/v2/projects/:projectId/parameter-bindings`；可选的历史标识读取失败不得阻塞外壳加载。旧 `?parameter=` 链接只能经精确类型映射进入可读 Binding 的所属项目；不可读或仅指向历史证据的目标明确展示为历史引用。

调试管理 catalog 表补充：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/debugging/admin/modules` | 列出调试节点模块树。 |
| `POST` | `/api/v1/debugging/admin/modules` | 创建调试模块。 |
| `PATCH` | `/api/v1/debugging/admin/modules/:moduleId` | 更新调试模块。 |
| `POST` | `/api/v1/debugging/admin/modules/:moduleId/move` | 移动调试模块（循环 → `409`）。 |
| `DELETE` | `/api/v1/debugging/admin/modules/:moduleId` | 删除空模块（否则 `409`）；仅按旧模块名称赋值的节点也计为引用。 |

`GET /api/v1/debugging/admin/nodes` 支持 `moduleId` 与 `includeDescendants` 子树筛选。

## DTS 重载调试

独立模块 `/api/v1/dts-reload/*`（勿与已退役的 `/api/v1/debugging/reload-targets` / `.../parameters/reload` 的 `410` 面混淆）。

ADR-0038 为敏感写定义服务端内部可信调用上下文，#610 已实现共享构造器及策略/审计 seam。客户端不能发送或覆盖 `user` / `agent` / `system` initiator。human-required 路由只接受由服务端构造的 `user`；已批准的 Agent 调用仍是 Agent initiator，system 无人值守调用也默认拒绝。缺失上下文时在写入前按内部不变量失败；上下文有效但 initiator 不允许时返回稳定 `403` 并保留拒绝证据。生产入口重建以及 DTS 重载五条写路径与全部参数敏感生产路径的迁移仍由 #611–#615 负责；这些迁移完成前，legacy `actorType` 传递仍不可信。

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/v1/dts-reload/projects/:projectId/candidates` | `debugging:view` 或 `debugging:dts-reload` | 项目候选参数（可调试性、sensitiveMatch、lastReload）。每个候选同时返回目录原始 `valueShapeKind`（仅展示）与服务端解析的 `resolvedValueShape`（归一化的重载值形态词汇，或 null）；客户端的录入校验、占位符与示例一律以 `resolvedValueShape` 为准，绝不使用目录原始 kind——解析需要 DTS 解析器与库基线。具备非空绝对 `nodePath`、支持的重载值形态与库基线即可调试（含单段 `/label`，不再有 synthesised-anchor 路径形状拒绝）。presence 形态（`boolean` / `empty`）允许空 RHS 基线。已支持形态含 u32/u8/u16 cell（含 `/bits/ 8`）、目录 `string` 单字符串（如 `replace_sensor`）、`string-list`、GPIO 风格 `phandle-cells`、裸 phandle 列表（`<&gic>` → `phandle-list`）、布尔、空属性、mixed 字符串+cell。显式 `/delete-property/` 是 overlay 动词，从不由空 cell/字符串推断。 |
| `POST` | `/api/v1/dts-reload/projects/:projectId/runs` | `debugging:dts-reload` | 启动运行（批量 targets；critical 可能需 `confirm-sensitive-reload`） |
| `POST` | `/api/v1/dts-reload/runs/:runId/deploy` | `debugging:dts-reload` | 进程内桥接部署；需 `confirm-dts-reload` |
| `GET` | `/api/v1/dts-reload/runs` / `.../:runId` | 查看路径 | 历史与含重载快照的详情 |
| `GET` | `/api/v1/dts-reload/residue` | 查看路径 | 设备残留记账 |
| `POST` | `/api/v1/dts-reload/projects/:projectId/restore-baseline` | `debugging:dts-reload` | 启动恢复基线运行 |
| `POST` | `/api/v1/dts-reload/runs/:runId/promote-to-drafts` | 重载读取门加 `parameter:edit`，并具备 `debugging:dts-reload` 或 `admin:access`。human-required：TD-068 完成后，可信 initiator 必须为 `user`；Agent 与 system 均拒绝。 | 把所选已存调试值经 `createBindingDraft` 写成 `parameter_drafts` 后停止。Body `{ bindingIds, unverifiableAcknowledged? }`。普通 `verified` 运行，或带 `unverifiableAcknowledged: true` 的普通 `unverifiable` 运行。**不**创建变更请求、不自动提交、不把调试值写进 binding。返回草稿 id 与 `/parameters?project=` 工作台深链。里程碑审计 `reload-value-promoted-to-draft`。 |
| `*` | `/api/v1/dts-reload/configuration` | `debugging:admin` | 组织级重载配置默认值 |

请求/响应 schema 以已提交的 OpenAPI（`docs/generated/openapi.json`）为准。

## 3. Auth 与用户

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/me` | 当前用户、组织、角色和权限 |
| `GET` | `/api/v1/organization` | 本组织档案（`id`、`name`、`createdAt`）；任意已启用已认证成员 |
| `PATCH` | `/api/v1/organization` | 仅 `{ name }`；需要 `users:manage`；同一事务写 `organization-update` |
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
| `GET` | `/api/v1/parameters/dashboard/hotspots` | 参数热榜；查询参数 `window`（默认 `30d`）、`dimension`（`project` \| `module` \| `parameter`，默认 `project`）、可选 `projectId` |

`parse-dts` 返回行含 `name`、`module`、`sourceNodePath`、`rawText`、`normalizedValue`、`valueType`；身份语义与服务端 `nodePathToParameterIdentity` 对齐。默认内容上限 2MB。完整字段示例见英文版 `docs/design-docs/api-contract.md` § Parameter Import。

`/parameter-home` 前端通过 `ParameterDashboardRepository` 消费上述只读聚合接口。project、module、parameter 三种热榜行共用同一份行为评分合同：

```json
{
  "frequency": 30,
  "scope": 40,
  "workflow": 25,
  "collaboration": 15
}
```

- `frequency`：所选窗口内的参数历史活动与变更请求。
- `scope`：project/module 行统计已修改参数实例；parameter 行统计已修改该定义的项目。
- `workflow`：窗口内请求、开放请求与打回工作。
- `collaboration`：窗口内及全周期的不同贡献者。

`score` 是上述四维服务端确定性得分的舍入总和。前端只展示服务端返回的 score、evidence、trend 与 deep link，不重算排序或业务聚合。生成 OpenAPI 的 `ParameterDashboardHotspotsResponse` 固定为这四个键，不再接受已退役的 `risk` / `impact` / `drift` breakdown。

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

### 解码事件与内部工具

`skill/v1` 新增可选 `parsing: {schemaVersion: "parsing/v1", extractors}`，保存、发布和回滚均校验，错误为带路径的 `400`。严格规范、时间格式子集、上限和事件外壳见[解析参考](log-parsing-v1.md)。worker 只使用钉住版本，有抽取器的运行在解析完成后按当前任务租约保护写入迁移 0190 的产物键及 `{total, byExtractor, errors}`，provider 重试时仍保留；无抽取器保持旧行为。

证据新增可选 `decodedFields: DecodedEvent[]`，落库至 `log_evidence.decoded_fields`。事件自带 `v`、`source`、`extractor`、`file`、`line`、可选 `endLine`、`fields` 和错误，只补充精确文件/首行锚点被引用的事件。转换值保留 raw 和类型值，枚举显示标签。寄存器节点另含嵌套 `fields`、可选枚举含义 `meaning` 和单位 `unit`，父节点仍保留原始寄存器值；不安全整数使用十进制字符串。帧/寄存器构件最多嵌套 8 层，输出树允许最多 25 层结构以容纳 TLV 外壳及寄存器叶节点。报告在引用行下展示此树。循环、单次 LLM 和规则报告共用补充逻辑；Webhook 仍只发送摘要。

`parsing` 还接受可选 `registers: Record<id, {width: 8|16|32|64, fields: {bits: [hi,lo], name, enum?, scale?, offset?, unit?, signed?, description?}[]}>` 和 `registerMaps: Record<id, {selectBy, cases: Record<地址或消息id, registerId>, default?}>`。抽取器的 `int`/`uint`/`hex` 字段配置 `decode: {register: id}` 或 `decode: {registerMap: id}`。保存、发布及既有未保存草稿预览均校验位重叠、越界、重名和引用，返回精确路径。映射无匹配分支或默认项时，事件记录 `unmatched_register`，不使运行失败。寄存器工作共享既有执行预算。参见 [BQ25890 示例与数值规则](log-parsing-v1.md#寄存器与寄存器映射)。

以下是 ADR-0022 内部只读工具，不是 HTTP 端点，仅在钉住版本有抽取器时注册，沿用步数和 token 预算。

| 工具 | 契约 |
| --- | --- |
| `describe_event_schema({})` | 返回 `{extractors: [{id, fields: Record<name, FieldSpec>, count}], counts}`，包括零事件抽取器的字段名称和类型。元数据不代表已观察行。 |
| `query_events({extractor, file?, where?, limit?, cursor?})` | 返回 `{events: DecodedEvent[], nextCursor: string \| null}`。抽取器和可选文件精确匹配，limit 默认/最多 50。where 为 AND 条件列表 `{field, op: eq\|ne\|lt\|lte\|gt\|gte\|in, value}`，等值按类型值、枚举标签或 bytes 的 `{hex,length}` 比较；大小比较支持数字和字符串（时间使用规范化 UTC ISO 值），in 使用数组。缺失或失败字段不匹配；未知字段/抽取器、错误游标均拒绝。后续请求沿确定性运行事件顺序使用返回的续页字符串。 |

grounding 只认可 query 工具自身 `events[].file/line`。endLine 范围、字段内嵌引用、结构元数据和非白名单工具返回的引用不能建立观察记录。

`parsing` 还接受 `frames: Record<id, {endian?: "big" | "little", fields: FrameField[]}>`。有序具名字段支持 `uint`/`int`、固定或先前字段决定长度的 `bytes`、嵌套 `register`/`frame`、按先前解码值选择的 `switch`、使用常量或先前字段计数且可乘固定倍数的 `repeat`，以及配置 tag/length 宽度和已知 tag 引用的 TLV。switch/TLV 数字键沿用寄存器映射的归一化规则，未知 TLV tag 保留原始字节。抽取器十六进制/字节字段使用 `decode: {frame: id}`，包括 `hexbytes`、`base64bytes` 及十六进制 `bytes` 别名。帧十六进制输入支持空白和可选 `0x`。[帧规范与 USB-PD 示例](log-parsing-v1.md#字节布局帧)定义封闭的字段结构和路径查找规则。

帧校验和支持 `sum8`、`xor8`、`crc8`（多项式 `0x07`）、`crc16-ccitt`（`0x1021`，初值 `0xFFFF`）、`crc16-modbus`（反射形式 `0x8005`，初值 `0xFFFF`）及 IEEE `crc32`。校验字段声明相对所在帧的半开区间 `range: [start, endExclusive]`、存储字节数及字节序，覆盖范围不得包含该字段自身存储校验和的字节或与其他校验范围重叠。解码节点在既有 raw/value/meaning/unit/fields 树外增加 `byteOffset`、`byteLength` 和可选 `checksum: {expected, actual, ok}`。`checksum_mismatch` 是事件错误，保留节点并继续分析。

帧/寄存器合计最多嵌套 8 层，单帧输入最多 4096 字节，每个 repeat 乘倍数后最多 256 项，单事件解码元素合计最多 1024，每个 TLV 字段最多 256 项。输出共享单事件 1024 字段/32 KiB、单运行 32,768 字段/4 MiB 和时间预算。保存、发布及未保存草稿预览拒绝未知引用、循环、向前路径、无效长度和重叠校验范围，返回精确路径；运行时超限记录具体事件错误。无需迁移或新增端点；嵌套帧字段沿用报告证据与解码事件工具及其既有响应上限。

`query_events` 还返回 `truncated: boolean`。含外壳的序列化响应最多 16 KiB，每个字段值（包含嵌套寄存器/帧树）最多 1 KiB；限额内完整返回子字段与含义，超长值转为带标记的字符串预览，单事件字段过多时可省略尾部字段。筛选使用原始值，存储证据不变。事件数仍最多 50，达到字节或数量上限时，`nextCursor` 从首个未返回事件继续。

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
GET  /api/v1/logs/feedback-insights
GET  /api/v1/log-skills
GET  /api/v1/log-skill-templates
GET  /api/v1/log-skills/:skillId/sample
PUT  /api/v1/log-skills/:skillId/sample
DELETE /api/v1/log-skills/:skillId/sample
GET  /api/v1/log-skills/:skillId
POST /api/v1/log-skills/:skillId/parse-preview
POST /api/v1/log-skills
PUT  /api/v1/log-skills/:skillId/draft
DELETE /api/v1/log-skills/:skillId/draft?draftRevisionId=:revisionId
POST /api/v1/log-skills/:skillId/revisions/:revisionId/restore
POST /api/v1/log-skills/:skillId/publish
GET  /api/v1/log-skills/:skillId/revisions
GET  /api/v1/log-skills/:skillId/revisions/:revisionId
GET  /api/v1/log-domains
POST /api/v1/log-domains
PATCH /api/v1/log-domains/:domainId
POST /api/v1/log-domains/:domainId/archive
GET  /api/v1/log-domains/:domainId/knowledge-links
PUT  /api/v1/log-domains/:domainId/knowledge-links
PUT  /api/v1/log-domains/:domainId/webhook
GET  /api/v1/log-domains/:domainId/webhook-deliveries
POST /api/v1/log-domains/:domainId/webhook-test
GET  /api/v1/jobs/:jobId
GET  /api/v1/jobs/:jobId/events
```

三个编写预览 POST 接口（`parse-preview`、`extractor-preview`、`format-preview`）在 JSON 解析和鉴权前共用 16 MiB HTTP 请求体上限，含重复斜杠和尾斜杠别名。超出返回 `413 PAYLOAD_TOO_LARGE`；解析后仍执行下表更小的样例及模式上限。

所有管理员模式均经过共享编译器的编译前展开量检查，以及编译后的 RE2 `programSize()` 检查：计数重复上下界最多 100，单模式最多 16,384 条指令，每份规范/请求缓存的保守总预算为 65,536 条指令。程序超限返回 `400 VALIDATION_FAILED` 并定位到对应字段。格式预览和抽取器预览会在单次请求内复用已编译模式。

保守预算还在编译前计入模式源码的解析工作量，包括密集 Unicode 字符类。格式预览和抽取器预览有 100 ms 执行看门狗，超时返回 `400 VALIDATION_FAILED`，不返回不完整预览。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/log-skills` | `{ items }`：技能身份、`currentRevision: { id, number, publishedAt }`、`hasDraft`、`analyses7d`（近七天创建的运行数）、`helpfulRate7d`（0..1，无反馈为 null；归因语义同反馈洞察）。`includeArchived=true` 包含归档技能。 |
| `GET` | `/api/v1/log-skills/:skillId` | `{ item }`：技能身份、完整 `currentRevision` 与可空 `draft`。 |
| `GET` | `/api/v1/log-skill-templates` | 需 `logs:admin-domains`。返回 `{ items: [{ id, label, description, spec }] }`，包含 `generic-text`、`linux-dmesg`、`android-logcat`、`json-lines`，分别预填流程大纲、基础格式和信号规则。JSON Lines 使用通用画像与 JSON level 字段信号。 |
| `POST` | `/api/v1/log-skills` | `{ name, description?, startingPoint?: { templateId } \| { copyFromSkillId }, formatProfile? }` 创建身份与已发布版本 1，返回 `201 { item }`。复制优先取来源草稿，否则取当前发布版；不复制样例。跨组织来源返回 `404`。省略起点时使用通用模板，旧 `formatProfile` 请求仍有效并优先使用该画像。显式描述覆盖起点 spec 的描述。审计元数据记录 `templateId` 或 `copyFromSkillId`。 |
| `PUT` | `/api/v1/log-skills/:skillId/sample` | 需 `logs:admin-domains`。`{ fileName, contentBase64 }` 替换技能不版本化的文本或日志包样例。原始上传与展开后的解码文本均最多 2 MiB，同时受配置的日志包上限及压缩包安全检查约束。复用 bundle intake 的 UTF-8／带 BOM 的 UTF-16 检测。返回 `{ item: metadata }`，同事务写入 `log-skill-sample-replace` 审计。对象名称独立；替换后保留旧对象。 |
| `GET` | `/api/v1/log-skills/:skillId/sample` | 需 `logs:view`。返回 `{ item: metadata & { content, contentFilePath, truncated, files } \| null }`；无样例为 null，技能不可访问为 `404`。`files` 每项为 `{path, sizeBytes, lineCount, status, skipReason, encoding, lossy, content?, truncated?}`。正文统一 LF，每个文件最多前 5000 行；顶层正文取第一个可分析文件。旧单文本样例返回一条清单记录。元数据包含 `id`、`skillId`、`fileName`、原始 `sizeBytes`、`sha256`、`encoding`、`lineCount`、可空 `uploadedByUserId`、`createdAt`、`updatedAt`，不暴露存储键。 |
| `DELETE` | `/api/v1/log-skills/:skillId/sample` | 需 `logs:admin-domains`，按组织隔离，幂等返回 `204`；同事务写入 `log-skill-sample-delete`，保留对象与技能版本。 |
| `PUT` | `/api/v1/log-skills/:skillId/draft` | `{ spec: { schemaVersion: "skill/v1", description?, files?, formatProfile?, modelOverride?, signalRules?, parsing?, procedure?, knowledgeEntryIds? }, baseDraftRevisionId: string \| null, basePublishedRevisionId: string }` 替换草稿，返回 `{ item: revision }`，每次保存产生新的草稿 id。两个基础字段均必填：编辑开始时的草稿 id（没有草稿时为 null）和已发布版本 id；技能锁内任一版本检查不一致时返回 `409 LOG_SKILL_DRAFT_CONFLICT`。`description` 可选、去除首尾空白、最多 2000 字符，不升级 schemaVersion。发布或回滚时省略描述会保留身份行原值，显式空字符串才会清空。钉住技能省略信号规则时使用通用信号，未分类上传保留旧充电预筛。 |
| `POST` | `/api/v1/log-skills/:skillId/parse-preview` | 需 `logs:admin-domains`，按组织查找技能。请求 `{parsing, sampleText, fileName?}` 校验未保存的 `parsing/v1`；响应 `{valid, issues: [{path, message}], events, counts: {total, byExtractor, errors}, unmatchedLineCount, truncated, reason?}`。规范错误为 `200`、`valid: false` 和问题路径；样例超过 UTF-8 1 MiB 或请求体错误为 `400`。固定 100 ms 校验/解码硬超时、最多处理 5000 行及返回 500 事件，受限时返回部分结果及 `truncated: true`、`reason: time_cap \| line_cap \| event_cap`；计数描述已完成工作，未处理行计入未匹配。校验超时返回 `valid: false`、问题及相同时间上限标记。跨组织或不存在为 `404`，无权限为 `403`。只读，不写审计，不存样例。 |
| `POST` | `/api/v1/log-skills/:skillId/extractor-preview` | 需 `logs:admin-domains`，按组织查找技能。请求 `{line, segments: [{start, end, name, type}], sampleLines, generalizeNumbers?, timestampPattern?, pattern?}`；片段为互不重叠的 UTF-16 左闭右开区间，类型为 `int`、`uint`、`hex`、`float`、`string`、`quoted`。生成首尾锚定的 RE2 模式，转义字面量并泛化空白；`generalizeNumbers` 默认开启，同时泛化标识符之外的十进制数字串；false 保留数字字面量。开启时，可选 `timestampPattern`（最多 4096 UTF-16 单元）识别非空行首时间戳区域；未提供则识别方括号中的 dmesg 数字时间戳。该区域和随后空白作为可选非捕获前缀，消息内容仍保持首尾锚定。引号保留在捕获组外，quoted 字段映射为 string。可选 `pattern` 改为校验高级模式，此时允许空片段列表，未映射的命名组默认 string。返回 `{pattern, fields, matchedLines: [{line, text}], matchCount, totalLines, coverage}`；仅返回前五个命中行；行号从 1 开始，保留中间空行的原始行号；末尾空行不计入命中数和 totalLines。coverage 为比例，空样例为 0。上限为 32 片段/捕获组、500 样例行、每行 6144 UTF-16 单元、源行与样例合计 UTF-8 1 MiB、模式 512 单元。非法输入、RE2 不支持或超限返回 `400 VALIDATION_FAILED`；跨组织或不存在为 `404`，无权限为 `403`。只读，保存沿用草稿接口。 |
| `POST` | `/api/v1/log-skills/:skillId/format-preview` | 同上，要求管理员权限和组织隔离。请求 `{sampleText, formatProfile}` 使用原有格式画像 schema 和 RE2 校验；复用运行时解析器返回 `{lines: [{line, text, timestamp?, severity}], entries: [{lineNumbers, text, timestamp?, severity}]}`。逐行标注仅关闭多行合并；条目保留原有合并及去除时间戳的语义，并携带原始非空行号。最多 500 行、每行 6144 UTF-16 单元、UTF-8 1 MiB。画像、模式非法或超限返回 `400 VALIDATION_FAILED`；跨组织或不存在为 `404`，无权限为 `403`。只读，不存样例，不写审计。 |
| `DELETE` | `/api/v1/log-skills/:skillId/draft?draftRevisionId=:revisionId` | 必填查询参数 `draftRevisionId` 是编辑器看到的草稿 id。技能锁内若现有草稿 id 不同，返回 `409 LOG_SKILL_DRAFT_CONFLICT`；草稿匹配或已不存在时幂等返回 `204`。成功时写入 `log-skill-draft-discard` 审计，包括草稿已不存在的情况。 |
| `POST` | `/api/v1/log-skills/:skillId/publish` | `{ draftRevisionId }` 原子发布草稿并将前版置为 superseded；草稿缺失或过期返回 `409 LOG_SKILL_DRAFT_CONFLICT`；同步身份行的描述、基础格式和模型覆盖；成功返回 `{ item: skill }`。 |
| `POST` | `/api/v1/log-skills/:skillId/revisions/:revisionId/restore` | 将所选历史 spec 发布为下一编号的新版本，不改写历史内容；返回 `{ item: skill }`。技能锁内若存在草稿则返回 `409 LOG_SKILL_DRAFT_EXISTS`；来源不存在、跨组织或为草稿则返回 `404`。同一发布事务写入 `log-skill-restore`，元数据 `{ fromRevisionId, newRevisionId }`。 |
| `GET` | `/api/v1/log-skills/:skillId/revisions` | `{ items: revision[] }`，版本号倒序。 |
| `GET` | `/api/v1/log-skills/:skillId/revisions/:revisionId` | `{ item: revision }`：`id`、`skillId`、`number`、`status`、`spec`、`contentHash`、创建和发布时间及用户。已发布/已替代版本内容不可变。账号删除时按既有历史保留策略清空作者/发布者引用，spec、哈希与发布事实不变。 |

`skill/v1` 增加可选 `procedure`：Markdown，去除首尾空白，最多 20000 字符，无版本升级。版本差异在「概览」组显示流程内容。

### 适用文件与角色

`skill/v1.files` 可选：`[{glob: string, role?: string}]`，按匹配顺序排列。省略或 `[]` 表示技能适用于所有文件。最多 100 项，非空通配最多 256 字符，角色最多 40 字符。非法项返回 `files.0.glob` 等稳定问题路径。匹配区分大小写，针对使用 `/` 的包内相对路径，支持 `*`、`**`、`?` 和字符类；绝对路径及路径穿越通配非法。第一个匹配项决定可选角色，即使未填角色也不会被后续匹配覆盖。见[匹配参考](log-parsing-v1.md#技能适用文件与角色)。

`POST /api/v1/log-skills/:skillId/files/preview` 需要 `logs:admin-domains` 与 `logs:view`。接受 `{files?: [{glob, role?}]}`，返回 `{valid, issues: [{path: (string | number)[], message}], files: [{path, skillMatched, role}]}`。使用技能已存样例清单预览未保存通配，与客户端及 Worker 复用同一匹配器。非法通配返回 `200`、`valid: false`、问题路径及空文件列表。没有样例时返回空清单。预览按组织隔离，只读且不保存草稿。

预览请求体上限为 181,824 字节，覆盖最大配置的 JSON 转义与少量封装余量；超限在解析或认证前返回 `413`。整批数量与所有字符串长度通过检查后才会编译通配。校验、编译和匹配共用 100 ms 执行时限，预览最多接受 2,000 个样例路径。任一执行上限被触发时，返回 `valid: false`、问题说明及空文件列表。

Worker 仅对匹配文件应用技能信号、抽取器及解码；抽取器自身的文件过滤仍为附加限制。未匹配的可分析文件继续产生通用信号，Agent 仍可读取。迁移 `0204` 在 `log_files` 保存 `role` 与 `skill_matched`。记录清单返回可空的 `role`、`skillMatched`，Agent 文件列表也包含这些分配。适用状态为 null 表示旧文件或尚未分配，为 `false` 表示「仅通用分析」。报告「文件」页显示角色及该标记。

### 技能信号规则

`POST /api/v1/log-skills/:skillId/signals-preview` 需要 `logs:admin-domains` 与 `logs:view`。请求 `{signalRules, parsing?, formatProfile?}` 在技能已存样例上执行未保存规则，不接受客户端日志正文。请求体超过 512 KiB 时，在 JSON 解析前返回 `413`。响应 `{valid, issues: [{path, message}], hits: [{ruleId, lineNumber, excerpt}], truncated, reason?}`。规范错误返回 `200`、`valid: false`；路径以 `signalRules` 或 `parsing` 开始，定位规则、条件与字段。无样例或请求体错误为 `400`，跨组织或不存在为 `404`，无权限为 `403`。只读预览复用 Worker 的匹配器，校验与执行硬超时 100 ms，最多处理 5000 样例行、返回 500 命中，每条摘录最多 400 字符。`reason` 为 `time_cap`、`line_cap`、`hit_cap`、`event_cap` 或 `evaluation_cap`；只保留已完成工作的命中。解码行、输入或事件超限也标记预览不完整。不写审计，不保存草稿。

`signalRules.rules` 每项保留既有 `id`、`anyOf`、`stageId`、`inference`、`suggestedAction` 与 `analysis`。可选 `name` 和 `severity`（`Critical`、`Warning`、`Info`）提供作者填写的信号名称与报告级别。回退证据保留 `inference`，显式配置的优先级结论优先于名称。句式构建器直接编辑此表示，保留条件顺序、多个备选条件及旧分析元数据。每个技能最多 64 条规则，每条最多 16 个条件，总计最多 16 个时间窗；超限项返回稳定校验路径。时间窗环形缓冲仅保留最近 N 个匹配时间戳，总上限为 160,000 个（1.28 MB）。Worker 的首轮预筛、字段精筛和信号提取共享固定预处理截止时间及两百万次操作预算；耗尽时标记结果不完整。

条件保留 `text`、`numericComparison`、`severityToken`，新增 `{type: "field", field: "extractorId.fieldName", operator: "equals", value}`、`operator: "range", min, max`（闭区间数值范围）及 `operator: "in", values`。比较使用 `parsing/v1` 成功解码的标量值，严格检查类型；字节对象和未声明字段会被拒绝。`{type: "window", condition: textOrFieldCondition, count, seconds}` 在含当前行的向前时间窗内至少出现 `count` 个匹配后，对每个匹配行产生信号。计数范围 1–10000；秒数大于零且不超过 86400。只有含已解析时间戳的行参与计数；时间回退会清空窗口，各文件不共享计数。消息模式使用 RE2，保留模式 4096 字符及输入 65536 字符上限。

迁移 `0196_seed_charging_skill.sql` 在内联 `DO` 块中为已有的每个组织创建已发布的「充电」技能，不写应用审计，也不留下持久化初始化函数。组织 bootstrap 和 M0/M1/M2/M3 种子为之后新建的组织调用 TypeScript 服务 `provisionChargingSkill`。运行时初始化通过系统服务调用使用 `withAuditedWrite`，技能、发布版本和审计在同一事务中提交或回滚。两条路径都使用组织行锁和租户复合外键；重试不修改已有种子或作者版本。测试校验冻结的迁移字面量与运行时种子一致，两者均保留原充电规则证据。钉住且未配置规则的技能使用通用信号，未分类上传保留旧充电预筛。草稿编辑不改变既有运行钉住的规则；规则回退同时使用钉住规则与通用信号。

`skill/v1.knowledgeEntryIds?: uuid[]` 将知识条目链接保存在技能草稿和不可变已发布版本中。服务端校验组织范围，拒绝跨组织条目 id。工作区通过正常的 `GET /api/v1/knowledge/entries?status=published&q=...` 搜索已有条目，上传则调用 `POST /api/v1/knowledge/entries` 并传入 Markdown 内容。上传创建知识草稿，需要 `knowledge:edit` 并保留正常知识审计，单有技能管理权限不足。新建草稿可以链接，但仍需单独发布后才能参与检索。取消链接不删除条目。

`read_domain_knowledge` 使用运行钉住的技能版本所携带的条目 id，不读取实时身份链接集合。保留仅已发布可检索的行为，包括未配置链接时的全组织检索。报告/记录和运行 DTO 返回 `knowledgeRevisions: [{ entryId, revisionId }]`，保存该次运行实际返回的去重知识修订。链接但未检索到的条目不在其中。后续编辑或新知识修订不改写既有来源；未检索和历史未知来源均返回 `[]`。迁移 `0197` 在将既有业务域链接回填到当前已发布技能版本之前，先冻结旧运行的链接范围，不为历史报告补造来源。

链接条目的元数据遵循知识模块的 `canReadEntry` 策略，日志管理权限不能代替知识读取权限。技能 spec 只携带条目 id。知识选择器需要 `knowledge:view`，仅列出已发布条目。旧链接接口对不可读条目返回「无权查看的条目」、空标签并省略 `entryStatus`；旧接口替换链接时，对不可读的未发布条目返回 `404`，不披露状态。报告、日志列表和运行来源保留 `entryId`，但省略不可读条目的 `revisionId`。这种读取时的投影不会改写已存储的来源。

| `POST` | `/api/v1/log-files` | 创建上传凭证或直接上传 |
| `POST` | `/api/v1/logs` | 创建日志分析记录 |
| `GET` | `/api/v1/logs` | 日志列表 |
| `GET` | `/api/v1/logs/:logId` | 日志详情 |
| `GET` | `/api/v1/logs/:logId/runs` | 分析 run 列表 |
| `POST` | `/api/v1/logs/:logId/rerun` | 重新分析 |
| `POST` | `/api/v1/logs/:logId/archive` | 归档 |
| `POST` | `/api/v1/logs/:logId/unarchive` | 取消归档 |
| `POST` | `/api/v1/logs/:logId/feedback` | 用户反馈 |
| `GET` | `/api/v1/logs/feedback-insights` | P3：反馈质量聚合（`logs:view`；可选 `timeWindow=today\|7d\|30d`） |
| `GET` | `/api/v1/log-domains` | 业务域列表（`logs:view`；`includeArchived=true` 含已归档） |
| `POST` | `/api/v1/log-domains` | 创建业务域（`logs:admin-domains`；组织内重名 `409`；画像 JSON 非法 `400`；画像中的模式使用线性时间引擎上的 RE2 语法，不支持环视与反向引用，长度 ≤ 4,096 字符，超过 65,536 字符的行不参与匹配，不支持的模式返回 `400` 并给出字段路径） |
| `PATCH` | `/api/v1/log-domains/:domainId` | 更新名称/描述/格式画像/状态/模型覆盖（`formatProfile: null` 清空画像；`modelOverride: null` 清空回全局 `LOG_ANALYSIS_MODEL`）。传入描述、格式画像或模型覆盖会立即发布新版本；技能锁内若已有工作区草稿，返回 `409 LOG_SKILL_DRAFT_EXISTS`（`Publish or discard the skill draft first.`）。仅修改名称/状态、归档和 Webhook 更新仍可用。 |
| `POST` | `/api/v1/log-domains/:domainId/archive` | 归档业务域；既有日志记录保留绑定 |
| `GET` | `/api/v1/log-domains/:domainId/knowledge-links` | 列出当前已发布技能版本的知识条目链接及各条目当前状态（`logs:admin-domains`） |
| `PUT` | `/api/v1/log-domains/:domainId/knowledge-links` | 立即发布新技能版本以整组替换链接集合（`{ knowledgeEntryIds: uuid[] }`），保留旧接口即时生效的行为。存在工作区草稿时返回 `409 LOG_SKILL_DRAFT_EXISTS`，须先发布或丢弃草稿。只接受本组织**已发布**知识条目（草稿/已归档 `400`，未知或跨组织条目 `404`）；写 `log-domain-knowledge-links-update` 审计。旧运行保留其钉住的链接范围。 |
| `PUT` | `/api/v1/log-domains/:domainId/webhook` | P3b：整组替换结果 Webhook 配置（`{ url: string\|null, enabled: boolean, secret?: string\|null }`；省略 `secret` 保持现有密钥）。URL 必须通过 SSRF 策略（仅 https、禁止内嵌凭据、禁止私网/环回/元数据地址——`400` 带 `reason` 码 `webhook-url-scheme` / `webhook-url-private-address` / `webhook-url-required` / `webhook-secret-required`）。写 `log-domain-webhook-config` 审计；密钥绝不回显 |
| `GET` | `/api/v1/log-domains/:domainId/webhook-deliveries` | P3b：最近投递尝试（`limit` 1..50，默认 10）——每次尝试一行，含 `kind`（`result`/`test`）、`attempt`、`status`（`delivered`/`retrying`/`failed`）、`httpStatus?`、`error?` |
| `POST` | `/api/v1/log-domains/:domainId/webhook-test` | P3b：经同一 SSRF 防护的签名发送端发出单次测试投递；返回 `{ outcome: { status, attempts, httpStatus?, error? } }`，写 `log-domain-webhook-test` 审计 |

业务域 DTO 携带 `modelOverride?` 与 Webhook 摘要 `{ enabled, url?, secretConfigured, secretLastFour? }`——签名密钥本身只写不读。出站结果 Webhook 的载荷与签名方案（`X-WiseEff-Signature` = 对 `timestamp.rawBody` 的 HMAC-SHA256,`X-WiseEff-Timestamp` 重放窗口）见 [`docs/zh-CN/api/log-analysis-integration.md`](../api/log-analysis-integration.md);投递尽力而为,绝不阻塞分析。

`POST /api/v1/log-files` 接受 JSON base64 或 multipart 多文件内容，保持 `POST /api/v1/logs` 的分析合同。

`GET /api/v1/logs/:logId` 新增当前运行的可选 `signalSummary`；旧记录可以没有该字段。结构为 `{ signals, templates, truncatedSignals, truncatedTemplates }`。信号包含 `kind`、`severity: "Critical" | "Warning" | "Info"`、`source: "generic" | "skill"`、`title`、`count` 和有界的 `anchors: [{ file, line, content }]`；行号从 1 开始，相对于文件。崩溃信号还可包含 `signature`（如 `Oops` 或 `Kernel panic`），按文件与签名分别计数和保存锚点，`kind: "crash"` 保持不变。模板包含 `template`、`count`、`first` 和 `last`，首末锚点结构相同。截断标记说明摘要受上限约束，不能视为完整清单。信号是分析线索，不是已经验证的根因。

摘要还接受可选的 `truncated: boolean` 与 `reason: "time_cap" | "line_cap" | "extraction_error"`，与数量上限分开说明提取不完整：超时保留已完成结果，长行只扫描受限的行首内容，提取出错则返回空摘要并继续分析。既有报告 JSON 保存这些字段，「信号」页按原因提示。

没有选择技能的上传也提取崩溃特征、时间戳间隔、重启、错误突发和每文件首个错误。行模板归一化数字、十六进制、标识符和路径，保留次数及首末位置。技能信号来自运行钉住的版本。规则回退同时使用两类信号，保留 `analysisSource`、`degradedReason` 与既有置信度上限。

只读 Agent 始终具有 `get_signals`（可选 `kind`、`severity`、`offset`、`limit`）、`get_line_templates`（`offset`、`limit`）和 `get_timeline`（ISO `time` 或 `file` + `line`，以及 `before`/`after`）。分页偏移非负，每页 1–20 条。时间线上下文前后各最多 20 行，按时间戳跨文件排序。只有实际返回的锚点与日志行算已读证据；不在返回页或窗口中的真实行仍算未读。这些是 Worker 内部工具，不是新增 HTTP 端点。

分析技能保留 `log_domains` 身份与 id。新资源读取要求 `logs:view`，但轨迹与试运行要求 `logs:admin-domains`；写入要求 `logs:admin-domains`。每次写入在同一事务中记录 `log-skill-create`、`log-skill-draft-save`、`log-skill-publish`、`log-skill-draft-discard` 或 `log-skill-restore` 审计。技能与版本均按组织隔离，跨组织访问返回 `404`。旧 `/api/v1/log-domains` 接口全部保留：创建同时发布 v1；PATCH 含 `formatProfile` 或 `modelOverride` 时立即发布新版本，保留独立草稿与旧运行钉住值。名称、状态、知识关联和 Webhook 配置仍属于身份。工作区描述按版本管理，发布时同步身份行描述；旧 PATCH 仍可独立编辑身份描述。版本 DTO 另有可选的 `publishedByDisplayName`，供工作区显示发布者。

上传、创建与 rerun 接受 `skillId`，`logDomainId` 继续作为别名。rerun 接受 `revisionPolicy: "current" | "pinned"`，默认 `current` 使用当前发布版本；`pinned` 复用前一次运行版本，不能同时更换技能。未分类运行保持 null 钉住值并使用平台默认配置。记录和运行 DTO 暴露 `skillRevision: { id, number } | null`；结果 Webhook 增加可空 `skillRevisionId`、`skillRevisionNumber`。Worker 只从所钉版本读取格式画像、模型覆盖和信号规则。

技能身份新增组织内唯一的 `skillKey`，满足 `^[a-z0-9][a-z0-9-]{1,62}$`。创建时按名称生成 slug，非 ASCII 名称或碰撞时添加短 id 后缀；迁移 0202 回填已有技能。改名、发布不改变 key。管理员可通过 `PATCH /api/v1/log-domains/:domainId` 修改 `skillKey`，同事务审计；非法或重复 key 返回字段错误。`POST /api/v1/log-files`（JSON/multipart）和 `POST /api/v1/logs` 均接受 `skillKey`，保留 `skillId`、`logDomainId`。选择字段仅在调用方组织内解析，同时提供时必须一致，冲突返回 `400 VALIDATION_FAILED`，未知或跨组织 key 拒绝；上传钉住当前已发布版本。

工作区「集成」统一编辑 key、展示上传示例、配置和测试 Webhook、查看投递记录、编辑模型及预算。「概览」保留指引，旧管理页提供工作区链接，不再重复编辑。`spec.stepBudget`、`spec.tokenBudget` 为可选正整数，随版本发布，省略时使用全局默认。服务端拒绝超过 `LOG_ANALYSIS_MAX_STEPS` / `LOG_ANALYSIS_TOKEN_BUDGET` 的值，返回 `VALIDATION_FAILED` 字段错误；技能详情提供 `budgetCaps`。旧版本在平台上限降低后仍受运行时上限约束。Webhook 和 key 继续属于即时生效的身份设置。

保存及发布还校验 `stepBudget >= 1`、`tokenBudget >= min(4096, LOG_ANALYSIS_TOKEN_BUDGET)`，错误指向具体字段路径。显式版本 token 预算约束模型服务报告的累计用量，每次模型调用前检查，包含收敛调用，不做 token 估算。单次完成可能超过剩余预算；已报告用量达到预算后，不再发起后续调用。没有得到已接地最终报告时，耗尽运行返回 `rules-fallback` 及 `degradedReason: "token-budget-exhausted"`。没有版本 `tokenBudget` 时，既有平台全局预算计量及提前收敛行为不变。

结果 Webhook 在保留 `logDomainId`、`skillRevisionId`、`skillRevisionNumber` 及其他旧字段的基础上增加 `skill: { id, key, revisionId, revisionNumber }`、`degraded: boolean`。旧未钉住运行的版本字段可为 null；规则回退或存在降级原因时 `degraded` 为 true，有原因时保留 `degradedReason`。终态入队快照保存 key 和钉住版本，重试保持相同载荷；同步测试事件维持原格式。参见[集成指南](../api/log-analysis-integration.md)。

上传、创建与 rerun 接受可选 `logDomainId`，作为 `skillId` 的别名：必须属于本组织且为 `active`，否则 `400`。新上传未提供选择字段时使用下述推荐路由；rerun 保持原有版本策略。日志 DTO 新增 additive 来源字段：`logDomainId?`、`logDomainName?`、`analysisSource?: "agent" | "rules-fallback"`、`degradedReason?: "provider-unavailable" | "token-budget-exhausted"`；`rules-fallback` 表示降级分析，客户端必须保持其可见，其余输出契约不变。

### 技能推荐与上传路由（#1247）

已存储日志包按路径顺序采样，最多使用前 200 个文件。采样以外的文件仍按现有接收限制参与分析。

推荐理由保留 `kind`、`file`、`detail`，并新增 `source`（`skill-glob`、`extractor-glob`、`extractor`、`signal`、`format-timestamp`、`format-severity`）及 `ref`（通配、抽取器 id、信号名称或 id、时间戳模式或严重级别）。适用文件规则理由还可包含 `role`。新记录原样保存这些字段，历史理由可以缺少它们。上传对话框和报告元数据根据结构化字段显示中文说明，最多展示五条带文件名的理由，并标明剩余条数。上传选择列表只显示一次推荐技能；推荐到来前已有的手动选择仍保留为显式选择。

自动路由读取已发布候选时不加行锁，并钉住所评分的不可变版本。在保存点内临时设置 200 ms 锁超时，返回前恢复调用方的锁超时，不改动调用方的语句超时。仅对胜出技能的身份和版本获取不等待的键共享锁，保护后续外键插入；遇到写入锁冲突、查询错误、取消或评分失败时，以空理由走通用分析，不中止上传事务。显式选择保留原有校验与版本钉住行为。

`POST /api/v1/log-skills/recommend` 要求账号有效且具备 `logs:upload`。请求为 `{ files: [{ path: string, head: string[] }] }`，返回 `{ recommendations: [{ skillId, score, reasons: [{ kind: "file" | "pattern", file, detail }] }], recommendedSkillId?: string }`。只对调用者组织内有效且有已发布版本的技能评分。结果按分数降序、技能 id 升序排列；只有最高分唯一且至少为 **8** 时才包含 `recommendedSkillId`。并列或低分走通用分析；完成评分时仍返回零分候选。

每个适用文件命中首个技能级文件 glob 得 4 分，该规则指定非空角色再加 2 分，不同角色名权重相同。抽取器文件 glob 每文件最多加 4 分。每个不同的抽取器模式命中每文件加 8 分；每条文本信号规则命中每文件加 4 分，同规则多个条件命中不重复加分。格式画像的时间戳、严重度模式命中每技能合计最多加 2 分，普通时间戳或 INFO 标记不能单独触发推荐。技能适用范围和抽取器文件过滤约束模式检查。没有文件规则表示适用于全部文件，但不产生文件 glob 分。作者模式通过共享有界 RE2 编译器和请求级模式缓存执行，不使用 JavaScript 正则引擎。

限制：最多 200 个文件，路径为 1–1024 字符且不含控制字符，每文件最多 64 行、每行最多 2 KiB UTF-8。结构预检在解析数组元素前检查类型和限制，遇到首个违规字段立即返回 `400 VALIDATION_FAILED`，只包含一条问题。推荐端点另将完整 HTTP JSON 请求体限制为 27,079,424 字节：`200 × (64 × (2048 + 3) + 1024 × 4 + 32) + 1024`，涵盖文件头字节、行分隔符、路径 UTF-8 和 JSON 封装。超限在解析前返回 `413`。即使各字段都符合限制，JSON 转义也计入此传输上限。评分器只检查前 64 行，并整行忽略超长行，避免截断前缀造成错误的锚定匹配。读取已存储日志包时，每文件最多检查 131,200 字节，并丢弃不完整的末行；所有文件头读取共用 500 ms 时限，超时后路由回退通用分析。评分另有包含编译在内的 100 ms 预算，一次排名最多检查 100 个技能、每技能 512 个声明模式、200,000 次求值。文件路径或技能 id 重复、路径或模式无效、候选超限，或模式缓存、编译、求值、时间预算耗尽时，整份排名清空并走通用分析。每技能按确定的文件及特征顺序保留最多 24 条理由，每条详情最多 512 字符。推荐限制不会扩大上传或解包预算。

JSON、multipart 的 `POST /api/v1/log-files` 以及基于已有文件的 `POST /api/v1/logs`，始终优先使用显式 `skillKey`、`skillId` 或旧别名 `logDomainId`，任一显式选择字段都会记录为 `skillSelection.mode: "explicit"`；同时提供的选择字段仍须一致，否则返回 `400 VALIDATION_FAILED`。否则 `skillSelection: "generic"` 明确禁用技能；所有选择字段都省略时用同一评分器检查已存储日志包。推荐失败不阻挡原本有效的上传。新记录返回 `skillSelection: { mode: "recommended" | "explicit" | "generic", reasons }`；推荐模式保存获胜理由，手动指定与通用模式的理由为空。迁移 `0206_log_skill_selection.sql` 添加可空 JSONB 列 `log_records.skill_selection`，null 表示历史记录的选择来源未知。报告元数据在钉住技能版本旁显示选择结果。上传保留原始上传记录，并按最终选定的显式或推荐技能计算文件角色与 `skillMatched`，供报告及分析用例使用。

上传对话框在浏览器支持时，本地读取有界文件头、压缩包路径及文件头（`.zip`、`.tar.gz`/`.tgz`、`.gz`、`.tar`），否则仅使用名称。压缩包预览另有压缩 16 MiB、展开 32 MiB 和三秒限制。错误或超时静默保留原选择，不产生新的预选，也不禁用上传。自动预选不发送上传技能选择字段，由服务端独立检查已存储数据；手动改选发送技能 id，「不使用技能」发送 `skillSelection: "generic"`。

`POST /api/v1/log-files` 接受原有 JSON base64 请求，也接受 multipart/form-data：重复的 `file` 字段（多个普通文件）作为一个日志包；也可上传一个压缩包，不能与其他文件混传。支持 `.tar`、`.tar.gz`/`.tgz`、多条目 `.zip`（stored/deflate）和 `.gz`；gzip 内层名为 `.tar` 时按 tar.gz 处理。内层压缩包最多再展开一次，路径以前一层压缩条目名作为目录前缀。目录跳过；规范化相对路径最多 1024 个 UTF-8 字节。路径穿越（包括反斜杠与 `..` 段）、绝对路径、链接、设备、FIFO、加密 zip、重复规范化路径、损坏或超限压缩包生成失败记录：`failureReason` 说明规则原因，使用 `inline/` 伪存储键，不写对象存储，也不创建分析任务。接口仍返回 `201`，并写入 `log-upload-failed` 审计及 `{ fileName, failureReason }` 元数据。日志包及压缩包原因使用中文；不支持扩展名的单个普通文件保留原英文格式提示。非预期解码或压缩异常统一返回压缩包完整性提示，不暴露内部错误。

每条记录返回 `files: [{ path, sizeBytes, lineCount, encoding, lossy, status, skipReason, role, skillMatched }]`；证据增加可空的 `filePath`，行号始终相对于该文件。`encoding` 为 `utf-8|utf-16le|utf-16be`：识别 UTF-8 及 BOM、UTF-16 LE/BE BOM，其余以 UTF-8 有损解码并标记 `lossy`。无 UTF-16 BOM 且前 8 KiB 含 NUL、解码后含 PostgreSQL 文本不支持的 U+0000，或文本样本中控制字符占比大于 20% 的文件列为已跳过（「二进制文件」）；不支持扩展名也列出原因。`.log/.txt/.csv/.json` 和内容为文本的无扩展名文件参与分析。只有跳过文件的包仍保存清单及失败记录，不创建任务。原始文本逐文件存为 UTF-8；旧记录没有清单时继续读取原单对象。结果 webhook 仍仅发送摘要，不含证据或原始文本。

默认限制：上传总字节 100 MiB（`LOG_BUNDLE_MAX_COMPRESSED_BYTES`），文件总原始字节 100 MiB（`LOG_BUNDLE_MAX_UNPACKED_BYTES`），最多 2000 文件（`LOG_BUNDLE_MAX_FILES`），单文件 100 MiB（`LOG_BUNDLE_MAX_FILE_BYTES`）。整个压缩包和每次 inflate 都受 200 倍压缩比约束（1 MiB 最低预算），并受单文件/剩余总大小限制；tar.gz 的中间 tar 容器也受剩余总大小约束，含 tar 头及填充。普通单文件默认仍至多 100 MiB；配置后的上传、总大小、单文件限制取最小值。服务端最终判定，客户端仅作明显超限预检。

**反馈质量洞察（P3）**：`GET /api/v1/logs/feedback-insights`（`logs:view`，组织隔离）把 `log_feedback` 聚合给 `/log-admin`「分析质量」看板：按业务域 × `analysisSource` × `promptVersion` 每组一行，含 `totalCount`、`helpfulCount`、`helpfulRate`（0..1）与 `lastFeedbackAt`。可选 `timeWindow=today|7d|30d` 按反馈创建时间过滤（与 `GET /api/v1/logs` 相同的区间语义）。反馈归因到写入时戳记的分析 run（`log_feedback.run_id`，取当时日志的 `current_run_id`）；`run_id` 仍为空的历史行回退到日志当前 run。列表/详情仍读取当前 run 的报告。未分类域的 `logDomainId`/`logDomainName` 为 `null`，无来源信息的历史报告 `analysisSource`/`promptVersion` 为 `null`。

### 技能分析用例（#1246）

以下接口均要求 `logs:admin-domains`，读写限定于当前组织，不可访问的技能、记录或运行返回 `404`。用例归属技能身份。迁移 `0203_log_analysis_cases.sql` 添加组织复合外键及运行角色授权；用例新增、修改、删除、导入和运行结果写入均走审计事务。

| 方法 | 路径 | 契约 |
| --- | --- | --- |
| `GET` | `/api/v1/log-skills/:skillId/analysis-cases` | `{ items, latestRun, current }`；`current` 要求捕获的草稿、发布版本及全部用例仍保持一致。 |
| `POST` | `/api/v1/log-skills/:skillId/analysis-cases` | `{ name, expectations, files?: [{ fileName, contentBase64 }], sourceRecordId? }`；提供上传文件或本技能可访问的已完成报告，返回 `201 { item }`，保留原始上传字节及文件清单。 |
| `PATCH` | `/api/v1/log-skills/:skillId/analysis-cases/:caseId` | `{ name, expectations }`，返回 `{ item }`，使先前运行过期。 |
| `DELETE` | `/api/v1/log-skills/:skillId/analysis-cases/:caseId` | 审计删除，`200 { ok: true }`。 |
| `POST` | `/api/v1/log-skills/:skillId/analysis-case-runs` | `{ caseIds? }`，省略 ids 运行全部用例，返回 `202 { run }`。需先保存草稿；容量耗尽返回 `429`。 |
| `GET` | `/api/v1/log-skills/:skillId/analysis-case-runs/:runId` | `{ run }`，含 `processing`、`complete` 或 `failed` 状态、进度，以及逐用例草稿/已发布结果。结果含 0–100 得分、通过情况、报告、轨迹引用及差值。 |
| `GET` | `/api/v1/log-skills/:skillId/analysis-case-runs/:runId/cases/:caseId/trace?revision=draft` | 复用有界管理员轨迹契约的 `{ steps }`；`revision` 也支持 `published`。 |
| `GET` | `/api/v1/logs/:logId/analysis-case-prefill` | 对已完成且绑定技能的报告返回 `{ skillId, name, expectations }`；结论映射为期望根因，引用映射为文件/行证据，建议映射为期望动作。保存需要原始上传；缺少原包的历史报告明确报错。 |
| `POST` | `/api/v1/log-skills/:skillId/analysis-cases/import` | multipart `file` ZIP，完整校验后才持久化，返回导入用例的 `201 { items }`。 |
| `GET` | `/api/v1/log-skills/:skillId/analysis-cases/export` | [`eval-cases/logs` 布局](../../../eval-cases/logs/README.zh-CN.md)的二进制 ZIP，保留原始日志字节及未编辑标注。 |

期望复用 `domain`、`summary`、`realLog`、`deIdentified`、`rootCauseCategory`、`rootCausePoints`、`keyEvidenceLines`、`expectedActions`、`expectRefusal`、`analysisQuestion` 和 `formatProfile`。日志包扩展为可选用例名 `caseName`、`bundleFiles`、文件感知的 `keyEvidence: [{ file, line?, pattern? }]` 和可选 `expectedDegradedReason`。非拒答用例须包含期望根因、证据和动作。导入错误指出具体归档路径与字段，文件沿用有界日志包接收校验，模式使用线性时间引擎。

限制：每技能/运行 20 个用例，每用例原始字节及规范化文本各 10 MiB、解包文件 100 个，每次运行 120 秒，每技能保留 10 次运行。导入 ZIP 的压缩/解压总量均为 440 MiB，最多 2040 条目。准入时捕获输入及两个版本，与试运行共享组织/总量 owner 锁，使用已配置分析器和质量评测。配置 judge 时评分根因及动作，否则使用确定性评分。运行不产生记录、统计、搜索条目或结果 Webhook。当前草稿及全部用例的完整结果可提供发布摘要；过期、缺少或失败结果提示重跑，始终不阻止发布。

### 分析轨迹与草稿试运行（#1230）

| 方法 | 路径 | 契约 |
| --- | --- | --- |
| `GET` | `/api/v1/logs/:logId/trace` | 返回记录当前分析运行的 `{ steps }`，按步骤序号排序。需要 `logs:admin-domains`，只有 `logs:view` 时返回 `403`。记录不存在或跨组织时返回 `404`。 |
| `POST` | `/api/v1/log-skills/:skillId/dry-runs` | 用已配置的分析器，在技能已存样例上运行已保存草稿；返回 `202 { run }`。需要 `logs:admin-domains`。缺少草稿或样例时返回 `409 CONFLICT`；技能不存在或跨组织时返回 `404`。总并发或组织并发已满时返回 `429 RATE_LIMITED`，提示「试运行繁忙，请稍后重试」，且不启动分析。 |
| `GET` | `/api/v1/log-skills/:skillId/dry-runs/:runId` | 返回 `{ run, steps }`，轨迹按序排列；需要 `logs:admin-domains`，且运行必须属于当前组织及指定技能。不存在、跨组织或已清理的运行返回 `404`。 |
| `GET` | `/api/v1/log-skills/:skillId/dry-runs/:runId/lines` | 返回接收运行时所捕获样例的 `{ item: { file, startLine, endLine, totalLines, lines } }`；技能后续替换样例不改变此读取。需要 `logs:admin-domains`。查询参数为精确样例 `file` 及正整数、首尾均包含的 `startLine` / `endLine`，最多 400 行；窗口不合法为 `400`，运行不可访问或文件不匹配为 `404`。 |

试运行的 `run` 包含 `id`、`skillRevisionId`、`status`（`processing`、`complete` 或 `failed`）、整数 `progress`（0–100）、可空的 `report` 与 `error`，以及 `createdAt`。轮询至终态；完成报告沿用既有结论与证据契约。启动前先保存草稿并上传样例。接收运行时捕获草稿规范供本次执行，并保留版本 id；后续替换或删除草稿不会使已接收的运行切换版本。

试运行使用独立的 `log_skill_dry_runs` 表，不使用带标记的日志记录。它不创建 `log_records`、分析作业或结果 Webhook 事件，因此不会进入 `/logs` 列表、计数或搜索。PostgreSQL 将跨 API 实例的接收操作串行化：每组织最多一个运行，总并发取 `LOG_DRY_RUN_MAX_CONCURRENT`（默认 2，有效范围 1–4；无效值回退为 2）。此共享数据库上限保守地限制跨实例总量，也限制单进程并发；各实例应配置相同值。容量已满的请求不读取样例、不调用分析器。执行受现有分析预算约束，超时取 120 秒与所配置最长作业时限的较小值。样例准备沿用 worker 的流式读取、每行 64 KiB 上限及有界引用摘要，只将最多 400 行且不超过 128 KiB 的预览解析到内存。信号提取和解码在共享预处理预算内保留既有时间、事件及行上限。接收运行时，每技能保留最近 10 次，清理更早的终态运行及其轨迹。

每个活动运行持有 PostgreSQL 会话 advisory lock，作为所属进程仍存活的标记。启动恢复与状态读取时的惰性恢复会将所属锁已消失或已过截止时间的处理中运行标为失败，提示「服务重启，试运行已中断」。即使超时后界面已显示失败，也要等底层执行实际结束才释放容量。抽屉提供「重试」。两处轨迹均汇总步骤数、工具调用次数及已报告的输入/输出 token 数，并标记降级或提前收敛。报告中的日志行标签打开既有日志查看器，试运行轨迹标签仅展示文本。

每步轨迹包含 `index`（1–200）、`kind`（`tool-call`、`model-turn`、`early-convergence`、`rule-fallback` 或 `degradation`）、可空的 `tool`、结构化 `arguments`、`resultBytes`、`lines: [{ file, line, snapshotId? }]`、`outcome`（`ok`、`error` 或 `truncated`）、可空的 `reason`，以及模型服务提供时的可选 `inputTokens` / `outputTokens`。每次运行最多保存 200 步；每步最多 50 个行引用，并共用 64 KiB 的引用序列化预算。含 `snapshotId` 的引用标识源码位置，界面显示为源码标签，不打开日志文件；日志行标签打开既有日志查看器抽屉。参数键使用白名单，保留有限数值、布尔值和 null。`file` 字符串只有与本次输入文件清单中已校验的包内相对路径匹配时才保留，并截断为最多 120 字符。其他字符串（包括查询和匹配模式）及复合值替换为 `[redacted]`；schema 另将字符串参数值、工具名和原因限制在 120 字符内。轨迹绝不包含原始提示词、系统消息、诊断流程正文、知识正文或模型服务载荷。轨迹通过组织复合外键引用普通运行或试运行父行，仅管理员可见的报告标签页展示这些摘要。

创建日志文件：

```json
{
  "fileName": "charging_thermal_trace.log",
  "contentType": "text/plain",
  "contentBase64": "V0FSTiB0ZW1wPTc1",
  "analysisQuestion": "Why did fast charging fold back?",
  "relatedParameterPin": {
    "kind": "canonical-pin",
    "projectId": "project_123",
    "bindingId": "binding_123"
  },
  "logDomainId": "domain_123"
}
```

创建日志分析：

```json
{
  "fileObjectId": "file_123",
  "fileName": "charging_thermal_trace.log",
  "analysisQuestion": "Why did fast charging fold back?",
  "relatedParameterPin": {
    "kind": "canonical-pin",
    "projectId": "project_123",
    "bindingId": "binding_123"
  },
  "logDomainId": "domain_123"
}
```

### 源码快照元数据与管理（#1243）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/log-skills/:skillId/source-snapshots` | `200 { items: snapshot[] }`；需要 `logs:view`，只读元数据，包含已归档快照。 |
| `POST` | `/api/v1/log-skills/:skillId/source-snapshots` | 仅支持 multipart `{ versionLabel, file }`；返回 `201 { item: snapshot }`，状态为 `queued`。需要 `logs:admin-domains`。 |
| `POST` | `/api/v1/log-skills/:skillId/source-snapshots/:snapshotId/default` | `200 { item: skill }`；创建或替换草稿的 `spec.defaultSourceSnapshotId`，下次发布生效。需要 `logs:admin-domains`。 |
| `POST` | `/api/v1/log-skills/:skillId/source-snapshots/:snapshotId/archive` | `200 { item: snapshot }`，状态为 `archived`。需要 `logs:admin-domains`。 |

必填 `versionLabel` 去首尾空白后为 1–200 字符，在技能的未归档快照中唯一，冲突返回 `409`。压缩包支持 `.tar.gz`、`.tgz` 和 `.zip`，默认压缩上限 100 MiB。路由请求体另加 64 KiB multipart 封装预算，过大的 `Content-Length` 在缓冲前拒绝，实际请求字节同样受限，超限返回 `413`；文件字节共享请求缓冲，不支持 JSON/base64 上传。上传和索引由 `LOG_SOURCE_*` 配置，白名单和安全规则见[环境变量](../developer/environment-variables.md#日志分析-llm)及[运行手册](../runbooks/log-analysis-llm.md#源码快照1243)。技能与快照查询必须匹配组织和技能，跨范围 id 返回 `404`。已归档快照不能被新选为默认值，返回 `409`；保存、发布和恢复可保留不变的已有归档默认值，所有引用仍须属于同一组织和技能。上传、默认设置和归档分别在数据库写入事务内记录 `log-source-snapshot-upload`、`log-source-snapshot-default` 和 `log-source-snapshot-archive` 审计。

快照元数据含 `id`、`skillId`、`versionLabel`、`status`（`queued`、`indexing`、`ready`、`failed`、`archived`）、`filesProcessed`、`filesTotal`、`fileCount`、`skippedCount`、`skippedFiles: [{ path, reason }]`（最多 200 条）、可空 `error` 和 `createdAt`。上传可选传入 `sourceVersion`（去除首尾空白后 1–200 字符）。Worker 在钉住版本所属组织和技能内匹配未归档快照，不要求就绪；否则使用该版本的默认快照。记录和运行返回 `sourceSnapshot: { id, status }`、`sourceSnapshotSelection`（`matched_version`、`default`、`none`）及可选 `requestedSourceVersion`。标签未匹配时附加回退说明。快照未就绪或已归档不会使分析失败，报告会说明源码不可用。

只有快照就绪的运行才提供 `locate_log_statement`、`search_source` 和 `read_source_range`。检索接收 `pathGlob`、`query`、可选 `mode`（`literal`、`full_text`）及 `limit`（1–20）。字面量查询至少含三个连续字母或数字，不得含换行。全文与三元组索引最多选取 200 个分块，另有有界查询覆盖最多 200 个行内分块边界。排序命中返回快照、路径、行号和最多 400 字符的摘录。范围读取须传入运行的 `snapshotId`、`path`、`startLine` 和 `endLine`，限制为 80 行、每行 1,000 字符，返回带行号的内容。两个工具均限制总输出为 16 KiB，并标记截断。源码证据必须引用工具实际返回的位置，相邻行和省略行不算已看到。报告查看者只能读取已持久化引用周围的有界摘录，没有通用源码浏览端点。

检索在评分前最多接纳 201 个匹配分块 id，额外的一个仅用于检测截断；只对前 200 个候选评分排序，不对整个快照排序。所有查询至少需要三个字符。没有字面路径前缀且匹配超过 200 个分块时，工具拒绝查询并提示缩小通配路径或细化查询。每次检索语句在事务内设置一秒 PostgreSQL 超时；超时回滚该事务范围，返回 `{ items: [], truncated: true, reason: "statement_timeout" }`。成功时恢复外层事务原有的超时设置。源码检索超时不会使日志分析失败。

字面量排序只对匹配附近的 400 字符评分。单行分块复用已索引的全文匹配结果，不再重新解析该行。调用方设置了更短的非零数据库超时时，保留该上限。

## 7. Product Feedback

Internal Beta「问题反馈」与日志分析反馈分离，按认证用户的 `organization_id` 隔离。活跃登录用户可以提交反馈、维护自己的草稿，并在反馈中心补充信息。`mine` 和草稿接口校验提交人身份；管理员分诊、负责人列表及管理员附件读取要求 `admin:access`。

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
| `PATCH` | `/api/v1/product-feedback/:id` | 保存 `priority`（`low`、`normal`、`high`）、可空 `assigneeUserId`，或兼容旧状态／备注更新。负责人必须是同组织的活跃管理员；状态更新复用下述审计进展规则。 |
| `GET` | `/api/v1/product-feedback/assignees` | 返回本组织可分配的管理员：`{ items: [{ id, name, username }] }`，username 可为空。 |
| `GET` | `/api/v1/product-feedback/stats` | 按状态统计全部已提交反馈，不包含草稿。 |
| `POST` | `/api/v1/product-feedback/:id/progress` | 追加 `publicMessage` 和／或私有 `internalMessage`（各最多 2000 字符），可同时指定 `toStatus` 和 `resolutionCode`。 |
| `GET` | `/api/v1/product-feedback/mine` | 本人的反馈与草稿；支持 `q`、`status`（含 `draft`）、`cursor` 和 `limit`。 |
| `GET` | `/api/v1/product-feedback/mine/:id` | 本人的公开详情，不返回内部备注和操作人 ID。 |
| `POST` | `/api/v1/product-feedback/mine/:id/replies` | 提交人为已提交反馈补充 `{ message, attachments?, reopen? }`；返回 `201 { item }`。message 必须非空，最多 2000 字符；附件为追加。`reopen: true` 仅适用于已解决／已关闭反馈；已关闭时必须重新打开才能补充。 |
| `POST` / `PATCH` / `DELETE` | `/api/v1/product-feedback/drafts`；`/drafts/:id` | 创建、保存或删除本人草稿；创建允许部分字段，保存接受 `retainedAttachmentIds`（包括空数组）和 `newAttachments`。已提交反馈不可通过这些接口编辑。 |
| `POST` | `/api/v1/product-feedback/drafts/:id/submit` | 提交本人草稿，可同时更新页面来源、类型和描述。 |
| `GET` | `/api/v1/product-feedback/:id/attachments/:attachmentId/content` | Admin 读取单个图片附件内容。 |
| `GET` | `/api/v1/product-feedback/mine/:id/attachments/:attachmentId/content` | 读取本人反馈或草稿的图片内容。 |

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

`feedbackType` 可为 `experience`、`data`、`export_submit`、`feature`。常规流转为 `open -> in_progress -> resolved -> closed`，待处理或处理中也可直接关闭。解决、关闭必须提供结论和公开说明；已解决／已关闭可通过公开原因重新打开为 `in_progress`，并清空旧结论。已关闭记录允许调整分诊安排，追加进展须先重新打开。兼容旧备注的修改会将原文保留在私有时间轴中。

两类列表均返回 `{ items, nextCursor }`，nextCursor 为不透明的 base64url 字符串或 null，应原样传回，保留时间戳精度。limit 范围为 1–100，默认 50。公开进展包含 `author: submitter | team`，不包含内部记录和操作人 ID。管理员公开进展与状态变化通过现有通知提供 `/feedback?id=...` 入口，纯内部备注不发送通知。

附件只接受 `image/png`、`image/jpeg`、`image/webp`；原始与补充附件合计最多 5 张，单张 5 MB，总量 15 MB。移除草稿附件只解除授权引用；共享的内容寻址图片须等待具备引用检查的垃圾回收机制后再物理删除。

## 7.1 知识库

组织级知识条目与不可变修订（设计来源：[知识库设计](2026-08-12-knowledge-base-design.md)）。读取要求 `knowledge:view`；创建与治理**自己的**条目要求 `knowledge:edit`；治理任意条目与彻底删除要求 `knowledge:manage`。草稿仅对拥有者和管理者可见。每次变更写审计事件并携带请求 trace。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/v1/knowledge/entries` | 创建 markdown 或文件条目（草稿）。文件以 base64 经对象存储上传并执行正文提取。返回 `201 { item }`。 |
| `GET` | `/api/v1/knowledge/entries` | 列出可见条目；支持 `status`、`contentForm`、`sourceType`（`human` \| `agent`,`/knowledge-admin` 的 Agent 草稿队列即 `status=draft&sourceType=agent`）、`tag`、`q`（标题）、`limit`。 |
| `POST` | `/api/v1/knowledge/distill-from-log` | 把一条**已完成**的日志分析记录沉淀为预填 markdown **草稿**（`{ logId }` → `201 { item }`）：标题取分析结论,正文由结论/影响/严重度/证据行引用/建议处置组装,标签预置（`日志分析` + 严重度）,来源关联存入 `sourceLogId`。要求 `knowledge:edit`,且对来源记录要求 `logs:view` 加组织隔离;未完成的分析返回 `400`。审计 kind `knowledge-entry-distill`。 |
| `POST` | `/api/v1/knowledge/distill-from-reload-run` | 把一次**终态** DTS 重载运行（`verified` / `unverifiable` / `contradicted` / `failed`）沉淀为预填 markdown **草稿**（`{ runId }` → `201 { item }`）：标题取运行目的 + 设备上下文;正文组装参数集（基线 → 调试值）、每参数行为验证结局、诚实陈述的运行终态（不可验证/矛盾/失败绝不读作成功）、产物摘要与内核日志摘录引用（绝不内联整段采集——运行仍是证据主体）;标签预置（`参数调试`、`DTS重载` + 终态标签）;来源关联存入 `sourceReloadRunId`。要求 `knowledge:edit`,且对来源运行要求重载读取门（`debugging:view` 或 `debugging:dts-reload`）加组织隔离;非终态运行返回 `400`。审计 kind `knowledge-entry-distill`。 |
| `GET` | `/api/v1/knowledge/search` | 仅检索 **published** 条目（`q`、可选 `limit`）。混合检索：配置了 `EMBEDDING_API_*` 且 pgvector 可用时,chunk 向量相似度与 FTS/trigram 排名做 RRF 融合;否则 FTS-only 路径保持不变。结果携带可引用字段（`entryId`、`title`、`revisionId`、`excerpt`）,响应携带诚实的 `retrieval` 报告：`{ mode: "semantic_fts" \| "fts_only", vectorAvailable, embeddingConfigured, degradedReason? }`。 |
| `GET` | `/api/v1/knowledge/related-to-log` | 一条**已完成**日志分析记录的相关**已发布**知识（`logId`、可选 `limit`,默认 5）：相似度查询只从存储的结论/影响文本推导（绝不读分析器内部或规则 ID）,走同一套混合检索并施加相关度截断（trigram `word_similarity` ≥ 0.2;向量余弦距离 ≤ 0.75）,不相关条目被丢弃而非凑数。要求 `knowledge:view`,且对来源记录要求 `logs:view` 加组织隔离;未完成的分析返回 `400`,跨组织记录 `404`。响应形状与 search 相同（`items` + 诚实 `retrieval`）。纯读端点,与 search 一样不写审计。 |
| `GET` | `/api/v1/knowledge/related-to-definition` | 按精确且可见的 Catalog `definitionId` 反查**已发布**知识（可选 `limit`）。须具备 `knowledge:view` 并通过受保护的 Catalog 定义读取；未知或不可见定义返回 `404`。草稿、归档条目不出现；纯读。 |
| `PUT` / `DELETE` | `/api/v1/knowledge/entries/:entryId/definition-references/:definitionId` | 对精确 Catalog Definition 添加或删除引用。条目作者持 `knowledge:edit` 或持 `knowledge:manage` 才可编辑非归档条目。新增校验 Catalog 可见性并拒绝退役定义；已存在添加与不存在删除幂等且不新增审计。实际变化写审计并返回 `{ item }`。 |
| `GET` / `PUT` / `DELETE` | `/api/v1/knowledge/related-to-spec`; `/api/v1/knowledge/entries/:entryId/parameter-references/:specId` | 历史 Spec 引用保留读取和删除。PUT 仅回放已保存的同一引用，拒绝新建旧模型行；不把 Spec ID 推断为 Definition ID。 |
| `GET` | `/api/v1/knowledge/index/status` | 逐条目检索索引健康（仅 `knowledge:manage`）：`{ retrieval, items }`,每项含 `status`（`pending` \| `processing` \| `succeeded` \| `failed`）、`error`、已索引修订与 chunk 计数。 |
| `POST` | `/api/v1/knowledge/index/rebuild` | 把全部已发布条目重新入队重建索引（仅 `knowledge:manage`;如更换 `EMBEDDING_MODEL` 后）。返回 `{ enqueued }`。写审计。 |
| `POST` | `/api/v1/knowledge/entries/:entryId/index/retry` | 单条目重新入队索引刷新（仅 `knowledge:manage`）。返回 `{ enqueued: true }`。写审计。 |
| `GET` | `/api/v1/knowledge/entries/:entryId` | 条目详情,含头修订内容与文件元数据（含提取状态）。 |
| `PATCH` | `/api/v1/knowledge/entries/:entryId` | 保存编辑（`title` / `tags` / `contentMarkdown` / 替换 `file`）为新的不可变修订。必须携带 `expectedHeadRevisionNumber`;过期保存返回 `409 CONFLICT`,`details.code: "knowledge-revision-conflict"`。 |
| `POST` | `/api/v1/knowledge/entries/:entryId/publish` | 发布草稿进入检索（`draft → published`）。 |
| `POST` | `/api/v1/knowledge/entries/:entryId/archive` | 归档已发布条目并退出检索（`published → archived`）。 |
| `POST` | `/api/v1/knowledge/entries/:entryId/restore` | 恢复已归档条目（`archived → published`）。 |
| `POST` | `/api/v1/knowledge/entries/:entryId/reject` | 从发布队列拒绝归档一条 **Agent 来源草稿**（`draft → archived`,永不发布）。条目拥有者（`knowledge:edit`）或 `knowledge:manage`;人工草稿与非草稿返回 `400`。审计 kind `knowledge-entry-reject`。 |
| `DELETE` | `/api/v1/knowledge/entries/:entryId` | 彻底删除条目及修订与文件元数据;结构化参数引用级联删除,审计 metadata 记录 `parameterReferenceCount`。仅 `knowledge:manage`;写 `High` 级审计。 |
| `GET` | `/api/v1/knowledge/entries/:entryId/revisions` | 列出不可变修订,新在前。 |
| `POST` | `/api/v1/knowledge/entries/:entryId/revisions/:revisionId/restore` | 把历史修订恢复为新的头修订（携带 `expectedHeadRevisionNumber`）。 |
| `GET` | `/api/v1/knowledge/entries/:entryId/file/content` | 下载文件型条目当前二进制。 |

文件上传接受 `application/pdf`、`.docx`（`application/vnd.openxmlformats-officedocument.wordprocessingml.document`）、`application/msword`、`text/plain`、`text/markdown`,上限 20 MB。提取失败诚实落在文件行上（`extractionStatus: "failed"` + 可读 `extractionError`）,不阻断上传。

发布、编辑已发布、归档与恢复会把该条目的索引刷新异步入队（分块 + 可选嵌入）;索引 worker 只物化 **published** 修订,草稿与已归档条目永远不可检索。小泽通过注册的只读工具 `knowledge.search` / `knowledge.getDocument` 落地知识问题,工具在调用用户的 AuthContext 下执行（`knowledge:view` + 组织隔离）,返回可深链到 `/knowledge?entryId=…` 的引用负载。审批门控写工具 `action.createKnowledgeDraft`（入参:`title`、`contentMarkdown`、`tags`、可选 `sourceLogId`）经 DB 落库审批链创建**新的** Agent 来源草稿——先中断等待人工明确批准,再在调用用户的 AuthContext 下执行（`knowledge:edit`）,创建会话记录在 `sourceSessionId` 上;草稿在 `/knowledge-admin` 队列或由沉淀工程师本人发布前不进入检索。

条目负载的 `parameterReferences` 按 `kind` 区分身份：canonical 引用携带 `definitionId`、`availability`、Catalog 生命周期与已授权显示字段；不可用定义保留精确 ID，显示字段可为空。历史 `legacy-spec` 引用保留 `specId` 和 S7 映射状态，不猜测改指向。`knowledge.getDocument` 的 `referencedParameters` 同样区分两类身份，不把不可用 ID 或历史映射说成当前定义名称。

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

查看要求 `canViewParameters`；上传、新版本、文件历史回滚、同步与冲突裁决要求 `canAdminParameters`。裁决服务层另校验 `canReviewParameters`。版本列表项可带 `createdByDisplayName`（来自 `users.name`；未知则省略）。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/projects/:projectId/parameter-files` | 列出项目托管文件及当前版本元数据。 |
| `POST` | `/api/v1/projects/:projectId/parameter-files` | 上传新文件或首版。返回 `201 { item, version }`。 |
| `POST` | `/api/v1/projects/:projectId/parameter-files/:fileId/versions` | 上传下一版本。返回 `201 { item }`（版本 DTO）。 |
| `GET` | `/api/v1/projects/:projectId/parameter-files/:fileId/versions` | 单文件版本历史。条目可含 `createdByDisplayName`。 |
| `POST` | `/api/v1/projects/:projectId/parameter-files/:fileId/versions/:versionId/rollback` | 插入新的当前版本（`origin=rollback`），复用所选历史 blob，不倒带历史。已经是当前版本 → `409 CONFLICT`。返回 `201 { item, file }`。需要 `canAdminParameters`。审计 `parameter-file-rollback`。 |
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
| `POST` | `/api/v1/projects/:projectId/parameter-file-conflicts/bulk-resolve` | 仅对合格冲突 ID 应用同一裁决。请求体：`{ "resolution": "file" \| "ui", "conflictIds", "reason?" }`。返回 `{ resolved, skipped }`。合格批次为原子操作（ADR-0027）：执行中途意外失败会回滚整批并使请求失败，绝不留下半生效批次。 |

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

省略 `versionId` 时使用文件 `currentVersionId`。`origin=writeback` 的版本在同步时不生成新草稿（`skipped: true`）。语义身份 cutover 之后，sync 按解析索引路径匹配项目参数绑定（逻辑节点 locator + 属性 key，限定在该文件版本的 occurrence 图），并在绑定上 upsert `file_sync` 草稿；不再查询已退役的 `project_parameter_values` / `parameter_definitions`。冲突行写入 `project_parameter_binding_id` 与 `parameter_spec_id`；列表/裁决 DTO 仍通过 `projectParameterValueId` / `parameterDefinitionId` 暴露它们。

审计动作：`parameter-file-upload`、`parameter-file-rollback`、`parameter-file-sync`、`parameter-file-conflict-open`、`parameter-file-conflict-resolve`、`parameter-writeback-to-file`。

### DTS 整文件来源审核

既有候选创建接口增加 `{ intent: "source_revision", fileId, expectedCurrentVersionId, expectedConfigRevisionId, clientMutationId, fileName, contentBase64 }`。固定单份非空且最多 2 MiB 的 DTS 及完整配置成员上下文，不改变活跃状态。候选 source-preview 返回 `kind: "source_revision"`、精确 `before` / `after`、诊断、影响、证明令牌及当前合资格的软件审核人。既有 source-review 提交另需范围内的幂等键；同键同内容重放，不同内容冲突。每个配置集最多一个待审来源请求。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/v2/projects/:projectId/source-revision-requests?mine=true&status=pending` | `mine=true` 读取本人提交，否则读取分配给当前合资格审核人的请求。 |
| `GET` | `/api/v2/projects/:projectId/source-revision-requests/:requestId` | 按权限读取固定源码差异、上下文摘要、影响及应用后的文件/配置回执。 |
| `POST` | `/api/v2/projects/:projectId/source-revision-requests/:requestId/review` | `{ decision: "approve" | "reject", proofDigest, note? }`；要求当前指定审核人且不能自审。 |
| `POST` | `/api/v2/projects/:projectId/source-revision-requests/:requestId/withdraw` | 提交人撤回待审请求，不更新活跃来源。 |

`source_revision` 是独立且不可变的请求类型，支持注释、未登记内容等零参数目标的变更；保留旧 single/batch 约束与独立分发。固定证明包含精确文件、配置和成员版本、摘要、Catalog/组织登记、Binding/值/来源 pin 集合、身份连续性及新增项计划。提交和批准都重新核对当前权限、版本及上下文；历史固定定义使用其历史 Catalog 快照校验，当前 Catalog 指针变化要求重新预览。登记校验暂在事务内持有表级共享锁，会串行化登记写入；按组织设置版本栅栏是已记录的扩展方向。

值校验保留 Catalog 的厂商 bytes 投影：string schema 接受合法字节字面量或纯整数字节宽度 8 的 cells，按 DTS 文本校验。数值 schema 继续按精确整数值及边界校验；此投影不把普通数值 cells 或引用放宽为字符串，也不跳过未变化的已登记值。

批准通过既有 owner，在同一事务推进文件/配置版本、结构 occurrence、稳定 Binding、值、pin、历史、审计和经校验的回执。对象存储或关系写入失败均不留下部分活跃状态。实际生效的绑定属性被删除时，使用 `dts-source-absence` / `dts-source-absence-v1`，锚定真实修改前 occurrence 和修改后配置，不伪造删除节点或删除历史。当前重新加入同一来源中已终止删除的绑定 occurrence，会在预览阶段返回 `source-occurrence-restoration-requires-mapping`，需显式身份映射流程。下载保留经确认的精确字节，包括注释、数值写法、BOM 和一致换行。本流程不重命名全局定义、不改变成员、不发布基线，也不写设备。

### 结构化读取与 DTS 检索（P3）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/projects/:projectId/parameter-files/:fileId/versions/:versionId/structure` | 从 `dts_*` 读取某一文件版本的结构化模型（请求内不重解析）。返回 `{ nodes }`；节点含类型化 `properties`（`valueType`/`rawText`/`normalizedValue`）、`phandleRefs`，以及 ingest 时写入的可选 `source` 定位器（`startOffset`/`endOffset`/`startLine`/`startColumn`/`endLine`/`endColumn`）。需要 `parameter:view`。 |
| `GET` | `/api/v1/projects/:projectId/dts-search` | 在项目当前文件版本的 `dts_*` 上检索。查询：`q`（必填），可选 `by` = `path`\|`address`\|`label`\|`compatible`\|`value`\|`file`（省略 `by` 表示全维度含文件名）。返回 `{ hits }`，可含 `source` 定位器。需要 `parameter:view`。 |
Migration `0092_dts_structural_spans.sql` 在 `dts_nodes` / `dts_properties` 上持久化源码定位器，并在 structure/search 读取中返回（不重解析）。

两个读取接口均接受可选 `navigationScope=organization`。Structure 继续返回完整 `nodes`，并增加 `navigation`：成功为 `{ status: "ready", catalogReleaseId, managedNodePaths }`，不可用为 `{ status: "unavailable", reason: "catalog-unavailable" | "registration-unavailable" }`。成功路径只标识直接匹配到有效 Catalog 主体、且在认证组织中有效登记的节点，包含禁用实例及尚无参数值的实例。识别复用 Catalog 的 compatible、正式别名规则，仅在节点未声明 compatible 时按节点名称回退。客户端补齐实际 DTS 祖先作为导航路径，并隐藏仅作祖先的节点属性；保留祖先不会保留其无关后代。成功空集合与读取不可用必须区分。文件结构使用请求中的版本，组织登记使用当前状态，不是由 `catalogReleaseId` 固定的历史组织状态。

范围内搜索在既有项目搜索范围中，对每个现行文件版本应用同一规则。节点结果可包含结构祖先，属性结果只属于直接命中的节点；没有节点命中时仍可返回文件名结果。Catalog 或登记读取不可用时，范围内搜索返回 `500`（`INTERNAL_ERROR`）；未指定范围的读取保持原有行为。组织和操作者来自服务端认证上下文，不接受查询参数指定。导航范围仅影响展示，完整源码、编辑校验及授权仍由原有规则决定。

| `POST` | `/api/v1/projects/:projectId/dts-structured-edits/submit` | 将一条或多条结构化 DTS 属性编辑提交为参数提交轮次。请求体：`{ edits: [{ fileId, nodePath, propertyName, rawText, reason? }], reason?, assignees? }`。按 `source_file_name`/`source_node_path` 映射到 `project_parameter_value`，创建草稿并提交 CR；`targetValue` 使用 `rawText`（非 `normalizedValue`）。返回 `201 { item }`（含 CR 项的提交轮次）。需要 `parameter:edit`；敏感节点规则适用（关键路径需 `parameter:edit-critical`；Agent 写 critical 节点拒绝）。审计：`parameter-structured-edit-submit`。 |

### 变更请求 impact 扩展（P3）

`GET /api/v1/parameter-change-requests`（及相关详情）暴露 `impact[]`，kind 为 `module` \| `test` \| `parameter` \| `phandle` \| `compatible` \| `config-set`。项目值结构化绑定时，服务端附加 phandle / compatible / config-set 对等项；否则保留遗留模板。

敏感节点守卫作用于提交/合入/回写：缺少 `parameter:edit-critical` → `403`；Agent 写 `critical` 规则 → `403` 且 `requireHuman: true`，审计 `parameter-sensitive-node-denied`。

## 配置集、发布基线与校验门禁（P2）

板级配置集把项目下的参数文件聚合为一个可构建单元；发布基线对配置集做快照，支持对比/回滚/发布；校验门禁在基线发布前运行 `dtc`。以下路由均要求 `canAdminParameters`（`admin:access`）；非 Admin 调用返回 `403`。Admin UI 在 P3 提供（`/parameter-admin/projects` 的 `ConfigSetBaselinePanel`）。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/projects/:projectId/workflow-role-bindings` | 列出项目的审核工作流角色绑定（`hardware-committer`、`software-committer`、`software-user`）、各池就绪状态与候选用户。仅 Admin（`users:manage`）。 |
| `PUT` | `/api/v1/projects/:projectId/workflow-role-bindings/:userId` | 使用 CAS 并发控制更新单个用户的项目审核工作流角色。请求体：`{ roles: RoleId[], expectedRoles: RoleId[] }`。仅限定在目标项目内生效，不影响组织级角色。 |
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
| `GET` | `/api/v1/projects/:projectId/baselines/:baselineId/restore-preview` | 预览恢复 blast radius（不应用）。返回 `200 { item }`，含每成员 from/to、`action`（`noop`\|`rollback-pointer`）、服务端提供的 `canonicalOwned`、`driftedCount` 与 `releasedBaselineUnchanged: true`。所有权覆盖成员当前配置集及基线配置集，与整源变更围栏一致。任一成员受规范所有权约束时，工作台只展示只读漂移，并说明需要已准备并批准的规范源事务。 |
| `POST` | `/api/v1/projects/:projectId/baselines/:baselineId/rollback` | 仅对 legacy 所有权下的漂移成员原子恢复（新建 `origin=rollback` 指针版本）；不删历史；不改变当前已发布 tip。返回 `200 { item: { baselineId, restored } }`。规范源或规范配置集在变更前被 `409 CONFLICT` 拒绝；可信拒绝审计在回滚后仍保留。 |
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

**ParameterSpec 身份（ADR-0013 / ADR-0014 / ADR-0017）：** 稳定目录身份为归属范围 + `attributionSubjectId`（驱动登记或节点类型定义）+ `property_key`。`parameter_specs.id` 是**代理键**；find-or-create 按上述列查找，哈希 id 只在即将插入新行时生成。`specification_key` 由三元组**派生**，身份纠错时在同一事务中重写（ID-R4），不要当作可独立编写的字段。列表/详情 DTO 的 `lifecycle` 反映定义层 `definition_lifecycle`（`draft` \| `active` \| `deprecated`）。版本化内容在 `parameter_spec_versions`（`version_status`：`draft` \| `active` \| `superseded`）；`currentVersionId` / `currentVersion` 在有活跃内容时指向当前版本行。同 subject + key 时组织定义覆盖平台定义。

默认列表是生效目录投影（ADR-0039）。`view=effective`（省略 `view` 时的默认值）按规范驱动主体 + 属性键只返回一条启用且当前版本的定义，并执行组织 active > 平台 active 优先级；主体、驱动 schema 与组织驱动组放置不完整时不返回。`view=governance` 返回原始归属/生命周期/版本行，包含 draft、deprecated、被遮蔽成对行及不完整放置，用于修复与审计，不得用作 matcher override。每行还可带 `effectiveScope`、`overrideOfSpecId`、权威分类放置 `declaredPlacement` 与仅表示 binding 证据的 `observationState`。未匹配/歧义 ingest 只保留审核证据，不创建已识别 binding。扩展/收缩数据修复命令为 `npm run parameter-definitions:reconcile -- --dry-run|--apply`，独立完整只读门禁为 `npm run parameter-definitions:check`。`--catalog-only` 只选择自托管候选就绪所需的驱动目录子集，排除 node-type taxonomy 和项目 binding tip 检查，不得替代配置发布的完整门禁。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/v2/parameter-specs` | 按稳定 subject + 属性键列出参数规格。默认 `view=effective` 只返回唯一的启用/当前生效定义；`view=governance` 暴露供 Admin 修复的原始 draft/deprecated/被遮蔽/不完整行。每项含 `attributionSubjectId`、`lifecycle`（定义层）、`currentVersionId` / `currentVersion`、`propertyKey`、仅作展示的 `driverModule`（有主体时取主体 displayName）、`effectiveScope`、可选 `overrideOfSpecId`、权威 `declaredPlacement`、`observationState`，以及 `attributionModules: Array<{ id, name, kind }>`——经 binding 实测到的归属单元去重集合，由服务端计算。`attributionModules` 为空表示尚未实测。筛选：`?q=&sourceKind=&lifecycle=&attributionSubjectId=&propertyKey=&view=effective|governance`。规格层不重新执行 compatible 或 node-type 匹配（ADR-0010）。 |
| `POST` | `/api/v2/parameter-specs` | Admin 为 `attributionSubjectId` + `propertyKey` 创建本组织 **draft** 定义（subject 须为 driver-registration 或 node-type-definition）。请求体须含 `reason`；可选 `displayName`、`description`、`documentation`、`valueShape`、`constraints`、`units`、`exampleValue`。结构属性键（ADR-0003）→ `400`。组织内 subject+key 重复 → `409`。覆盖平台同名定义须 `overridePlatform: true`，否则 `409` 且 `confirmRequired`。返回 `{ item }`（`201`）。审计：`spec-draft-created`。 |
| `GET` | `/api/v2/parameter-specs/:specId` | 规格详情默认走生效投影（`view=effective`）：被遮蔽、有歧义、放置不完整或非胜出层的 id 返回 `404`；Admin 修复需要显式使用 `view=governance` 读取原始/历史行。两种视图都返回定义层 `lifecycle`、版本指针、`attributionSubjectId`、example/default/policy 分字段（`exampleValue` 仅示意）、生效范围/放置字段；存在开放 cutover 时含可选 `cutover` 摘要（状态、版本指针、影响计数）。 |
| `PATCH` | `/api/v2/parameter-specs/:specId` | Admin 对 **active** / **deprecated**（或平台全局）定义做原地**文档类**更新——draft 不可 patch（`409`，应走 activate）。请求体：`documentation`、`reason`，可选 `displayName`、`description`、`exampleValue`，以及可原样重申的 `valueShape` / `constraints` / `units`。若 `valueShape`、`constraints` 或 `units` **发生变化** → `409`，`details.code = semantic-edit-requires-successor`（ADR-0032）；相等性按存储版本的 `stableJson`，省略的键不算变更。语义改走 `POST .../activate` 铸造后继版本 + cutover。文档写仍更新当前 `parameter_spec_version` 行。**不接受** `policyTarget`（产品作用域；见 TD-055）。审计：`spec-updated`。 |
| `GET` | `/api/v2/parameter-spec-review-tasks` | 组织范围、分页、按状态筛选的规格审核队列（`?status=&limit=&cursor=`） |
| `POST` | `/api/v2/parameter-specs/:specId/activate` | Admin 激活本组织 **draft**，或在 **active** 且内容变更时记录语义后继版本（ADR-0014）。请求体须含完整 `valueShape`、`constraints`、`documentation`、`reason`；可选 `displayName`、`description`、`units`、`exampleValue`、`coverageClaim`（subject 绑定 draft 且无既有 claim 时必填）。`constraints` **替换**已存储对象（未出现的键会被删除）。**本版本 `coverageClaim.kind` 仅支持 `overlay-property`**（`pinned-schema-property` **不支持**；覆盖声明保持 overlay-only）。平台全局 draft（`organization_id IS NULL`）→ `403`。跨组织 → `404`。形状缺失/冲突 → `400`/`409`。已废弃 → `409`。**分阶段切换：** active 定义内容变更时插入 draft 后继版本与 `parameter_spec_version_cutover_run`。当前版本 tip 无 binding 时**自动 finalize**（旧版 `superseded`、后继 `active`）。存在 tip binding 时运行态保持 `preparing` 直至 prepare/finalize。审计：`spec-activated`（自动 finalize 时含 cutover 审计）。 |
| `GET` | `/api/v2/parameter-specs/:specId/cutover` | 开放 cutover 影响摘要（`{ item: cutoverSummary }`）。无开放 run → `404`。查看权限。 |
| `POST` | `/api/v2/parameter-specs/:specId/cutover/prepare` | Admin 将 pending cutover 项标为 `ready`（复用 base revision id，不插入第二行 revision）。可选请求体 `{ reason? }`。全部就绪后 run → `ready`。审计：`spec-version-cutover-prepared`。 |
| `POST` | `/api/v2/parameter-specs/:specId/cutover/finalize` | Admin 在 prepare 后 finalize：更新 binding revision 的 `parameter_spec_version_id`、废弃旧版、激活后继。请求体 `{ reason }`。仍有 pending/incompatible → `409`。审计：`spec-version-cutover-finalized`。 |
| `POST` | `/api/v2/parameter-specs/:specId/deprecate` | Admin 在**定义层**软废弃（`definition_lifecycle → deprecated`；当前版本仍可供解析/发布读取）。本组织：组织 Admin；组织 Admin 对平台全局 → `403`；**`platform-admin` 可废弃平台全局定义**（ADR-0011 修订）。请求体 `{ reason }`。lifecycle 非 `draft`/`active` → `409`。审计：`spec-deprecated`。 |
| `POST` | `/api/v2/parameter-specs/:specId/restore` | Admin 恢复已废弃定义：本组织由组织 Admin 恢复；平台全局由 **`platform-admin`** 恢复。有 `activated_at` 则回到 `active`，否则回到 `draft`。请求体 `{ reason }`。非 `deprecated` → `409`。审计：`spec-restored`。 |
| `POST` | `/api/v2/parameter-specs/:specId/reattribute` | Admin 身份纠错：在**任意**生命周期（含有引用的启用态）重写 `attribution_subject_id`（ADR-0017、D-ID-2）。请求体 `{ attributionSubjectId, reason }`。同一事务重写派生的 `specification_key` 与 `schema_namespace`（ID-R4）。本组织：组织 Admin；组织 Admin 对平台全局 → `403`；**`platform-admin` 可纠错平台全局定义**（与废弃/恢复同一归属划分，ID-R5）。目标三元组已被占用（含库默认视图隐藏的**已废弃**阻挡方）→ `409`，`details: { parameterSpecId, lifecycle }`。若 DTS 属性已链接到另一个主体的 `DriverSchema`，也返回 `409`，应使用有审计的定义对账流程一次修复 schema/property 整体；未分配主体的 DTS 驱动根则在同一事务中同步更新 schema 主体。审计：`spec-reattributed`。 |
| `POST` | `/api/v2/parameter-specs/:specId/rename-property-key` | Admin 身份纠错：仅在 **`referenceCount = 0`** 时重写 `property_key`（D-ID-2）。请求体 `{ propertyKey, reason }`。派生列重写与再归属相同。组织 Admin vs `platform-admin` 归属划分同再归属（ID-R5）。仍有引用 → `409`，`details: { parameterSpecId, referenceCount }`。三元组冲突 → `409`，`details: { parameterSpecId, lifecycle }`（含已废弃）。审计：`spec-property-key-changed`。有引用的改名**不是**本路由，也**不是**编辑器行内字段（ADR-0034 / TD-117）。 |
| `POST` | `/api/v2/parameter-specs/:specId/property-key-cutover/preview` | Admin **只读**预检：有引用的 `property_key` 源文件改写 cutover（ADR-0034 / TD-117）。请求体 `{ propertyKey }`。返回 `{ item }`：`fromKey`、`toKey`、`referenceCount`、`writesCatalog: false`、`writesSource: false`、`inlineRenameEligible`、`startBlockers`（`triple-collision`、`open-version-cutover`、`open-property-key-cutover`），以及 `locations`（binding tip + 可选 occurrence，`status`：`would-rewrite` \| `already-new-key` \| `missing-from-source` \| `no-occurrence` \| `conflict`）。**不**启动 run、不写草稿/CR、不改源、不改 catalog 三元组。组织 Admin vs `platform-admin` 归属划分同改名。结构键或与当前键相同 → `400`。与版本 cutover 的 `POST .../cutover/prepare` 不是同一条作业。 |
| `POST` | `/api/v2/parameter-specs/:specId/property-key-cutover/start` | Admin 对 `referenceCount > 0` 的定义启动属性键 cutover。请求体 `{ propertyKey, reason }`。持久化 `from_key` / `to_key`，并按预检位置为每个 binding 建项（`pending` / `skipped` / `incompatible`），身份复用现有 binding / occurrence。`writesCatalog` 与 `writesSource` 仍为 `false`。零引用 → `409`（走 `rename-property-key`）。三元组冲突、开放版本 cutover、或已有开放属性键 cutover → `409` `{ startBlockers }`。审计：`spec-property-key-cutover-started`。 |
| `GET` | `/api/v2/parameter-specs/:specId/property-key-cutover` | Admin 读取**开放**的属性键 cutover run（`{ item }`）。项带 `configSetId` / `fileId` / `fileName` / `nodePath`，对应现有配置工作台候选 URL（`configSet` + `sourceMode=candidate` + `candidate` + `inspector=file`）。`stagedRewrite.status` 是文件候选的**实况**（`ready`、`active`、`abandoned`、`missing` 等），不是 prepare 当时的快照。不激活候选、不写现行源。无开放 run → `404`。 |
| `POST` | `/api/v2/parameter-specs/:specId/property-key-cutover/prepare` | Admin 对 `would-rewrite` 项经现有**参数文件候选**接缝暂存源改写（旧键 → 新键，raw value 不变）。请求体 `{ reason? }`。只建可合入草稿，**不**激活现行源、**不**改 catalog 三元组（`writesSource: false`，有候选时 `stagedSource: true`）。项变为 `ready`，并带 `fileId` 与 `stagedRewrite: { kind: "file-candidate", id, status }`。源里已是新键（或 binding 已不在）→ 诚实 skip；冲突 / 缺失 / 无 occurrence 保持 `incompatible`。三元组冲突或开放版本 cutover → `409` `{ startBlockers }`，不建候选。审计：`spec-property-key-cutover-prepared`。 |
| `POST` | `/api/v2/parameter-specs/:specId/property-key-cutover/finalize` | Admin 在每个活位置都是 `already-new-key` 或诚实 skip 后 finalize。请求体 `{ reason }`。失败关闭：三元组冲突或开放版本 cutover → `409` `{ startBlockers }`；仍有 pending / incompatible（旧键还在源里）→ `409` `{ blockingItems }`。同一事务重写 `property_key` 与派生的 `specification_key` / `schema_namespace`（与零引用改名相同）。不设常驻 alias。审计：`spec-property-key-cutover-finalized`。`referenceCount > 0` 时行内 `rename-property-key` 仍为 `409`。 |
| `POST` | `/api/v2/parameter-spec-review-tasks/:taskId/resolve` | Admin 决议规格审核（`parameterSpecId` 须为本组织或全局，**或** 未匹配任务使用 `createSpec: true`）。服务端经租户作用域 join 校验 project/revision/occurrence/logical node 证据后应用决议——不得单独信任 raw evidence ID。`createSpec: true` 创建本组织 **draft** 规格（从 occurrence AST 推断类型）并返回 `draftCreated` 与须先激活的提示。仅 **active** 且约束完整的规格可 resolve/release。`resolved` 在同一事务中应用 occurrence→spec→binding 并持久化可复用 matcher override（作用域：`compatible` + **节点 locator 指纹** + 属性键）。库内决议若属性键与 occurrence 不一致，须显式 `confirmPropertyMismatch: true`，否则服务端拒绝。`dismissed` 失败关闭：不创建 binding，发布/校验仍阻断被 dismiss 的属性。审计：`parameter-topology-governance` / `spec-review-resolved`。 |
| `GET` | `/api/v2/projects/:projectId/config-sets/:configSetId/revisions` | 列出该配置集非 `resolving` 的配置修订，最新在前（`{ items: ConfigRevisionSummary[] }`）。需要 `parameter:view`。项目/配置集缺失或配置集属于其他项目 → `404`。这是配置工作台门禁的真实修订来源；客户端不得发明教学 id。 |
| `GET` | `/api/v2/projects/:projectId/config-sets/:configSetId/revisions/:revisionId/topology` | 源树或生效树（`?view=source\|effective`）。节点可含派生 `enablement`（`selfEnabled`、`override`、`reachable`、阻断祖先标签）——不是参数 binding。未知修订 id → `404`（别名 `current`/`latest`/`head` 解析为已列出的 head）。 |
| `GET` | `/api/v2/projects/:projectId/parameter-bindings` | 稳定项目绑定 |
| `GET` | `/api/v2/identity-mapping-tasks` | 身份映射任务列表（`?projectId=&status=`，`status` 为 `open` \| `resolved` \| `dismissed` \| `new_identity`）。项含 `taskKind`（`identity-ambiguity` \| `singleton-cardinality`）、候选与证据。 |
| `POST` | `/api/v2/identity-mapping-tasks/:taskId/resolve` | Admin 确认/驳回/声明新身份。请求体 `{ decision: resolved \| dismissed \| new-identity, reason, selectedLogicalNodeId?, confirmAllCandidates? }`。`resolved` 须 `selectedLogicalNodeId` 属于候选。对已 `resolved` 歧义重复同一 id 为幂等；改选另一候选只在已保存原选择/上一节点连续性、候选属于同一组织/项目/修订，且相关节点没有下游草稿、提交项或设备操作时执行受保护 re-resolve，否则返回 `409` `identity-mapping-migration-required`；不存在反向 undo 或 reopen。多候选 `new-identity` 须 `confirmAllCandidates: true`。`singleton-cardinality` 任务拒绝身份决议（`409` `singleton-cardinality-conflict`）——须在登记/拓扑侧修复。`dismissed` 与开放 `singleton-cardinality` 仍为**发布阻断**；`resolved` 与 `new_identity` 清除阻断。审计：`identity-mapping-resolved` / `identity-mapping-dismissed` / `identity-mapping-new-identity`（re-resolve 元数据含前后 id 与 `reResolved: true`）。 |
| `POST` | `/api/v2/identity-mapping-tasks/:taskId/reopen` | Admin 将 `dismissed` / `new_identity` 的 `identity-ambiguity` 任务重开为 `open`（`{ reason }`）。修订重新置为 `needs_mapping`。已应用的 `resolved` 映射走受保护 re-resolve，不可 reopen（`409`）。审计：`identity-mapping-reopened`。 |
| `POST` | `/api/v2/projects/:projectId/config-revisions/:revisionId/validate` | 失败关闭工具链校验。再次校验失败会**撤销**此前的 `validated` 标记；开放身份映射、**已驳回**身份映射、**singleton-cardinality** 映射阻断，或被 dismiss 且未匹配的规格审核，均 fail-closed。软通过/warn（硬性 dtc 通过但仍有工具链诊断，或 warn 模式）可返回 `requiresConfirmation: true`；配置工作台发布 ConfirmDialog 必须确认该标志。 |
| `POST` | `/api/v2/projects/:projectId/parameter-bindings/:bindingId/drafts` | 类型化绑定草稿 + **精确 occurrence** Config Set 回写：锁定 binding revision、occurrence、文件版本、checksum 与 CST span（默认强制 schema；**base** binding revision 不可变；合入值在 **candidate** revision）。身份过期 → `409`。Cutover 后语义合并在缺 `objectStore`、项目范围、write lock 或真实 DTC 工具链时失败关闭——生产路径无 `WISEEFF_WRITEBACK_SKIP_TOOLCHAIN`。Cutover 后草稿不得再创建 shadow `project_parameter_values` / `parameter_definitions`。 |
| `POST` | `/api/v2/projects/:projectId/node-enablement-drafts` | 共享工作 tip 管线上的节点启用草稿。请求体：`{ logicalNodeId, baseRevisionId, target: force-enabled\|force-disabled\|unstated, reason, acknowledgeNonstandard?, spellingOverride? }`。在锁定的 overlay 文件上写入或删除 DTS `status`；与 binding 草稿共享 candidate revision 协调（混用 tip → `409 mixed-working-tips`）。要求 `parameter:edit`；适用 `dts_sensitive_node_rules`。审计：`parameter-topology-governance` / `enablement-changed`。 |
| `GET` | `/api/v2/parameter-modules` | 组织模块注册表：`{ item: { modules, mappings } }`。模块 DTO 含 `kind`、`origin`、`sourceKey`、`attributionSubjectId`（驱动组/节点类型目录 subject）、`effectiveImportance`、`definitionCount`（子树内互异规格数 / 定义数）、`parameterCount`（子树绑定数 / 实测处数），以及 `name`、`parentId`、`sortOrder`、`importance`。两计数字段是不同事实，不可合成一个。定义库 `referenceCount`（引用数）是同一绑定事实收窄到单定义。模块 CRUD 仍走 v1。 |
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
| `GET` | `/api/v2/platform/driver-schemas/promotion-candidates` | 已退役，返回 `410 GONE` 及规范目录 successor 链接；不执行查询、晋升或撤销。 |
| `POST` | `/api/v2/platform/driver-schemas/promotions` | 已退役，返回 `410 GONE` 及规范目录 successor 链接；不执行查询、晋升或撤销。 |
| `POST` | `/api/v2/platform/driver-schemas/promotions/:promotionId/revert` | 已退役，返回 `410 GONE` 及规范目录 successor 链接；不执行查询、晋升或撤销。 |

`GET /api/v2/parameter-modules`、`GET /api/v2/parameter-modules/discovery-hints` 和 `GET /api/v2/parameter-modules/driver-registry` 的成功响应携带以下有界旧读取响应头：

```text
Deprecation: true
Sunset: Fri, 31 Dec 2027 00:00:00 GMT
Link: </api/v2/catalog>; rel="successor-version"
Warning: 299 WiseEff "Legacy ParameterModule contract is deprecated"
X-WiseEff-Legacy-Contract: parameter-module-v2
```

`DriverRegistryParseCoverage` 在已覆盖时含 `scope: "platform" | "organization"` 及可选 `shadowedBy[]`（输给所选层级的低优先级匹配）。

`MappingApplyPreview`：`{ affectedBindings, byProject: [{ projectId, count }], fromModules: [{ moduleId, moduleName, count }], toModuleId, emptiedModules, conflicts }`。

**Binding 模块身份（Phase 2，ADR-0010）：** 每条 `project_parameter_bindings` 行持久化非空 `module_id`，外键指向 `parameter_modules(id)`（迁移 `0067`）；浏览唯一键为 `(project_id, logical_node_id, parameter_spec_id, module_id)`。写路径经单一解析器：**compatible → node-type → 未分类根**——绝不为 null。`module_id` 必须指向**驱动组**或**节点类型单元**（或组织未分类根）；业务分类不接 binding。器件实例身份仅为 **`logical_node_id`**——同一驱动的多个实例共享定义、值由实例区分。binding DTO 暴露 `moduleId`；工作台以其为浏览真相源（不做 derive-on-read）。干净切换，无双读兼容层。

值拆分：`exampleValue` / `schemaDefault` / `policyTarget` / `effectiveValue` 分字段；不得折叠为业务 `recommendedValue`。拓扑载荷携带 API provenance（`sourceChain` / occurrence span）；API 模式下客户端不得发明教学回退数据。

Config Set revision 持久化完整 manifest（`entryFile`、`includeSearchPaths`、overlay 顺序、成员角色）。历史 revision 缺失时从钉住的 `dts_config_revision_members` 回填。`manifestState=needs_review` 对校验、类型化编辑、发布、回写失败关闭，直至修复。校验与客户端须重载该 manifest，禁止硬编码 `includeSearchPaths=["."]`。

Dashboard hotspot（`GET /api/v1/parameters/dashboard/hotspots`）对租户绑定项目须同时包含**全局厂商规格**（`organization_id IS NULL`）与本组织规格。

**迁移 CLI（仅维护窗口）：** `npm run parameter-identities:migrate` 支持 `dry-run`（默认）、`--stage-review`（可运维推断暂存事务）、`--finalize --migration-run-id <id>`（原子活动 FK 写入）。Cutover 仅接受 `finalized` 运行。见 `docs/runbooks/parameter-identity-cutover.md`。

**第四轮证据：** 厂商 dt-schema 在黄金 DTB 上通过真实 `dt-validate`；黄金拓扑计数 **176** 属性 occurrence / 排除结构键后匹配 **120** / seed **684** 行 `dts_properties`（服务端测试锁定）。审核阻断遵守 `blocker_scope`；matcher override 含 locator 指纹。

**第五轮证据（分支 `fix/parameter-topology-round5-review-blockers`）：** base/candidate binding revision 不可变合入回写；缺 `objectStore`/项目/write lock/工具链时语义合并失败关闭；`parameter_identity_migration_phases` 不可变 phase 行与 `migration_run_id` 任务关联；租户作用域 resolve；手工规格 draft→`activate`→resolve；验收辅助 `acceptanceTaskLookup` / `semanticFixtureCleanup`（无 `items[0]` fallback）。

`GET /api/v1/projects/:projectId/config-sets` 只读调用要求 `parameter:view`，供普通用户拓扑工作区加载；Config Set 修改、baseline、export 与 release 仍仅限 Admin。`GET /api/v1/projects/:projectId/parameter-workflow-assignees` 要求 `parameter:edit`，返回 `{ item: { hardwareCommitters, softwareCommitters, softwareUsers, ready, missingRoles } }`，仅返回调用者组织、目标项目、active 且角色匹配的硬件提交人/软件提交人/软件用户；`ready` 在三个角色池均有候选人时为 true，缺少角色时为 false 并在 `missingRoles` 中列出具体缺失角色名；提交 API 会在事务内基于行锁再次校验所选 ID 与有效执行权限。

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
| `POST` | `/api/v1/debugging/nodes/read` | 读取节点；可选 `relatedOperationId` 关联一次写后只读重试 |
| `POST` | `/api/v1/debugging/nodes/write` | 写入 RW 节点；分别返回写命令结果与回读观测结果 |
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
| `POST` | `/api/v1/agent/xiaoze/suggest` | 只读主动建议（opt-in）；请求 `{ context?: { projectId?, projectName?, pageKey?, path? } }`，响应 `{ suggestions: [{ id, tone, headline, meta?, citations }] }` |
| `GET` | `/api/v1/agent/xiaoze/threads` | 列出持久化 thread |
| `POST` | `/api/v1/agent/xiaoze/threads` | 创建 thread |
| `GET` | `/api/v1/agent/xiaoze/threads/:threadId` | thread 详情 |
| `PATCH` | `/api/v1/agent/xiaoze/threads/:threadId` | 更新 thread 元数据 |
| `DELETE` | `/api/v1/agent/xiaoze/threads/:threadId` | 删除 thread |

suggest 的畸形请求返回 `400 VALIDATION_FAILED`；成功响应若与合同漂移，前端失败关闭为空列表。五类 WiseEff CUSTOM frame 都有具体 Zod payload/envelope schema，并由测试直接校验 `xiaozeTurnStream` 的真实产物。流传输仍由 `@ag-ui/client` 处理，不增加 fetch wrapper、不替换 parser；通用 AG-UI SSE run 响应仍不按普通 JSON response 建模。

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
