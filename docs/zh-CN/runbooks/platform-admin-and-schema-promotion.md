# 平台超级管理员引导与旧晋升功能退役

> English: [English](../../runbooks/platform-admin-and-schema-promotion.md)

`platform-admin` 的引导步骤及旧驱动 schema 晋升能力的退役边界。

## 生产环境引导首位平台超级管理员

没有自助路径。自助注册与普通组织 Admin 的用户治理都不能授予 `platform-admin`。

1. 确认已应用至 `0078_platform_admin_role.sql`。
2. 选定已有活跃用户，或先用 `users:manage` 创建普通组织 Admin。
3. 带外写入角色绑定（SQL 示例，替换 id）：

```sql
insert into user_role_bindings (id, user_id, organization_id, project_id, role_id, created_at)
values (
  'urb-platform-admin-bootstrap',
  '<user_id>',
  '<home_organization_id>',
  null,
  'platform-admin',
  now()
);
```

4. 确认 `/api/v1/me` 返回 `platform-admin`，且权限含 `platform:access` 与 `platform:schema-promote`。
5. 确认只有平台超级管理员在 `/organization/members` 看到平台超级管理员授予控件。

开发种子（`npm run db:seed:m0`，`NODE_ENV=development`）已为 ChargeLab 演示管理员绑定 `platform-admin`。

## 旧晋升功能已退役

平台控制台、导航入口及历史晋升查询 API 已删除。旧地址 `/platform-console` 使用通用首页回退，`GET /api/v2/platform/driver-schema-promotion-history` 返回 404。

旧覆盖解析、晋升与撤销路由继续返回 410 及规范目录 successor 链接。不要通过 SQL 重建旧写入流程。参数定义维护与发布使用参数后台的规范目录能力，并遵守其授权与人工确认要求。

数据库历史晋升记录、既有迁移、审计和角色元数据保留；本次清理不删除数据，也不放宽跨组织访问或平台超级管理员授予边界。
