# 自托管运维操作手册

> English: [English](operations.md)

本文是 WiseEff Linux 自托管部署的统一命令手册。日常运维先从这里选择正确入口；涉及恢复演练、目标环境证据或事故审批时，再进入链接的专题运行手册。

除非章节另有说明，所有命令都由专用部署用户在以下目录执行：

```bash
cd /srv/wiseeff/ops/self-hosted
```

统一使用仓库提供的 `./scripts/compose`，不要直接调用 `docker compose` 或 `docker-compose`。该包装脚本会选择受支持的 Compose 实现，并保持当前 checkout 的 Compose 文件与 project identity。

stock 拓扑只运行一个 API 副本。wrapper 对 `up --scale api=...`、`up --scale=api=...` 和独立的 `scale api=...` 只允许精确的 `api=1`；其他所有 `api=*` 值都会在调用 Docker 前被拒绝，其他服务的 scale 值原样透传。它只为顶层 `up` 和 `scale` 检查 scale 语法；`exec`、`run` 和其他命令的参数无需补字面 `--`，都会原样透传。对于 `up`，`--` 结束选项检查；对于 `scale`，它只结束命令选项，之后的 API operand 仍会校验。直接调用 Compose 只能绕过可执行 guard，并不是受支持的多 API 入口。

## 先选择正确入口

| 场景 | 命令或入口 | 结果 |
| --- | --- | --- |
| 首次安装或有意重新配置 | `./scripts/setup.sh` | 创建或更新 `.env`，构建、启动并按需 provision。 |
| 已有容器之前被正常停止 | `./scripts/compose --env-file .env start` | 启动原容器和原镜像，不构建、不更新 Git。 |
| 某个已有服务只需要重启进程 | `./scripts/compose --env-file .env restart <service>` | 重启原容器，不重新构建，也不应用 Compose 配置变更。 |
| 某个停止或缺失的服务需要在不构建的情况下对齐 | `./scripts/compose --env-file .env up -d --no-build` | 使用 Compose 当前解析到的镜像启动或创建；不可变 SHA 升级后应先核对镜像身份。 |
| 部署最新代码并保留完整数据 | 先 `./scripts/upgrade.sh plan`，再 `./scripts/upgrade.sh apply` | 解析唯一 commit、创建并校验恢复点、迁移、全量重建并验收。 |
| 重新创建相同的已部署 commit | `./scripts/upgrade.sh apply --restart --ref <sha>` | SHA 相同时仍执行完整受保护升级流程。 |
| 完成符合条件且已隔离的 migration 后候选栈 | 执行 journal `next_action` 中的精确 `recover-candidate` 命令 | 重新验证恢复点与候选栈，不恢复数据，按序恢复 worker、queue、proxy 和公网流量。 |
| 企业代理/npm 镜像源/CA/TLS 策略 | `./scripts/build-network.sh init`，编辑后执行 `status` | 创建并校验 setup/upgrade 共用的私有构建传输契约。 |
| 监控生命周期 | `./scripts/observability <up|status|logs|restart|down>` | 只操作私有监控 profile。 |
| setup/upgrade 锁冲突 | `./scripts/upgrade.sh lock-status`，仅当 stale 时执行 `unlock` | 查看或安全清理陈旧锁元数据，不结束真实运行中的操作。 |

不要把 `setup.sh --force` 当成升级或重启命令；它会替换 `.env` 并轮换数据库/对象存储凭据。任何保留数据的流程都禁止使用 `compose down -v`、`docker volume rm` 或 `docker system prune`。

## 面向操作员的公开入口

| 入口 | 用途 |
| --- | --- |
| `./scripts/compose` | 服务生命周期、状态、日志、配置和 exec 的 Compose 兼容边界。 |
| `./scripts/setup.sh` | 首次配置，以及按 access/admin/seed/LLM section 重新配置。 |
| `./scripts/doctor.sh` | 静态配置诊断，可选探测在线服务。 |
| `./scripts/upgrade.sh` | 数据保留升级、同 SHA 重建、宿主机准备、journal 状态、resume、受保护候选恢复、rollback 和锁恢复。 |
| `./scripts/build-network.sh` | 初始化并安全展示受限网络代理、npm 源、组织批准 CA 和构建 TLS 契约。 |
| `./scripts/observability` | 内置 Prometheus/Grafana/Alertmanager 生命周期。 |
| `./scripts/seed-demo-data.sh` | 仅用于 demo/staging 的 ChargeLab 数据；禁止用于客户或生产数据。 |
| `./scripts/memory-mode.sh` | 在低内存宿主机上切换本地开发与自托管 runtime 的兼容工具；不是常规生产生命周期入口。 |
| `./scripts/deploy-ip-lab.sh` | 遗留 IP 实验室兼容包装；新安装使用 `setup.sh`。 |

