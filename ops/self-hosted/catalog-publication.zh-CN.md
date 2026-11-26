# Catalog 发布操作手册

> English: [English](catalog-publication.md)

除非另行说明，命令工作目录：

```bash
cd /srv/wiseeff/ops/self-hosted
```

### 升级后预热已有目录

完成迁移 0376，将 API、发布管理器和离线目录工具升级到同一版本，再创建 v9 候选。若需回退至旧程序，保留首次新格式发布前配套的数据库备份。在 `ops/self-hosted` 目录运行一次：

```bash
./scripts/compose --env-file .env exec -T publication-manager \
  node --import tsx scripts/catalog-publication-ops.ts prewarm-checkpoint
```

预热完整校验当前目录的历史，随后写入预览和激活所需的检查点。首次可能耗时数分钟。编译期间仍可发布，提交时短暂取得当前目录锁并重新核对版本、字节校验和、编译和物化指纹。预热保留现有目录、任务、回执、冻结和发布策略。

| 返回状态 | 操作 |
| --- | --- |
| `warmed` 或 `already-warm` | 可以正常导入、发布。 |
| `prewarm-in-progress` | 已有预热正在执行，稍后重新运行确认完成。 |
| `current-pins-changed` | 当前版本或校验信息发生变化，可重新运行。持续出现时应核对已安装目录的完整性。 |
| `no-current-release` | 安装首个目录后再执行。 |

热路径下，常规定义预览记录 `snapshot-read`，发布记录 `activation-checkpoint-read` 和 `compile-append`。管理器仍需读取新候选及完整前驱目标。复杂变更或缺少兼容检查点时，管理器执行完整编译。

使用 `./scripts/compose`，不要直接调 `docker compose`。配置来源：

| 文件 | 使用者 | 内容 |
| --- | --- | --- |
| `.env` | postgres、redis、minio、api、worker、web、proxy | 公共运行时。**不得**包含 `WISEEFF_PUBLICATION_MANAGER_DATABASE_URL`。 |
| `.env.publication-manager` | 仅 `publication-manager` | 管理进程 DSN 与租约参数。从 `.env.publication-manager.example` 复制。 |
| `CATALOG_BASELINE_READONLY_DATABASE_URL` | 仅预检 | 只读 LOGIN。采集器拒绝 `DATABASE_URL`。 |

`publication_enabled` 默认 `false`。隔离启用不是生产授权。

setup/upgrade 在缺少私有文件时写入**未配置 stub**，绝不复制 `DATABASE_URL`。stub 在任何 Compose 解析之前写入，这样首次引入 `publication-manager` 时仍能 `stop proxy`。缺少 `WISEEFF_PUBLICATION_MANAGER_DATABASE_URL` 时 manager 健康检查为 `503 { configured: false }`。若旧栈已经跑过 `publication-manager`，升级 freeze 在缺少专用 LOGIN 时失败闭合。首次引入（旧栈没有 manager 容器且没有 manager DSN）会跳过 freeze，不启动 `publication-manager`，也不要求 `configured: true`；在创建 `catalog_publication` 的迁移之后再 provision LOGIN。用 `npx tsx scripts/catalog-publication-ops.ts provision-logins --credential-dir <0700 目录>` 创建专用 LOGIN。stdout 只有角色和路径，DSN 写入 `0600` 文件。把 manager DSN 写入 `.env.publication-manager`，把 API DSN 写入公共 `.env` 的 `DATABASE_URL`，把 worker DSN 写入 `WISEEFF_WORKER_DATABASE_URL`。不要把“上线前再换账号”当成已交付。默认重复运行只核验已拥有的 LOGIN，不改密码；轮换凭据必须显式 `--rotate-passwords`。

## schema 升级后刷新既有 LOGIN 权限

迁移 `0257_definition_erasure_writer_runtime_grants.sql` 会自动为已属于 `parameter_governance_writer_role` 且原本可 `SET ROLE` 到该角色的既有 NOINHERIT LOGIN 补齐明确列出的定义删除与清理函数权限，覆盖旧读取函数和清理列表权限都缺失的 API 账号；单独的 `0253` 可能跳过这些账号。只有成员关系但 `SET FALSE` 的账号不满足条件。worker、manager 与无关 LOGIN 不增加能力。迁移不修改密码、角色继承、表 DML 或发布冻结。通用 readiness 不证明 `/api/v2/catalog/definition-erasures` 可读取，升级后应单独验证该接口。

