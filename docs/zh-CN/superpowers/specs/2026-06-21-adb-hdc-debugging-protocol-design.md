# ADB/HDC 调试协议设计

> English: [English](../../../superpowers/specs/2026-06-21-adb-hdc-debugging-protocol-design.md)

日期：2026-06-21
状态：已认可，可进入实施计划

## 背景

WiseEff 当前通过后端 `DebuggingGateway` seam 和 HDC gateway adapter 提供生产导向的设备调试能力。`/node-debugging` 在 API 模式下走后端调试接口，非 API 开发实验仍可使用本地 Vite `/api/hdc/*` bridge。

下一步需求是把 ADB 命令支持提升为后端一等能力，在前端支持 HDC/ADB 切换，并在节点管理中分别维护 HDC 和 ADB 的节点元数据。

## 决策

- 将 ADB/HDC 建模为调试连接协议，而不是两套独立业务流程。
- 新增领域概念 `DebugConnectionProtocol = "hdc" | "adb"`。
- 后端 API 作为生产路径；本次范围不新增前端 `/api/adb/*` 本地 bridge。
- 用户在 `/node-debugging` 按会话选择协议。首次默认仍为 HDC，界面可记住用户上次选择。
- 保持一套业务调试参数目录，HDC 和 ADB 使用独立的协议节点绑定。
- 后端固定从服务器 PATH 执行 `adb`，使用参数数组、命令超时和与 HDC 同级别的安全模型。
- 普通节点调试流程不暴露原始 `nodePath`。Admin 节点管理页面负责维护节点路径和访问模式。

## 目标

- 用户可在 `/node-debugging` 切换 HDC 或 ADB，并通过同一条后端治理链路检测目标、创建会话、读取节点、写入节点和回滚。
- Admin 用户可为同一个调试参数分别维护 HDC 和 ADB 节点绑定。
- ADB 读写复用现有后端权限、租约、快照、回读、回滚、审计、指标和 tracing 边界。
- 现有 HDC 行为和 M3/M5 调试验证继续通过。
- 当前协议没有 binding 的参数仍可见，但读写禁用并展示明确原因。

## 非目标

- 不创建两套独立调试参数目录。
- 不允许普通用户在 `/node-debugging` 输入任意节点路径。
- 不让前端直接执行设备命令。
- 本次范围不支持前端或 Admin 配置 ADB 可执行文件路径。
- 默认 CI 不要求真实 ADB 硬件；真实硬件验收放在 device-lab smoke。

## 架构

后端调试模块扩展为协议路由的 gateway 系统：

- `HdcDebugDeviceGateway` 保留现有 HDC 行为。
- `AdbDebugDeviceGateway` 新增 ADB 目标检测、节点读取、节点写入和回读校验。
- `DebugDeviceGatewayRegistry` 按 `protocol` 选择 adapter。
- `debugging_sessions` 记录创建会话时选择的协议。
- `node_operations` 记录每次操作使用的协议。
- audit metadata 记录 `protocol`、`targetRef`、`deviceId` 和 `parameterId`。

会话创建后，读、写、回滚操作都从 session 推导协议，不再信任前端传入的协议字段。

## 数据模型

新增 TypeScript 协议类型：

```ts
export type DebugConnectionProtocol = "hdc" | "adb";
```

`debugging_parameters` 继续作为业务目录：

- `id`
- `name`
- `key`
- `module`
- `risk`
- `range_label`
- `unit`
- current 与 target value 字段

新增协议节点绑定：

```text
debugging_parameter_node_bindings
- id
- organization_id
- project_id
- parameter_id
- protocol text not null
- node_path text not null
- access_mode text not null
- enabled boolean not null default true
- notes text
- metadata jsonb not null default '{}'::jsonb
- created_at timestamptz not null default now()
- updated_at timestamptz not null default now()
- unique (parameter_id, protocol)
```

以下表新增 `protocol`：

- `debugging_targets`
- `debugging_sessions`
- `node_operations`

snapshot entries 应记录创建快照时使用的协议和节点路径，使回滚使用原始 adapter 和原始节点绑定上下文。

现有 `debugging_parameters.node_path` 与 `access_mode` 迁移为 `protocol = "hdc"` 的 binding。如有需要，旧字段保留一个兼容版本，但服务层应切换到读取 binding。

## 前端设计

`/node-debugging` 在页面 header 或 topbar 增加协议分段控件：

```text
连接协议  [ HDC ] [ ADB ]
```

行为：

- 首次默认 HDC。
- 选择可按用户保存在 local storage 或用户偏好中。
- 切换协议会清空当前 target 和 session，并提示用户重新检测目标。
- 目标检测向后端发送当前选择的协议。
- 连接后，页面展示协议、target reference 和 session 状态。
- 表格仍以参数为中心，只展示当前协议 binding 状态，不展示原始节点路径。
- 当前协议没有启用 binding 的行禁用读写并展示原因。
- `RO`、`WO`、`RW` 继续决定读写操作可见性。

