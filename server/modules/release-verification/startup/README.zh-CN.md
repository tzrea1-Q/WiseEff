# 只验证启动适配与管理态观察

英文：[English](README.md)。

本分片继续 `1190ba591` 候选。它没有接通 API／worker 启动回调，没有执行
P12／P13，没有批准生产，也没有完成 M2。controller 产出真实当前边界并由父
协调者接通组合根之前，现有启动拒绝仍须保留。

`verifyIsolatedCandidateStartup` 只调用现有
`createStartupRuntimePin().readApprovedRuntimePin` 投影。报告选择、批准与
保留期限仍由原模块负责。适配器在目标维护锁内观察真实状态、读取投影、比对
固定报告与阶段／lineage／目标 pins，然后再次观察。首次结果经过复制，避免
共享对象被原地修改而隐藏漂移。正向结果仅表示隔离候选启动核验；该函数不启动
进程、不恢复队列或代理，也不写报告、迁移或修复数据。

`verifyPublishedCandidateStartup` 单独核验已发布候选的正常重启。观察方必须
锁住激活、配置及退休元数据，不能把正常业务流量伪装成维护停写证明。它消费
既有 runtime 和获批报告投影，要求当前 public 报告及已关闭的 pointer-only
回退资格，并把 runtime 绑定到实际 P12 的预激活报告、验收绑定到该 runtime。
public 报告必须精确引用这三个前驱。历史 runtime 的阶段和回退状态不改写为
后来的发布状态。该适配器单测没有实现观察 producer，也不证明真实进程启动。

根 controller 尚未实现 `StartupTarget`。它必须在真实锁内独立产生全部字段，
包括当前选择的 runtime 报告、已执行的 P12、退休 P13、退休指纹、generation
和完整固定输入，不能从报告反向抄出当前状态。调用者构造对象、环境标志或
P10 checkpoint 都不是生产实现。缺失状态必须拒绝，不提供合成默认边界。

`catalog-cutover/runtimeState.ts` 完成该 producer 的一部分：读取真实集群标识／
数据库 OID 和全量迁移 ledger，对照独立候选包中的 filename／checksum 清单，
调用正式 Kernel `loadCurrentCatalog` 接口，由 Kernel 自己管理读取事务。
同时读取 run、checkpoint、当前 mapping head 和 Archive 记录。可能含私有
引用的记录只输出摘要。结果始终明确 `approvalState: not-produced`；Catalog
已安装或 P10 completed 不证明 P12／P13 或 runtime 批准。

这些观察摘要不是新定义的 mapping epoch、Archive 备份摘要或完整
`VerificationPins` producer。对象字节、Redis、宿主／Compose／镜像身份和
恢复点仍须由各自真实 adapter 产生。每次 metadata 观察使用 REPEATABLE READ
READ ONLY，Kernel 使用独立读取事务。必需的 `RuntimeObservationBoundary`
必须在前后两次 metadata 观察和 Kernel 读取全过程隔离相关写入者。观察器在
读取前后核验边界，比较全部观察事实／摘要及公开 snapshot pins；边界丢失或
漂移就拒绝。结果相等不能替代真实停写证明，也不能忽略中途变更后又恢复的情况。
调用者不向 Kernel 传入事务或 callback，不导入私有实现，不改变公开接口或
冻结事务 ownership。

## 权限与所有权

| 连接 | 现有能力 | 边界 |
| --- | --- | --- |
| 源／installer 管理 pool | 真实源库存、`public.schema_migrations`、Catalog 投影、Cutover／mapping／Archive 与集群身份读取 | 仅受控管理阶段，不能进入 API／worker |
| 启动报告读 pool | `0139` 的 `catalog_verifier_role`：schema USAGE 与六张 verification 表 SELECT；投影实际读取 plan、report、approval | 独立受限登录，不继承 verification writer、governance writer、synchronizer 或 migration owner |
| Runtime Catalog reader | 已获批准的追加 `0140` `catalog_runtime_reader_role`，明确列出十张 Kernel 表 | 不含 Binding、治理、激活及管理元数据能力；运行连接接线仍单独验证 |

`0138` 没有给 `catalog_migration_owner` 授予 `schema_migrations` SELECT，因此
观察器明确使用源／installer pool，不偷偷添加授权。观察事务和 Kernel 自管
读取都只读；回滚结果未知时销毁连接。这不能证明管理登录适合运行时使用。

本分片不修改 SQL 授权或角色属性。报告读取复用既有 `0139` 接口，不需要
`0140` 提议的两项 governance writer EXECUTE；那两项仍未获批准。父协调者
仍须核验独立登录。现有 shared runtime guard 已明确拒绝可达的
`catalog_verification_writer_role` 成员关系。

冻结顺序是 P12 激活、P13 退休、新的完整 post-retirement 验证 attempt 和批准。
现有 runtime query 使用 P13 `retired`，适配器保持该语义。根接线前仍须处理
既有调用者差异：`run-self-hosted-release-gate.ts` 使用 P12 `completed`，浏览器
evidence 的 `identity.ts` 要求 P12 `retired`。本分片不制造新的 P12 状态，也不
静默改变任何一方的验收合同。

## 威胁与回归范围

