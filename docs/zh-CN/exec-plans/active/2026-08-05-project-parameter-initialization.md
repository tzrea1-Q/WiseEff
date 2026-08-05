# 项目参数初始化 · 语义落地（C1）

> Status: **实现完成（分支上）** — 待 parent PR/合并；**TD-060** 已关
> Date: 2026-08-05
> English: [`docs/exec-plans/active/2026-08-05-project-parameter-initialization.md`](../../../exec-plans/active/2026-08-05-project-parameter-initialization.md)
> 上位：[`2026-08-05-path-reachable-mock-gap-program.md`](./2026-08-05-path-reachable-mock-gap-program.md)
> 跟踪：**TD-060**
> 设计（须先修订）：[`docs/design-docs/2026-05-20-project-parameter-initialization-design.md`](../../../design-docs/2026-05-20-project-parameter-initialization-design.md)

## 目标

将项目参数初始化落地为真实 API + DB：选源项目 → 语义 binding 快照 → 提交审阅 → Admin 通过/驳回 → 解锁常规参数工作流。当前向导与 reducer 路径可达但无后端表与路由。

## 锁定决策

1. **先修订** 2026-05-20 设计：快照项改为 binding/spec/有效值语义身份，禁止以扁平 `recommendedValue` 为 API 写模型。  
2. 批准时在目标项目物化 bindings；不把源项目设备测量值当作已在新项目测得。  
3. 未 `initialized` 前锁定常规 typed binding 提交。  
4. 前端走 Port/HTTP；mock 实现同一契约。  

## 交付批次（摘要）

0. 设计修订（阻断后续编码）  
1. Migration + API + 审计  
2. Port / 向导 / 审阅 Tab / 状态锁定  
3. 验收 ID 与文档门禁；关闭 TD-060  

拟增验收：`PARAM-INIT-WIZARD-001`、`PARAM-INIT-EMPTY-001`、`PARAM-INIT-REVIEW-001`、`PARAM-INIT-REJECT-001`、`PARAM-INIT-LOCK-001`。

分支：`feat/project-parameter-initialization`。细节以英文计划为准。
