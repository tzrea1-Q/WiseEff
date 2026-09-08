# 存量 Catalog 升级终端准备手册

> English: [English](populated-upgrade.md)

## 当前可执行边界

开发隔离 runner 新增 `legacy-source-capture-three-store`。执行机器是已核验的开发
宿主，目录是独立开发 checkout，用户须拥有事先准备的私有 custody 输入；显式传入
`--expected-daemon-id` 和 `--management-snapshot-input-file`。后者须为同用户私有
目录中的绝对文件路径，仅引用已有 artifact／journal custody，不能提供批准或运行
pin。实际测试命令记录在证据中。该入口创建并停止自有合成服务，采集停写源，不能用于
生产升级，也未完成P0／P13。缺输入在Docker准入前失败；清理失败保留私有证据并停止，
不得删除证据或覆盖未知结果重试。普通 `legacy-source-three-store` 保持独立。

PR #824 续工：`PCAT-RUNTIME-WORKER-INITIALIZATION-FAILED` 表示准入之后的
worker 初始化失败；连接池已关闭，或关闭尝试失败。不得以提权或恢复队列处理。
该修复没有新增合法启动路径或生产升级命令。

worker 的启动／停止现在负责 listener、消费者和数据库 pool；
`PCAT-RUNTIME-WORKER-START-FAILED` 或 `PCAT-RUNTIME-WORKER-SHUTDOWN-FAILED`
保留非零退出和静态诊断。Polling 停止等待当前任务，durable 构造／关闭等待
Queue／Worker 清理。这些生命周期修复不授权消费，也不证明获批启动。最后 durable
实现源 `2381aaff1` 已通过独立 Standards/Spec 审查；父 API 请求排空及既有存储
P12／journal 增量也已在限定范围内通过独立审查并集成，不覆盖完整启动 producer
或 controller 成功升级。`801e0a8b3` 的父监督真实 Redis 九例通过，包括泄漏断言
自身失败时也不输出秘密的永久反例。

用户已于 2026-09-07 授权两项限定实现：[登记的恢复执行层](storage/execution/README.zh-CN.md)，
同时保留 S11-RP 检查入口无恢复副作用；以及追加迁移 0140 的
[Catalog reader](../../server/modules/catalog-kernel/security/catalog-reader.zh-CN.md)。
历史 0138/0139 字节保持不变。这些决定不授权生产操作、治理 EXECUTE 扩展、
Binding/ProjectValue 授权或发布。Policy #815 仍需独立决定。
受限登录的正式 Kernel 读取已验证；API/worker 启动和完整 controller 仍是未完成的独立集成。

候选提供保护性拦截、有界canonical转换和恢复adapter；**尚未打通完整存量升级，不能交付生产维护命令**。源版本保持 `82344044b436a8dafecefbb85dfd724cecb05e3f`；当前集成base为 `cda6737a8f177a8bbd2f3bc7d195f8e3037bfa74`，早期base和执行保留在证据记录中。用户提供的计数／镜像是历史观察，不是新冻结清单或恢复证明。私有部署路径、原始值和备份不得放入公开证据。

| 入口 | 实际做到哪里 |
| --- | --- |
| 普通 stack apply | 旧 stack 生命周期；canonical 目标在构建/no-op前拒绝 |
| Catalog apply fresh/populated | 冻结 plan/execute/P11a；不授权对外服务 |
| Release Verification | purpose/pins/report/approval/runtime pin 模块存在，实际启动尚未接线 |
| P12 | 已集成既有 0137 事件／checkpoint 实现及正式报告关联；获批 apply 的正向成功仍依赖完整 live gate／producer 链。早期新增表原型继续排除 |
| P13/P11b/P14/P15 | 既有存储旧LOGIN fence及真实源endpoint观察已作为组件集成；bootstrap／superuser源、完整退休、报告及发布仍未完成 |

## 开发环境

### 固定应用产物准备（仅开发机）

执行机器是独立核验的本地Docker Desktop宿主，以开发用户在干净、固定候选checkout
内运行。输入来自私有Git副本中指向精确候选SHA的合成tag、实测daemon ID，以及新建的
规范绝对路径、同用户、`0700` journal父目录。以下变量必须来自这些实际观察；不得使用
生产checkout、配置或历史生产image ID。`73f12a24e` 实际执行了这些入口，并从另一工作
目录启动独立inspect进程。

