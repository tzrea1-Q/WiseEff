# DTS 工作台查看 / 编辑弹窗分流 — 设计

> 日期：2026-07-21  
> 状态：设计已批准，待实现计划  
> English: [`docs/superpowers/specs/2026-07-21-dts-view-edit-dialog-split-design.md`](../../../superpowers/specs/2026-07-21-dts-view-edit-dialog-split-design.md)  
> 关联：旧版 `ParameterDetailDialog` + `ParameterDraftDialog`；现状 `DtsBindingDetailDialog` + `DtsBindingDraftTray`

## 1. 背景

DTS 参数工作台重构后，表格「查看」「编辑」都打开同一个 `DtsBindingDetailDialog`，仅靠 `focusEditorOnOpen` 区分。原先两个职责被合并：

| 旧操作 | 旧表面 | 职责 |
|---|---|---|
| 查看 | `ParameterDetailDialog` | 只读理解；可选「加入草稿」 |
| 编辑 | `ParameterDraftDialog` | 填写目标值 + 原因；多卡本轮草稿；提交进入已修改/待提交区 |

合并弹窗的**内容**也偏离旧版：内部 ID 靠前，参数定义弱，缺少真正的草稿卡工作流。宽度问题已单独修复；本设计恢复**内容与交互分流**。

API 模式仍禁止 `recommendedValue` / drift。「加入本轮」之后仍以现有类型化 draft + `DtsBindingDraftTray` 为服务端真相。

## 2. 目标 / 非目标

### 目标

- 查看与编辑重新拆成两个弹窗（方案 A）。
- 查看内容沿用旧版「参数定义 / 历史 / 跨项目对比」骨架，并补齐必要 DTS 位置信息。
- 编辑内容沿用旧版「修改草稿」多卡骨架，接到现有 `onCreateDraft` → 本轮托盘。
- 技术身份（UUID、Spec ID 等）与来源链仅在查看弹窗折叠区。
- 弹窗保持足够宽度（现有 `max-w-5xl` / CSS）。

### 非目标

- 恢复 mock 专用推荐值、推荐值灌草稿、扁平 Excel 导出。
- 本切片不做旧版完整跨项目 diff 选择器与「用他项目配置加入草稿」——**当时延后**；由 follow-up [`2026-07-21-dts-binding-cross-project-compare-design.md`](./2026-07-21-dts-binding-cross-project-compare-design.md) 交付。
- 不改 draft / submission HTTP 契约或审阅流程。
- 不把 mock「本地草稿 → 本轮已修改表」双阶段再做成并行产品路径。

## 3. 交互

```
查看 → DtsBindingDetailDialog（只读）
编辑 → 写入/聚焦本地草稿袋 → DtsBindingDraftDialog
详情页脚「加入草稿」 → 关详情 → 同编辑
校验并加入本轮 → onCreateDraft（现有） → DtsBindingDraftTray
```

`DtsParameterWorkbench` 对 `view` / `edit` 必须打开**不同组件**，不能只靠 `focusEditorOnOpen`。

## 4. 查看弹窗 — `DtsBindingDetailDialog`

### 页头

- 标题：`{propertyKey}`（或 `{propertyKey} 参数详情`）
- 不展示可见的 `模块 · 实例 · 驱动` 眉题；仅保留读屏用的 dialog description

### 区块（顺序）

1. **参数定义**（核心）
   - 当前值（raw）— 只展示这一份项目值；查看弹窗**不**再并排展示生效值（类型化镜像），以免读成重复字段
   - 所属模块与重要性并排为定义区字段（重要性不放在页头）
   - 仅当接口后续提供时再显示规格描述/约束；否则省略（不写「接口未提供规格详情」）

2. **DTS 位置**（本轮必要新增）
   - Compatible
   - Unit address
   - 完整路径
   - 源文件 · 行号

3. **近期历史**
   - binding revision（现有 history 加载）
   - 空态：`暂无历史记录。`

4. **跨项目对比**
   - 其他项目 raw 值列表（现有 `compareEntries`）
   - 空态如实提示
   - 本切片不做：目标项目选择、并排 diff、「用作草稿」

