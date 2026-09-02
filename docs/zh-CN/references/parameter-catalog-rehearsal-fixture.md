# 参数目录 populated 与零库存迁移演练夹具

> English: [English](../../references/parameter-catalog-rehearsal-fixture.md)

这是一个 checksum-locked Wayfinder 资产，用于为未来的参数目录替换迁移生成可执行的 PostgreSQL 演练输入。显式 `populated` 模式把只读结构/聚合画像与确定性、非敏感的行级关系图组合在一起；显式 `zero` 模式保留 schema/profile 与迁移 ledger，不注入 synthetic graph，并实际执行参数目录零库存断言。它只属于规划与迁移设计证据，不是生产备份、生产迁移或发布就绪声明。

流程不会复制源数据库的任何数据行。populated 关系图由仓库内固定 SQL 生成；所有 ID 都以 `wf671-` 开头，所有值都明确标记为 synthetic placeholder。

历史 source commit 为 `6c3adfc35c0e3be6d5d381013dace9408190380e`，历史 bundle SHA-256 为 `017b3e614f1f4eba5a70f0c6b0cd3316b7e5ebd1aa9ccec4cf8e514c56dba7ff`。两者只是不变 provenance，不构成 executable trust，也绝不从 repaired bytes 重算。external source-lock test 在不包含自身的前提下固定 repair commit `R`、原 18 个 path、regular-file mode、每个 repaired blob hash 与新的 length-framed bundle checksum `B`。

## 产物契约

导出器在同一个 repeatable-read、只读事务中获取全部源端计数和分类报告，随后执行 `pg_dump --schema-only`。若迁移清单在采集期间变化、schema dump 含数据语句，或聚合输出命中秘密形态，导出会失败。

产物必须且只能包含以下受 checksum 保护的文件：

- `schema.sql`：仅包含源 schema，不含 owner、权限、注释或数据语句；
- `profile-schema.sql`：`wayfinder_rehearsal` 下的源画像表与夹具案例索引；
- `synthetic-fixture.sql`：确定性的 populated 行，仅在 `populated` 模式执行；
- `synthetic-fixture-verify.sql`：fail-closed、mode-aware 关系断言；
- `relations.csv`、`columns.csv`、`constraints.csv`、`indexes.csv`、`triggers.csv`；
- `migration-inventory.csv`、`row-counts.csv`、`row-classes.csv`、`invariant-counts.csv`；
- `manifest.csv`，其中必须有 `format_version=2`、显式 `fixture_mode`、`source_data_rows_exported=0`，以及与 mode 一致的 `import_populates_synthetic_rows`；
- `SHA256SUMS`，对其他每个必需文件恰好提供一条安全条目。

导入器把上述清单当作封闭集合。缺少文件、未知 entry、symlink、directory、device、socket、FIFO、其他 non-regular entry、缺少或重复 checksum 条目、不安全文件名、路径穿越、checksum 不一致，或 manifest 的 format、mode、artifact kind 与 import policy 不一致，都会在数据库访问之前被拒绝。manifest 还保留历史 source/checksum，并固定 exact `synthetic-fixture-verify.sql` checksum。

导出器对登记的仓库 SQL 输入与生成产物集合执行同样的 closed-world regular-file 检查，并在发布 archive 前 secret-scan 每个登记 source 以及生成的 schema、profile、manifest、output、log。导入阶段再次扫描全部登记产物。发布使用私有 staging、ownership marker 与 same-inode link；失败时只清理由 identity 仍能证明归本次运行所有的 path，竞争者创建的 foreign path 不会被删除，而是使 cleanup fail closed。

源端画像只记录关系结构、不可变迁移名称和 checksum、精确关系计数、封闭枚举/存在性/对齐分类、不变量计数，以及逻辑/schema/文件/归档 SHA-256。只有规范化 dump checksum 会排除 PostgreSQL 每次生成的 `\restrict` nonce；文件 checksum 仍保护原始 dump 的每个字节。

导入时，schema、profile CSV、安全迁移名称/checksum、可选 populated graph 与 mode-aware verification 在一个事务中执行。迁移 ledger 使用固定 synthetic timestamp；这样既不导出原始部署时间，又能让恢复后的 0128 schema 被后续 append-only migration tooling 正确识别。任何 late failure 都把 target 整体回滚到 checked-empty，复核清理结果并移除 importer-owned 临时输出；只有随后才输出 `CLEANUP_OK`，cleanup 失败即命令失败。

