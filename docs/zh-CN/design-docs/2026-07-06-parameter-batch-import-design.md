# 批量参数导入多格式与核对向导 — 设计规格

> English: 暂无独立英文版；实现计划与 API 契约以仓库内现有英文文档为准。

**日期：** 2026-07-06  
**状态：** 已评审（Brainstorming 通过）  
**入口：** `/parameter-admin` → TopBar「批量参数导入」  
**关联：** M1 参数导入 API、`ParameterImportSourceItem`、`ProjectAdminFormDialog`

---

## 1. 背景与问题

当前「批量参数导入」为单页对话框，能力简陋：

- 仅支持 JSON 数组或 CSV 文本粘贴，列名为英文内部字段；
- 不支持 `.xlsx`、`.dts` / `.dtsi`；
- 无导入模板下载与宽表校验；
- 无逐条核对；隐式绑定 TopBar 当前项目，不可选择或新建目标项目；
- 解析逻辑耦合在 `ParameterAdminPage.tsx`，难以扩展。

产品 spec 要求：批量导入须校验格式、冲突、范围与权限；支持模板、冲突检测与影响分析（演进方向）。

---

## 2. 目标

1. 支持 **表格（.xlsx / .csv）**、**JSON**、**DTS（完整文件 + 手动片段）** 三种来源的快速导入。
2. 解析后增加 **逐参数核对** 步骤（diff、编辑、跳过原因）。
3. 库中不存在的参数，可进入 **新增参数** 流程并预填已解析字段。
4. **Step 1 必选目标项目**（现有项目或新建）；Step 5 再次确认后应用。
5. 管理员 **宽表模板**（除系统生成字段外，用户可维护字段均纳入）。
6. 匹配已有定义：**参数名 + 模块**（`name` + `module`）。

## 3. 非目标（首版不做）

- 单文件多项目混合导入（一份文件对应一个目标项目）。
- 服务端文件上传与异步解析（首版浏览器端解析，见 §8 分期）。
- 双人复核、审批流变更。
- 修改共享参数库定义的结构化「删除参数」导入。

---

## 4. 用户流程（5 步向导）

```text
Step 1  来源 + 目标项目 *
        ├─ 目标项目：下拉选择现有项目（名称 + 代号）
        │             默认 = 当前页面/TopBar 上下文项目
        │             [+ 新建项目] → ProjectAdminFormDialog
        │             创建成功后自动选中并继续
        ├─ 上传：.xlsx / .csv / .json / .dts / .dtsi / 文本粘贴
        └─ [下载管理员导入模板.xlsx]

Step 2  解析与校验
        ├─ 格式检测 → 对应解析适配器
        ├─ 宽表/JSON 结构校验（必填列、risk、valueKind 等）
        ├─ name + module 匹配参数库 → 已有 / 新增候选 / 冲突
        └─ 展示解析摘要（总行数、可导入、待补全、错误行）

Step 3  逐条核对 *
        每条卡片：
        ├─ 状态：已有 | 新增 | 冲突 | 已跳过 | 待补全模块
        ├─ 字段级 diff：解析值 vs 目标项目当前库中值
        ├─ 默认只读；[编辑] 修正解析结果；[跳过] 必填原因
        ├─ 新增候选：[预填并创建] → ParameterDefinitionForm，确认后回到队列
        └─ 进度：「已核对 8/12 · 跳过 2 · 待处理 2」

Step 4  批次汇总预览
        ├─ 沿用现有 summary：新增 / 更新 / 不变 / 冲突 / 高风险
        ├─ 可勾选应用项
        └─ 调用 createImportPreview({ projectId, sourceName, items })

Step 5  确认并应用
        ├─ 只读展示目标项目 + 来源文件名 + 摘要 KPI
        ├─ 用户显式确认后 applyImportBatch
        └─ 成功 → 通知 + 审计（沿用现有 batch-import 事件）
```

### 4.1 中途更改目标项目

若在 Step 3 之后更改目标项目：

- 弹窗：「更改项目将重新匹配 diff，已核对进度会重置。」
- 确认 → 回到 Step 2 重新匹配。

---

## 5. 导入模板（管理员宽表）

### 5.1 模板列（可导入 / 可下载）

