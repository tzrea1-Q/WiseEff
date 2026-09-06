# 存量 Catalog 升级终端准备手册

> English: [English](populated-upgrade.md)

## 当前可执行边界

候选提供保护性拦截、有界canonical转换和恢复adapter；**尚未打通完整存量升级，不能交付生产维护命令**。源版本保持 `82344044b436a8dafecefbb85dfd724cecb05e3f`；当前集成base为 `cda6737a8f177a8bbd2f3bc7d195f8e3037bfa74`，早期base和执行保留在证据记录中。用户提供的计数／镜像是历史观察，不是新冻结清单或恢复证明。私有部署路径、原始值和备份不得放入公开证据。

| 入口 | 实际做到哪里 |
| --- | --- |
| 普通 stack apply | 旧 stack 生命周期；canonical 目标在构建/no-op前拒绝 |
| Catalog apply fresh/populated | 冻结 plan/execute/P11a；不授权对外服务 |
| Release Verification | purpose/pins/report/approval/runtime pin 模块存在，实际启动尚未接线 |
| P12/P13/P11b/P14/P15 | 当前候选没有完整可执行集成 |

## 开发环境

机器：独立开发机；用户：开发者；目录：审阅候选仓库。前置：Git 中有源版本对象、Docker 可用、锁定依赖。输入均为合成数据；测试自行创建独立数据库，会写临时测试存储，不停止部署服务。

```bash
npm ci
UPG_IDENTITY_DOCKER_TEST=1 npm run test:scripts -- scripts/inspect-upgrade-runtime-identity.test.ts
npm run test:scripts -- scripts/inspect-populated-upgrade-source.test.ts scripts/inspect-populated-upgrade-source.integration.test.ts
npm run test:scripts -- scripts/reconcile-upgrade-cli.test.ts ops/self-hosted/scripts/upgrade-compatibility.test.ts
npm run test:scripts -- ops/self-hosted/scripts/build-network-trust.test.ts
```

预期：非零用例收集、退出 0。setup失败或skip不能算真实边界通过。源回归用原版126份迁移建 schema，应用候选11份后缀；少量合成值／历史是有界 oracle，不是全量消费方语义，也不是用户真实数据副本。

### 可重复的 Binding 组件测试

机器／用户／目录：独立Docker Desktop开发机、开发者、固定候选checkout。
前置：锁定依赖、Git中的源对象、受信本地 `pgvector/pgvector:pg16` 镜像。
先独立核对宿主与daemon，再从已核验身份记录设置 `UPG_EXPECTED_DAEMON_ID`；
不能自动把当前响应的daemon当作批准目标。入口不接收部署URL或备份。

```bash
: "${UPG_EXPECTED_DAEMON_ID:?必须设置已核验的开发daemon身份}"
env -i PATH="$PATH" HOME="$HOME" node --import tsx \
  scripts/run-upgrade-component-tests.ts \
  --expected-daemon-id "$UPG_EXPECTED_DAEMON_ID" --suite bindings
```

命令创建新的owned PostgreSQL、私有凭据、网络和receipt，并清理这些精确资源；
不停止应用。预期：非零收集、exit 0、`scope=isolated-components-only`、
`cleanupVerified=true`、`releaseApproved=false`。setup、测试、身份或清理失败
均非零停止；保留输出，不重置部署journal或删除无关资源。套件从旧schema构造
合成Binding，经真实P8/P9模块转换；早期P0/P7仍是有界夹具准备，不是完整
controller／报告链。pgvector镜像不证明生产 `postgres:16-alpine` 兼容。
这条命令不是M2完整升级入口。

## 固定新入口准备：保留旧部署身份

在独立管理／开发机准备审阅 clone，在那里 fetch 并固定候选 commit，核验 tree／完整文件包清单，并安装锁定依赖。保留旧部署 checkout、每个应用旧镜像、Compose project 和实际卷身份。不得先在正在服务的 checkout 执行 pull、checkout、安装依赖或覆盖 `.env`。

新 clone 当前仅可用于检查。**不要运行它的默认 Compose**：还没有绑定旧部署 project／卷／桶／Redis，也不能把新 clone HEAD 记成旧运行服务的 previousSha。绑定这些身份的可执行交接仍是缺失集成，本手册不提供远程下载脚本后立即执行的步骤。

## 生产只读采集

机器：部署机；用户：现有可信部署操作员；目录：原来的 `ops/self-hosted`。前置：单独批准本次采集；输出保留在私有交接区域。以下命令不修改数据库或停止服务，使用原部署已有 wrapper，不能使用未绑定的新 clone。

