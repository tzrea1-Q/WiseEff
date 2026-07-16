# 本地开发

> English: [English](../../developer/local-development.md)

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

## dtc 与 M1 全量种子

首次运行 M1 seed 前安装并检查 Device Tree Compiler：

```bash
npm run dtc:bootstrap
npm run dtc:check -- --required
npm run dtc:seed:compile
```

bootstrap 在 macOS 使用 Homebrew，在 Debian/Ubuntu 使用 `device-tree-compiler`，在 Alpine 与 RHEL 系 Linux 使用 `dtc` 包。`db:seed:m1` 会先用真实 dtc 编译 Aurora、Nebula、Atlas 三份 overlay；编译器缺失或出现 error 时停止写库。脱离外部 base DTS 单独编译 overlay 时，`reg_format` / `ranges_format` warning 可保留，但不能有 error。

完整失败关闭工具链与配置校验：

```bash
npm run dts:toolchain:check
npm run dts:config:validate
```

语义身份迁移演练（默认 dry-run；仅维护窗口 `--apply`）：

```bash
npm run parameter-identities:migrate
npm run parameter-identities:check
```

操作流程见 [parameter-identity-cutover.md](../runbooks/parameter-identity-cutover.md)。

M1 seed 包含 12 个兼容参数、170 个 DTS 来源参数、510 个项目参数值、三份 DTS 文件版本、完整节点/属性/phandle 结构，以及每项目一个已编译 seed baseline。

## 同类中文文档

- [docs/zh-CN/developer/README.md](README.md)
- [docs/zh-CN/developer/local-development.md](local-development.md)
- [docs/zh-CN/developer/environment-variables.md](environment-variables.md)
- [docs/zh-CN/developer/verification-matrix.md](verification-matrix.md)
- [docs/zh-CN/developer/user-operation-coverage-matrix.md](user-operation-coverage-matrix.md)
- [docs/zh-CN/developer/browser-acceptance-coverage-map.md](browser-acceptance-coverage-map.md)
