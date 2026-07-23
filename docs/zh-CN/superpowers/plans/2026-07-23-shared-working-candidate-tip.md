# 本轮草稿共用工作 tip — 实现计划摘要

> 英文完整计划：[`docs/superpowers/plans/2026-07-23-shared-working-candidate-tip.md`](../../../superpowers/plans/2026-07-23-shared-working-candidate-tip.md)  
> 设计：[`../specs/2026-07-23-shared-working-candidate-tip-design.md`](../specs/2026-07-23-shared-working-candidate-tip-design.md)

**目标：** 同一用户×项目下未提交类型化草稿共用一个工作 tip；连续改多个参数可批量「提交审核」，不再出现 `candidate revision` 类拦截。

**分支：** `feat/shared-working-candidate-tip`

## 任务

| ID | 内容 |
|----|------|
| 1 | repository：列出未提交 binding 草稿 + rebase candidate 指针 |
| 2 | `createBindingDraft`：tip 门禁、创建后推进兄弟草稿、响应 `workingCandidateRevisionId` / `rebasedDraftIds` |
| 3 | `submitParameterChanges`：一批必须同一 tip，否则 409 中文文案 |
| 4 | 前端 ports/client/工作区/托盘：对齐 tip、健康文案「本轮 N 项 · 同一工作版本」 |
| 5 | 更新 `docs/FRONTEND.md` + `docs/zh-CN/frontend.md`，跑 `npm run docs:check` |
| 6 | 服务端/前端测试、`npm run build`、浏览器冒烟 |

按英文计划 checkbox 逐步执行（TDD）；提交信息见各 Task Step。实现子代理只在功能分支提交，不由子代理开/合 PR。
