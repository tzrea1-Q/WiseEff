# DTS 全量种子数据与 dtc 工具链 Implementation Plan

> 基于用户提供的电源/充电板级 overlay DTS，建立可追溯、可差异化、可真实编译的参数管理演示数据，并让本地与 Linux 部署环境以同一流程获得 `dtc`。

**日期：** 2026-07-15

**Goal:** 用真实 DTS 替换 M1 的伪配置种子，覆盖参数库、项目参数、DTS 文件版本、结构化节点/属性、配置集与编译验证；提供可复现的 dtc 安装/检查流程。

**Architecture:** 把用户 DTS 保存为权威 seed fixture；由纯函数解析 fixture、生成三项目差异化 source，并从 `resolveDts` 结构派生参数定义与来源绑定。API 数据库 seed 以确定性 ID 幂等写入旧 M1 视图和 P1/P2 DTS 结构模型；对象内容进入现有 ObjectStore。轻量 mock 保留 12 个兼容参数，不承担全量数据库规模。dtc 不捆绑平台二进制，开发机通过 bootstrap 脚本安装/检查，Linux 镜像通过系统包安装，验证命令统一走仓库脚本。
**Branch:** `feat/dts-full-seed-and-toolchain`（from latest `origin/main`）。

## Success Criteria

- 用户 DTS 中每一个 resolved property 都进入参数库，且三项目值齐全、存在有意差异。
- 每个项目参数都绑定到同名 `.dts` 文件与包含属性名的完整结构路径，不依赖 `(name,module)` fallback。
- 每个项目存在默认配置集、当前 DTS 文件版本、`dts_nodes` / `dts_properties` / phandle 引用以及可导出的原始文件。
- seed 重跑幂等：无重复文件/版本/参数/历史；源值变化才递增参数历史版本。
- `npm run dtc:check` 能明确报告工具可用性；`npm run dtc:bootstrap` 支持 macOS Homebrew 与 Debian/Ubuntu Linux；self-hosted API 镜像自带 `dtc`。
- 真实 `dtc -@` 编译三份 fixture 成功；缺失 dtc 时 required gate 必须失败而不是静默跳过。

## Git & PR Workflow

- 在 `feat/dts-full-seed-and-toolchain` 上实现、测试和提交。
- 不直接改写或合并 `main`；完成后由当前会话所有者审查并决定 PR/合并。

## Tasks

### Task 1 — Seed contract tests

- [x] 为 fixture 解析覆盖、唯一来源身份、三项目差异与语义元数据写失败测试。
- [x] 为 M1 seed SQL 契约写失败测试：模块树、source binding、config set/file/version/structure、幂等。

### Task 2 — Full DTS seed model

- [x] 保存规范 DTS fixture。
- [x] 实现三个项目的确定性变体，不改变 DTS 结构与类型。
- [x] 按节点域和属性语义生成中文描述、解释、范围、单位、风险和 value kind。
- [x] API seed 使用 DTS 派生全量数据；mock 保留 12 个兼容参数，避免 546 行测试渲染拖慢日常开发。

### Task 3 — Persistent DTS seed

- [x] 扩展 `db:seed:m1`：写参数模块树、定义、项目值来源绑定、历史。
- [x] 写默认配置集、项目 DTS 文件、版本、对象存储内容和结构化模型。
- [x] 保证确定性 ID、checksum 与重跑幂等。

### Task 4 — dtc toolchain

- [x] 新增跨平台 bootstrap/check/compile 脚本及 package commands。
- [x] self-hosted Linux API 镜像安装 `device-tree-compiler`。
- [x] 补环境与本地开发说明（英文 + 中文）。

### Task 5 — Verification

- [x] 定向 seed/parser/toolchain 测试。
- [x] 三项目真实 dtc 编译。
- [x] `npm run test:server`、`npm test`、`npm run build`、`npm run docs:check`、`git diff --check`。

### Browser acceptance impact