```sh
bash ops/self-hosted/scripts/upgrade.sh artifact-init \
  --journal "${ARTIFACT_JOURNAL:?}" --run-id "${ARTIFACT_RUN_ID:?}"
bash ops/self-hosted/scripts/upgrade.sh artifact-prepare \
  --journal "${ARTIFACT_JOURNAL:?}" --run-id "${ARTIFACT_RUN_ID:?}" \
  --source-repository "${PRIVATE_SOURCE_REPOSITORY:?}" --source-sha "${CANDIDATE_SHA:?}" \
  --expected-daemon-id "${OBSERVED_DAEMON_ID:?}" --release-tag "${SYNTHETIC_SOURCE_TAG:?}" \
  --api-base-url "${ISOLATED_API_BASE_URL:?}"
bash ops/self-hosted/scripts/upgrade.sh artifact-inspect \
  --journal "${ARTIFACT_JOURNAL:?}" --run-id "${ARTIFACT_RUN_ID:?}"
```

Init只写新的空宿主run，拒绝替换已有run。Prepare持有真实宿主锁，写入request／pending／
receipt／committed证据，实际构建并保留镜像和OCI包，不停服、不启动服务。Inspect持有
同一锁，读取原包而不重建。成功prepare／inspect返回相同source／image／receipt／pins，
且 `releaseApproved:false`；这只是构建产物保管，不是runtime／public批准或完整升级。
任何非零退出都停止：保留journal和包，不删除pending／unknown、不替换receipt、不用
新run重试未知操作。这些步骤不授权清理或生产维护。企业网络可通过现有
`--build-network-file` 参数传入私有构建网络文件；真实企业网络验证仍是独立条件。

在隔离开发 checkout、以开发用户运行以下永久 worker 生命周期 selector。
输入是合成 adapter 与真实私有 HTTP listener，不接收数据库或生产凭据，不停服。
记录当前实际收集／通过／失败数；任何失败都停止验收，不据此执行运维恢复。这不是 production
startup 验收命令。

```bash
./node_modules/.bin/vitest run --config vitest.runtime-bootstrap.config.ts \
  server/modules/logs/workerRunner.test.ts \
  server/modules/logs/workerRunnerBootstrap.test.ts \
  server/modules/logs/worker.test.ts \
  server/modules/logs/logAnalysisQueueRuntime.test.ts
```

组件入口提供 `reader-pg16`、`runtime-identity-pg16`、`read-projections-pg16`、`report-pg16`、
`authority-pg16`、`scripts-pgvector`、`server-pgvector`、`schema-doc`、`docs-check`、
`log-redis`、`activation-existing-pg16` 和 `retirement-existing-pg16`
独占测试通道。执行机器必须是已独立核验的开发 Docker Desktop；
用户为开发者，目录为审阅候选仓库。先确认 daemon 及资源归属，再用仓库的
`tsx` 执行 `scripts/run-upgrade-component-tests.ts`，传入真实的
`--expected-daemon-id` 和选择的 `--suite`。这些命令创建并删除新的数据库集群、
网络和卷，不停止部署服务。`schema-doc` 还会生成并写入
`docs/generated/db-schema.md`，不是只读检查。预期是测试退出码 0 且
`cleanupVerified: true`；任一失败停止验收，不连接部署数据库补跑。
`docs-check` 必须实际比对数据库schema；缺少专用数据库或vector扩展时失败，不以skip通过。

复跑真实Catalog路由和持久Review查询：机器为上述独立核验的开发宿主，用户为开发者，
目录为固定候选checkout。输入为已核验的开发daemon ID；数据库数据和角色均由runner
合成创建。命令只写入并清理自己新建的集群、网络和卷，不停止部署服务：

```bash
: "${UPG_EXPECTED_DAEMON_ID:?必须设置已独立核验的开发daemon身份}"
env -i PATH="$PATH" HOME="$HOME" ./node_modules/.bin/tsx \
  scripts/run-upgrade-component-tests.ts \
  --expected-daemon-id "$UPG_EXPECTED_DAEMON_ID" --suite read-projections-pg16
```

