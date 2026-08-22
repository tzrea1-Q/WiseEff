# 自托管一键升级

> English: [English](../../../exec-plans/active/2026-08-20-self-hosted-one-command-upgrade.md)

**目标：** 交付一条面向生产思维的单机升级入口：解析唯一 Git commit、提前构建、停止写入、验证完整恢复点、在不删除 volume 的情况下重建所有 Compose 服务、沿用 API 启动迁移、验证结果，并支持持久化继续与恢复。

**状态：** 核心实现、宿主机兼容加固、持久构建诊断和 Node 基础镜像离线包准备均已进入 `main`。受限网络后续已经实现并通过本地验证，包括一次完整 `linux/amd64` BuildKit 镜像构建：setup/upgrade 会把代理传入 BuildKit，支持组织批准的企业 CA 与 npm registry，并且只输出脱敏网络状态。声称发布就绪前仍需完成一次干净的前向升级和恢复演练证据。

**设计：** [自托管一键升级设计](../../design-docs/2026-08-20-self-hosted-one-command-upgrade-design.md)

**架构：** 在 `ops/self-hosted/scripts/upgrade.sh` 后放置一个深升级模块。配置和 provision 继续归 `setup.sh`。宿主机实现保持 bash，因此无需 Node.js；Vitest 用伪命令和临时 Git 仓库测试 shell 接口，依赖应用运行时的队列维护逻辑在容器内以 TypeScript 实现。

## 成功标准

- `cd ops/self-hosted && ./scripts/upgrade.sh` 可在一次确认流程中升级已配置的跟踪 ref。
- 目标 ref 只解析一次，运行记录保存不可变 SHA。
- 目标 checkout 校验和应用镜像构建在任何服务停止之前完成。
- 候选构建失败时自动保留部署用户可读、经过脱敏的 BuildKit/npm 诊断和可执行摘要，无需宿主机 root 权限。
- 正常路径不改变 `.env`、不执行 provision/seed、不轮换凭据、不删除 volume。
- PostgreSQL、对象存储和 durable Redis 状态形成一个迁移前已验证恢复点。
- 所有长期运行 Compose 服务完成重建，所有持久化 volume 身份保持不变。
- API 迁移完成后才恢复公网流量。
- 中断运行只有一个合法下一步：安全退出、`resume` 或显式 `rollback`。
- 迁移后失败会保持 proxy 停止并暴露 `recovery-required`，绝不宣称自动回滚。
- 非客户 Ubuntu 演练证明一次前向升级和一次注入迁移后故障的恢复路径，并产出脱敏证据。

## Git 与 PR 工作流

- 从最新 `main` 创建 `feat/self-hosted-one-command-upgrade`。
- 实现代理只在 feature branch 提交；不得 push `main`、开/合 PR 或快进本地 `main`。
- 父代理/会话 owner 评审分支，执行或抽查门禁，批准后开 PR、合并，再运行 `git pull origin main`。
- 原则上一份计划一个实现分支；只有目标环境证据确需后续时才建 evidence-only 分支。
- 目标演练兼容性加固使用从当前 `main` 创建的 `fix/self-hosted-upgrade-host-compat`；父代理/会话 owner 在本地门禁与 CI merge bar 通过后开 PR 并合入。
- 受限网络加固使用 `codex/selfhost-restricted-network-build`；会话 owner 在本地门禁通过后开 PR，并且只在全部 required CI check 通过后合入。

## 前置条件

- 保留当前 setup wizard、doctor、Compose wrapper、self-hosted smoke、durable queue、备份恢复 runbook 和发布回滚 runbook。
- 第一个目标主机仍用现有手工升级命令安装包含 `upgrade.sh` 的 release；后续升级使用新入口。
- 保持当前 Compose project 身份；本计划不引入新的全局 `-p` 名称，以免脱离既有命名 volume。
- 真实证据必须在非客户主机执行，备份根目录必须在仓库和 Docker 数据根目录之外。

## Phase 0 — 先用失败测试锁定接口

**文件：**

