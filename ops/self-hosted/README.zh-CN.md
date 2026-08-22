# 自托管入口

> English: [English](README.md)

这是自托管运维文档，说明 Linux 自托管部署、存储、发布和模板使用方式。

初始化、日常启停、状态、日志、升级恢复、备份、监控和常见故障的统一入口见[自托管运维操作手册](operations.zh-CN.md)。

## 使用方式

- 本页和英文版是相互链接的独立文档；不要在同一篇文档里混写中文和英文正文。
- 命令、路径、环境变量、API 路径、角色名、状态名和脚本名称保持英文原样，避免复制时出错。
- 修改相关功能时，请同时更新英文版和中文版；如果只更新一侧，`npm run docs:check` 应阻止完成。
- 若中文页与源码、测试或英文页冲突，以源码、测试和当前英文页为准，并在同一变更中修正中文页。

## 关键阅读点

- 先确认该文档属于哪个决策面：self-hosted。
- 阅读英文版中的完整细节、表格和命令，再用本页确认中文语境下的执行边界。
- 任何 target-environment readiness、pilot-ready、release-ready 结论都必须有真实目标环境证据，不能由本地 skip 代替。
- 自托管入口是 [配置向导](setup.zh-CN.md)：`./scripts/setup.sh`。只有 IP、没有域名时走 [IP 实验室 profile](ip-lab.zh-CN.md)。不要手工复制 `.env.example` 去填 Let's Encrypt 域名。该路径是实验室/演示，不是试点或发布就绪证据。
- 已运行的 checkout 使用 [升级入口](upgrade.zh-CN.md)：先一次性执行 `sudo ./scripts/upgrade.sh prepare-host --yes` 规范化部署用户的 Docker、journal 与备份目录权限；之后由部署用户无 `sudo` 执行 `./scripts/upgrade.sh plan` 和 `./scripts/upgrade.sh apply`。不传 `--ref` 时默认解析最新 `origin/main`，受控发布可传 `refs/tags/<release>` 或 SHA。遇到操作锁时使用 `lock-status` 和可重复执行的 `unlock`，不要手删锁文件。`setup.sh` 仍只负责首次配置、启动和 provision，不是升级入口。
- 企业受限网络先用 `./scripts/build-network.sh init` 创建 `.build-network.env`，由部署用户编辑，再用 `./scripts/build-network.sh status` 查看无凭据摘要。setup 与 upgrade 共用这份代理、内部 npm 源、组织批准 CA 和构建 TLS 契约；无法安装 CA 的主机可使用文档化的仅构建期 `insecure` 策略，但每次构建都要单独授权，运行时 TLS 和包完整性/签名仍保持开启。详见[受限网络构建配置](upgrade.zh-CN.md#受限网络构建配置)。自托管 runtime 要求 Docker Compose v2。
- stock 自托管拓扑只支持一个 API 副本。`./scripts/compose` 对 `--scale api=...` 和 `--scale=api=...` 只允许精确的 `api=1`；其他所有 `api=*` 值都会在调用 Docker 前被拒绝，其他服务的 scale 值原样透传。字面参数 `--` 会结束 wrapper 选项检查，之后的容器命令参数不会被误判。直接调用 Compose 只能绕过 guard，不能形成受支持的多 API 拓扑。
- 自托管 runtime 镜像通过 Alpine `dtc` 包内置 Device Tree Compiler，并在镜像构建时执行 `dtc --version`。因此 `./scripts/seed-demo-data.sh` 的 M1 阶段会在容器内真实编译三项目 overlay，不依赖宿主机安装。
- 修改镜像或 DTS seed 后运行 `npm run selfhost:check`、`npm run dtc:check -- --required` 和 `npm run dtc:seed:compile`。

## 图形化监控

WiseEff 主服务启动后，在服务器的 `ops/self-hosted/` 目录执行：

```bash
./scripts/observability up
./scripts/observability status
```

该入口会启动 Prometheus、Grafana、Alertmanager、blackbox exporter、Node exporter、PostgreSQL exporter 和 Redis exporter，并自动配置 Prometheus 数据源和四套 WiseEff Dashboard，无需手工导入。

Grafana 默认只绑定服务器的 `127.0.0.1:3000`。从操作员电脑建立 SSH 隧道后，在本机访问 `http://127.0.0.1:3000`：

```bash
ssh -L 3000:127.0.0.1:3000 <user>@<server>
```

使用 `./scripts/observability logs -f`、`restart` 和 `down` 管理监控服务。`down` 不会停止 WiseEff 主服务，也不会删除任何 named volume。完整安全边界、端口覆盖、告警路由和目标证据要求见[可观测性运维](../../docs/zh-CN/runbooks/observability-operations.md)。

## Device Bridge（macOS portable）

portable 版 `wiseeff-bridge`（`.tar.gz`）不会自动注册 `wiseeff-bridge://` URL scheme。要通过浏览器完成配对，必须先注册 URL 处理器。

解压 portable 包并启动 standby 模式后：

```bash
./wiseeff-bridge start
./wiseeff-bridge register
```

`register` 会在 `~/.wiseeff/WiseEffBridgeLauncher.app` 创建轻量 `.app` wrapper，向 Launch Services 注册 `wiseeff-bridge://`，并将 handler 指向当前 portable 的 `cli.js`。运行 `wiseeff-bridge unregister` 可移除注册。

macOS `.pkg` 安装包会通过 `/Applications/WiseEff Bridge.app` 注册 URL scheme，无需执行 `register`。安装包构建说明见 [bridge-installer/README.zh-CN.md](./bridge-installer/README.zh-CN.md)。

## 同类中文文档

- [ops/self-hosted/README.zh-CN.md](README.zh-CN.md)
- [ops/self-hosted/ip-lab.zh-CN.md](ip-lab.zh-CN.md)
- [ops/self-hosted/storage/README.zh-CN.md](storage/README.zh-CN.md)
- [ops/self-hosted/storage/provider-decision.zh-CN.md](storage/provider-decision.zh-CN.md)
- [ops/self-hosted/releases/README.zh-CN.md](releases/README.zh-CN.md)
- [ops/self-hosted/releases/release-template.zh-CN.md](releases/release-template.zh-CN.md)
