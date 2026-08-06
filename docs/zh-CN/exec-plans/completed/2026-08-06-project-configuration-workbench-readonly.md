# 项目配置工作台只读 tracer（#228）

> 状态：**已完成**
> 日期：2026-08-06
> 分支：`feat/project-configuration-workbench-readonly`
> Issue：[#228](https://github.com/tzrea1-Q/WiseEff/issues/228)，父 Issue [#227](https://github.com/tzrea1-Q/WiseEff/issues/227)
> English: [English](../../../exec-plans/completed/2026-08-06-project-configuration-workbench-readonly.md)
> 设计：[项目配置工作台](../../design-docs/2026-08-06-project-configuration-workbench-design.md)

## 目标

在仅开发环境生效的前端开关后交付 Phase 1 只读 tracer：Admin 从项目清单进入规范项目配置路由，按 URL 有效选择或确定性默认规则解析配置集，区分成员文件与未编组文件，并在源码主导布局里读取成员文件的活跃 DTS 源码。旧四视图弹窗继续可达。

## 范围与成功标准

1. 非生产环境设置 `VITE_PROJECT_CONFIGURATION_WORKBENCH_ENABLED=true` 后，清单动作显示“配置工作台”并进入 `/parameter-admin/projects/:projectId/configuration`；开关关闭时保留旧“管理文件”入口。
2. 有效 `?configSet=` 优先；无效或缺失时选择名为 `default` 的配置集，只有既有不变量缺失时才做稳定兜底。成员选择同步到 `?file=`。
3. 工作台在 mock/API 两种运行时都只经 `DtsStructuredRepository` 与 `ParameterFileRepository` 读取配置集、成员、项目文件、基线和活跃版本内容；页面不导入 HTTP client。
4. 树明确区分成员/未编组文件，展示成员角色、活跃文件版本 id 与版本号；选择成员后读取精确活跃版本。
5. 命令栏明确项目、配置集、工作配置和当前发布基线；#229 以后才提供的写动作不能伪装为可用。
6. `1440x900` 保持紧凑/可折叠树、源码主画布、覆盖检查器和精确 44px 折叠任务栏；`768x1024`、`390x844` 使用 sheet 且无页面横向溢出。
7. 加载、无配置集、空配置集、活跃源码缺失和局部读取失败均保留上下文并提供对应重试。
8. 定向前后端/port 测试、API 模式浏览器验收、完整仓库门禁、`npm run docs:check` 与 `npm run build` 全部通过。

## 非目标

- 不提前实现候选上传/激活、结构化编辑、源码 span 同步、检索、发布就绪度新合同、冲突裁决、发布写操作、旧路由切换或旧弹窗删除。
- 不 merge、cherry-pick 或复制 `codex/prototype-config-workbench` / `e941f236`。
- 不新增第二套数据访问边界，不让 mock 成为另一套产品。

## 测试边界

| seam | 行为 | 证据 |
| --- | --- | --- |
| 路由/可见组件 | 开关、规范路由、URL 选择、状态与响应式外壳 | 工作台、页面、`appConfig` 单测 |
| 既有 ports | 配置集成员读取一致性、活跃源码下载 | HTTP/mock port 合同测试 |
| 公开 HTTP | 按租户/项目隔离的成员 GET，返回角色与活跃版本身份 | parameter-files 路由/服务/repository 测试 |
| API 浏览器 | 从清单进入、配置集解析、源码切换、sheet 与请求/布局 | 专用 Playwright acceptance |

测试只观察公开组件、port、HTTP 与浏览器行为，不测试私有 reducer、effect 调用顺序或 CSS 实现细节。

## Git & PR Workflow

| 角色 | 权限 |
| --- | --- |
| 实施 agent | 在 `feat/project-configuration-workbench-readonly` 提交；不 push/merge `main`，不建 PR，不关闭 #228 |
| 父 agent | 复核提交、建/合 PR、同步本地 `main`，验收后关闭 #228 |

分支起点为包含 PR #241 的最新 `main` 合并提交 `901d32e6`。

## 任务

- [x] 完整读取 #228/#227，确认无阻塞，认领 Issue，从 `901d32e6` 建分支。
- [x] 锁定上述 TDD seam，登记双语 active plan。
- [x] 登记验收需求/操作 `PROJ-CONFIG-READ-001`。
- [x] 以 red→green 补齐 `DtsStructuredRepository` 既有成员只读能力及 API/mock 一致性。
- [x] 以 red→green 增加开发开关、规范路由、项目清单入口和 URL/default 配置集规则。
- [x] 以 red→green 完成成员/未编组树、活跃 DTS 源码、命令栏身份、禁用写动作、覆盖检查器、44px 任务栏与恢复状态。
- [x] 增加 API 模式 Playwright acceptance；跑完整门禁与三视口 `playwright-cli` 证据。
- [x] 以 `901d32e6` 为 fixed point 执行 Standards/Spec 双轴 `/code-review`，修复后重验。
- [x] 通过文档门禁，将双语计划移入 `completed/`，在 feature branch 提交全部工作。

## 浏览器验收映射

| 需求 | 操作 | 行为 | 证据 |
| --- | --- | --- | --- |
| `PROJ-CONFIG-READ-001` | `PROJ-CONFIG-READ-001` | API 模式下从项目清单进入，证明 URL/default 配置集、成员/未编组树、活跃 DTS、发布身份、恢复状态和响应式 sheet | 专用 acceptance；三视口 snapshot/screenshot；请求、console 与 overflow 检查 |

## 验证

```bash
npm test -- src/components/project-configuration-workbench/ProjectConfigurationWorkbench.test.tsx
npm test -- src/ParameterAdminNextPage.test.tsx src/appConfig.test.ts
npm test -- src/infrastructure/http/dtsStructuredClient.test.ts src/infrastructure/mock/mockDtsStructuredRepository.test.ts
npm run test:server -- server/modules/parameter-files
npm test
npm run test:server
npm run acceptance:coverage
npm run acceptance:operations
npm run acceptance:e2e -- e2e/acceptance/project-configuration-workbench.acceptance.spec.ts
npm run docs:check
npm run build
git diff --check
```

服务端全量测试使用与 post-cutover 验收库隔离的 fixture 数据库运行：
`TEST_DATABASE_URL=postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff_unit npm run test:server`。
种子验收库已按设计退役历史表，因此不能作为服务端单元/集成测试门禁库。

浏览器地址为 `http://127.0.0.1:5173/parameter-admin/projects/:projectId/configuration`。每个视口都保留 snapshot 与 screenshot，并验证真实入口、配置集/成员选择、tree/inspector/task sheet、重试状态、console、相关 network 以及 `scrollWidth == clientWidth`。

## Documentation Impact Matrix

| 区域 | 动作 | 路径/证据 |
| --- | --- | --- |
| 仓库地图 | Review | `AGENTS.md`、`ARCHITECTURE.md` |
| 计划 | Update | 本计划及英文伴随页；中英文 `PLANS.md` |
| 产品规格 | Review | `docs/product-specs/product-spec.md`、`prototype-functional-spec.md` |
| 架构/领域/ADR | Review | `CONTEXT.md`、ADR-0001/0012/0018、锁定双语设计 |
| 质量/测试 | Update | 双语验收地图、操作矩阵与 executable registries、专用 spec |
| 可靠性/runbook | Review | `docs/RELIABILITY.md`；预计无运行合同变化 |
| 安全/治理 | Review | `docs/SECURITY.md`；沿用 Admin 路由与服务端只读鉴权 |
| 前端/设计 | Update | `docs/FRONTEND.md`、`docs/zh-CN/frontend.md` |
| API 合同 | Update | 中英文 API 合同；必要时同步 OpenAPI artifact |
| 生成物 | Review | `docs/generated/db-schema.md`；无 migration |
| References | Review | `docs/references/productization-api-contract-draft.md` |

## Documentation Update Gate

- [x] 所有 `Update` 行均完成，适用处保持中英文伴随。
- [x] 每个 `Review` 行都已更新，或在计划中以证据明确记为无需修改。
- [x] 完成前已登记需求、操作和证据归属。
- [x] `npm run docs:check` 通过。
- [x] #228 无遗留 acceptance；#229–#240 既有后续不登记为本票技术债。

无需修改的 Review 证据：已逐项核对 `AGENTS.md`、`ARCHITECTURE.md`、`CONTEXT.md`、
ADR-0001/0012/0018、`docs/RELIABILITY.md`、`docs/SECURITY.md`、`docs/generated/db-schema.md`
与 `docs/references/productization-api-contract-draft.md`。本次只读边界未改变架构、领域、安全、可靠性、
数据库 schema 或产品化参考合同。规范路由/开关/API/验收变化已同步到中英文前端文档、API 合同、
原型功能规格、浏览器覆盖地图、操作矩阵、OpenAPI 生成物及本双语计划。

浏览器证据保存在 `work/ui-checks/project-configuration-workbench-readonly/`，覆盖项目清单入口、
桌面源码主导布局/覆盖检查器/44px 折叠任务栏、平板和手机 tree/inspector/task sheet，
以及 label 修复后的 `11-workbench-768x1024-after-label-fix.png`、
`12-workbench-390x844-after-label-fix.png`。三个视口均完成 snapshot、screenshot、console、network 与 overflow 检查。