setup preflight 与 doctor 解析 `DATABASE_URL`：bootstrap 用户 `wiseeff` 的密码必须与已展开的 `POSTGRES_PASSWORD` 完全一致；认可的 API 运行时 LOGIN `wiseeff_api` 使用自身非空凭据。两条路径均拒绝未展开的 `${...}` 插值、格式错误的 URL、未认可的用户名与错误的 bootstrap 密码，即使 `POSTGRES_PASSWORD` 出现在 URL 的其他位置也不能通过。比较前会解码 URL 编码的凭据，并拒绝查询参数中的 `user` 与 `password` 覆盖。API 应继续使用 `wiseeff_api`，不要为满足 doctor 而退回 bootstrap 超管。这些配置检查不证明实际认证或数据库权限；后者需通过运行时状态与当前 Catalog 门禁检查。

运行时 LOGIN 可能早于新应用表创建。迁移会创建表，但不会重新执行 LOGIN 配置入口对 public 表的授权。例如，API LOGIN 缺少 `public.project_parameter_value_drafts` 或 `public.project_parameter_value_change_requests` 的 SELECT 时，项目草稿接口会返回 500，即使项目没有草稿。通用 API readiness 不会执行这个接口。

用 API LOGIN 确认缺少权限后，复用现有配置入口恢复既定运行时权限。先确认三个正式 LOGIN 均已存在且属于本部署，再在 `ops/self-hosted` 执行；bootstrap DSN 只从容器环境读取：

```bash
./scripts/compose --env-file .env run --rm --no-deps \
  -e WISEEFF_API_PROCESS=0 api \
  npx tsx scripts/catalog-publication-ops.ts provision-logins \
  --mode official --credential-dir /tmp/wiseeff-runtime-login-refresh
```

不要添加 `--rotate-passwords`。既有受管 LOGIN 应返回 `passwordsDelivered: false`，且 `reused` 包含 `wiseeff_api`、`wiseeff_worker`、`wiseeff_publication_manager`。入口复用既定权限契约，包括 Catalog 核心表写入拒绝；不执行发布、接管、种子初始化或产品能力授予。所有权或 LOGIN 属性不符时拒绝。此命令也能创建缺失的 LOGIN，因此确认三个账号已存在是操作员必须检查的前提，并非命令强制的“仅刷新”模式；尚未确认时，先检查再执行。

随后复查 API LOGIN 权限并刷新项目参数页，所有项目的 `parameter-value-drafts` 请求均应成功。数据库授权不需要重启服务；目录内容和项目初始化仍单独处理。

## 1. 部署管理进程

与 api/worker/web 使用同一应用镜像。Compose 通过 `node --import tsx` 运行
`managerRunner.ts`，并显式设置服务堆内存上限；手动开发入口仍为 `npm run publication:manager`。

```bash
./scripts/compose --env-file .env ps -a
./scripts/compose --env-file .env logs --tail=200 publication-manager
# 升级后重建。compose 包装器从正在运行的 api 容器推断 WISEEFF_APP_TAG，不会回落到 wiseeff-app:local。
./scripts/compose --env-file .env up -d --no-deps --no-build publication-manager
```

API 设置 `WISEEFF_API_PROCESS=1`，日志 worker 设置 `LOG_WORKER_ENABLED=true`，两者都不加载 `.env.publication-manager`。管理入口要求 `WISEEFF_PUBLICATION_MANAGER=1`。

### 激活超时与重试

`WISEEFF_PUBLICATION_MANAGER_ACTIVATION_TIMEOUT_MS` 的默认值为 60 秒。到达此时间会记录 `activation-timeout`，并检查是否已有提交的激活回执。当前尝试可继续执行，宽限期等于配置的超时时间且最多 60 秒。有效租约至少覆盖超时、宽限期和 5 秒收尾余量。部署中已配置更长租约时，继续使用该值。

目录包解析和编译在获取目录指针锁前完成。激活事务重新核对回执、发布基线、授权、执行令牌和产物身份。超时后，如果旧尝试还没有结束，管理进程等它提交或回滚。达到执行截止时间且未生效的尝试记录 `activation-timeout` 失败原因，并按 `WISEEFF_PUBLICATION_MANAGER_RETRY_BUDGET`（默认 5）进入重试或终态。

处理长时间 `running` 时，按 Job ID 对照管理进程的 `claimed`、`activation-timeout`、`settled` 和 `activated` 事件。用该任务的激活回执确认是否已生效。管理员可以通过只读查询 `catalog_publication.publication_jobs.last_error_reason` 区分激活超时和其他执行故障。

