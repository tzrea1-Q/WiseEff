# 复用既有存储的应用读切换

[English](README.md)

这是 PR #824 尚未完成的 Scratch 实现。它只使用 0137 已有的 Cutover run、
不可变 event 和 checkpoint，不新增表、迁移或权限，不改变原 P0–P10 接口
允许的阶段。应用读 binding 与 P5 Catalog 指针分别记录。尚未证明真实
API／worker 启动或完整 controller 升级成功。

公开工厂为 `createApplicationReadActivation`。父 controller 提供独立观测
的物理目标、既有受限 NOINHERIT 管理登录、独立报告读取连接、实际源与流量
边界以及持久宿主 journal。父调用必须经过既有 `runCatalogReleaseAction`。
领域模块不导入脚本、不另造 verifier。

| 命令 | 输入与作用 | 输出／拒绝边界 |
| --- | --- | --- |
| `inspectFacts` | 精确 run／plan；管理只读事务 | 实测 Catalog、完整 mapping 库存、当前 binding；未准备 epoch 返回 null |
| `prepareMappingEpoch` | 显式管理写入及持有的停写边界 | 追加不可变 P11 `activation-mapping-epoch` 准备事件；不是 P11 验证 checkpoint 或批准 |
| `inspect` | 精确 typed intent | 仅当 binding 仍是唯一当前 head 且实测源／mapping／Catalog 一致时返回 applied；否则返回精确 not-applied 或拒绝 |
| `inspectOnHeldManagementSession` | 精确 intent 与 P13 owner 实际持有的管理连接 | 核对同一物理目标、身份、UTC、强事务隔离和真实 Exclusive S7 锁；不再另取连接，读取同一当前 binding |
| `apply` | typed intent、正式获批预激活报告、实际 Comparison artifact 及当前目标观测 | 在 journal pending 和 SQL 前执行正式批准 projection 和九个 gate 的精确关联；缺失、不相关或变化的证据拒绝 |

epoch 由 UTC 下按 C 排序的完整 mapping head／version／identity、全部历史
mapping versions、物理目标、run、plan、源快照共同计算。缺 identity、head
或所引用 version 均拒绝，不能当作零库存。inspect 不写入 epoch；库存变化
使旧 epoch 失效，只有显式 prepare 才记录新观测。准备不等于批准源或映射变化。

intent 固定 run、attempt、物理目标、plan、显式 predecessor、报告选择及预期
观测摘要，统一使用 `sha256:` 格式，与宿主 typed journal 对齐。领域 run
不冒充宿主升级 run。全数据库以明确 predecessor 组成唯一链，不通过时间或
latest 行选择指针。既有 `(run, P12)` 主键意味着每个 run 只提交一次 activation。

私有 SQL effect 在一个事务内更新 run 进度并追加 P12 event／checkpoint。
回滚不留下 binding。父 controller 必须先持久记录 pending，再发送 SQL；
只有收到提交确认才能记录 committed。丢失确认必须正式 inspect 并通过
宿主 journal reconcile，不能清空 journal 或盲目重试。读到 binding 不构成
报告批准、运行准入或流量许可。

同会话 inspector 以随机名称的 `SAVEPOINT`／`RELEASE SAVEPOINT` 核验事务已存在。
这属于局部事务控制作用；方法不开始或提交事务，不切角色、不写业务数据、不执行
DDL。自动提交和 aborted 事务均拒绝。P13 owner 持续负责管理连接和实际源边界。
Kernel 仍自行管理事务，本方法不接收 Kernel 事务。普通 inspector 保留独立连接和
原有锁语义。

父组合根从实际 comparison execution 的 `readEvidence().report` 提供
`comparisonReport`，工厂固定其字节。正式获批报告 projection 通过后，
`assertComparisonEvidenceAssociation` 核对原 Comparison checksum、九个
gate envelope、result 和 typed ref，返回摘要还须等于独立观测值。
这项接线尚未产生一次正式获批的公开 `apply` 成功执行；真实完整 consumer
producer、有效权限门禁和批准仍不可缺少。报告形状的对象不能绕过这些条件。

只读 inspection 不初始化 Comparison 消费者模块。`apply` 核验获批报告时加载原有
Comparison 公共 projection，位置仍在任何 pending journal 记录或 SQL 效果之前。
本次只改变模块加载时机，不移除批准检查，也不把检查延迟到副作用之后。

| R3 威胁 | 防线／必需证据 |
| --- | --- |
| 错误物理数据库 | 同一管理 session 在任何目标锁之前和完成之前核对身份 |
| 并发 controller／过期快照 | 先取得原 S7 session advisory lock，再建立一致快照 |
| 不参与 advisory lock 的 mapping／installer 写入 | 管理写阶段对既有可变 Catalog／mapping 库存表持 SHARE 锁 |
| 输入、源、mapping、报告、predecessor 漂移 | 固定 intent／双观测、完整库存、唯一当前链、正式报告 projection |
| 部分提交／进程失败 | 原 0137 原子写、静态 unknown、持久 pending 与显式回读 reconcile |
| 任意调用者摘要冒充批准 | 正式报告批准 projection 和 Comparison artifact／九个 gate 精确关联；缺证据拒绝 |
| 私有错误泄露／连接泄漏 | 静态错误、同步监听管理连接错误、销毁连接、保留原拒绝 |

Documentation Impact 仅为本 README 双语对。宿主 journal、controller、发布
adapter 与操作手册由父协调者分别集成和审查。本组件没有生产执行命令。

## 已执行证据与准确范围

执行起点为 Scratch base `d7cdd6473` 加实际记录的 activation 代码：

- 公开边界轻量回归：修复前 2 通过／3 失败，修复后 5/5。
- 独占 PG16 首轮 6/6；扩展首次 7/10，三条为夹具失败：跨 identity Archive
  外键拒绝、后续 replay、缺真实源行。修正后扩展轮 10/10、10.68 秒、零跳过，
  owned cleanup 已核验。
- 使用真实旧 `82344044…` schema 与非空归档定义执行原 P0–P10。旧 no-Binding
  P2 的布尔输出不是生产停写证明；本分片不覆盖完整 Binding 转换。
- 实际受限管理与报告读取登录覆盖 epoch／inspect、锁竞争、缺报告拒绝及
  SQL 持久化。私有 SQL 测试明确使用未获批引用，不调用公开 apply，不产生
  发布批准，也不授权启动；没有插入或 mock passed 报告。
- 使用实测合成源字节摘要经过正式 mapping owner 追加版本，证明旧 epoch
  随库存变化失效，不证明旧源计划重新适用。
- 隔离执行器 `scripts/run-upgrade-component-tests.ts` 的 selector 为
  `activation-existing-pg16`，必须经过既有 daemon 准入和 owned-cluster receipt，
  不回退到 ambient DATABASE_URL。

新增独占 PG16 观察通过真实 0139 SELECT-only 登录与 READ ONLY 事务执行现有
P01／P02。受控管理成员存在时 P01 失败，仅撤销该测试成员后 P01 通过；P02
两边均通过，但 P01 的七次、P02 的九次角色切换全部先返回 `42501`，没有进入
原本要验证的 writer 身份。这是既有 verifier 合同冲突的实测归因，不是实际
writer 权限验收通过。测试恢复管理成员原选项，不增加 verifier grant，
不修改历史 gate 实现。

仍属内部实现的工作：真实报告与独立 principal 批准链、释放 lease／跨 run／分叉故障扩展、实际应用
读模式消费、宿主 journal reconcile 接线，以及完整 controller／API／worker
正向。真实备份、企业网络与生产授权分别属于外部证据；它们不阻止继续内部实现。
