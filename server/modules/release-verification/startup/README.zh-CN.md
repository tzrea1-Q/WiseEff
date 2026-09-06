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

根 controller 尚未实现 `StartupTarget`。它必须在真实锁内独立产生全部字段，
包括当前选择的 runtime 报告、已执行的 P12、退休 P13、退休指纹、generation
和完整固定输入，不能从报告反向抄出当前状态。调用者构造对象、环境标志或
P10 checkpoint 都不是生产实现。缺失状态必须拒绝，不提供合成默认边界。

`catalog-cutover/runtimeState.ts` 完成该 producer 的一部分：读取真实集群标识／
数据库 OID 和全量迁移 ledger，对照独立候选包中的 filename／checksum 清单，
在同一个 REPEATABLE READ READ ONLY 会话内复用 Kernel `loadProjection`。
同时读取 run、checkpoint、当前 mapping head 和 Archive 记录。可能含私有
引用的记录只输出摘要。结果始终明确 `approvalState: not-produced`；Catalog
已安装或 P10 completed 不证明 P12／P13 或 runtime 批准。

这些观察摘要不是新定义的 mapping epoch、Archive 备份摘要或完整
`VerificationPins` producer。对象字节、Redis、宿主／Compose／镜像身份和
恢复点仍须由各自真实 adapter 产生。可重复读事务保证数据库观察一致，但不能
替代 controller 跨存储维护锁。

## 权限与所有权

| 连接 | 现有能力 | 边界 |
| --- | --- | --- |
| 源／installer 管理 pool | 真实源库存、`public.schema_migrations`、Catalog 投影、Cutover／mapping／Archive 与集群身份读取 | 仅受控管理阶段，不能进入 API／worker |
| 启动报告读 pool | `0139` 的 `catalog_verifier_role`：schema USAGE 与六张 verification 表 SELECT；投影实际读取 plan、report、approval | 独立受限登录，不继承 verification writer、governance writer、synchronizer 或 migration owner |
| 后续 runtime Catalog reader | 已有 `0140` reader 提案 | 独立决策与接线，本分片没有授权 |

`0138` 没有给 `catalog_migration_owner` 授予 `schema_migrations` SELECT，因此
观察器明确使用源／installer pool，不偷偷添加授权。包括 Kernel 在内的观察
事务只读；回滚结果未知时销毁连接。这不能证明管理登录适合运行时使用。

本分片不修改 SQL 授权或角色属性。报告读取复用既有 `0139` 接口，不需要
`0140` 提议的两项 governance writer EXECUTE；那两项仍未获批准。父协调者
仍须核验独立登录，并阻止 `catalog_verification_writer_role` 进入运行池；
现有 shared runtime guard 尚未明确排除该角色。

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
| 查询不完整或回滚结果未知 | 静态拒绝；未知关闭销毁连接 |
| 启动读取变成批准或切流 | 仅只读投影，接口不含动作方法 |

`verifyStartup.test.ts` 是使用报告投影 stub 的 adapter 单测；正向用例不属于
技术报告，也不是 M2 证据。`runtimeState.test.ts` 在任何数据库操作之前要求
显式 owned-cluster receipt，没有 ambient 探测、数据库 fallback 或 skip 模式。
它通过真实 migration／Kernel 安装验证观察，并使用真实 NOINHERIT verifier
登录读取 absent 报告、拒绝报告 DML 和管理角色切换，不伪造 passed 报告。

实现智能体没有执行测试、build、Docker 或数据库命令，全部执行由父协调者
负责。执行前由父协调者在无 globalSetup 的合适 config 中仅纳入对应 selector；
真实 PostgreSQL 文件还必须使用现有 owned-target receipt／config 门禁。本模块
不能给出可执行的生产命令。
