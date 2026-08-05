# 参数管理后台审计提示 → 审计投影（C3）

> Status: **进行中** — 仅规划
> Date: 2026-08-05
> English: [`docs/exec-plans/active/2026-08-05-parameter-admin-audit-hints.md`](../../../exec-plans/active/2026-08-05-parameter-admin-audit-hints.md)
> 上位：[`2026-08-05-path-reachable-mock-gap-program.md`](./2026-08-05-path-reachable-mock-gap-program.md)
> 跟踪：**TD-061**

## 目标

废除 `/parameter-admin` 本地 `PUSH_AUDIT_HINT` 作为审计真相源；改为审计中心事件投影。缺服务端审计的 mutation 在同 PR 补齐 `createAuditEvent`。

## 锁定决策

1. SSOT = `server/modules/audit`  
2. 不建第二套审计表  
3. 成功 mutation 后 refetch 最近事件，而非 push 本地 hint  

## 交付批次（摘要）

0. 盘点所有 `PUSH_AUDIT_HINT` 与服务端审计缺口  
1. 补齐服务端 audit  
2. UI 投影 + 删除 `PUSH_AUDIT_HINT`  
3. 验收与关闭 TD-061  

拟增验收：`PARAM-ADMIN-AUDIT-RECENT-001`（若保留可见最近条）。

分支：`feat/parameter-admin-audit-hints`。细节以英文计划为准。