`/debugging-admin` 按参数维护协议绑定：

```text
参数：快充电流限制
基础字段：名称 / key / 模块 / 风险 / 范围 / 单位

节点绑定
[ HDC ] nodePath / accessMode / enabled / notes
[ ADB ] nodePath / accessMode / enabled / notes
```

Admin 校验：

- 启用的 binding 必须有 `nodePath`。
- `nodePath` 必须以 `/` 开头。
- `nodePath` 不允许包含控制字符。
- `accessMode` 必须是 `RO`、`WO` 或 `RW`。
- 同一参数可以只配置 HDC、只配置 ADB、两者都配置或都未配置。
- 删除一般应转为 `enabled = false`，避免历史操作失去上下文。

Admin 列表视图展示协议覆盖标签，例如 `HDC 已配置`、`ADB 已配置`、`双协议`、`缺少 ADB`、`缺少 HDC`。

## API 契约

保留现有调试路由族并扩展 DTO：

```text
GET  /api/v1/debugging/devices?projectId=...
GET  /api/v1/debugging/parameters?projectId=...&protocol=adb
POST /api/v1/debugging/targets/detect
POST /api/v1/debugging/sessions
GET  /api/v1/debugging/sessions/:sessionId
GET  /api/v1/debugging/sessions/:sessionId/events
POST /api/v1/debugging/nodes/read
POST /api/v1/debugging/nodes/write
POST /api/v1/debugging/snapshots/:snapshotId/rollback
```

目标检测请求：

```json
{
  "projectId": "project-1",
  "deviceId": "device-1",
  "protocol": "adb"
}
```

会话创建请求：

```json
{
  "projectId": "project-1",
  "deviceId": "device-1",
  "targetId": "adb:emulator-5554",
  "protocol": "adb"
}
```

节点读取请求：

```json
{
  "sessionId": "session-1",
  "parameterId": "debug-param-1"
}
```

节点写入请求：

```json
{
  "sessionId": "session-1",
  "parameterId": "debug-param-1",
  "value": "42",
  "confirmationToken": "confirm-high-risk-write"
}
```

API 模式下，前端应停止为读写请求发送 `nodePath`。后端根据 `(parameterId, session.protocol)` 解析 `nodePath`。

参数列表支持两种视图：

- 不传 `protocol`：返回参数及全部 bindings，用于 Admin 管理。
- 传 `protocol`：返回参数和选中协议的 binding 状态，用于 `/node-debugging`。

## 服务流程

### 检测目标

1. 校验 `protocol`。
2. 检查 `debugging:read` 和项目访问权限。
3. 从 `DebugDeviceGatewayRegistry` 选择 gateway。
4. 执行协议特定检测。
5. upsert 带 `protocol` 的 targets。
6. 写 debug event 和包含协议、target 数量的审计 metadata。

ADB 检测使用 `adb devices`，解析 attached 设备序列号，并生成类似 `adb:<serial>` 的 target id。

### 创建会话

1. 校验 `projectId`、`deviceId`、`targetId` 和 `protocol`。
2. 检查 target 存在且 `target.protocol === input.protocol`。
3. 检查 device 与 target 的项目归属。
4. 创建带 `protocol` 的 session。
5. 写 session-created event 和审计 metadata。

### 读取节点

1. 检查 `debugging:read`。
2. 加载 active session 并推导 `protocol`。
3. 加载 `(parameterId, protocol)` 对应的启用 binding。
4. 校验 binding 可读。
5. 加载 session target。
6. 按 session protocol 选择 gateway，读取 binding 的 node path。
7. 持久化 `node_operations.protocol`。
8. 写审计 metadata。

### 写入节点

1. 检查 `debugging:write`。
2. 加载 active session 并推导 `protocol`。
3. 加载 `(parameterId, protocol)` 对应的启用 binding。
4. 校验可写访问模式、范围和高风险确认。
5. 获取现有设备租约。
6. 通过 session protocol 读取 previous value。
7. 创建包含 protocol 与 node path 的 snapshot entry。
8. 通过协议 gateway 写入。
9. 对 `RW` binding 执行回读校验。
10. 持久化 operation、snapshot、debug event 和审计证据。

### 回滚

1. 加载 snapshot 和 session。
2. 使用原始 session protocol 和 snapshot-entry protocol。
3. 要求确认 token 和设备租约。
4. 通过匹配的协议 gateway 写回 previous values。
5. 持久化 rollback operations 并更新 snapshot 状态。
6. 写审计证据。

不能使用 HDC 回滚 ADB 快照，也不能使用 ADB 回滚 HDC 快照。

## ADB Gateway

ADB adapter 应遵循现有 HDC adapter 形状：