### 预览和发布的内存预算

共享主体改名和正式别名编辑可以使用当前固定版本的已验证快照生成预览。旧版本首次预览需要校验历史，耗时可能较长。满足快照条件的名称编辑和 Markdown 参数定义导入均存储一份完整的目标版本及其前序引用。目标版本包含沿用的定义、本次导入的变更、源文件和清单索引。Markdown 导入预览仍会校验完整历史。激活和历史回放时，读取端根据前序引用还原发布包。

旧格式的完整包还包含历次发布的版本快照。升级后，预览和激活可以读取超过 Node 单个字符串长度上限的完整包。对于已经进入 `failed-terminal` 且没有激活回执的任务，升级 API 和发布管理器后，重新预览并发布新候选。

滚动升级时，先执行数据库迁移并升级发布管理器及其他产物读取端，再启动会写入新格式的 API 实例。生成紧凑格式候选后，激活和历史回放均需要兼容的读取端，应用回滚时也应保留该读取能力。

API 预览和管理进程激活都会编译 Catalog 数据。两个服务各自默认使用 2 GiB RAM
上限、3 GiB RAM 与交换空间合计上限、1536 MiB V8 老生代堆上限。差额用于年轻代、
原生内存、Buffer 和 TypeScript 加载器，并不保证任意规模的目录都能容纳。主机需要
为两个服务及其余组件保留余量。以下非敏感配置都写在 Compose 插值使用的主 `.env`
中，包括管理进程的配置：

| 服务 | RAM 上限 | RAM + 交换空间上限 | V8 老生代堆，MiB |
| --- | --- | --- | --- |
| API | `WISEEFF_API_MEMORY_LIMIT=2g` | `WISEEFF_API_MEMORY_SWAP_LIMIT=3g` | `WISEEFF_API_MAX_OLD_SPACE_SIZE_MB=1536` |
| 发布管理进程 | `WISEEFF_PUBLICATION_MANAGER_MEMORY_LIMIT=2g` | `WISEEFF_PUBLICATION_MANAGER_MEMORY_SWAP_LIMIT=3g` | `WISEEFF_PUBLICATION_MANAGER_MAX_OLD_SPACE_SIZE_MB=1536` |

既有 `.env` 未填写这些键时也会采用默认值。Compose 在 Node 命令行中传入堆上限，
保留其他 `NODE_OPTIONS`，并覆盖该变量中遗留的 `--max-old-space-size`。堆上限应低于
RAM 上限。日志出现 `FATAL ERROR: ... JavaScript heap out of memory` 就属于 V8
内存耗尽，即使 Docker 显示 `OOMKilled=false`。

对于内存充足的专用主机（例如总内存 125 GiB、可用约 120 GiB），可将主 `.env`
中的六项配置替换为：

```dotenv
WISEEFF_API_MEMORY_LIMIT=16g
WISEEFF_API_MEMORY_SWAP_LIMIT=16g
WISEEFF_API_MAX_OLD_SPACE_SIZE_MB=12288
WISEEFF_PUBLICATION_MANAGER_MEMORY_LIMIT=16g
WISEEFF_PUBLICATION_MANAGER_MEMORY_SWAP_LIMIT=16g
WISEEFF_PUBLICATION_MANAGER_MAX_OLD_SPACE_SIZE_MB=12288
```

两个服务的 RAM 上限合计 32 GiB，各自给 V8 老生代以外的分配留出 4 GiB。
RAM 和 RAM 加交换空间的上限相等，两个服务不使用交换空间。上限不会预先分配内存。
数据库沿用现有配置，根据数据库的观测结果单独调优。

在该配置下处理大目录发布时，可在 `.env.publication-manager` 中将激活超时阈值
放宽到 3 分钟，并重建发布管理进程：

```dotenv
WISEEFF_PUBLICATION_MANAGER_ACTIVATION_TIMEOUT_MS=180000
```

收尾宽限期和有效租约按上文规则计算。此设置用于确认发布后，管理进程激活排队任务的阶段。

应用代码修改按正常[升级流程](upgrade.zh-CN.md)部署。如果只是用当前运行镜像恢复
资源配置，先更新 Compose 配置，然后在允许 API 短暂中断时执行以下命令。示例适用于
API 和管理进程共用带标签镜像的标准部署；从当前 Compose 项目的 API 固定镜像，避免
误用其他部署实例的镜像：

