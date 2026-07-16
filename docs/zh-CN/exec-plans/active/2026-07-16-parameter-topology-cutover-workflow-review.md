# 参数拓扑 Cutover 工作流 Review 修复计划

> English: [English](../../../exec-plans/active/2026-07-16-parameter-topology-cutover-workflow-review.md)
> 前序: [e2e review blockers](./2026-07-16-parameter-topology-e2e-review-blockers.md)
> 设计: [面向拓扑与 Schema 的参数精细化管理](../../superpowers/specs/2026-07-16-parameter-topology-schema-management-design.md)

**目标：** 使 cutover 后活动业务完全运行在语义身份上（binding / spec / occurrence / binding revision），并补齐精确 occurrence 回写、规格审核真正落地、candidate/validation fail-closed 状态机、诚实的迁移报告、可复用身份连续性、真实前端 provenance，以及禁止用直接改库伪装成功的验收。

**分支：** `fix/parameter-topology-cutover-workflow-review`（从 `main` 创建并 merge `fix/parameter-topology-e2e-review-blockers`，不 squash）。

**成功标准 / 任务阶段 / 风险回滚 / Documentation Impact Matrix / Verification：** 以英文计划正文为准。中英文成对维护。

**硬性声明：** 无干净非客户快照整库演练时，**TD-042 仍为 BLOCKER**，不得宣称 production cutover ready。不得 push / 开 PR。

**文档门禁（与英文计划同步）：** EN+zh-CN api-contract / domain-model / FRONTEND / cutover runbook / verification-matrix / tech-debt 已对齐；`legacyDependencyGuard` 记为 Vitest 源码扫描（非运行时中间件）；拓扑验收证据目录与 Playwright `outputDir` 分离。计划保持 active 至父代理 review。