- 新建 `ops/self-hosted/scripts/upgrade.sh.test.ts`
- 如确有需要，仅在 `ops/self-hosted/scripts/fixtures/upgrade/` 放置小型无密钥 fixture manifest
- 仅在现有 include 无法发现测试时修改 `vitest.scripts.config.ts`

**任务：**

- [ ] 为 `apply`、`plan`、`status`、`resume`、`rollback` 解析增加黑盒测试。
- [ ] 锁定稳定退出码 `0/2/10/20/30/40/50/60/70/75`。
- [ ] 测试相同 SHA no-op 和 `--restart`。
- [ ] 测试非交互确认和 run-specific restore 确认。
- [ ] 用数据库、对象存储、API key、bearer token canary 测试控制台/journal 脱敏。
- [ ] 测试禁用命令 canary：`down -v`、`volume rm`、`system prune`、Git reset/clean、seed/provision、`setup.sh --force`。

**验证：**

```bash
npm run test:scripts -- ops/self-hosted/scripts/upgrade.sh.test.ts
```

实现前预期因入口不存在而失败；每个切片完成后只留下下一项尚未实现行为为红色。

## Phase 1 — 协议、锁、Journal、Plan 与 Status

**文件：**

- 新建 `ops/self-hosted/scripts/upgrade.sh`
- 新建 `ops/self-hosted/scripts/upgrade-lib.sh`
- 新建 `ops/self-hosted/upgrade-protocol.env`
- 更新 `ops/self-hosted/.gitignore` 或根 `.gitignore` 忽略 `.state/`
- 更新 `ops/self-hosted/scripts/setup.sh` 共享 mutating-operation lock
- 更新 `ops/self-hosted/scripts/setup.sh.test.ts`

**任务：**

- [ ] 实现稳定 launcher 和严格命令解析，不使用 `eval`，不 source 运行状态数据。
- [ ] 为升级、setup 的修改动作和未来 restore 增加共享宿主机锁。
- [ ] 持久化权限 `0700` 的运行目录、原子阶段字段和脱敏 append-only event log。
- [ ] 定义协议版本兼容和目标 checkout 重新执行行为。
- [ ] `plan` 校验 checkout、`.env` 权限/键、当前容器、Compose project/volume 身份、Docker/Compose 版本、磁盘/inode、备份目录、目标 ref 与 migration 变化。
- [ ] `status` 只读 journal，支持 text/JSON。
- [ ] 停机前拒绝 dirty tree、symlink escape、未知数据量、project 漂移、空间不足。
- [ ] 只记录 `.env` 指纹，不输出包含已展开密钥的 `compose config`。

**验证：**

```bash
npm run test:scripts -- ops/self-hosted/scripts/upgrade.sh.test.ts ops/self-hosted/scripts/setup.sh.test.ts
```

预期：无需 Docker daemon 即可通过 plan/status、协议、锁竞争、dirty tree、路径、磁盘和脱敏测试。

## Phase 2 — 不可变目标与 Commit 镜像

**文件：**

- 更新 `upgrade.sh`、`upgrade-lib.sh`、`ops/self-hosted/compose.yaml`
- 更新 self-hosted config check 及测试
- 更新 `ops/self-hosted/.env.example`
- 仅在确需持久化可选 upgrade ref 时更新 profile/env renderer 及测试

**任务：**

- [ ] Fetch 请求 ref，并只解析一次 `<sha>^{commit}`。
- [ ] 记录当前运行应用镜像 ID，打上 run-specific previous tag。
- [ ] 以 detached 部署模式 checkout 目标 SHA，不触碰已忽略 `.env`/state。
- [ ] 校验协议后重新执行目标实现。
- [ ] API、worker、web 使用一个显式 commit 镜像契约，避免重复构建相同源码。
- [ ] 旧容器仍服务时完成构建和镜像/配置校验。
- [ ] 协议、checkout 或构建失败时恢复旧 checkout，不停止任何容器。
- [ ] 未传 upgrade tag 时，保持普通 `setup.sh up` 行为。

**验证：**

```bash
npm run test:scripts -- ops/self-hosted/scripts/upgrade.sh.test.ts ops/self-hosted/scripts/check-self-hosted-config.test.ts
npm run selfhost:check
```