代码 `8ed7ac196` 的预期为两文件、10项测试、退出0、清理已核验。缺文件在Docker
创建前失败；setup、断言或清理任一失败即停止验收。Catalog GET正例使用真实0140-only
LOGIN；Review正例使用既有较宽治理能力和只读事务，0140-only身份仍被拒绝读Review。
本命令不启动API或worker，不授权runtime、队列、流量或生产升级。

相同开发机器/用户/目录，选择 `--suite runtime-identity-pg16` 可运行既有十一项真实
登录、checkout、checkpoint及API/worker进程拒绝反例。父runner提供已核验PG16 receipt
并负责全部资源清理，不再使用opt-in skip或默认部署连接。预期收集十一项并验证清理；
其中包含受限业务/checkpoint操作，不包含获批runtime pin下的启动成功。

retirement通道在独占PG16 Alpine上调用真实角色fence和原endpoint核对。父进程在
测试child启动前创建并持久登记全部endpoint资源，child结束后只清理这些精确对象。
测试读取停止容器的真实解析文件，并使用两个不同PG目标。执行机器／用户／目录及
身份前置条件同上；会写入临时角色和数据，但不停止用户部署服务：

```bash
: "${UPG_EXPECTED_DAEMON_ID:?必须设置已独立核验的开发daemon身份}"
env -i PATH="$PATH" HOME="$HOME" node --import tsx \
  scripts/run-upgrade-component-tests.ts \
  --expected-daemon-id "$UPG_EXPECTED_DAEMON_ID" --suite retirement-existing-pg16
```

预期非零收集、退出0、清理已核验。显式timeout故障实验则预期child／runner失败，
另行验证清理，不算业务suite通过。缺测试／config在创建资源前失败。这里的源是
PG／psql probe，不是实际旧API／worker交接，不是完整获批的
`retireLegacyApplicationLogins` 执行、P13批准或重启。

仅 GitHub 使用的 `--github-hosted` 要求实时签名 OIDC、实际干净 checkout
（含非 ignored 未跟踪文件）和固定本地 daemon；不能用调用者 token 或 CI 布尔值代替。
reader、report 和 authority job 均为必需门禁，各用独占集群，
避免角色反例污染 server 测试。
参见[Hosted 准入合同](../../scripts/upgrade-hosted-admission.zh-CN.md)。
以上均为开发组件验证，不能当作生产维护命令或发布批准。

机器：独立开发机；用户：开发者；目录：审阅候选仓库。前置：Git 中有源版本对象、Docker 可用、锁定依赖。输入均为合成数据；测试自行创建独立数据库，会写临时测试存储，不停止部署服务。

```bash
npm ci
UPG_IDENTITY_DOCKER_TEST=1 npm run test:scripts -- scripts/inspect-upgrade-runtime-identity.test.ts
npm run test:scripts -- scripts/inspect-populated-upgrade-source.test.ts scripts/inspect-populated-upgrade-source.integration.test.ts
npm run test:scripts -- scripts/reconcile-upgrade-cli.test.ts ops/self-hosted/scripts/upgrade-compatibility.test.ts
npm run test:scripts -- ops/self-hosted/scripts/build-network-trust.test.ts
```

预期：非零用例收集、退出 0。setup失败或skip不能算真实边界通过。源回归用原版126份迁移建 schema，应用当前候选精确后缀（12份，0129–0140）；少量合成值／历史是有界 oracle，不是全量消费方语义，也不是用户真实数据副本。较早11份后缀的执行保留其历史范围。

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

管理激活阶段可在持有 journal 精确父目录的既有 issued lock 时调用
`verifyStoppedHandoff`：重新观察固定交接目标，要求三个源应用均已停止，核对资源／配置
漂移，并再次验证同一把锁。它不负责停写或队列排空，不生成 P2 证明，也不批准激活；
这些事实仍由实际根入口分别提供。普通 `inspectHandoff` 保持准备阶段要求源服务运行的合同。

新增 `handoff.ts` 绑定实测源／候选 artifact、Compose 资源、私有配置与三存储身份，
使用既有 operation lock。真实 Compose 回归的应用镜像仍为身份 fixture；现在仅当
已提交的 P2 证据允许时接受原有应用容器已停止的状态，仍拒绝替换容器和未知 journal
结果。每次以新 nonce 与真实锁持有进程交互验证锁存活。这不证明真实旧应用启动、
候选替换、Redis 停止后的恢复或完整报告链，仍没有可执行的生产交接命令。

