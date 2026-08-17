# 归属治理 follow-up（版本切换、身份映射 UI、诚实收口）

> 英文：[English](../../../exec-plans/completed/2026-07-31-attribution-governance-follow-up.md)  
> 状态：**已完成（实现已合入）**。PR7–PR9 经 #215 合入。D-AG-01–04 **已于 2026-08-01 锁定**并交付，见 [`2026-08-01-attribution-deferred-implementation.md`](./2026-08-01-attribution-deferred-implementation.md)。残留收口见 [`2026-08-01-governance-platform-closeout.md`](./2026-08-01-governance-platform-closeout.md)（#216）。  
> 续作：[`2026-07-30-attribution-subjects-and-versioned-specs.md`](../../../exec-plans/completed/2026-07-30-attribution-subjects-and-versioned-specs.md)（PR0–PR6）  
> 待讨论（已锁定）：[`docs/zh-CN/design-docs/2026-07-31-attribution-governance-deferred-questions.md`](../../design-docs/2026-07-31-attribution-governance-deferred-questions.md)

## 目标

把 PR0–PR6 之后**方案已锁定**的缺口做完，不重开仍需细辩的项。

## 批次

| 批次 | 主题 | 状态 |
| --- | --- | --- |
| PR7 | 有 tip binding 的版本 cutover：finalize HTTP + Admin「影响 → 确认切换」 | done |
| PR8 | 身份映射 UI：`new_identity` / `confirmAllCandidates`；singleton 仅说明+引导 | done |
| PR9 | 短 toast；软废弃默认离开库/评审不可选；claim 仅 overlay；定义库主展示归属主体；性质/基数只读 | done |

## 明确不纳入

驱动性质/基数**编辑**、pinned-schema claim、TD-047 回填强制、TD-046 Admin 放置规则 → 见 deferred 文档。开合 GitHub PR 属发布流程。

细节、任务勾选、文档门禁与验证命令以英文计划为准。
