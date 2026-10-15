# 审计中心设计

> English: [English](../../design-docs/2026-06-17-audit-center-design.md)

本文定义 WiseEff 审计体验：证据模型、信息架构、API 期望与分阶段交付。当前实现以本文为准，取代 `2026-05-10-parameter-admin-redesign-design.md` 中的审计相关描述。

## 问题

参数管理后台的审计弹窗目前只是一条扁平时间线（严重度、一行摘要、操作人、相对时间），无法展示结构化 metadata、trace 关联、筛选，也未接入 API。后端已在参数、日志、调试、用户与 Agent 等域写入审计，但产品界面无法支撑运营调查。

## 目标

| 目标 | 说明 |
| --- | --- |
| 完整性 | 展示服务端已记录的生产写入与高风险只读 |
| 可调查 | 按操作人、项目、应用、类型、严重度、目标、trace、时间筛选 |
| 可理解 | 按事件类型渲染结构化 diff 与业务标签 |
| 可追溯 | 串联提交 → 审阅 → 合入 → 导入 → 调试写入 → 回滚 |
| 合规就绪 | 对齐 `docs/security/audit-retention.md` 的保留与导出要求 |

## 非目标（本设计范围外）

- 不可变 WORM 存储或定时导出（M3 阶段）
- 跨组织审计联邦
- 事件级撤销（与 Undo 机制分离）
- 用审计行替代工作流状态（`workflowTrail`）

## 体验分层

```text
L1 上下文审计 — 嵌入参数、提交单、日志、调试、Agent 页面
L2 模块审计   — 各 Admin 页的「审计」入口
L3 组织审计中心 — Admin 专属 /audit 统一检索（M2）
```

M1 交付参数管理后台升级的 **L2 模块审计**（API 接入 + 详情钻取）。M2 交付 `/audit`。M3 交付导出与保留策略。

## 信息架构

### 参数管理后台（M1）

- 工具栏 **审计** 打开弹窗（非常驻抽屉）。
- 布局：筛选栏 + 可选事件列表 + 详情面板。
- Mock 模式：`app=parameter-admin` 的 mock 事件。
- API 模式：`GET /api/v1/audit-events?app=parameter-management&projectId=...`。
- 保留 `?audit=open` 深链打开弹窗。

### 组织审计中心（M2）

| 路由 | 角色 | 范围 |
| --- | --- | --- |
| `/audit` | Admin | 组织内全部 app |
| 各模块页 | 模块管理员 | 按 app 与项目限定 |

当前 `/audit` 使用 `AdminListPage`，包含限高滚动表格与事件详情弹窗。每行组合展示业务操作及模块/类型、可读对象及项目、绝对/相对时间、操作人和严重度。只保留“加载更多”，每批追加 20 条并保留滚动位置；数量明确标为“已加载”，不冒充结果总数。

搜索支持页面显示的中文名称和内部标识，防抖后执行，也可按 Enter 或失焦提交，并忽略过期响应。紧凑工具栏包含模块、项目与时间窗口；严重度使用共享表头复选筛选，可组合四种读取等级（等级之间取“或”）、查看已选数量，并清除选择恢复全部记录。行数据加载期间保留表头与菜单，允许继续选择。更多筛选支持精确事件类型、对象 ID、链路 ID，以及本地起止时间。加载、无记录、请求失败及重试、手动刷新分别反馈。

`/audit?eventId=...` 可在保留筛选的同时恢复详情，不依赖主列表已加载记录。关闭只移除事件选择，上/下一条浏览已加载记录。关联事件独立分页并提供加载、错误和重试；“查看完整链路”先清除冲突筛选，再应用链路 ID。已知参数对象可进入已有项目/Binding 工作台。技术标识收纳在折叠区，不直接转储任意 metadata。

CSV 按当前筛选跨服务端分页导出，最多 2,000 条。界面声明上限，明确反馈导出完整或截断，以及失败重试。中文名称和原始类型/操作标识分列，转义电子表格公式前缀。

## 事件模型

### 存储（已有）

`audit_events` 含 `organization_id`、`project_id`、`actor_user_id`、`actor_type`、`app`、`kind`、`action`、`severity`、`target_type`、`target_id`、`metadata`、`trace_id`、`created_at`。

### UI 视图模型

前端渲染 `AuditEventView`，由 API `AuditEventDto`（含可选 `actorName`）或 Mock `AuditEvent` 映射而来。

### App 分类

| App | 示例 | 典型 target |
| --- | --- | --- |
| `parameter-management` | 提交、审阅、合入、导入 | change-request、import-batch |
| `parameter-admin` | 定义增删改、批量操作 | parameter-definition（mock/后台 CRUD） |
| `log-analysis` | 上传、重分析、归档 | log-record |
| `debugging` | 读、写、回滚、会话 | debug-parameter、snapshot |
| `agent` | 工具请求、审批、执行 | tool-call、session |
| `user-governance` | 创建、角色、启停 | user |

