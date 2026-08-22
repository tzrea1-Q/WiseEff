# 自托管升级

> English: [English](upgrade.md)

`scripts/upgrade.sh` 是已经运行的自托管 checkout 的标准升级入口。它把目标解析为唯一 Git commit，在停机前构建候选镜像，暂停并排空应用工作，创建并校验恢复点，基于原有 volume 重建全部服务，等待迁移与健康门禁完成，并写入可恢复的运行日志。

宿主机只需要 Docker Engine 和 Compose，不需要 Node.js。命令会读取 `ops/self-hosted/.env`，但不会改写它、轮换密钥、写入种子数据、创建管理员，也不会删除 volume。实现不会调用 `compose down -v`、`volume rm` 或 `system prune`。

Git 获取目标版本时会继承当前命令行的代理环境，并把大写的 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`、`NO_PROXY` 规范化为 Git/libcurl 兼容的小写变量；已有 Git `http.proxy`、URL 专用代理、`GIT_SSH_COMMAND` 和 `core.sshCommand` 配置仍会生效。必要时只对 Git fetch 指定覆盖值：

```bash
./scripts/upgrade.sh plan --git-proxy http://127.0.0.1:7890
```

自动化也可以设置 `WISEEFF_UPGRADE_GIT_PROXY`，命令行参数优先。

不要用 `source .env` 或 source 用户 shell profile 的方式传递代理；升级入口不会执行任意 shell 配置。`--git-proxy` 只适用于 HTTP(S)/SOCKS Git remote，SSH remote 请配置 `GIT_SSH_COMMAND` 或 `core.sshCommand`。

Git、Docker Engine 与应用构建下载属于不同网络边界。脚本可以保留或覆盖 Git 代理，也会把受管构建代理、内部 npm 源和组织批准的 CA 传给 BuildKit，但不会擅自改写宿主机 Docker daemon 代理或信任库。若 `git fetch` 成功，而镜像 metadata 或镜像拉取失败，仍需单独配置 Docker 服务代理。

## 受限网络构建配置

企业服务器必须通过代理访问外部 package/source endpoint 时，先由部署用户一次性创建私有构建网络配置：

```bash
cd /srv/wiseeff/ops/self-hosted
./scripts/build-network.sh init
# 编辑 .build-network.env
./scripts/build-network.sh status
./scripts/upgrade.sh plan
./scripts/upgrade.sh apply
```

该文件只接受文档列出的大小写代理变量、`WISEEFF_NPM_REGISTRY`、`WISEEFF_BUILD_CA_CERT_FILE` 和 `WISEEFF_RUNTIME_PROXY`；脚本只按数据解析，绝不会 source。文件必须是非符号链接普通文件，且只能由 owner 读写（权限 `0600`）。不创建该文件时，现有 shell 代理环境仍然生效。同名非空 shell 值优先；大小写代理值冲突会在修改 Docker 或 Git 前直接拒绝。

`WISEEFF_NPM_REGISTRY` 会在 `npm ci` 时替换已提交 lockfile 内的 registry host。当前入口只支持可通过已配置代理访问、且 URL 本身不含凭据的 registry；脚本会拒绝内嵌账号密码，暂不暴露 npm token 配置。`WISEEFF_BUILD_CA_CERT_FILE` 可用绝对路径或相对 `.build-network.env` 的路径，必须指向组织批准且可读的 PEM。BuildKit 以 secret mount 把 PEM 安装到每个构建 stage，不会把私有配置或代理凭据复制进镜像层；TLS 校验始终开启。

`WISEEFF_RUNTIME_PROXY` 默认 `false`。只有 API/worker 运行时访问也必须走代理时才设为 `true`；控制器会把 Compose 服务名加入 `NO_PROXY`。此时代理凭据会成为 Docker 管理员可见的容器环境数据，应使用专用、最小权限的部署凭据。数据库、Redis、对象存储、web 和 proxy 容器不会接收运行时代理映射。

`plan`、`status` 和 `status --json` 只显示代理/CA 是否已配置、npm registry 主机名与运行时代理开关，绝不打印或持久化代理 URL/凭据。真实配置被 Git 忽略，真实配置与示例契约都被排除在 Docker build context 外。

Dockerfile 基础镜像是一个特例：仓库在 `ops/self-hosted/images/` 中携带了固定校验和的 `linux/amd64` 离线包。`plan` 会只读校验目标 commit 中的离线包契约、tar 校验和、Dockerfile 引用和 Docker server 平台，并输出 `verified local image` 或 `verified bundle; apply will load and tag it`。`apply` 选择不可变目标后、Compose build 前，会再次校验 checkout 中的 tar；若本地没有完全一致的固定镜像，则自动 load，校验 image ID/平台，再创建 `FROM` 使用的精确标签。运行 journal 会记录 `base_image_ref`、`base_image_id`、`base_image_platform`、`base_image_source` 和 `base_image_status`。

这只消除了 `node:22.21.1-alpine` 对 Docker Hub 的依赖，并不代表整个构建已经离线化。Alpine 软件包、固定版本 DTC Git 源、Python 包和 npm 包仍需要受管代理/镜像路径，除非另行打包。其他服务镜像拉取仍属于 Docker daemon 网络边界。控制器不会关闭 TLS、删除镜像或清理 Docker 状态。

## 一次性宿主机准备

首次升级前，先把曾由 root 初始化或操作过的宿主机规范化：

```bash
cd /srv/wiseeff/ops/self-hosted
sudo ./scripts/upgrade.sh prepare-host --yes
```

`prepare-host` 不获取 Git、不构建镜像、不停止服务，也不改动业务数据。它识别发起 `sudo` 的 `SUDO_USER`，必要时把该操作员加入 Docker socket 对应组，创建并保护升级 journal/备份根，并把既有升级状态与恢复产物的所有权交给该操作员。Docker 组权限实质上等同宿主机 root 权限，因此必须使用专用且可信的部署账号。直接以 root 登录时必须传 `--operator <部署用户>`。若命令新增了 Docker 组成员关系，需要退出并重新登录。

`plan`、`apply`、`resume`、`rollback` 必须由部署用户执行，不要加 `sudo`。只要有效用户是 root（包括直接登录 root），升级入口都会拒绝这些动作，因为 root 通常不会继承部署用户的代理环境和 Git 配置，还会再次制造 root 所有的状态文件。

兼容路径也接受 API、worker、web 容器镜像 ID 不同的历史部署。它会分别记录并标记三个服务的旧镜像；需要迁移前恢复或回滚时，再按服务使用对应的原镜像。操作员无需为了通过预检而先手工构建/重建这三个服务。

## 首次接入

先按现有受控流程安装包含该入口的版本。第一次真实执行前，在非客户环境检查 checkout 与在线服务：

```bash
cd /srv/wiseeff
git fetch origin --prune
git checkout <release-commit-containing-upgrade.sh>
cd ops/self-hosted
./scripts/upgrade.sh plan --ref <next-release-tag>
```

检查当前与目标 SHA、变化的 migration、Compose project、volume identity、备份目录和空间门禁。首次接入必须在非客户主机完成一次带恢复点的演练。

旧控制器无法执行只存在于目标 commit 中的新行为。如果部署机当前控制器早于“自动准备基础镜像”版本，并且已经卡在 Docker metadata 解析，可按[自托管基础镜像](images/README.zh-CN.md)中的手工 `docker load`/`docker tag` fallback 做一次接入。安装本版本后发起的后续升级都会走集成流程。

## 日常升级

在当前 checkout 中交互执行。默认 ref 为 `WISEEFF_UPGRADE_REF` 或 `origin/main`；受控部署优先使用 release tag 或 SHA：

```bash
cd /srv/wiseeff/ops/self-hosted
./scripts/upgrade.sh apply --ref refs/tags/<release>
```

命令会在停止流量前要求输入完整单词 `upgrade`。自动化必须同时传入两个确认参数：

```bash
./scripts/upgrade.sh apply --ref <sha> --non-interactive --yes
```

如果目标 SHA 已经在运行，命令成功退出且不做操作；只有确实需要同 SHA 全量重建时才加 `--restart`。

恢复点默认写到 `/var/backups/wiseeff/upgrades/<run-id>`，被 Git 忽略的 journal 写到 `ops/self-hosted/.state/upgrades/<run-id>`。主机有专用且受保护的文件系统时可用 `--backup-root`、`--state-dir` 覆盖。环境文件权限必须保持 `600`。

## 状态与中断

每个变更阶段都会原子写入。SSH 断开或主机重启后，使用输出的 `run_id` 检查：

```bash
./scripts/upgrade.sh status --run-id <run-id>
./scripts/upgrade.sh status --run-id <run-id> --json
```

候选构建始终使用 BuildKit plain progress，并把脱敏后的完整输出同步写入本次运行 journal。基础镜像准备、Docker 或 `npm ci` 失败时，`apply` 会在停止流量前以退出码 `20` 结束、恢复旧 checkout，并打印三个部署用户可读的路径：

- `diagnostics_dir`：位于运行 journal 下、权限为 `0700` 的私有目录；
- `build_summary`：权限为 `0600` 的原因分类和下一步；
- `build_log`：权限为 `0600` 的完整脱敏 Compose/BuildKit 输出。

镜像构建通过内部诊断 wrapper 执行 `npm ci`。失败时，wrapper 会把原本只存在于临时构建容器 `/root/.npm/_logs/*-debug-*.log` 的内容，放在 `WISEEFF_NPM_CI_DIAGNOSTICS_BEGIN/END` 标记之间写入构建输出；同时保留 npm 原始退出码，并遮蔽 URL 凭据、registry token、密码和 bearer token。操作员不需要宿主机 root 权限。查看持久化证据：

```bash
./scripts/upgrade.sh status --run-id <run-id>
cat ops/self-hosted/.state/upgrades/<run-id>/diagnostics/summary.txt
less ops/self-hosted/.state/upgrades/<run-id>/diagnostics/build.log
```

基础镜像契约、tar 或平台失败会归类为 `base-image`。其他故障会自动分类为 dependency lock 不一致、企业 CA、DNS、网络/代理、registry 完整性或包缺失、宿主机容量及疑似 OOM；无法识别时标为 `unclassified`，完整日志仍保留。修复摘要指出的问题后重新执行 `apply` 即可；停流量前的构建失败不需要从 `/root/.npm` 手工复制日志，也不需要执行 `resume`。

在 migration 启动前，排空或备份失败会恢复旧服务，并记录 `old-stack-restored` 或 `failed-safe`。候选 API 启动后失败会记录 `recovery-required`，保持 proxy 停止并保持队列暂停。不要手工修改 journal 或直接恢复流量。

对于可幂等的候选健康/收尾阶段，执行 journal 给出的动作：

```bash
./scripts/upgrade.sh resume --run-id <run-id>
```

`resume` 不会重置 `migration_started`，也不会静默恢复数据。如果状态是 `recovery-required`，必须走显式 rollback 流程。

### 宿主机锁状态与恢复

系统有 `flock` 时，普通 `.operation.lock` 文件会有意保留在磁盘上；文件存在不代表仍被占用。用下面的命令查看内核/fallback 锁状态和持锁者记录：

```bash
./scripts/upgrade.sh lock-status
```

崩溃留下陈旧 owner 元数据或 mkdir fallback 锁时，执行：

```bash
./scripts/upgrade.sh unlock
```

`unlock` 可重复执行；它不会删除普通 `flock` 文件、不会结束进程。真实 setup/upgrade 仍持锁时，它会返回退出码 `75` 并打印记录的 PID、用户与动作。刚创建但尚无 PID 的 fallback 目录会被视为正在获取锁，只有超过五分钟陈旧锁宽限期后才允许清理。已证明陈旧的 mkdir fallback 锁在后续 setup/upgrade 获取锁时会自动移走，因此操作员不应再手工删除锁文件或锁目录。

| `lock_state` | 含义 | 操作员动作 |
| --- | --- | --- |
| `free` | 当前没有操作持锁；普通 `flock` 文件仍可能保留 | 正常继续；可选执行 `unlock` 清理陈旧 owner 元数据 |
| `held` | 真实内核锁或仍存活的 fallback PID 正在持锁 | 等待输出中记录的操作完成；`unlock` 会以退出码 `75` 安全拒绝 |
| `initializing` | 新建 fallback 目录尚未完成 PID 写入 | 等待后重试；被遗弃且超过五分钟后才转为陈旧 |
| `stale` | fallback PID 已不存在，或不完整锁已超过宽限期 | 执行 `unlock`，或直接重试 setup/upgrade 让获取流程自动移走 |

## 回滚与整点恢复

回滚始终需要 run id。migration 启动前可以只恢复上一版本应用镜像；一旦 migration 启动，命令会拒绝只回滚应用，必须使用日志中打印的精确 token：

```bash
./scripts/upgrade.sh rollback --run-id <run-id> \
  --restore-data --confirm restore-<run-id>
```

该操作会把 PostgreSQL、配置的 S3 兼容对象桶和 durable Redis 一起恢复到 migration 前捕获的同一个恢复点，可能丢失恢复点之后的写入，因此必须由事故负责人确认。入口不提供跨存储的部分恢复。

自动化可使用稳定退出码：`0` 完成/无需操作，`2` 输入或确认缺失，`10` preflight/目标失败，`20` 候选构建失败，`30` 排空失败且旧服务已恢复，`40` 恢复点失败且旧服务已恢复，`50` migration 前数据服务失败，`70` 需要显式恢复，`75` 操作锁冲突。

## 运维安全

- 备份目录必须位于 checkout 和 Docker data root 之外；目录权限 `0700`，文件权限 `0600`。
- `ops/self-hosted/.state/` 必须排除在 Docker 构建上下文之外；它保存私有运维 journal，不是应用源码。
- 构建诊断属于私有运维数据。脚本会自动脱敏，但对外分享前仍需再次检查。
- 保持同一个 Compose project 与命名 volume identity，升级时不要增加新的 project name。
- 把 `recovery-required` 当作维护事故处理；直到 `resume` 或获批的整点恢复结束，都保持 proxy 停止。
- 本地测试和 `selfhost:check` 只能验证入口与模板，不能替代目标环境、试点或生产就绪证据。
