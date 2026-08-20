# 可观测性运维

> English: [English](../../runbooks/observability-operations.md)

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
- 自托管 Compose 已提供 `observability` profile，包含 Prometheus、Grafana、Alertmanager、blackbox exporter、Node exporter、PostgreSQL exporter 和 Redis exporter。
- Grafana 会自动装载 Prometheus 数据源以及 `WiseEff Services`、`WiseEff Overview`、`WiseEff Jobs`、`WiseEff Security Operations` 四套面板，不需要手工导入 JSON。

## 一键启动

先确保 WiseEff 主服务已经启动，然后在服务器执行：

```bash
cd ops/self-hosted
./scripts/observability up
./scripts/observability status
```

常用生命周期命令：

```bash
./scripts/observability logs -f
./scripts/observability restart
./scripts/observability down
```

`down` 只停止监控服务，不停止 WiseEff 主服务，也不删除应用或监控 volume。

Grafana、Prometheus、Alertmanager 默认只绑定服务器的 `127.0.0.1`，不会经 Caddy 暴露。操作员从自己的电脑建立 SSH 隧道：

```bash
ssh -L 3000:127.0.0.1:3000 <user>@<server>
```

随后在本机浏览器访问 `http://127.0.0.1:3000`。Grafana 使用仅查看的匿名访问且不创建默认管理员；这个安全边界依赖 loopback 绑定，不得直接改成公网监听。Prometheus 和 Alertmanager 的本机端口分别是 `9090`、`9093`。

可通过以下变量调整本机端口和保留期：

- `WISEEFF_GRAFANA_PORT`，默认 `3000`。
- `WISEEFF_PROMETHEUS_PORT`，默认 `9090`。
- `WISEEFF_ALERTMANAGER_PORT`，默认 `9093`。
- `WISEEFF_PROMETHEUS_RETENTION`，默认 `15d`。

内置 Alertmanager receiver 只在本地 UI 展示告警，不会发送邮件、Webhook 或聊天通知。真实目标环境必须配置并演练经过批准的 receiver，才能把 Alertmanager routing evidence 标为通过。

## 服务覆盖与排查

`WiseEff Services` 面板展示 API、worker、web、proxy、MinIO、PostgreSQL、Redis、监控组件以及主机 CPU、内存和文件系统。独立 worker 通过 Compose 私网端口 `8788` 提供 `/health/live` 和 `/metrics`。

若某项显示 `DOWN`：

1. 在面板确认失败项的 `service` 标签。
2. 执行 `./scripts/compose --env-file .env ps -a` 对比容器状态。
3. 查看 `./scripts/compose --env-file .env logs --tail=200 <service>`。
4. 区分 Compose DNS/网络故障、进程未启动和健康端点失败，再只重启受影响服务。

`/metrics` 是内部运维数据，禁止直接暴露公网。真实 scrape、告警路由和 Grafana 截图仍属于目标环境证据，不能由本地配置检查代替。

## 同类中文文档

- [docs/zh-CN/runbooks/README.md](README.md)
- [docs/zh-CN/runbooks/manual-acceptance.md](manual-acceptance.md)
- [docs/zh-CN/runbooks/m5-commercial-pilot-readiness.md](m5-commercial-pilot-readiness.md)
- [docs/zh-CN/runbooks/self-hosted-runtime.md](self-hosted-runtime.md)
- [docs/zh-CN/runbooks/identity-provider.md](identity-provider.md)
- [docs/zh-CN/runbooks/durable-queue.md](durable-queue.md)
- [docs/zh-CN/runbooks/staging-deployment.md](staging-deployment.md)
- [docs/zh-CN/runbooks/backup-restore.md](backup-restore.md)