5. **折叠**
   - 来源链
   - 技术身份（Binding ID、Parameter Spec ID、Spec Version ID、Logical Node ID、Topology node ID、源出现 ID）

### 页脚

- 关闭
- 可编辑时主按钮 **加入草稿**（不在本页改值）

### 禁止出现

- 目标值 / 修改原因编辑器
- 查看弹窗内的「校验并创建草稿」

## 5. 编辑弹窗 — 新建 `DtsBindingDraftDialog`

交互对齐旧 `ParameterDraftDialog`，数据来自 `DtsParameterWorkbenchRow` + 本地草稿袋。

### 页头

- 标题：**修改草稿**
- 短说明：编辑会加入草稿，校验通过后进入本轮修改区

### 本轮汇总条

- `本轮草稿 N 项`
- **全部清空** — 只清**本地**草稿袋（已进托盘的仍由托盘管理）

### 草稿卡（本地袋每项一张；打开编辑的 binding 置顶聚焦）

每张卡：

- 参数名；`模块 · 实例 · 重要性`
- 一行 DTS 上下文：路径 · Compatible（不是完整详情）
- **简单值：** 当前 → 目标紧凑预览
- **复杂值（多行 / 长串 / `string-list` 等）：** 「复杂配置」摘要 + 行级 `+/-` `ParameterValueDiff` + 等宽代码编辑器（`wrap=off`）
- 目标值
- 修改原因（placeholder 为「改为」换行后跟目标值）
- 有则显示服务端诊断 / 客户端提示
- **移除本项**

托盘「本轮已修改」对值变更同样使用行级 `ParameterValueDiff`；candidate/draft/binding/spec 收进可折叠「技术身份」。

### 页脚

- 关闭
- 主按钮：**校验并加入本轮** — 对可提交卡（原因与目标非空）调用现有 `onCreateDraft`；成功后移出本地袋并进入 `DtsBindingDraftTray`。袋空可关弹窗，有剩余卡可继续编辑。

### 禁止出现

- 推荐值 / drift 文案
- 完整 UUID 身份网格或展开的来源链长列表

## 6. 状态与接线

| 部件 | 职责 |
|---|---|
| 本地草稿袋 | `bindingId → { rawValue, reason }`，由 workbench 或 API workspace 协调器持有 |
| `DtsBindingDetailDialog` | 只读；`onAddToDraft(bindingId)` |
| `DtsBindingDraftDialog` | 编辑本地袋；创建草稿 / 清空 / 移除 |
| `DtsBindingDraftTray` | 不变：已校验 pending draft + 提交审阅 |
| `DtsParameterWorkbench` | 按意图打开对应弹窗；停止「编辑 = 聚焦详情」 |

若可减少透传，草稿袋优先放在已有 `pendingDrafts` 的 `ApiProjectTopologyWorkspace`；弹窗仍用 props 做单元测试。

## 7. 测试

- 查看：无目标值/原因控件；有参数定义 + DTS 位置；技术 ID 仅在技术身份下；加入草稿回调。
- 编辑：多卡本地袋；移除/清空；提交调用 `onCreateDraft`；成功后清空已提交卡。
- 工作台：查看/编辑打开不同弹窗；只读用户仅有查看。
- 托盘 / 提交既有测试保持绿色。
- 前端可见：playwright-cli 在 `/parameters` 验收查看+编辑，桌面/平板/手机；确认宽度与区块顺序。

## 8. 文档影响

- 更新 `docs/FRONTEND.md` 与 `docs/zh-CN/frontend.md`：查看 = 详情弹窗；编辑 = 草稿弹窗；托盘仍为校验后承载。
- 预期无 API 契约变更；除非接线发现缺字段，否则不重生 OpenAPI（对比增强不在本切片）。

## 9. 自检

- 核心区块无占位未决。
- 非目标已明确推迟推荐值与完整对比 UX。
- 范围限于 UI 分流与内容，不重开模块身份或 seed。