Activation intent／binding 的内层摘要使用正式领域合同序列化；外层宿主事件和 journal
仍使用既有宿主序列化，两者摘要范围不同。旧的仅按宿主算法构造的合成 activation
夹具并非合法领域记录，现予拒绝。不得改写 journal 的 hash 或推断未知 SQL 没有提交；
必须在原锁下对精确领域 attempt reconcile。此修复不签发 P12、runtime 或公开批准。

管理迁移CLI现在仅解析DATABASE_URL和XIAOZE_CHECKPOINTER，不要求运行期认证、
provider或对象存储秘密。checkpoint模式仍默认memory；隔离管理阶段需要准备
checkpoint时必须显式postgres。父已在专属新PG数据库用仅这些输入及production模式
执行实际CLI：137项迁移、4张checkpoint表，exit 0。这仅证明管理阶段，不是populated
转换，也不授权部署迁移。获批根工作流尚未接通，不得单独以生产URL调用它。

受控管理函数还要求固定源描述、候选完整迁移清单、真实宿主锁、停写／恢复边界
adapter，以及既有目标级 journal 中的持久 attempt。它核对全量旧 public 行投影及
每个迁移 filename/checksum，固定管理连接 search_path，以管理身份准备 checkpoint。
P4 消费前只读重算 receipt；普通 CLI 成功、表存在、传入一个摘要或未决 attempt 均
不能替代它。部分成功／未知结果仍需显式 reconcile，终端组合根尚缺此接线。

额外 PostgreSQL 16 Alpine 组件矩阵（不是部署升级）：机器为已独立核验的本地
Docker Desktop 开发宿主；用户为开发者；目录为固定候选 checkout，已安装依赖。
输入是已核验的开发 daemon ID；命令只新建并清理自有合成数据库、角色、容器、网络
和卷，不停止已有服务、不接受生产 URL。所需镜像必须预先存在。执行前将独立核验
的开发 daemon ID 放入私有 shell 变量 `UPG_DEVELOPMENT_DAEMON_ID`；不能把当前
Docker context 自动视为隔离授权：

```bash
node --import tsx scripts/run-upgrade-component-tests.ts --expected-daemon-id "$UPG_DEVELOPMENT_DAEMON_ID" --suite bindings-pg16
```

预期：确有用例收集、退出 0、输出 `isolated-components-only`，并记录实际
`postgres:16-alpine` image ID 与自有资源清理结果。错误 daemon、缺私有目标 receipt、
setup 或测试失败均停止，不能记为 skip 或性能通过。独立的 `--suite bindings`
继续使用 pgvector Catalog lane；新增矩阵不放宽原 lane 要求。

开发机合成三存储恢复有真实入口。机器／用户／目录同开发测试；前置为 `scripts/rehearse-upgrade-recovery.ts` 列出的本地镜像和本地隔离 Docker endpoint，缺镜像会在创建容器前失败。仅接受合成模式，自建独立 PostgreSQL／Redis／MinIO 源与目标，写入临时数据，不接受外部 URL 或备份：

```bash
node --import tsx scripts/rehearse-upgrade-recovery.ts --synthetic-only
```

预期退出0，证据明确 `synthetic package only`，分别记录备份存在／checksum／恢复执行／合成行为验证。正式 producer 在真实宿主锁下记录停写三存储 capture；独立自有认证集群通过四个不同合成 principal 的正式确认／批准命令写入授权。导出后停止源三存储，独立子进程仅消费包与私有目标输入，核对 `sourceStoppedBeforeRestore=true`、`separateRestoreProcess=true`。检查 PostgreSQL owner/ACL 与受限登录、两个不同对象及来自备份的 metadata、Redis AOF（`redisPersistence="AOF"`）。恢复子进程不启动消费者。

真实 BullMQ 任务、payload 与暂停状态从 AOF 恢复；随后独立的受控合成验收才恢复任务，使用受限数据库登录验证“提交写入后失败，再重试”由业务唯一约束只产生一行。`actualQueueVerified`、`queuePausedAfterRestore`、`queueRetryVerified`、`queueDeduplicationVerified` 仅证明这个代表性任务，不代表所有业务队列或 exactly-once。`fullBusinessVerification=false`、`releaseReady=false` 必须保持。