```bash
free -h
wiseeff_api_cid="$(./scripts/compose --env-file .env ps -q api)"
wiseeff_app_image="$(docker inspect --format '{{.Config.Image}}' "$wiseeff_api_cid")"
# 确认输出为预期的 repository:tag 后继续。
printf '%s\n' "$wiseeff_app_image"
WISEEFF_APP_IMAGE="${wiseeff_app_image%:*}" \
WISEEFF_APP_TAG="${wiseeff_app_image##*:}" \
  ./scripts/compose --env-file .env up -d --no-deps --no-build \
    --force-recreate api publication-manager
```

必须重建容器：单独 `restart` 不应用 Compose 中的新限制和启动参数；单独
`docker update` 也不会将配置保留到下次重建。上述配置恢复命令保留当前应用镜像，
不会安装新源码中的代码修复。镜像若使用 digest 引用，请采用正常升级流程，不要按
上述方式拆分镜像标签。

核实重建后的实际容器限制和主进程参数：

```bash
./scripts/compose --env-file .env ps -a -q api publication-manager |
  xargs -r docker inspect --format \
  '{{.Name}} memory={{.HostConfig.Memory}} memorySwap={{.HostConfig.MemorySwap}} command={{json .Config.Cmd}} restarts={{.RestartCount}} oom={{.State.OOMKilled}}'
./scripts/compose --env-file .env exec -T api \
  curl -fsS http://127.0.0.1:8787/health/live
./scripts/compose --env-file .env exec -T publication-manager \
  curl -fsS http://127.0.0.1:8791/health/live
./scripts/compose --env-file .env logs --since 5m --tail 100 api publication-manager
```

默认配置下，两个服务都应显示 `memory=2147483648`、`memorySwap=3221225472` 和
`--max-old-space-size=1536`。单独执行未携带该命令行参数的 `exec ... node -e`，得到的
是新探针进程默认堆上限，而非运行中服务的堆上限。重试一次导入预览，确认成功且重启
计数没有增加。健康检查通过不能代替导入与发布验收。
使用 16 GiB 配置时，两个上限均应显示 `17179869184`，Node 参数应为
`--max-old-space-size=12288`。若仍报错，记录失败请求的路径、状态码、耗时和响应
请求 ID。预览请求 `POST /api/v2/catalog/publication-candidates` 由 API 处理。
如果预览通过、确认发布后任务失败，按任务 ID 查看发布管理进程日志。结合容器的重启
计数和 OOM 状态判断网关错误是否由内存不足引起。

## 2. 预检已有目录

```bash
cd /srv/wiseeff
CATALOG_BASELINE_READONLY_DATABASE_URL='postgres://readonly@postgres:5432/wiseeff' \
  npx tsx scripts/catalog-publication-ops.ts inspect
```

退出码 `0` 打印 JSON+sha256；`2` 用法错误；`1` 读取/权限失败。不插入 Artifact。

## 3. 接管（先检查再执行）

不推进 `catalog_state.current`。错包、缺历史、drift、未知数据模式拒绝。

```bash
WISEEFF_PUBLICATION_MANAGER_DATABASE_URL='...' \
  npx tsx scripts/catalog-publication-ops.ts adopt --check \
    --expected-id crel_... \
    --expected-digest sha256:... \
    --bundle /path/to/current-bundle.json \
    --actor <user-id> \
    --verification-digest sha256:... \
    --data-mode fresh
```

`--execute` 使用同一组参数。隔离实验室用 `--evidence-kind synthetic-fixture`。关闭发布不会删除目录，也不会在已有 Receipt 后恢复 legacy `advance`。

## 4. 真实授予/撤销发布能力

不要使用 `WISEEFF_CATALOG_TEST_CAPABILITIES`（`AUTH_MODE=production` 或 `NODE_ENV=production` 时为空）。

grant/revoke 写 `public.roles` / `user_role_bindings`，用 `WISEEFF_CATALOG_BOOTSTRAP_DATABASE_URL`（bootstrap 超管），不要用 NOINHERIT 的 manager LOGIN。

```bash
npx tsx scripts/catalog-publication-ops.ts capabilities grant \
  --user-id <user-id> --organization-id <org-id> --capability catalog:author
npx tsx scripts/catalog-publication-ops.ts capabilities grant \
  --user-id <user-id> --organization-id <org-id> --capability catalog:publish
```

