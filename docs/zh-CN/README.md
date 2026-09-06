# 文档知识库

> English: [English](../README.md)

这是核心入口文档，帮助开发者理解仓库地图、运行模式、治理规则和下一步阅读路径。

## 技术与测试阅读入口

一套专题文档提供两个入口：

- **研发接手：** [技术文档合集](design-docs/full-stack-architecture.md)：13 章正文与 22 张可编辑 Mermaid 图，完整说明架构、接口、业务流程、一致性、安全、环境与恢复；专题引用用于进一步核对契约。
- **测试设计与执行规划：** [测试策略与设计](design-docs/testing-strategy.md) → 验证矩阵 → 生成的需求与操作覆盖 → 人工验收及逐次运行证据。

技术页负责系统与代码关系，测试页负责风险和场景设计；schema、权限、命令及运维步骤仍由既有专题页面负责。修改时更新对应主题及中英文版本，不另建重复手册。历史设计和生成结果保留原身份，不能当作当前实现或新执行证据；质量看板中的历史评分也不代表本次重新评估。

## 使用方式

- 本页和英文版是相互链接的独立文档；不要在同一篇文档里混写中文和英文正文。
- 命令、路径、环境变量、API 路径、角色名、状态名和脚本名称保持英文原样，避免复制时出错。
- 修改相关功能时，请同时更新英文版和中文版；如果只更新一侧，`npm run docs:check` 应阻止完成。
- 若中文页与源码、测试或英文页冲突，以源码、测试和当前英文页为准，并在同一变更中修正中文页。

## 关键阅读点

- 对外展示与项目交流：阅读[项目介绍](../presentations/project-introduction.zh-CN.md)，包含核心能力、模块流程图和本地应用实机截图。
- 先确认该文档属于哪个决策面：core。
- 阅读英文版中的完整细节、表格和命令，再用本页确认中文语境下的执行边界。
- 任何 target-environment readiness、pilot-ready、release-ready 结论都必须有真实目标环境证据，不能由本地 skip 代替。
- 自托管观测性通过 `ops/self-hosted/scripts/observability up` 一键启动 Prometheus、Grafana、Alertmanager 和 exporter，自动装载四套 Dashboard 并探测 API、worker、web、proxy、PostgreSQL、Redis、对象存储和监控组件；UI 默认只绑定 loopback。
- 小泽 live LLM 的当前配置入口是 `XIAOZE_LLM_API_BASE_URL`、`XIAOZE_LLM_MODEL`、`XIAOZE_LLM_API_KEY`；离线文档与验收使用显式 deterministic 模式。

## 同类中文文档

- [docs/zh-CN/root/AGENTS.md](root/AGENTS.md)
- [docs/zh-CN/root/README.md](root/README.md)
- [docs/zh-CN/root/CONTRIBUTING.md](root/CONTRIBUTING.md)
- [docs/zh-CN/root/ARCHITECTURE.md](root/ARCHITECTURE.md)
- [docs/zh-CN/README.md](README.md)
- [docs/zh-CN/frontend.md](frontend.md)
- [docs/zh-CN/PLANS.md](PLANS.md)
- [docs/zh-CN/QUALITY_SCORE.md](QUALITY_SCORE.md)
