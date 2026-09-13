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

## 1. 部署管理进程

与 api/worker/web 使用同一应用镜像。容器内命令：`npm run publication:manager`。

```bash
./scripts/compose --env-file .env ps -a
./scripts/compose --env-file .env logs --tail=200 publication-manager
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

## 5. 策略状态 / 隔离启用 / 停用

```bash
npx tsx scripts/catalog-publication-ops.ts policy status
npx tsx scripts/catalog-publication-ops.ts policy enable --actor <user-id> \
  --confirmation ephemeral-test-only
```

仅当 `current_database()` 符合临时库名模式且确认口令匹配时才能启用。这不是生产启用。

## 6. 升级/恢复冻结

`./scripts/upgrade.sh apply` 先冻结发布，再停止 `publication-manager`，再停 proxy/队列/api/worker/web。失败或超时保持冻结。仅在候选 manager 存活后解冻。

普通重启不得用镜像内 vendor 包覆盖数据库 current。恢复走 `./scripts/upgrade.sh` recovery，不用接管，也不用 pointer-only rollback。

## 7. 隔离交付验收

```bash
cd /srv/wiseeff
WISEEFF_CATALOG_DELIVERY_ACCEPTANCE=1 npm run catalog:publication:delivery-accept
```

缺前提非零退出。等待超时仍为排队/执行中视为失败。不是 GitHub L1 的静默 skip，也不是生产启用。