| 中文列名 | 字段 | 必填 | 说明 |
|----------|------|------|------|
| 参数名称 | `name` | 是 | 匹配键 |
| 模块 | `module` | 是 | 匹配键 |
| 当前值 | `currentValue` | 否 | 写入目标项目 |
| 推荐值 | `recommendedValue` | 否 | |
| 范围 | `range` | 是* | *新增参数时必填 |
| 单位 | `unit` | 是* | |
| 重要性 | `risk` | 是* | 高/中/低 或 High/Medium/Low |
| 描述 | `description` | 否 | |
| 说明 | `explanation` | 否 | |
| 配置格式 | `configFormat` | 否 | |
| 值类型 | `valueKind` | 否 | `scalar` / `complex` |

### 5.2 不纳入模板（系统生成或上下文）

`id`、`projectId`（Step 1 选择）、`updatedAt` / `updatedAtTs`（应用时写入）、`history`、导入分类（`classification`）、`riskFlag`、`batchId`、审计字段。

### 5.3 表格格式

- **`.xlsx`**：与导出能力共用 `xlsx` 依赖；首行中文表头。
- **`.csv`**：UTF-8 BOM；首行中文表头；RFC 4180 转义。

---

## 6. 多格式解析

### 6.1 统一中间模型

```typescript
type ParsedImportRow = {
  name: string;
  module: string;
  currentValue?: string;
  recommendedValue?: string;
  range?: string;
  unit?: string;
  risk?: ParameterRiskLevel;
  description?: string;
  explanation?: string;
  configFormat?: string;
  valueKind?: ParameterValueKind;
  sourceFormat: "spreadsheet" | "json" | "dts-full" | "dts-fragment";
  sourceLocation?: string;  // 行号 / 属性名 / 节点路径
  rawSnippet?: string;
  parseWarnings?: string[];
};
```

经 `normalizeRow` + `matchToLibrary(name, module)` 转为 `ParameterImportSourceItem` 并附带 UI 状态。

### 6.2 JSON

- 支持：`ParameterImportSourceItem[]`
- 支持：`{ "items": [...] }`
- 字段名：英文内部名或宽表中文列名（通过列名映射表统一）

### 6.3 DTS

**完整文件（`.dts` / `.dtsi`）：**

- 提取 `property = value;` 赋值（含 `{ ... }`、`< ... >`、字符串列表）。
- 属性名映射为 `name`；**通常无 `module`** → Step 3 标记「待补全模块」，未补全不可通过。

**手动片段：**

- 粘贴一段或多段 DTS 属性块；同上提取规则。
- P2：可选节点路径 → module 启发式建议（如路径含 `charging` → `Charging Policy`），用户可改。

### 6.4 格式检测顺序

1. 二进制 / ZIP 魔数 → xlsx  
2. `.dts` / `.dtsi` 扩展名或 `/{` `/dts-v1/` 特征 → dts-full  
3. JSON parse 成功 → json  
4. 否则 → csv（按宽表列头解析）

---

## 7. 逐条核对（Step 3）规则

| 状态 | 条件 | 用户操作 |
|------|------|----------|
| 已有 | name+module 命中库中定义 | 查看 diff；通过 / 编辑 / 跳过 |
| 新增 | 库中无此 name+module | 预填并创建 / 编辑 / 跳过 |
| 冲突 | 同批重复 name+module，或 valueKind 等与定义不兼容 | 必须解决后通过 |
| 待补全 | module 为空（常见于 DTS） | 选择 module 后才可通过 |
| 已跳过 | 用户跳过 | 不进 Step 4 默认勾选；原因写入 reviewMetadata |

**编辑：** 修改的是「本批待提交」字段，不直接写库，直到 Step 5 apply。

**新增参数：** 打开 `ParameterDefinitionForm`，预填 name、module、range、unit、risk、description、explanation、configFormat、valueKind 及目标项目的 current/recommended；确认后标记「新增-已确认」并纳入 items。

---

## 8. 架构与模块

**推荐方案：** 浏览器端多格式解析 + 分步向导；核对完成后调用现有 import batch API（与 M1 一致）。