查看每个入口由代码实现的权威接口：

```bash
./scripts/setup.sh --help
./scripts/doctor.sh --help
./scripts/upgrade.sh --help
./scripts/build-network.sh --help
./scripts/observability --help
```

## 日常命令速查

```bash
# 查看全部应用/数据容器，包括已停止容器
./scripts/compose --env-file .env ps -a

# 公网存活与依赖就绪检查
curl -fsS https://<host>/health/live
curl -fsS https://<host>/health/ready

# 最近日志
./scripts/compose --env-file .env logs --tail=200 api worker proxy

# 持续跟踪单个服务
./scripts/compose --env-file .env logs -f worker

# 正常停机后启动已有容器
./scripts/compose --env-file .env start

# 不构建，仅重启一个已有服务
./scripts/compose --env-file .env restart worker
```

`/health/live` 只证明 API 进程存活。PostgreSQL、对象存储、Redis/durable queue、Agent provider 或其他必需依赖阻塞时，API 仍可能存活，而 `/health/ready` 返回 `503`。升级或上报问题前应保留其中的依赖详情。

## 一次性宿主机准备与权限

首次升级前，统一规范 Docker、备份目录和 journal 权限：

```bash
sudo ./scripts/upgrade.sh prepare-host --yes
```

该命令默认把 `SUDO_USER` 识别为部署操作员。直接使用 root 会话时必须显式指定：

```bash
sudo ./scripts/upgrade.sh prepare-host --yes --operator <deployment-user>
```

如果用户组发生变化，需要退出并重新登录。Docker socket 组权限实质上等同宿主机 root 权限，只能授予专用且可信的部署账号。

`plan`、`apply`、`status`、`resume`、`recover-candidate`、`rollback`、普通 Compose 命令和监控命令都由部署用户无 `sudo` 执行。root 通常不会继承部署用户的 Git 代理配置，还会制造后续无法写入的 root-owned 状态。

验证权限：

```bash
id
docker info
./scripts/compose version
stat -c '%A %U %G %n' .env /var/backups/wiseeff/upgrades
```

`.env` 权限保持 `600`；备份目录保持 `700`，备份文件保持 `600`。

## 企业受限网络

由部署用户配置构建传输，不要加 `sudo`：

```bash
./scripts/build-network.sh init
chmod 600 .build-network.env
# 只编辑 .build-network.env 中已有的文档化变量。
./scripts/build-network.sh status
./scripts/upgrade.sh plan
```

`status` 可安全用于日常工单：只显示是否已配置、npm registry 主机名和构建 TLS 策略，不显示代理 URL 或凭据。setup 和 upgrade 会自动读取该契约；如需放在受保护的其他位置，可传 `--build-network-file <path>`。不创建文件时，当前 shell 已 export 的代理变量仍会生效。

排查时先判断失败属于哪个网络边界：

| 失败操作 | 网络责任方 | 正确修复入口 |
| --- | --- | --- |
| `git fetch` / 目标解析 | 部署用户的 Git/libcurl | shell/Git 代理或 upgrade `--git-proxy` |
| 应用构建内的 `RUN apk`、`git clone`、`pip` 或 `npm ci` | 受管 BuildKit 参数、内部 registry、组织批准 CA，或显式的仅构建期应急策略 | `.build-network.env`，再执行 `build-network.sh status` |
| 未被基础镜像 bundle 覆盖的 `FROM` metadata 或镜像拉取 | Docker daemon / BuildKit service | 在 WiseEff 外部配置并重启 Docker daemon 代理/DNS |
| 启动后 API/worker 的外部调用 | runtime 容器环境 | 通过 `WISEEFF_RUNTIME_PROXY=true` 显式开启，并保持内部服务名位于 `NO_PROXY` |

