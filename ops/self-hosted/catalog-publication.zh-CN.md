# Catalog 发布操作手册

> English: [English](catalog-publication.md)

除非另行说明，命令工作目录：

```bash
cd /srv/wiseeff/ops/self-hosted
```

使用 `./scripts/compose`，不要直接调 `docker compose`。配置来源：

| 文件 | 使用者 | 内容 |
| --- | --- | --- |
| `.env` | postgres、redis、minio、api、worker、web、proxy | 公共运行时。**不得**包含 `WISEEFF_PUBLICATION_MANAGER_DATABASE_URL`。 |
| `.env.publication-manager` | 仅 `publication-manager` | 管理进程 DSN 与租约参数。从 `.env.publication-manager.example` 复制。 |
| `CATALOG_BASELINE_READONLY_DATABASE_URL` | 仅预检 | 只读 LOGIN。采集器拒绝 `DATABASE_URL`。 |

`publication_enabled` 默认 `false`。隔离启用不是生产授权。

setup/upgrade 在缺少私有文件时写入**未配置 stub**，绝不复制 `DATABASE_URL`。stub 在任何 Compose 解析之前写入，这样首次引入 `publication-manager` 时仍能 `stop proxy`。缺少 `WISEEFF_PUBLICATION_MANAGER_DATABASE_URL` 时 manager 健康检查为 `503 { configured: false }`。若旧栈已经跑过 `publication-manager`，升级 freeze 在缺少专用 LOGIN 时失败闭合。首次引入（旧栈没有 manager 容器且没有 manager DSN）会跳过 freeze，不启动 `publication-manager`，也不要求 `configured: true`；在创建 `catalog_publication` 的迁移之后再 provision LOGIN。用 `npx tsx scripts/catalog-publication-ops.ts provision-logins --credential-dir <0700 目录>` 创建专用 LOGIN。stdout 只有角色和路径，DSN 写入 `0600` 文件。把 manager DSN 写入 `.env.publication-manager`，把 API DSN 写入公共 `.env` 的 `DATABASE_URL`，把 worker DSN 写入 `WISEEFF_WORKER_DATABASE_URL`。不要把“上线前再换账号”当成已交付。默认重复运行只核验已拥有的 LOGIN，不改密码；轮换凭据必须显式 `--rotate-passwords`。

## 1. 部署管理进程

与 api/worker/web 使用同一应用镜像。容器内命令：`npm run publication:manager`。

```bash
./scripts/compose --env-file .env ps -a
./scripts/compose --env-file .env logs --tail=200 publication-manager
# 升级后重建。compose 包装器从正在运行的 api 容器推断 WISEEFF_APP_TAG，不会回落到 wiseeff-app:local。
./scripts/compose --env-file .env up -d --no-deps --no-build publication-manager
```

API 设置 `WISEEFF_API_PROCESS=1`，日志 worker 设置 `LOG_WORKER_ENABLED=true`，两者都不加载 `.env.publication-manager`。管理入口要求 `WISEEFF_PUBLICATION_MANAGER=1`。

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

```bash
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
  --confirmation ephemeral-test-only [--low-risk-single-actor]
npx tsx scripts/catalog-publication-ops.ts policy disable --actor <user-id> \
  --confirmation ephemeral-test-only
```

仅当 `current_database()` 符合临时库名模式且确认口令匹配时才能走这条路径。`--low-risk-single-actor` 是独立选择，默认保持当前值，不与启用捆绑。

**非临时实例：** 必须先 check 再 execute，引脚来自刚读到的 status，不能套用过期确认。不要使用 ephemeral 确认口令。

```bash
npx tsx scripts/catalog-publication-ops.ts policy check enable --actor <user-id> \
  --expected-database-oid <oid> \
  --expected-id <crel_...> \
  --expected-digest sha256:... \
  --expected-policy-revision <n> \
  --expected-frozen true|false \
  --expected-adopted true \
  [--low-risk-single-actor|--no-low-risk-single-actor]
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
| 3. 接管 + ACL + 能力 | `adopt --execute`；`capabilities grant` | 是 | Receipt `adopted-preexisting`；capability status true | 不要把能力写进默认 `admin`；不用测试 capability |
| 4. 策略检查 / 启用 / 停用 | 用**最新** status 引脚 `policy check enable` 再 `policy enable`；可选 `--low-risk-single-actor` | 是 | `publication_enabled=true`；freeze 不变 | 陈旧引脚、未接管、在正式库名上使用 ephemeral 确认 |
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
