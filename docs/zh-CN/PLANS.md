# 执行计划治理

> English: [English](../PLANS.md)

这是核心入口文档，帮助开发者理解仓库地图、运行模式、治理规则和下一步阅读路径。

## 使用方式

- 本页和英文版是相互链接的独立文档；不要在同一篇文档里混写中文和英文正文。
- 命令、路径、环境变量、API 路径、角色名、状态名和脚本名称保持英文原样，避免复制时出错。
- 修改相关功能时，请同时更新英文版和中文版；如果只更新一侧，`npm run docs:check` 应阻止完成。
- 若中文页与源码、测试或英文页冲突，以源码、测试和当前英文页为准，并在同一变更中修正中文页。

## 关键阅读点

- 先确认该文档属于哪个决策面：core。
- 阅读英文版中的完整细节、表格和命令，再用本页确认中文语境下的执行边界。
- 当前活跃计划清单以英文版 `docs/PLANS.md` 为准。DTS 主程序（P0–P3.1）及 `2026-07-15-dts-full-seed-and-toolchain.md`（三项目 170 个来源参数、结构化文件/基线、真实 dtc bootstrap/CI/自托管环境）已归档；后续计划包括硬化收口与导入向导对齐。多层级模块亦已归档。
- **分支与 PR：** 实现型子智能体只在从 `main` 切出的 feature branch 上开发并本地 commit；不得 push `main`、不得开/合 GitHub PR。由父智能体 review 后提 PR、合并，再 `git pull` 同步本地 `main`。细则见英文版 `docs/PLANS.md` § Git Branch & PR Workflow。
- 任何 target-environment readiness、pilot-ready、release-ready 结论都必须有真实目标环境证据，不能由本地 skip 代替。

## 同类中文文档

- [docs/zh-CN/root/AGENTS.md](root/AGENTS.md)
- [docs/zh-CN/root/README.md](root/README.md)
- [docs/zh-CN/root/CONTRIBUTING.md](root/CONTRIBUTING.md)
- [docs/zh-CN/root/ARCHITECTURE.md](root/ARCHITECTURE.md)
- [docs/zh-CN/README.md](README.md)
- [docs/zh-CN/frontend.md](frontend.md)
- [docs/zh-CN/PLANS.md](PLANS.md)
- [docs/zh-CN/QUALITY_SCORE.md](QUALITY_SCORE.md)