优先让 `WISEEFF_BUILD_CA_CERT_FILE` 指向组织批准的 PEM。部署机确实无法安装 CA 时，设置 `WISEEFF_BUILD_TLS_POLICY=insecure`，并仅对当次构建传 `upgrade.sh apply --allow-insecure-build` 或 `setup.sh ... --allow-insecure-build`。该入口仍禁止全局 `NODE_TLS_REJECT_UNAUTHORIZED=0`、运行时关闭 TLS、跳过 npm 完整性校验和 Alpine `--allow-untrusted`。解析器会在构建开始前拒绝不安全权限、符号链接、未知/重复 key、大小写代理冲突、带凭据的 registry URL、非法 CA 和未知 TLS 策略。

## 首次安装与重新配置

交互式首次安装：

```bash
./scripts/setup.sh
```

无 DNS 的 IP 实验室示例：

```bash
./scripts/setup.sh --non-interactive --ip <server-ip>
```

只重新配置公网访问或 LLM，不替换整套密钥：

```bash
./scripts/setup.sh access
./scripts/setup.sh llm
./scripts/doctor.sh --probe-live
```

当 `AUTH_PROVIDER=local` 且 setup 尚未配置首位管理员时，只能在不存在任何管理员 role binding 的情况下执行一次性 bootstrap：

```bash
./scripts/compose --env-file .env exec api npm run admin:bootstrap -- \
  --username admin.ops \
  --password 'ReplaceWithAStrongPassword' \
  --name 'Platform Admin' \
  --organization WiseEff
```

只有内部 demo/staging 环境可以导入仓库自带演示数据：

```bash
./scripts/seed-demo-data.sh
```

使用非默认参数前阅读[配置向导](setup.zh-CN.md)和[IP 实验室](ip-lab.zh-CN.md)。`setup.sh --force` 会破坏凭据连续性，不是更新入口。

低内存开发宿主机如果需要在本地 npm runtime 和自托管 Compose runtime 之间有意切换，可使用：

```bash
./scripts/memory-mode.sh status
./scripts/memory-mode.sh dev
./scripts/memory-mode.sh selfhost
```

该兼容工具在 `dev` 模式执行 Compose `down`，在 `selfhost` 模式执行普通 Compose `up`。commit SHA 生产部署禁止使用它：原容器会被删除，不可变镜像身份可能随之丢失。此类环境应使用 `compose stop`/`start`。

## 启动、停止与重启

### 启动已经创建的部署

适用于之前执行过 `compose stop` 或完成宿主机维护的情况：

```bash
./scripts/compose --env-file .env start
./scripts/compose --env-file .env ps
```

该命令保留原有应用镜像，包括 `upgrade.sh` 创建的不可变 commit 标签。

### 不构建，对齐缺失容器

只有容器被删除，并且确认 Compose 当前解析到的应用镜像就是计划部署的镜像时才使用：

```bash
./scripts/compose --env-file .env config --images
./scripts/compose --env-file .env up -d --no-build
./scripts/compose --env-file .env ps
```

完成不可变 SHA 升级后应优先使用 `start`。如果没有固定 `WISEEFF_APP_TAG`，普通 `up` 可能解析默认的 `wiseeff-app:local`，而不是 commit 镜像。升级后的容器缺失时，应保留剩余容器和镜像证据，并按[自托管升级](upgrade.zh-CN.md)处理，不要猜测标签。

### 重启一个或多个已有服务

```bash
./scripts/compose --env-file .env restart worker
./scripts/compose --env-file .env restart api worker web proxy
```

`restart` 不构建镜像，也不会应用 Compose 环境或配置变化。涉及代码、镜像、migration 或 Compose 变更时，必须使用受保护升级流程。

### 正常停止应用

停止公网和应用流量，但让 PostgreSQL、Redis、MinIO 继续运行：

```bash
./scripts/compose --env-file .env stop proxy api worker web
```

停止当前所有基础服务，但保留容器和 volume：

```bash
./scripts/compose --env-file .env stop
```

