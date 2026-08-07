# 项目配置工作台源码定位导航（#229）

> 状态：**已完成**
> 日期：2026-08-07
> 分支：`feat/project-configuration-workbench-source-nav`
> Issue：[#229](https://github.com/tzrea1-Q/WiseEff/issues/229)，父 Issue [#227](https://github.com/tzrea1-Q/WiseEff/issues/227)
> English: [English](../../../exec-plans/completed/2026-08-07-project-configuration-workbench-source-nav.md)
> 设计：[项目配置工作台](../../design-docs/2026-08-06-project-configuration-workbench-design.md)
> 起点：`86428500`

## 目标

让只读项目配置工作台具备源码定位与可分享深链。结构读暴露稳定的文件/节点/属性源码定位器；源码树、统一搜索、URL 深链与 DTS 画布用这些身份在配置集成员文件间导航，并在刷新后精确恢复上下文。

## 范围与成功标准

1. 结构读为节点与属性提供稳定源码 span（偏移 + 行列），在 ingest 时持久化，GET 时不重新解析即可返回。
2. 选择节点或属性时滚动并高亮精确源码 span，且不改变 Working configuration。
3. 源码滚动更新最近可见树选择，且不抢夺键盘焦点。
4. 统一搜索覆盖文件名、节点路径、单元地址、label、compatible、属性名与属性值；UI 按文件分组结果。
5. 搜索结果可跨文件跳转，同时保留配置集上下文并更新规范 URL。
6. 配置集、文件、节点、属性、sourceMode 及适用的检查器/任务查询状态在刷新后保留；无效值安全回退。
7. 树元数据与源码独立加载；源码失败时保留树选择与发布身份，且仅重试失败读取。
8. 键盘支持搜索、下一结果、行跳转、树/源码焦点，且不覆盖浏览器/系统快捷键。
9. 公开契约（OpenAPI/routeManifest/schemaRegistry）、源码定位映射、路由、无障碍与 API 模式浏览器验收 `PROJ-CONFIG-SOURCE-001` 证明外部行为。
10. 定向与完整验证门禁、文档门禁、构建、三视口 UI 证据，以及相对 `86428500` 的 Standards/Spec 评审通过。

## 非目标

- 候选上传/激活（#231+）、结构化属性 EDIT 提交（#233）、冲突、发布就绪度、切换。
- 自由文本 DTS 编辑（画布保持只读）。
- 把拓扑工作区塞进本路由；span 提升到结构读契约。
- 从 `codex/prototype-config-workbench` / `e941f236` merge、cherry-pick 或复制实现。
- 实施 agent 不关闭 #229、不建/合 PR。

## 架构与测试边界

| Seam | 行为 | TDD 证据 |
| --- | --- | --- |
| Port / domain | `DtsStructuralNode`/`Property`/`DtsSearchHit` 暴露稳定定位器；搜索含文件名 + 统一/全维度；UI 按文件分组 | port 类型 + mock/client 合同；工作台搜索 UI |
| Server structural | ingest 持久化 span；structure GET 不重解析返回 | ingest / repository / read + route |
| Server search | hits 带定位器；文件名匹配；保持 org/project 范围；可选省略 `by`=全部 | search repository / route |
| HTTP + mock 对齐 | client 与 mock teaching fixtures 含 spans | client + mock 测试 |
| Workbench 组件 | 成员下嵌套树；选择→滚动高亮；源码滚动→最近树选择且不抢焦点；URL `node`/`property`/`sourceMode`；统一搜索；独立加载/重试；键盘 | 工作台 / viewer 组件测试 |
| Contracts | structure + search 的 OpenAPI/routeManifest/schemaRegistry 含 spans | 契约测试 + 生成 OpenAPI |
| API 浏览器 | `PROJ-CONFIG-SOURCE-001` | acceptance + playwright-cli |

测试只观察公开行为（不测私有 reducer / effect 顺序 / CSS 内部）。

## Git & PR Workflow

| 角色 | 权限 |
| --- | --- |
| 实施 agent | 在 `feat/project-configuration-workbench-source-nav` 提交；**不** push/merge `main`、不建 PR、不关闭 #229 |
| 父 agent | 复核提交、建/合 PR、同步本地 `main`，验收后关闭 #229 |

分支起点为 `86428500`（PR #242 / 只读工作台合并提交）。

## 任务

### 0. 注册计划

- [x] 创建双语 active plan，并写入 EN/ZH `PLANS.md` Current Active Plan 列表。
- [x] 锁定上方 TDD seams（已与父 agent 确认）。

### A. 持久化结构 span（迁移 + ingest）

- [x] Red：断言 ingest 从 CST span 持久化节点/属性偏移与行列。
- [x] Green：迁移 `0092_dts_structural_spans.sql`；抽取共享 `offsetToLineColumn`；更新 `replaceDtsStructuralModel`。

### B. 结构读与 FE ports 暴露 spans

- [x] Red/Green：扩展 DTO、zod、FE port、read SELECT、HTTP client、mock teaching nodes。

### C. 登记契约

- [x] 在 routeManifest / schemaRegistry / OpenAPI 登记 structure + dts-search（含 span 字段）。

### D. 搜索定位器 + 文件名 + 全维度

- [x] Red/Green：hits 带定位器；文件名匹配；省略 `by`=全部；mock 对齐。

### E. 源码 viewer focus span

- [x] Red/Green：扩展或包装 `ProjectPrimaryDtsViewer` 支持多行 focus span；保留 find-next。

### F. 工作台接线

- [x] Red/Green：`getStructure` 嵌套树、PrimaryDtsViewer、URL 深链、按文件分组统一搜索、滚动同步、独立重试、键盘。

### G. 验收 + 文档 + 收尾

- [x] 登记 `PROJ-CONFIG-SOURCE-001`（覆盖图、requirements、operationMatrix、e2e）。
- [x] 更新 FRONTEND、api-contract（及必要时 env）、双语计划。
- [x] 跑验证矩阵、三视口 UI 证据、相对 `86428500` 的 Standards/Spec 评审并修复。
- [x] 门禁通过后将计划移入 `completed/` 并勾选任务。

## 浏览器验收映射

| 需求 | 操作 | 验收行为 | 证据 |
| --- | --- | --- | --- |
| `PROJ-CONFIG-SOURCE-001` | `PROJ-CONFIG-SOURCE-001` | Admin 打开开关后的工作台；选择节点/属性→源码滚动高亮；源码滚动更新树且不抢焦点；统一搜索按文件分组并可跨文件跳转且保留配置集；URL 深链恢复；独立源码重试；键盘搜索/下一结果/行跳转/焦点 | 专用 acceptance + `work/ui-checks/project-configuration-workbench-source-nav/` |

## 验证

开发循环（定向）：

```bash
npm run test:server -- server/modules/parameter-files/structuralIngest.test.ts
npm run test:server -- server/modules/parameter-files
npm test -- src/components/project-configuration-workbench
npm test -- src/infrastructure/http/dtsStructuredClient.test.ts src/infrastructure/mock/mockDtsStructuredRepository.test.ts
```

完成门禁：

```bash
npm test
TEST_DATABASE_URL=postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff_unit npm run test:server -- server/modules/parameter-files
npm run acceptance:coverage && npm run acceptance:operations
npm run acceptance:e2e -- e2e/acceptance/project-configuration-workbench.acceptance.spec.ts
npm run docs:check
npm run build
```

前端可见：playwright-cli 三视口 `1440x900`、`768x1024`、`390x844`，快照+截图存于 `work/ui-checks/project-configuration-workbench-source-nav/`；检查控制台错误。本地开发需 `VITE_PROJECT_CONFIGURATION_WORKBENCH_ENABLED=true`。

评审门禁：相对固定点 `86428500` 与 #229 并行 Standards vs Spec 评审；修复后重跑受影响测试。

## 文档影响矩阵

| 区域 | 动作 | 路径 / 证据 |
| --- | --- | --- |
| 计划 | Update | 本计划 + ZH；`docs/PLANS.md`；`docs/zh-CN/PLANS.md` |
| 前端 / 设计 | Update | `docs/FRONTEND.md`、`docs/zh-CN/frontend.md` |
| API 契约 | Update | api-contract EN/ZH；structure + dts-search OpenAPI |
| 质量 / 测试 | Update | EN/ZH 覆盖图与操作矩阵；requirements / operationMatrix / e2e |
| 生成物 | Update | `docs/generated/openapi.json`；必要时 `db-schema.md` |
| 仓库地图 | Review | `AGENTS.md`、`ARCHITECTURE.md` |
| 产品规格 | Review | 仅在交付工作流过时时更新 |
| 架构 / 领域 / ADR | Review | 不把拓扑工作区塞进本路由 |
| 可靠性 / 安全 | Review | RELIABILITY / SECURITY |
| 环境 | Review | 仅当新增超出既有工作台开关的变量时更新 |

## 文档更新门禁

- [x] 每个 `Update` 行已交付（适用时双语）。
- [x] 每个 `Review` 行已更新或在此记录为未变并附具体证据。
- [x] 验收需求/操作覆盖与证据归属在完成前已登记。
- [x] `npm run docs:check` 通过。
- [x] 无遗留 #229 验收项；后续属于 #227 后续子 Issue。
