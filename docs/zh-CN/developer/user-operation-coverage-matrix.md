# 用户操作覆盖矩阵

> English: [English](../../developer/user-operation-coverage-matrix.md)

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

## 当前覆盖重点

- `DEBUG-SIM-001`：模拟器调试读写验收会记录复杂 JSON 的 `valueKind`、digest 与 preview 元数据。
- `DEBUG-ADMIN-001`：调试管理后台验收覆盖复杂值类型与格式元数据的创建和编辑。

## 当前操作重点

- `DEBUG-ADMIN-001`：Admin 在 `/debugging-admin` 通过 API mode 完成调试参数新增、编辑、归档、恢复和 HDC/ADB binding 维护，断言覆盖 UI、API、DB 和 audit。
- `XIAOZE-PERCEPTION-001`：Admin 在 `/parameters` 向小泽提问，验收基于页面上下文与感知工具的只读 grounded 回答（`e2e/acceptance/xiaoze-perception.acceptance.spec.ts`）。
- `XIAOZE-PERCEPTION-AUTHZ-001`：Guest 用户询问无权限项目时，小泽返回安全非数据回答，不泄露越权内容。
- `XIAOZE-PLAN-MULTISTEP-001`：Admin 在 `/parameters` 完成多步计划并经批准 resume，验收 checkpoint 恢复与执行结果报告（`e2e/acceptance/xiaoze-planning.acceptance.spec.ts`）。
- `XIAOZE-PROACTIVE-001`：opt-in 主动建议在启用时出现、为只读且受 authz 限制；关闭时不出现（`e2e/acceptance/xiaoze-planning.acceptance.spec.ts`）。

## 同类中文文档

- [docs/zh-CN/developer/README.md](README.md)
- [docs/zh-CN/developer/local-development.md](local-development.md)
- [docs/zh-CN/developer/environment-variables.md](environment-variables.md)
- [docs/zh-CN/developer/verification-matrix.md](verification-matrix.md)
- [docs/zh-CN/developer/user-operation-coverage-matrix.md](user-operation-coverage-matrix.md)
- [docs/zh-CN/developer/browser-acceptance-coverage-map.md](browser-acceptance-coverage-map.md)
