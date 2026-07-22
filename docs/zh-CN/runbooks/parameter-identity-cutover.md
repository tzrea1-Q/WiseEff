# 参数身份切换 Runbook

> English: [English](../../runbooks/parameter-identity-cutover.md)

在维护窗口内，将路径派生的参数身份原子切换为源码/生效 DTS 拓扑、版本化规格与稳定项目绑定。

**硬性规则：** 若 `--apply` 或 cutover SQL 失败，立即停止。恢复整库 + 对象存储快照。禁止部分继续、双写，或手工修补线上行。

演练证据路径：`work/cutover-rehearsal/<YYYYMMDD-HHMM>/`。

## 前置条件

- 已部署包含迁移 `0048`、`/api/v2` 语义 API 与本 runbook 的维护目标构建。
- 操作员持有与目标环境一致的 `PARAMETER_IDENTITY_MAINTENANCE_TOKEN`。
- 具备 [backup-restore.md](../../runbooks/backup-restore.md) 中的 PostgreSQL 与对象存储备份工具。
- 在部署 checkout 执行 `npm run dts:toolchain:bootstrap`，准备忽略提交的项目 venv `.wiseeff-tools/dts-toolchain`。API 与 release check 共用同一解析器和 `tools/dts-toolchain/versions.json` 钉扎版本（dtc/fdtoverlay `1.8.1`，dtschema `2026.6`）；不得依赖操作员个人 Python PATH。

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
npm run dts:toolchain:bootstrap
npm run dts:toolchain:check -- --required
npm run dtc:check -- --required
npm run dts:config:validate
```

期望：工具存在且版本与 `tools/dts-toolchain/versions.json` 一致。`--required` 在缺二进制、`--version` 无法解析或版本不匹配时失败。钉扎检查失败则中止——生产发布失败关闭。

## 4. Dry-run 迁移

先应用全部前向 SQL migration。接受 cutover 后 typed draft 前，`schema_migrations` 必须包含 `0059` 至 `0063`。0060/0061 跨全部 origin 记录并删除 candidate-less draft；0062 持久化 `set|delete`；0063 在 submission item 与 change request 上持久化 exact candidate revision。禁止为已有工作流行猜测 candidate：0063 后仍为空的历史行必须拒绝并通过 typed edit 重建。

写冻结期间记录 candidate-less draft 数与 candidate 为空的活动 semantic request。0061 后活动 candidate-less draft 必须为 0；0063 后所有新提交 item/request 必须共享一个非空 candidate ID。精确提交锁定 draft+candidate/evidence，证明 set/delete 后原子推进 `draft -> pending_approval`；merge 再锁定并复核 exact candidate。对 0063 前 candidate 为空的活动 semantic request 必须 reject 后重建，禁止 merge 或猜测回填。

```bash
psql "$DATABASE_URL" -c "select name from schema_migrations where name between '0059_binding_draft_submission_identity.sql' and '0063_parameter_submission_candidate_identity.sql' order by name;"
psql "$DATABASE_URL" -c "select table_name, column_name from information_schema.columns where table_schema = 'public' and table_name in ('parameter_drafts', 'parameter_submission_items', 'parameter_change_requests') and column_name in ('candidate_config_revision_id', 'action') order by table_name, column_name;"
psql "$DATABASE_URL" -c "select count(*) as active_drafts_without_candidate from parameter_drafts where candidate_config_revision_id is null;"
psql "$DATABASE_URL" -c "select count(*) as blocked_open_requests_without_candidate from parameter_change_requests where status not in ('merged','rejected','withdrawn') and project_parameter_binding_id is not null and candidate_config_revision_id is null;"
psql "$DATABASE_URL" -c "select organization_id, project_id, draft_origin, count(*) as invalidated_drafts from parameter_draft_identity_invalidations group by organization_id, project_id, draft_origin order by organization_id, project_id, draft_origin;"
```

```bash
npm run parameter-identities:migrate
```

Dry-run **只读**：不会 `CREATE`/`ALTER`/`INSERT`/`UPDATE`。基础设施表由正式迁移 `0049` 预建；dry-run 在事务中执行并始终回滚。

Apply 前检查 JSON 计数：

- `exactMatched` / `reviewedMatched` — 仅可发布的已映射定义
- `inferredPendingReview` — 必须为 **0**（推断草稿不计为已映射；未审核 inferred 阻断 cutover）
- `ambiguousRecords` / `unmappedRecords` / `brokenHistoryChains` / `blockers` — 必须为 0 / 空

Dry-run 不得把 inferred 行伪装成已映射。

**TD-042：** 在合法干净非客户快照整库演练（apply → check → cutover → 整库恢复 → 旧 API smoke）完成前，生产 cutover 视为 **BLOCKED**。临时库 / 脏共享库证据不足。

## 5. 歧义与规格积压检查

```bash
psql "$DATABASE_URL" -c "select count(*) as open_mapping from identity_mapping_tasks where status = 'open';"
psql "$DATABASE_URL" -c "select count(*) as open_spec_reviews from parameter_spec_review_tasks where status = 'open';"
npm run parameter-identities:check
```

在 **finalize** 前于 Admin UI（`/parameter-admin`）清零所有开放映射/规格审核。`stage-review` 可有意保留 open inferred 任务；finalize 与 cutover 前必须清零。

## 6. 全量编译

```bash
npm run dtc:seed:compile
npm run dts:config:validate
```

生产在用配置集须以失败关闭模式通过工具链校验（Admin 或 `POST /api/v2/projects/:projectId/config-revisions/:revisionId/validate`）。黄金项目主 DTS（`aurora-board.dts` 等）须在 `failOnSchema: true` 下编译并通过真实 `dt-validate`；测试锁定每 revision **176** 个语义 property occurrence、M1 seed **684** 行结构 `dts_properties`（228 解析属性 × 3 项目）。

## 7. Stage review（推断规格与证据）

含 inferred 参数规格的生产 cutover 使用 durable 两阶段迁移。`stage-review` 在**独立** PostgreSQL 事务中提交推断草稿、审核任务、定义级证据与 `staged` 迁移运行；**不**写入 activity/workflow 语义外键（绑定、history FK、草稿、变更请求等）。

```bash
export PARAMETER_IDENTITY_MAINTENANCE_TOKEN='<same token as target env>'
npm run parameter-identities:migrate -- \
  --stage-review \
  --maintenance-token "$PARAMETER_IDENTITY_MAINTENANCE_TOKEN" \
  --write-lock-confirmed \
  --db-snapshot-id "$DB_SNAPSHOT_ID" \
  --object-snapshot-id "$OBJECT_SNAPSHOT_ID"