随后通过 `start` 启动同一批容器。日常维护优先使用 `stop`/`start`，而不是 `down`/`up`，以保留容器和镜像身份。

## 服务与日志

| 服务 | 作用 | 首要检查项 |
| --- | --- | --- |
| `postgres` | 系统数据事实来源 | 容器健康、磁盘空间、连接和 migration 错误 |
| `redis` | durable queue 传输与持久化 | 健康、AOF 状态、队列 readiness |
| `minio` | 本地 S3 兼容对象存储 | endpoint、凭据、桶权限、磁盘空间 |
| `minio-init` | 可重复执行的桶初始化 | 完成后以退出码 `0` 停止是正常状态 |
| `api` | API、migration、readiness、metrics | `/health/live`、`/health/ready`、migration/启动日志 |
| `worker` | 日志分析任务与 worker metrics | 进程健康、队列 claim、重试和 dead letter |
| `web` | 构建后的前端预览 | 容器健康和页面响应 |
| `proxy` | Caddy 公网 HTTP/TLS 入口 | 端口、证书/路由日志、上游连通性 |

### 升级就绪语义

升级控制器不会采用一个通用的 `running` 规则。PostgreSQL 和 Redis 必须是 Docker `healthy`；MinIO 的 `running` 只表示进程存活；`minio-init` 必须 `exited` 且退出码为 `0`。由于 Compose 文件有意没有 MinIO healthcheck，initializer 成功执行 `mc alias set` 并创建 bucket 才是 MinIO 就绪的权威证明。等待 initializer 的每一轮和退出 `0` 后都会再次 inspect MinIO。

候选 queue resume 前，`apply` 和 `resume` 都必须通过 API readiness、worker `127.0.0.1:8788/health/live` 及 Docker health、web 直连检查；worker 容器存在或 image identity 正确都不代表就绪。部分升级失败后，`old-stack-restored` 表示旧 checkout/image set 已重建、内部恢复门禁通过、queue 已恢复，且最后的 proxy/public 健康也通过。image identity 同时包含记录的 image 引用和不可变的 Docker image ID。`recovery-required` 表示至少一个门禁失败；读取隔离布尔值并只执行记录中的一个 `next_action`。禁止手工改 journal 或自行写入 `next_action=none`。

对于 `queue-resumed`、`starting-proxy` 和 `validating-public`，advanced resume 会先停止并隔离候选 proxy，再复查 API `/health/ready`、worker `127.0.0.1:8788/health/live` 及 Docker health、web 直连。readiness 失败或 worker 不健康时，候选 proxy 启动和公网探测都会被阻止。proxy 隔离失败会记录 `failure_service=proxy`、`failure_code=candidate-proxy-isolation`、`recovery_proxy_stopped=false`，并给出人工隔离的 `next_action`；只有整条顺序通过后才进入 proxy/public 验证，之后仍会执行最终 worker 复查。

最终验证使用 Docker 支持的格式化镜像查询，并按无序集合比较 named-volume 映射，不依赖 Docker 枚举顺序。真实不一致会分别记录 image/container/project/volume/environment 的 service 和 code，不再只留下泛化的 `service=recovery code=recovery-required`。

使用 `./scripts/upgrade.sh status --run-id <run-id> --json` 读取 `failed_phase`、`failure_service`、`failure_code`、`failure_summary`、`recovery_started`、`recovery_verified`、`recovery_failure_summary` 和 `next_action`。两个 summary 都有长度限制并脱敏；任一恢复动作（包括 stop、pause 或 queue resume）失败时，其脱敏诊断会打印、写入 journal，并暴露为 `recovery_failure_summary`。公网探测明确使用 `curl --noproxy '*'`；容器内 `Host: web:5173` 触发的 Vite 403 是 Host allowlist 结果，检查 TCP 连通性时应使用 loopback 或已允许的 hostname。

常用命令：

```bash
./scripts/compose --env-file .env ps -a
./scripts/compose --env-file .env logs --tail=200 <service>
./scripts/compose --env-file .env logs --since=30m <service>
./scripts/compose --env-file .env exec <service> <command>
./scripts/compose --env-file .env config --quiet
./scripts/compose --env-file .env config --images
```

