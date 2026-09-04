# 自托管运行时

> English: [English](../../runbooks/self-hosted-runtime.md)

部署人员可先阅读[自托管运维操作手册](../../../ops/self-hosted/operations.zh-CN.md)统一查找命令；本文继续作为 runtime 与 readiness 专题说明。

这是运行手册，说明 staging、试点、自托管、备份、回滚、监控、事故和证据采集流程。

目录公开发布链的顺序是 P12、P13、P11b、P14a、P14b、P14c，然后 P15。`scripts/run-self-hosted-release-gate.ts` 在缺少生产者证据、pre-activation pin、P13 新 attempt digest、runtime pin 之后的浏览器证据、隔离，或 Operator 与 Platform-owner 两项不同审批时失败即关闭。本地和 Hosted 命令门禁输出不是目标主机、发布或生产证据。P16 不属于本链。

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
- 已运行 checkout 的完整数据保留重启使用[自托管升级入口](../../../ops/self-hosted/upgrade.zh-CN.md)：首次由 root 执行 `sudo ./scripts/upgrade.sh prepare-host --yes`，此后部署用户无 `sudo` 执行 `plan`/`apply`；不传 `--ref` 默认 `origin/main`，受控发布传 tag 或 SHA。若部署机仍 checkout 在本次就绪/恢复修复之前的旧控制器提交，必须先 fetch 并切换到包含修复的已合入 release/commit，再执行 `plan`/`apply`；旧控制器无法解释新的数据平面、worker 和恢复状态机。切换 checkout 时保留 `.env`、journal、备份和 named volumes，不要用 `setup.sh --force` 或 `compose down -v` 代替。锁冲突使用 `lock-status`/`unlock`，不要手删持久锁文件。升级控制器分别检查 PostgreSQL/Redis 的 Docker `healthy`、MinIO 进程 `running`（仅代表存活）、`minio-init` 退出 `0`；initializer 完成 endpoint、credentials 和 bucket 初始化才是 MinIO 权威就绪证明，等待每一轮和退出 `0` 后都会再次 inspect MinIO。对于 `queue-resumed`、`starting-proxy`、`validating-public`，必须先隔离候选 proxy，再通过 API `/health/ready`、候选 API 内的规范驱动目录门禁 `npm run parameter-definitions:check -- --catalog-only`、worker `8788` liveness/Docker health 和 web 直连，任一失败都不会启动 proxy 或公网探测；目录阻断记录 `candidate-parameter-catalog` 并进入恢复，容器健康不能掩盖它。worker 不健康记录 `candidate-worker-health`，proxy 隔离失败记录 `candidate-proxy-isolation` 并要求人工隔离。写入 `old-stack-restored` 前先验证数据平面、API、worker `8788` liveness/Docker health、web 和旧 image identity，全部通过后才 resume queue、重建 proxy 并验证 proxy/public；失败就进入 `recovery-required`，尝试停止 proxy、暂停 queue/worker，若隔离布尔值为 false 则先完成人工流量/queue 隔离。迁移前可按 journal 给出的 `resume` 重试旧栈且不恢复数据；迁移后拒绝普通 `resume`，改用带 run token 的 `rollback --restore-data --confirm restore-<id>`。使用 `status --json` 读取 `failed_phase`、`failure_service`、`failure_code`、`failure_summary`、`recovery_started`、`recovery_verified`、`recovery_failure_summary`、`next_action`；任一恢复动作（包括 stop、pause 或 queue resume）失败时先看其脱敏动作、错误码和摘要。公网探测使用 `curl --noproxy '*'`；`Host: web:5173` 导致的 Vite 403 是 Host 检查，不是 TCP 不通。`WISEEFF_BUILD_TLS_POLICY=insecure` 加 `--allow-insecure-build` 仍只对构建阶段显式生效，不改变运行时或全局 TLS 校验。
- 企业服务器只能通过代理获取构建依赖时，先由部署用户执行 `./scripts/build-network.sh init`，编辑权限为 `0600` 的 `.build-network.env`，再运行 `./scripts/build-network.sh status`。setup/upgrade 会自动使用同一契约；无法安装企业 CA 时可使用两把钥匙控制的仅构建期 `insecure` 策略，每次实际构建仍必须传 `--allow-insecure-build`，运行时 TLS 不变。完整安全与 Docker daemon 边界见[受限网络构建配置](../../../ops/self-hosted/upgrade.zh-CN.md#受限网络构建配置)。自托管 runtime 要求 Docker Compose v2。
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