**命名规则：** API 工作流事件使用 `parameter-management`；Mock 后台 CRUD 使用 `parameter-admin`。UI 筛选需按需包含两者。

### 按 kind 的 metadata 展示要点

| Kind | 关键 metadata |
| --- | --- |
| `parameter-merge` | `fromStatus`、`toStatus`、`note` |
| `parameter-review-advance` / `reject` | 状态变迁、`note` |
| `batch-import` | `summary`、`batchId` |
| `debug-node-write` | `previousValue`、`readbackValue`、`nodePath` 等 |
| Mock `parameter-update` | `previousValue`、`newValue` |

## API 设计

### 列表（M1 扩展）

```http
GET /api/v1/audit-events?eventId=&projectId=&app=&apps=&kind=&severity=&severities=&targetType=&targetId=&traceId=&q=&from=&to=&cursor=&limit=
```

响应含 `items` 与 `nextCursor`；默认 `limit=50`，最大 `100`，按 `created_at desc, id desc`。原样传回不透明的 `nextCursor`，其中保留 PostgreSQL 完整时间精度和事件 ID，避免相同时间记录漏页。兼容旧版纯时间游标，非法游标返回校验错误。响应表示已加载记录，不代表结果总数。

`severities=High,Medium` 匹配任一选中等级，接受一至四个合法等级，优先于旧的单值 `severity` 参数。页面 URL 继续使用 `severity=High,Medium`，旧单值链接保持兼容。加载更多和导出沿用同一服务端筛选。

`eventId` 在相同的管理员、组织权限范围内定位单条事件。读取严重度包含已有的小写 `info`，写入仍限定 `High | Medium | Low`。搜索支持原始标识、共享的模块、事件类型及操作中文名称、系统及 Agent 名称，以及同租户的项目、参数当前名称。`from`、`to` 必须是有效 ISO 日期时间，格式错误或起止倒置时返回校验错误。

可选的 `projectName`、`projectCode`、`targetName` 提供可读定位信息，当前名称不代表历史快照。仅当不可变 Binding 历史明确引用该审计事件，且前后值属于同组织、同项目的 Binding 时，才返回 `evidence` 中的 `previousValue`、`newValue`、`sourceLabel`。省略身份占位值，多参数变更采用带名称的值数组；缺少历史时保持缺失，不以当前值冒充历史证据。左连接保留无法解析目标的审计事件，不修改已存审计记录。

系统写入的 `parameter-bindings / project-value-appended` 事件若具有互相匹配的 `project-value` 目标、`metadata.valueId` 和同租户、同项目的 `metadata.bindingId`，即使缺少历史关联，也可展示该精确不可变值作为新值，但不推断旧值。

历史证据仅展示 JSON 值或值状态实际变化的记录。源版本传播产生的参数值未变历史保持原样存储，在 `sourceLabel` 统计说明，不重复塞入前后值；全部关联历史均未改变参数值时，仅返回该说明，不制造数值变更。

单值证据保留持久化的 `previousValueState`、`newValueState`（`present` 或 `deleted`），多参数命名值保留各自的 `valueState`。删除值保留精确载荷并单独展示状态，不将删除呈现为数字未变，也不以虚构的空值替代载荷。

### 权限（M1）

- `admin:access`：完整列表（当前行为）。
- 模块级只读（`parameter.admin` 等）：M2。

## 用户旅程（摘要）

- **调查高风险合入：** 审计 → 筛选「高」→ 详情看状态变迁与 traceId。
- **追溯导入批次：** 筛选 `batch-import` → 详情看 added/updated/skipped。
- **调试写入回滚：** M2 在调试 Admin 审计中按 session 关联 write 与 rollback。

## 安全

- metadata 禁止存密钥、原始日志正文、完整 prompt。
- 每次写入必须带 `traceId`（HTTP `requestId`）。
- 详见 `docs/security/audit-retention.md`。

## 分阶段交付

| 阶段 | 范围 |
| --- | --- |
| **M1** | 参数 Admin 弹窗：API、筛选、详情、扩展列表 API |
| **M2** | `/audit` 中心、L1 嵌入、模块权限、trace/提交轮次关联 |
| **M3** | 导出、保留策略、不可变导出、审查工作流 |

## 验收（M1）

- API 模式下提交/审阅/合入/导入事件可在弹窗中查看 metadata。
- 点击事件可查看 diff 或状态变迁。
- Mock 模式演示行为保持。
- 测试与浏览器三端截图验证。

## 相关文档

- `docs/design-docs/security-governance.md`
- `docs/security/audit-retention.md`
- `docs/exec-plans/active/2026-06-17-wiseeff-audit-center-m1.md`
