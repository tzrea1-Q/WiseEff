# 启动发布记录持久化

[English](startupPublication.README.md)

本组件属于组合根，落实既有宿主 append-only journal 的启动发布记录职责。
它不执行 P13、不批准 runtime 报告、不启动 API/worker、不放行流量，也不提供
运行端 `StartupTarget`。没有 SQL schema、grant、报告 codec 或 P0–P10 阶段变更。

## 实际接口

`prepareStartupPublication({journal, lock, activation})` 核验真实同目录宿主锁和
完整持久 journal，读取精确 committed/reconciled activation intent，调用正式
`createApplicationReadActivation().inspect`，再通过
`createVerificationReportService().readReport` 读取原 pre-activation 报告。

当前没有完整 P13 producer。现有前提满足后，该函数仍返回明确的
`p13-producer-unavailable`，不能写 pending publication。它不接受调用者传入的
boundary、passed、retired 布尔、新 verifier 或环境 pins。低层登录退出、bootstrap
密码轮换都不是完整 P13 证据。

`openStartupPublicationStorage` 与 `ActivationJournal` 一样是低层持久 adapter。
`pending(intent)`、`committed(intentDigest)`、`unknown(intentDigest)` 和
`inspect({attemptId,intentDigest})` 只负责保存及读取记录。输入不证明批准，运行端
没有接入该接口。读回明确标记 `scope: publication-storage-only`，committed 也不
等于启动就绪。

## 记录与生命周期

intent 分别绑定 host/Cutover run、attempt、实际 target、activation binding digest、
原有完整 isolated `StartupBoundary`、明确 predecessor 及重算的宿主 digest。
字段集合精确校验，拒绝缺项和附加字段。报告及 activation 的内部摘要继续使用
各自 codec，不把宿主摘要当作原报告摘要。

`generation` 仅是一个 host journal 内的正整数序列，**不是** P13 owner 尚待发行的
`runtimePinGeneration`，也不是跨 host journal 的目标全局 head。跨 run 发布仍需
组合根实现真实的唯一 head 协议。

只有 pending 可转 committed/unknown。确认必须来自同 adapter 已发行的精确 intent，
新进程不能补造确认。后继要求明确 committed predecessor、连续序列、同 target 和
未用过的 attempt。旧 generation 不能重放覆盖新 pending。每次操作比较完整 journal，
不只比较调用者声明的摘要，并在 await 期间保持原目录 FD。

复用既有文件写入/fsync、rename 和目录 fsync。目录同步失败保留 write-lock 和未知
状态；已改名的字节仅供诊断。本片不删锁、不自动重试，也不把 unknown 改成 committed。
仍需真实 P13/publication owner 接入当前状态 reconcile；历史 committed 读回不是它。

## 测试与后续真实来源

纯 Node 入口为现有无数据库 global setup 的 `vitest.scripts.config.ts` 下
`startupPublication.test.ts`。测试使用真实 FS journal、真实宿主锁、真实目录 FD 的
fsync 故障注入，以及在 pending/committed 落盘后被终止的独立 Node 进程。
构造 boundary 仅是**存储夹具**，没有 passed 报告或完整 P13；不能据此声称 PG、Docker
或启动正向成功。

父组合根仍负责完整 writer/route/job/trigger/privilege 退出、不可变 P13 指纹与 runtime
generation、新完整 post-retirement 验证及独立批准、独立完整 pins、目标全局发布选择、
当前状态 reconcile，以及运行端只读传输。已发布重启需要在正常业务继续时保护元数据，
不能复用停服维护边界或携带管理凭据。S6 和 Policy #815 是分开的决定。