- command: `adb`
- timeout: 复用调试 gateway 默认超时，除非实施计划选择独立常量。
- process execution: `spawn(command, args, { shell: false })`
- target detection: `adb devices`
- read: `adb -s <serial> shell cat <nodePath>`
- write: `adb -s <serial> shell sh -c ...`
- result normalization: timeout、非 0 exit、stderr、stdout、duration、readback mismatch。

安全规则：

- 前端不能控制 ADB binary path。
- Admin UI 只维护节点 bindings，不维护命令模板。
- `nodePath` 必须来自启用的 binding 并通过校验。
- values 和 paths 必须安全传入 `adb shell` 后的 shell 层。
- 单测必须覆盖包含空格和 shell 敏感字符的值。

## 错误

新增或标准化以下错误：

- `PROTOCOL_UNSUPPORTED`：后端没有启用所请求协议的 adapter。
- `DEBUG_BINDING_NOT_CONFIGURED`：所选参数没有 session protocol 的 binding。
- `DEBUG_BINDING_DISABLED`：所选协议 binding 已停用。
- `DEVICE_UNAVAILABLE`：target 离线、不可用或命令执行失败。
- `DEVICE_GATEWAY_TIMEOUT`：命令超时。
- `DEBUG_READBACK_MISMATCH`：写入完成但回读不一致。
- `VALIDATION_FAILED`：protocol、node path、access mode、range 或 value 无效。

UI 文案应映射为可操作的中文提示，并避免向普通用户暴露原始节点路径。

## 迁移

1. 新增 binding 表和 protocol 字段。
2. 将 `debugging_targets.protocol`、`debugging_sessions.protocol`、`node_operations.protocol` 回填为 `hdc`。
3. 从现有 `debugging_parameters.node_path` 和 `access_mode` 回填 HDC bindings。
4. 更新 seed 数据，包含 HDC bindings 和可选 ADB 示例 bindings。
5. 在启用 ADB UI 控件前，保证现有 HDC 行为继续通过。

## 测试

后端测试：

- protocol registry 选择正确 adapter。
- ADB gateway 解析 `adb devices`。
- ADB gateway 覆盖 read、write、回读成功、回读不一致、超时、非 0 exit 和命令缺失。
- binding repository 覆盖已配置、缺失、停用和无效 binding 状态。
- service read/write/rollback 使用 session protocol，并拒绝协议不匹配。
- audit metadata 包含 protocol。

前端测试：

- 协议切换清空当前 target 和 session。
- 目标检测传递选中协议。
- 当前协议没有 binding 的行禁用读写。
- Admin 可分别编辑 HDC 和 ADB bindings。
- 普通 `/node-debugging` 不渲染原始节点路径。

E2E 与验收：

- 现有 simulator 和 HDC M3/M5 测试继续通过。
- 新增 ADB device-lab smoke，由环境变量显式开启，类似 HDC device-lab smoke。
- 默认 CI 使用 mock gateway 测试和 API contract 测试，不依赖真实硬件。

前端可见改动需要 Playwright 浏览器验证桌面 `1440x900`、平板 `768x1024`、移动 `390x844`，包含 snapshot、screenshot、console error 检查、协议切换、目标检测状态、禁用行和 Admin binding 编辑。

## 文档

实施时更新以下文档：

- `docs/FRONTEND.md`：说明协议切换和 binding-aware 节点调试。
- `docs/SECURITY.md`：明确 ADB 和 HDC 都经过后端 gateway、authz、lease、snapshot、rollback、audit 边界。
- `docs/design-docs/domain-model.md`：加入 protocol 和 node-binding 概念。
- `docs/design-docs/api-contract.md`：记录 protocol 字段和基于 binding 的读写请求。
- `docs/generated/db-schema.md`：重新生成 schema 摘要。
- `docs/runbooks/adb-device-lab.md`：新增真实设备证据流程。
- 面向人类阅读的开发者文档同步更新中文版本。

## 分阶段交付

1. 数据模型与 API 契约：加入 protocol 和 binding 结构，同时保持 HDC 行为不变。
2. ADB 后端 adapter：实现 `AdbDebugDeviceGateway` 与 registry，并用 mock runner 测试。
3. 服务层 binding 流程：read/write/rollback 改为根据 session protocol 查询 binding。
4. 前端协议切换与 Admin binding 管理。
5. Device-lab 验收和文档更新。

## 成功标准

- `/node-debugging` 允许用户选择 HDC 或 ADB，检测 target，并创建匹配协议的 session。
- 同一个调试参数可拥有独立的 HDC 和 ADB 节点绑定。
- ADB 读写经过后端权限、租约、快照、回滚、审计、指标和 tracing。
- 当前协议缺少 binding 的行禁用并展示明确原因。
- 现有 HDC 功能和 M3/M5 验证不回退。
