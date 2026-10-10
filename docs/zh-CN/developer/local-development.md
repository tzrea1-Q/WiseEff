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
- live 小泽在 `.env` 中使用 `XIAOZE_LLM_API_BASE_URL`、`XIAOZE_LLM_MODEL`、`XIAOZE_LLM_API_KEY`；离线开发/验收使用 `XIAOZE_DETERMINISTIC=true`，不会请求外部 provider。

## dtc 与 M1 全量种子

需要编译检查或 DTS 发布校验时，安装并检查 Device Tree Compiler；M1 seed 自身对已提交的项目主 DTS 板做解析完整性检查，不要求运行编译器：

```bash
npm run dts:toolchain:bootstrap
npm run dts:toolchain:check -- --required
npm run dtc:seed:compile
```

`dts:toolchain:bootstrap` 在忽略提交的 `.wiseeff-tools/dts-toolchain` 创建项目 venv 并安装钉扎 dtschema；同时确保 dtc/fdtoverlay 匹配 `tools/dts-toolchain/versions.json`（宿主已是钉扎版本则复用，否则从钉扎 commit 构建到项目 toolchain bin）。API runtime、seed 编译检查与 CLI 检查共用该解析器，不要求把个人 Python bin 加入 `PATH`。可选的 `dtc:seed:compile` 校验 Aurora、Nebula、Atlas seed 板；编译器缺失或出现 error 时该命令失败。M1 的独立解析检查失败时会停止写库。

完整失败关闭工具链与配置校验（版本钉扎见 `tools/dts-toolchain/versions.json`）：

```bash
npm run dts:toolchain:bootstrap
npm run dts:toolchain:check -- --required
npm run dts:config:validate
```

`dts:toolchain:check --required` 会对比共享解析器找到的版本与钉扎文件；缺工具、版本无法解析或不匹配时失败。受控部署可显式提供 `WISEEFF_DTC_PATH`、`WISEEFF_FDTOVERLAY_PATH`、`WISEEFF_DT_VALIDATE_PATH`；无效 override 失败关闭，不静默回退。

仅供 legacy cohorts 的 operator 语义身份迁移演练（默认 dry-run；仅维护窗口 `--apply`）；不属于全新 canonical 种子或启动流程：

```bash
npm run parameter-identities:migrate
npm run parameter-identities:check
```

操作流程见 [parameter-identity-cutover.md](../runbooks/parameter-identity-cutover.md)。

隔离 server 测试时，将 `DATABASE_URL`、`TEST_DATABASE_URL` 与 `WISEEFF_TEST_DATABASE_PREFIX` 配到专用 lane。模板库使用 `<lane>_test_tpl_*`，一次性 worker 库使用 `wiseeff_test_wk_<lane-length>_<lane>_*`，保留按字面值隔离的命名空间，同时满足未改动的 ephemeral-publication 策略。一次性库名在 PostgreSQL 的 63-byte 标识符上限内保留唯一后缀。Managed-instance fixtures 仍为 non-ephemeral，必须提供原有 adoption proof。

### Catalog launch lane（Wayfinder #668）

默认 compose 应用库 `postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff` 不能作为 catalog 证据。剩余 catalog launch Issues 必须为每个 Issue 准备隔离的 pgvector 库，并在 Hosted 前通过本地门禁：

```bash
npm run catalog:lane:env -- provision --issue 687
npm run catalog:lane:env -- doctor --issue 687
npm run catalog:lane:accept -- --issue 687 -- npm run test:server -- server/modules/catalog-kernel/compiler
npm run catalog:lane:env -- cleanup --abandoned
```

完整规则见[目录 launch 操作规则](../agents/catalog-launch-operating-rules.md)。

## Canonical-only 本地种子

`npm run dev:all` 启动 Docker PostgreSQL，执行 migrations 与 M0–M3 seeds，再启动 API 和 API-mode 前端。`db:seed:all` 与 `db:seed:m1` **只通过 canonical owners 初始化参数数据**：M1 使用现有 Catalog installer 的 `seedPublishedCatalog` 安装钉扎的受约束 vendor Catalog，创建 taxonomy/modules，并导入 canonical-only 来源结构修订；随后注册 canonical Subjects，物化 canonical Bindings 和 Project values。不初始化 legacy Spec、Binding、flat Definition 或 PPV 行。Aurora 的 `watchdog_time` 演示历史来自真实 canonical 草稿 → 提交 → 审核 → source commit，不直接插入历史。种子保持幂等，重复运行不应增加重复的 canonical Catalog、Binding、value 或 history 行。

