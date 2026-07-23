# 本地 Post-Cutover M1 种子 — 执行计划

> English: [`docs/exec-plans/active/2026-07-23-local-post-cutover-seed.md`](../../../exec-plans/active/2026-07-23-local-post-cutover-seed.md)  
> 设计：[`docs/zh-CN/superpowers/specs/2026-07-23-local-post-cutover-seed-design.md`](../../superpowers/specs/2026-07-23-local-post-cutover-seed-design.md)  
> 分支：`feat/local-post-cutover-seed`

## 目标

本地 `db:seed:m1` / `dev:all` 默认语义种子 + 本地 post-cutover，typed binding 可提交审核；生产 cutover 门禁不变。

## 任务

- [x] `localPostCutover` 与单测
- [x] M1 默认语义-only + finalize；legacy 环境变量
- [x] 中英文档与 design/exec-plan
- [x] 重建本地库验证提交；`docs:check`
- [x] CI 跟进：legacy 守卫放行 `localPostCutover.ts`；`reset:quality-runtime` 兼容 flat→legacy PPV 改名

## 文档影响矩阵

见英文计划同表（中英 local-development、FRONTEND、`.env.example`、本设计/计划；runbook 仅 Review）。

## 验证

见英文计划命令块。