```bash
git rev-parse HEAD
./scripts/compose ps -q api worker web postgres redis
./scripts/compose exec -T postgres psql -X -v ON_ERROR_STOP=1 -U wiseeff -d wiseeff <<'SQL'
BEGIN READ ONLY;
SELECT name, checksum FROM public.schema_migrations ORDER BY name;
SELECT extname, extversion FROM pg_extension ORDER BY extname;
SELECT count(*) AS revisions,
       count(typed_value) AS typed_present,
       count(canonical_value) AS canonical_present,
       count(raw_value) AS raw_present
FROM public.project_parameter_binding_revisions;
ROLLBACK;
SQL
```

预期：完整 ledger 和聚合值存在量。SQL null 与 JSON null 不同；总数不能证明关系保全。连接失败、缺表、缺 checksum 或不可查询时停止，不记为0，不修 ledger、不改凭据。容器 ID 是私有运维引用；镜像／Compose／mount 用过滤字段的 `docker inspect` 采集，不能导出包含环境秘密的完整 inspect。

如已批准管理机连接，可在审阅 clone 使用秘密设施私下提供 `DATABASE_URL`，运行新工具；不要把连接串放在命令参数中：

```bash
node --import tsx scripts/inspect-upgrade-runtime-identity.ts
node --import tsx scripts/inspect-populated-upgrade-source.ts --candidate-sha "$UPGRADE_CANDIDATE_SHA"
```

`UPGRADE_CANDIDATE_SHA` 必须是该 clone 中存在的、审阅记录给出的40位 commit。工具只读，但连接授权需单独取得。身份检查使用新登录，不代表旧 pool 已切换。`inventory-collected`、`inspected`、`authorization:none`、`capabilityAuditComplete:false` 都不批准升级。非零结果保留并逐项处理。源检查覆盖全部 public/Catalog 表计数、列、ledger、扩展能力，不生成正式 P0 graph 或完整语义指纹。

## 授权后备份／停写

**当前尚不可执行。** 恢复负责人必须先交付所有写入方清单、真实三存储身份、owner/ACL方案、私有加密／密钥保管、Redis全部持久用途和同边界快照实现。现有 `backup:drill`／`restore:drill` 声明性辅助工具、`pg_restore --list` 均不证明实际恢复。旧 run 的 completed 或 recovery_point_verified 不能作为这次恢复证据。这里不提供占位符破坏命令。

## 隔离副本预演

### 续工接线与验证边界

当前候选新增显式叠加文件 `compose.catalog.yaml`，用
`WISEEFF_API_ENV_FILE`、`WISEEFF_WORKER_ENV_FILE` 替换原共享环境文件。
`CATALOG_GOVERNANCE_DATABASE_URL` 仅供 API；两个运行文件均不得放迁移凭据。
`WISEEFF_MANAGEMENT_ENV_FILE` 仅供需显式选择的 `catalog-management` profile。
该叠加配置中 API 通过 verify-only 服务入口启动；原普通 stack 配置保留兼容。
叠加文件本身不绑定旧卷、不停写、不批准迁移，也不使新 checkout 自动成为安全生产入口。

机器：隔离开发机；用户：开发者；目录：固定候选 checkout，已安装依赖。
以下永久回归调用真实 Compose 配置解析，仅写临时私有文件，不启动或停止容器：

```bash
npx vitest run --config vitest.scripts.config.ts ops/self-hosted/scripts/catalog-compose.test.ts
```

预期两项通过：API/worker/web/proxy 不含管理秘密，worker 不含治理凭据，
缺少 API 私有配置时拒绝，管理服务仅属于显式 profile。数据卷／网络为明确命名的
external 资源，候选镜像不允许隐式 build／pull；名称本身仍不证明真实目标身份。失败即停止集成。
API／worker的NODE_ENV固定为production，私有env中的development／test不能覆盖；
handoff还拒绝冲突值、空值和带引号值，未设置时使用Compose固定值。
Compose 必须支持 `!override`、`!reset`；版本不支持时失败，不能退回合并旧共享秘密文件。
构建元数据使用 `WISEEFF_SOURCE_SHA`、`WISEEFF_SOURCE_TREE`；handoff 还需对照
固定 Git 对象和真实 image ID，标签本身不是可复现构建证明。

新增 `handoff.ts` 绑定实测源 artifact、Compose 资源与三存储身份，在既有
operation lock 内打开既有 controller journal。真实 Compose 回归的应用镜像为
明确的身份 fixture，仅证明首次接管；停服或替换应用后的阶段化 resume、真实旧应用
artifact 和完整报告链仍需集成。当前仍没有可执行的生产交接命令。

