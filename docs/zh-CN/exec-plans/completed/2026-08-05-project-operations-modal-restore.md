# 项目运营弹窗化恢复

> 状态：**已于 2026-08-05 完成**，分支 `feat/project-operations-dialog-hardening`
> 英文：[English](../../../exec-plans/completed/2026-08-05-project-operations-modal-restore.md)
> 前序：[`2026-08-05-project-operations-dialog-hardening.md`](2026-08-05-project-operations-dialog-hardening.md)
> 修订：[ADR-0001](../../../adr/0001-parameter-admin-organized-by-governance-scope.md)

## 目标

在不回退 POD 硬化成果（共享 `ModalDialog`、离开草稿守卫、不可逆操作确认、访问过视图保活、布局与文案诚实）的前提下，把项目运营重新呈现为盖在项目清单上的深链弹窗。

## 决策

产品覆盖 POD-D1 的整页呈现：路由仍拥有 `/parameter-admin/projects/:projectId/:view`；呈现再次变为清单上的弹窗。ADR-0001 同步修订，使「路由可寻址」不再等于「只能整页」。

## 已交付

1. [x] 用 `ModalDialog` 重建 `ProjectOperationsDialog`（标题 / 说明 id、关闭控件、pill 导航与方向键遍历）。
2. [x] 项目清单常驻；命中项目视图路由时叠加弹窗；关闭 / Escape 经离开草稿守卫。
3. [x] 卡片固定高度、仅正文滚动；≤768px 全视口 sheet；样式以 `.param-admin-modal-backdrop` 为 portal 锚点。
4. [x] 更新页面测试、ADR-0001、`FRONTEND.md`（+ ZH）与 `full-stack-architecture.md`。

## 文档影响矩阵

| 区域 | 动作 | 路径 |
| --- | --- | --- |
| ADR | 更新 | `docs/adr/0001-parameter-admin-organized-by-governance-scope.md` |
| 前端 | 更新 | `docs/FRONTEND.md`、`docs/zh-CN/frontend.md` |
| 架构 | 更新 | `docs/design-docs/full-stack-architecture.md` |
| 规划 | 新增 / 归档 | 本计划（+ 英文）；`docs/PLANS.md`；`docs/zh-CN/PLANS.md` |

## 验证

- `npx vitest run src/ParameterAdminNextPage.test.tsx`
- 按需 `npm test` + `npm run build` + `npm run docs:check`
- API 模式浏览器：点「管理文件」见清单上的弹窗；四个 tab；关闭 / Escape；草稿离开确认；三档视口
