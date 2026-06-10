# 对象存储选型

> English: [English](provider-decision.md)

这是自托管运维文档，说明 Linux 自托管部署、存储、发布和模板使用方式。

## 使用方式

- 本页和英文版是相互链接的独立文档；不要在同一篇文档里混写中文和英文正文。
- 命令、路径、环境变量、API 路径、角色名、状态名和脚本名称保持英文原样，避免复制时出错。
- 修改相关功能时，请同时更新英文版和中文版；如果只更新一侧，`npm run docs:check` 应阻止完成。
- 若中文页与源码、测试或英文页冲突，以源码、测试和当前英文页为准，并在同一变更中修正中文页。

## 关键阅读点

- 先确认该文档属于哪个决策面：self-hosted。
- 阅读英文版中的完整细节、表格和命令，再用本页确认中文语境下的执行边界。
- 任何 target-environment readiness、pilot-ready、release-ready 结论都必须有真实目标环境证据，不能由本地 skip 代替。

## 同类中文文档

- [ops/self-hosted/README.zh-CN.md](../README.zh-CN.md)
- [ops/self-hosted/storage/README.zh-CN.md](README.zh-CN.md)
- [ops/self-hosted/storage/provider-decision.zh-CN.md](provider-decision.zh-CN.md)
- [ops/self-hosted/releases/README.zh-CN.md](../releases/README.zh-CN.md)
- [ops/self-hosted/releases/release-template.zh-CN.md](../releases/release-template.zh-CN.md)
