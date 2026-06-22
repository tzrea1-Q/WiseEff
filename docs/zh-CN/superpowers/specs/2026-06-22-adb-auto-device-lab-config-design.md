# ADB Device-Lab 自动配置设计

> English: [English](../../../superpowers/specs/2026-06-22-adb-auto-device-lab-config-design.md)

日期：2026-06-22
状态：已认可，可进入实施计划

## 背景

第一版 ADB device-lab 验收设计假设调试参数按项目隔离。这个假设不符合产品模型：

- 参数管理仍然按项目区分。
- 参数调试使用统一的调试参数库。
- 所有项目都可以对统一调试参数库中的参数执行调试。
- 当前项目仍然作为权限、session、operation、audit 和 evidence 的运行上下文。

当前 ADB lab 还要求操作者手动提供 `ADB_SMOKE_PROJECT_ID`、`ADB_SMOKE_DEVICE_ID`、`ADB_SMOKE_TARGET_REF`、`ADB_SMOKE_PARAMETER_ID` 和 `ADB_SMOKE_NODE_PATH`。当本机已经只连接了一个 ADB 设备时，这过于繁琐。Lab 应该发现已连接 target，并从已有调试参数库推导其余配置。

本设计取代 `2026-06-21-adb-real-device-full-chain-test-design.md` 中关于手动、项目级配置的假设。

## 决策

- ADB/HDC 调试参数和协议节点绑定使用统一调试参数库。
- 项目 id 保留为 session、operation、audit 和 evidence 的运行上下文。
- 在共享 binding catalog 中引入显式默认 ADB smoke binding 标记。
- 当存在唯一 ready ADB 设备和唯一默认 enabled ADB smoke binding 时，自动配置 ADB device-lab 只读路径。
- Lab 不自动创建或修改 binding。
- 不自动启用写入。写入仍需要操作者显式提供写入值和确认 token。

## 目标

- 操作者连接一个 ADB 设备后，无需手动指定 target serial、device id、parameter id 或 node path，即可运行只读 ADB lab。
- 将调试参数和 binding library 从项目筛选中解耦，同时保留项目维度的 operation 记录。
- 通过显式 catalog 标记保证 smoke 参数选择可预测、可审计。
- 发现歧义时安全失败：多个 ready 设备、无默认 smoke binding、多个默认 binding、无 ADB device inventory、多个 matching device inventory。
- 保持紧凑且脱敏的证据。

## 非目标

- 不改变参数管理的项目隔离模型。
- 不让普通操作者在前端编辑原始 node path。
- Lab 运行时不自动创建设备 inventory、参数定义或节点绑定。
- 不通过排序从所有 enabled binding 中推断安全 smoke 参数。
- 未设置 `ADB_SMOKE_ENABLE_WRITE=true`、`ADB_SMOKE_WRITE_VALUE`、`ADB_SMOKE_CONFIRM_WRITE` 和 `ADB_SMOKE_CONFIRM_ROLLBACK` 时，不执行写入。

## 领域模型

调试 catalog 数据从项目级转为组织级：

- `debugging_parameters` 表示组织内共享调试参数。
- `debugging_parameter_node_bindings` 表示这些共享参数的协议级 node path。
- 项目级运行表仍然保留项目维度：
  - `debugging_sessions`
  - `debug_device_leases`
  - `node_operations`
  - `debugging_snapshots`
  - `debugging_events`
  - `audit_events`

实现时需要保持迁移兼容。一个务实路径是：

- 允许 catalog 的 `project_id` 变为 nullable，
- 用 `project_id is null` 表示共享 catalog scope，
- catalog 读取针对任意项目上下文都包含共享行，
- 将默认 ADB smoke binding 迁移或 seed 为共享行，
- 过渡期按需继续读取既有项目级 catalog 行。

## 默认 ADB Smoke Binding

在 `debugging_parameter_node_bindings` 增加显式标记。具体存储可以是 `is_smoke_default` 这类 boolean，也可以是 `smoke_profile = 'adb-readonly-default'` 这类小字段。实现应优先选择能满足以下规则的简单形态：

- 默认项只适用于 `adb` 协议。
- binding 必须 `enabled = true`。
- binding 必须可安全读取。自动只读 lab 选择时，`access_mode` 必须允许读取。
- 每个组织最多只能有一个默认 ADB smoke binding。
- 没有默认项时，lab 使用脱敏诊断失败。
- 存在多个默认项时，lab 使用脱敏诊断失败。

默认标记属于 catalog 治理数据。验收测试可以读取它，但不得创建、更新或修复它。

## 自动配置流程

只读 ADB lab 应支持最小环境变量：

