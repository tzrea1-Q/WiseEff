# 平台超级管理员与驱动 schema 晋升

> English: [English](../../runbooks/platform-admin-and-schema-promotion.md)

跨组织角色 `platform-admin`，以及将组织驱动 schema 覆盖晋升为平台层的运维步骤（ADR-0009）。

## 生产环境引导首位平台超级管理员

没有自助路径。自助注册与普通组织 Admin 的用户治理都不能授予 `platform-admin`。

1. 确认已应用至 `0078_platform_admin_role.sql`（若要做覆盖晋升，还需 `0079`）。
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
5. 确认可见 `/platform-console`，且只有该用户在 `/user-permissions` 看到平台超级管理员授予控件。

开发种子（`npm run db:seed:m0`，`NODE_ENV=development`）已为 ChargeLab 演示管理员绑定 `platform-admin`。

## 将覆盖晋升到平台层

影响面：从未编写该 compatible 覆盖的组织，会在下次 ingest 开始解析它。贡献方组织的覆盖会被标记为已取代（不删除）。

1. 以 `platform-admin` 打开 `/platform-console`。
2. 查看候选列表。仅对 `equivalent: true` 的行晋升。若有分歧，先线下对齐——接口不会合并不同的值形状。
3. 确认对话框写明跨租户影响面与文档来源组织。
4. 执行晋升后应看到：一条平台覆盖（`organization_id IS NULL`）、贡献方覆盖为 `superseded`、链接的 ParameterSpec 提升为平台作用域且 id 不变、平台与各租户审计事件。
5. 在从未编写该覆盖的租户归属树上抽检：芯片应为平台已覆盖。

## 撤销晋升

1. 在控制台撤销晋升。
2. 平台行应变为 deprecated，贡献方覆盖恢复为 `active`。
3. 组织侧芯片应回到组织覆盖（如适用）。

## 护栏

- 只有已持有 `platform-admin` 的调用方才能授予或撤销该角色。
- 平台超级管理员不会扩大对其他组织参数、日志、用户或项目的访问。
- 优先走产品控制台。直接改库仅作应急，并需使 schema 注册表进程缓存失效（不确定时可重启 API 进程）。
