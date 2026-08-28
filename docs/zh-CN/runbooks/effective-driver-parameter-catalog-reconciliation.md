# 生效驱动参数目录对账

> English: [English runbook](../../runbooks/effective-driver-parameter-catalog-reconciliation.md)

Issue #649 的维护窗口流程。修复组织 draft / 平台 active 成对行，不删除历史；在每个
生效驱动定义具备规范主体、active 当前版本和恰好一个组织驱动组放置前，发布门禁保持失败关闭。

## 前置条件与停止规则

- 保持既有的 `0117_user_account_deletion.sql` 原样不变，随后随应用部署 Issue #649 迁移
  `0118_effective_driver_parameter_catalog.sql`、
  `0119_effective_driver_parameter_catalog_contract.sql`、
  `0120_effective_driver_parameter_catalog_finalize.sql`，随后部署
  `0121_effective_driver_parameter_catalog_legacy_write_compat.sql`、
  `0122_classify_nodename_driver_subjects.sql` 与
  `0123_harden_node_type_identity.sql` 及
  `0124_harden_driver_identity_owner.sql`。后四个迁移保留旧暂存兼容边界，把仅有 nodename
  的主体/模块修正为 `NodeTypeDefinition`，并拒绝空的 node-type taxonomy 名称；不会让未链接定义进入
  effective 视图，并阻断跨租户身份写入。
- 先做 PostgreSQL 与对象存储快照；验证及上线观察期间保持写冻结。
- 任意命令非零、报告存在 blocker 或验证失败都立即停止。不得删除脏行、修改已应用迁移，
  也不得在数据库已变化后重试 apply。

## 扩展、分类与修复

```bash
npm run db:migrate
npm run parameter-definitions:reconcile -- --dry-run
npm run parameter-definitions:reconcile -- --dry-run --organization-id '<org-id>'
```

运行/条目表是持久化证据。检查 blocker、候选主体、放置模块、形状兼容性和 binding 实测模块证据。
未知证据、多 platform active 候选、缺少驱动证据、curated 身份变化、多 active 版本、驱动放置歧义、空的
node-type taxonomy 名称，以及身份冲突（包括重复的 node-type source/property 身份）都必须人工审核；不会自动去重。

Dry-run 审批后执行：

```bash
npm run parameter-definitions:reconcile -- --apply --organization-id '<org-id>'
npm run parameter-definitions:check -- --organization-id '<org-id>'
```

`--apply` 可幂等重复执行，并按组织单事务提交：保留旧规格/版本与 binding 历史，为修复的组织行铸造
successor active 版本，只更新最新 binding revision tip，写入放置并记录可信 system 审计。组织事务失败时，
目录、binding、放置和审计一起回滚。

## Contract 与发布门禁

应用后、发布配置修订前再次检查：

```bash
npm run parameter-definitions:check
psql "$DATABASE_URL" -c "select id, phase, status, report from parameter_definition_reconciliation_runs order by created_at desc limit 5;"
```

必须得到 `status: "ready"`。API 生效视图（`GET /api/v2/parameter-specs`，默认
`view=effective`）按规范驱动/属性身份只保留一行；使用 `view=governance` 检查 draft、deprecated、
被遮蔽成对行及 blocker。发布校验还会阻断未审核的已识别驱动 tip 及不完整/重复生效目录行。

## 回滚

apply 或上线后门禁失败时停止写入，恢复配对的数据库和对象存储快照。对账事务是原子的，不支持部分 SQL
回滚，也没有破坏性清理命令。恢复后先运行 `npm run parameter-definitions:check` 记录边界；在新的维护窗口中
修复 blocker，重新 dry-run，再 apply。
