# 自托管运行时

> English: [English](../../runbooks/self-hosted-runtime.md)

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
- 主服务健康后，可运行 `./scripts/observability up` 和 `./scripts/observability status` 启动 loopback-only 的 Prometheus/Grafana/Alertmanager profile；通过 SSH 隧道访问 Grafana，详细步骤见[可观测性运维](observability-operations.md)。
- 只有 IP、没有域名时走 [配置向导](../../../ops/self-hosted/setup.zh-CN.md) / [IP 实验室 profile](../../../ops/self-hosted/ip-lab.zh-CN.md)：在 `ops/self-hosted/` 执行 `./scripts/setup.sh`。不要把 `.env.example` 当实验室安装向导。该路径不是试点/发布证据。
- 已运行 checkout 的完整数据保留重启使用[自托管升级入口](../../../ops/self-hosted/upgrade.zh-CN.md)：首次由 root 执行 `sudo ./scripts/upgrade.sh prepare-host --yes`，此后部署用户无 `sudo` 执行 `plan`/`apply`；不传 `--ref` 默认 `origin/main`，受控发布传 tag 或 SHA。锁冲突使用 `lock-status`/`unlock`，不要手删持久锁文件。不要用 `setup.sh --force` 或 `compose down -v` 代替。
- 本地 Admin bootstrap：有 ChargeLab 则加入；否则用 `--organization WiseEff`（或显式名称）创建恰好一家。不要再用硬件部 / 软件部当加入目标。后续管理员在 `/organization/members` 创建。认证页在 `hasLocalAdmin: false` 时显示 `npm run admin:bootstrap` 提示。首位 Admin 就绪后可用 `AUTH_LOCAL_SELF_REGISTER=false` 关闭公开注册。登录/注册有进程内限流；失败登录写 `login-failed`。用户在个人资料改密，Admin 在 `/organization/members` 重置密码。
- 知识库语义检索需要 PostgreSQL 安装 pgvector 扩展并配置 `EMBEDDING_API_*` 端点；缺任一项时知识库降级为 FTS-only（全文 + trigram）且保持完全可用，检索 API 与 `/knowledge-admin` 检索模式横幅会如实上报。迁移 `0104` 在扩展缺失时不会失败；先迁移后装扩展的部署只需在 PostgreSQL 服务器装好 pgvector 后重启 API——启动 ensure（`server/modules/knowledge/indexing/vectorEnsure.ts`）会在 advisory lock 下自动创建扩展、补 `knowledge_chunks.embedding` 列（多副本安全）并把全部已发布条目重新入队重建，无需手动 SQL；数据库角色无建扩展权限时 ensure 会诚实记日志并保持 FTS-only，手动 SQL 步骤仅作参考保留（见英文版）。chunk 与嵌入是派生数据，靠已发布修订重建（更换 `EMBEDDING_MODEL` 后在 `/knowledge-admin` 全量重建），不依赖备份恢复。启用细节见英文版 “Knowledge Retrieval: pgvector And FTS-Only Degradation”。

## 同类中文文档

- [docs/zh-CN/runbooks/README.md](README.md)
- [docs/zh-CN/runbooks/manual-acceptance.md](manual-acceptance.md)
- [docs/zh-CN/runbooks/m5-commercial-pilot-readiness.md](m5-commercial-pilot-readiness.md)
- [docs/zh-CN/runbooks/self-hosted-runtime.md](self-hosted-runtime.md)
- [docs/zh-CN/runbooks/identity-provider.md](identity-provider.md)
- [docs/zh-CN/runbooks/durable-queue.md](durable-queue.md)
- [docs/zh-CN/runbooks/staging-deployment.md](staging-deployment.md)
- [docs/zh-CN/runbooks/backup-restore.md](backup-restore.md)
