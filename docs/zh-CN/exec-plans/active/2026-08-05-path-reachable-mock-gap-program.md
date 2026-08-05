# 路径可达 Mock/半通缺口纲领（A+1）

> Status: **进行中** — 仅规划产物；实现由子计划推进
> Date: 2026-08-05
> English: [`docs/exec-plans/active/2026-08-05-path-reachable-mock-gap-program.md`](../../../exec-plans/active/2026-08-05-path-reachable-mock-gap-program.md)

## 目标

关闭参数管理与参数调试中**路径仍可达**、但仅 mock 或半通（缺耐久后端/DB 与/或 API 模式 UI 闭环）的缺口；不恢复产品下线面。

## 范围摘要

| ID | 缺口 | 子计划 | 分支 |
| --- | --- | --- | --- |
| C4 | Mock 导入假成功 + 死残件 | `2026-08-05-mock-honesty-and-dead-residual-cleanup.md` | `feat/mock-honesty-dead-residual-cleanup` |
| C2 | 节点调试 UI 闭环（关 TD-015） | `2026-08-05-node-debugging-ui-closure.md` | `feat/node-debugging-ui-closure` |
| C3 | Admin 本地 audit hints | `2026-08-05-parameter-admin-audit-hints.md` | `feat/parameter-admin-audit-hints` |
| C1 | 项目参数初始化 | `2026-08-05-project-parameter-initialization.md` | `feat/project-parameter-initialization` |

**排除：** `/debugging`、reload 410、`/parameter-comparison`、Vite 本机 HDC 桥。

## 已锁定决策

1. 初始化 = **语义 binding 快照**（禁止 API 模式以扁平 recommendedValue 为真相）。
2. 调试运行时入口仅 `/node-debugging`。
3. 高风险写必须人确认（runtime 不得静默注入 confirmation token）。
4. Admin hints = **审计中心投影**（不建第二套审计存储）。
5. Mock 导入必须改数据或诚实失败。

## 建议顺序

C4 ∥ C2 → C3 → C1。总纲领不开大分支；各子计划独立从 `main` 开分支。

任务勾选、文档影响矩阵与验证命令以英文计划为准。纲领收尾跑 `npm run docs:check`，四子计划全部完成后移入 `completed/`。