对外发送命令输出前，必须隐藏密码、Bearer token、signed URL、上传日志内容、原始参数值和设备 payload。

## 升级与数据保留的全量重建

每个宿主机/操作员只需执行一次：

```bash
sudo ./scripts/upgrade.sh prepare-host --yes
```

日常交互式升级；不传 `--ref` 时解析刚刚 fetch 的 `origin/main`：

```bash
./scripts/upgrade.sh plan
./scripts/upgrade.sh apply
```

如果部署机仍 checkout 在本次就绪/恢复修复之前的旧控制器提交，必须先 fetch 并切换到包含修复的已合入 release 或 commit，再执行 `plan` 和 `apply`；旧控制器无法解释新的状态机。切换 checkout 时保留 `.env`、journal/备份状态和 named volumes。

`plan` 还会只读校验目标 commit 中固定校验和的 `linux/amd64` Dockerfile 基础镜像包。输出中的 `base image` 会说明本地是否已有完全一致的镜像，或 `apply` 将自动 load/tag 已验证的仓库 tar。安装本控制器版本后不再需要手工执行 `docker load`；准备动作发生在 Compose build 和停流量之前。运行的文本/JSON status 会同时记录 OCI manifest 与 Docker config digest，以及来源 `local` 或 `bundled-archive`，兼容 containerd 与经典 `overlay2` Docker 镜像存储。

`already running` 是经过验证的 no-op，不只是比较 Git：checkout 与目标 SHA 必须一致，API/worker/web 必须都引用该 commit 的精确应用镜像，并且公网健康探测通过。若上一次 apply 只 checkout 到目标、却在构建中失败，重新执行 `apply` 会自动继续构建/重建。

固定受控 release 或 commit：

```bash
./scripts/upgrade.sh plan --ref refs/tags/<release>
./scripts/upgrade.sh apply --ref refs/tags/<release>
# 或：--ref <commit-sha>
```

必要时只覆盖 Git 代理：

```bash
./scripts/upgrade.sh plan --git-proxy http://127.0.0.1:7890
```

升级入口要求已有的 `postgres redis minio api worker web proxy` 全部运行，以便记录 runtime、镜像、网络和 volume 身份。预检提示服务未运行时，先排查再重试：

```bash
./scripts/compose --env-file .env ps -a
./scripts/compose --env-file .env logs --tail=200 <service>
./scripts/compose --env-file .env start <service>
```

首次在目标环境执行前，必须阅读[自托管升级](upgrade.zh-CN.md)，其中定义了恢复点、稳定退出码、维护边界和回滚审批。

## 升级中断、操作锁与回滚

保留每次 apply 输出的 `run_id`。

```bash
./scripts/upgrade.sh status --run-id <run-id>
./scripts/upgrade.sh status --run-id <run-id> --json
./scripts/upgrade.sh resume --run-id <run-id>
```

Docker 或 `npm ci` 构建阶段使 `apply` 以退出码 `20` 结束时，旧服务仍在线。命令会自动把脱敏、部署用户可读的证据保存在运行 journal 中。使用 `status` 打印的 `build_summary` 与 `build_log`；不要查看宿主机 `/root/.npm`，因为 npm 只是在临时 BuildKit stage 内以 root 运行。

```bash
./scripts/upgrade.sh status --run-id <run-id>
cat ops/self-hosted/.state/upgrades/<run-id>/diagnostics/summary.txt
less ops/self-hosted/.state/upgrades/<run-id>/diagnostics/build.log
```

检查 setup/upgrade 共享操作锁：

```bash
./scripts/upgrade.sh lock-status
./scripts/upgrade.sh unlock
```

`unlock` 可安全重复执行：真实操作仍持锁时会返回退出码 `75`，且不会结束该进程。禁止手工删除 `.operation.lock`、owner 元数据或 fallback 锁目录。

migration 后出现 `recovery-required` 属于事故状态，只执行 journal 中唯一的 `next_action`；普通 `resume` 会被拒绝。仅收尾门禁失败时可能给出受保护的候选恢复：

```bash
./scripts/upgrade.sh recover-candidate --run-id <run-id> \
  --confirm recover-candidate-<run-id>
```

