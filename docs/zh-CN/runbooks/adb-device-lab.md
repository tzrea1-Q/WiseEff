# ADB Device Lab 运行手册

> English: [English](../../runbooks/adb-device-lab.md)

使用本手册采集 ADB 调试 gateway 路径的本机真实设备证据。该流程是显式实验室证据，不是默认 CI gate。

## 最小只读环境

当本机只连接了一个 ready ADB 设备，并且 WiseEff 数据库中已经存在一个 `transport = 'adb'` 的设备 inventory 行和一个共享默认 ADB smoke binding 时，只读 ADB lab 会自动配置。

```bash
DEBUG_DEVICE_GATEWAY_MODE=adb \
ADB_DEVICE_LAB_AVAILABLE=true \
ADB_SMOKE_PROJECT_ID=aurora \
npm run acceptance:e2e -- e2e/acceptance/adb-device-lab.acceptance.spec.ts
```

`ADB_SMOKE_PROJECT_ID` 是权限、session、node operation、audit 和 evidence 的运行上下文，不再作为调试参数 catalog 的过滤条件。

Lab 自动发现：

- 从 `adb devices` 发现 `targetRef`，并要求恰好一个状态为 `device` 的 ready 设备。
- 从 WiseEff `debugging_devices` 中发现唯一 `transport = 'adb'` 的 `deviceId`。
- 从共享、enabled、`is_smoke_default = true` 的 ADB binding 中发现 `parameterId`，由后端解析 `nodePath`。

可选校验 override：

- `ADB_SMOKE_DEVICE_ID`
- `ADB_SMOKE_TARGET_REF`
- `ADB_SMOKE_PARAMETER_ID`
- `ADB_SMOKE_NODE_PATH`

如果设置了 override，它必须和自动发现结果一致；不一致时 lab 会在读取硬件前失败。

## 可选写入输入

除非设置 `ADB_SMOKE_ENABLE_WRITE=true`，否则写入模式关闭。

- `ADB_SMOKE_ENABLE_WRITE=true`
- `ADB_SMOKE_WRITE_VALUE`
- `ADB_SMOKE_CONFIRM_WRITE`
- `ADB_SMOKE_CONFIRM_ROLLBACK`

## 流程

1. 确认 ADB 设备连接在运行 WiseEff API 的同一台机器上。
2. 运行 `adb devices`，确认恰好一个 target 以 `device` 状态出现。
3. 确认数据库已存在唯一 ADB device inventory 行和唯一共享、enabled、readable 的默认 ADB smoke binding。
4. 确认所选节点可安全读取。
5. 如果启用写入模式，确认该节点可安全写入，并且允许通过 snapshot rollback 恢复。
6. 使用 `DEBUG_DEVICE_GATEWAY_MODE=adb` 启动 API。
7. 使用 API 模式启动前端。
8. 在运行 Playwright 的 shell 中导出相同的 ADB lab 变量；否则即使 API 启动正确，spec 也会跳过。
9. 运行：

```bash
DEBUG_DEVICE_GATEWAY_MODE=adb \
ADB_DEVICE_LAB_AVAILABLE=true \
ADB_SMOKE_PROJECT_ID=aurora \
npm run acceptance:e2e -- e2e/acceptance/adb-device-lab.acceptance.spec.ts
```

## 验收

操作者必须在本机配置项目运行上下文，并提前准备已有 device inventory 和默认 binding 数据。生成的 operation evidence 会保持紧凑并做脱敏；它应展示 shape、存在性、状态和一致性证明，而不是发布原始 node path、标识符或取值。

只读生成证据必须展示：

- 已配置 project 上下文，以及自动发现的 device、target、parameter 和 node 输入，并以存在性或 shape 摘要展示，
- ADB target 检测成功，
- 节点读取成功，
- 可用的 request 或 audit 关联，并以脱敏 shape 摘要展示，
- 浏览器截图、`test-results/acceptance-operation-evidence/...json` 和 `playwright-report/acceptance/index.html` 位置。

写入模式生成证据还必须展示：

- 原值、请求写入值和回读值的 shape，
- snapshot 存在，
- rollback 结果，
- 不记录原始值的最终恢复一致性。

## 安全说明

- 不要在客户硬件或未审批节点上运行写入模式。
- 不要用 `adb shell` 直接写节点；测试必须使用 WiseEff API，以便执行租约、快照、回读、回滚和审计规则。
- 只能使用已有且启用的 ADB 参数绑定；本 lab 不得创建或变更参数绑定。
- `unauthorized`、`offline`、缺失或重复 ADB target 都会阻塞运行。
- 本机 ADB 证据是 HDC 和目标环境证据的补充，不能替代 full-pilot HDC 签核。
