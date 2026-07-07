# 调试与日志分析 — 组织级解耦设计规格

> English: [English](../../../design-docs/2026-07-07-debug-logs-org-scope-decoupling-design.md)

**日期：** 2026-07-07  
**状态：** 已实现（方案 A）  
**决策：** 日志分析与调试平台仅以 `organization_id` 为边界，不再引用参数管理中的 `projects`。

---

## 1. 背景与问题

参数管理域的 `projects` 表（`0002_m1_parameters.sql`）是 M1 工作流的权威实体。当前调试与日志通过以下方式与之耦合：

| 耦合层 | 表现 |
| --- | --- |
| 数据库 | 调试 runtime 表 FK → `projects`；日志 `project_id` 无 FK 留孤儿 |
| API | 上传/列表必填 `projectId`；`requireLog/DebugProjectAccess` |
| 前端 | 全局 `activeProjectId`、TopBar 项目切换、跨页 `?project=` |
| 跨域 | `parameter_reload_bindings` FK → `parameter_definitions` |

导致：删参数项目时行为不一致（参数已级联、调试可能被 FK 拦住、日志留脏数据）。

---

## 2. 目标（方案 A）

1. **调试**与**日志**仅在**组织（tenant）**内隔离。
2. 日志/调试表**不再出现**对 `projects(id)` 的引用。
3. 删除参数管理项目**只影响参数域**。
4. 参数库定义仍为组织级；日志可选保留对参数的**软链接**（无 FK）。

## 3. 非目标

- 新建 workspace / environment 等子范围实体（除非产品后续明确要求）。
- 改变 M1 内部「项目」语义。
- 恢复 `/debugging` 参数重载工作区（TD-032 另议）。
- 移除 `user_role_bindings.project_id`（仍仅服务参数模块 RBAC）。

---

## 4. 目标架构

```text
organization_id（全模块租户边界）
├── 参数管理：projects → project_parameter_values；parameter_definitions（组织库）
├── 日志分析：log_records（仅 organization_id）
└── 调试平台：devices / sessions / debug_nodes（仅 organization_id）

可选弱链接（无 FK）：
  log_records.related_parameter_id → 参数定义 ID
删除：
  parameter_reload_bindings（调试↔参数硬 FK，接口已 410）
```

### 4.1 各域边界

| 域 | 隔离边界 | 项目选择器 |
| --- | --- | --- |
| 参数管理 | organization + project | TopBar / URL `?project=` |
| 日志分析 | organization | 日志页不展示 |
| 调试平台 | organization | 调试页不展示 |

---

## 5. 数据库变更

新迁移：`00xx_debug_logs_org_scope_decoupling.sql`

### 5.1 调试 runtime — 移除 project_id

| 表 | 操作 |
| --- | --- |
| `debugging_devices`, `debugging_targets`, `debugging_sessions` | 删 FK + 删列 |
| `node_operations`, `debugging_snapshots`, `debugging_events` | 同上 |
| `debug_device_leases` | 删 FK + 删列；主键改为 `(organization_id, device_id)` |

索引：用 `organization_id`（+ 状态/时间）替代 `*_project_idx`。

### 5.2 调试目录 — 组织级

移除 `project_id` 列：

- `debugging_parameters`, `debugging_parameter_node_bindings`
- `debug_nodes`, `debug_node_bindings`

**删除表** `parameter_reload_bindings`（跨域 FK，产品面已 410）。

可选：去掉 `debugging_parameters.parameter_definition_id`、`node_operations.parameter_definition_id` 的 FK（历史 ID 作 opaque 文本保留）。

### 5.3 日志 — 组织级

| 表 | 操作 |
| --- | --- |
| `log_file_objects` | 删 `project_id` |
| `log_records` | 删 `project_id`；保留 `related_parameter_id`（text，无 FK） |

### 5.4 数据策略

- 现有 `project_id` 行：**不映射**到参数项目，迁移后直接丢弃该列。
- Seed：日志/设备 fixture 去掉 `projectId`。

---

## 6. API 变更摘要

### 6.1 日志

- 上传 body：**去掉** `projectId`（从 auth 取 org）
- 列表：**去掉** `?projectId=`；保留 status/archive/搜索等
- **删除** `requireLogProjectAccess` / `getAllowedLogProjectIds`
- 响应 DTO：**去掉** `projectId`

### 6.2 调试

- 所有 runtime/admin 路由：**去掉** `?projectId=` / body `projectId`
- **删除** `requireDebugProjectAccess` / reload 相关路由与仓库代码
- 响应 DTO：**去掉** `projectId`

### 6.3 Jobs / Agent / 通知

- Jobs：不再用 log.project_id 做 ACL
- Agent 感知工具：日志/节点查询改为 org 范围
- 通知 deep link：`/logs`、`/node-debugging` **不再带** `?project=`

---

## 7. 权限

| 权限 | 范围 |
| --- | --- |
| `logs:*` | 组织级 |
| `debugging:*` | 组织级 |
| `parameter:*` | 组织 + **项目角色**（不变） |

---

## 8. 前端变更摘要

| 项 | 变更 |
| --- | --- |
| `activeProjectId` | 仅参数管理相关路由 + 参数页 Agent |
| TopBar 项目切换 | 日志/调试/调试管理页**隐藏** |
| `LogsPage` | 上传与列表不绑 project |
| `DebuggingAdminPage` | 目录 CRUD 组织级 |
| 跨页链接 | 日志→参数：用 `parameterId` + `logId`，不要求 `project` |
| Mock | `LogRecord`/`Device` 去掉 `projectId` |

---

## 9. 实施分期

| 阶段 | 内容 | 验证 |
| --- | --- | --- |
| P0 | 本规格 + domain-model | 评审通过 |
| P1 | DB 迁移 + seed | `npm run test:server` |
| P2 | logs/debug/jobs/notifications API | 路由/服务测试 |
| P3 | 前端 state/页面/clients | 组件测试 + playwright-cli |
| P4 | Agent 工具与上下文 | Agent 单测 |
| P5 | 文档与 generated schema | `npm run docs:check` |
| P6 | e2e 验收 | acceptance 脚本 |

**实现分支名：** `feat/debug-logs-org-scope-decoupling`

---

## 10. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 用户习惯「按项目看日志」 | 发版说明：改为组织内可见；未来如需再加 workspace |
| 旧书签带 `?project=` | 忽略未知参数，不强制跳转 |
| `related_parameter_id` 失效 | UI 标注链接过期，无 FK 级联 |

---

## 11. 文档影响矩阵

| 文档 | 动作 |
| --- | --- |
| `docs/design-docs/domain-model.md` | 更新 |
| `docs/design-docs/api-contract.md` | 更新 |
| `docs/FRONTEND.md` | 更新 |
| `docs/generated/db-schema.md` | 重新生成 |
| `docs/zh-CN/design-docs/domain-model.md` | 更新 |
| `docs/product-specs/product-spec.md` | 评审 |

---

## 12. 验收标准

1. 组织内存在日志/调试数据时，仍可删除参数项目。
2. 日志/调试表无对 `projects(id)` 的 FK 或 `project_id` 列。
3. 日志上传、调试建会话无需 `projectId`。
4. 在日志/调试页切换 TopBar 项目不影响数据加载。
5. 相关测试与 build 通过。

---

## 13. 后续独立项

- TD-032 参数重载工作区
- 若产品恢复子范围隔离：新建与 `projects` 无关的 scope 实体
- 历史审计中 log/debug 事件的 `project_id` 清理（可选）
