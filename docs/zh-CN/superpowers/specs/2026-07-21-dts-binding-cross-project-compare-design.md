# DTS 绑定详情 — 成熟跨项目对比 — 设计

> 日期：2026-07-21  
> 状态：已实现
> English: [`docs/superpowers/specs/2026-07-21-dts-binding-cross-project-compare-design.md`](../../superpowers/specs/2026-07-21-dts-binding-cross-project-compare-design.md)  
> 相关：旧版 [`ParameterDetailDialog`](../../../../src/components/ParameterDetailDialog.tsx) + [`singleParameterComparison`](../../../../src/domain/parameters/singleParameterComparison.ts)；当前 [`DtsBindingDetailDialog`](../../../../src/components/parameter-topology/DtsBindingDetailDialog.tsx)；此前拆分设计将完整对比标为延后

## 1. 背景

DTS 查看弹窗的「跨项目对比」目前是扁平对端列表（`projectName` + `rawValue` + 模块/驱动）。旧版 mock 工作台在 `ParameterDetailDialog` 中已有成熟对比面：

- 目标项目选择器
- 覆盖率（`已配置/总数`）
- 重点差异摘要
- 基准 ↔ 目标的 `+/-` 代码 diff（`DiffCodeBlock` / `ProjectDiffComparison`）
- 项目概览列表
- 「使用该项目配置加入草稿」

产品选择（2026-07-21）：**完整迁入（方案 3）** 到 DTS 查看弹窗，并按 binding / `rawValue` 身份适配（无 `recommendedValue`）。

另外：compare API 按匹配到的 **binding** 返回行，同一项目可能出现两次；UI 必须按 **`projectId` 去重**。

## 2. 目标 / 非目标

### 目标

- 在 `DtsBindingDetailDialog` 内用与旧版对等的对比 UX 替换扁平列表。
- 从 `ParameterDetailDialog` 复用 / 抽出共享 diff 展示，避免两套实现分叉。
- 基准 = 当前项目 + 当前 binding 的 `rawValue`（compare API 不含源项目，需本地合成）。
- 对端 = `listBindingCompare` 结果，并按 **`projectId` 去重**。
- 「使用该项目配置加入草稿」写入现有 **本地草稿袋**，并打开/聚焦 `DtsBindingDraftDialog`（与「加入草稿」同路径），原因文案引用目标项目。
- 仅做 raw 文本 diff（DTS 字符串 / cell 数组按存储形态）。

### 非目标

- 不恢复独立对比路由页。
- 不改 compare 匹配规则（同组织、`parameter_spec_id` + `module_id`）。
- 不展示 `recommendedValue`、数值单位偏差或旧版风险字段。
- 不改草稿 → 托盘 → 提交的 HTTP 契约。
- 不为「缺失对端」新增「列出组织全部项目」API；覆盖率基于 **当前项目 + 返回的对端**。从未 ingest 该绑定的项目不进选择器（与 compare API 诚实一致）。

## 3. 交互

```
打开查看弹窗
  → 加载历史 + 对比（现有）
  → 用当前工作台行合成基准行
  → 按 projectId 去重对端
  → 默认目标 = 第一个对端（按 projectName 稳定排序）；无对端则无目标

用户选择目标项目
  → 更新重点差异 + diff 区 + 概览色调

用户点击「使用该项目配置加入草稿」
  → upsert 本地草稿 { rawValue: target.rawValue, reason: "参考 {projectName} 当前配置生成草稿" }
  → 按现有「加入草稿」行为关闭/保留查看弹窗；打开草稿弹窗并聚焦该 binding
```

无对端：保留诚实空态（`暂无其他项目的对比数据。`）；隐藏目标选择与「用作草稿」控件。

## 4. 区块结构（顺序）

1. **页头行**
   - 标题：跨项目对比
   - 覆盖率：`{configured}/{total} 个项目已配置`（基准 + 有 raw 的去重对端）
   - 副文案：`对比 {baseLabel} 与 {targetLabel}`
   - 选择：目标项目（仅对端；当前项目不出现或禁用）

2. **来源操作行**
   - 目标已配置时：`可将 {target} 的当前配置作为草稿目标值`
   - 按钮：**使用该项目配置加入草稿**（`!canEdit`、无目标或无 raw 时禁用）

3. **重点差异**
   - 仅文本 delta：`值相同` / `值不同` / `目标项目尚未配置该参数`（不做数值百分比，不做推荐值偏差）

4. **差异视图**
   - 复用 `DiffCodeBlock`（或抽出的共享模块）对比基准与目标 `rawValue`
   - 小节标题：当前值对比

5. **项目概览**
   - 基准 + 对端：项目名、raw 预览、基准 / 目标色调

## 5. 抽取与接线

| 片段 | 动作 |
|---|---|
| `DiffCodeBlock` / `buildDiffLines` / `DiffSection` | 抽到 `src/components/parameters/` 或 `src/components/parameter-compare/`，两套弹窗共用 |
| `ProjectDiffSummary` / 概览列表 | 抽出或做 DTS 薄包装，输入 `rawValue` 行而非 `SingleParameterComparisonRow` |
| `buildSingleParameterProjectComparison` | **不要**强行把 DTS 塞进 ParameterRecord；新增小型 `buildBindingProjectComparison`（或适配器）处理 `{ projectId, projectName, rawValue }[]` + 基准 |
| `DtsParameterWorkbench` | 「用作草稿」走与「加入草稿」相同的本地草稿 upsert，再打开草稿弹窗 |
| 对比加载 | 继续 `loadBindingCompare`；在 UI 或适配器中去重 |

## 6. 数据规则

- 去重键：`projectId`。若多 binding 冲突，按 `projectName`、再 `rawValue` 稳定排序后取第一条（代码内注释说明）。不合并不同 raw 值。
- 弹窗打开时基准行始终存在。
- 目标默认第一个对端；选择变更仅本地 React state（本切片不同步 URL）。

## 7. 测试

- 单元：comparison builder — 覆盖率、基准/目标标记、去重、equal/changed/missing 的 delta。
- 弹窗：切换目标更新 diff 标记；相同 raw →「值相同」；「使用该项目配置加入草稿」以目标 raw + reason 调用草稿 upsert；`canEdit=false` 时禁用。
- 工作台集成：加载 compare → 成熟区块可见；重复 `projectId` 只渲染一次。
- 时间紧时优先单测；不强制新增 e2e gate。

## 8. 文档

- 更新中英 `FRONTEND.md` / `frontend.md` 对比段落：查看弹窗内成熟对比（选择 + diff + 对端作草稿）。
- 修订 view/edit 拆分设计中的非目标：完整对比由本 follow-up 规格交付（双向链接）。
- 预期不改 OpenAPI。

## 9. 成功标准

- 查看弹窗对比区具备旧版交互形态（选择、覆盖率、差异、diff、概览、对端作草稿），且无推荐值词汇。
- 不再出现 Aurora 式重复项目行。
- 对端作草稿进入与「加入草稿」相同的本地草稿袋。