绑定独立 `catalog-capability-*` 角色，不把 `catalog:publish` 写进默认 `admin`。

## 5. 策略状态 / 隔离启用 / 正式实例启用 / 停用

在**应用镜像内**执行（`./scripts/compose --env-file .env run --no-deps --rm api npx tsx scripts/catalog-publication-ops.ts …`），不要假设宿主机有 `npx`/`tsx`。DSN 来自镜像环境变量，不要写在命令行。

```bash
npx tsx scripts/catalog-publication-ops.ts policy status
```

状态读取 `DATABASE_URL`（API LOGIN 对 `catalog_state` 的 `SELECT`）。不要用 NOINHERIT 的 manager LOGIN 做 status，那个身份对 `catalog_state` 会 42501。freeze 的 `set`/`clear`/`status` 仍走 manager DSN，并 `SET LOCAL ROLE catalog_publication_coordinator_role`。

状态输出非敏感身份：数据库 OID、库名、当前 Release ID/digest、Artifact digest、接管、策略版本、`publication_enabled`、`low_risk_single_actor_publish`、freeze。状态读取不是启用。

**仅隔离临时库：**

```bash
npx tsx scripts/catalog-publication-ops.ts policy enable --actor <user-id> \
  --confirmation ephemeral-test-only
npx tsx scripts/catalog-publication-ops.ts policy disable --actor <user-id> \
  --confirmation ephemeral-test-only
```

仅当 `current_database()` 符合临时库名模式且确认口令匹配时才能走这条路径。旧版 `low_risk_single_actor_publish` 字段及其命令行选项为兼容保留。发布批准取决于候选风险和操作人权限。

**非临时实例：** 必须先 check 再 execute，引脚来自刚读到的 status，不能套用过期确认。不要使用 ephemeral 确认口令。

```bash
npx tsx scripts/catalog-publication-ops.ts policy check enable --actor <user-id> \
  --expected-database-oid <oid> \
  --expected-id <crel_...> \
  --expected-digest sha256:... \
  --expected-policy-revision <n> \
  --expected-frozen true|false \
  --expected-adopted true
npx tsx scripts/catalog-publication-ops.ts policy enable --actor <user-id> \
  --expected-database-oid <oid> \
  --expected-id <crel_...> \
  --expected-digest sha256:... \
  --expected-policy-revision <n> \
  --expected-frozen true|false \
  --expected-adopted true
```

启用要求当前目录已精确接管（Artifact + Receipt）。不推进 current，不清除 freeze，也不要求先成功发布一条定义。停用不删除 Catalog、Artifact、Receipt 或项目值。Receipt 存在后关闭发布不会恢复非法 legacy `advance`。

## 6. 升级/恢复冻结

`./scripts/upgrade.sh apply` 用私有 manager DSN，通过候选镜像的 `compose run --no-deps api` 冻结（`npx tsx scripts/catalog-publication-ops.ts freeze`）。这样使用镜像内 `node_modules` 和 Compose DNS 解析 `postgres`，不 `compose exec` 进 manager 容器，也不要求宿主机有 `npx`/`pg`。无 manager 的 PR #827 旧栈、或 manager 已停止/崩溃，只要有专用 LOGIN 仍可冻结。旧栈已经跑过 `publication-manager` 时，缺少专用 LOGIN 失败闭合。首次引入且没有该 LOGIN 时跳过 freeze，以免卡住创建 `catalog_publication` 的升级。冻结后只在容器确实存在时停止 `publication-manager`。回滚时若恢复后的 Compose 没有该服务，不得 `up publication-manager`，也不得拿 API 的 previous 镜像标签顶替。失败或超时保持冻结并隔离 `publication-manager`。解冻是升级**成功提交点**：只在公共探测和最终校验之后、且本次升级拥有该冻结时执行（不清除操作员原有冻结）。

普通重启不得用镜像内 vendor 包覆盖数据库 current。恢复走 `./scripts/upgrade.sh` recovery，不用接管，也不用 pointer-only rollback。

## 7. 隔离交付验收

```bash
cd /srv/wiseeff
WISEEFF_CATALOG_DELIVERY_ACCEPTANCE=1 \
  WISEEFF_CATALOG_BOOTSTRAP_DATABASE_URL='postgres://wiseeff:...@127.0.0.1:55438/postgres' \
  npm run catalog:publication:delivery-accept
```

