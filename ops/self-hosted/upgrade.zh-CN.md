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

在 migration 启动前，排空或备份失败会恢复旧服务，并记录 `old-stack-restored` 或 `failed-safe`。候选 API 启动后失败会记录 `recovery-required`，保持 proxy 停止并保持队列暂停。不要手工修改 journal 或直接恢复流量。

对于可幂等的候选健康/收尾阶段，执行 journal 给出的动作：

```bash
./scripts/upgrade.sh resume --run-id <run-id>
```

`resume` 不会重置 `migration_started`，也不会静默恢复数据。如果状态是 `recovery-required`，必须走显式 rollback 流程。

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
- 保持同一个 Compose project 与命名 volume identity，升级时不要增加新的 project name。
- 把 `recovery-required` 当作维护事故处理；直到 `resume` 或获批的整点恢复结束，都保持 proxy 停止。
- 本地测试和 `selfhost:check` 只能验证入口与模板，不能替代目标环境、试点或生产就绪证据。
