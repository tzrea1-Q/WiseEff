# 参数管理后台重设计 — 执行计划

> English: [`docs/exec-plans/active/2026-07-25-parameter-admin-redesign.md`](../../../exec-plans/active/2026-07-25-parameter-admin-redesign.md)
> ADR：[`0001`](../../../adr/0001-parameter-admin-organized-by-governance-scope.md)、[`0002`](../../../adr/0002-mock-runtime-serves-the-semantic-parameter-model.md)
> 分支：`feat/refactor-parameter-admin`

## 问题陈述

管理员无法对参数管理后台形成稳定的心智模型。本该在一起的治理工作被切散，本该在别处的工作又渗了进来。

- 同一条路由在两种运行时模式下是两种产品。mock 模式渲染的是身份 cutover 已经退役的扁平参数库，API 模式渲染的是规格治理、审核队列与驱动映射。共用对话框在内部按模式分叉，同一个按钮含义不同。
- DTS 管理被切成两半。规格与 vendor schema 治理在参数库区域，而文件上传/版本、配置集、发布基线、dtc 门禁、结构浏览被埋在项目区域的一个全屏 modal 里。该 modal 无法深链，刷新即丢状态。
- identity mapping 治理位于日常参数工作台，与「后台治理 identity mapping 任务」的既有产品边界相矛盾。
- 项目区域不是一级导航目的地，只能通过子导航 tab 到达。
- 导航文案仍在描述「电池与充电参数数据库、批量导入」，与该界面现在实际承担的职责不符。

这些都不是随手写坏的代码 —— 相关路径中不存在任何 TODO 或 FIXME 标记。它是十几个连续执行计划留下的沉积：每一层都正确落地了，但没有一层被拆除。

## 解决方案

把参数管理后台重建为**一个**产品、**一条**组织主轴，并让旧界面在一个明确的步骤中退场。

治理作用域成为主轴（ADR-0001）。组织级治理与项目级运维是平级的一级区域。项目级运维获得真实路由，管理员可以把链接直接发给同事，刷新也不会丢失位置。

运行时模式不再改变产品形态（ADR-0002）。mock 模式通过同一组 port 提供同一套语义模型，因此只有一棵组件树、一套概念、一套测试。

identity mapping 任务迁入后台。日常绑定工作留在工作台。

## 实现决策

**变更范围。** 前端产品重设计、信息架构重划、参数管理后台实现重写。后端语义不变。

**组织主轴。** 按 ADR-0001 采用治理作用域。组织级治理涵盖参数规格库、规格审核队列、模块树与驱动映射、批量导入。项目级运维涵盖参数文件与版本、配置集、发布基线、修订校验与 dtc 门禁、源结构浏览、文件与草稿冲突裁决。项目级运维以路由寻址，不再使用 modal。

**运行时模式。** 按 ADR-0002，为参数拓扑 port 补充 mock 适配器，并移除拓扑 runtime seam 中的模式闸。后台在两种模式下渲染同一棵组件树。mock fixtures 必须表达语义模型（规格、规格版本、绑定、拓扑树、审核任务、映射任务、校验运行），而不是已退役的扁平库。

**能力归属。** identity mapping 任务治理从工作台迁入后台。源结构浏览、文件与草稿冲突裁决、修订校验留在后台。组织策略目标与业务分类在归属上属于后台，但本计划只在信息架构中留位，不构建面板。TD-043 的可选 L2 工具链面板同样不在范围内。

**后端。** 不改动路由、契约或 schema。前端新增一个统一的后台应用层，把现有 v1（后台项目/模块/文件/导入）与 v2（规格/拓扑/模块映射）客户端包住，使任何面板都不再直接持有多个客户端。仅当某个必需视图无法基于现有端点组合、且会导致 N+1 取数时才新增聚合读接口；若新增，须在同一变更中更新 `server/modules/contracts/routeManifest.ts` 与契约测试。

**状态归属。** 后台拥有专属 reducer 与 Context，承载跨面板关切：当前项目、当前配置修订、队列计数、undo 栈、审计提示。面板内部细节仍由面板自持。后台不读取全局应用状态。筛选、排序、选择与当前区域仍以 URL 为准。

**退场方式。** 新组件树与旧界面并行建设。不设运行时 feature flag，因为没有已部署环境或生产用户需要保护。末尾任务删除旧后台页面、后台专属 reducer action，以及仅被这些页面使用的 legacy 辅助代码。`configDraft.parameterLibrary` 作为共享 mock 种子数据保留，供项目初始化向导、power-management 配置、mock 参数仓库与项目取值矩阵使用。

