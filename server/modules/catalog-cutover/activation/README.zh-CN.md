# P12 应用读模式持久层

> 英文：[English](README.md)

本管理组件实现既有 [P12 合同](../../../../docs/design-docs/parameter-catalog-cutover-archive-rollback.md)
的持久部分。应用读路由、P13、运行批准、队列、公开发布和指针回退仍由各自
实现负责。P0–P10 orchestrator 和其后续阶段 unavailable 合同保持不变。

## 归属与权限

0141 追加 `cutover_mapping_epochs`、`cutover_activation_attempts` 和
`application_read_state` 三张表，所有者均为既有 `catalog_migration_owner`。
历史迁移不变，不增加 runtime、verifier、governance 或 synchronizer 权限。
安装登录身份的默认 ACL 若留下其他授权，迁移拒绝。P5 的 `catalog_state`
不被修改或重新解释。

管理 LOGIN 保持受限、NOINHERIT，每个管理事务显式使用既有 owner。
Kernel 使用独立的 0140 reader 连接并拥有只读事务。报告查询使用原有独立
连接及正式 Report 批准实现。

本组件创建专用 Catalog reader pool。Kernel 每次实际 checkout 都先检查
LOGIN 与能力角色、唯一的 PG16 成员关系（INHERIT true、SET false、ADMIN
false）、所有权、直接 ACL、PUBLIC 能力与高权函数委托，再用随机 session
锁挑战把该连接绑定到独立观测的管理数据库；不新增任何 grant。业务 pool
与报告 reader 保持独立，专用连接上额外业务／报告权限会拒绝。
受限内建函数的 PUBLIC EXECUTE 与 PostgreSQL 记录的
[初始权限](https://www.postgresql.org/docs/16/catalog-pg-init-privs.html) 比较，
不使用宽松的函数默认 ACL。挑战不是维护锁，也不构成发布批准。

PUBLIC definer 的审计比较 owner 相对 reader 在各应用 schema 的有效能力：
表及逐列权限、sequence 权限、CREATE 和额外函数 EXECUTE。低权 owner 仍可能
委托私有 inner function 或 sequence，不能通过解析 SQL 函数体证明安全。
没有额外 owner 能力的 definer 不会仅因 definer 身份被拒绝。有效数据库
CREATE（包括 PUBLIC）会拒绝，普通数据库 CONNECT/TEMP 保持原状。

`createP12Activation` 必须接入真实目标 owner。`installTarget(attemptId)`
把 P12 效果安装到既有 `runCatalogReleaseAction` 目标端口，不提供 CLI、
默认目标、环境变量批准或通用 SQL 执行器。目标 owner 生产 artifact、存储、
subject、恢复点和隔离事实；输入是实际管理观测，不能从报告反填 pins。
私有 SQL 效果通过正式 Report 服务重新读取批准。此处的域内检查不替代
既有发布入口的完整 purpose、适用性、lineage 和批准合同。

## 稳定 epoch 与观测

`prepareEpoch` 是显式管理写入。epoch 确定性绑定真实目标、run/source/plan、
完整当前 mapping heads 与 versions、完整 public 源库存摘要和 P0–P10
checkpoint 摘要。缺失或悬空 head 会拒绝；新增 head/version 使旧 epoch
失效，源快照变化会拒绝。Archive、Catalog 或 migration 的变化独立影响报告
适用性，不重定义 mapping 身份。生成 epoch 不是批准，也不重写历史 P7。

`inspect` 只读，不生成 epoch，不修 checkpoint。它要求真正的受控 P0–P10
路径，包括 P0 源库存、P2/P3 恢复边界与 P4 管理 receipt；旧版只有布尔标记
的测试 checkpoint 不符合条件。管理事实和 Kernel materialization 在真实
维护边界下独立读取并复核。

报告 database `targetIdentity` 使用实际 `{systemIdentifier,databaseOid}`
的规范摘要，`schemaVersion` 使用最后一个实际打包的 migration 文件名，
全量 filename/checksum 库存另行绑定。这是本 producer 的序列化合同，
不新增权限，也不另造 Verification schema。

## CAS 与中断

CAS 前先持久化 attempt。效果拥有 SERIALIZABLE 事务、既有 Cutover
advisory lock、run/pointer 行锁和 mapping/Catalog 表锁；关键写入及提交前
复核实际事实与 owner 边界。一个事务完成 legacy→canonical、generation
递增、P12 event/checkpoint 和 applied attempt；不修改 P5 指针。
任何 advisory、行锁或表锁之前都先检查实际管理数据库身份；错误数据库
在访问其 activation 对象前拒绝。

提交结果未知时销毁连接，保留持久 attempt 供检查，不自动重试、重置 journal、
回退指针或恢复流量。源事实后续漂移时仍可调用 `inspectAttempt` 读取 pointer、
attempt、P12 checkpoint 和 event。只有一致的原子记录返回 applied；
pending、missing 和 inconsistent 分别报告。applied 仅证明效果已提交，
不是新的发布授权，下一步由父 controller 按合同执行。

`inspectAppliedBinding` 在同一只读事务内核对 pointer、attempt、checkpoint、
event 并重新计算 request digest 后，才返回持久 binding。P13/startup
producer 通过此管理公共入口获取历史 P12 事实，仍需重新观测自身当前状态
并获得适用批准；它不把历史激活事实解释为当前运行授权。

## R3 威胁与验收责任

| 威胁 | 预期与责任 |
| --- | --- |
| 缺 owner、空库存、错误 attempt、直接调用效果 | 访问数据库前拒绝；纯准入测试 |
| 旧 schema、缺 release、不完整 P0–P10、布尔准备 | 不生成 epoch、不 CAS；真实 PG |
| 源、mapping、migration、artifact、目标漂移 | 不复用旧报告；组件与父集成 |
| 错 purpose、缺报告、未批、跨 subject | 正式 Report 与既有发布入口拒绝 |
| 并发、锁丢失、未知提交 | 一次原子效果或保留 pending；真实 PG 故障测试 |
| reader 指向别库或混合端点 | 每次实际 checkout 独立核验目标；数据库基础层接线 |
| reader 获得 SET/ADMIN、额外角色、直接 ACL、PUBLIC CREATE 或高权函数委托 | session 挑战前拒绝；专用 LOGIN 回归 |
| reader/PUBLIC 访问 activation 元数据 | 拒绝；真实受限 LOGIN 测试 |
| P12 之后直接请求候选启动或公开效果 | 此分片未安装后续效果，拒绝 |

## 证据与文档影响

当前是 Scratch。纯准入测试、迁移文本检查不等于真实 SQL 激活证据。
较早 5 个真实 PG16 组件用例只证明当时字节上的 schema 保留、受限 Kernel
读取、连接目标挑战和缺 run／高权登录拒绝，不证明 P12 CAS 成功。后续 owned
`activation-pg16` 于 2026-09-07 13:06:26 +08:00 执行，16 收集／16 通过／
0 失败／0 跳过，exit 0，覆盖十个真实 LOGIN 漂移反例和错误管理数据库。
使用 PG16 Alpine 合成库并验证清理，不是真实备份副本。这次执行是
`04590b69a` 上的未提交 Scratch 字节；父证据需要通过文件 hash 绑定后续提交，
不能重标为提交后执行。实际 P11 报告与批准、根进程及完整 controller
仍是独立集成证据。本组件不能单独提供生产运行命令，也不能用
报告测试的恒定 `passingAdapters` 冒充合法 P11。

后续 owner 委托审查使用同一 owned PG16 lane：2026-09-07 13:21:40 +08:00
旧审计对五个新增危险条件都错误放行，22 收集／17 通过／5 失败／0 跳过，
exit 1。修复能力差额比较及有效数据库 CREATE 后，13:22:30 执行得到
22／22 通过、0 跳过、exit 0，包括没有额外能力的 definer 正例。两轮都验证
了隔离资源清理；均未执行或证明 P12 激活。

| 文档／文件 | 更新责任 |
| --- | --- |
| 本合同及英文伴随文件 | activation 分片 |
| migration 库存与生成 schema | 父协调者集成后用既有生成器更新 |
| 增量计划、证据与终端手册 | 父协调者维护同一套双语记录 |
| runtime、worker、controller 共享文件 | 父协调者；本分片不修改 |

纯测试使用 `node_modules/.bin/vitest run --config
server/modules/catalog-cutover/activation/vitest.config.ts`。真实 SQL 用例只在
既有独占 upgrade-component lane 执行，不使用 ambient `DATABASE_URL`。
本分片不授权任何生产或真实备份操作。
