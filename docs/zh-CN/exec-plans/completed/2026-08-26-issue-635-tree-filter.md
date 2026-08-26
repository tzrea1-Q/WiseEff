# Issue #635 可复用层级树筛选器

> English: [English](../../../exec-plans/completed/2026-08-26-issue-635-tree-filter.md)

**目标：** 增加一个数据无关的层级筛选 seam，供表格列表头筛选器和现有模块选择器复用，并迁移 `/parameters` 与 `/dts-reload` 的模块列筛选；不改变 API 或数据库合同。

**分支：** `codex/issue-635-tree-filter`，从本轮开始时的最新 `main` 创建。主工作区中与本计划无关的 `App.tsx` 和 `App.test.tsx` 修改不属于本计划。

**状态：** 实现和本地验证已完成；PR/合入仍由父智能体单独交接执行。

**架构：** 页面把注册表行适配为带稳定 ID 的扁平节点；共享树筛选域负责构建确定性树、保护孤儿/异常节点、规范化选中根、推导全选/半选状态、树内搜索，以及把选中根展开为行筛选集合。`ColumnFilter` 保留现有漏斗和固定定位弹层，`ModuleTreeSelect` 复用共享选项渲染器。参数注册表和调试注册表继续分离，不增加服务端 seam。

## 范围与验收覆盖

- 范围内：共享树模型/选择/搜索/键盘行为、`ColumnFilter` 树模式、`ModuleTreeSelect` 复用、参数和 DTS 重载模块列迁移、聚焦测试、设计系统 CSS 和中英文开发文档。
- 范围外：API/数据库/持久化变更、模块分类 CRUD、服务端选项分页、替换拓扑导航器、URL/保存筛选状态。
- 已复核的既有验收覆盖：`PARAM-HAPPY-001`、`DTS-RELOAD-HANDOFF-001`、`MOD-TREE-PARAM-001`、`MOD-TREE-DEBUG-001`、`SHELL-DIAG-001`。由于共享筛选交互目前不是阻塞式浏览器 operation，本实现增加组件/集成覆盖和三种视口的手工证据。

## 实施任务

- [x] 定义规范化节点模型、确定性树构建、异常节点保护、规范化选中根、子树展开、统计数和带路径搜索。
- [x] 增加可复用 `TreeFilterOptions`，支持半选复选框、树形 roving focus、键盘展开/导航、禁用结构节点、空状态和可组合的 Escape 关闭。
- [x] 扩展 `ColumnFilter` 树模式，同时保留平面模式、固定定位、外部点击、清除、逻辑根徽标和焦点返回。
- [x] 重构 `ModuleTreeSelect` 使用共享 seam，同时保留触发器、单选、多选筛选、portal 定位和可选 ID 约束。
- [x] 迁移 `/parameters` 与 `/dts-reload`，使用列筛选前作用域、连接祖先、子树统计、稳定 ID 和各自独立注册表。
- [x] 更新中英文 UX/前端文档，增加共享/消费者测试，并把浏览器证据记录到 `work/ui-checks/issue-635/`。
- [x] 执行最终聚焦/全量质量门禁、独立 Standards/Spec review，以及完成父智能体交接准备。

## 验证

```bash
npm test -- --run src/ParametersPage.test.tsx src/components/ParametersTable.test.tsx src/components/parameter-topology/DtsParameterWorkbench.test.tsx src/features/dts-reload/DtsReloadPage.test.tsx src/features/dts-reload/DtsReloadCandidateTable.test.tsx src/components/common/ModuleTreeSelect.test.tsx src/components/common/TreeFilterOptions.test.tsx src/components/ColumnFilter.test.tsx src/domain/tree-filter/treeFilter.test.ts src/application/parameters/buildModuleFilterNodes.test.ts
npm test -- --run --maxWorkers=4
npm run build
npm run lint
npm run ui:check
npm run docs:check
```

浏览器证据覆盖 mock 运行时的 `/parameters` 和 `/dts-reload`，视口为 `1440x900`、`768x1024`、`390x844`，并操作树内搜索、祖先保留、展开/收起、父节点选择、清除、Escape、外部点击和横向溢出检查，同时检查 console/network。现有本地服务另行检查 API 模式加载；本功能不改变 API 合同。

## Git 与 PR 流程

| 角色 | 允许操作 |
| --- | --- |
| 实现智能体 | 在 `codex/issue-635-tree-filter` 提交票据修改；不得推送 `main`、创建 PR 或合入。 |
| 父智能体 | 审查分支、创建/合入 GitHub PR，然后同步本地 `main`。 |

## 文档影响矩阵

| 范围 | 状态 | 文件 | 说明 |
| --- | --- | --- | --- |
| 仓库地图 | Review | `AGENTS.md`、`docs/FRONTEND.md`、`docs/zh-CN/frontend.md` | 前端 seam 和路由不变，前端参考文档已更新。 |
| 计划文档 | Update | 本计划及英文 companion | 记录分支、范围、门禁和证据。 |
| 产品规格 | No change | `docs/product-specs/` | 不改变产品流程或业务规则。 |
| 架构文档 | Review | `ARCHITECTURE.md`、`docs/design-docs/full-stack-architecture.md` | 不改变 API、持久化或注册表归属。 |
| 质量/测试文档 | Review | `docs/developer/verification-matrix.md`、`docs/developer/ui-quality-checklist.md` | 使用既有前端门禁，不增加命令。 |
| 可靠性/运行手册 | No change | `docs/reliability*`、`docs/runbooks/` | 不改变运行时或部署行为。 |
| 安全/治理文档 | No change | `docs/SECURITY.md`、`docs/security/` | 稳定 ID 只用于展示筛选，不涉及权限或写入。 |
| 前端/设计文档 | Update | `docs/design-docs/ux-table-column-filter.md`、`docs/zh-CN/design-docs/ux-table-column-filter.md`、`docs/FRONTEND.md`、`docs/zh-CN/frontend.md` | 记录树模式、稳定 ID、键盘、作用域和共享 seam。 |
| 生成物 | No change | `docs/generated/` | 不改 schema 或生成运行时产物。 |
| 参考资料 | No change | `docs/references/` | 不需要新增外部合同参考。 |
| 浏览器验收 | Review | `docs/developer/browser-acceptance-coverage-map.md`、`docs/developer/user-operation-coverage-matrix.md` | 已复核参数/模块/重载既有 ID；本地手工证据补充待自动化的树筛选覆盖。 |

## 文档更新门禁

- [x] 中英文前端/UX 文档描述共享层级筛选合同。
- [x] 已命名既有验收和 operation coverage ID；不改变 API 或数据库合同。
- [x] `npm run docs:check` 通过；本地缺少扩展时保留仓库已记录的 pgvector 验证 skip。
- [x] 最终聚焦/全量质量门禁和独立 Standards/Spec review 已完成；PR/合入仍由父智能体单独执行。