管理迁移CLI现在仅解析DATABASE_URL和XIAOZE_CHECKPOINTER，不要求运行期认证、
provider或对象存储秘密。checkpoint模式仍默认memory；隔离管理阶段需要准备
checkpoint时必须显式postgres。父已在专属新PG数据库用仅这些输入及production模式
执行实际CLI：137项迁移、4张checkpoint表，exit 0。这仅证明管理阶段，不是populated
转换，也不授权部署迁移。获批根工作流尚未接通，不得单独以生产URL调用它。

开发机合成三存储恢复有真实入口。机器／用户／目录同开发测试；前置为 `scripts/rehearse-upgrade-recovery.ts` 列出的本地镜像和本地隔离 Docker endpoint，缺镜像会在创建容器前失败。仅接受合成模式，自建独立 PostgreSQL／Redis／MinIO 源与目标，写入临时数据，不接受外部 URL 或备份：

```bash
node --import tsx scripts/rehearse-upgrade-recovery.ts --synthetic-only
```

预期退出0，证据明确 `synthetic package only`；分别记录备份存在／checksum／恢复执行／合成行为验证。导出后停止源三存储，独立子进程仅消费包与私有目标输入，核对 `sourceStoppedBeforeRestore=true`、`separateRestoreProcess=true`。检查 PostgreSQL owner/ACL 与受限登录、两个不同对象及来自备份的 metadata、Redis AOF（`redisPersistence="AOF"`）。队列形状的 Redis 键仍不是实际 Bull worker 业务验收。`cleanupVerified=true` 只表示自建资源清理；临时备份不保留（`backupRetained=false`）。`fullBusinessVerification=false`、`releaseReady=false` 必须保持。adapter 已支持有界接收校验并拒绝目标旧 AOF；256 MiB 内存限制、未加密私有包不构成生产加密／密钥管理方案。失败时保留脱敏阶段，不推导生产恢复命令。

真实数据副本：**blocked，尚无受控可恢复备份，生产加密、角色策略及完整业务恢复仍需集成**。本手册不授权生产导出。获批隔离环境需禁用外发邮件、webhook、真实设备及非必要模型调用；provider模拟状态与实际认证／数据库／业务调用证据分别标记。开发合成回归不替代此步骤。

包v2显式保存角色INHERIT及PG16成员关系每条边的INHERIT／SET选项，拒绝未知字段、
高权限属性、ADMIN、外部角色边和秘密字段。v1包不得隐式升级，需从获授权源重新导出。
`roleCapabilitiesVerified=true`仅覆盖声明的合成profile：继承读、显式SET ROLE、
写入／提权拒绝，不证明全部应用或数据库全局权限已恢复。

## 最终生产维护与确认点

**尚不可执行，暂不申请维护窗口。** 发布集成负责人需按冻结规范交付并验证：P2停写／排空→P3同边界恢复点→P4独立管理迁移→完整冻结清单/plan/Archive/mapping→P11a→获批P12→P13→新的完整V01–V17/D01–D09 attempt→获批runtime pin→verify-only启动API/worker/web→隔离验收→精确public-release报告与两类独立批准→P15放流。不得用手工建表、修改ledger或隐含SQL补缺失阶段。

## 按失败阶段恢复

| 失败点 | 操作与停止点 |
| --- | --- |
| 检查／参数／构建信任拒绝，尚未写入 | 保留输出，修正审阅输入；不变更服务 |
| 旧controller尚未迁移 | 读取其journal记录，旧服务恢复与候选授权分开，不猜状态 |
| 部分迁移／未知提交 | 保持隔离，由owner分类checkpoint和恢复资格，不重置journal、不自动重试 |
| 候选已接受业务写／投递／公开流量 | 永久关闭pointer-only资格，仅可按事故批准进行完整恢复 |
| DB／对象／Redis／角色部分恢复 | 停止，不恢复queue/proxy后再补数据 |

生产破坏性恢复命令暂不提供：目标绑定的完整实现尚缺。禁止用仅回退镜像、`--no-owner`、带删除的桶mirror或Redis清空替代。保留旧镜像和恢复材料，并保留旧构建insecure事实。

## 独立阻塞与负责人

发布集成owner：P12/P13归属决策、真实目标上下文、运行／公开门禁与固定入口交接。运行安全owner：能力清单、角色迁移与pool拆分、独立管理checkpoint、真实业务权限反例。恢复owner：备份接收、三存储与角色adapter、同边界及业务恢复。产品owner：#815权威关联或明确批准unavailable。构建操作员：企业CA、Docker／依赖信任和镜像来源。验收owner：完整消费方语义、浏览器与增长容量。数据owner：授权真实备份。生产操作员／审批者：维护批准。各项独立保留，不统一推给OP-09。
