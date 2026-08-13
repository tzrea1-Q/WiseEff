# WiseEff Agent 指南

> English: [English](../../../AGENTS.md)

这是核心入口文档，帮助开发者理解仓库地图、运行模式、治理规则和下一步阅读路径。

## 使用方式

- 本页和英文版是相互链接的独立文档；不要在同一篇文档里混写中文和英文正文。
- 命令、路径、环境变量、API 路径、角色名、状态名和脚本名称保持英文原样，避免复制时出错。
- 修改相关功能时，请同时更新英文版和中文版；如果只更新一侧，`npm run docs:check` 应阻止完成。
- 若中文页与源码、测试或英文页冲突，以源码、测试和当前英文页为准，并在同一变更中修正中文页。

## 关键阅读点

- 先确认该文档属于哪个决策面：core。
- 阅读英文版中的完整细节、表格和命令，再用本页确认中文语境下的执行边界。
- 任何 target-environment readiness、pilot-ready、release-ready 结论都必须有真实目标环境证据，不能由本地 skip 代替。
- 表格列多选筛选复用 `ColumnFilter`：见 [表格列多选筛选 UX](../design-docs/ux-table-column-filter.md)。
- 前端视觉与交互标准见 [UI 设计系统](../design-docs/ui-design-system.md)；前端可见变更的完成门禁见 [UI 质量检查清单](../developer/ui-quality-checklist.md)。

## Agent skills

Agent 编排使用 **Matt Pocock skills**（如 `implement`、`tdd`、`to-spec`、`triage`）与 `docs/agents/*`。不要新建/更新 `docs/superpowers/**`，也不要调用 `superpowers:*`。进行中实现跟踪仍以 `docs/exec-plans/active/` 为准。完整说明见英文 [`AGENTS.md`](../../../AGENTS.md) § Agent skills 与 [`docs/agents/`](../../../docs/agents/)。并行多会话（多个 worktree 持续合入 `main`）遵循 `docs/agents/fleet-coordination.md`：main 红灯先认领再修、ADR/迁移/TD 编号在合入时重查、每次 rebase 后跑类型检查与受影响测试。

## 同类中文文档

- [docs/zh-CN/root/AGENTS.md](AGENTS.md)
- [docs/zh-CN/root/README.md](README.md)
- [docs/zh-CN/root/CONTRIBUTING.md](CONTRIBUTING.md)
- [docs/zh-CN/root/ARCHITECTURE.md](ARCHITECTURE.md)
- [docs/zh-CN/README.md](../README.md)
- [docs/zh-CN/frontend.md](../frontend.md)
- [docs/zh-CN/PLANS.md](../PLANS.md)
- [docs/zh-CN/QUALITY_SCORE.md](../QUALITY_SCORE.md)