**legacy 约束。** 新后台不得新增对过渡期扁平模块文本列（TD-038）或 `(name, module)` 路径派生身份回退（TD-039）的依赖。本计划不清理这两项。

**视觉语言。** 沿用现有 design tokens 与组件风格。这是结构重设计，不是视觉换肤。

**导航文案。** 后台各区域的导航标签、标题、副标题与小泽上下文摘要按作用域区域重写。项目区域从派生路径特例升级为一级导航项。

## 测试决策

**什么算好测试。** 测试挂载真实的后台路由树，在 port 边界注入 mock 适配器，以管理员的方式驱动它，只断言管理员可见或可验证的内容：渲染出的行、队列状态、处置结果、加载与错误态、审计记录、URL 状态。不断言 reducer action 形状、组件内部状态或面板组合方式。

**单一接缝。** port 边界是唯一测试接缝，通过路由级渲染驱动。优先使用既有 port（`ParameterTopologyRepository`、`ParameterFileRepository`、`DtsStructuredRepository`、`ParameterModuleRegistryRepository`），不引入新接缝。

**既有范式。** `src/ParameterAdminPage.test.tsx`、`src/ParameterAdminProjectsPage.test.tsx`、`src/components/parameter-topology/ApiProjectTopologyWorkspace.test.tsx` 已经是「对注入仓库渲染页面」的写法，新测试沿用。可访问性门禁沿用 `src/ParameterAdminPage.a11y.test.tsx`。

**退役 reducer 直测。** `src/appReducer.parameterAdmin.test.ts` 直接断言 reducer 迁移，在本接缝下属于测实现细节，不迁移；其覆盖的行为改由路由级测试表达。

**mock 适配器测试。** 新的 mock 拓扑适配器自带测试，参照 `src/infrastructure/mock/mockDtsStructuredRepository.test.ts` 与 `mockParameterFileRepository.test.ts`。

**浏览器验收。** 既有验收用例须在新路由下通过。受路由变更影响的有 `PARAM-ADMIN-001`、`PARAM-ADMIN-002`、`PARAM-IMPORT-DTS-FULL-001`、`PARAM-IMPORT-REVIEW-META-001`、`MOD-TREE-PARAM-001`、`MOD-TREE-PARAM-002`、`MOD-TREE-AUTHZ-001`、`PARAM-FILE-UPLOAD-001`、`PARAM-DTS-CONFIGSET-001`、`PARAM-SPEC-GOVERN-001`、`PARAM-FILE-ADMIN-001`。identity mapping 迁入后台目前没有对应操作 ID，本计划须在实现前于 `docs/developer/user-operation-coverage-matrix.md` 新增操作 ID，并在 `docs/developer/browser-acceptance-coverage-map.md` 新增对应需求 ID。

**浏览器验证。** 每条受影响路由按 `AGENTS.md` 要求在 1440x900、768x1024、390x844 三个视口用 `playwright-cli` 检查，含 snapshot、screenshot 与 console error。

## 范围外

- 重写 `/parameters` 参数工作台的实现。它的归属边界在范围内，内部实现不在。它在 2026-07-19 至 2026-07-21 间刚被重设计三轮，不是本计划要解决的那团乱。
- 后端路由、契约或 schema 重设计，包括任何 v1/v2 收敛。
- TD-042。本计划既不解决它，也不允许声称新后台已达生产 cutover 就绪。
- TD-038 过渡期扁平模块列与 TD-039 残余路径派生身份回退的清理。
- 组织策略目标与业务分类的新面板。
- TD-043 的可选 Admin L2 工具链校验面板。
- 视觉改版或 design token 变更。
- 角色与权限模型变更。

## Git 与 PR 流程

| 角色 | 允许 |
| --- | --- |
| 实现 | 基于 `main` 在 `feat/refactor-parameter-admin` 上工作，在特性分支提交 |
| 实现 | 不得推送 `main`、开启/合并 PR，或快进本地 `main` |
| 父代理 / 会话负责人 | 审阅、开 PR、合并、同步本地 `main` |

## 任务