预期：移动 ref 无法在运行中改变目标；构建失败时旧容器和旧镜像仍运行。

## Phase 3 — 队列静默与已验证恢复点

**文件：**

- 新建 `queue-maintenance.ts` 及测试
- 在 `package.json` 增加容器内命令
- 必要时在 Compose 增加固定版本 operations/backup-tool profile
- 更新 upgrade 脚本；只有真正由操作员控制的 timeout/root 才进入 `.env.example`

**任务：**

- [ ] 为 durable BullMQ 实现 `pause`、`drain-status`、`resume`；polling 模式明确 no-op。
- [ ] 暂停 intake，停止公网 proxy，等待活跃工作，优雅停止 API/worker/web。
- [ ] 快照前证明没有 app writer。
- [ ] 生成并通过 `pg_restore --list` 验证 custom-format PostgreSQL dump。
- [ ] 通过固定 `minio/mc` 镜像复制 S3 bucket，并校验 key/size/checksum manifest。
- [ ] durable queue 开启时生成、复制并校验 Redis RDB。
- [ ] 全部 store 通过后才写完整 SHA-256 manifest 和 verified 状态。
- [ ] 静默或备份失败时恢复旧容器、队列和 proxy，并记录安全结果。
- [ ] 保留部分备份用于诊断，但绝不标记为可恢复。

**验证：**

```bash
npm run test:scripts -- ops/self-hosted/scripts/upgrade.sh.test.ts ops/self-hosted/scripts/queue-maintenance.test.ts
```

预期：所有备份故障注入都在未迁移的情况下恢复旧在线栈，journal 无密钥，部分恢复点不会被接受。

## Phase 4 — 有序完整重建、迁移与健康门禁

**任务：**

- [ ] 基于既有 volume 重建 PostgreSQL、Redis、MinIO、`minio-init`，等待健康并核对 mount。
- [ ] 候选 API 启动前立刻记录 `migration-started`。
- [ ] 单独启动 API，观察现有 migrate-before-serve 命令。
- [ ] 证明迁移完成且内部 API liveness 通过后启动 web/worker。
- [ ] 验证完整内部 readiness/健康后恢复队列，最后启动/recreate Caddy。
- [ ] 执行公网 liveness/readiness 与有界 self-hosted smoke。
- [ ] 校验全部长期容器 ID 已变化、镜像正确、volume 身份相同、`.env` 指纹相同，且没有 seed/provision。
- [ ] 完成前记录停机、迁移、smoke 与备份 manifest。
- [ ] 迁移开始后失败时停止 proxy、暂停队列、标记 `recovery-required` 并返回 `70`，不做破坏性恢复。

**验证：**

```bash
npm run test:scripts -- ops/self-hosted/scripts/upgrade.sh.test.ts
npm run selfhost:check
```

预期：每个状态机故障点都有正确安全/恢复行为，并通过完整重启不变量。

## Phase 5 — Resume、Rollback 与整体验证点恢复

**任务：**

- [ ] `resume` 只做单调前进，先检查可观察状态，只复用 checksum 有效备份，绝不重置 `migration-started`。
- [ ] 仅在迁移前或已明确证明 schema 向后兼容时支持不恢复数据的应用 rollback。
- [ ] 实现需要确认的 PostgreSQL、对象存储、Redis 整体恢复。
- [ ] 正常接口拒绝跨存储部分恢复。
- [ ] 已完成/已承载流量的运行恢复旧数据前，提示数据丢失并要求 run-specific token。
- [ ] 在每个状态转换注入 SIGTERM/SIGHUP/宿主机重启式中断。
- [ ] 中断和 `recovery-required` 备份永不自动清理。

**验证：**

```bash
npm run test:scripts -- ops/self-hosted/scripts/upgrade.sh.test.ts
```

预期：每个中断阶段只有一个合法下一步；显式恢复让全部 sentinel store 回到同一恢复点。

## Phase 6 — Ubuntu 真机演练与操作员文档

**文件：**

