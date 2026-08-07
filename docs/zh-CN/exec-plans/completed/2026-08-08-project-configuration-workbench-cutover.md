# 项目配置工作台规范路由切换（#240）

> 状态：**已完成**
> 日期：2026-08-08
> 分支：`feat/project-configuration-workbench-cutover`
> Issue：[#240](https://github.com/tzrea1-Q/WiseEff/issues/240)，父议题 [#227](https://github.com/tzrea1-Q/WiseEff/issues/227)
> English：[English](../../../exec-plans/completed/2026-08-08-project-configuration-workbench-cutover.md)
> 设计：[项目配置工作台](../../design-docs/2026-08-06-project-configuration-workbench-design.md) Phase 6

## 目标

将项目配置工作台设为**规范**项目运营体验：退役开发开关，重定向四条旧路由，移除四视图对话框与页面式组合，迁移验收/操作 ID，并完成中英文档门禁。

## 范围与成功标准

1. 工作台始终开启（`parseProjectConfigurationWorkbenchEnabled` 恒为 true；环境变量忽略）。
2. 旧 `/files` `/config-sets` `/structure` `/conflicts` 重定向到等价工作台上下文并保留焦点查询参数。
3. 新导航只生成 `/parameter-admin/projects/:projectId/configuration`。
4. 在工作台接管行为后删除 `ProjectOperationsDialog` 与无用页面式面板。
5. `PROJ-OPS-001/002/003` 显式映射；`PROJ-CONFIG-CUTOVER-001` 覆盖 cutover 验收。
6. 中英文档与 `docs:check` 通过；定向测试、验收覆盖、构建与浏览器验收通过。

## 非目标

- 合并或 cherry-pick 一次性原型。
- 超出 cutover 重定向与空态 CTA 清理的工作台信息架构重设计。

## 任务

- [x] 纯 cutover helper + 单测
- [x] 开关退役 + 环境变量/文档
- [x] ProjectsOperationsPanel 切换；移除对话框组合
- [x] 工作台 URL 上下文；移除旧配置集管理 CTA
- [x] 删除过时面板；保留 `isCriticalDtsNodePath`
- [x] 页面/工作台单测
- [x] 验收/操作 ID 迁移 + e2e 路由更新 + CUTOVER 用例
- [x] 中英计划/文档完成；`docs:check`
- [x] 完整验证（单测/文档/构建/cutover e2e）；PR/合并待办

## 验证

见英文计划同名章节。证据目录：`work/ui-checks/project-configuration-workbench-cutover/`

## Documentation Impact Matrix

| Area | Action | Exact paths / evidence |
| --- | --- | --- |
| Planning | Update | this plan + ZH companion; `docs/PLANS.md`; `docs/zh-CN/PLANS.md` |
| Frontend / env | Update | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md`, `.env.example`, `docs/developer/environment-variables.md` (+ ZH) — flag retired; canonical route; legacy redirects |
| Product / design | Update | `docs/product-specs/prototype-functional-spec.md` (+ ZH); design doc Phase 6 status; ADR-0001 note |
| Acceptance | Update | `e2e/acceptance/operationMatrix.ts`, `requirements.ts`, EN/ZH coverage maps; `PROJ-CONFIG-CUTOVER-001` |
| Generated evidence | Update | acceptance operation evidence after e2e |

## Documentation Update Gate

- [x] EN/ZH companions updated together
- [x] `npm run docs:check` passes
- [x] Acceptance coverage/operations include `PROJ-CONFIG-CUTOVER-001` and mapped `PROJ-OPS-*`
- [x] Dual-language plans moved to `completed/` after merge gates