capture 提交后 `backupRetained=true`：私有包、批准与 journal 在失败／未知结果后也保留，不自动递归删除。`cleanupVerified` 只表示自有 Docker 资源清理。缺包、错误 run、目标旧 AOF 分别核对实际子进程的有限拒绝码，通用启动失败不能冒充指定反例。256 MiB 内存限制、未加密私有包仍不构成生产加密／密钥管理方案；失败保持隔离，不推导生产恢复命令。

永久回归使用现有准入 runner，输入必须来自已独立确认的开发 daemon：

```bash
node --import tsx scripts/run-upgrade-component-tests.ts --expected-daemon-id "$verified_development_daemon_id" --suite recovery-three-store
node --import tsx scripts/run-upgrade-component-tests.ts --expected-daemon-id "$verified_development_daemon_id" --suite controlled-recovery
```

机器／用户／目录：已审隔离开发 checkout 及其开发用户；前置：上述本地镜像、已经核验的 daemon ID。此命令只写入自建测试存储，保留私有证据，不停止任何部署。预期整份测试无 opt-in 跳过，CI owned job 也强制执行；准入、镜像、测试或清理失败即停止。它不是生产维护命令。

第二条命令执行独立的四场景源／目标adapter矩阵：两种bootstrap身份、停源后消费包、
非空目标拒绝。`b8fbae437`实际4/4通过，262.44s，清理验证通过。每场景仍限180秒，
不能批准业务队列或公开流量。两条命令均要求owned receipt，ambient数据库配置
或opt-in环境开关不能代替准入。

若监督进程强制终止恢复子进程，额外测试存储的清理结果为 **unknown**，不能因
runner自身PG已清理就称整体已清理。`runnerResourcesCleanupVerified` 与
`cleanupVerified` 分开；恢复lane非零时整体清理不会标为通过。必须保留私有证据，
再按精确身份核对资源。强杀后自动核对并回收全部子资源尚未实现；不得广泛删除
容器／卷或清空证据来伪造成功。

真实数据副本：**blocked，尚无受控可恢复备份，生产加密、角色策略及完整业务恢复仍需集成**。本手册不授权生产导出。获批隔离环境需禁用外发邮件、webhook、真实设备及非必要模型调用；provider模拟状态与实际认证／数据库／业务调用证据分别标记。开发合成回归不替代此步骤。

包v2显式保存角色INHERIT及PG16成员关系每条边的INHERIT／SET选项，拒绝未知字段、
高权限属性、ADMIN、外部角色边和秘密字段。v1包不得隐式升级，需从获授权源重新导出。
`roleCapabilitiesVerified=true`仅覆盖声明的合成profile：继承读、显式SET ROLE、
写入／提权拒绝，不证明全部应用或数据库全局权限已恢复。
新增 v3 profile 要求源和目标事先具有同一明确配置的 bootstrap 身份，包括 OID 10
的 `wiseeff`；恢复过程不创建、重命名或替换超级用户。两个 profile 均要求实测的
PG16 Alpine 默认数据库编码、locale/provider 和设置；不支持的属性明确拒绝，
不能静默丢失。测试秘密与包分开。实际 adapter 回归覆盖两个 bootstrap profile，
旧合成 CLI 的历史结果不重新标为 v3 证据。

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

父与已分配的实现智能体负责剩余发布、运行、恢复和验收接线；P12/P13 unavailable、
终端组合根、完整消费方覆盖及浏览器／容量均是内部缺口。当前限定S6决定涉及P01的
管理成员分类及P02的真实受限登录探针，不授权runtime扩权。#815仍需权威Policy关联
或明确批准的unavailable契约。P12新增表原型继续排除，不是既有存储路径的前提。
Source-lock串行路由保持冻结测试不变；后续算法／身份修订需独立精确审查。
其他业务能力缺口须先给出真实调用者、操作与失败，再单独提出权限方案。
0140 Kernel reader 与独立恢复执行层已获明确授权，不再等待这两项
决定；报告批准也已通过正式公开服务接线。外部环境输入是授权的可恢复备份、企业 CA／网络构建访问；生产
操作及发布批准另列。这些条件不把所有剩余工作推给 OP-09，也不批准未完成的合成升级。