- 更新根 README、自托管 README/setup、双语 self-hosted/release/backup runbook
- 新建 `ops/self-hosted/upgrade.md` 与 `upgrade.zh-CN.md`
- 必要时更新 verification matrix
- 更新 `scripts/bilingual-docs.ts`、设计文档和本计划

**任务：**

- [ ] 在非客户 Ubuntu 主机准备既有 self-hosted 数据与安全备份目录。
- [ ] 记录 PostgreSQL sentinel、MinIO checksum、Redis queue、Caddy volume、`.env` 指纹、镜像和 commit。
- [ ] 成功执行一次前向升级，证明全部成功标准。
- [ ] 注入一次迁移后 readiness 故障，证明 proxy 保持停止并按确认流程完成整体验证点恢复。
- [ ] 只保存脱敏 manifest、命令状态、hash 和证据引用；不提交 dump、对象 bytes、`.env` 或内部凭据。
- [ ] 双语文档写清首次采用、正常升级、status/resume 和恢复命令。

**最终验证：**

```bash
npm run test:scripts -- ops/self-hosted/scripts/upgrade.sh.test.ts ops/self-hosted/scripts/queue-maintenance.test.ts
npm run selfhost:check
npm run docs:check
git diff --check
```

预期：本地门禁通过，release record 关联一次成功目标升级和一次恢复演练。

## Phase 7 — 目标演练宿主机兼容性加固

首次 Ubuntu 演练证明了升级状态机的基本形态，同时暴露出一组不能继续停留在聊天手工处理中的运维兼容缺口：

| 发现 | 根因 | 必须自动化的处理 |
| --- | --- | --- |
| 部署用户 Git 正常，但 `sudo` 下连接超时 | `sudo` 清除代理环境并读取 root 的 Git 配置 | 保留代理规范化/`--git-proxy`，拒绝任何 root 有效用户执行 `plan`、`apply` 和恢复动作；提供不访问 Git 的 root 专用宿主机准备动作 |
| Docker 只能通过 `sudo` 使用 | 部署用户不在 Docker socket 对应组 | `prepare-host` 检测并把 `SUDO_USER` 加入 Docker 组，同时提示重新登录 |
| `/var/backups/wiseeff/upgrades` 已存在但属于 root | 创建目录时没有把所有权交给部署操作员 | `prepare-host` 创建并设置专用备份根与升级状态根的所有者/权限，不改动业务数据 |
| 本地诊断文件或企业构建修改让 checkout 变脏 | tracked/untracked 文件会改变 Docker 构建上下文或让部署源码不再唯一 | 立即失败并提示 `git status --short`；绝不自动删除操作员改动 |
| root 创建的 `.state/upgrades/<run-id>` 导致 Docker 构建上下文读取失败 | 升级日志被 Git 忽略，但未被 Docker 忽略 | 从 `.dockerignore` 排除 `ops/self-hosted/.state/`，并由 `selfhost:check` 守住 |
| 历史 API、worker、web 容器镜像 ID 不同 | 旧 Compose 形态按服务分别构建镜像 | 按服务保存并标记旧镜像，preflight 接受历史混合身份，恢复时按记录镜像逐服务恢复 |
| preflight/fetch/build 失败后仍可能继续并打印陈旧目标 | `if ! ...` 调用函数时 Bash 会抑制 `errexit` | 为 preflight、目标解析、构建、排空、快照与恢复显式传播每一个错误 |
| 进程退出后锁文件仍存在，或崩溃留下 fallback 锁目录 | `flock` 文件持久存在是正常行为；mkdir fallback 可能陈旧 | 写入持锁者元数据，提供 `lock-status`，并让 `unlock` 只清理已证明陈旧的元数据/fallback 锁，真实内核锁必须拒绝绕过 |
| Compose 提示顶层 `version` 已废弃 | Compose v2 会忽略旧字段 | 删除该字段并更新配置 token 检查 |
| Git 已连通，但 Docker 拉取或 curl TLS 校验仍失败 | Git、Docker daemon 与企业 CA 信任属于不同网络边界 | 脚本保留 Git 代理，文档说明 Docker 服务代理与组织批准 CA；绝不自动关闭 TLS 校验 |

**任务：**

