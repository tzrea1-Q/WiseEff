# HDC Device Lab 运行手册

> English: [English](../../runbooks/hdc-device-lab.md)

使用本手册采集 HDC 调试 gateway 路径的本机真实设备证据。该流程是显式实验室证据，不是默认 CI gate。

## 最小写入和恢复环境

当本机恰好连接了一个 HDC target 时，HDC lab 会自动配置。它会创建或更新一个 lab-only WiseEff device inventory 行，并创建一个 lab-only 临时文件参数绑定；默认节点为 `/data/local/tmp/wiseeff_hdc_smoke_node`。准备阶段会停用同项目的非 lab HDC binding，避免前端自动读取循环在真实硬件上触碰 simulator 或近似客户节点。

```bash
DEBUG_DEVICE_GATEWAY_MODE=hdc \
HDC_DEVICE_LAB_AVAILABLE=true \
HDC_SMOKE_CONFIRM_WRITE=confirm-high-risk-write \
HDC_SMOKE_CONFIRM_ROLLBACK=confirm-rollback \
npm run acceptance:e2e -- e2e/acceptance/hdc-device-lab.acceptance.spec.ts
```

`HDC_SMOKE_PROJECT_ID` 默认是 `aurora`。它是权限、session、node operation、audit 和 evidence 的运行上下文。

Lab 会自动发现或准备：

- 从 `hdc list targets` 发现 `targetRef`，并要求恰好一个 target。
- `deviceId` 使用 lab-only WiseEff inventory 行 `hdc-device-lab-aurora`。
- `parameterId` 使用 lab-only 参数 `hdc-smoke-temp-node`。
- `nodePath` 默认使用 `/data/local/tmp/wiseeff_hdc_smoke_node`，除非显式覆盖。
- 原值和写入值默认使用安全的 lab 字符串，除非显式覆盖。

可选校验 override：

- `HDC_SMOKE_PROJECT_ID`
- `HDC_SMOKE_DEVICE_ID`
- `HDC_SMOKE_TARGET_REF`
- `HDC_SMOKE_PARAMETER_ID`
- `HDC_SMOKE_NODE_PATH`
- `HDC_SMOKE_ORIGINAL_VALUE`
- `HDC_SMOKE_WRITE_VALUE`
- `HDC_SMOKE_EXPECT_READ_PATTERN`
- `HDC_SMOKE_USER_ID`

如果设置了 device、target、parameter 或 node override，它必须和自动发现的 lab 配置一致；不一致时 lab 会在写入硬件前失败。

## 必需写入确认

HDC lab 会显式执行受治理的 write/readback/snapshot-rollback 路径。以下确认始终必填：

- `HDC_SMOKE_CONFIRM_WRITE=confirm-high-risk-write`
- `HDC_SMOKE_CONFIRM_ROLLBACK=confirm-rollback`

不要把 `HDC_SMOKE_NODE_PATH` 指向客户或生产节点。默认临时文件节点才是审批过的本地 lab 目标。

## 流程

1. 确认 HDC 设备连接在运行 WiseEff API 的同一台机器上。
2. 运行 `hdc list targets`，确认恰好一个 target。
3. 确认默认临时节点可用于读取、写入和 rollback 证据。
4. 使用 `DEBUG_DEVICE_GATEWAY_MODE=hdc` 启动 API。
5. 使用 API 模式启动前端。
6. 在运行 Playwright 的 shell 中导出相同的 HDC lab 变量；否则即使 API 启动正确，spec 也会跳过。
7. 运行最小环境章节中的命令。

## 验收

生成的 operation evidence 会保持紧凑并做脱敏；它应展示 shape、存在性、状态和一致性证明，而不是发布原始标识符或取值。

证据必须展示：

- `/node-debugging` 前端 HDC target 检测成功，
- lab-only 临时节点读取成功，
- UI 写入和 readback 成功，
- 受治理写入路径产生 snapshot，
- target detect、session create、node read、node write、snapshot rollback 的 audit event，
- rollback 结果和最终恢复一致性，
- 浏览器截图、`test-results/acceptance/operation-evidence/...json` 和 `playwright-report/acceptance/index.html` 位置。

## 安全说明

- 不要在客户硬件或未审批节点上运行本 lab。
- 不要用 `hdc shell` 直接写节点；测试必须使用 WiseEff API，以便执行租约、快照、回读、回滚和审计规则。
- 被本 lab 停用的非 lab HDC binding 应视为临时本地证据配置；只有在明确离开 HDC lab 上下文时才恢复或重新 seed 本地数据。
- 缺失、重复或不可访问的 HDC target 都会阻塞运行。
- simulator 和 fake-runner 证据对开发有用，但不能替代真实 HDC device-lab 签核。
