# 本地 non-HDC Readiness Gate 兼容修复 — 设计规格

> English: [English](../../../superpowers/specs/2026-07-19-local-non-hdc-readiness-gate-compatibility-design.md)

**日期：** 2026-07-19

**状态：** Brainstorming 方案已批准；等待书面规格复核

**范围：** 仅限本地 non-HDC acceptance preflight 判定

## 1. 问题

Pilot-readiness API 已使用规范 gate 名 `xiaozeLlm`，但
`scripts/run-acceptance-preflight.ts` 的两个本地放行组合仍识别已退役的
`agentProvider`。因此健康的本地 API 返回预期阻断项：

```text
deviceGateway, xiaozeLlm, backups
```

preflight 却在浏览器验收开始前错误失败。这属于消费者与提供者之间的契约漂移，
不表示这三个 gate 已达到 pilot-ready。

## 2. 决策

以 pilot-readiness API 契约为事实来源，将本地 non-HDC 判定中的
`agentProvider` 替换为 `xiaozeLlm`。

本地模式只接受以下精确组合：

1. `deviceGateway`；
2. preflight 自动启动本地 runtime 时的 `deviceGateway + xiaozeLlm`；
3. 同一条件下的 `deviceGateway + xiaozeLlm + backups`。

以上组合只产生 `outcome=non_hdc_local`，绝不产生 `pilot_ready`。
`--require-pilot-ready`、`--no-start-runtime`、未知 blocker、target 和
full-pilot 路径继续严格失败关闭。

不兼容接受旧 `agentProvider` 别名。旧名称应暴露过期服务端或客户端契约，
而不是再次被隐藏。

## 3. 备选方案

### 3.1 推荐：消费者改用规范 gate 名

只修改 evaluator、测试及中英文验收文档，保持现有本地策略，不改变 target 或
full-pilot 语义。

### 3.2 同时接受新旧名称

可兼容过期本地 API，但会隐藏契约漂移，并让旧部署继续表现为有效。拒绝采用。

### 3.3 本地浏览器验收前满足全部 pilot gate

这需要真实设备实验室、在线 LLM 和备份恢复证据。它们是 full pilot 的要求，
但不应成为本地 non-HDC 浏览器验收的前置条件。本任务不采用。

## 4. 数据流与安全边界

```text
/api/v1/operations/pilot-readiness
  -> blockedBy 规范 gate 名
  -> evaluatePilotReadiness
  -> 精确的本地 allowlist
  -> non_hdc_local
  -> 标准浏览器验收
```

额外或未知 gate 继续失败关闭。生成的 preflight/browser evidence 必须保留实际
blocked gate 与 `non_hdc_local` 结果。禁止伪造环境变量或证据来标记设备、LLM、
备份或 TD-042 已 ready。

## 5. 验证设计

测试先行实现将先增加以下失败用例：

- 只有自动启动本地 runtime 时才接受 `deviceGateway + xiaozeLlm`；
- 同一条件下接受 `deviceGateway + xiaozeLlm + backups`；
- 拒绝旧 `agentProvider` 组合；
- `--require-pilot-ready` 与 `--no-start-runtime` 继续严格；
- 出现额外未知 blocker 时继续拒绝。

最小实现完成后运行聚焦测试、完整 preflight 测试、文档/契约/构建/测试门禁，
随后执行：

```bash
npm run acceptance:preflight
npm run acceptance:browser -- --mode local-non-hdc
npm run acceptance:evidence
```

浏览器验收禁止使用 `--skip-preflight`。后续 Playwright 失败必须单独报告并按根因
处理；本修复不会降低浏览器、API、operation evidence 或 coverage 断言。

## 6. 文档影响

分别更新英文和中文 manual-acceptance 文档，将本地确定性依赖统一称为
`xiaozeLlm`，与 API 契约一致。在现有 Round6 active plan 中记录实现与证据，
但不改变 TD-042 和 production-readiness 声明。
