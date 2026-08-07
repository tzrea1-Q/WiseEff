# 项目配置工作台可恢复会话草稿（#234）

> 状态：**已完成**
> 日期：2026-08-07
> 分支：`feat/project-configuration-workbench-session-drafts`
> Issue：[#234](https://github.com/tzrea1-Q/WiseEff/issues/234)，父级 [#227](https://github.com/tzrea1-Q/WiseEff/issues/227)
> 阻塞项：[#233](https://github.com/tzrea1-Q/WiseEff/issues/233)（已合并）
> English：[English](../../../exec-plans/completed/2026-08-07-project-configuration-workbench-session-drafts.md)
> 设计：[项目配置工作台](../../design-docs/2026-08-06-project-configuration-workbench-design.md)（PCW-D12，§11.2）
> 起点：`3b421093`（含 #233 的最新 `origin/main`）

## 目标

在不削弱过期基线安全的前提下，让结构化 DTS 编辑会话可恢复。导航或刷新后，同一用户与同源基线的兼容会话草稿应被恢复；基线变更后保留草稿内容供检查/复制，但在编辑者显式相对当前基线重新确认之前，禁止校验与提交。

## 范围与成功标准

1. 会话草稿按已认证用户、组织、项目、配置集、文件与基文件版本作用域隔离。
2. 持久化仅存补丁、原因与稳定源身份，不复制整份项目源文件。
3. 兼容的会话变更、已选子集与原因在导航或刷新后恢复。
4. 基线变更将恢复的变更标为过期，并阻止相对新源的校验/提交。
5. 过期内容仍可检查与复制；仅通过显式重新确认/变基回到合法 dirty 态。
6. 存在未提交变更时离开，使用共享离开确认契约（`ConfirmDialog`）。
7. 登出清空可恢复草稿；禁止跨用户、组织、项目或配置集恢复。
8. 来自先前项目或源基线的迟到异步响应不得写入当前会话。
9. 浏览器重载/导航与定向状态测试证明兼容恢复、过期基守卫、隔离与丢弃；登记 `PROJ-CONFIG-DRAFT-001`。

## 非目标

- 候选激活 / 冲突仲裁 / 活动时间线 / 文件-配置操作后续（#232/#235/#236/#239 另票）。
- 源码画布自由文本编辑。
- 新 HTTP API 或服务端草稿存储。
- 对 `ProjectConfigurationWorkbench` 超出草稿持久化 / 离开 / 过期缝之外的大范围重构。
- Issue #235。

## 架构与缝

| 缝 | 行为 | TDD 证据 |
| --- | --- | --- |
| `sessionDraftStorage` | 作用域本地持久化补丁/原因/选择；分类兼容 vs 过期基 vs 不匹配；登出清空 | `sessionDraftStorage.test.ts` |
| 工作台 hydrate/persist | 挂载/文件作用域恢复；编辑时持久化；替换硬清空；世代守卫防迟到异步 | `ProjectConfigurationWorkbench` 测试 |
| 过期基守卫 | 阻断校验/提交；检查/复制；显式重新确认 → dirty | 组件测试 |
| 离开确认 | 脏返回导航使用共享 `ConfirmDialog` | 组件测试 |
| 登出 | App 登出路径调用 `clearSessionDraftsForLogout` | 单元 + App 接线 |
| API 模式浏览器 | `PROJ-CONFIG-DRAFT-001` | 验收覆盖 + e2e |

测试只观察公共行为（不测私有 reducer / effect 顺序 / CSS 内部）。

## 任务

### 0. 登记计划

- [x] 创建双语 active plan，并写入 EN/ZH `PLANS.md` 当前活动计划列表。
- [x] 认领 issue #234。
- [x] 锁定上述 TDD 缝。

### A. 作用域草稿存储

- [x] Red：按 user/org/project/configSet/file/baseVersion 持久化/加载；只存补丁+原因+身份。
- [x] Red：分类兼容 / 过期基 / 不匹配；登出清空；禁止跨作用域恢复。
- [x] Green：实现可注入 `Storage` 的 `sessionDraftStorage.ts`。

### B. 工作台恢复、离开、过期守卫

- [x] Red：重挂载后兼容恢复；过期阻断校验/提交；重新确认回到 dirty；离开 ConfirmDialog；忽略迟到异步。
- [x] Green：`ProjectConfigurationWorkbench` 薄接线；面板传入 `currentUserId`；使用配置集 `organizationId`；App 登出清空。

### C. 验收 + 文档 + 完成

- [x] 登记 `PROJ-CONFIG-DRAFT-001`（EN/ZH 覆盖图、`requirements.ts`、`operationMatrix.ts`、e2e）。
- [x] 更新 FRONTEND（及 ZH）：恢复 / 过期 / 离开 / 登出。
- [x] 跑验证矩阵、三视口 UI 证据、Standards vs Spec 相对 merge-base 审查并修复。
- [x] 门禁通过后将计划移入 `completed/` 并勾选完成项。

## 验证

```bash
npm test -- src/components/project-configuration-workbench
npm test
npm run acceptance:coverage && npm run acceptance:operations
npm run acceptance:e2e -- e2e/acceptance/project-configuration-workbench.acceptance.spec.ts
npm run docs:check
npm run build
```

前端可见变更：playwright-cli 三视口 `1440x900`、`768x1024`、`390x844`，证据目录 `work/ui-checks/project-configuration-workbench-session-drafts/`。

## 文档影响矩阵

| 区域 | 动作 | 路径 / 证据 |
| --- | --- | --- |
| 计划 | Update | 本计划 + EN 同伴；`docs/PLANS.md`；`docs/zh-CN/PLANS.md` |
| 前端 / 设计 | Update | `docs/FRONTEND.md`、`docs/zh-CN/frontend.md` |
| API 契约 | No change | 仅本地持久化 |
| 质量 / 测试 | Update | EN/ZH 验收图与操作矩阵；`requirements.ts`、`operationMatrix.ts`、e2e |
| 生成物 | No change | 无 OpenAPI/库表变更 |
| 仓库地图 | Review | `AGENTS.md`、`ARCHITECTURE.md` |
| 产品规格 | Review | 仅在交付工作流过时时更新 |
| 架构 / 领域 / ADR | Review | 锁定设计 PCW-D12 / §11.2 已规定行为 |
| 可靠性 / 安全 | Review | 如需确认本地草稿隔离措辞则更新 `docs/SECURITY.md` |
| 环境 | No change | 无新开关 |

## 文档更新门禁

- [x] 每个 `Update` 行已在英/中交付（适用时）。
- [x] 每个 `Review` 行已更新或在此记录为不变并附证据。
- [x] 验收需求/操作覆盖与证据归属在完成前已登记。
- [x] `npm run docs:check` 通过。
- [x] 无遗留 #234 验收；后续属 #227 其他子票（如 #235）。

未变更行的审查证据：
- **API 契约 / 生成物**：无变更——仅本地 `sessionDraftStorage`；无新公共 HTTP 字段、OpenAPI 或库表更新。
- **可靠性 / 安全**：`docs/SECURITY.md` 未改——草稿隔离为客户端作用域；认证 token 的 localStorage 处理已在别处说明，本票未改动。
- **仓库地图**：`AGENTS.md` / `ARCHITECTURE.md` 未改——未超出既有工作台包的模块边界。
- **产品规格**：product-spec / prototype-functional-spec 未改——交付工作流与锁定设计一致。
- **架构 / 领域 / ADR**：设计 PCW-D12 / §11.2 已规定可恢复草稿、过期基、离开确认与登出清空；无需 ADR 更新。
- **环境**：无超出既有 `VITE_PROJECT_CONFIGURATION_WORKBENCH_ENABLED` 的新开关/变量。

## 收尾说明

于 2026-08-07 在 `feat/project-configuration-workbench-session-drafts` 完成。

**已交付**
- `sessionDraftStorage.ts`（+ 测试）：按 user/org/project/configSet/file/baseVersion 作用域持久化/加载；仅存补丁+原因+身份；分类兼容 / 过期基 / 不匹配；登出清空；禁止跨作用域恢复。
- 工作台 hydrate/persist/stale/leave：重挂载/文件作用域恢复；编辑时持久化；过期阻断校验/提交但仍可检查；显式重新确认 → dirty；离开使用共享 `ConfirmDialog`；世代守卫忽略迟到异步。
- App 登出接线：登出路径调用 `clearSessionDraftsForLogout`；面板传入 `currentUserId`；使用配置集 `organizationId` 作为作用域。
- 验收：`PROJ-CONFIG-DRAFT-001` 已登记 EN/ZH 覆盖图、`requirements.ts`、`operationMatrix.ts` 与 e2e；FRONTEND（及 ZH）已更新恢复 / 过期 / 离开 / 登出。

**本地验证已通过**
- `npm test -- src/components/project-configuration-workbench`
- `npm test`
- `npm run acceptance:coverage` && `npm run acceptance:operations`
- `npm run acceptance:e2e -- e2e/acceptance/project-configuration-workbench.acceptance.spec.ts`
- `npm run docs:check`
- `npm run build`
- playwright-cli 三视口证据：`work/ui-checks/project-configuration-workbench-session-drafts/`（gitignore）

**已知缺口**
- 避开 e2e 登出 UI 路径：AUTH 登出返回 404，且 cpk 叠层干扰；改以 storage 清空契约测试 + App 登出接线覆盖。
- 源码上下文深链恢复 node/property 为部分能力——文件身份可经 URL 恢复；更细的 node/property 深链恢复仍有限。
