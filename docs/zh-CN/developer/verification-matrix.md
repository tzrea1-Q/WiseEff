# 验证矩阵

> English: [English](../../developer/verification-matrix.md)

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

## 补充命令

| 命令 | 证明内容 | 使用场景 |
| --- | --- | --- |
| `npm run acceptance:e2e -- e2e/acceptance/hdc-device-lab.acceptance.spec.ts` | 本机真实 HDC 前端/API/设备写入、回读和回滚证据 | 已连接审批过的本机 HDC target，并配置 `DEBUG_DEVICE_GATEWAY_MODE=hdc`、`HDC_DEVICE_LAB_AVAILABLE=true`、`HDC_SMOKE_CONFIRM_WRITE=confirm-high-risk-write` 和 `HDC_SMOKE_CONFIRM_ROLLBACK=confirm-rollback` 时使用。默认自动准备 lab-only 临时文件节点。 |
| `npm run acceptance:e2e -- e2e/acceptance/adb-device-lab.acceptance.spec.ts` | 本机真实 ADB 前端/API/设备证据 | 已连接审批过的本机 ADB 设备，并配置 `DEBUG_DEVICE_GATEWAY_MODE=adb` 与 `ADB_DEVICE_LAB_AVAILABLE=true` 时使用。默认只读，除非设置 `ADB_SMOKE_ENABLE_WRITE=true`。 |

## 同类中文文档

- [docs/zh-CN/developer/README.md](README.md)
- [docs/zh-CN/developer/local-development.md](local-development.md)
- [docs/zh-CN/developer/environment-variables.md](environment-variables.md)
- [docs/zh-CN/developer/verification-matrix.md](verification-matrix.md)
- [docs/zh-CN/developer/user-operation-coverage-matrix.md](user-operation-coverage-matrix.md)
- [docs/zh-CN/developer/browser-acceptance-coverage-map.md](browser-acceptance-coverage-map.md)
