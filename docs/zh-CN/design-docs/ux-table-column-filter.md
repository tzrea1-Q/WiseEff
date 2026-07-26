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
| 单测 | `src/components/ColumnFilter.test.tsx` |
| 参考接入 | `ParametersTable`、`DtsParameterWorkbenchTable`（所属模块）、`ParameterSpecLibrary` / `ProjectAdminTable`（参数后台）、日志/管理/调试表、审核表头 |

禁止再复制第二套漏斗菜单组件。若有公共缺口（菜单内搜索、虚拟列表等），在 `ColumnFilter` 上扩展。

## 适用场景

同时满足以下条件时使用 `ColumnFilter`：

- 控件位于**表格 / 网格列表头**（或同等密度的表头单元格）。
- 取值为**有限分类集合**（模块名、状态、风险、角色等）。
- 操作者需要选 **0 / 1 / 多个**值（列内为 OR）。
- 默认态必须**克制**：列名 + 小图标，而不是长期占满表头的下拉框。

**不要**用 `ColumnFilter` 处理：

- 全局搜索（用页面搜索框）。
- 层级模块树导航（用 `ModuleTreeSelect` / 工作台模块导航）。
- 与列筛选无关的互斥表单选项（普通 `<select>` 或单选组）。
- 仅排序的表头（用既有排序按钮；若同一列既要排序又要筛选，将 `ColumnFilter` 放在排序旁）。

## 视觉约定

默认表头：

1. 列标题文本（普通文案，不是伪下拉）。
2. 小号漏斗触发器（`Funnel`，约 13px），`aria-label={`筛选${label}`}`。
3. 当 `selectedValues.length > 0` 时显示数量徽章，并带 `.active` 高亮。

打开菜单后：

1. 固定定位面板（`.parameters-column-filter__menu--fixed`），避免横向滚动裁切。
2. 标题行：筛选项名称 + **清除**（无选中时禁用）。
3. 勾选列表；每个选项的可访问名称等于展示文案。
4. 无选项时显示 `暂无选项`。

默认 `align="left"`；仅当列靠近右缘、菜单会溢出视口时用 `align="right"`。

## 交互语义

| 动作 | 结果 |
| --- | --- |
| 未选任何值 | 本列筛选未生效，不按该列收窄行。 |
| 勾选/取消 | 增删该值（多选）。 |
| 清除 | 重置为 `[]`（未生效）。 |
| 点外部关闭 | 关闭菜单，保留已选。 |

列筛选规则：

```text
selectedValues.length === 0
  || selectedValues.includes(rowValue)
```

由页面持有 `string[]` 选中态。选项列表应从**应用本列筛选之前**的行范围推导（搜索 / 树 / 其他筛选），再叠加列筛选，使计数与导出与可见列表一致。

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

- 单测：打开、勾选、清除（`ColumnFilter.test.tsx`）。
- 集成：断言 `getByRole("button", { name: "筛选…" })`、多选与结果计数。
- 浏览器：桌面 / 平板 / 手机下菜单在横向滚动时仍可用；焦点与点外部关闭正常；无 console error。

## 变更控制

改动本 UX 时，须同变更更新本文与英文原文。优先扩展 `ColumnFilter`，不要并行新增控件。
