# 参数管理后台 · 组织配置信息架构收敛

> Status: **进行中** — 实现中（分支 `feat/parameter-admin-org-ia`）
> Date: 2026-08-03
> English: [`docs/exec-plans/active/2026-08-03-parameter-admin-org-ia-consolidation.md`](../../../exec-plans/active/2026-08-03-parameter-admin-org-ia-consolidation.md)
> 决策：[ADR-0015](../../../adr/0015-governance-queues-live-with-the-object-they-govern.md)
> 上位 IA：[ADR-0001](../../../adr/0001-parameter-admin-organized-by-governance-scope.md)（不变）
> 前序：[`2026-08-02-parameter-admin-ux-polish.md`](./2026-08-02-parameter-admin-ux-polish.md)（PR #221）

## 背景

组织配置下现有四个平级子导航：参数定义库、定义匹配审核、模块归属、节点对应确认。其中两个命名的是治理对象，两个命名的是对象上的工作队列，四者不构成同一层次。

实现上也已露出裂痕：`OrganizationSpecGovernancePanel` 同时承载定义库与匹配审核，仅靠 `focus` 拆成两条路由；`ParameterSpecLibrary` 本就有 `reviewQueueSlot`。模块侧则已示范正确范式：`/parameter-admin/modules` 是归属树，`/modules/queue` 是嵌套的未登记驱动队列，空队列时子导航可隐藏。

ADR-0015 记录决策；本计划排定落地顺序。

## 目标

组织配置只保留两个入口：

| 入口 | 路由 | 内容 |
| --- | --- | --- |
| 参数定义管理 | `/parameter-admin/specs` | 定义库内嵌匹配审核队列；节点对应确认嵌套其下 |
| 模块管理 | `/parameter-admin/modules` | 归属树 + 未登记驱动队列（不变） |

节点对应确认迁至 `/parameter-admin/specs/identity-mapping`。**导航入口**仅在有待处理任务时出现；**路由**始终可达，以免历史与重开在队列清空后断链。

## 非目标

- 不重开 ADR-0001（组织 / 项目仍平级）。
- 不改匹配审核、节点对应、定义生命周期的**决策语义**（无 API / 鉴权 / 审计行为变更）。
- 不合并「项目运营」下的项目级 tab。
- 不退役节点对应确认本身。

## Git & PR

分支：`feat/parameter-admin-org-ia`（#221 合入 `main` 后切出）。实现方只在该分支提交；父代理评审、开合 PR 并同步 `main`。路由与导航必须同批交付，避免中间态断链。

## 路由映射

| 旧 | 新 | 机制 |
| --- | --- | --- |
| `/parameter-admin/specs` | 同路径 | 同时渲染匹配审核队列 |
| `/parameter-admin/spec-review` | `/parameter-admin/specs` | 重定向，保留 query |
| `/parameter-admin/identity-mapping` | `/parameter-admin/specs/identity-mapping` | 重定向，保留 query |
| `/parameter-admin/modules` 等 | 不变 | — |

旧路径须长期保留重定向：验收操作 ID、覆盖矩阵与响应式质量用例仍引用它们。

## 必须关闭的风险（摘要）

| ID | 风险 |
| --- | --- |
| IA-R1 | 节点对应计数目前只在其面板挂载时写入；合并后默认不挂载会导致入口永远不出现 → 定义管理页须自行加载 open 计数 |
| IA-R2 | 计数加载失败不得读成「无任务」→ 区分 loading / error / empty |
| IA-R3 | 去掉两个一级入口会丢掉待办可见性 → 幸存子导航补徽标 |
| IA-R4 | 条件隐藏入口不得让历史不可达 → 路由常在；有历史时仍可发现 |
| IA-R5 | 长审核队列内嵌会撑爆页面 → 默认折叠或分页，并在 390×844 有队列时验收 |

## 交付批次（摘要）

1. **路由与重定向** — 收窄组织视图枚举；新增 specs 子视图；重定向旧路径；更新 path 单测。
2. **组合** — 去掉 `focus`；内嵌审核队列；嵌套挂载节点对应面板；独立加载计数与错误态；按 modules 先例条件渲染子导航。
3. **导航与文案** — 子导航两入口 + 徽标；文案改为「参数定义管理」「模块管理」；更新 TopBar 副标题；避免标题重复。
4. **测试 / 验收 / 文档** — 更新页面与 e2e 路径引用；注册并覆盖 `PARAM-ADMIN-IA-001`；走完文档影响矩阵；三视口 playwright-cli 证据（含非空队列与两条重定向）。

完整任务勾选、缝接点、文档更新门禁与验证命令以英文计划为准。

## 文档与验收

中文侧需同步的文件：`docs/zh-CN/PLANS.md`、`docs/zh-CN/frontend.md`、`docs/zh-CN/developer/browser-acceptance-coverage-map.md`、`docs/zh-CN/developer/user-operation-coverage-matrix.md`。

新增验收 ID：`PARAM-ADMIN-IA-001`（组织子导航仅两入口；定义管理内嵌审核队列；有 open 任务时出现节点对应入口；旧路由重定向保留 query）。`PARAM-IDENTITY-MAP-ADMIN-001` 经旧路径重定向应继续通过，兼作重定向回归。

```bash
npm test -- src/ParameterAdminNextPage.test.tsx src/ParameterAdminNextPage.a11y.test.tsx src/App.test.tsx
npm test -- src/application/parameters/parameterAdminOrganizationPath.test.ts
npm run build
npm run docs:check
npm run acceptance:coverage
npm run acceptance:operations
```
