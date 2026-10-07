# MOD 保留 dismissed 历史身份只读契约

English: [Read contract](../../design-docs/catalog-retained-dismissed-identity-read.md)

## 来源与身份

0182 提供 `parameter_catalog.list_retained_dismissed_compatible_identities(organizationId)`，经 `catalog-kernel/interface` 的 `readRetainedDismissedCompatibleIdentities` 调用。0137 来源注册表以 `array['id']` 和 `dismissed-compatible-organization-owner` 保护 `parameter-module-dismissed-compatible` 身份。已有 resolver 只能解析已知 ID；Mapping/Archive 也不能枚举全部保留行及完整 compatible。

新入口完整返回指定组织的 `{organizationId, id, compatible}`。`id` 保留原始历史行身份，不替换为 Review Item；compatible 的大小写、标点和完整字节不变。不连接 Discovery、不限旧页面长度、不按 compatible 合并或规范化。ID 唯一，按 UTF-8 字节顺序排序（`COLLATE "C"`）。客户端拒绝畸形、重复、乱序和跨组织响应，并传播数据库错误，不将失败变成空库存；没有保留行时可合法返回 `[]`。

该契约枚举全部**仍保留的历史行**，不重建已删除的 dismiss/restore 事件。比较继续使用原 row ID 作为保护身份、原 compatible 调用旧路由，并在该行的组织中观察 canonical 状态。跨组织相同 compatible 保留不同 case；不可查询项继续阻断报告。

## 授权

函数为只读 `STABLE SECURITY DEFINER`，固定 `pg_catalog, parameter_catalog` search_path，来源表使用限定名称。owner 为已有 `catalog_migration_owner`，沿用 0138 的来源 SELECT；PUBLIC 无 EXECUTE。

新能力角色 `catalog_legacy_identity_reader_role` 为 NOLOGIN/NOINHERIT，只取得 schema USAGE 和该函数 EXECUTE，没有来源表/列 SELECT 或 DML。其授权范围明确为**维护比较所需全部组织，每次显式指定一个组织**，不是租户用户能力。0182 不添加 LOGIN 成员，不扩大 MOD D02 source-reader/capture、API 或发布读取角色。部署 owner 须明确绑定维护 LOGIN 及允许范围后才能验收目标环境；AuthContext 不等于数据库登录角色。

专用 PG 测试使用临时非超级 LOGIN：成员授权前和撤权后读取拒绝，直接 SELECT/UPDATE 和切换 owner 拒绝；测试专用成员授权后，在只读事务内读取两个组织。此证据不代表部署账号或生产 runner。完整比较夹具仍使用其迁移/管理员连接，须分开报告。

## 验证与交接

既有 201＋1 夹具在两个阶段覆盖 202 个原始 ID 和 215 个 case：209 个预期差异、6 个缺少精确 Subject 的不可查询项。fresh 零库存、真实 Governance 分页和失败传播继续保留。

0181 指纹 `bd79fcababc6baa972d0935d1e837a5dc78195a225563d92be7a717af4e97797` 保留为历史阶段。fresh 与 0181 升级 PG 实测 0182 为 `2ab9046e3ceb66ab9f91b1d7eb96e5d929f9b25f8b3fda0bb0c190fcac761fd5`；旧收据/checksum 与历史行保持不变。共享迁移尾清单/ACL 证明适配交 A 集成，不放宽冻结断言或历史证明。

原生 Catalog 独立核对 `S12-MOD:legacy-catalog-raw-read:3d36995998094eb1:b170050e2ad90587` 退休。记录退休不是许可；继承 173 项仍阻断 strict 门禁。本契约不扩展 D02 capture、不改变 Archive 策略、不提供生产 runner、不激活 P11–P16，也不授权部署。