```bash
DEBUG_DEVICE_GATEWAY_MODE=adb
ADB_DEVICE_LAB_AVAILABLE=true
ADB_SMOKE_PROJECT_ID=aurora
```

`ADB_SMOKE_PROJECT_ID` 仍然必填，但含义是 operation context，不再作为 catalog filter。其余配置自动发现：

1. 运行 `adb devices`。
2. 要求恰好一个 ready target，状态为 `device`。
3. 使用该 serial 作为 `targetRef`。
4. 查找 transport 为 `adb` 的 WiseEff debugging device inventory 行。
5. 如果恰好存在一个 eligible ADB device 行，则使用它作为 `deviceId`。
6. 如果没有或存在多个 eligible 行，使用脱敏候选摘要安全失败。
7. 查找共享的默认 enabled ADB smoke binding。
8. 使用其 `parameterId`，node path 由后端从 binding 解析。
9. 打开 `/node-debugging?project=$ADB_SMOKE_PROJECT_ID` 并切到 ADB。
10. request API 调用显式传入 `projectId`、发现的 `deviceId`、发现的 `targetRef` 和发现的 `parameterId`。
11. 后端从持久化 binding 解析 node path。

可保留少量 override 用于诊断或过渡，但正常的单设备、默认 binding 场景不再要求这些变量：

- `ADB_SMOKE_DEVICE_ID`
- `ADB_SMOKE_TARGET_REF`
- `ADB_SMOKE_PARAMETER_ID`
- `ADB_SMOKE_NODE_PATH`

如果提供 override，必须与发现结果和已有 binding 做校验，不能静默信任。

## 安全规则

- 必须保留单设备 preflight。
- 自动配置只能选择已有且启用的 ADB binding。
- Lab 不得创建或修改选中的默认 binding。
- 只读模式不得调用写入或回滚 API。
- 写入模式仍然显式 opt-in，并要求写入值和确认 token。
- 证据继续使用 shape、状态和一致性摘要，不得发布原始 ADB serial、原始 node path、原始读写值，或原始 operation/session/snapshot/request/audit 标识符。

## 错误处理

所有失败消息应可操作但脱敏：

- PATH 上没有 `adb`，
- 没有 ready ADB 设备，
- 多个 ready ADB 设备，
- 没有 ADB debugging device inventory 行，
- 多个 ADB debugging device inventory 行，
- 没有默认 ADB smoke binding，
- 多个默认 ADB smoke binding，
- 默认 binding 被禁用，
- 默认 binding 不可读，
- 发现值与 override 不一致，
- 缺少项目上下文，
- 后端读取失败。

诊断应输出数量、协议、access-mode 类别、enabled/default 状态和 identifier shape，而不是原始 id 或 node path。

## 测试

新增或更新测试：

- repository 可在不同项目上下文中选择共享 debugging parameters 和共享协议 bindings，
- 默认 ADB smoke binding 的唯一性和读取，
- service/API list 行为：任意项目都能看到共享调试 catalog，
- 单 ready 设备和一个默认 ADB smoke binding 时，ADB lab 能解析自动配置，
- 多个 ready 设备时失败，
- 缺失或多个默认 smoke binding 时失败，
- 无 ADB device inventory 或多个 device inventory 时失败，
- 写入模式仍要求显式 confirmation env，
- evidence 和 diagnostics 脱敏。

硬件 gated 验收仍然只在 `ADB_DEVICE_LAB_AVAILABLE=true` 时运行。

## 文档影响

更新：

- `docs/runbooks/adb-device-lab.md`
- `docs/zh-CN/runbooks/adb-device-lab.md`
- `docs/developer/environment-variables.md`
- `docs/zh-CN/developer/environment-variables.md`
- `docs/design-docs/domain-model.md`
- `docs/zh-CN/design-docs/domain-model.md`
- `docs/design-docs/api-contract.md`
- `docs/zh-CN/design-docs/api-contract.md`
- `docs/generated/db-schema.md`

文档必须明确：调试参数跨项目共享，调试操作仍然带项目上下文。

## 验收标准

- 当存在一个已连接 ADB 设备、一个 ADB device inventory 行、一个共享默认 read-safe ADB smoke binding 时，lab 可以在不手动设置 target/device/parameter/node 环境变量的情况下运行只读路径。
- 生成证据用 shape 摘要说明自动配置结果，并记录选中的 binding 是已有且启用的。
- 存在发现歧义时，lab 在读取设备前失败，并输出脱敏、可操作诊断。
- 项目级 operation、audit 和 session 记录继续使用传入的项目上下文。
- 既有写入模式安全边界保持有效。
