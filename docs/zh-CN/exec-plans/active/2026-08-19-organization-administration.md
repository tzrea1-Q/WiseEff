# 组织管理

> English: [English](../../../exec-plans/active/2026-08-19-organization-administration.md)
> 状态：**进行中**——`feat/organization-administration` 实现已完成；父代理评审 / PR / `acceptance:browser` 仍待做
> 日期：2026-08-19
> 设计：[`docs/zh-CN/design-docs/2026-08-19-organization-administration-design.md`](../../design-docs/2026-08-19-organization-administration-design.md)
> ADR：[ADR-0037](../../../adr/0037-organization-administration-is-home-org-tenant-operations.md)（英文）

## 目标

把 Organization 做成 home-organization Admin 可运营的产品对象：诚实的本地入职（不再把部门当租户）、可见且可改显示名的组织档案，以及把现有用户治理收进 `/organization` 上的「组织管理」。

## 非目标

邀请（TD-119）、平台组织目录（TD-120）、项目成员 / 项目级角色（TD-121）、OIDC claim 重映射、新权限 `organization:manage`、把 Tenant 与 Department 拆成两个实体。

## Git 与 PR

| 角色 | 允许 |
| --- | --- |
| 实现代理 | 从最新 `main` 检出 `feat/organization-administration` 并提交；不得开或合并 GitHub PR |
| 父代理 | 审查、跑验证、开/合 PR，然后同步本地 `main` |

一条分支：`feat/organization-administration`。

## 阶段 1 — 停止制造部门租户

1. 本地注册不再要求部门组织字段。development 与非 development 的 `AUTH_PROVIDER=local` 都加入 Evaluation Organization（有种子则 ChargeLab，否则 bootstrap 那一家）。注册不得创建 `org-hardware-department` / `org-software-department`。
2. 认证页去掉硬件部 / 软件部下拉（`src/App.tsx`）。角色下拉里的学科保留。
3. `bootstrapLocalAdmin`：有 ChargeLab 则加入；否则用 bootstrap 名称创建或加入恰好一家（中性默认名，不再是硬件部）。0 家或多家且无明确目标则 fail-closed。
4. 不再把部门组织当作注册目标播种。把这些 id 上的用户、角色绑定、会话、待审批注册迁到部署 home organization（有种子的库是 ChargeLab）。
5. OIDC 的 claim → Organization 映射保持不变（D11）。
6. 测试：`localAuth`、`bootstrapLocalAdmin`、`app` 注册路径、前端认证页。

## 阶段 2 — 组织管理界面

1. `GET` / `PATCH /api/v1/organization` 只针对调用者的 home organization。`PATCH` 仅接受 `{ name }`，要求 `users:manage`，同一事务写 `organization-update`（ADR-0027）。名称：去空白、非空、有上限、不唯一。
2. 前端：侧栏「用户管理」改为「组织管理」；规范路径 `/organization`（组织档案）与 `/organization/members`（人员管理），切换对齐调试后台；`/user-permissions` 永久重定向到 `/organization/members`（保留查询串）。成员表继续用 `DataTable`。
3. 改名后下一次拉取 `/api/v1/me` 即新名称。Mock port 对齐。
4. **做 UI 之前**登记验收 ID：把 `PERM-USER-MGMT-001` / `PERM-GOV-001` / `PLAT-ROLE-002` 与入职 `PM-02` / `PM-03` 改挂 `/organization`；在覆盖图与操作矩阵（中英）增加 `ORG-ADMIN-RENAME-001`（Admin 改名 + 审计 + 非 Admin 403）。
5. 改挂 `e2e/acceptance/permissions.acceptance.spec.ts` 与 `permissions-matrix.acceptance.spec.ts`。

## 阶段 3 — 文档门禁

更新文档影响矩阵里每一行 Update。跑 `npm run docs:check`。

## 验证

- 定向 vitest：本地认证、bootstrap、组织路由、组织管理页、认证页。
- `npm run test:server`、`npm run build`、`npm run docs:check`。
- 对上述权限与入职 ID 跑 `npm run acceptance:browser`。
- 按前端 UI 门禁对 `/organization` 做 playwright-cli 三视口（1440×900 / 768×1024 / 390×844）snapshot + screenshot + console error。

## 成功标准

- 本地注册没有组织下拉；新账号能看见 ChargeLab（或唯一 bootstrap 组织）的项目。
- 注册不再插入部门组织 id。
- Admin 打开组织管理、改显示名后，成员页与 `/api/v1/me` 显示新标签；id 不变。
- `/user-permissions` 重定向。参数后台组织区不变。
- 非 Admin 不能 `PATCH /api/v1/organization`。成员侧的最后 Admin / 自锁死规则不变。

## UI 交互自动化

受影响规格：`permissions.acceptance.spec.ts`、`permissions-matrix.acceptance.spec.ts`，以及今天写着 `/user-permissions` 的本地账号入职覆盖（`PM-02`、`PM-03`）。阶段 2 UI 之前先加 `ORG-ADMIN-RENAME-001`。操作证据仍走 `npm run acceptance:browser` / `npm run acceptance:evidence`。

## 文档影响矩阵

| 区域 | 动作 | 路径 |
| --- | --- | --- |
| 仓库地图 | Review | `ARCHITECTURE.md` + 中文 — 仅当 users 模块新增值得列出的 home-org 路由时补一句 |
| 计划 | Update | 本计划 + 英文；`docs/PLANS.md` + 中文（本次） |
| 产品规格 | Update | `new-user-onboarding.md` 中英；若摘要仍写部门下拉则改 `product-specs/index.md` — 阶段 1/2 |
| 领域 / 词表 | Update | `CONTEXT.md`、ADR-0037、领域模型中英（锁定时已做）；实现期间保持诚实 |
| 设计文档 | Update | 本设计 + 英文（已做）；`design-docs/index.md` 中英（本次） |
| API | Update | `docs/api/authentication.md` 中英；api-contract 中英；OpenAPI — 阶段 1/2 |
| 前端 | Update | `docs/FRONTEND.md` + `docs/zh-CN/frontend.md` — 阶段 1/2 |
| 安全 | Update | `docs/SECURITY.md` 中英；user-permission-design 中英 — 阶段 2 |
| 可靠性 / runbook | Update | 自托管运行时与平台超管 runbook 中英（若仍写「选部门却进 ChargeLab」） |
| 开发环境 | Update | `environment-variables.md` 中英（加入 ChargeLab 是产品规则，不是 `NODE_ENV` 谎言）— 阶段 1 |
| 质量 / 验收 | Update | 覆盖图与操作矩阵中英；权限规格 — 阶段 2 |
| 生成物 | Review | 仅当迁移加列时更新 `db-schema.md`（v1 不应加列） |
| 参考 | No change | `docs/references/` |
| 技术债 | Update | TD-119 / TD-120 / TD-121（本次） |

## 文档更新门禁

在每一行 Update/Review 已更新或有「未改」证据、`npm run docs:check` 通过、新验收 ID 已自动化或带诚实的 `@acceptance-planned` 之前，本计划不得移入 `completed/`。
