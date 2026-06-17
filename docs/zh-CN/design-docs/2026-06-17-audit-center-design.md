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

主从布局：左侧虚拟列表，右侧 diff / metadata / trace 链路。

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
GET /api/v1/audit-events?projectId=&app=&apps=&kind=&severity=&targetType=&targetId=&traceId=&from=&to=&cursor=&limit=
```

响应含 `items` 与 `nextCursor`；默认 `limit=50`，最大 `100`，按 `created_at desc`。

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
