# 核心工程信念

> English: [English](../../design-docs/core-beliefs.md)

这是架构与设计文档，说明系统边界、领域模型、API 合同、测试、部署和安全治理。

## 使用方式

- 本页和英文版是相互链接的独立文档；不要在同一篇文档里混写中文和英文正文。
- 命令、路径、环境变量、API 路径、角色名、状态名和脚本名称保持英文原样，避免复制时出错。
- 修改相关功能时，请同时更新英文版和中文版；如果只更新一侧，`npm run docs:check` 应阻止完成。
- 若中文页与源码、测试或英文页冲突，以源码、测试和当前英文页为准，并在同一变更中修正中文页。

## 关键阅读点

- 先确认该文档属于哪个决策面：architecture。
- 阅读英文版中的完整细节、表格和命令，再用本页确认中文语境下的执行边界。
- 任何 target-environment readiness、pilot-ready、release-ready 结论都必须有真实目标环境证据，不能由本地 skip 代替。

## 同类中文文档

- [docs/zh-CN/design-docs/index.md](index.md)
- [docs/zh-CN/design-docs/core-beliefs.md](core-beliefs.md)
- [docs/zh-CN/design-docs/full-stack-architecture.md](full-stack-architecture.md)
- [docs/zh-CN/design-docs/domain-model.md](domain-model.md)
- [docs/zh-CN/design-docs/api-contract.md](api-contract.md)
- [docs/zh-CN/design-docs/testing-strategy.md](testing-strategy.md)
- [docs/zh-CN/design-docs/deployment-operations.md](deployment-operations.md)
- [docs/zh-CN/design-docs/security-governance.md](security-governance.md)
