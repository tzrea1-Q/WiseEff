# 参数目录迁移演练画像

> English: [English](../../references/parameter-catalog-rehearsal-fixture.md)

这是一个仅存在于研究分支的 Wayfinder 资产，用于在不复制业务数据行的前提下，采集当前 populated PostgreSQL 的结构。它是替换参数目录迁移的规划证据，不是生产备份、生产迁移或发布就绪证据。

导出器在同一个 repeatable-read、只读 PostgreSQL snapshot 中生成全部计数与分类报告，然后执行 `pg_dump --schema-only`；若 schema dump 期间迁移清单发生变化则拒绝产物。归档包含：

- 不含 owner、权限、注释和数据语句的 schema-only DDL；
- 关系、列、约束、索引和触发器元数据；
- 已应用迁移名称及不可变 checksum；
- 参数、目录和 DTS 相关关系的精确计数；
- 只由封闭 lifecycle/kind/source 枚举和 present/missing/aligned/misaligned 桶组成的聚合行分类；若数据库早于 trusted-invocation 列，则记录 `initiator=column-absent`，不读取不存在的字段；
- 聚合不变量计数与迁移输入计数；
- 逻辑源数据库、schema 元数据、规范化 DDL、文件和归档的 SHA-256 checksum。规范化 DDL checksum 排除 PostgreSQL 每次生成的 `\\restrict` nonce；文件 checksum 仍保护原始 dump 字节。

归档明确不包含数据行 ID、组织/项目/用户名、source key、compatible 字符串、property key、schema namespace、说明、DTS 原文、evidence JSON、凭据、参数值、默认值、示例值或工作流原因。导入时还会断言 `data_rows_exported=0`。

## 导出

在该分支的独立 checkout 中执行。输出目录和归档必须不存在。

```bash
scripts/wayfinder/export-parameter-catalog-rehearsal.sh \
  --compose-file ops/self-hosted/compose.yaml \
  --env-file /absolute/path/to/ops/self-hosted/.env \
  --output-dir /absolute/path/to/wiseeff-wayfinder-671-export-YYYYMMDDTHHMMSSZ
```

导出器记录实际已应用的完整迁移清单，不要求数据库已应用仓库中的最新迁移。若数据库缺少必需的目录关系、无法证明只读事务，或 schema dump 含数据语句、聚合文件命中秘密形态，导出器会拒绝继续。

## 本地导入

先创建名称以 `wiseeff_wayfinder671_restore_` 开头的全新隔离 PostgreSQL 数据库。导入器不会创建、删除、清空或覆盖数据库。

```bash
scripts/wayfinder/import-parameter-catalog-rehearsal.sh \
  --container <local-postgres-container> \
  --database wiseeff_wayfinder671_restore_<suffix> \
  --artifact-dir /absolute/path/to/unpacked-export
```

导入流程会恢复空的源 schema，并把聚合画像加载到 `wayfinder_rehearsal` schema。后续迁移设计从这里读取证据；不得把它表述为行级生产克隆或目标环境就绪证据。
