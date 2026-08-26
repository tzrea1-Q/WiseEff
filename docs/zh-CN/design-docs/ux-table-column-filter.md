# UX 规格：表格列多选筛选

> English: [English](../../design-docs/ux-table-column-filter.md)

状态：**现行** · 日期：2026-07-26

## 目的

规定「按某一分类列筛选表格、且支持选 0/1/多个值」时的标准交互。新建或改造的表格必须复用本规格，不要再发明显眼的 `<select>`、只用排序箭头冒充筛选，或各自实现一套弹层。

## 规范实现

| 部分 | 位置 |
| --- | --- |
| 组件 | `src/components/ColumnFilter.tsx` |
| 样式 | `src/styles.css` 中的 `.parameters-column-filter*` |
| 共享树模型 | `src/domain/tree-filter/treeFilter.ts` |
| 共享树选项 | `src/components/common/TreeFilterOptions.tsx` |
| 单测 | `src/components/ColumnFilter.test.tsx`、`src/components/common/TreeFilterOptions.test.tsx`、`src/domain/tree-filter/treeFilter.test.ts` |
| 参考接入 | `ParametersTable`、`DtsParameterWorkbenchTable`（所属模块）、`ParameterSpecLibrary` / `ProjectAdminTable`（参数后台）、日志/管理/调试表、审核表头 |

禁止再复制第二套漏斗菜单组件。若有公共缺口（菜单内搜索、虚拟列表等），在 `ColumnFilter` 上扩展。层级列表头筛选统一使用 `ColumnFilter mode="tree"`；树模型和 `TreeFilterOptions` 同时供 `ModuleTreeSelect` 复用。

## 适用场景

同时满足以下条件时使用 `ColumnFilter`：

- 控件位于**表格 / 网格列表头**（或同等密度的表头单元格）。
- 取值为**有限分类集合**（模块名、状态、风险、角色等）。
- 操作者需要选 **0 / 1 / 多个**值（列内为 OR）。
- 默认态必须**克制**：列名 + 小图标，而不是长期占满表头的下拉框。

**不要**用 `ColumnFilter` 处理：

- 全局搜索（用页面搜索框）。
- 非列表头的层级模块导航（用 `ModuleTreeSelect` / 工作台模块导航）。列表头的层级筛选应使用 `ColumnFilter` 树模式。
- 与列筛选无关的互斥表单选项（普通 `<select>` 或单选组）。
- 仅排序的表头（用既有排序按钮；若同一列既要排序又要筛选，将 `ColumnFilter` 放在排序旁）。

## 视觉约定

默认表头：

1. 列标题文本（普通文案，不是伪下拉）。
2. 小号漏斗触发器（`Funnel`，约 13px），`aria-label={`筛选${label}`}`。
3. 有选中值时显示逻辑根节点数量徽章，并带 `.active` 高亮。树模式统计根节点，不统计根节点展开后的每一行。

打开菜单后：

1. 固定定位面板（`.parameters-column-filter__menu--fixed`），避免横向滚动裁切。
2. 标题行：筛选项名称 + **清除**（无选中时禁用）。
3. 平铺模式显示勾选列表；树模式默认全部收起，父节点支持已选 / 半选 / 未选状态，并可显示数量。当前范围只有一个结构根节点时，隐藏该包装根节点，将其子节点提升为可见根节点。模块路径用于搜索和重复名称的可访问名称，但不在筛选菜单中显示；层级关系由缩进和展开/收起控件表达。
4. 每个选项的可访问名称等于展示文案。
5. 无选项时显示 `暂无选项`。

默认 `align="left"`；仅当列靠近右缘、菜单会溢出视口时用 `align="right"`。

## 交互语义

| 动作 | 结果 |
| --- | --- |
| 未选任何值 | 本列筛选未生效，不按该列收窄行。 |
| 勾选/取消 | 增删该值（多选）；树模式保存规范化的根节点 ID，并作用于完整子树。 |
| 清除 | 重置为 `[]`（未生效）。 |
| 点外部关闭 | 关闭菜单，保留已选。 |
| Escape | 关闭菜单，并将焦点还给触发按钮。 |
| 方向键 / Home / End | 在当前可见树节点间移动；右键展开或进入分支，左键收起或返回父节点。 |
| Space / Enter | 对当前聚焦树节点执行与鼠标点击一致的选择语义。 |

列筛选规则：

```text
selectedRoots.length === 0
  || rowModuleId 被某个 selectedRoot 覆盖
```

由页面持有 `string[]` 选中态。平铺模式保存值；树模式保存稳定模块 ID，并规范化为逻辑根节点（选择父节点会移除冗余子节点）。多个根节点为 OR 关系。选项列表应从**应用本列筛选之前**的行范围推导（搜索 / 树 / 其他筛选），补齐关联祖先，数量只统计该范围内的行。范围变化时不得把范围外的 ID 错配到同名模块。

树搜索只改变选项树的可见范围：保留匹配节点的祖先、自动展开匹配分支，并且不清除已选根节点。父节点状态由可选后代计算，部分覆盖时显示半选。默认打开状态不展开任何分支；只有在确有需要时，调用方才指定初始展开深度。

树模式使用 roving focus：只有当前可见的 `treeitem` 进入 Tab 顺序，同时向辅助技术暴露 `aria-level`、`aria-expanded`、`aria-checked` 及半选状态。禁用的结构祖先保留用于展示层级，但不可被选中。

## 与排序的组合

同一列既可排序又可筛选时：

- 排序挂在标题控件（箭头）。
- 筛选挂在旁侧漏斗（见 `ParametersTable` 表头）。
- **禁止**因为「要筛选」就把排序改成原生 `<select>`。

工作台示例：`所属模块` 仅筛选（`ColumnFilter`）；`参数名` / `重要性` 仍仅排序。

## 反模式（禁止合入）

- 用整宽或表头内嵌 `<select>` / `LibrarySelectFilter` 作为主列筛选。
- 在本可多选的场景做成只能单选的菜单。
- 用排序箭头（`ArrowUpDown`）表示「打开筛选」。
- 在功能目录里另写一套漏斗 + 勾选菜单与样式。

## 验证

- 单测：树模型的排序、孤儿/循环保护、规范化选择（`treeFilter.test.ts`）；打开、勾选、半选、搜索、清除、Escape 与焦点（`ColumnFilter.test.tsx`、`TreeFilterOptions.test.tsx`）。
- 集成：断言 `getByRole("button", { name: "筛选…" })`、多选与结果计数。
- 回归：覆盖 `ModuleTreeSelect` 的单选、多选筛选、portal、可选 ID 行为；`/parameters`、`/dts-reload`、`/parameter-review`、`/parameter-admin/specs`、`/node-debugging` 与 `/debugging-admin/nodes` 各自使用受作用域约束的注册表，但复用同一树控件。
- 浏览器：桌面 / 平板 / 手机下菜单在横向滚动时仍可用；搜索、展开/收起、选择、清除、Escape、焦点回收与点外部关闭正常；无 console error。

## 变更控制

改动本 UX 时，须同变更更新本文与英文原文。优先扩展 `ColumnFilter`，不要并行新增控件。
