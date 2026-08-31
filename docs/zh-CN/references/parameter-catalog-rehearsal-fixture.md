# 参数目录 populated 迁移演练夹具

> English: [English](../../references/parameter-catalog-rehearsal-fixture.md)

这是一个仅存在于研究分支的 Wayfinder 资产，用于为未来的参数目录替换迁移生成可执行的 PostgreSQL 演练输入。它把 populated 自托管数据库的只读结构/聚合画像，与确定性、非敏感的行级关系图组合在一起。它只属于规划与迁移设计证据，不是生产备份、生产迁移或发布就绪声明。

流程不会复制源数据库的任何数据行。populated 关系图由仓库内固定 SQL 生成；所有 ID 都以 `wf671-` 开头，所有值都明确标记为 synthetic placeholder。

## 产物契约

导出器在同一个 repeatable-read、只读事务中获取全部源端计数和分类报告，随后执行 `pg_dump --schema-only`。若迁移清单在采集期间变化、schema dump 含数据语句，或聚合输出命中秘密形态，导出会失败。

产物必须且只能包含以下受 checksum 保护的文件：

- `schema.sql`：仅包含源 schema，不含 owner、权限、注释或数据语句；
- `profile-schema.sql`：`wayfinder_rehearsal` 下的源画像表与夹具案例索引；
- `synthetic-fixture.sql`：确定性的 populated 行；
- `synthetic-fixture-verify.sql`：fail-closed 关系断言；
- `relations.csv`、`columns.csv`、`constraints.csv`、`indexes.csv`、`triggers.csv`；
- `migration-inventory.csv`、`row-counts.csv`、`row-classes.csv`、`invariant-counts.csv`；
- `manifest.csv`，其中必须有 `format_version=2`、`source_data_rows_exported=0` 和 `import_populates_synthetic_rows=true`；
- `SHA256SUMS`，对其他每个必需文件恰好提供一条安全条目。

导入器把上述清单当作封闭集合。缺少文件、未知文件或目录、symlink、缺少或重复 checksum 条目、不安全文件名、路径穿越、checksum 不一致，或 manifest 不是 populated fixture format 2，都会在接触数据库之前被拒绝。

源端画像只记录关系结构、不可变迁移名称和 checksum、精确关系计数、封闭枚举/存在性/对齐分类、不变量计数，以及逻辑/schema/文件/归档 SHA-256。只有规范化 dump checksum 会排除 PostgreSQL 每次生成的 `\restrict` nonce；文件 checksum 仍保护原始 dump 的每个字节。

导入时，安全的迁移名称和 checksum 还会以固定 synthetic timestamp 写入 `public.schema_migrations`。这样既不导出原始部署时间，又能让恢复后的 0128 schema 被后续 append-only migration tooling 正确识别。

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

关系图不会创建 user 或 credential 行，也不含真实组织、项目、subject、source key、compatible、property key、schema namespace、DTS 源文、业务说明、参数实际值、默认值、示例值、evidence payload 或工作流原因。

## 只读导出

请在该分支的独立 checkout 中运行。输出目录、归档和归档 checksum 文件都必须尚不存在。

```bash
scripts/wayfinder/export-parameter-catalog-rehearsal.sh \
  --compose-file ops/self-hosted/compose.yaml \
  --env-file /absolute/path/to/ops/self-hosted/.env \
  --output-dir /absolute/path/to/wiseeff-wayfinder-671-export-YYYYMMDDTHHMMSSZ
```

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
loaded_fixture_cases=9
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

准备两个绝对路径、非 symlink 的文件：

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

runner 会先验证全部 9 个夹具案例，对完整数据库的规范化 dump 计算 hash，然后以 `ON_ERROR_STOP` 执行 candidate 与 validation SQL，发出 `ROLLBACK`，再次计算数据库 hash；只有前后 hash 完全相同时才成功。预期输出：

```text
REHEARSAL_ROLLBACK_OK
target_database=wiseeff_wayfinder671_restore_<suffix>
before_sha256=<64 位小写十六进制>
after_sha256=<同一个值>
fixture_cases=9
```

这证明 transaction-safe candidate 可以映射并验证 populated 关系图，而不留下持久变更；它不能证明尚未设计的替换迁移已经拥有正确目标语义。

## 自动化 PostgreSQL 闸门

集成测试需要可连接的真实 PostgreSQL 实例及其 Docker container：

```bash
npx vitest run --config vitest.scripts.config.ts \
  scripts/wayfinder/parameter-catalog-rehearsal.integration.test.ts
```

测试覆盖 populated 导出/导入、全部关系形态、严格 manifest 拒绝、真正空数据库拒绝、candidate validation，以及规范化 dump 的回滚前后一致性。

完成后，只删除明确命名的 disposable 数据库：

```bash
docker exec -i <local-postgres-container> \
  dropdb -U wiseeff wiseeff_wayfinder671_restore_<suffix>
```

## 证据边界

保留的源画像仍是 populated 自托管数据库的聚合证据；`wf671-` 图是由已观察 cohort 推导出的代表性 synthetic data，不是逐行脱敏的生产克隆。本地导入与回滚成功只属于本地 PostgreSQL 证据；目标迁移与发布就绪仍需后续 Wayfinder 决策和目标环境闸门。
