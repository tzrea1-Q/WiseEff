# 监控与告警

> English: [English](../../runbooks/monitoring-alerting.md)

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

## 必监控信号（摘要）

| 区域 | 信号 |
| --- | --- |
| API | 请求量、延迟、错误率、request id |
| Readiness | `/health/live`、`/health/ready`、pilot-readiness |
| 小泽 LLM | 健康状态（`xiaozeLlm` / `wiseeff_xiaoze_llm_ready`）、fallback、延迟、token、成本、安全状态 |
| Worker / 队列 | 排队/运行/失败/dead-letter、Redis/BullMQ 连接 |
| 对象存储 / 设备网关 | 探针失败、超时、回读不一致 |

指标标签不得包含 bearer token、API key、高基数 model id、原始日志或参数值。小泽 LLM 标签仅允许有界字段（如 readiness mode、deterministic flag）。配置与告警规则见 `ops/self-hosted/observability/` 及英文版全文。

## 同类中文文档

- [docs/zh-CN/runbooks/README.md](README.md)
- [docs/zh-CN/runbooks/manual-acceptance.md](manual-acceptance.md)
- [docs/zh-CN/runbooks/m5-commercial-pilot-readiness.md](m5-commercial-pilot-readiness.md)
- [docs/zh-CN/runbooks/self-hosted-runtime.md](self-hosted-runtime.md)
- [docs/zh-CN/runbooks/identity-provider.md](identity-provider.md)
- [docs/zh-CN/runbooks/durable-queue.md](durable-queue.md)
- [docs/zh-CN/runbooks/staging-deployment.md](staging-deployment.md)
- [docs/zh-CN/runbooks/backup-restore.md](backup-restore.md)
