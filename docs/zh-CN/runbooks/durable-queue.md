# 持久队列

> English: [English](../../runbooks/durable-queue.md)

这是运行手册，说明 staging、试点、自托管、备份、回滚、监控、事故和证据采集流程。

## 使用方式

- 本页和英文版是相互链接的独立文档；不要在同一篇文档里混写中文和英文正文。
- 命令、路径、环境变量、API 路径、角色名、状态名和脚本名称保持英文原样，避免复制时出错。
- 修改相关功能时，请同时更新英文版和中文版；如果只更新一侧，`npm run docs:check` 应阻止完成。
- 若中文页与源码、测试或英文页冲突，以源码、测试和当前英文页为准，并在同一变更中修正中文页。

## 关键阅读点

### 传输身份兼容

业务 job ID 和幂等 key 保持不变。锁定 BullMQ 拒绝正式日志、通知 producer 生成的
两段冒号 key。适配器先按原 key 查询已持久任务，存在就保留，不重命名、删除或重新
投递；否则仅将锁定传输拒绝的 ID 编码为 `wiseeff-durable-v1-` 加 UTF-16LE base64url。
合法原 ID（含既有三段兼容 ID）不变，不制造三段 ID 规避检查。

编码任务以保留 payload 字段 `$wiseeffDurableKeyV1` 保存原 key，业务 `jobId`／
`outboxId` 不变。新原 key 占用保留前缀、调用者 payload 占用该字段均拒绝；既有
编码 ID 缺少匹配 marker 视为碰撞，不当作有效重复。`add` 返回对象可能包含请求而非
持久数据，必须读回核验。读回失败不证明投递未提交：保留原幂等 key 并 reconcile，
不得清队列或新建业务任务强行推进。这不承诺 exactly-once，也不自动修复旧 HTTP 失败。

- 先确认该文档属于哪个决策面：runbook。
- 阅读英文版中的完整细节、表格和命令，再用本页确认中文语境下的执行边界。
- 任何 target-environment readiness、pilot-ready、release-ready 结论都必须有真实目标环境证据，不能由本地 skip 代替。

## 同类中文文档

- [docs/zh-CN/runbooks/README.md](README.md)
- [docs/zh-CN/runbooks/manual-acceptance.md](manual-acceptance.md)
- [docs/zh-CN/runbooks/m5-commercial-pilot-readiness.md](m5-commercial-pilot-readiness.md)
- [docs/zh-CN/runbooks/self-hosted-runtime.md](self-hosted-runtime.md)
- [docs/zh-CN/runbooks/identity-provider.md](identity-provider.md)
- [docs/zh-CN/runbooks/durable-queue.md](durable-queue.md)
- [docs/zh-CN/runbooks/staging-deployment.md](staging-deployment.md)
- [docs/zh-CN/runbooks/backup-restore.md](backup-restore.md)
