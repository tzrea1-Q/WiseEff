# S6 管理阶段 Binding 历史导入

[English](README.md)

这个内部入口消费 controller 持有的 P0／P8 receipt，不从运行时 Parameter
Bindings API 导出。它不批准发布、不切换指针、不恢复队列，也不开放流量。

管理连接必须使用真实的 NOINHERIT 登录角色，不能具有 superuser、BYPASSRLS、
CREATEDB 或 CREATEROLE，并且必须持有现有 `catalog_migration_owner` 能力角色的
成员关系。导入事务切换到该管理角色；运行连接池不会获得管理凭据或导入能力。

冻结的 `0138_canonical_parameter_catalog_roles.sql` SELECT 清单没有授予该 writer
读取源文件、文件版本、config revision 成员以及全部源权威表的能力。P0 和完整
源证明使用独立的源／installer 管理 pool。P8／P9／P10 期间，该连接按固定旧源
表清单获取 SHARE NOWAIT 锁，并持有到 canonical 事务结束。两个模块都读取真实
backend 身份和实际 granted locks，传入连接本身不是证明。现有注册命令只写
canonical 表，对旧模块使用 SELECT FOR SHARE，与这些源表锁兼容。源 DML／DDL
冲突直接失败，不延长等待，也不扩大 writer 授权。

生产 P0 输入为 `s6-binding-import-intent-v1`：由服务端全量读取旧 Binding，固定
完整 Definition、源权威关系和 tip 证明的摘要。它不包含后续才生成的 run、
Archive 或 mapping ID。P8 根据真实 P7 mapping pin、加密证据和现有受保护注册
命令生成 `s6-binding-import-v2`。该凭据绑定 run、plan、源快照、当前映射版本、
加密源证据、保留的历史 release head、原审计引用和明确的源 revision tip。
导入器不会按名字、property key、时间、版本号或当前 Catalog head 猜身份和 tip。
历史 `s6-binding-import-v1` pool 入口仅保留早期 receipt 消费 fixture，生产
controller 不使用该版本。合成 fixture 不属于 Release Verification 报告或批准。

tip 证明读取全部文件的明确 `current_version_id`，要求恰好一个 config revision
的文件／版本成员集合完全匹配，同时恰好一个 Binding revision 和逻辑节点
revision 对应。空集合、缺失或多重匹配均拒绝。历史定义映射必须明确提供
`retainedReleaseId`。Driver 注册沿真实 R2 root、DriverSchema 和同组织的旧
Placement 证明调用领域命令；node-type 和其他未支持 family 仍拒绝，不修改 R 类。

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
| 遗漏整个 Definition、文件指针或源权威关系变化 | 重建全量 intent，摘要变化即拒绝 |
| installer 与管理 pool 指向不同目标 | 比较真实 PostgreSQL system identifier 与数据库 OID；查询失败拒绝 |
| P7 到 P8 映射变化，或 P9 前任一固定正式映射变化 | 拒绝旧 checkpoint／receipt lineage |

`importPreparedBindingHistory` 要求 controller 的真实管理事务，并在同一连接
重新获取目标锁，没有信任锁的 boolean。P9 导入与 checkpoint 一起提交。Archive
准备独占事务，随后 P8 注册、证据映射 CAS 和 receipt checkpoint 一起提交。
提交结果未知时停止且不重试；Archive 保留密文供检查。已完成 S7 的 no-op 仍需
重新核验导入。controller 固定保留期限拥有者明确提供的日期，不发明生产默认期限。

新 Binding lane 必须接入真实部署边界接口，执行停写隔离并生成三存储恢复清单，
不会使用旧 P2 boolean 或 P3 行数 dump。该部署 producer、全部源 family 覆盖、
P12／P13 和完整批准链仍是独立集成工作；本模块不能授权省略它们。

Binding lane 还必须接入现有 upgrade controller 的 journal adapter，在阶段
动作前持久化 attempt，提交后记录 outcome。真实目标上任何 pending／unknown
attempt 都阻止普通 resume，包括 PostgreSQL 已提交但响应丢失的情况；进程中断
保留 pending intent。本模块不提供 reconciliation 捷径，也不新增 journal
存储。controller adapter 和显式 reconciliation 尚未接通时，根 Binding 路径
保持 unavailable。已知失败的 `current_phase` 保持在最新已提交 checkpoint，
避免将执行中的 P10 当作已提交 P10。

PostgreSQL 集成 fixture 从 `82344044…` 的真实 migration 文件开始，先填充旧
schema，再执行未修改的候选追加迁移。它调用真实 compiler、installer、注册
writer、classifier、mapping writer 和加密 Archive。这个证据范围是 S6 导入，
不等于完整应用升级、运行 pool 切换或生产预演。
新增 S7 fixture 检验真实 P7 映射输出、P8 Archive／注册及 P9 同事务导入。此前
阶段 checkpoint 明确属于合成切片准备，不构成 P2／P3 或根入口执行证据。
测试文件存在本身不代表已经执行或通过。