- [x] 增加 fail-fast preflight/fetch/build 与历史混合应用镜像的回归测试。
- [x] 增加 `prepare-host`、`lock-status` 和安全 `unlock` 动作，不扩大 `apply` 权限。
- [x] 增加持锁者元数据，以及 `flock`/mkdir fallback 陈旧锁恢复测试。
- [x] 从 Docker 构建上下文排除升级状态，并移除废弃的 Compose version 字段。
- [x] 更新中英文运维指南/设计，写清一次性准备流程、自动兼容行为、锁决策表和成功证据。
- [x] 本地运行脚本测试、`selfhost:check`、`docs:check`、TypeScript build 与 `git diff --check`。
- [ ] 只在 CI merge bar 通过后合入。

**预期结果：** 全新或曾由 root 操作的 Ubuntu checkout 可通过一条显式宿主机准备命令完成规范化；日常升级由部署用户执行；历史应用镜像无需人工预先收敛；任何失败门禁立即停止；操作员不再手工删除锁文件或锁目录。

## 阶段 8 — 集成候选构建诊断

Docker BuildKit 会在临时 stage 中以 root 执行 `npm ci`。失败信息可能指向 `/root/.npm/_logs`，但这个路径既不是部署用户的宿主机目录，失败 stage 退出后也不可恢复。诊断必须成为升级模块的默认职责，而不是事故现场临时拼接的命令。

**文件：**

- 新增 `ops/self-hosted/scripts/npm-ci-with-diagnostics.sh` 及聚焦测试。
- 更新 `ops/self-hosted/Dockerfile` 和自托管配置检查。
- 更新 `ops/self-hosted/scripts/upgrade-lib.sh` 及公开接口测试。
- 更新升级设计、操作员指南和运维手册的中英文文档对。

**任务：**

- [x] 通过可移植 wrapper 执行 `npm ci`，失败时输出脱敏后的 stage 内 npm debug log，并保留原始退出码。
- [x] 候选构建强制使用 BuildKit plain progress，同时把脱敏输出写入私有运行 journal。
- [x] 把 lockfile、CA、DNS、代理/网络、registry、容量和 OOM 等常见故障分类为简洁摘要。
- [x] 通过现有文本/JSON `status` 暴露构建状态、诊断目录、构建日志、摘要和下一步。
- [x] 保持构建失败发生在停流量前，恢复旧 checkout，维持稳定退出码 `20`，旧栈继续在线。
- [x] 强制 `0700`/`0600` 权限，并回归测试凭据脱敏、日志留存、状态渲染和 Dockerfile 接线。
- [ ] 在目标 Ubuntu 主机注入一次 npm 构建失败，只保留脱敏后的路径与状态证据。

**验证：**

```bash
npm run test:scripts -- ops/self-hosted/scripts/npm-ci-with-diagnostics.test.ts ops/self-hosted/scripts/upgrade.sh.test.ts ops/self-hosted/scripts/check-self-hosted-config.test.ts
npm run selfhost:check
npm run docs:check
git diff --check
```

**预期结果：** `upgrade.sh apply` 会自动把原本不可访问的 BuildKit npm 失败转化为持久化、私有、部署用户可读的诊断包，同时保持“构建失败不产生停机”的不变量和现有操作员接口。

## 阶段 9 — 固定的 Dockerfile 基础镜像离线包

目标 Ubuntu 演练发现，即使仓库包含 amd64 tar，BuildKit 仍会从 Docker Hub 解析 `node:22.21.1-alpine`。checkout 中存在文件不等于 Docker image store 已加载该镜像；tar 内标签也与 Dockerfile 不同；同时 `.dockerignore` 有意排除 54 MB tar，避免它进入应用 build context。因此基础镜像就绪必须由升级控制器在候选构建前负责。

**文件：**

- 在既有基础镜像 tar 旁新增机器可读契约。
- 更新 `upgrade-lib.sh`、公开接口测试和 self-hosted config checker。
- 更新基础镜像、升级、运维手册、设计和执行计划的中英文文档对。

**任务：**

