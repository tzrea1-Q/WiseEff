# S6 管理阶段 Binding 历史导入

[English](README.md)

这个内部入口消费 controller 持有的 P0／P8 receipt，不从运行时 Parameter
Bindings API 导出。它不批准发布、不切换指针、不恢复队列，也不开放流量。

管理连接必须使用真实的 NOINHERIT 登录角色，不能具有 superuser、BYPASSRLS、
CREATEDB 或 CREATEROLE，并且必须持有现有 `catalog_migration_owner` 能力角色的
成员关系。导入事务切换到该管理角色；运行连接池不会获得管理凭据或导入能力。

P0 必须固定完整 `s6-binding-import-v1` manifest 的摘要和源库存指纹，P8 必须
持久化同一份 manifest。该凭据绑定 run、plan、源快照、明确的当前映射版本、
加密源证据、保留的历史 release head、原审计引用和明确的源 revision tip。
导入器不会按名字、property key、时间、版本号或当前 Catalog head 猜身份和 tip。
生成并审核这些 receipt 仍由 controller 负责。合成 receipt fixture 不属于
Release Verification 报告或发布批准。

源读取包含旧 Binding、全部 revision、关联 DTS revision、定义 revision 和
审计行的全部列，并记录 SQL NULL 标志，区分 SQL NULL 与 JSON null。
raw、canonical、schema 和 policy 证据保留在加密 Archive 的源图中；canonical
ProjectValue 接收实际 typed value，并保留原 ID 和时间。每个目标 revision 都
必须匹配它自己的已验证历史 release head。导入事件明确使用
`legacy-project-value-import`，不会伪造旧系统的编辑先后链。

证据是完整的 definition 源图，包含所有项目中引用该旧定义的全部 Binding。
多个 manifest 条目从同一份 Archive 中选择各自受 checksum 约束的子图。
导入器核对完整源 Binding 集合，不会为了给不同项目附加证据而覆盖同一个
definition 的 mapping head。

运行对象的补充证据通过 `Archive.persistEvidenceArchive` 和现有 mapping 的
`evidenceArchiveId` 接线。该路径要求同一 identity、run 和 R 类已有运行对象
映射，保持 primary disposition 不变。普通 `persistArchive` 仍然拒绝 mapped
R 类。

| 威胁 | 拒绝条件或不变量 |
| --- | --- |
| 运行登录或高权限登录 | canonical 写入前拒绝 |
| run、phase、manifest、mapping head 或源字节变化 | 拒绝旧 receipt |
| 加密源证据缺失或损坏 | canonical 写入前拒绝 |
| Registration、Placement 或源关系跨 owner | 拒绝，不扩大授权 |
| tip 未证明或历史 release head 不可用 | 拒绝，不替换为最新 head |
| 已有目标行却没有提交成功 receipt | 拒绝，不覆盖或重复导入 |
| 提交响应丢失 | 返回未知结果；显式重放重新核验持久状态 |
| 重放时目标历史或审计变化 | 拒绝，不只相信完成事件 |
| 同一目标存在并发 plan | 按目标加锁，不按 plan 分别加锁 |

pool 入口独占事务和目标锁。controller 已在其他连接持有该锁时，不能递归调用
这个入口。与 controller 共用事务的接线、全部源消费方覆盖、源 tip 权威来源和
完整发布批准仍属于后续集成；本模块不能授权省略它们。不能为了进入这个入口，
人为制造无法证明的源 manifest。

PostgreSQL 集成 fixture 从 `82344044…` 的真实 migration 文件开始，先填充旧
schema，再执行未修改的候选追加迁移。它调用真实 compiler、installer、注册
writer、classifier、mapping writer 和加密 Archive。这个证据范围是 S6 导入，
不等于完整应用升级、运行 pool 切换或生产预演。
