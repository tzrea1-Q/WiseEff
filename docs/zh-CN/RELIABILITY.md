# 可靠性指南

> English: [English](../RELIABILITY.md)

这是核心入口文档，帮助开发者理解仓库地图、运行模式、治理规则和下一步阅读路径。

## 使用方式

- 本页和英文版是相互链接的独立文档；不要在同一篇文档里混写中文和英文正文。
- 命令、路径、环境变量、API 路径、角色名、状态名和脚本名称保持英文原样，避免复制时出错。
- 修改相关功能时，请同时更新英文版和中文版；如果只更新一侧，`npm run docs:check` 应阻止完成。
- 若中文页与源码、测试或英文页冲突，以源码、测试和当前英文页为准，并在同一变更中修正中文页。

## 关键阅读点

- 先确认该文档属于哪个决策面：core。
- 阅读英文版中的完整细节、表格和命令，再用本页确认中文语境下的执行边界。
- `/metrics` 现含 DTS 解析/编译延迟与失败、工具链就绪、身份映射/规格审核积压、发布绕过与参数身份 cutover 状态；告警与切换步骤见 `docs/runbooks/parameter-identity-cutover.md`。失败 apply 后禁止部分继续，只能整快照恢复。
- 任何 target-environment readiness、pilot-ready、release-ready 结论都必须有真实目标环境证据，不能由本地 skip 代替。

## 补充说明（小泽 checkpoint）

- 生产与自托管部署使用 `XIAOZE_CHECKPOINTER=postgres`；LangGraph checkpoint 表由 `npm run db:migrate` 确保。
- HITL 多步计划在 API 重启与多副本间可恢复；本地开发/测试默认 `memory`。
- 与用户可见聊天历史（TD-030）分离。

## 同类中文文档

- [docs/zh-CN/root/AGENTS.md](root/AGENTS.md)
- [docs/zh-CN/root/README.md](root/README.md)
- [docs/zh-CN/root/CONTRIBUTING.md](root/CONTRIBUTING.md)
- [docs/zh-CN/root/ARCHITECTURE.md](root/ARCHITECTURE.md)
- [docs/zh-CN/README.md](README.md)
- [docs/zh-CN/frontend.md](frontend.md)
- [docs/zh-CN/PLANS.md](PLANS.md)
- [docs/zh-CN/QUALITY_SCORE.md](QUALITY_SCORE.md)