```
src/application/parameters/import/
  types.ts                 ParsedImportRow, ImportReviewState, ...
  columnMap.ts             中文列名 ↔ 字段
  detectImportFormat.ts
  parseSpreadsheet.ts      xlsx + csv
  parseJson.ts
  parseDts.ts              full + fragment（P1 可先做 fragment，P2 完善 full）
  normalizeRow.ts
  matchToLibrary.ts        name + module
  buildImportTemplate.ts   下载模板 xlsx

src/components/ParameterImportWizard/
  ParameterImportWizard.tsx
  steps/
    StepSourceAndProject.tsx
    StepParseReport.tsx
    StepRowReview.tsx
    StepBatchPreview.tsx
    StepConfirmApply.tsx
  ImportReviewCard.tsx

ParameterAdminPage.tsx     打开向导；移除内联 parseImportItems
```

**复用：**

- `ProjectAdminFormDialog` — 新建项目  
- `ParameterDefinitionForm` — 新参数预填  
- `parameterActions.createImportPreview` / `applyImportBatch`  
- `xlsx` — 模板与 xlsx 解析  

**后端（首版）：** 不改契约；`createImportPreview` 已接受 `projectId`。  
**可选 P1.5：** 请求体增加 `reviewMetadata`（跳过原因、sourceFormat）供审计 enrich — 非阻塞。

---

## 9. 权限与审计

- 创建预览 / 应用：Admin + `admin:access`（沿用 `requireCanAdminImport`）。
- 新建项目：与项目 Admin 相同权限（`createProject` API）。
- 审计：`batch-import` 事件；sourceName 含文件名；summary 沿用现有 diffSummary。

---

## 10. 错误处理

| 场景 | 行为 |
|------|------|
| 空文件 / 零有效行 | Step 2 阻断，提示下载模板 |
| 缺必填列 | 列出缺失中文列名 |
| DTS 语法错误 | 行号 + 片段 |
| 编码问题 | 要求 UTF-8；CSV 提示 BOM |
| 整批皆跳过 | 禁止 Step 5 |
| API 预览/应用失败 | 展示现有 notification / 错误码 |

---

## 11. 测试与验收

**单元测试：**

- 各 parser（xlsx、csv、json、dts-fragment）
- `matchToLibrary`（name+module）
- risk / valueKind 中英文规范化
- 模板 round-trip（下载列 ↔ 解析）

**集成测试：**

- `ParameterImportWizard` 完整流（mock parameterActions）
- 新建项目 → 自动选中 → 预览 projectId 正确
- 跳过 / 编辑 / 新参数预填

**浏览器验收：**

- 扩展或新增 `PARAM-ADMIN-002`：多格式上传、Step 3 核对、应用后库表更新  
- 对照 `docs/developer/browser-acceptance-coverage-map.md`

---

## 12. 分期交付

| 阶段 | 范围 |
|------|------|
| **P1** | 5 步向导；Step 1 目标项目 + 新建项目；宽表 xlsx/csv + JSON；逐条核对 + 新参数预填；模板下载 |
| **P2** | DTS 完整文件解析；节点路径 module 建议；DTS 片段增强 |
| **P3** | 审计 reviewMetadata；超大 DTS 服务端解析（按需） |

---

## 13. 已确认决策记录

| 议题 | 决策 |
|------|------|
| DTS 范围 | 完整文件 + 手动片段 |
| 核对交互 | 默认 diff；可编辑；跳过填原因 |
| 新参数 | 预填并走新增参数表单 |
| 表格模板 | 管理员宽表（非系统字段尽量全覆盖） |
| 匹配键 | name + module |
| 目标项目 | **Step 1 必选**；Step 5 再次确认 |
| 架构 | 前端解析 + 现有 import batch API（方案 1） |

---

## 14. Documentation Impact（实现时）

| 文档 | 动作 |
|------|------|
| `docs/exec-plans/active/` | 新增实现计划 |
| `docs/product-specs/` | Review；若行为超出 prototype spec 则更新 |
| `docs/developer/browser-acceptance-coverage-map.md` | 新增/更新 PARAM-ADMIN-002 |
| `docs/FRONTEND.md` | Review 导入模块路径 |
| API OpenAPI | 若增加 reviewMetadata 则更新 |