- [x] `plan` 不 source 契约，而是只读目标 commit 的数据；校验 Dockerfile ref、tar blob SHA-256、预期 image ID/平台和 Docker server 平台，不 load/tag。
- [x] `apply` 在构建前再次校验 checkout tar；本地已有完全一致镜像时跳过，否则 load 已验证 tar 并创建 Dockerfile 精确标签。
- [x] 缺失/被修改 tar、未知/重复契约字段、异常镜像身份或平台不匹配时，在 Compose build 与停流量前失败关闭。
- [x] 在文本/JSON status 中记录基础镜像 ref、ID、平台、来源和状态；准备失败归类为 `base-image`，并保持构建退出码 `20`。
- [x] tar 继续排除在 Docker build context 外，禁止自动 pull 替代、关闭 TLS、删除镜像或 prune。
- [x] 回归测试 plan 只读、load/tag 顺序、精确本地镜像跳过、校验和拒绝、平台不匹配、build fail-fast、status 渲染和仓库契约漂移。
- [ ] 在目标主机演练一次输出 `ready-bundled` 的 `plan`，再执行 `apply`，证明 `base_image_source=bundled-archive` 且候选构建无需 Docker Hub 即通过基础镜像 metadata 阶段。

**验证：**

```bash
npm run test:scripts -- ops/self-hosted/scripts/upgrade.sh.test.ts ops/self-hosted/scripts/check-self-hosted-config.test.ts
npm run selfhost:check
npm run docs:check
npm run build
git diff --check
```

**预期结果：** 安装本控制器版本后，标准 `plan`/`apply` 会在候选构建前确定性地从仓库离线包准备固定 Node 基础镜像；任何准备失败都保持旧栈在线。由于旧控制器无法执行只存在于目标 commit 的行为，安装该新控制器的那一次仍可能需要文档中的手工 load/tag 首次接入 fallback。

## 阶段 10 — 受限企业构建网络

Node 离线包只消除了一个 Docker Hub 依赖；Dockerfile 仍需解析 Alpine 软件包、固定 DTC Git 源、Python 包和 npm 包。宿主机 Git 代理成功不代表 BuildKit 的 `RUN` 指令拿到了代理；若企业代理会做 TLS 检查，还必须把组织批准的 CA 放进每个需要联网的构建阶段。

**文件：**

- 在 `ops/self-hosted/scripts/` 下增加一个小型构建网络模块和操作员入口。
- 增加独立于运行时 `.env` 的、权限为 `0600` 的构建网络示例/配置契约。
- 更新 `compose.yaml`、`Dockerfile`、npm 诊断、setup/upgrade 入口和聚焦的脚本/配置测试。
- 在新操作员契约涉及的范围内更新升级、setup、运维、设计、可靠性和环境变量中英文文档。

**任务：**

- [x] 只按 allowlist 把配置文件解析为数据；绝不 source，也不打印代理凭据。
- [x] 保留标准代理变量的大小写形式，拒绝相互冲突的值，并把它们作为 Docker 预定义代理构建参数传给 setup 与 upgrade 构建。
- [x] 支持可选内部 npm registry，并使用 `replace-registry-host=always`，避免 lockfile 中已提交的非默认绝对 tar 地址绕过配置 registry。
- [x] 关闭部署构建专用的 npm audit、fund 和 update-notifier 请求，不改变 CI 安全门禁。
- [x] 通过 BuildKit secret 挂载可选的组织批准 CA，在每个联网构建阶段安装它，绝不关闭 TLS 校验。
- [x] 让 `upgrade.sh plan`、setup preflight 和专用只读状态入口只报告代理/registry/CA/运行时代理状态，不暴露值。
- [x] 仅在操作员显式启用时，才把已批准代理与镜像内 CA 传给 API/worker 运行时容器。
- [x] 保持候选构建失败发生在停机前，保留当前脱敏诊断 journal，并让网络/CA 摘要指向持久构建网络契约。
- [x] 通过公开 seam 覆盖仅 shell 代理、配置文件代理、变量冲突、不安全权限、CA 校验、npm registry 替换、setup/upgrade 接线和凭据脱敏。
- [x] 让固定 Alpine DTC 构建自包含（`yaml-dev`、runtime `yaml`、library path），并从同一固定 DTC commit 构建 Python `libfdt`，不再解析不兼容的旧 PyPI 源码包。

