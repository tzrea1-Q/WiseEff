# 节点调试 UI 闭环（C2 / TD-015）

> Status: **已于 2026-08-17 完成** — 已合入 `main`。关闭 **TD-015**。
> Date: 2026-08-05
> English: [`docs/exec-plans/completed/2026-08-05-node-debugging-ui-closure.md`](../../../exec-plans/completed/2026-08-05-node-debugging-ui-closure.md)
> 上位：[`2026-08-05-path-reachable-mock-gap-program.md`](./2026-08-05-path-reachable-mock-gap-program.md)
> 关闭：**TD-015**

## 目标

在 `/node-debugging` 闭合后端已具备的产品环：

1. 写操作快照 hydrate 到可见回滚卡片与确认框  
2. 建会话后加载耐久会话事件  
3. 高风险写必须 UI 确认（去掉 runtime 静默注入 `confirmationToken`）  

## 非目标

不恢复 `/debugging`；不改 gateway 执行语义；不做 Admin 目录大改。

## 交付批次（摘要）

1. 快照 + RollbackConfirmDialog  
2. `listSessionEvents` hydrate  
3. 高风险确认 UI + runtime 去静默 token  
4. 验收 ID、关闭 TD-015、更新 FRONTEND  

拟增验收：`DEBUG-NODE-ROLLBACK-001`、`DEBUG-NODE-HISTORY-001`、`DEBUG-NODE-HIGHRISK-001`。

分支：`feat/node-debugging-ui-closure`。细节以英文计划为准。