空的本地开发库使用有序种子：

```bash
npm run db:migrate
npm run db:seed:all
```

也可逐项执行：

```bash
npm run db:migrate
npm run db:seed:m0
npm run db:seed:m1
npm run db:seed:m2
npm run db:seed:m3
```

- `db:seed:m0`：organization、users、roles 与项目基础数据。
- `db:seed:m1`：钉扎 canonical vendor Catalog、taxonomy/modules、项目主 DTS baselines 与无 legacy projection 的结构修订、canonical Subject registrations/Bindings/Project values，以及经过审核的 source-commit 演示历史。**单独运行也必须先有 M0 foundation，M1 会自行安装 Catalog**，不要求先运行 `db:seed:all`。
- `db:seed:m2`：日志分析演示数据。
- `db:seed:m3`：模拟器调试设备与目录。

**全新 canonical 种子不需要语义身份 cutover。** M1 不运行旧语义身份迁移，也不调用 `ensureLocalPostCutoverIdentity`。API 启动时，干净且所有来源 pin 完整的 canonical 安装会跳过 legacy finalize；该状态下启动不会调用旧迁移。

在 development 和 test 环境，启动时的身份模式解析也会识别这个 canonical 状态，无需旧 cutover 标记：旧 Spec 和 Binding 必须为空，canonical Binding 必须存在，每个当前值的来源 pin 必须指向文件的活跃版本。这个只读 fallback 容忍 canonical 表或行缺失，并复用现有净库 guard；若仍有 flat Definition/PPV 行、history 行同时缺少 Binding 与逻辑节点身份，或 Binding 类型的 draft/change-request 行缺少 Binding，则拒绝启动。Production 下 API 和 log-worker 启动只使用原有 cutover 标记或 flat 表已退役的探测；全新 canonical 库和混合库不会经由这个本地 fallback 切换模式。它不代替 operator cutover。节点启用行保留独立逻辑节点身份，不要求 Binding。Canonical 单项和批量来源提交会在同一事务内为新 DTS 版本建立结构索引，因此演示历史写入后仍可导航结构并读取 Binding 的来源位置。

`npm run dev:api`（以及 `dev:all` 拉起的 API）为 legacy cohorts 保留 development 下 listen 前的**幂等本地 post-cutover 启动 guard**，旧 operator helpers 仍可使用；本地 finalize 钩子在 production 永不运行，test 仅显式开启时运行，但只读净库检查也用于 canonical 种子身份解析。`WISEEFF_LOCAL_POST_CUTOVER=0` 关闭该启动钩子。已弃用的 `WISEEFF_SEED_LEGACY_FLAT_IDENTITY=1` 仅为现有 legacy operator 工作流保留 API 启动兼容 opt-out；**M1 忽略它，不再有 legacy flat 种子选项**。跳过启动钩子不等于完成 legacy cutover，也不会使被阻断的 typed 提交变为有效。

已有双轨数据的库可能无法通过本地 cutover/启动 guard。不要用 seed 升级 populated pre-canonical 数据，也不要默认清空数据库或 volume。先盘点数据库、Docker volumes、对象存储及使用它们的其他 checkout；任何破坏性重置都必须获得明确授权。演示种子优先使用独立空库。#824 的 populated-upgrade operator 工作流保持不变；失败关闭的维护路径见 [parameter-identity-cutover.md](../runbooks/parameter-identity-cutover.md)。

### 钉扎 vendor 文档同步

M1 会调用 vendor 文档同步。需要对本地演示库单独重跑时：

```bash
npx tsx scripts/sync-vendor-property-docs.ts
```

同步通过 `seedPublishedCatalog` 调用 Catalog installer，物化钉扎的 canonical Definition revisions；不直接 upsert legacy 文档/Definitions，也不重写已安装的修订。修改文档或新增 Catalog 文档必须走受治理的 Catalog publication，不能通过 seed/sync 重写。不要用钉扎演示 installer 覆盖更新的或独立治理的 Catalog。

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
