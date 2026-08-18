# 备份与恢复

> English: [English](../../runbooks/backup-restore.md)

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

## 同类中文文档

- [docs/zh-CN/runbooks/README.md](README.md)
- [docs/zh-CN/runbooks/manual-acceptance.md](manual-acceptance.md)
- [docs/zh-CN/runbooks/m5-commercial-pilot-readiness.md](m5-commercial-pilot-readiness.md)
- [docs/zh-CN/runbooks/self-hosted-runtime.md](self-hosted-runtime.md)
- [docs/zh-CN/runbooks/identity-provider.md](identity-provider.md)
- [docs/zh-CN/runbooks/durable-queue.md](durable-queue.md)
- [docs/zh-CN/runbooks/staging-deployment.md](staging-deployment.md)
- [docs/zh-CN/runbooks/backup-restore.md](backup-restore.md)

## Overlay 产物保留与 GC

编译后的 DTS reload overlay blob（源文件 + `dtbo`）从运行的 `completed_at`（否则 `created_at`）起保留 `RELOAD_ARTIFACT_RETENTION_DAYS`（90）天。窗口过后，下载和部署返回 `410`，`details.code: "reload-artifact-expired"`。运行元数据、SHA-256 摘要、字节数、reload 快照和既有审计行仍留在运行上。

物理删除走 PostgreSQL `jobs` 表，kind 为 `overlay-artifact-gc`：

- 同一组织已有 queued / processing 任务时，再次入队会复用该任务。
- worker 认领任务、删除过期对象键、清空 storage key、写入系统审计（`app: dts-reload`，`kind: overlay-artifact-gc`，`action: sweep`），审计带 run digest（`scannedRuns`、`reclaimedRuns`、`deletedBlobs`），然后完成。
- 失败走 jobs 租约重试/退避；次数用尽则死信，未删掉的键留给下次 sweep。
- 这条路径不走 Redis/BullMQ。不要把真实 S3/MinIO 演练当作完成条件。

仍需用 cron（或等效定时器）触发：

```bash
npm run reload:sweep-artifacts
```

该脚本会回收卡在 `deploying` 的运行，为仍持有过期 blob 的组织入队 `overlay-artifact-gc`，并经同一 worker 入口排空。对象存储没有 `delete` 时是空操作。命令可安全重复执行。