该 runner 构建正式 `ops/self-hosted/Dockerfile` 镜像，在临时 pgvector 库上发放**按 run 作用域命名**的 API/worker/manager LOGIN（不改集群级 `wiseeff_api` / `wiseeff_worker` / `wiseeff_publication_manager`），按标准 Compose 加隔离 overlay 启动，然后执行接管 → 真实本地登录 → 页内发布 → Receipt/current → DTS ingest → 工作台存值 → 第二次发布 → 服务重启 → 历史回读。断言绑定本轮 Candidate/Job/Receipt/Release/Definition/Binding/ProjectValue。排队/执行中超时视为失败。缺前提非零退出。不是生产启用，也不是 GitHub L1 的静默 skip。拒绝 `127.0.0.1:5432/wiseeff` 以及共享 g668 库名 `wiseeff`。

overlay **只覆盖网络/端口/拓扑**（loopback 端口、`host.docker.internal`、关闭共享 postgres）。标准 `api` 命令是 `npx tsx server/index.ts`；正式迁移是 setup/upgrade 用 `WISEEFF_CATALOG_BOOTSTRAP_DATABASE_URL` 的一次性入口。标准 `worker` 的 `DATABASE_URL` 来自 `WISEEFF_WORKER_DATABASE_URL`。overlay 不得替换这些进程或权限缝。

## 8. 目标主机操作员执行单（仅在已授权时写入）

工作目录除非另有说明：`/srv/wiseeff/ops/self-hosted`。命令在应用镜像内执行。凭据不得进入命令行、日志或工单。

| 步骤 | 命令 / 页面 | 是否写入 | 成功信号 | 失败停止点 |
| --- | --- | --- | --- | --- |
| 1. 升级后状态读取 | `./scripts/collect-catalog-publication-status.sh`（或 `compose ps`、镜像内 `curl` manager `/health/live`、`policy status`、`freeze status`） | 否 | 运行镜像/标签、角色、current Release、策略版本、freeze；JSON `pinsForPolicyCheck` | 已经跑过 `publication-manager` 的栈缺少专用 LOGIN |
| 2. 源包与接管检查 | 只读 `inspect`；`adopt --check` | 否 | JSON 身份与源包一致 | 漂移、缺历史或缺 Artifact |
| 3. 接管 + ACL + 能力 | `adopt --execute`；组织 Admin 默认已有 `catalog:author` / `catalog:publish` / `catalog:review-high-risk`。只给非 admin 发布人 grant | 是 | Receipt `adopted-preexisting`；组织 Admin 重新登录后可编写并自批 | 不用测试 capability；不要授给 platform-admin |
| 4. 策略检查 / 启用 / 停用 | 用**最新** status 引脚 `policy check enable` 再 `policy enable` | 是 | `publication_enabled=true`；freeze 不变 | 陈旧引脚、未接管、在正式库名上使用 ephemeral 确认 |
| 5. 页面业务闭环 | `/parameter-admin/specs` 编写/预览/发布；工作台 `提交所选` | 是 | Receipt `effective`；正式值内容；重启后历史仍在 | 排队/执行中超时即失败；禁止手工 POST 保存 API |
| 6. 异常停用 | `policy disable`；维护时 `freeze set`；恢复走升级 recovery | 是 | 发布关闭；Catalog 与项目值保留 | 不要删历史或再次 bootstrap |

现场启用在上述写入被观测到之前保持 **待授权 / 未执行**。

## 9. 采集当前主机事实（只读）

任何 adopt/enable/grant 之前先跑。使用 `./scripts/compose run --rm --no-deps`（与升级 freeze 同一身份），不要 `compose exec` 进正在服务的 API 跑 Catalog 操作。stdout 与 JSON 报告会脱敏 DSN。

```bash
cd /srv/wiseeff/ops/self-hosted
chmod +x ./scripts/collect-catalog-publication-status.sh
./scripts/collect-catalog-publication-status.sh \
  --out ./catalog-publication-status.json
# 可选：
#   --readonly-dsn-file /path/to/readonly.dsn
#   --bundle /path/to/catalog-release-bundle.json --verification-digest sha256:...
#   --user-id usr_... --organization-id org_...
```

报告含健康检查、LOGIN inspect、`policy status` / `freeze status`，以及 `pinsForPolicyCheck`。交回 `catalog-publication-status.json`（权限 0600）。不要粘贴 `.env` 或 DSN 文件。若 `ops_cli_present` 失败，说明当前镜像还没有 `scripts/catalog-publication-ops.ts`，必须先升级再 inspect/adopt/policy。
