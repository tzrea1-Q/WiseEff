# 调试管理后台 HDC/ADB 目录 CRUD 设计

> English: [English](../../../superpowers/specs/2026-06-22-debugging-admin-hdc-adb-crud-design.md)

日期：2026-06-22
状态：已认可，可进入实施计划

## 背景

WiseEff 的节点调试已经支持 HDC 和 ADB 两种协议路径。`/node-debugging` 可以切换协议，并消费带协议 binding 的后端参数 DTO。后端也已经具备 `debugging_parameter_node_bindings`、selected binding，以及协议感知的 session/read/write 流程。

调试管理后台还没有跟上这次演进。`/debugging-admin` 仍然编辑旧的前端 `configDraft.debugParameters` 结构，只暴露单个 `nodePath` 和 `accessMode`，并且在 API mode 下禁止编辑。这会导致后台无法治理运行时现在依赖的 HDC/ADB binding catalog。

本设计将 `/debugging-admin` 升级为后端驱动的调试目录管理台。

## 决策

- 管理完整调试参数目录，不只管理已有参数的 bindings。
- API mode 下以后端数据库作为事实来源。
- 新增用于调试参数和 HDC/ADB 节点 binding 的 Admin CRUD API。
- 保存直接写入数据库。`/node-debugging` 刷新参数列表后生效。
- 默认把删除建模为归档或停用，不做硬删除。
- `/node-debugging` 继续走现有运行时接口 `GET /api/v1/debugging/parameters?protocol=...`。
- 保留 mock/config-draft 行为用于前端 demo 和测试，但不再作为 API mode 后台事实来源。

## 目标

- Admin 用户可以新增、编辑、归档和恢复调试参数。
- Admin 用户可以为每个参数分别新增、编辑、启用、停用和归档 HDC/ADB binding。
- API mode 下 `/node-debugging` 和 `/debugging-admin` 读取同一套后端 catalog。
- 运行时参数列表只暴露启用且当前协议可执行的参数和 selected binding。
- Admin 列表可以展示完整治理状态，包括已归档参数、停用 binding 和缺失 binding。
- 参数归档后，历史操作、审计记录、快照和回滚证据仍然可理解。

## 非目标

- 本次范围不加入草稿、审核或发布工作流。
- 不把硬删除作为后台常规动作。
- 不允许普通用户在 `/node-debugging` 输入任意原始节点路径。
- 不把 HDC 和 ADB 合并到同一个 binding 行。
- catalog 编辑不触发设备读取或写入。
- 第一阶段不实现主动连接设备的节点探测。

## 架构

`/debugging-admin` 升级为调试目录管理台。

API mode 下，页面调用新的后端 Admin API，路径放在 `/api/v1/debugging/admin/*`。这些 API 管理两类相关资源：

- `debugging_parameters`：业务层调试参数元数据。
- `debugging_parameter_node_bindings`：协议特定的 HDC/ADB 节点 binding。

后端保持事实来源。后台保存操作立即写入数据库，前端随后刷新后台列表。`/node-debugging` 与后台页面状态解耦，继续通过运行时参数接口刷新。

运行时和后台读取路径保持分离：

- 运行时：只返回当前协议启用且可执行的参数。
- 后台：返回完整 catalog 视图，包括归档参数、停用 binding 和缺失 binding。

## 数据模型

保留现有协议 binding：

```text
debugging_parameter_node_bindings
- id
- organization_id
- project_id
- parameter_id
- protocol
- node_path
- access_mode
- enabled
- is_smoke_default
- notes
- created_at
- updated_at
```

参数目录需要明确的归档或启用状态。推荐最小新增字段：

```text
debugging_parameters
- enabled boolean not null default true
- archived_at timestamptz null
- archived_by text null
- archive_reason text null
```

`enabled=false` 控制运行时可见性。`archived_at` 及相关字段保留后台治理和审计上下文。如果实施时需要更小迁移，`enabled` 是必需字段，归档元数据可以同次或后续迁移补上。

旧的 `debugging_parameters.node_path` 和 `access_mode` 可以作为过渡兼容列保留。新的后台写入应以 `bindings[]` 为权威来源。

## Admin API 契约

新增独立于运行时调试 API 的后端路由：

