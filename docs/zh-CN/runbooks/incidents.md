# 事故处理

> English: [English](../../runbooks/incidents.md)

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

## DTS 写回版本缺少节点索引

编辑时出现 `parameter-sensitive-node-identity-mismatch`，可能是历史写回版本没有 `dts_nodes`，但配置修订中仍有语义节点记录。新建参数草稿、启停草稿及提交写回现在会在同一事务中生成节点索引。历史版本需要显式修复；仅部署新版不会自动补建。

在已更新的 API 容器内执行[修复脚本](../../../scripts/repair-dts-structural-index.ts)，使用容器已有的 `DATABASE_URL`。从事故证据中填写项目、文件名、报错的精确版本、记录的 SHA-256 和完整节点路径：

```bash
node --import tsx scripts/repair-dts-structural-index.ts \
  PROJECT FILE VERSION SHA256 '/complete/node/path'
# 检查结果为 ready-dry-run 后，在同一命令末尾加 --apply 正式执行。
```

默认使用只读事务试运行。正式执行锁定指定版本，核对内嵌源文件的校验和及字节数，仅补建完全缺失的结构索引。源文件内容、版本、当前指针、语义修订、参数值和草稿保持不变。事务内以系统维护任务身份写入 `dts-structural-index-repaired` 审计，记录校验和及数量；审计失败则回滚索引。将返回的跟踪 ID 与操作人记录一起保存。

`skipped-existing-index` 表示未修改任何记录，不能证明已有的部分索引或重复索引正常。遇到不支持的 include/delete 语义、源文件缺失、校验和不符或目标节点无法唯一解析时，停止修复。不要改用较新版本或关闭身份校验。返回 `repaired` 后，重新执行精确版本诊断并重试原编辑操作；事故关闭仍需服务器上的实际验证。

## 同类中文文档

- [docs/zh-CN/runbooks/README.md](README.md)
- [docs/zh-CN/runbooks/manual-acceptance.md](manual-acceptance.md)
- [docs/zh-CN/runbooks/m5-commercial-pilot-readiness.md](m5-commercial-pilot-readiness.md)
- [docs/zh-CN/runbooks/self-hosted-runtime.md](self-hosted-runtime.md)
- [docs/zh-CN/runbooks/identity-provider.md](identity-provider.md)
- [docs/zh-CN/runbooks/durable-queue.md](durable-queue.md)
- [docs/zh-CN/runbooks/staging-deployment.md](staging-deployment.md)
- [docs/zh-CN/runbooks/backup-restore.md](backup-restore.md)
