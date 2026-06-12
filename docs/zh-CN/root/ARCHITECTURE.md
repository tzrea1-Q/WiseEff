# 架构总览

> English: [English](../../../ARCHITECTURE.md)

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
- API runtime 是严格路径：前端从空 API bootstrap state 启动，认证或必需业务 API hydrate 失败时显示不可用/重试状态，不能把 mock runtime 的业务数据作为 fallback。mock runtime 仅用于演示和测试。

## 同类中文文档

- [docs/zh-CN/root/AGENTS.md](AGENTS.md)
- [docs/zh-CN/root/README.md](README.md)
- [docs/zh-CN/root/CONTRIBUTING.md](CONTRIBUTING.md)
- [docs/zh-CN/root/ARCHITECTURE.md](ARCHITECTURE.md)
- [docs/zh-CN/README.md](../README.md)
- [docs/zh-CN/frontend.md](../frontend.md)
- [docs/zh-CN/PLANS.md](../PLANS.md)
- [docs/zh-CN/QUALITY_SCORE.md](../QUALITY_SCORE.md)
