# ADB Device Lab 运行手册

> English: [English](../../runbooks/adb-device-lab.md)

使用本手册采集 ADB 调试 gateway 路径的本机真实设备证据。该流程是显式实验室证据，不是默认 CI gate。

## 只读模式必需输入

- `DEBUG_DEVICE_GATEWAY_MODE=adb`
- `ADB_DEVICE_LAB_AVAILABLE=true`
- `ADB_SMOKE_PROJECT_ID`
- `ADB_SMOKE_DEVICE_ID`
- `ADB_SMOKE_TARGET_REF`
- `ADB_SMOKE_PARAMETER_ID`
- `ADB_SMOKE_NODE_PATH`
- 可选 `ADB_SMOKE_EXPECT_READ_PATTERN`
- 可选 `ADB_SMOKE_USER_ID`

## 可选写入输入

除非设置 `ADB_SMOKE_ENABLE_WRITE=true`，否则写入模式关闭。

- `ADB_SMOKE_ENABLE_WRITE=true`
- `ADB_SMOKE_WRITE_VALUE`
- 可选 `ADB_SMOKE_CONFIRM_WRITE`，默认 `confirm-high-risk-write`
- 可选 `ADB_SMOKE_CONFIRM_ROLLBACK`，默认 `confirm-rollback`

## 流程

1. 确认 ADB 设备连接在运行 WiseEff API 的同一台机器上。
2. 运行 `adb devices`，确认 `ADB_SMOKE_TARGET_REF` 以 `device` 状态出现。
3. 确认 `ADB_SMOKE_PARAMETER_ID` 和 `ADB_SMOKE_NODE_PATH` 已映射到已有且启用的 ADB 参数绑定。
4. 确认所选节点可安全读取。
5. 如果启用写入模式，确认该节点可安全写入，并且允许通过 snapshot rollback 恢复。
6. 使用 `DEBUG_DEVICE_GATEWAY_MODE=adb` 启动 API。
7. 使用 API 模式启动前端。
8. 在运行 Playwright 的 shell 中导出相同的 ADB lab 变量；否则即使 API 启动正确，spec 也会跳过。
9. 运行：

```bash
DEBUG_DEVICE_GATEWAY_MODE=adb \
ADB_DEVICE_LAB_AVAILABLE=true \
npm run acceptance:e2e -- e2e/acceptance/adb-device-lab.acceptance.spec.ts
```

## 验收

操作者必须在本机配置原始 project、device、target、parameter 和 node 输入。生成的 operation evidence 会保持紧凑并做脱敏；它应展示 shape、存在性、状态和一致性证明，而不是发布原始 node path、标识符或取值。

只读生成证据必须展示：

- 已配置 project、device、target、parameter 和 node 输入，并以存在性或 shape 摘要展示，
- ADB target 检测成功，
- 节点读取成功，
- 可用的 request 或 audit 关联，并以脱敏 shape 摘要展示，
- 浏览器截图、`test-results/acceptance/operation-evidence/...json` 和 `playwright-report/acceptance/index.html` 位置。

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
