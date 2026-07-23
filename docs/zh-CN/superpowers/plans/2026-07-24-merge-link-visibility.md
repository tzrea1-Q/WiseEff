# 软件合入后合入链接可见性 — 实现计划摘要

> English: [`docs/superpowers/plans/2026-07-24-merge-link-visibility.md`](../../../superpowers/plans/2026-07-24-merge-link-visibility.md)  
> 设计：[`docs/zh-CN/superpowers/specs/2026-07-24-merge-link-visibility-design.md`](../specs/2026-07-24-merge-link-visibility-design.md)

**目标：** 「已合入」且 `reviewerNote` 为合法合入链接时，在审阅详情同时展示独立「合入链接」卡片与流程时间线可点击外链。

**分支：** 继续 `feat/merge-link-required`（仅前端展示；无 API 变更）。

**任务：**

1. `App.test.tsx` 先写失败用例（正例双链接 + 负例不展示）
2. `App.tsx` / `styles.css`：`body: ReactNode`、卡片、时间线锚点、去掉待合入纯文本注入
3. 原型规格 EN/ZH、`docs:check`、playwright 三视口验证
