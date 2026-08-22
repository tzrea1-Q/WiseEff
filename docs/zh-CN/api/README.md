# API 文档入口

> English: [English](../../api/README.md)

这是 API 文档，说明认证、错误模型、调用示例和合同维护方式。

## 使用方式

- 本页和英文版是相互链接的独立文档；不要在同一篇文档里混写中文和英文正文。
- 命令、路径、环境变量、API 路径、角色名、状态名和脚本名称保持英文原样，避免复制时出错。
- 修改相关功能时，请同时更新英文版和中文版；如果只更新一侧，`npm run docs:check` 应阻止完成。
- 若中文页与源码、测试或英文页冲突，以源码、测试和当前英文页为准，并在同一变更中修正中文页。
- 参数 / 日志 / 调试 / Xiaoze HTTP 客户端在映射 DTO 前按 `server/modules/contracts/dtoSchemas/` 做 schema 级校验；其中 proactive suggest 的请求与响应均有具体 schema，响应漂移时 `useXiaozeSuggestions` 通过既有 `WiseEffApiError`（`INTERNAL_ERROR` + `details.reason = contract-drift`）报告并失败关闭为空列表。五类 WiseEff CUSTOM frame 由服务端 Zod schema 直接校验 `xiaozeTurnStream` 实际产物；流传输继续交给 `@ag-ui/client`，不增加 fetch wrapper 或替换 parser。完整命令与其余未覆盖面见英文版。

## 关键阅读点

- 先确认该文档属于哪个决策面：api。
- 阅读英文版中的完整细节、表格和命令，再用本页确认中文语境下的执行边界。
- 任何 target-environment readiness、pilot-ready、release-ready 结论都必须有真实目标环境证据，不能由本地 skip 代替。

## 同类中文文档

- [docs/zh-CN/api/README.md](README.md)
- [docs/zh-CN/api/authentication.md](authentication.md)
- [docs/zh-CN/api/errors.md](errors.md)
- [docs/zh-CN/api/examples.md](examples.md)
- [docs/zh-CN/api/log-analysis-integration.md](log-analysis-integration.md)