| 威胁 | 拒绝或验证方式 |
| --- | --- |
| 跨候选、数据库、release、phase、subject 借用报告 | 独立边界完整比对与第二次观察 |
| 缺报告、未批准、pre-pin、报告过期 | 现有投影负责判断，保留 typed absent 原因 |
| 已建新表但尚未安装 release | 真实观察返回 `catalog: null`，不提供批准 |
| 错数据库或候选迁移清单漂移 | 实际 backend 身份与完整独立 ledger 比对 |
| Kernel／metadata 独立事务之间缺少停写或发生漂移 | 必需的真实边界、前后完整观察及 snapshot pins 比对 |
| 查询不完整或回滚结果未知 | 静态拒绝；未知关闭销毁连接 |
| 启动读取变成批准或切流 | 仅只读投影，接口不含动作方法 |

`verifyStartup.test.ts` 是使用报告投影 stub 的 adapter 单测；正向用例不属于
技术报告，也不是 M2 证据。`runtimeState.test.ts` 在任何数据库操作之前要求
显式 owned-cluster receipt，没有 ambient 探测、数据库 fallback 或 skip 模式。
它通过真实 migration／Kernel 安装、数据库 SHARE 锁验证观察，拒绝实际锁丢失，
并使用真实 NOINHERIT verifier 登录读取 absent 报告、拒绝报告 DML 和管理角色
切换。fixture 的锁只覆盖其独占数据库，没有实现生产跨存储 controller，也不
伪造 passed 报告。

执行身份与计数统一记录在已有 populated-upgrade evidence 文档。启动单测使用
无 globalSetup 的配置；真实 PostgreSQL 文件还必须使用现有 owned-target
receipt／config 门禁。本模块不能给出可执行的生产命令。

## 独立报告连接

`reportConnection.ts` 的 `openStartupReportDatabase` 使用显式 PostgreSQL URL
建立真实连接池，在返回前核验实际登录。它不调用应用 startup adapter，因此报告
reader 不会递归要求尚待读取的 runtime 报告。没有 development 绕过、ambient URL
回落、grant、角色切换、DDL、报告写入或批准动作。必需的六表 SELECT 严格对应
不可变迁移 `0139_parameter_catalog_verification_core.sql`。

登录仅可有效继承 `catalog_verifier_role`，PostgreSQL 16 成员关系必须为
`INHERIT TRUE, SET FALSE, ADMIN FALSE`；能力角色保持 NOLOGIN、NOINHERIT。
超级用户、BYPASSRLS、CREATEDB、CREATEROLE、replication、其他可达角色
（包括 Catalog reader、治理和管理角色）、对象所有权、直接额外关系／列／函数
授权、有效业务写权限、schema／数据库 CREATE、危险 definer 代理及高权参数授权
均拒绝准入。已有 PUBLIC 普通读取不视为新授权。保留普通 PostgreSQL 内建执行；
PUBLIC 对非报告 Catalog 对象的表级／列级 SELECT 仍须拒绝，普通业务读取例外
不扩大 canonical 访问。definer 代理的序列 USAGE／UPDATE 属于写能力，即使其
owner 没有表写权限或 schema CREATE 也拒绝。
definer owner 仅有非报告 Catalog 表／列 SELECT 或 Catalog 函数 EXECUTE 时同样
拒绝：只读代理也会越过报告／Catalog 边界。0139 六表读取不计入额外 Catalog
读取检查；正式报告查询不需要受保护函数 EXECUTE。
同时比较 definer owner 与报告登录的有效能力：额外函数 EXECUTE 或业务关系／列
SELECT 均拒绝委托。检查覆盖跨 schema 私有函数及 owner-rights view；将内层函数
移出 Catalog 不能隐藏额外权限。双方均可执行的普通内建函数和六张报告表读取
不构成差异。不解析函数体或用 SQL 文本匹配判断安全性。
拒绝显式函数授权及用户 schema 中代理高权／写能力的 definer。此处仅是专用连接
前置条件，不取代完整迁移／权限 manifest 或 Release Verification。

只有核验通过的 `RootDatabase` 会返回。组合根负责使用后关闭，并在后续应用
bootstrap 失败和正常退出时释放。任何失败都会尝试关闭已创建的 pool；关闭失败
不能覆盖原固定准入错误。错误不包含报告内容、凭据、连接 URL 或原始 SQL 诊断。

| 增量威胁 | 必须观察 |
| --- | --- |
| 伪造角色名称、高权／混合成员／owner 登录 | 实际会话和有效能力查询在 pool 暴露前拒绝 |
| 缺少 SELECT 或混入应用／治理能力 | 固定拒绝，不追加 grant 或修复角色 |
| 连接失败、审计结果缺失／畸形、关闭失败 | 固定脱敏错误，并尝试释放资源 |
| 将报告连接当作启动权限 | 仍须独立的既有 startup adapter 和 controller 当前状态 |

`reportConnection.test.ts` 使用数据库 factory mock 验证生命周期及 typed 失败。
`reportConnection.integration.test.ts` 必须取得既有 owned PG16 集群 receipt，使用
真实受限 LOGIN 和正式报告投影，并覆盖角色／ACL／definer 污染；不探测 ambient
数据库，也不因环境缺失而跳过。成功读取 absent 报告只证明连接可用，不伪造
passed 报告或宣称应用启动成功。根入口／config 接线及真实执行证据由父集成 lane
负责。
