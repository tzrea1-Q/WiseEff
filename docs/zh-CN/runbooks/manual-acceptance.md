# 人工验收

> English: [English](../../runbooks/manual-acceptance.md)

这是运行手册，说明 staging、试点、自托管、备份、回滚、监控、事故和证据采集流程。

## 使用方式

- 本页和英文版是相互链接的独立文档；不要在同一篇文档里混写中文和英文正文。
- 命令、路径、环境变量、API 路径、角色名、状态名和脚本名称保持英文原样，避免复制时出错。
- 修改相关功能时，请同时更新英文版和中文版；如果只更新一侧，`npm run docs:check` 应阻止完成。
- 若中文页与源码、测试或英文页冲突，以源码、测试和当前英文页为准，并在同一变更中修正中文页。

## 关键阅读点

- 先确认该文档属于哪个决策面：runbook。
- 阅读英文版中的完整细节、表格和命令，再用本页确认中文语境下的执行边界。
- 任何 target-environment readiness、pilot-ready、release-ready 结论都必须有真实目标环境证据，不能由本地 skip 代替。

### 本地 readiness 操作契约

本地 preflight 在 `deviceGateway` 是唯一 blocker 时可以返回 `non_hdc_local`。只有在 preflight 自动启动本地 deterministic Xiaoze runtime 时，它还可以把 `deviceGateway` 加 `xiaozeLlm` 接受为 `non_hdc_local`；`backups` 仅可作为既有的本地非客户证据 blocker 与这两个 blocker 同时存在。该例外不会清除任何 blocker，target 和 full-pilot 模式仍保持严格。

## 补充验收流程

### F2. ADB Device-Lab Loop

仅当本机 ADB 设备连接在 API 主机上，且所选节点已按目标模式审批后运行。默认模式为只读。只能使用已有且启用的 ADB 参数绑定；本 lab 不得创建或变更参数绑定。生成的 operation evidence 会脱敏并记录 shape、状态和一致性摘要；原始 target、node 和 value 输入只保留在操作者 shell。本机 ADB 证据只能补充调试覆盖，不能替代 HDC full-pilot 签核。

只读模式必需变量：

```text
DEBUG_DEVICE_GATEWAY_MODE=adb
ADB_DEVICE_LAB_AVAILABLE=true
ADB_SMOKE_PROJECT_ID=
ADB_SMOKE_DEVICE_ID=
ADB_SMOKE_TARGET_REF=
ADB_SMOKE_PARAMETER_ID=
ADB_SMOKE_NODE_PATH=
ADB_SMOKE_EXPECT_READ_PATTERN=
```

运行：

```bash
DEBUG_DEVICE_GATEWAY_MODE=adb \
ADB_DEVICE_LAB_AVAILABLE=true \
npm run acceptance:e2e -- e2e/acceptance/adb-device-lab.acceptance.spec.ts
```

验收：

- [ ] ADB target detection 通过后端 gateway 成功。
- [ ] `/node-debugging` 在 API 模式下可以切换到 ADB。
- [ ] 节点读取通过 WiseEff API 成功。
- [ ] 可选写入模式要么明确跳过，要么记录写入、回读、回滚和最终恢复证据。
- [ ] 生成的 operation evidence 只记录 shape、状态和一致性摘要，不记录原始 node path 或原始读写值。

## 同类中文文档

- [docs/zh-CN/runbooks/README.md](README.md)
- [docs/zh-CN/runbooks/manual-acceptance.md](manual-acceptance.md)
- [docs/zh-CN/runbooks/m5-commercial-pilot-readiness.md](m5-commercial-pilot-readiness.md)
- [docs/zh-CN/runbooks/self-hosted-runtime.md](self-hosted-runtime.md)
- [docs/zh-CN/runbooks/identity-provider.md](identity-provider.md)
- [docs/zh-CN/runbooks/durable-queue.md](durable-queue.md)
- [docs/zh-CN/runbooks/staging-deployment.md](staging-deployment.md)
- [docs/zh-CN/runbooks/backup-restore.md](backup-restore.md)