工单位于 GitHub 父议题 [#188](https://github.com/tzrea1-Q/WiseEff/issues/188) 之下，并已挂上原生阻塞依赖。每张工单都是一颗曳光弹，须落到可运行状态；工单之间构建保持绿色，因为新后台在临时路由上建设，直到工单 09 才接管正式路由。

- [ ] [#189](https://github.com/tzrea1-Q/WiseEff/issues/189) — 01 预重构：mock 运行时模式获得语义参数模型。无阻塞
- [ ] [#190](https://github.com/tzrea1-Q/WiseEff/issues/190) — 02 新后台骨架与组织级规格治理。阻塞于 01
- [ ] [#191](https://github.com/tzrea1-Q/WiseEff/issues/191) — 03 组织级模块树与驱动映射。阻塞于 02
- [ ] [#192](https://github.com/tzrea1-Q/WiseEff/issues/192) — 04 组织级批量参数导入。阻塞于 02
- [ ] [#193](https://github.com/tzrea1-Q/WiseEff/issues/193) — 05 项目级路由：项目清单与参数文件。阻塞于 02
- [ ] [#194](https://github.com/tzrea1-Q/WiseEff/issues/194) — 06 项目级配置集、发布基线与修订校验。阻塞于 05
- [ ] [#195](https://github.com/tzrea1-Q/WiseEff/issues/195) — 07 项目级源结构浏览与冲突裁决。阻塞于 05
- [ ] [#196](https://github.com/tzrea1-Q/WiseEff/issues/196) — 08 identity mapping 任务治理迁入后台。阻塞于 02
- [ ] [#197](https://github.com/tzrea1-Q/WiseEff/issues/197) — 09 收缩：新后台接管正式路由与导航。阻塞于 02–08
- [ ] [#198](https://github.com/tzrea1-Q/WiseEff/issues/198) — 10 收缩：验收覆盖重定向与三视口验证。阻塞于 09
- [ ] [#199](https://github.com/tzrea1-Q/WiseEff/issues/199) — 11 收缩：删除旧后台与其专属状态。阻塞于 10

## 文档影响矩阵

| 领域 | 动作 | 路径 |
| --- | --- | --- |
| 仓库地图 | 复核 | `AGENTS.md`、`ARCHITECTURE.md` —— 确认主轴变更后后台描述仍成立 |
| 规划 | 更新 | `docs/PLANS.md`、`docs/zh-CN/PLANS.md`、本计划及英文对照页 |
| 领域上下文 | 更新 | `CONTEXT.md`、`docs/adr/0001-...md`、`docs/adr/0002-...md` |
| 产品规格 | 更新 | `docs/product-specs/prototype-functional-spec.md` —— 后台边界与 identity mapping 位置 |
| 架构 / 设计 | 更新 | `docs/design-docs/full-stack-architecture.md`、`docs/design-docs/domain-model.md` —— 后台与工作台边界、运行时模式对等 |
| 前端 | 更新 | `docs/FRONTEND.md`、`docs/zh-CN/frontend.md` —— 路由、port、mock 对等、状态归属 |
| 质量 / 测试 | 更新 | `docs/developer/user-operation-coverage-matrix.md`、`docs/developer/browser-acceptance-coverage-map.md`、`docs/design-docs/testing-strategy.md` |
| 验证 | 复核 | `docs/developer/verification-matrix.md` —— 确认门禁清单仍正确 |
| 技术债 | 更新 | `docs/exec-plans/tech-debt-tracker.md`、`docs/zh-CN/exec-plans/tech-debt-tracker.md` —— 记录任何延后项；注明 TD-042 不变 |
| API 契约 | 复核 | `docs/design-docs/api-contract.md`、`docs/api/README.md` —— 预期无变化，除新增聚合端点外记为不变 |
| 安全 / 治理 | 复核 | `docs/SECURITY.md` —— 角色与审计不变；确认迁移后的 identity mapping 审计覆盖 |
| 可靠性 / 运维手册 | 复核 | `docs/runbooks/parameter-identity-cutover.md` —— 生产规则不变 |
| 生成的 schema | 无变化 | — |
| 参考资料 | 复核 | `docs/references/productization-api-contract-draft.md` |

## 文档更新门禁

阻塞性。所有「更新」与「复核」行必须已完成或已附证据记为不变，本计划才能移入 `completed/`。延后项计入 `docs/exec-plans/tech-debt-tracker.md`。标记完成前运行 `npm run docs:check`。

## 验证

```bash
npm test -- --run src/infrastructure/mock src/ParameterAdmin
npm run build
npm run docs:check
npm run acceptance:browser
```

每条受影响路由用 `playwright-cli` 在 1440x900、768x1024、390x844 验证，含 snapshot、screenshot、console error 与网络检查。

## 补充说明

参数管理后台与 DTS 的前端路径中不存在 TODO、FIXME 或 HACK 标记。每一层都是有意建成的，问题在于没有一层被拆除。审阅者应当预期这里需要的是判断而非显而易见的删除，而退场任务正是这些判断集中之处。

`configDraft.parameterLibrary` 看起来像后台状态，实际不是。项目初始化向导、power-management 配置、mock 参数仓库与项目取值矩阵都在读它，删除会破坏本计划并未触及的界面。
