# Activation 宿主日志

English: [English](activationJournal.README.md)

`activationJournal.ts` 实现复用既有 schema 的 Cutover activation 公共端口：
`pending(intent)`、`committed(binding)`、`unknown(intent)`。独立的 `activation`
日志字段不会将 BindingPhase 扩展到 P0–P10 之外，也不增加 SQL、schema、grant、
报告批准、运行启动、队列或流量操作。

父 controller 必须传入真正已签发的宿主／目标边界核验和正式 activation 模块的
`inspect`。它们是组合根中的代码依赖，不能来自 JSON 配置、环境 receipt 或操作者
声称已经成功的布尔值。controller 在每次调用期间持续持有真实维护边界。本适配器
不获取 PostgreSQL 锁，也不替代领域模块对 checkpoint、event、run、head 和当前状态
的完整观察。

## 持久化合同

- 宿主日志 run 与 Cutover run 是不同身份。既有日志必须先绑定 `cutoverRunId`；
  activation 字段另行绑定精确宿主 run，以及实测数据库 system identifier／OID。
- intent 固定 attempt、plan、前驱 binding、批准报告引用、预期观察摘要和规范化输入
  摘要。日志中出现报告引用，不证明该报告已获批准。
- `pending` 持久化成功后才返回领域层。只有该适配器实例能够在 SQL 提交之后确认
  完全一致的 binding；新实例必须执行检查，不能用 `committed` 提升旧 pending。
- pending 或 unknown 阻止其他 attempt。普通确认不能将 unknown 改为 committed。
  `reconcile()` 调用注入的正式回读，只接受当前完整 applied binding，或者 current
  head 与原前驱一致的精确 not-applied 观察。
- not-applied 只登记结果已查明，不重试 SQL。后续显式调用需要新 attempt。
  committed／reconciled 的 run 不再重复激活。完全一致的确认可重放且不追加记录。
- 每次写入复用既有完整记录 CAS、文件系统独占写锁、文件 fsync、原子 rename 和父
  目录 fsync。持久化结果不确定时保留写锁。JSON 截断、漂移、缺字段和类型错误均
  拒绝。诊断读取不授权实际动作。
- activation 元数据不能改变 controller 阶段、下一动作、plan、Cutover 身份、
  verification pins 或失败状态。调用者提供的摘要不能代替 typed event 及其不可变前驱。

## R3 威胁与验证范围

| 威胁 | 永久回归观察 |
| --- | --- |
| 缺少 intent、跨 run／目标、字段或 binding 摘要错误 | 确认前拒绝，文件字节不变 |
| pending／unknown 重用、新进程或并发调用 | 不允许第二次执行准入，要求显式检查 |
| 宿主锁丢失、文件锁残留、日志截断 | 不追加终态，不自动重试 |
| 回读过时、错配、变异或日志改变 | 完整 binding／head／intent 与全记录 CAS 拒绝结果登记 |
| rename 后目录 fsync 失败 | pending 仅可诊断，保留持久化锁 |
| 异常含私有信息 | 固定返回 `PCAT-UPG-ACTIVATION-JOURNAL-REFUSED` |

使用仓库的 scripts Vitest 配置运行两个 focused 文件。测试使用真实私有临时日志文件
和合成领域回读，不证明 PostgreSQL 提交、完整 P12／P13、运行启动或 controller
验收通过。测试注入的领域端口不冒充真实数据库证据。父协调者还须独立接入并验证正式
领域回读及受控目标，才能声明该边界通过。

本模块没有生产执行命令。日志持久化成功既不是运行批准，也不是公开发布许可。
