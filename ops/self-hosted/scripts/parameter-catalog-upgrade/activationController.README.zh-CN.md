# 管理阶段 P12 调度

> [English](activationController.README.md)

Scratch 显式依赖候选 `07919b498`，其祖先包含 main `cda6737a8`。
本模块只连接既有 host lock／journal、Release Verification 准入和 Cutover
Activation。不增加权限、migration、S7 阶段、启动、退休或公开发布操作。

## R3 威胁矩阵与范围

| 威胁 | 必须观察到的结果 |
| --- | --- |
| 结构伪造、错误目录、失效或被替换的 host lock | 目标观察或 journal 修改前拒绝 |
| run、plan、目标、前驱或当前观察变化 | 拒绝，不从待核报告补写当前事实 |
| 报告缺失、未批准或 purpose 错误 | 既有发布准入拒绝，不写 activation pending 或执行 SQL |
| SQL 或 host commit 中断 | 保留既有精确 pending／unknown intent，不自动重试 apply |
| 对另一 attempt 或过期 binding 做 reconcile | 既有 journal 与真实领域检查拒绝 |
| 嵌套调度或异步漂移 | 不并发执行，重新核对持有的锁及 journal |
| 命令夹带伪造字段或 owner 不可用 | 拒绝未知字段，保持固定脱敏诊断 |

测试使用真实私有 host journal 和已签发 host lock。模拟领域或报告接口的测试
明确属于适配器测试，不代表真实 PostgreSQL、已获批 P12、应用启动或完整 controller
升级。真实状态 producer 与终端接线由父协调者负责。本轮不授权生产操作。

## 调用合同

`openActivationController({journal, lock, owner})` 不重复获取 host lock。
管理根在 `withHostOperationLock` 内调用并传入精确 journal 父目录的已签发句柄。
管理 pool 和报告只读连接仍由调用根拥有，在 dispatch 结束或失败后关闭；领域模块
继续按既有合同销毁管理会话。
`owner.verify()` 核验真实资源／维护边界，必须在本动作写入 pending 以及预期 P12
改变后仍可调用。journal 与观察适用性由适配器检查；若回调把所有 pending 都视作
无关工作，会错误拒绝自己正在执行的动作。

命令只接受以下字段：

- `activate-p12`：`attemptId`、`reportDigest`。
- `inspect-activation`、`reconcile-activation`：已记录的 `attemptId`。

run 和 plan 来自已持久 host journal。物理目标及实时观察由管理 owner 提供，
不来自命令 JSON。`owner.observe()` 返回真实 `ActivationObservation`、独立观察的
P12／P13 状态，以及 comparison owner 生成的实际 `ComparisonReport`。
模块复制观察结果，使用真实 `activation.inspectFacts()` 前驱生成正式 intent，
经既有 `runCatalogReleaseAction` 与 `activation.apply` 调度。
它不会隐式准备 epoch；该管理步骤仍须显式调用领域 `prepareMappingEpoch`。

报告缺失或未批准时，返回既有准入拒绝，不写 pending。相同事实之后获得适用批准时，
同一动作实现可继续，但根必须重新观察当前状态。已经开始的 effect 则不同：
pending／unknown 阻止再次 apply。reconcile 只通过现有 activation journal 调用
领域真实 `inspect`，产生 `reconciled` 或 `not-applied`；后者不自动重试，既有 journal
要求显式后续 apply 使用新 attempt。inspect 不追加记录或修复。

owner 不可用、失锁、命令非法或 journal 失败只返回固定诊断
`PCAT-UPG-ACTIVATION-CONTROLLER-REFUSED`；普通报告拒绝保留 typed admission reason。
这些结果不授权启动、P13 或流量。文件／SQL 提交结果未知时保留 journal 待检查，不能重置。

## 当前证据边界

首次真实领域 intent 与 host journal 组合暴露了内部摘要编码不同的问题；此前独立
journal 测试并未证明领域兼容性。父协调者修复为依赖 `3c0fe1d66`
（本 Scratch 拾取为 `0b93430f7`）；host journal 外层摘要仍是独立合同。
修复前首次适配器执行为 9 通过／2 失败；扩大后的适配器测试在 `0b93430f7`
加当时尚未提交的这些文件上通过 20／20。它使用真实已签发 host lock、文件 journal
与正式 intent 摘要；正向领域 effect 和报告批准明确使用测试替身，不是实际
PostgreSQL P12 执行。本分片不修改 S6 grant、Policy 决策或生产批准。

纯适配器与持久化回归命令：

```sh
node node_modules/vitest/vitest.mjs run --config vitest.scripts.config.ts \
  ops/self-hosted/scripts/parameter-catalog-upgrade/activationController.test.ts \
  ops/self-hosted/scripts/parameter-catalog-upgrade/activationJournal.test.ts \
  ops/self-hosted/scripts/parameter-catalog-upgrade/journal.test.ts \
  ops/self-hosted/scripts/parameter-catalog-upgrade/controller.test.ts
```

执行机器为隔离开发机，目录为已准备依赖的开发 checkout。命令创建临时私有文件和
真实 host-lock 子进程，不连接数据库、不停服、不批准报告、不调用 Docker。
本模块尚未提供生产终端命令。
