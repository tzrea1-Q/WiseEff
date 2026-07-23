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
npm run dts:toolchain:bootstrap
npm run dts:toolchain:check -- --required
npm run dtc:seed:compile
```

`dts:toolchain:bootstrap` 在忽略提交的 `.wiseeff-tools/dts-toolchain` 创建项目 venv 并安装钉扎 dtschema；同时确保 dtc/fdtoverlay 匹配 `tools/dts-toolchain/versions.json`（宿主已是钉扎版本则复用，否则从钉扎 commit 构建到项目 toolchain bin）。API runtime、seed 脚本与检查命令共用该解析器，不要求把个人 Python bin 加入 `PATH`。`db:seed:m1` 会先用真实 dtc 编译 Aurora、Nebula、Atlas 三份 overlay；编译器缺失或出现 error 时停止写库。

完整失败关闭工具链与配置校验（版本钉扎见 `tools/dts-toolchain/versions.json`）：

```bash
npm run dts:toolchain:bootstrap
npm run dts:toolchain:check -- --required
npm run dts:config:validate
```

`dts:toolchain:check --required` 会对比共享解析器找到的版本与钉扎文件；缺工具、版本无法解析或不匹配时失败。受控部署可显式提供 `WISEEFF_DTC_PATH`、`WISEEFF_FDTOVERLAY_PATH`、`WISEEFF_DT_VALIDATE_PATH`；无效 override 失败关闭，不静默回退。

语义身份迁移演练（默认 dry-run；仅维护窗口 `--apply`）：

```bash
npm run parameter-identities:migrate
npm run parameter-identities:check
```

操作流程见 [parameter-identity-cutover.md](../runbooks/parameter-identity-cutover.md)。

`db:seed:m1` **默认**为语义种子（项目主 DTS baseline、bindings/specs、vendor docs、demo binding 历史）并做幂等的**本地 post-cutover finalize**，以便类型化 binding 草稿可提交审核。默认不种 flat `parameter_definitions` / `project_parameter_values`。若本地库仍是旧双轨脏数据，finalize 会失败关闭并要求清空 Docker volume（如 `docker compose down -v`）后重跑 `npm run dev:all`——禁止对脏共享开发库就地 cutover。生产 cutover 仍走维护窗口 runbook。

`npm run dev:api`（以及 `dev:all` 拉起的 API）在 `NODE_ENV=development`（默认）下，listen 前还会跑同一套**幂等本地 post-cutover**，避免「代码已更新、Docker volume 仍是 cutovers=0」的常见坑。脏双轨库会**直接导致 API 启动失败**并给出 wipe 指引，而不是起来后在提交审核时才 409。可用 `WISEEFF_LOCAL_POST_CUTOVER=0` 关闭；`WISEEFF_SEED_LEGACY_FLAT_IDENTITY=1` 双轨排练时启动 finalize 亦关闭（typed 提交仍拦截）。`NODE_ENV=production` 下永不启用。

需要旧双轨 flat 身份且不自动 cutover 时（typed 提交仍会 409）：

```bash
WISEEFF_SEED_LEGACY_FLAT_IDENTITY=1 npm run db:seed:m1
```

### Development 演示登录（API 模式）

当 `NODE_ENV=development` 时，`db:seed:m0` 会为 ChargeLab 演示 persona upsert 固定 username 与共用演示密码，仅用于本地开发库。

| Username | Persona |
| --- | --- |
| `xu.yun` | Admin（Xu Yun） |
| `zhao.heng` | Hardware User |
| `liu.min` | Software User |
| `wang.jie` | Hardware Committer |
| `chen.na` | Software User |
| `li.peng` | Hardware Committer |
| `sun.mei` | Software Committer |

共用密码：`WiseEff-Dev!`

非 development 的 seed 不会写入这些凭据。空的非 demo 安装仍使用 `npm run admin:bootstrap`。

## 同类中文文档

- [docs/zh-CN/developer/README.md](README.md)
- [docs/zh-CN/developer/local-development.md](local-development.md)
- [docs/zh-CN/developer/environment-variables.md](environment-variables.md)
- [docs/zh-CN/developer/verification-matrix.md](verification-matrix.md)
- [docs/zh-CN/developer/user-operation-coverage-matrix.md](user-operation-coverage-matrix.md)
- [docs/zh-CN/developer/browser-acceptance-coverage-map.md](browser-acceptance-coverage-map.md)
