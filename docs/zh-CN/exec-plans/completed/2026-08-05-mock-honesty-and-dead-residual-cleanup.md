# Mock 诚实化与死残件清理（C4）

> Status: **已于 2026-08-17 完成** — 已合入 `main`（C4）。
> Date: 2026-08-05
> English: [`docs/exec-plans/completed/2026-08-05-mock-honesty-and-dead-residual-cleanup.md`](../../../exec-plans/completed/2026-08-05-mock-honesty-and-dead-residual-cleanup.md)
> 上位：[`2026-08-05-path-reachable-mock-gap-program.md`](./2026-08-05-path-reachable-mock-gap-program.md)

## 目标

让 mock 模式参数导入**诚实**（真实 apply 或明确失败），并删除产品路径不用的死残件：未接线的 `AI_FEEDBACK`、已 DROP 表对应的 admin `reload-bindings` 契约。

## 锁定决策

1. Mock 导入经 mock repository apply，禁止仅 toast 的 `IMPORT_PARAMETERS`。
2. 删除 `AI_FEEDBACK` / `aiFeedback` 及单测。
3. 从 `routeManifest` 与 `debuggingAdminClient` 移除 reload-bindings；保留运行时 reload **410 GONE**。

## 交付批次（摘要）

1. 诚实 mock 导入 + 测试  
2. 删除 AI_FEEDBACK  
3. 清理 reload-bindings 契约与孤儿组件  
4. 验证与文档门禁  

分支：`feat/mock-honesty-dead-residual-cleanup`。完整任务与矩阵见英文计划。
