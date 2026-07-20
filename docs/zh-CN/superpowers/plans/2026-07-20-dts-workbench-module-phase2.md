# DTS 工作台模块化阶段二 — 实施计划摘要（中文）

> 英文完整计划：[English](../../../superpowers/plans/2026-07-20-dts-workbench-module-phase2.md)  
> 设计：[阶段二设计](../specs/2026-07-20-dts-workbench-module-phase2-design.md)

## 目标

binding 物化 `module_id`、切换唯一键、重种子、显式重算、真实历史/跨项目对比；**无兼容层**。

## 任务一览

| Task | 内容 |
|------|------|
| 1 | 迁移 `0067`：`module_id` + 新 unique |
| 2 | `createOrReuseBinding` 持久化 `module_id` |
| 3 | DTO/前端以 DB `moduleId` 为真相源 |
| 4 | 重写种子 |
| 5 | Admin `recompute-bindings` API + UI |
| 6 | History API + 详情接线 |
| 7 | Compare API + 详情接线 |
| 8 | 文档 / e2e / 浏览器验证 |

执行方式见英文计划文末选项（Subagent-Driven / Inline）。
