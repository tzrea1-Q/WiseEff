# 运行手册索引

> English: [English](../../runbooks/README.md)

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
- 自托管入口见 [配置向导](../../../ops/self-hosted/setup.zh-CN.md)。只有 IP、没有域名的实验室见 [IP 实验室 profile](../../../ops/self-hosted/ip-lab.zh-CN.md)。
- 初始化、日常启停、健康与日志、升级恢复、备份、监控和常见故障统一见[自托管运维操作手册](../../../ops/self-hosted/operations.zh-CN.md)。
- 已运行自托管 checkout 的升级见 [自托管升级](../../../ops/self-hosted/upgrade.zh-CN.md)，包括目标锁定、停机前构建、恢复点、resume 与显式 rollback。

## 同类中文文档

- [docs/zh-CN/runbooks/README.md](README.md)
- [docs/zh-CN/runbooks/manual-acceptance.md](manual-acceptance.md)
- [docs/zh-CN/runbooks/m5-commercial-pilot-readiness.md](m5-commercial-pilot-readiness.md)
- [docs/zh-CN/runbooks/self-hosted-runtime.md](self-hosted-runtime.md)
- [ops/self-hosted/upgrade.zh-CN.md](../../../ops/self-hosted/upgrade.zh-CN.md)
- [docs/zh-CN/runbooks/identity-provider.md](identity-provider.md)
- [docs/zh-CN/runbooks/durable-queue.md](durable-queue.md)
- [docs/zh-CN/runbooks/staging-deployment.md](staging-deployment.md)
- [docs/zh-CN/runbooks/backup-restore.md](backup-restore.md)：备份恢复，以及 DTS overlay 产物保留 / `overlay-artifact-gc`。
- [docs/zh-CN/runbooks/parameter-identity-cutover.md](parameter-identity-cutover.md)
- [docs/zh-CN/runbooks/effective-driver-parameter-catalog-reconciliation.md](effective-driver-parameter-catalog-reconciliation.md)：Issue #649 驱动参数生效目录扩展、对账、收缩与回滚。
- [docs/zh-CN/runbooks/platform-admin-and-schema-promotion.md](platform-admin-and-schema-promotion.md)
- [docs/zh-CN/runbooks/hdc-device-lab.md](hdc-device-lab.md)
- [docs/zh-CN/runbooks/adb-device-lab.md](adb-device-lab.md)：本机真实 ADB 设备证据采集。
- [docs/zh-CN/runbooks/log-analysis-llm.md](log-analysis-llm.md)：日志分析 LLM 就绪、诚实降级链与证据纪律。
