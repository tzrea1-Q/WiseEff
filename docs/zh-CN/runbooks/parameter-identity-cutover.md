# 参数身份切换 Runbook

> English: [English](../../runbooks/parameter-identity-cutover.md)

在维护窗口内，将路径派生的参数身份原子切换为源码/生效 DTS 拓扑、版本化规格与稳定项目绑定。

**硬性规则：** 若 `--apply` 或 cutover SQL 失败，立即停止。恢复整库 + 对象存储快照。禁止部分继续、双写，或手工修补线上行。

演练证据路径：`work/cutover-rehearsal/<YYYYMMDD-HHMM>/`。

## 前置条件

- 已部署包含迁移 `0048`、`/api/v2` 语义 API 与本 runbook 的维护目标构建。
- 操作员持有与目标环境一致的 `PARAMETER_IDENTITY_MAINTENANCE_TOKEN`。
- 具备 [backup-restore.md](../../runbooks/backup-restore.md) 中的 PostgreSQL 与对象存储备份工具。
- `PATH` 上可用 `dtc`、`fdtoverlay`、`dt-validate`，且版本与 `tools/dts-toolchain/versions.json` 钉扎一致（dtc/fdtoverlay `1.8.1`，dtschema `2026.6`）。
- macOS 上 pip 安装的 `dt-validate` 常见于 `~/Library/Python/3.9/bin`，发布检查前请加入 `PATH`：
  `export PATH="$HOME/Library/Python/3.9/bin:$PATH"`。

## 1. 写冻结

快照前停止参数与配置写入：

```bash
export CUTOVER_WRITE_FREEZE_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

冻结持续到观察窗口结束或整快照恢复完成。期间不得接受新的草稿、导入、结构化编辑或基线发布。

## 2. 记录快照 ID

```bash
export DB_SNAPSHOT_ID="pg-snap-$(date -u +%Y%m%d%H%M%S)"
export OBJECT_SNAPSHOT_ID="obj-snap-$(date -u +%Y%m%d%H%M%S)"
echo "DB_SNAPSHOT_ID=${DB_SNAPSHOT_ID}"
echo "OBJECT_SNAPSHOT_ID=${OBJECT_SNAPSHOT_ID}"
```

完成真实 PostgreSQL + 对象存储快照后，将两个 ID 一并写入演练目录。后续整快照恢复必须成对使用。

## 3. 工具链健康

```bash
npm run dts:toolchain:check -- --required
npm run dtc:check -- --required
npm run dts:config:validate
```

期望：工具存在且版本与 `tools/dts-toolchain/versions.json` 一致。`--required` 在缺二进制、`--version` 无法解析或版本不匹配时失败。钉扎检查失败则中止——生产发布失败关闭。

## 4. Dry-run 迁移

```bash
npm run parameter-identities:migrate
```

Dry-run **只读**：不会 `CREATE`/`ALTER`/`INSERT`/`UPDATE`。基础设施表由正式迁移 `0049` 预建；dry-run 在事务中执行并始终回滚。

检查 JSON：`unmappedRecords`、`ambiguousRecords`、`brokenHistoryChains`、`blockers` 必须为 0 / 空。

## 5. 歧义与规格积压检查

```bash
psql "$DATABASE_URL" -c "select count(*) as open_mapping from identity_mapping_tasks where status = 'open';"
psql "$DATABASE_URL" -c "select count(*) as open_spec_reviews from parameter_spec_review_tasks where status = 'open';"
npm run parameter-identities:check
```

在 Admin UI（`/parameter-admin`）清零所有开放映射/规格审核后再继续。

## 6. 全量编译

```bash
npm run dtc:seed:compile
npm run dts:config:validate
```

生产在用配置集须以失败关闭模式通过工具链校验（Admin 或 `POST /api/v2/projects/:projectId/config-revisions/:revisionId/validate`）。

## 7. Apply 迁移

```bash
export PARAMETER_IDENTITY_MAINTENANCE_TOKEN='<same token as target env>'
npm run parameter-identities:migrate -- \
  --apply \
  --maintenance-token "$PARAMETER_IDENTITY_MAINTENANCE_TOKEN" \
  --write-lock-confirmed \
  --db-snapshot-id "$DB_SNAPSHOT_ID" \
  --object-snapshot-id "$OBJECT_SNAPSHOT_ID"
```

从报告 JSON 保存 `migrationRunId`。

**失败或 `blockers` 非空：** 执行第 12 节整快照恢复。禁止对脏库重试 apply。

## 8. 原子 Schema Cutover

```bash
npm run parameter-identities:cutover -- --migration-run-id '<migrationRunId>'
```

在单事务中执行 `server/cutovers/2026-07-16-parameter-identity-cutover.sql`（不被 `db:migrate` 发现）。

**失败：** 只能整快照恢复，禁止部分继续。

## 9. Postflight

```bash
npm run parameter-identities:check
psql "$DATABASE_URL" -c "select * from parameter_identity_cutovers;"
curl -sS "$WISEEFF_API_BASE_URL/metrics" | rg 'wiseeff_parameter_identity_|wiseeff_dts_toolchain_ready|wiseeff_identity_mapping'
```

期望：`ok: true`、cutover marker 存在、迁移完成 gauge 为 `1`、开放映射 gauge 为 `0`。

## 10. 应用切换

启用语义身份应用构建：提供 `/api/v2`，对遗留扁平参数 ID 返回 `410 legacy-parameter-id-retired`，UI 使用源树/生效树。

```bash
curl -sS -H "Authorization: $TOKEN" "$WISEEFF_API_BASE_URL/api/v2/parameter-specs?limit=1"
curl -sS -H "Authorization: $TOKEN" "$WISEEFF_API_BASE_URL/health/ready"
```

## 11. 观察窗口

至少观察一个发布周期（演练最少 30–60 分钟）：

- 告警：`WiseEffDtsToolchainUnavailable`、`WiseEffIdentityMappingBacklog`、`WiseEffConfigPublishValidationBypass`
- Grafana Overview 中的 DTS 工具链、映射积压、cutover 状态面板
- 功能：类型化绑定编辑、发布门禁、映射队列为空、无业务 `recommendedValue`

若 critical 告警触发或映射积压再现，再次冻结写入并执行第 12 节。

## 12. 整快照恢复（唯一回滚）

```bash
echo "Restoring DB_SNAPSHOT_ID=${DB_SNAPSHOT_ID}"
echo "Restoring OBJECT_SNAPSHOT_ID=${OBJECT_SNAPSHOT_ID}"
curl -sS "$WISEEFF_API_BASE_URL/health/ready"
npm run smoke:m5
```

禁止部分 schema 回退；整快照恢复是唯一支持的回滚路径。

## 相关文档

- [backup-restore.md](backup-restore.md)
- [rollback.md](rollback.md)
- [observability-operations.md](observability-operations.md)
- 计划：`docs/exec-plans/active/2026-07-16-parameter-topology-schema-management.md`