**验证：**

```bash
npm run test:scripts -- ops/self-hosted/scripts/build-network.sh.test.ts ops/self-hosted/scripts/npm-ci-with-diagnostics.test.ts ops/self-hosted/scripts/upgrade.sh.test.ts ops/self-hosted/scripts/setup.sh.test.ts ops/self-hosted/scripts/check-self-hosted-config.test.ts
npm run selfhost:check
npm run docs:check
npm run build
docker buildx build --platform linux/amd64 --load --tag wiseeff-build-network-verify:amd64 --secret id=wiseeff-corporate-ca,src=ops/self-hosted/build-network/empty-ca.pem -f ops/self-hosted/Dockerfile .
git diff --check
```

**预期结果：** 部署用户可以持久化一个私有构建网络文件，也可以直接使用当前 shell 代理，然后继续运行不变的一键 setup/upgrade 接口。Git、BuildKit 包下载、可选内部 npm registry 替换和已批准 CA 信任都可确定性诊断，且不泄露凭据、不修改 Docker daemon 状态。

## 推广与兼容

1. 落地实现，但不改变既有 setup/start 默认行为。
2. 第一次仍通过当前手工 Git/Compose 流程安装包含升级器的版本。
3. 在目标执行 `upgrade.sh plan`，核对检测到的 project/volume 身份。
4. 在非客户主机先演练同 SHA `--restart`。
5. 再演练前向升级和故障恢复。
6. 目标证据评审通过后，才把 `upgrade.sh` 提升为正式默认升级入口。

若 standalone Compose 无法满足某项不变量，预检必须给出可执行的版本提示，不得静默采用更弱路径。

## 文档影响矩阵

| 区域 | 状态 | 文件 | 要求 |
| --- | --- | --- | --- |
| 仓库导航 | Update | `README.md`、必要时 `docs/README.md` | 指向新升级入口，并与 setup 分离。 |
| 计划 | Update | 本计划及英文版、双语 `docs/PLANS.md` | 跟踪实现与证据。 |
| 产品规格 | No change | `docs/product-specs/` | 运维流程，不是产品用户行为。 |
| 架构 | Update | 设计文档双语版；Review `ARCHITECTURE.md`；deployment-operations 双语版 | 记录升级模块与源码部署 seam。 |
| 质量/测试 | Review | QUALITY、testing strategy、verification matrix 双语版 | 若增加常驻目标测试命令则纳入门禁。 |
| 可靠性/runbook | Update | RELIABILITY 及 self-hosted/release/backup runbook 双语版 | 顺序、失败分类、恢复权限、证据。 |
| 安全/治理 | Review | SECURITY、secrets、data classification 双语版 | 备份敏感性、日志脱敏、恢复确认。 |
| 前端/设计 | No change | `docs/FRONTEND.md`、UI 文档 | 无产品 UI 变化。 |
| 生成产物 | Review | 仅目标运行 manifest/证据路径 | 不提交客户数据、dump、`.env` 或密钥。 |
| References | Review | `docs/references/` | 仅在精简协议参考确有价值时新增。 |
| 自托管运维 | Update | `ops/self-hosted/**`、Compose、示例、脚本 | 核心实现面。 |
| 中文开发文档 | Update | 上述所有 companion | 中英文独立并相互链接。 |

## 文档更新门禁

- 计划移入 `completed/` 前，所有 Update/Review 行必须完成更新或记录有证据的不变结论。
- `scripts/bilingual-docs.ts` 必须包含所有新增必需双语操作员/设计文档。
- `npm run docs:check` 为阻塞门禁。
- 若 provider adapter、零停机、registry 预构建 release 或自动 retention 仍希望后续实现，必须加入技术债 tracker。

## UI 交互自动化复核

没有 frontend 可见交互、route、form、UI 消费的 API response 或用户操作变化。不新增 browser acceptance requirement 或 operation ID。目标 self-hosted smoke 属于运维验证，不是 UI 产品变化。
