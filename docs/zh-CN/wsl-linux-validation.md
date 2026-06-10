# WSL Linux 验证说明

> English: [English](../runbooks/wsl-linux-validation.md)

这份文档说明：哪些 M6 自托管能力可以先在本机 WSL Linux lab 中验证，哪些必须放到真实 Linux 服务器上验收。

## 可以在 WSL 中验证

WSL 适合做 Linux 运行时预检。当前已经验证过：

- `npm run selfhost:check`
- `npm run observability:check`
- `npm run selfhost:smoke -- --env-file ops/self-hosted/.env --base-url http://127.0.0.1:8789 --allow-only-blocked=deviceGateway,agentProvider,backups`
- `npm run queue:check -- --env-file ops/self-hosted/.env --base-url http://127.0.0.1:8789 --output docs/generated/m6-queue-readiness-evidence.wsl-lab.md`
- `npm run identity:local-oidc-drill -- --output docs/generated/m6-local-oidc-identity-evidence.wsl-lab.md`
- `/health/ready` 返回 PostgreSQL、对象存储、worker queue、durable queue ready
- `/metrics` 返回 Prometheus metrics
- Docker Compose 中 API、web、worker、PostgreSQL、Redis、MinIO 可以在本地 Linux lab 中运行

这些结果只能说明本地 Linux lab 链路可用，不能替代真实 target environment evidence。

## 关键注意事项

不要在 WSL 中直接使用 Windows 工作区的 `node_modules` 跑 TypeScript 测试。`esbuild` 这类原生依赖区分 Windows/Linux 平台。需要在 WSL 专用 worktree 中安装依赖，或者在 PowerShell 中跑 Windows 侧测试。

不要用 Bash `source ops/self-hosted/.env` 加载环境变量。`.env` 面向 dotenv 和 Docker Compose，token 可能包含空格，例如 `Bearer <token>`。直接 source 会把 token 片段当成 shell 命令。

备份/恢复 drill 推荐使用不和 Node 22 原生参数冲突的命令：

```bash
npm run restore:drill --target-env-file=ops/self-hosted/.env
npm run backup:drill --target-env-file=ops/self-hosted/.env
```

直接调用脚本时也可以传位置参数：

```bash
npx tsx scripts/run-restore-drill.ts ops/self-hosted/.env
npx tsx scripts/run-backup-drill.ts ops/self-hosted/.env
```

在 Windows/Node 22 下避免使用 `npm run <script> -- --env-file ops/self-hosted/.env`，因为 Node 自带 `--env-file`，可能抢走参数。

## WSL 无法替代的验收

以下内容必须在真实自托管目标服务器或等价目标环境中完成：

- DNS 和 TLS 终止
- Keycloak/OIDC 目标环境集成
- 目标环境用户/角色治理 UI/API/DB/audit 证据
- 隔离数据库和隔离对象存储上的 backup/restore drill
- Redis 持久化快照和 checkpoint 证据
- Prometheus scrape、Alertmanager routing、Grafana dashboard import 目标证据
- 非客户目标环境 rollback rehearsal
- 容量压测和目标 metrics
- target synthetic browser acceptance 和 CI artifact
- HDC device-lab
- live Agent provider

结论：WSL 可以作为 M6 的本地 Linux 预检层，但 M6.2-M6.6 关闭前仍然需要 `npm run m6:target-plan`、目标环境 evidence 命令，以及通过 `npm run m6:target-evidence`。
