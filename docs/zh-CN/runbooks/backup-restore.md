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

## 组织删除状态重放

旧备份可能包含备份之后已删除的组织和文件。恢复之前，应先停止代理流量、API、worker 和 publication 写入进程，从当前最新数据库提取适用的最小删除状态，存放在不会被本次数据库或对象快照覆盖的受保护文件中。最新数据库不可读时必须停止恢复。仅复制“已删除”回执不能清理旧备份恢复出的业务内容；本流程也不承诺即时擦除备份介质。

维护进程使用实际配置的数据库、对象存储和 checkpoint 存储，不启动 API 或 worker 守护进程：

```bash
node --import tsx scripts/organization-erasure-recovery.ts capture --file /protected/recovery/organization-erasures.json
# 所有存储恢复后，流量和生产者仍须停止：
node --import tsx scripts/organization-erasure-recovery.ts replay --file /protected/recovery/organization-erasures.json --actor actual-surviving-platform-user-id
```

隔离演练从最新源提取状态，再将重放配置指向隔离恢复目标。文件须保持私有并跨重试保留，不能从已恢复的旧数据库重新生成。`capture` 只创建新文件，已存在或未验证完整性的文件不能被覆盖。有效的空删除列表与缺失、空白或格式错误的文件不同。

恢复顺序为：验证隔离目标；停止所有写者和流量；保全最新删除状态；恢复 PostgreSQL、对象存储及适用的 Redis；再次暂停恢复出的队列；用真实存活的平台用户重放删除；成功后才启动 API、worker 等业务进程并开放队列和代理。Redis 快照可能带回未暂停的队列。随后再执行英文版规定的计数、对象引用、健康、smoke、`queue:check` 和证据检查，真实目标演练通过后才能记录 `M5_BACKUP_RESTORE_DRILL_AT`。

自托管 `upgrade.sh rollback --restore-data` 已包含这些闸门。显式设置 `WISEEFF_ORGANIZATION_ERASURE_REPLAY_ACTOR_ID` 为真实存活的平台用户。控制器在受保护的升级运行目录保留 `organization-erasures.json`，在替换 PostgreSQL 之前提取，恢复中断后复用已验证的文件；恢复所有存储后重新暂停队列，在重建应用服务、恢复队列或启动代理之前完成重放。只重启的 rollback、resume 和 candidate recovery 均不能绕过未完成的重放。

记录的 candidate 镜像必须包含恢复 CLI，并兼容恢复出的 schema 及实际存储。CLI 缺失、最新数据库不可用、schema 不兼容、平台用户缺失、删除失败，以及 Agent 原生 checkpoint 存储缺失或物理身份改变，都会阻止重开。控制器不会悄悄迁移旧数据库，也不会退回缺少闸门的旧镜像。保持服务隔离，按现有恢复流程解决兼容问题后重试。独立 checkpoint 数据库也必须恢复并验证归属；更换物理存储身份不等于完成删除。

验收必须实际恢复旧备份，证明后续删除状态能清理重新出现的目标数据，在重开前阻断目标凭据、新操作、队列认领和 callback 重放，同时保留其他组织及共享对象。覆盖失败或中断的 intent，以及已完成回执对应的旧业务行重新出现的情况。Shell 包装测试只证明调用顺序和拒绝行为，不能替代 Docker、目标主机、PostgreSQL、对象存储或 checkpoint 的真实恢复证据。

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