```text
GET  /api/v1/debugging/admin/parameters
POST /api/v1/debugging/admin/parameters
PATCH /api/v1/debugging/admin/parameters/:parameterId
POST /api/v1/debugging/admin/parameters/:parameterId/archive
POST /api/v1/debugging/admin/parameters/:parameterId/restore
PUT  /api/v1/debugging/admin/parameters/:parameterId/bindings/:protocol
PATCH /api/v1/debugging/admin/parameters/:parameterId/bindings/:protocol
POST /api/v1/debugging/admin/parameters/:parameterId/bindings/:protocol/archive
```

`GET /api/v1/debugging/admin/parameters` 支持：

- `projectId`
- `module`
- `risk`
- `protocol`
- `coverage`
- `includeArchived=true`

创建和更新请求管理参数元数据：

```json
{
  "projectId": null,
  "name": "Fast charge current limit",
  "key": "debug.fast_charge.current_limit",
  "description": "Upper current limit used during fast charging.",
  "module": "Charging Policy",
  "risk": "High",
  "unit": "mA",
  "range": "0-5000",
  "minValue": 0,
  "maxValue": 5000,
  "currentValue": "3000",
  "targetValue": "3000",
  "sortOrder": 10,
  "enabled": true,
  "bindings": [
    {
      "protocol": "hdc",
      "nodePath": "/sys/class/power_supply/battery/input_current_limit",
      "accessMode": "RW",
      "enabled": true,
      "notes": "Primary HDC path."
    },
    {
      "protocol": "adb",
      "nodePath": "/sys/class/power_supply/battery/input_current_limit",
      "accessMode": "RO",
      "enabled": true,
      "notes": "ADB smoke-safe read path."
    }
  ]
}
```

Binding upsert 请求一次管理一个协议 binding：

```json
{
  "nodePath": "/sys/class/power_supply/battery/input_current_limit",
  "accessMode": "RW",
  "enabled": true,
  "notes": "Primary HDC path."
}
```

## 权限与审计

Catalog 治理应与设备写入区分。推荐权限为 `debugging:admin`。

如果当前权限矩阵第一阶段还不能新增该权限，可以临时使用 admin role 加 `debugging:write` 作为保护，但 service 命名、测试和错误信息应明确这是 catalog administration，不是节点写入执行。

Admin mutation 应写入审计事件，包含：

- action type，
- parameter id，
- binding 变更时的 affected protocol，
- before/after 形状摘要，
- actor user id，
- organization id，
- 适用时的 project id。

如果现有安全策略要求脱敏，审计 metadata 不应暴露原始节点路径。

## 前端设计

> **已 superseded（布局）：** 本节描述的左右分栏 + 内联编辑器已被 modal/table 布局取代。当前实现与验收以 [2026-06-23-wiseeff-debugging-admin-modal-layout-redesign.md](../../../exec-plans/active/2026-06-23-wiseeff-debugging-admin-modal-layout-redesign.md) 为准；页面入口见 `src/DebuggingAdminPage.tsx` 与 `docs/FRONTEND.md` 的 Debugging Admin UI 小节。

`/debugging-admin` 使用左右分栏工作台：

- 左侧：参数目录列表。
- 右侧：选中参数编辑器。

列表支持搜索和过滤：

- 模块，
- 风险，
- 启用或归档状态，
- 协议覆盖情况，
- 项目或 shared scope。

行内展示参数名称、key、模块、风险和覆盖标签：

- `HDC 已配置`
- `ADB 已配置`
- `双协议`
- `缺 HDC`
- `缺 ADB`
- `已归档`

编辑器分为两块：

1. 参数元数据：名称、key、描述、模块、风险、值类型或范围字段、单位、当前值、目标值、排序、启用状态。
2. 协议节点 binding：HDC 和 ADB tab 或并排面板。每个协议编辑 `nodePath`、`accessMode`、`enabled` 和 `notes`。

主要操作：

- 新增参数。
- 保存参数。
- 归档参数。
- 恢复参数。
- 添加 HDC binding。
- 添加 ADB binding。
- 停用或归档某个协议 binding。

保存成功后，页面刷新后台列表，并提示变更会在 `/node-debugging` 刷新后可见。

## 前端数据流

