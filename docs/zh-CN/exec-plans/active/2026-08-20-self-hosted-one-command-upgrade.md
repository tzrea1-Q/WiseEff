# 自托管一键升级

> English: [English](../../../exec-plans/active/2026-08-20-self-hosted-one-command-upgrade.md)

**目标：** 交付一条面向生产思维的单机升级入口：解析唯一 Git commit、提前构建、停止写入、验证完整恢复点、在不删除 volume 的情况下重建所有 Compose 服务、沿用 API 启动迁移、验证结果，并支持持久化继续与恢复。

**状态：** 本地实现已完成，仓库门禁已通过。声称发布就绪前仍需完成非客户 Ubuntu 目标演练证据。

**设计：** [自托管一键升级设计](../../design-docs/2026-08-20-self-hosted-one-command-upgrade-design.md)

**架构：** 在 `ops/self-hosted/scripts/upgrade.sh` 后放置一个深升级模块。配置和 provision 继续归 `setup.sh`。宿主机实现保持 bash，因此无需 Node.js；Vitest 用伪命令和临时 Git 仓库测试 shell 接口，依赖应用运行时的队列维护逻辑在容器内以 TypeScript 实现。

## 成功标准

- `cd ops/self-hosted && ./scripts/upgrade.sh` 可在一次确认流程中升级已配置的跟踪 ref。
- 目标 ref 只解析一次，运行记录保存不可变 SHA。
- 目标 checkout 校验和应用镜像构建在任何服务停止之前完成。
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
