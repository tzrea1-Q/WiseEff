# 参数拓扑语义 Cutover 第三轮修复计划

> English: [English](../../../exec-plans/active/2026-07-16-parameter-topology-semantic-cutover-round3.md)

**目标：** 真实 vendor dt-schema、cutover 后语义 dashboard/hotspot、inferred 分阶段 stage→review→finalize、精确 merge 回写身份、matcher/review 作用域隔离、manifest 回填、UI 未完成规格审核、无 DB 绕过验收。

**分支：** `fix/parameter-topology-semantic-cutover-round3`（merge `fix/parameter-topology-cutover-workflow-review`，不 squash）。

**TD-042 仍为 BLOCKER**，无干净快照整库演练不得宣称 production cutover ready。

任务阶段、成功标准、风险回滚、文档矩阵与验证命令见英文计划正文。
