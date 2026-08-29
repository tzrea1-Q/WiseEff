# ADR-0039：生效驱动参数定义必须唯一且完成放置

> English: [English decision record](../../adr/0039-effective-driver-parameter-catalog.md)

日期：2026-08-28

## 状态

已接受，用于 Issue #649 的实现与数据切换。

## 背景

API 模式目录可能同时出现同一展示名称的两行：带模块的组织 draft，以及不带模块的
平台 active。旧路径混用了展示名称、binding 实测模块、schema 行和生命周期，导致在
驱动/属性身份尚未证明前就创建临时 binding，或让后来的 active 行按不明确的规则遮住
draft。

## 决策

1. 驱动/属性身份是`（归属范围、规范 AttributionSubject source_key、property_key）`。
   `parameter_specs.id` 保持代理键，身份纠错不改外键。
2. 生效行必须有 active 定义、active 当前 `ParameterSpecVersion` 和规范驱动主体。
   DTS 属性还必须指向主体一致的 `DriverSchema`；带主体的组织行必须恰有一条
   `driver_registration_placements`，其驱动组及业务父节点属于该组织。
   这项驱动放置不变量适用于 DTS 驱动定义；没有具体 `DriverSchema` 的旧版/手工策略行
   仍走策略激活流程，不能用于识别 DTS 证据。
3. 选择由服务端负责且确定：组织 active 优先于平台 active；胜出层有多个 active
   候选时进入治理阻断；draft、deprecated 与被遮蔽成对行不进入默认生效视图，
   `view=governance` 才用于修复和审计。
4. ingest 只有在完整身份/放置元组通过检查后才能识别并创建 binding。未知或歧义节点/属性
   仍保留 occurrence 与审核证据，但不创建已识别规格、binding 或生效 occurrence。
5. 既有的 `0117_user_account_deletion.sql` 保持原样。Issue #649 的 `0118` 是加法式
   expand：回填主体链接和组织放置，不删除脏数据。`0119` 守住新的 DTS active 写入，
   `0120` 只做安全图收尾并为未来写入增加单一 active 版本触发器；现存冲突仍交给经审计的
   `parameter-definitions:reconcile` 分类和修复。`0121` 是旧版 active DTS 表面写入的兼容边界：
   允许旧的未链接暂存行，但仍对已链接行失败关闭。`0122` 修正此前仅有 nodename 的错误分类，
   将 `nodetype:*` 主体/模块归入 `NodeTypeDefinition` taxonomy；`0123` 从可信主体元数据修复空
   taxonomy 名称，无法修复时失败关闭，并在此后强制名称非空；`0124` 关闭归属范围、主体/schema 与 DTS
   属性键不一致的写入。上述迁移都保留 id 与历史，并要求组织的 node-type
   模块存在后才能进入 effective；验证门禁同时阻断重复的 active node-type source/property 身份。迁移
   `0126` 阻止 binding revision 引用其他 `ParameterSpec` 所属版本；历史不一致仍由独立验证门禁保留并阻断。该命令支持
   dry-run/apply，持久化运行/条目证据，按组织事务处理，保留历史版本/修订，并记录可信 system 审计。独立的
   `parameter-definitions:check` 是最终只读门禁。

## 影响

- 目录不再把未分类的实测模块当作驱动身份或放置证明。
- 有意保留的 curated 或歧义案例继续显示在治理面，并在解决前阻断发布；不会静默按属性键去重。
- 平台定义可以跨组织复用，但每个租户必须声明自己的驱动组放置。
- 平台 overlay promotion 副本的 `ParameterSpec` 父记录保持 governance-only/deprecated，
  active 版本只为 overlay 提供 shape；不能仅因 overlay 已提升就进入 effective 参数目录。
- 对账可安全重复运行；应用行铸造 successor active 版本，只更新最新 binding revision，历史行保持不可变。

## 发布与回滚

先部署 expand 迁移，执行 dry-run，检查持久化阻断，按组织 apply，再运行验证门禁后启用 contract。
组织事务失败时目录、binding 和审计写入一起回滚。不要删除或修改迁移历史；若运行时需要回滚，
恢复数据库备份后重新执行验证/对账流程。