该路径会先重新隔离 proxy 和 queue/worker，校验既有备份 manifest 与候选镜像，再按序恢复 worker、queue、proxy 和公网验证，不恢复任何数据。更早或不受支持的 migration 后阶段仍必须使用精确确认 token 做整点恢复：

```bash
./scripts/upgrade.sh rollback --run-id <run-id> \
  --restore-data --confirm restore-<run-id>
```

该操作可能丢弃恢复点之后的 PostgreSQL、对象存储和 durable Redis 写入；只有旧栈完整验证（包括 worker 健康和 proxy/public）通过后才会写入 `rolled-back`，只能由事故负责人批准。

## 备份与恢复证据

每次升级都会自动创建并验证 migration 前恢复点。试点/发布就绪还要求隔离恢复演练。以下证据命令应在具备 Node.js 22 的开发机或 CI runner 上、从仓库根目录执行，不要在 shell 中 source 生产 `.env`：

```bash
npm run backup:drill --target-env-file=ops/self-hosted/.env
npm run backup:check
npm run restore:drill --target-env-file=ops/self-hosted/.env
```

恢复目标必须与生产 PostgreSQL 数据库和生产对象存储桶/prefix 隔离。按照[备份与恢复](../../docs/zh-CN/runbooks/backup-restore.md)执行；本地占位演练不能改写成目标环境就绪证据。

## 图形化监控

主服务健康后启动仅绑定 loopback 的监控 profile：

```bash
./scripts/observability up
./scripts/observability status
./scripts/observability logs -f
```

生命周期命令：

```bash
./scripts/observability restart
./scripts/observability down
```

这里的 `down` 只删除监控容器，保留应用服务和所有 named volume。从操作员电脑通过 SSH 访问 Grafana，不要开放公网端口：

```bash
ssh -L 3000:127.0.0.1:3000 <user>@<server>
```

然后打开 `http://127.0.0.1:3000`。Dashboard、告警路由和目标证据见[可观测性运维](../../docs/zh-CN/runbooks/observability-operations.md)。

## 验证与发布证据

这些命令需要 Node.js 22，通常从开发机或 CI checkout 执行，而不是在最小化部署服务器执行：

```bash
npm run selfhost:check
npm run selfhost:smoke -- --env-file ops/self-hosted/.env \
  --base-url https://<host> --allow-only-blocked=deviceGateway
npm run queue:check -- --env-file ops/self-hosted/.env --base-url https://<host>
npm run observability:check
npm run capacity:gate -- --target-url https://<host>
npm run selfhost:release-gate -- \
  --target-environment <label> \
  --artifact-ref <artifact> \
  --env-fingerprint <sha256>
```

`--allow-only-blocked=deviceGateway` 只适用于明确批准的非 HDC staging 环境，不代表完整试点就绪。本地测试和配置证据不能替代真实目标环境、备份恢复、告警路由、容量、回滚或设备实验室证据。

## 常见故障