## 确定性的 populated 关系图

`wayfinder_rehearsal.fixture_cases` 是夹具的稳定公开索引。迁移演练应按 `case_name` 查询，不应依赖插入顺序或内部 ID。

| Case | populated 关系 |
| --- | --- |
| `formal-platform-driver-definition` | active Platform Driver 定义、版本、subject、DriverRegistration 和 DriverSchema property |
| `formal-platform-node-type-definition` | active Platform NodeType 定义、版本、subject、NodeTypeDefinition 和 DriverSchema property |
| `platform-subjectless-dts-draft` | 没有 formal subject、也没有 DriverSchema 链接的 Platform DTS draft |
| `organization-manual-node-type-draft` | 归属于 Organization NodeType 的组织级 manual draft |
| `driver-schema-root` | 分离的 Driver/NodeType root spec、version、schema 和 schema version |
| `organization-registration-placement` | 组织 module、mapping、registration category 与权威 Driver placement |
| `binding-module-identity-mismatch` | active Platform NodeType 定义通过 attribution 不同的 module 绑定 |
| `inactive-definition-binding` | binding 与 pinned revision 引用了 draft 定义 |
| `pinned-binding-revision` | 三个 binding、对应 spec-version-pinned revision，以及一个 synthetic DTS config revision |
| `legacy-twin-r6-r8` | 一条 R6 subjectless/unlinked Platform DTS staging 行与一条 R8 Organization manual NodeType proposal 共用 `synthetic.legacy-twin`，同时保留不同身份和关系图 |

legacy twin 会把同 key 风险与 formal catalog 示例隔离开。R6 保留 `semantic_module=synthetic.unlinked`，没有 organization、subject、schema link 或 binding；R8 保留 `semantic_module=synthetic.node`、Organization NodeType subject，以及 module/binding/revision 关系图。任何 formal Platform definition 都不使用 `synthetic.legacy-twin`。

关系图不会创建 user 或 credential 行，也不含真实组织、项目、subject、source key、compatible、property key、schema namespace、DTS 源文、业务说明、参数实际值、默认值、示例值、evidence payload 或工作流原因。

## 只读导出

请在该分支的独立 checkout 中运行。输出目录、归档和归档 checksum 文件都必须尚不存在。

```bash
scripts/wayfinder/export-parameter-catalog-rehearsal.sh \
  --fixture-mode populated \
  --compose-file ops/self-hosted/compose.yaml \
  --env-file /absolute/path/to/ops/self-hosted/.env \
  --output-dir /absolute/path/to/wiseeff-wayfinder-671-export-YYYYMMDDTHHMMSSZ
```

只有当 source 中画像覆盖的参数目录关系均为空时，才可使用 `--fixture-mode zero`。历史迁移创建的 baseline platform organization 可以存在；导入器仍要求所有 catalog relation 与 `fixture_cases` 保持为空。

导出器记录数据库实际应用的完整迁移清单，不要求它已应用仓库最新迁移。只有在必需目录关系全部存在，且 PostgreSQL 证明诊断事务为只读时才会继续。

## 导入隔离 PostgreSQL

先创建使用专用名称前缀的新数据库。导入器不会创建、删除、清空或合并数据库；恢复前会检查 relation、schema、function、type、operator、全文检索对象、非默认 extension/language、large object、event trigger、publication 和 foreign server。

```bash
docker exec -i <local-postgres-container> \
  createdb -U wiseeff wiseeff_wayfinder671_restore_<suffix>

scripts/wayfinder/import-parameter-catalog-rehearsal.sh \
  --container <local-postgres-container> \
  --database wiseeff_wayfinder671_restore_<suffix> \
  --artifact-dir /absolute/path/to/unpacked-export
```

预期终端标记包括：

```text
IMPORT_OK
target_database=wiseeff_wayfinder671_restore_<suffix>
loaded_fixture_cases=10
fixture_mode=populated
loaded_migration_ledger_rows=126
data_rows_exported=0
source_data_rows_exported=0
```

可在不读取 synthetic value 的前提下检查 populated 契约：

```bash
docker exec -i <local-postgres-container> \
  psql -X -U wiseeff -d wiseeff_wayfinder671_restore_<suffix> \
  -c 'select case_name, relation_family, expected_rows from wayfinder_rehearsal.fixture_cases order by case_name'
```

## Candidate migration、验证与回滚

准备两个绝对路径、regular 且非 symlink 的文件：