```

从报告 JSON 保存 `migrationRunId`。即使 `blockers` 含 inferred pending review，运行状态仍为 `staged`——finalize 前须在 Admin 完成审核。每次 `stage-review` 还会在 `parameter_identity_migration_phases` 追加不可变行（phase=`stage-review`）；finalize 追加独立 phase 行后，才将逻辑运行翻转为 `finalized`，且不会覆盖 staged 报告。staging 期间创建的 inferred 规格审核与身份映射任务携带 `migration_run_id`，以便 finalize 仅要求**该运行**积压清零。

**失败：** 第 14 节整快照恢复。禁止对脏库重试。

## 8. 清零 inferred / 映射积压

在 `/parameter-admin` 解析与 staged 运行相关的全部 open inferred 规格审核与 identity mapping 任务（`migration_run_id = '<migrationRunId>'`），然后：

```bash
psql "$DATABASE_URL" -c "select count(*) as open_inferred from parameter_spec_review_tasks where status = 'open' and migration_run_id = '<migrationRunId>';"
psql "$DATABASE_URL" -c "select count(*) as open_mapping_for_run from identity_mapping_tasks where status = 'open' and migration_run_id = '<migrationRunId>';"
npm run parameter-identities:check
```

对未匹配 inferred 属性，resolve 时使用 `createSpec: true` 创建本组织 **draft** 规格，再经 Admin **激活**（`POST /api/v2/parameter-specs/:specId/activate`）后方可 resolve 审核任务。仅 active 且约束完整的规格可 resolve。

## 9. Finalize 迁移（activity FK + 绑定）

`finalize` 引用 staged `migrationRunId`，要求**该运行**关联的全部审核/映射任务已 resolved，并在**单事务**中原子写入绑定、绑定 revision、值证据与 activity/workflow 语义 FK。失败仅回滚 finalize；staged 产物与 `stage-review` phase 行保留。成功时会追加新的 `parameter_identity_migration_phases` 行（phase=`finalize`），逻辑运行状态变为 `finalized`。

```bash
npm run parameter-identities:migrate -- \
  --finalize \
  --migration-run-id '<migrationRunId>' \
  --maintenance-token "$PARAMETER_IDENTITY_MAINTENANCE_TOKEN" \
  --write-lock-confirmed