| 报错或现象 | 含义 | 安全处理 |
| --- | --- | --- |
| `Self-hosted service is not running: worker` | `worker` 已停止、退出或缺失；其他服务可能仍在运行 | 执行 `ps -a`，保留 `worker` 日志；确认原因后再 `start worker` |
| `Docker daemon is unavailable to the deployment user` | 缺少 Docker group/socket 权限，或当前登录会话未刷新 | 执行 `sudo ./scripts/upgrade.sh prepare-host --yes`，重新登录，再无 `sudo` 重试 |
| 备份根目录不可写 | 宿主机准备或目录 ownership 未完成 | 执行 `prepare-host`；不要用 root 运行普通升级动作 |
| `Another WiseEff setup or upgrade operation holds the host lock` | 存在真实或陈旧的共享操作锁 | 执行 `lock-status`；held 时等待，仅 stale 时使用 `unlock` |
| `category=base-image`，或离线包校验和/平台报错 | 目标契约、tar、Dockerfile 标签或宿主机架构不一致 | 不要随意 pull 或 retag 其他镜像；恢复仓库固定离线包/契约，或换用匹配的受支持宿主机，再重跑 `plan` |
| `Loaded base-image identity does not match` | Docker 返回的既不是固定 OCI manifest digest，也不是所需平台上的固定 config digest | 保留完整 expected/actual 报错和 `status --json`；不要在部署机修改契约 |
| Docker 仍尝试获取 `node:22.21.1-alpine` metadata | 当前已安装控制器早于自动准备离线包版本，或精确固定标签尚未准备 | 按基础镜像文档的手工 fallback 做一次接入；后续 `apply` 会自动准备 |
| checkout dirty 拒绝 | 已跟踪或未忽略文件偏离部署 commit | 检查 `git status --short`，保留操作员文件并有意处理差异 |
| 用户直接运行 Git 成功，但升级 Git fetch 超时 | 可能错误使用 `sudo`、代理环境缺失或 Git 配置不同 | 由部署用户执行；检查代理；必要时用 `--git-proxy` 只覆盖 Git |
| Git 成功，但镜像拉取或构建失败 | Docker daemon/build 使用独立的代理或 CA 边界 | 配置 Docker 服务代理和组织批准的 CA；禁止全局关闭 TLS |
| `npm ci` 失败并提示 `/root/.npm/_logs` | 该路径属于临时镜像构建 stage，不是宿主机 | 查看本次运行的 `build_summary` 和脱敏 `build_log`；修复分类原因后重新执行 `apply` |
| `apply` 输出 `already running` | checkout、三个应用镜像引用和公网健康状态均已针对同一个目标 SHA 验证 | 目标版本已生效；只有确实要同版本全量重建时才加 `--restart` |
| `/health/live` 通过但 `/health/ready` 失败 | API 存活，但必需依赖阻塞 | 保留 readiness JSON，按其中命名的依赖排查 |
| `worker` 配置了 `restart: unless-stopped` 仍反复退出 | 属于启动、配置或依赖错误，而不是普通停止 | 先保留日志并检查依赖 readiness，禁止盲目重启循环 |
| `recovery-required` | 候选或恢复门禁失败 | 查看 `failed_phase`、`failure_service`、`failure_code` 和隔离布尔值；只执行记录的唯一 `next_action`：迁移前 `resume`、符合条件的收尾 `recover-candidate`，或带 token 的整点回滚 |

## 事故首轮处置

```bash
date -Is
./scripts/compose --env-file .env ps -a
curl -fsS https://<host>/health/live
curl -fsS https://<host>/health/ready
./scripts/compose --env-file .env logs --since=30m api worker proxy
```

重启任何服务前，先保留时间戳、request/job/run ID、受影响流程、最后正常 commit 和脱敏日志。如果影响写入、审计、数据库、回滚或高风险设备操作，按照[事故处置](../../docs/zh-CN/runbooks/incidents.md)暂停相应写入，再执行恢复。

## 数据与凭据安全

- 持久状态位于 PostgreSQL、Redis、MinIO、Caddy named volume 以及配置的外部对象存储。普通 `stop`、`start` 和 `restart` 不会删除它们。
- `.env` 包含生产密钥。保持权限 `600`，禁止提交、禁止粘贴到工单，也不要仅为执行命令而 source 它。
- 重启或升级时禁止改变 Compose project name，否则会选择另一套 named volume。
- 禁止手工修改升级 journal 或备份 manifest。
- 企业 TLS 检查导致 Git/curl/Docker 失败时，应安装组织批准的 CA，禁止全局关闭证书校验。
- 除非经过明确批准且确实要丢弃对应数据或凭据，否则禁止执行 `setup.sh --force`、`compose down -v`、`docker volume rm` 或 `docker system prune`。

## 专题运行手册

- [配置向导](setup.zh-CN.md)
- [IP 实验室](ip-lab.zh-CN.md)
- [自托管升级](upgrade.zh-CN.md)
- [自托管运行时](../../docs/zh-CN/runbooks/self-hosted-runtime.md)
- [备份与恢复](../../docs/zh-CN/runbooks/backup-restore.md)
- [持久队列](../../docs/zh-CN/runbooks/durable-queue.md)
- [可观测性运维](../../docs/zh-CN/runbooks/observability-operations.md)
- [发布与回滚](../../docs/zh-CN/runbooks/release-rollback.md)
- [事故处置](../../docs/zh-CN/runbooks/incidents.md)
- [运行手册索引](../../docs/zh-CN/runbooks/README.md)
