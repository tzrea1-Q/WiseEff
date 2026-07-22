# 实例子模块 Seed + 驱动发现 — 实现计划摘要

> 英文完整计划：[`docs/superpowers/plans/2026-07-21-instance-submodule-seed.md`](../../../superpowers/plans/2026-07-21-instance-submodule-seed.md)  
> 设计：[`../specs/2026-07-21-instance-submodule-seed-design.md`](../specs/2026-07-21-instance-submodule-seed-design.md)

**目标：** 业务叶子 → 驱动组（U/N）→ 实例子模块；Type C 挂父；未映射进未分类 + Admin 发现队列。

**分支：** `feat/instance-submodule-seed`

## 任务

| ID | 内容 |
|----|------|
| A | 脚手架判定 + U/N/C 挂接 helper + 单测 |
| B | seed 生成模块树与 compatible→驱动组映射 |
| C | ingest ensure 实例模块 + 未分类占位 |
| D | 管理后台发现队列与一键建组 |
| E | FRONTEND 文档、docs:check、reseed、浏览器核验 |

按英文计划 checkbox 逐步执行；提交信息见各 Task Step。