API mode：

1. 加载 `GET /api/v1/debugging/admin/parameters?includeArchived=true`。
2. 根据返回的 `bindings[]` 构建列表和覆盖标签。
3. 表单修改保存在本地 dirty draft。
4. 保存时调用参数 create/update 和 binding upsert/update API。
5. 成功后重新拉取后台列表。
6. 失败时保留 dirty draft，并展示字段级或页面级错误。

Mock mode：

- 保留现有 `configDraft` 路径用于本地 demo 和测试。
- 在有价值的地方模拟 HDC/ADB binding 字段。
- 明确显示 mock 行为是本地行为，避免误认为已持久化到后端。

兼容策略：

- 现有 `nodePath` 和 `accessMode` 仍可作为 legacy fallback。
- 新后台 UI 优先读取和写入 `bindings[]`。
- 运行时 DTO mapping 继续暴露 `selectedBinding`、`bindingStatus` 和 `selectedProtocol`。

## 校验与错误处理

后端校验为准：

- `key` 在组织和项目/shared scope 内唯一。
- 启用的 binding 必须填写 `nodePath`。
- `nodePath` 必须以 `/` 开头。
- `nodePath` 不能包含控制字符。
- `accessMode` 必须是 `RO`、`RW` 或 `WO`。
- `protocol` 必须是 `hdc` 或 `adb`。
- 归档和恢复操作应幂等。
- 运行时列表接口过滤已归档参数和停用 binding。

前端错误处理：

- 权限失败展示明确的不可编辑状态。
- 字段校验失败挂到对应输入项。
- 冲突错误说明冲突的 key 或 binding。
- 部分保存失败时不把乐观 UI 当成已提交状态。
- `/node-debugging` 在当前协议无 binding 时展示协议特定的缺失 binding 信息。

## 测试

后端测试：

- repository create/update/archive/restore parameter，
- repository upsert/update/archive binding，
- 非 admin catalog mutation 权限拒绝，
- route 对参数元数据和 binding 的校验，
- 运行时参数列表排除归档参数，
- 运行时参数列表排除当前协议停用 binding，
- admin list 在请求时包含归档参数，
- unique key 和 unique `(parameter_id, protocol)` 冲突处理。

前端测试：

- Admin client 映射 parameter 和 binding DTO。
- 页面在 API mode 加载 admin catalog。
- 新增带 HDC 和 ADB bindings 的参数。
- 编辑某一个协议 binding 时不覆盖另一个协议。
- 归档和恢复参数。
- 停用某个协议 binding 并更新覆盖标签。
- API 校验错误保留在表单上。
- Mock mode 继续支持本地 demo。

浏览器验证：

- 访问 `/debugging-admin`。
- 验证 desktop `1440x900`、tablet `768x1024`、mobile `390x844`。
- 操作新增、编辑、归档、恢复、HDC binding 编辑和 ADB binding 编辑。
- 访问 `/node-debugging?project=aurora`。
- 验证后台修改后 HDC 和 ADB 协议刷新行为。
- 检查 console errors 和相关 network requests。

## 文档影响

实施时更新：

- `docs/design-docs/api-contract.md`
- `docs/zh-CN/design-docs/api-contract.md`
- `docs/design-docs/domain-model.md`
- `docs/zh-CN/design-docs/domain-model.md`
- `docs/FRONTEND.md`
- `docs/zh-CN/FRONTEND.md`
- 如果 admin API 配置变化，更新 `docs/developer/environment-variables.md`
- 如果 admin API 配置变化，更新 `docs/zh-CN/developer/environment-variables.md`
- `docs/generated/db-schema.md`

## 验收标准

- API-mode `/debugging-admin` 可以通过后端 API 新增、编辑、归档和恢复调试参数。
- API-mode `/debugging-admin` 可以独立管理 HDC 和 ADB bindings。
- 保存操作持久化到后端，并在 `/node-debugging` 刷新后可见。
- 归档参数不再出现在运行时调试列表，但请求时仍可在后台看到。
- 停用的协议 binding 不会让该协议在 `/node-debugging` 中可执行。
- 参数归档后，历史操作和审计记录仍然可理解。
- 现有 HDC 和 ADB 运行时调试测试继续通过。
