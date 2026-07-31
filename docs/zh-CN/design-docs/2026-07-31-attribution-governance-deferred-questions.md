# 归属治理 — 待讨论问题

> 英文：[English](../../design-docs/2026-07-31-attribution-governance-deferred-questions.md)  
> 日期：2026-07-31  
> 状态：开放，待后续 grilling  
> 已锁定工作见：[follow-up 计划](../exec-plans/active/2026-07-31-attribution-governance-follow-up.md)

2026-07-31 grill-with-docs 已审阅下列项；**在再次 grilling 锁死答案前，不排进 follow-up 实现批次**。

## D-AG-01 — 编辑驱动性质与实例基数

**背景：** `DriverRegistration` 已有 `driverNature` / `instanceCardinality`；默认物理 + 可多实例。Follow-up PR9 只做**只读**展示。

**待辩：** 谁可改；改为 singleton 后已有多实例项目如何处置；是否与阻断任务同步重算；是否与 `node-type` 模块混淆。

**未锁定前不做：** 任何修改 API 或 Admin 编辑控件。

## D-AG-02 — 第二种 coverage claim（`pinned-schema-property`）

**背景：** 运行时只接受 `overlay-property`；PR9 对外合同诚实收口为仅 overlay。

**待辩：** pinned 是否一等公民；org vs platform 所有权；与 overlay 晋级关系；是否每次后继激活都要 claim。

## D-AG-03 — `driverModule` 字符串 vs 归属主体（TD-047）

**背景：** PR9 只把 UI 主展示改成归属主体，不和解存储。

**待辩：** 是否回填/废弃列；不一致时是否阻断激活；overlay/导入如何呈现冲突。TD-047 保持开放。

## D-AG-04 — 业务分类启发式（TD-046）

**背景：** `businessCategoryForNodePath` 关键词路由。整项待讨论；TD-046 保持开放；不排进 follow-up 计划。

## 明确不是领域待讨论

- PR0–PR6 的 GitHub 开合与 acceptance 证据：发布流程。  
- 仅为减肥拆 `parameter-specs/service.ts`：工程债，除非批次碰到该文件。
