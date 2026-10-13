# 开发者文档入口

> English: [English](../../developer/README.md)

这是日常开发文档，帮助开发者完成本地启动、环境配置、验证选择和验收覆盖判断。

## 使用方式

- 本页和英文版是相互链接的独立文档；不要在同一篇文档里混写中文和英文正文。
- 命令、路径、环境变量、API 路径、角色名、状态名和脚本名称保持英文原样，避免复制时出错。
- 修改相关功能时，请同时更新英文版和中文版；如果只更新一侧，`npm run docs:check` 应阻止完成。
- 若中文页与源码、测试或英文页冲突，以源码、测试和当前英文页为准，并在同一变更中修正中文页。

## 关键阅读点

- 先确认该文档属于哪个决策面：developer。
- 阅读英文版中的完整细节、表格和命令，再用本页确认中文语境下的执行边界。
- 任何 target-environment readiness、pilot-ready、release-ready 结论都必须有真实目标环境证据，不能由本地 skip 代替。

## 同类中文文档

- [docs/zh-CN/developer/README.md](README.md)
- [docs/zh-CN/developer/local-development.md](local-development.md)
- [docs/zh-CN/developer/environment-variables.md](environment-variables.md)
- [docs/zh-CN/developer/verification-matrix.md](verification-matrix.md)
- [docs/zh-CN/developer/user-operation-coverage-matrix.md](user-operation-coverage-matrix.md)
- [docs/zh-CN/developer/browser-acceptance-coverage-map.md](browser-acceptance-coverage-map.md)
- [docs/zh-CN/agents/catalog-launch-operating-rules.md](../agents/catalog-launch-operating-rules.md)

## 更新截图

显式设置 `USER_GUIDE_CAPTURE_DATABASE_URL`，指向已创建且名称含 `screenshot`、`ugshots` 或 `capture` 的一次性 PostgreSQL 数据库，再运行 `npm run docs:screenshots`；包装脚本拒绝缺失或不安全的 URL，将所有子进程固定到该数据库，先迁移，再以生产模式本地认证、演示账号和离线确定性日志分析启动专用 Playwright 配置。运行需要 Chromium：质量测试辅助函数重置并重新播种演示数据，截图准备三篇已发布知识，不创建参数草稿或提交，审阅截图使用种子已处理请求，日志截图通过界面上传或重新分析样例；使用新启动且不复用的服务（默认端口 5187/8797），清除仅支持 HMAC 的自有运行时描述文件覆盖，因为本截图配置需要本地登录，交付前逐张审阅图片并运行 `npm run docs:check`。
