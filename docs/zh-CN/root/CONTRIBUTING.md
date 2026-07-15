# 贡献指南

> English: [English](../../../CONTRIBUTING.md)

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
- 首次运行 M1 seed 前执行 `npm run dtc:bootstrap` 与 `npm run dtc:check -- --required`。`db:seed:m1` 会先真实编译三份项目 DTS，再写入参数库、项目值与结构化数据。
- 生产发布失败关闭依赖完整工具链：`npm run dts:toolchain:check`。参数语义身份切换仅在维护窗口执行，见 `docs/runbooks/parameter-identity-cutover.md`；`--apply` 失败后禁止部分继续。

## 同类中文文档

- [docs/zh-CN/root/AGENTS.md](AGENTS.md)
- [docs/zh-CN/root/README.md](README.md)
- [docs/zh-CN/root/CONTRIBUTING.md](CONTRIBUTING.md)
- [docs/zh-CN/root/ARCHITECTURE.md](ARCHITECTURE.md)
- [docs/zh-CN/README.md](../README.md)
- [docs/zh-CN/frontend.md](../frontend.md)
- [docs/zh-CN/PLANS.md](../PLANS.md)
- [docs/zh-CN/QUALITY_SCORE.md](../QUALITY_SCORE.md)
