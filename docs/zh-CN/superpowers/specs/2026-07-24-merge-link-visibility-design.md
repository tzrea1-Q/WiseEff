# 软件合入后合入链接可见性 — 设计

> 日期：2026-07-24  
> 状态：设计已确认；待实现计划  
> English: [`docs/superpowers/specs/2026-07-24-merge-link-visibility-design.md`](../../../superpowers/specs/2026-07-24-merge-link-visibility-design.md)  
> 相关：`ParameterReviewPage` / `VerticalTimeline`（`src/App.tsx`）、`isValidMergeLink`、`ChangeRequest.reviewerNote`

## 1. 背景

软件合入已要求在 `note` 中填写 http(s) 合入链接。服务端将该值持久化为变更请求的 `reviewerNote`（并写入审计）。审阅详情 UI 仅在状态仍为「软件User合入」时，以纯文本形式出现在流程时间线正文中。合入完成后状态变为「已合入」；历史详情既没有独立区块，时间线正文也不再展示已存储链接。

用户无法在确认合入后，从参数审阅工作台再次打开或核对合入 URL。

## 2. 目标 / 非目标

### 目标

- 当变更请求为 **已合入** 且 `reviewerNote` 为合法合入链接时，在审阅详情侧栏 **两处** 展示：
  1. 独立的 **合入链接** 卡片（与驳回原因卡同一视觉族）。
  2. 变更历史 / 流程 `VerticalTimeline` 中 **软件User合入** 步骤正文内的可点击外链。
- 链接在新标签打开，并使用 `rel="noopener noreferrer"`。
- 仅前端；复用现有 `reviewerNote` + `isValidMergeLink`。

### 非目标

- 在仍为「软件User合入」时展示只读链接（该阶段仍以输入框为准）。
- 新增 API 字段、审计接口或列表列。
- 一键复制控件。
- 修改合入校验或写路径。

## 3. 产品规则

1. **展示条件：** `status === "已合入"` **且** `isValidMergeLink(reviewerNote)`。
2. 条件不满足时，卡片与时间线链接区块均不渲染。
3. 卡片标题：`合入链接`。卡片正文：单个锚点，`href` 与可见文本均为 `reviewerNote.trim()`。
4. 时间线：条件满足时，「软件User合入」步骤正文包含处理人说明 + 同一可点击 URL（非需手动复制的纯字符串）。
5. 待合入输入区（`#review-merge-link`）行为不变。

## 4. UI / 组件

主表面：`src/App.tsx` 中 `ParameterReviewPage` 审阅详情侧栏。

### 4.1 独立卡片

- 放在「变更历史」/ 流程时间线上方，与存在 `rejectReason` 时的 `rejection-reason-card` 并列。
- 可用小类名（如 `merge-link-card`）或复用驳回卡布局并换 SectionLabel；沿用现有详情样式 token。
- 锚点：`target="_blank"`，`rel="noopener noreferrer"`。

### 4.2 VerticalTimeline

- 将 `VerticalTimelineItem.body` 从 `string` 扩展为 `ReactNode`（或 `string | ReactNode`），以便合入步骤渲染 `<a>`。
- 字符串 body 仍走 `formatWorkflowDisplayText`；不对 React 节点做字符串替换。
- 条件满足时，「软件User合入」步骤 body 为简短片段：处理人说明 + 链接（文案语气与现有时间线一致）。

### 4.3 清理待合入纯文本分支

- 删除或收窄仅在「软件User合入」时注入纯文本「合入链接：…」的分支，避免与合入后展示规则冲突。

## 5. 数据

无 schema / DTO 变更。数据源仍为审阅页已使用的 mock/API 路径返回的 `ChangeRequest.reviewerNote`。

## 6. 测试

- 组件：合入为「已合入」且 `reviewerNote` 为合法 URL 时，历史审阅详情同时出现卡片链接与时间线锚点，且 `href` 正确。
- 负例：「已合入」但无合法合入链接 → 两处均不出现。
- 待合入「软件User合入」→ 仍为输入框；无合入后卡片。
- 现有「必须填写合入链接」测试保持通过。
- 浏览器：`/parameter-review` → 历史审阅 → 已合入行：两处可见；桌面/平板/手机 snapshot + screenshot；console error 干净。

## 7. 文档

- EN + ZH `prototype-functional-spec.md` 各补一行：软件合入完成后，合入链接可在审阅详情卡片与流程时间线查看。
- 完成前运行 `npm run docs:check`。

## 8. 成功标准

- 历史审阅中已合入请求：卡片与时间线均展示可打开的外链，指向已存合入 URL。
- 主路径无需后端改动。
- 「软件User合入」输入门控无回归。