- [x] 复核现有 requirement `PARAM-HAPPY-001`：`/parameters` 的项目切换、检索和来源展示仍走同一交互，只把 API hydration 改为按项目完整加载；对应 operation `PARAM-HAPPY-001` 和 `e2e/acceptance/parameters.acceptance.spec.ts` 不变。
- [x] 复核现有 requirement `PARAM-FILE-ADMIN-001`：`/parameter-admin/projects` 的文件管理入口不变，结构浏览现在绑定已列出的项目当前 DTS 文件/版本；对应 operations `PARAM-FILE-UPLOAD-001` / `PARAM-FILE-SYNC-001` 和 `e2e/acceptance/parameter-files.acceptance.spec.ts` 不变。
- [x] 未引入新的用户操作或审批边界；增加运行时、HTTP 客户端和项目结构文件绑定的回归测试，并用真实 API 数据在桌面、平板、手机完成浏览器验收。

## Verification Matrix

| Check | Command |
| --- | --- |
| Seed derivation | `npm run test:server -- server/modules/parameters/seedM1Parameters.test.ts --run` |
| DTS parser/structure | `npm run test:server -- server/modules/dts server/modules/parameter-files --run` |
| Real compiler | `npm run dtc:check -- --required && npm run dtc:seed:compile` |
| Backend | `npm run test:server` |
| Frontend/mock contract | `npm test` |
| Type/build | `npm run build` |
| Docs | `npm run docs:check` |
| Diff hygiene | `git diff --check` |

## Documentation Impact Matrix

| Area | Path | Action |
| --- | --- | --- |
| Repository map | `AGENTS.md`, `ARCHITECTURE.md` | Review；无边界变化则记录 unchanged |
| Planning | `docs/PLANS.md`, `docs/zh-CN/PLANS.md` | Update；登记本计划 |
| Product specs | `docs/product-specs/`, `docs/zh-CN/product/` | Review；种子数据不改变产品行为则 unchanged |
| Architecture/domain | `docs/design-docs/domain-model.md`, Chinese companion | Review；仅实例化既有模型则 unchanged |
| Quality/testing | `docs/developer/verification-matrix.md`, Chinese companion | Update；增加 required dtc/seed compile gate |
| Reliability/deployment | `docs/developer/local-development.md`, `docs/zh-CN/backend-runtime.md`, `ops/self-hosted/` | Update；记录 dtc bootstrap 与镜像依赖 |
| Security/governance | `docs/SECURITY.md`, Chinese companion | Review；沿用受限子进程模型则 unchanged |
| Frontend/design | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` | Update；说明 mock/API 共享真实 DTS 种子 |
| Generated artifacts | `docs/generated/db-schema.md` | Update；记录 phandle target 的 `ON DELETE SET NULL` |
| References/samples | `docs/samples/parameter-import/README.md` | Update；样例参数名与真实 seed 对齐 |

## Documentation Update Gate

- [x] 所有 Update 项已更新；`AGENTS.md` / `ARCHITECTURE.md`、产品规格、domain model 和安全文档复核后无边界或策略变化，因此保持不变。
- [x] 英文/中文开发文档保持分文件互链。
- [x] `npm run docs:check` 通过。

## Completion Evidence

- `buildDtsPowerSeed()` 解析 50 个节点、170 个属性、18 个 phandle 引用，并为 Aurora、Nebula、Atlas 生成相同结构、至少 21 项有意差异的项目值。
- 两次连续运行 `npm run db:seed:m1` 均成功，重复后仍为 170 个 DTS 定义、510 个来源绑定项目值、3 个文件、3 个版本、150 个节点、510 个属性、54 个 phandle 引用和 3 个 `seed-v1` 基线。
- `dtc` 1.8.1 以 `-@` 成功编译三份 overlay；独立 overlay 因缺少外部 base DTS 产生预期的 `reg_format` / `ranges_format` warning，没有 error。
- `npm run test:server`：180 files / 1255 passed / 1 skipped；`npm test`：485 files / 3363 passed / 1 skipped；`npm run build`、`selfhost:check`、`acceptance:ci`、`acceptance:models`、`docs:check` 和 `git diff --check` 均通过。
- 真实浏览器验证 `/parameters` 与 `/parameter-admin/projects`：Aurora 191/191、Nebula 182/182、Atlas 182/182；`charging_core.ichg_max` 分别为 `<2500>` / `<3000>` / `<2100>`，来源均为 `wiseeff-power-overlay.dts → charging_core/ichg_max`；结构浏览实际加载项目当前文件的 50 节点树。
- 视口 `1440x900`、`768x1024`、`390x844` 均通过；平板/手机页面宽度分别为 768/390 且无文档级横向溢出，浏览器控制台 error 为 0。截图保存在 `work/ui-checks/`（本地验收产物，不提交）。