- 未来的 candidate replacement migration，文件内不得包含事务控制语句；
- candidate 专属的 validation SQL；若目标不变量不成立，该 SQL 必须抛错。

在同一个 PostgreSQL 事务中运行两者：

```bash
scripts/wayfinder/rehearse-parameter-catalog-replacement.sh \
  --container <local-postgres-container> \
  --database wiseeff_wayfinder671_restore_<suffix> \
  --migration-file /absolute/path/to/candidate-migration.sql \
  --validation-file /absolute/path/to/candidate-validation.sql
```

在打开数据库 session 前，PostgreSQL-aware input lexer 会拒绝 transaction、session 和 psql escape，包括 `COMMIT WORK`、top-level `END`、prepared transaction、savepoint、所有 SQL `COPY` 形式（包括 server file、`PROGRAM`、`STDIN` 与 `STDOUT`）、全部 psql meta-command（含 `\i`、`\ir`、`\gexec`、`\gset`、`\copy`、`\connect`、`\!`、`\q`）、autocommit change、role/search-path/session mutation，以及所有 procedural dynamic `EXECUTE`。它能区分 PostgreSQL comment、string、quoted identifier、nested block comment、dollar quote 与 PL/pgSQL block `BEGIN`/`END`，不使用简单文本 grep。

runner 会让 locked verifier checksum 与 imported manifest 精确一致，secret-scan 两个 SQL 输入及全部生成 dump/log，并精确执行三次 `synthetic-fixture-verify.sql`：candidate mutation 前；candidate + validation 后且 rollback 前；rollback 后。它分别计算 rollback 前后的完整规范化数据库 dump hash，只有二者完全相同时才成功。所有 runner-owned 临时文件与 child process 消失后，才能唯一输出一次 `CLEANUP_OK`。预期输出包含：

```text
FIXTURE_VERIFY_BEFORE_OK
FIXTURE_VERIFY_AFTER_CANDIDATE_OK
FIXTURE_VERIFY_AFTER_ROLLBACK_OK
REHEARSAL_ROLLBACK_OK
target_database=wiseeff_wayfinder671_restore_<suffix>
before_sha256=<64 位小写十六进制>
after_sha256=<同一个值>
fixture_cases=10
fixture_mode=populated
CLEANUP_OK
```

在 zero 模式下，对应输出为 `fixture_mode=zero` 与 `fixture_cases=0`。这证明 transaction-safe candidate 能执行 populated 或 fresh zero-inventory 路径且不留下持久变更；它不能证明尚未设计的替换迁移已经拥有正确目标语义。

`legacy-twin-r6-r8` 的 candidate validation 必须保留两个 legacy ID 及其 source attribution graph。R6 只允许进入 `Observation`、`ReviewEvidence` 或 `Archive`；R8 只允许进入 `Proposal`、`Observation` 或 `Archive`。property-key 相同绝不能合并两行、重归属任一行、推断 formal subject、激活任一 legacy 行，或物化一个或多个 current Definition。未来权威 Platform definition 只能来自独立治理的 Catalog Release synchronizer，不能来自这组 twin。

## 自动化 PostgreSQL 闸门

集成测试需要可连接的真实 PostgreSQL 实例及其 Docker container：

```bash
npm run test:scripts -- scripts/wayfinder/parameter-catalog-rehearsal.integration.test.ts
```

测试覆盖 source/artifact closed world、lexer/session/psql deny matrix、全部 generated artifact secret scanning、ownership-safe cleanup、atomic populated/zero 导出与导入、全部 populated 关系形态、可执行 zero-inventory 断言、严格 manifest 拒绝、真正空数据库拒绝、candidate validation、同 key R6/R8 分离、property-key merge candidate 拒绝、三次 mode-aware verification，以及规范化 dump 的回滚前后一致性。

完成后，只删除明确命名的 disposable 数据库：

```bash
docker exec -i <local-postgres-container> \
  dropdb -U wiseeff wiseeff_wayfinder671_restore_<suffix>
```

## 证据边界

保留的源画像仍是 populated 自托管数据库的聚合证据；`wf671-` 图是由已观察 cohort 推导出的代表性 synthetic data，不是逐行脱敏的生产克隆。static/source-lock 结果只属于 D/L evidence；只有在真实 local PostgreSQL 上实际选中且未 skip 的执行才属于 PG evidence。本地 synthetic 或 PG 结果均不能推导 Hosted、target-host、release、production approval 或 compatibility-window evidence。
