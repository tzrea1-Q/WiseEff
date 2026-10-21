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

## 检查项目删除影响

在**参数管理 → 项目清单**中，本组织管理员可从项目操作菜单打开**删除影响预览**，Canonical 项目同样可用。只读检查将项目专属配置、源版本、基线、Binding、值、草稿、审核和迁移历史，与需要解除的项目关联及保留资源分开展示。共享存储内容、独立知识、日志、设备和平台参数定义保留。受专门保留契约保护的离线迁移归档及部署证据需要通过各自流程处置，不能被项目清理默默包含。

弹窗展示当前工作及可处理的阻塞原因。数据变化后应刷新：绑定组织、项目及相关状态的摘要只是本次快照证据，不能作为删除授权。存储数量反映数据库引用，不证明底层对象可读。本切片没有彻底删除执行按钮，现有 Canonical 项目删除保护继续生效。

## 旧晋升功能已退役

平台控制台、导航入口及历史晋升查询 API 已删除。旧地址 `/platform-console` 使用通用首页回退，`GET /api/v2/platform/driver-schema-promotion-history` 返回 404。

旧覆盖解析、晋升与撤销路由继续返回 410 及规范目录 successor 链接。不要通过 SQL 重建旧写入流程。参数定义维护与发布使用参数后台的规范目录能力，并遵守其授权与人工确认要求。

数据库历史晋升记录、既有迁移、审计和角色元数据保留；本次清理不删除数据，也不放宽跨组织访问或平台超级管理员授予边界。
