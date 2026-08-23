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

本地 preflight 在 `deviceGateway` 是唯一 blocker 时可以返回 `non_hdc_local`。只有在 preflight 启用本地 runtime（`startRuntime` 未禁用）、连接到由 `isLocalHttpUrl` 证明为本地的 API base URL，且 readiness 响应通过 `gates.xiaozeLlm` 精确证明 deterministic Xiaoze（`ok=false`、`status=blocked`、message 必须是 `Deterministic Xiaoze mode is not acceptable for pilot readiness.`）时，才可以把 `deviceGateway` 加 `xiaozeLlm` 接受为 `non_hdc_local`；`backups` 仅可作为既有的本地非客户证据 blocker 与这两个 blocker 同时存在。API 可能已经监听并被复用；不要求 preflight 必须亲自启动它。该例外不会清除任何 blocker，target 和 full-pilot 模式仍保持严格。

## 补充验收流程

### 视觉 fixture 安全边界

Populated review 视觉 fixture 只能写入本次验收独占且可丢弃的数据库。运行 `npm run seed:quality:visual-review` 或 `npm run cleanup:quality:visual-review` 前，必须同时设置 `WISEEFF_QUALITY_ALLOW_VISUAL_FIXTURE=true`，并把 `WISEEFF_QUALITY_FIXTURE_DATABASE_NAME` 设为 `current_database()` 的精确结果。数据库名不一致或固定 ID 已归属其他数据时，命令会在写入前 fail-closed。共享库、客户库、staging 或 target synthetic 数据库一律不得设置这两个变量。

Target synthetic 质量运行只 planned-skip populated `/parameter-review` 视觉用例，其他视觉用例以及 a11y/响应式项目仍必须只读执行。确需更新基线时，只更新点名的 PNG，逐张实际审图，再在不带 `--update-snapshots` 的条件下重跑；禁止批量接纳快照。

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
