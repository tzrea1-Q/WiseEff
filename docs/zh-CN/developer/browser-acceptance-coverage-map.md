# 浏览器验收覆盖图

> English: [English](../../developer/browser-acceptance-coverage-map.md)

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

- `DEBUG-SIM-001`：模拟器读、写、回读不一致、回滚与审计路径，包含复杂 JSON 值元数据。
- `DEBUG-ADMIN-001`：API mode 下调试管理后台可新增、编辑、归档、恢复，并维护 HDC/ADB binding 与复杂值元数据。
- `BRIDGE-WIN-001`：`/node-debugging` 的 Windows 优先本地 Bridge 面板可覆盖缺失安装、未配对、未启动、在线无设备与在线目标状态，并展示同源 Windows 下载入口。
- `BRIDGE-TOOLS-001`：Bridge 已连接但 `tools.adb.available: false` 时，Step ③ 显示缺少 ADB 与 **安装调试工具** CTA（非「Bridge 未安装」）。覆盖：`src/NodeDebuggingPage.test.tsx`。
- `XIAOZE-PERCEPTION-001`：小泽 P0 感知验收——基于页面上下文与只读感知工具回答有权限范围内的项目问题。
- `XIAOZE-PERCEPTION-AUTHZ-001`：越权项目问题返回安全、不泄露数据的回答。
- `XIAOZE-PLAN-MULTISTEP-001`：多步计划在批准后 checkpoint resume，并报告观察到的执行结果（`e2e/acceptance/xiaoze-planning.acceptance.spec.ts`）。
- `XIAOZE-PROACTIVE-001`：opt-in 主动建议为只读、受 authz 限制；关闭时不展示（`e2e/acceptance/xiaoze-planning.acceptance.spec.ts`）。

## 同类中文文档

- [docs/zh-CN/developer/README.md](README.md)
- [docs/zh-CN/developer/local-development.md](local-development.md)
- [docs/zh-CN/developer/environment-variables.md](environment-variables.md)
- [docs/zh-CN/developer/verification-matrix.md](verification-matrix.md)
- [docs/zh-CN/developer/user-operation-coverage-matrix.md](user-operation-coverage-matrix.md)
- [docs/zh-CN/developer/browser-acceptance-coverage-map.md](browser-acceptance-coverage-map.md)