```

运行状态变为 `finalized`。Cutover **仅**接受带有成功 `finalize` phase 行的 `finalized` 运行；仅 staged、伪造状态或缺少 finalize phase 的运行会被拒绝。

**失败：** staged 数据仍在；修复 blocker 后重试 finalize，或整快照恢复（第 14 节）。

### 一次性 apply（演练 / 临时库）

无 inferred blocker 的干净快照可用 `--apply` 单事务捷径（staging + activity 一并写入，状态 `finalized`）。存在 open inferred 审核任务时必须使用 stage → finalize。

```bash
npm run parameter-identities:migrate -- \
  --apply \
  --maintenance-token "$PARAMETER_IDENTITY_MAINTENANCE_TOKEN" \
  --write-lock-confirmed \
  --db-snapshot-id "$DB_SNAPSHOT_ID" \
  --object-snapshot-id "$OBJECT_SNAPSHOT_ID"
```

**失败或 `blockers` 非空：** 第 14 节整快照恢复。direct apply 回滚不得删除已提交 `stage-review` 的产物。

## 10. 原子 Schema Cutover

```bash
npm run parameter-identities:cutover -- --migration-run-id '<migrationRunId>'
```

在单事务中执行 `server/cutovers/2026-07-16-parameter-identity-cutover.sql`（不被 `db:migrate` 发现）。

**失败：** 只能整快照恢复，禁止部分继续。

## 11. Postflight

```bash
npm run parameter-identities:check
psql "$DATABASE_URL" -c "select * from parameter_identity_cutovers;"
curl -sS "$WISEEFF_API_BASE_URL/metrics" | rg 'wiseeff_parameter_identity_|wiseeff_dts_toolchain_ready|wiseeff_identity_mapping'
```

期望：`ok: true`、cutover marker 存在、迁移完成 gauge 为 `1`、开放映射 gauge 为 `0`。

### 专用拓扑验收数据库

完整 submit→review→merge→writeback 验收是 **cutover 后**测试。`parameter-topology.acceptance.spec.ts` 会在 `DATABASE_URL` 指向的 PostgreSQL 服务上自行创建 `wiseeff_acceptance_disposable_*` 数据库，执行全部 migration 与 identity apply/cutover，写入 test-only marker，并启动隔离 API/前端端口。销毁前会再次校验生成库名、marker purpose 与准确 cutover migration run。

```bash
psql "$DATABASE_URL" -c "select id, migration_run_id, applied_at from parameter_identity_cutovers;"
```

验收套件在创建 typed-edit 业务写入前检查该 marker。不得把 cleanup 指向共享库，不得仅为满足测试而对共享开发库就地 cutover，也不得把 draft preview revision 当作语义 merge candidate。该可丢弃流程不能替代 TD-042 所要求的干净非客户快照 apply→cutover→整库恢复演练。

## 12. 应用切换

启用语义身份应用构建：提供 `/api/v2`，对遗留扁平参数 ID 返回 `410 legacy-parameter-id-retired`，UI 使用源树/生效树。

```bash
curl -sS -H "Authorization: $TOKEN" "$WISEEFF_API_BASE_URL/api/v2/parameter-specs?limit=1"
curl -sS -H "Authorization: $TOKEN" "$WISEEFF_API_BASE_URL/health/ready"
```

## 13. 观察窗口

至少观察一个发布周期（演练最少 30–60 分钟）：

- 告警：`WiseEffDtsToolchainUnavailable`、`WiseEffIdentityMappingBacklog`、`WiseEffConfigPublishValidationBypass`
- Grafana Overview 中的 DTS 工具链、映射积压、cutover 状态面板
- 功能：类型化绑定编辑、发布门禁、映射队列为空、无业务 `recommendedValue`

若 critical 告警触发或映射积压再现，再次冻结写入并执行第 14 节。

## 14. 整快照恢复（唯一回滚）

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
- 工作流 review：`docs/exec-plans/active/2026-07-16-parameter-topology-cutover-workflow-review.md`
- 第四轮阻断：`docs/exec-plans/active/2026-07-16-parameter-topology-round4-review-blockers.md`
- 源码卫生：Vitest `legacyDependencyGuard.test.ts`（仅 migrations/cutovers/adapters 等允许名单；不是运行时中间件）
