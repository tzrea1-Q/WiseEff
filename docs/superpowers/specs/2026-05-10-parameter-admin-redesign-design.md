# 项目参数管理后台 · 重构设计方案

> **面向规划人**：用此 spec 作为写计划（`superpowers:writing-plans`）的输入，不直接实现代码。
> **面向实施人**：不要基于本 spec 直接动工，先看对应的 plan 文件。

---

## 背景与目标

当前 `/parameter-admin` 页面（`ParameterAdminPage`，`src/App.tsx` L2028+，面向平台管理员）在 UX 上与 PRD §5.3 承诺的"项目参数管理后台"相比严重残缺：PRD 要求覆盖 **批量参数导入 / 参数数据库管理 / 参数列表 / 应用使用指标 / 用户权限 / 审计事件 / 导入反馈**，而现状只做了"参数库 CRUD + 一键导出 JSON"，权限和审计完全缺席。除此之外，现有 UI 在安全性、反馈、响应式三个维度均低于同项目姊妹页（parameter-review、debugging-workbench、parameter-user-workbench）已经建立的水准。

本次重构在不改变数据底座的前提下（复用 `powerManagementConfig` 与现有 reducer 契约，仅做**局部扩展**），把页面从"参数库编辑器"推进到"管理员真实可日用的治理后台"，同时把参数域三件套（提交 / 审阅 / 管理）和审计/权限的能力脊梁补齐，让 `/parameter-admin` 的叙事从"看起来能管参数"走到"能管参数、管人、管变更"。

## 评测结论摘要

1. **PRD 承诺 ≠ 实现**：副标题写"电池与充电参数数据库、批量导入、**权限和审计管理**"，但页面里没有任何权限或审计 UI。
2. **标题与副标题重复**：顶部 Topbar 与内容 H1 均为"项目参数管理后台"+ 同样的副标题，浪费 ~80px 垂直空间与认知带宽。
3. **头部动作区过载**：`批量参数导入 / 保存到 JSON 文件 / 导出 JSON / 复制 JSON` 四个按钮挤在标题右侧 542px 内，视觉权重几乎一致，主次不分；下一行还有灰色小字 `导出后可手动替换 src/config/power-management.json`，说明这三个导出按钮实际上都只是浏览器端下载/复制——**"保存"一词是语义谎言**。
4. **4 张 KPI 卡面积浪费**：140px × 4 占首屏 ~32% 垂直空间；`配置草稿 可写入` 是状态词不是指标；`项目值 3 组` 是元数据不是 KPI；卡片下还有装饰性黑色进度条（屏读器会误读）。
5. **参数库列表零治理能力**：10 项已有横向滚动截断；无搜索、无筛选、无分组、无排序、无多选、无"孤儿参数"视角；长参数名如 `wireless_charge_thermal_derate_pct` 在 357px 列内被双重折磨。
6. **"删除参数"是高危反模式**：按钮与"新增参数"并排等权重、红色、无图标、**无确认对话框**，直接 `dispatch DELETE_PROJECT_PARAMETER`；它删除的是"当前选中项"，但视觉上像"选一个参数去删"，极易误删。
7. **"批量参数导入"是空壳**：点击直接 `dispatch IMPORT_PARAMETERS`，无文件选择、无 diff、无试运行、无审计——对管理后台是不可接受的裸奔。
8. **"更新时间"字段可手填**：项目值矩阵里 `更新时间` 是普通 `<input>`，支持填 `"1 小时前"`/`"昨天"` 自然语言——**数据建模错误外溢到 UI**，允许用户写入不一致文本导致审计与真实变更时间脱钩。
9. **无脏态、无保存反馈**：编辑 20 个字段后没有任何"已修改 N 处"提示；刷新页面草稿丢失且无 `beforeunload` 警告；导出成功也无 Toast。
10. **"推荐值"隐式全局写**：共享定义里的"推荐值"输入框实际上 `updateRecommendedValue` 会写到所有项目，但 UI 上只是普通 input，管理员不知道这是全局生效。
11. **重要性下拉与风险徽章脱节**：列表用红/黄/绿徽章，下拉里只是黑字"高/中/低"，无色标预览。
12. **范围与配置格式是自由文本**：`范围` 填 `"2500 - 4500"` 是字符串，写成 `"25 - 45"` 无人发现；`配置格式` 是结构化 YAML 描述字符串放在普通 textarea 里。
13. **单位不就近展示**：项目值矩阵里当前值输入框没有 suffix，管理员需来回跨区对照 `共享定义` 里的 `单位: mA`。
14. **风险徽章仅用颜色**：色盲不友好；`role="status"` / aria-label 缺失。
15. **响应式断点不足**：≤1024 基本不可用（首屏被两个大区块挤垮）；移动端 390 完全失配，侧栏仍占 65% 宽度。
16. **承诺的"JSON 预览"已消失**：早期设计（`qa-screenshots/parameter-admin-shared-definition-matrix.png`）有 JSON 预览栏，当前版本只留了按钮；管理员按"保存到 JSON"时不知道要保存什么。
17. **浮动 Agent 按钮遮挡矩阵末行**：`.agent-floating` 在 bottom-right 56×56，和项目值矩阵最后一行会重叠。

## 已确认的关键决策

| # | 决策点 | 选择 | 说明 |
|---|---|---|---|
| **D1** | 重构范围 | **B：补齐 PRD §5.3 承诺** | 在现状基础上新增审计 + 权限能力，不越界到 PRD §11 的"后续工程演进" |
| **D2** | 页面主骨架 | **B：参数库为主 + 右侧审计抽屉 + 权限独立弹窗** | 主任务（编辑参数）永不被 Tab 遮挡；审计作为次级信息流原地联动；权限作为低频设置弹窗 |
| **D3** | 主区 master-detail 形态 | **B：左列表 340 + 右详情（定义 + 项目值矩阵纵向堆叠）** | 与 parameter-review 骨架同构；抽屉开关时挤压点集中在列表宽度，详情区始终保持稳定双列 form |
| **D4** | 审计日志深度 | **B：上下文联动时间线** | 选中参数自动过滤该参数历史；事件可反向跳回列表；**不**做事件级撤销（与 D6 的 Undo Toast 职责分离） |
| **D5** | 权限管理形态 | **B：用户 × 角色分配 + 角色能力静态参考 + 添加用户弹窗** | 字面兑现 PRD "用户权限管理"；角色能力只读展示防止"双向写矩阵"演示翻车；新增 `User[]` mock |
| **D6** | 破坏性操作防护 | **B：分级 · 轻 Toast+Undo(10s)、重 ConfirmDialog** | 与 debugging-workbench D5 分级确认同模型；Undo 只保留"最后一次"不做撤销栈；全部产生审计 |
| **D7** | 批量导入流程 | **B：三步向导（源 → Diff 预览 → 执行）** | Step 2 每条可单独取消；高风险条目 AI 标注；batchId 串审计联动；预置 3 组演示源 |
| **D8** | 保存 / 脏态 | **B：轻量脏态徽章 + "导出 ▾" 合并菜单** | 消除"保存"语义谎言（改为"导出快照"）；`[● N 处未导出]` 徽章；beforeunload 守护；导出时弹 diff 摘要对话框 |
| **D9** | 列表治理能力 | **B：搜索 + 多维过滤 + 模块分组 + 多选批操 + URL 同步 + "孤儿参数"视角** | "孤儿参数"是管理员独有视角；URL 同步便于演示复现；默认分组全展开 + sessionStorage 记折叠 |
| **D10** | 响应式策略 | **B：分级断点** | ≥1440 三区同屏；1280–1440 抽屉收起；1024–1280 抽屉变 Modal；768–1024 列表变抽屉；<768 单列子路由 |
| **D11** | AI Agent 联动 | **B：与新功能强联动 + 复用 AgentInsightBar** | 动作对应新能力（扫描孤儿/预审导入/汇总审计/清理建议）；Insight Bar 零占位按需出现 |

## 目标信息架构

### 桌面 ≥1440，审计抽屉默认收起

```
┌─ TopBar：智效 WiseEff · 项目参数管理后台 · [项目 ▾] · 搜索 · 头像 ─────────────────┐
├──────────────────────────────────────────────────────────────────────────────────┤
│ ① PageHeader                                                                      │
│    面包屑：参数管理 / 项目参数管理后台                                             │
│    标题：项目参数管理后台                                                           │
│    副标题：电池与充电参数数据库 · 批量导入 · 权限和审计管理                         │
│    右侧动作区（从左到右）：                                                         │
│      [● 3 处未导出] hover/click 查看 diff 摘要                                      │
│      [📥 批量导入] 主按钮                                                          │
│      [📤 导出 JSON ▾] 菜单：下载文件 / 复制到剪贴板 / 查看 diff                     │
│      [⛁ 权限] 打开 PermissionModal                                                 │
│      [🕐 审计] 切换右侧审计抽屉展开/收起                                            │
│ ─────────────────────────────────────────────────────────────────────────────── │
│ ② KPI Strip（单行 ≈64px，紧凑卡）                                                 │
│    共享参数 10  ·  高风险 4  ·  今日变更 3  ·  孤儿参数 2 ↗  ·  最近导入 2h 前    │
│    （每项可点：高风险 → 过滤风险=高；孤儿 → 过滤覆盖=孤儿；最近导入 → 跳审计）    │
│ ─────────────────────────────────────────────────────────────────────────────── │
│ ③ AgentInsightBar（按需出现，零占位）                                             │
│    💡 参数库里有 2 个高风险孤儿参数，建议复核                                      │
│    [查看孤儿参数] [生成清理建议]                                 ✕ 今天先不看    │
│ ─────────────────────────────────────────────────────────────────────────────── │
│ ┌─ 参数库列表 340 ─┬─ 详情区 (剩余) ────────────────────────┬─ 审计抽屉（收起） ┐│
│ │ 🔍 搜索 name/key │ ┌─ 共享参数定义 ────────────────────┐  │    [🕐 展开] ↙    ││
│ │ [风险 ▾ 全部]    │ │ 参数名* · 模块*                     │  │ 徽章：今日 3 条   ││
│ │ [模块 ▾ 全部]    │ │ 推荐值 ⓘ 对所有项目生效             │  │                  ││
│ │ [覆盖 ▾ 全部]    │ │ 范围 [min][max] · 单位*             │  │                  ││
│ │ 排序 ▾ 更新 ↓    │ │ 重要性 ● 高                         │  │                  ││
│ │ [☐ 多选] [⚙ 列]  │ │ 展示描述 · 参数解释                 │  │                  ││
│ │ ───              │ │ 配置格式 (monospace)                │  │                  ││
│ │ ▾ Charging(2)    │ └─────────────────────────────────────┘  │                  ││
│ │   ☐ fast_…  🔴   │ ┌─ 项目值矩阵 ──────────────────────┐  │                  ││
│ │   ☐ charge…🔴    │ │ 项目  当前值+单位  偏差  更新时间  │  │                  ││
│ │ ▾ Battery Safe   │ │ AUR   [3850] mA  +20% 🟡  1h 前    │  │                  ││
│ │   ☐ battery 🟡   │ │ NEB   [4200] mA  +31% 🔴  09:18    │  │                  ││
│ │ ▸ Battery Est    │ │ ATL   [3000] mA  -6%  🟢  昨天     │  │                  ││
│ │ …                │ │ （越界红边 · 更新时间只读）          │  │                  ││
│ │                  │ └─────────────────────────────────────┘  │                  ││
│ │ 多选 ≥1 → 浮出   │                                          │                  ││
│ │ [改风险▾][改模块▾│                                          │                  ││
│ │  [导出子集][删除]│                                          │                  ││
│ └──────────────────┴──────────────────────────────────────────┴──────────────────┘│
│                                                                                    │
│ 弹层（按需触发，不占常驻空间）：                                                   │
│  · BulkImportWizard     Step 1 源 → Step 2 Diff 预览 → Step 3 执行 Toast+Undo    │
│  · PermissionModal      用户表 + 角色下拉 + 停用切换 + 添加用户 + 角色能力参考    │
│  · AddUserDialog        姓名 + 邮箱 + 角色 + 简单校验                              │
│  · ConfirmDialog        删除参数 / 导出 diff / 批量删除 / 停用用户               │
│  · UndoableToast        Undo 10s 窗口的统一组件                                    │
│  · Agent 浮窗           右下，复用现有组件，但 prompts/actions 升级（D11）        │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### 审计抽屉展开（≥1280）

```
┌─ TopBar + PageHeader + KPI + Insight（不变）────────────────────────────────────────┐
│ ┌─ 参数库 280 ─┬─ 详情区（≈720，项目矩阵行出现横向滚动）─┬─ 审计抽屉（400） ──────┐ │
│ │ （压缩）     │ （保持双列 form grid）                    │ [🔗 仅看 fast_…] [✕]  │ │
│ │              │                                           │ ─────────────           │ │
│ │              │                                           │ [全部][当前*][我的]     │ │
│ │              │                                           │ [导入批次] · [筛选 ▾]  │ │
│ │              │                                           │ ─────────────           │ │
│ │              │                                           │ ● 10:32 Zhao 修改       │ │
│ │              │                                           │   fast_charge: 3800→3200│ │
│ │              │                                           │   [在列表中定位 ↗]      │ │
│ │              │                                           │ ● 09:18 导入批次 BI-0042│ │
│ │              │                                           │   8 项（+3 ✎5 -0）      │ │
│ │              │                                           │   展开 ▾ 查看受影响     │ │
│ │              │                                           │ ● 昨天 Li 停用用户      │ │
│ │              │                                           │   wang@… · 参数管理员   │ │
│ │              │                                           │ …                       │ │
│ └──────────────┴───────────────────────────────────────────┴─────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

**阅读路径**：看 KPI 和 Insight 抓重点 → 搜索/过滤定位参数 → 进详情修改 → 打开审计抽屉看该参数历史验证 → 编辑完点"导出"看 diff → Toast 确认。

**关键差异（相比现状）**：

- Topbar 和 PageHeader 不再重复显示标题，副标题也不再重复。
- KPI 从 4 张大卡 → 单行 ~64px 紧凑 strip，且每项可点即是筛选快捷入口。
- `[导出 ▾]` 单按钮替换 `保存到 JSON 文件 / 导出 JSON / 复制 JSON` 三按钮集群。
- `[● N 处未导出]` 脏态徽章按需出现，解决"刷新丢草稿"的无声失败。
- 参数库列表从"扁平 + 无搜索"→ 搜索 + 多维过滤 + 模块分组折叠 + 多选批操 + URL 同步。
- 新增"孤儿参数"覆盖维度，暴露管理员独有视角（PRD §5.3 未明言但属于"参数数据库管理"应有之义）。
- 共享定义里 `推荐值` 字段加 `ⓘ 对所有项目生效` 提示，消除隐式全局写。
- 项目值矩阵的 `更新时间` 从"可手填 input" → 只读时间戳；增加 `偏差` 列（基于推荐值百分比）和越界色标。
- 审计抽屉承载 D4，上下文联动 + 批次展开 + 反向跳转。
- 权限弹窗承载 D5，用户表 + 角色下拉 + 添加用户。
- 批量导入从"一键静默" → 三步向导 + diff 预览 + batchId 审计。
- 浮动 Agent 的 prompts/actions 与新功能强联动（D11）。

---

（继续见后续节次：详细设计、数据契约、Design tokens、可访问性、空态、动效、YAGNI、测试、演示脚本）


## 详细设计

### 1. 设计原则

1. **"管理后台"的三支柱**：管参数（数据）、管人（权限）、管变更（审计）。缺一支柱就回退成"编辑器"。
2. **主任务永不被遮挡**：编辑参数（占 90% 使用时长）在 Tab 切换、抽屉展开、弹窗出现等任何情境下都保持可见+可继续。
3. **破坏性 ≠ 高摩擦**：轻操作给 10 秒反悔窗口；重操作强提醒；没有"打字确认"这种演示友好度为零的形态。
4. **演示友好**：预置示例数据、URL 同步、脏态徽章、AgentInsightBar 都是为了让讲解者 3 分钟讲完一条完整闭环。

### 2. 非目标（YAGNI）

不在本 spec 范围：

- 真实后端对接（保持 mock）
- 真实 RBAC（不做 project scope / resource scope / token-based permission）
- 参数版本管理（diff between snapshots / rollback snapshot / branch）——属于 PRD §11 后续工程
- 国际化（i18n）
- 键盘命令面板 `⌘K`——parameter-review spec D7 已 YAGNI，这里延续
- 事件级撤销（D4 明确不做，避免与 D6 Undo Toast 语义重叠）
- 审计事件的导出 / 外部系统 webhook
- 权限变更审批流（本 spec 里权限变更即时生效，只写审计）
- 参数间的依赖图 / 影响分析——parameter-review spec 的 ImpactItem 语义在这里不复用
- Agent 对话式 UI（保持浮窗 + 预设 prompts/actions 形态）
- 移动端批量操作（D10 已明确 <768 隐藏批量）

### 3. 布局系统

#### 3.1 断点与栅格

严格按 D10 五档定义：

**≥1440 · 三区可同屏**

```css
.param-admin-shell {
  display: grid;
  grid-template-columns: 340px minmax(520px, 1fr) 0;
  gap: 18px;
  transition: grid-template-columns 240ms cubic-bezier(0.2, 0, 0, 1);
}
.param-admin-shell[data-audit="open"] {
  grid-template-columns: 280px minmax(440px, 1fr) 400px;
}
```

- 审计抽屉宽度固定 400px；打开时列表从 340 → 280 压缩 60px，详情自适应剩余空间。
- `transition` 作用于 `grid-template-columns`，保证展开/收起平滑（~240ms）。
- 列表宽度不对外暴露 Resizable（和 parameter-review 的 Resizable 不同，这里没有并列审阅场景）。

**1280–1439 · 抽屉默认收起，展开时挤压更极端**

```css
@media (max-width: 1439px) {
  .param-admin-shell[data-audit="open"] {
    grid-template-columns: 240px minmax(380px, 1fr) 380px;
  }
}
```

项目值矩阵行在 ≤380px 详情宽度下触发横向滚动；最小列宽保持单位和偏差可见。

**1024–1279 · 审计抽屉切换为 Modal**

- `data-audit="open"` 时，抽屉 DOM 从侧栏位置迁移到 `<Dialog>` 中；主区恢复 `340px + 1fr + 0`。
- Dialog 样式复用 shadcn `Dialog`，宽度 `min(90vw, 720px)`，高度 `min(85vh, 720px)`。
- 切换动画由 ViewTransition 或简单 display toggle（当前原型没有 ViewTransition，采用后者）。

**768–1023 · 列表变抽屉，主区只渲染详情**

```
┌─ PageHeader ─────────────────────────────────────┐
│ [☰ 参数库] [📥 导入] [📤 导出 ▾] [⛁ 权限] [🕐 审计]│
├─ KPI Strip（更紧凑，2 行 3 项） ─────────────────┤
├─ Insight Bar（如有） ────────────────────────────┤
├─ 详情区（共享定义 + 项目矩阵纵向堆叠，全宽） ────┤
└──────────────────────────────────────────────────┘

点击 [☰ 参数库] → 左侧 Drawer 从 0 滑入 300px
```

- 列表抽屉宽度 300px，带半透明 backdrop。
- 批量多选在此断点**禁用**（`[☐ 多选]` 按钮隐藏）。
- 顶部出现提示条：`移动端视图建议使用桌面端完成批量操作`。

**<768 · 子路由式**

- 路由从 `/parameter-admin` 改为：
  - `/parameter-admin` → 参数库列表（全屏，搜索在顶部）
  - `/parameter-admin/:parameterId` → 详情页（顶部 `← 返回列表`，通过浏览器 Back 或按钮返回）
- 权限、审计、导入**保留**但全屏 Sheet 呈现。
- 脏态徽章固定在顶部右侧。
- KPI Strip 压缩到可横向滚动的 chip 带。

#### 3.2 粘性分区

| 分区 | 滚动行为 |
|---|---|
| Topbar | `position: fixed`（现有） |
| Sidebar | `position: fixed` 独立滚动（现有） |
| PageHeader | 非粘性，随主内容滚动 |
| KPI Strip | 非粘性 |
| AgentInsightBar | 非粘性 |
| 参数库列表顶部（搜索 + 过滤 chips + 排序） | 列表容器内 `position: sticky; top: 0` |
| 参数库列表底部批量操作条 | `position: sticky; bottom: 0`，仅多选模式可见 |
| 详情区头部（参数名 + 面包屑） | 详情容器内 `position: sticky; top: 0` |
| 审计抽屉头部（过滤 chip 和快速切换） | 抽屉容器内 `position: sticky; top: 0` |

### 4. PageHeader 与 KPI

#### 4.1 PageHeader

结构：

```jsx
<PageHeader
  breadcrumb={["参数管理", "项目参数管理后台"]}
  title="项目参数管理后台"
  subtitle="电池与充电参数数据库 · 批量导入 · 权限和审计管理"
  actions={
    <>
      <DirtyIndicator />      {/* D8 */}
      <Button variant="default" onClick={openImport}>
        <Upload size={16} /> 批量导入
      </Button>
      <DropdownMenu>...</DropdownMenu>  {/* 导出 ▾ */}
      <Button variant="outline" onClick={openPermissions}>
        <ShieldCheck size={16} /> 权限
      </Button>
      <Button variant="ghost" onClick={toggleAudit}
        data-active={auditOpen}>
        <History size={16} /> 审计 {auditTodayCount ? <Badge>{auditTodayCount}</Badge> : null}
      </Button>
    </>
  }
/>
```

- Topbar 和 PageHeader 标题一致时，**Topbar 只渲染 Logo + 项目切换 + 搜索 + 头像**，标题和副标题交给 PageHeader 独占（解决评测 #2 重复）。
- 如果未来有跨面包屑导航，在 Topbar 左侧展示当前定位；这份 spec 假定保持现有 Topbar 行为不动，仅通过条件渲染抑制重复标题。

#### 4.2 DirtyIndicator（脏态徽章）

组件：`<DirtyIndicator count={number} onInspect={() => void} />`

- `count === 0` → 完全不渲染（零占位）。
- `count > 0` → 渲染 `[● N 处未导出]`，`●` 为 `--dirty-pulse` 脉冲色（见 §9 tokens）。
- Hover：Tooltip `自上次导出以来已修改 N 处参数`。
- Click：打开 `ExportDiffDialog`（D8 定义的 diff 摘要对话框，即便用户没点"导出"也能预览）。
- 更新：脏态计数来自 reducer selector `selectDirtyCount(state)`，比较 `configDraft` 与 `lastExportedSnapshot` 字符串。

#### 4.3 导出 ▾ 菜单

`<DropdownMenu>` 三个选项：

- `📥 下载 JSON 文件`：生成文件名 `params-YYYYMMDD-HHmmss.json` 并触发浏览器下载 Blob（沿用 `URL.createObjectURL`）。
- `📋 复制到剪贴板`：`navigator.clipboard.writeText(JSON.stringify(configDraft, null, 2))`。
- `👁 查看导出 diff`：打开 `ExportDiffDialog`（与脏态徽章 click 同入口）。

**关键行为（D6 + D8 联动）**：

- 任一写出动作前，如果 `dirtyCount > 0`，**先弹 `ExportDiffDialog` 展示摘要**：
  ```
  将导出的快照包含以下变更（相对上次导出）：
  + 新增参数：1 项（new_bms_thr）
  ✎ 更新元数据：2 项（fast_charge · charge_voltage）
  ✎ 更新项目取值：3 处
  - 删除参数：0 项

  [取消] [确认导出]
  ```
- 用户 `确认导出` → 执行实际下载/复制 → Toast `已导出 params-2026...-....json` → 清零脏态 → 追加 auditEvent `kind=export, snapshotName=...`。
- 若 `dirtyCount === 0`，点击"下载/复制"**无 Confirm**，直接执行（避免在"没变更时"弹空 Dialog 干扰）。
- `查看导出 diff` 不触发下载，仅展示。

#### 4.4 KPI Strip

组件：`<KpiStrip items={KpiItem[]} />`

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 共享参数 10  │ 高风险 4 ↗  │ 今日变更 3 ↗  │ 孤儿参数 2 ↗  │ 最近导入 2h 前│
└──────────────────────────────────────────────────────────────────────────┘
```

每个 item 结构：

```ts
type KpiItem = {
  label: string;
  value: string | number;
  hint?: string;          // hover Tooltip
  interactive?: boolean;  // 若为 true，显示 ↗ 图标
  onClick?: () => void;   // 跳转动作
  tone?: "neutral" | "warning" | "danger";
}
```

五个 item 的具体行为：

1. `共享参数` — 静态计数，不交互
2. `高风险` — value=`count(risk==="High")`；click → URL `?risk=high`，列表自动切到该过滤
3. `今日变更` — value=当天 auditEvents 数；click → 打开审计抽屉 + 默认过滤"全部·今日"
4. `孤儿参数` — value=`count(coverage==="orphan")`；click → URL `?coverage=orphan`；tone=`warning` 当 >0
5. `最近导入` — value=相对时间 `Intl.RelativeTimeFormat`；click → 打开审计抽屉 + 过滤"导入批次"

- strip 高度 64px，每项 flex 1，`border-right: 1px solid var(--border)`（最后一项无）
- 所有 KPI **去掉原有黑色装饰进度条**（评测 #4）
- 移动端 <768：变为横向滚动 chip，每个 chip 保持可点

#### 4.5 AgentInsightBar

**复用 debugging-workbench spec 定义的同名组件**（`<AgentInsightBar items persistKey />`），数据源切换为派生函数 `deriveParameterAdminInsights(state)`：

```ts
function deriveParameterAdminInsights(state): Insight[] {
  const insights: Insight[] = [];

  // 主 Insight：高风险孤儿参数
  const orphans = selectParameters(state).filter(isOrphan);
  const highRiskOrphans = orphans.filter(p => p.risk === "High");
  if (highRiskOrphans.length > 0) {
    insights.push({
      id: "high-risk-orphans",
      tone: "warning",
      headline: `参数库里有 ${highRiskOrphans.length} 个高风险孤儿参数，建议复核`,
      meta: `孤儿合计 ${orphans.length} · 其中高风险 ${highRiskOrphans.length}`,
      actions: [
        { id: "view-orphans", label: "查看孤儿参数", onClick: () => setSearch({ coverage: "orphan" }) },
        { id: "draft-cleanup", label: "生成清理建议", onClick: openCleanupDraft },
      ],
    });
  }

  // 次级 Insight：权限变更异常（24h 内权限变更 > 3 次）
  const recentPermChanges = state.auditEvents.filter(e =>
    e.kind === "permission-change" &&
    withinHours(e.time, 24)
  );
  if (recentPermChanges.length > 3) {
    insights.push({
      id: "permission-anomaly",
      tone: "danger",
      headline: `过去 24 小时有 ${recentPermChanges.length} 次权限变更，建议复核`,
      actions: [
        { id: "view-perm-audit", label: "打开审计（权限）", onClick: openAuditFilteredPerm },
        { id: "open-permissions", label: "打开权限设置", onClick: openPermissions },
      ],
    });
  }

  return insights;
}
```

- 显示最多 2 条 Insight；空数组时组件不渲染（零占位）。
- 折叠行为：右上角 `✕ 今天先不看` → `persistKey="parameter-admin.insight"` 写 `sessionStorage`（非 localStorage）。
- 每条 Insight 的 `onClick` 都是**导航/过滤**类动作，不直接改业务状态（符合 D11 "Agent 作为入口导航"定位）。

### 5. 参数库列表（D9 完整治理面）

#### 5.1 容器与顶部栏

```jsx
<section className="param-library" role="region" aria-label="项目共享参数库">
  <header className="library-header">
    <SearchBox placeholder="搜索 name / key / module / 描述..." />
    <div className="filter-chips">
      <FilterChip group="risk" options={["全部","高","中","低"]} />
      <FilterChip group="module" options={moduleOptions} multi />
      <FilterChip group="coverage" options={[
        { value: "all", label: "全部项目" },
        { value: "full", label: "3 个项目都有" },
        { value: "partial", label: "缺某个项目" },
        { value: "orphan", label: "孤儿参数" },
      ]} />
    </div>
    <div className="library-toolbar">
      <SortDropdown options={["更新时间 ↓","名称 A-Z","风险 ↓","覆盖项目数 ↑"]} />
      <IconButton onClick={toggleMultiSelect} aria-label="多选模式" />
      <IconButton onClick={openColumnMenu} aria-label="列显示/隐藏" />
    </div>
  </header>
  <ParameterGroupList />
  <BulkActionBar visible={selectedIds.length > 0} />
</section>
```

#### 5.2 搜索

- 模糊匹配：`param.name || param.module || param.description || param.explanation` 任一包含搜索词（大小写不敏感）。
- 匹配字段高亮：命中词用 `<mark>` 包裹。
- 搜索词写入 URL `?q=...`。
- 搜索无结果时显示 `EmptyState`："没有匹配 '<q>' 的参数 · 尝试清除其它筛选"。

#### 5.3 筛选 Chip

- **风险**：单选 chip 组，默认"全部"。活跃时 chip 填色 + 尾部 `✕`。URL `?risk=high`。
- **模块**：下拉多选（`DropdownMenu` + checkbox 列表）。选中数量显示在按钮上 `模块 (2) ▾`。URL `?module=charging-policy,battery-safety`。
- **覆盖**：单选下拉。URL `?coverage=orphan`。
  - `coverage` 计算函数：
    ```ts
    function getCoverage(parameter, projects): "full" | "partial" | "orphan" {
      const valuedProjects = projects.filter(p => parameter.values[p.id]?.currentValue);
      if (valuedProjects.length === 0) return "orphan";
      if (valuedProjects.length < projects.length) return "partial";
      return "full";
    }
    ```
- 活跃筛选 ≥ 1 时，chip 组末尾出现 `[清除筛选]` 图标按钮，一键清空所有 chip 并重置 URL。

#### 5.4 分组折叠

默认按 `parameter.module` 分组，每组：

```
▾ Charging Policy (2)
   ☐ fast_charge_current_limit_ma          🔴 高    3 项目
   ☐ charge_voltage_limit_mv               🔴 高    3 项目
▸ Battery Safety (1)     [collapsed]
▾ Battery Estimation (1)
   ☐ soc_estimation_smoothing              🔴 高    3 项目
...
```

- 组标题 38px 高，`button` 元素可点击折叠，`aria-expanded` 同步。
- 折叠状态写 `sessionStorage` key=`parameter-admin.collapsed-groups`，值为被折叠的模块名数组。
- 默认策略：首次进入全展开；用户手动折叠后本 session 记住；关闭标签页后重置。
- 当筛选后某组为 0 匹配时，组标题不渲染（与空组不同，空组原本就没参数）。
- 搜索词存在时，**忽略折叠状态**，所有命中组强制展开（保证用户能看见匹配项）。

#### 5.5 行规格

```
┌───────────────────────────────────────────────────────────────┐
│ ☐  fast_charge_current_limit_ma                   🔴 高        │  ← 第 1 行
│    3 项目 · 已覆盖 · 推荐 3200 mA                              │  ← 第 2 行
└───────────────────────────────────────────────────────────────┘
```

- 总高 64px（和 parameter-review 队列行一致）。
- `☐` 只在多选模式可见；非多选时整行是 `<button>` 点击选中。
- 第 2 行副信息格式由 `coverage` 驱动：
  - `full` → `N 项目 · 已覆盖 · 推荐 X unit`
  - `partial` → `N/M 项目 · ⚠ 缺 <missing_project_code>`
  - `orphan` → `⚠ 孤儿参数 · 无项目使用`
- 选中态：`border-left: 3px solid var(--app-primary)` + `background: var(--selected-row-bg)`。
- Hover（非选中）：`background: rgba(16,28,45,0.035)`。
- 选中 + Hover：保持选中视觉。
- 键盘 Focus：`outline: 2px solid var(--app-primary); outline-offset: -2px`。
- `aria-selected="true"` 同步设置，列表容器 `role="listbox"`。

#### 5.6 多选与批量操作条

**多选进入方式**：

1. 点击顶部 `[☐ 多选]` 切换到多选模式（按钮变 `[☑ 退出多选]`）。
2. 按住 `Shift` + click 一行进入多选并选中从上次选中到此行的区间。
3. 键盘 `Shift+↓` / `Shift+↑` 扩展选择区间。

**底部 BulkActionBar**（`position: sticky; bottom: 0`，选中数 ≥1 时出现）：

```
┌─────────────────────────────────────────────────────────────────────┐
│ 已选 3 项  [改风险 ▾] [改模块 ▾] [导出子集] [删除]       [清除选择] │
└─────────────────────────────────────────────────────────────────────┘
```

- `改风险 ▾`：下拉三档 `高/中/低`，立即应用 + Toast + Undo 10s；每个参数产生独立 audit 事件 + 共享 `batchId=bulk-risk-<nanoid>`。
- `改模块 ▾`：下拉现有模块 + "新建模块..."。同上 batch 机制。
- `导出子集`：立即生成一个 JSON 下载（仅包含选中参数的定义与取值）；**不清零脏态**（因为这是导出子集不是快照）。
- `删除`：弹 `BulkDeleteConfirmDialog`（§7.2）→ 执行后 Toast + Undo 10s。
- `清除选择`：退出多选并清空 selectedIds。

#### 5.7 URL 同步（sessionStorage 兜底）

所有筛选/搜索/排序/选中写 URL：

```
/parameter-admin
  ?q=charge
  &risk=high
  &module=charging-policy,battery-safety
  &coverage=all
  &sort=updatedAt-desc
  &id=fast_charge_current_limit_ma       (当前选中)
  &audit=open                              (审计抽屉是否展开)
```

- 使用 `useSearchParams` 钩子（自建 thin wrapper，因为项目暂未引入 react-router）；现有 `PageProps.search` 已是 URL search params，直接扩展。
- 折叠状态不走 URL（走 sessionStorage）。
- 多选状态不走 URL（避免分享链接时误选）。

### 6. 详情区（共享定义 + 项目值矩阵）

#### 6.1 详情头部

```
┌───────────────────────────────────────────────────────────────┐
│ fast_charge_current_limit_ma  🔴 高                            │
│ Charging Policy · 3 项目已覆盖 · 最后更新 1h 前                │
│ ─────────────────                                              │
└───────────────────────────────────────────────────────────────┘
```

- `position: sticky; top: 0`，保证滚动详情内容时头部固定。
- 右侧无操作按钮（删除/新增由列表多选承担；避免误触）。
- 非多选模式下，头部右侧显示 `[在审计里看此参数 ↗]` 图标按钮 → 打开审计抽屉并过滤到当前参数（D4 联动入口之一）。

#### 6.2 共享定义表单（改进原表单）

字段布局（二列 form grid）：

| 位置 | 字段 | 组件 | 校验/提示 |
|---|---|---|---|
| 左1 | 参数名* | `input` monospace | 必填；snake_case 正则校验 `^[a-z][a-z0-9_]*$`；重名检测 |
| 右1 | 模块* | `input` + datalist（从现有模块建议） | 必填 |
| 左2 | 推荐值 ⓘ | `input` + tooltip | `ⓘ 对所有项目生效` |
| 右2 | 单位* | `input` | 必填；短文本 |
| 左3 | 范围 | `input[type=number] min` + `input[type=number] max` | 两端必须同类型（全数值或全文本，本 spec 只支持数值范围；不支持类别枚举） |
| 右3 | 重要性 | 自定义 `<RiskPicker>` | 三档色标 `● 高 ● 中 ● 低` |
| 跨列 | 展示描述 | `textarea` rows=2 | 可选 |
| 跨列 | 参数解释 | `textarea` rows=3 | 可选 |
| 跨列 | 配置格式 | `textarea` rows=3 monospace | 可选 |

**关键改进**：

- **推荐值 ⓘ**：图标 hover 显示 "对所有项目生效。要编辑单个项目的实际值，请到下方'项目值矩阵'。"
- **范围拆成 min/max**：去掉"自由文本" anti-pattern。如果原数据是文本格式（如 `"2500 - 4500"`），迁移脚本按 `split("-").map(trim).map(Number)` 解析；解析失败则保留 raw 字符串，在 UI 显示 `⚠ 范围格式需迁移`。
- **配置格式**：改为 `font-family: var(--font-mono)` 但不引入 syntax highlighter（YAGNI）；仅视觉提示它是结构化内容。
- **重要性 RiskPicker**：自定义组件，展示为 3 个圆点按钮：
  ```jsx
  <RiskPicker value="High">
    <button data-risk="High">● 高</button>
    <button data-risk="Medium">● 中</button>
    <button data-risk="Low">● 低</button>
  </RiskPicker>
  ```
  色标与列表徽章共用 token（§9）。
- **字段级校验**：校验失败时字段下方 `<FieldError>` 红字 + `aria-invalid="true"`；`参数名` 重名错误同时在头部参数名旁显示 ⚠ 图标。
- **自动保存到 `state.configDraft`**：用户输入 → 节流 250ms → dispatch `UPDATE_PROJECT_PARAMETER_METADATA`；脏态立即更新。

#### 6.3 项目值矩阵（改进）

```
┌────────────────────────────────────────────────────────────────┐
│ 项目         │ 当前值             │ 偏差        │ 更新时间      │
├──────────────┼────────────────────┼─────────────┼──────────────┤
│ AUR-Prod     │ [3850] mA          │ +20.3% 🟡   │ 1 小时前      │
│ Aurora 量产  │ 推荐 3200          │ 上限 4500 ✓ │ 2026-05-10   │
├──────────────┼────────────────────┼─────────────┼──────────────┤
│ NEB-RD       │ [4200] mA          │ +31.3% 🔴   │ 今天 09:18    │
│ Nebula 高频  │ 越界 🚨 >上限 4500 │             │               │
│              │ ← 4500 为最大值    │             │               │
├──────────────┼────────────────────┼─────────────┼──────────────┤
│ ATL-Intl     │ [3000] mA          │ -6.3% 🟢    │ 昨天           │
│ Atlas 海外   │                    │             │               │
└────────────────────────────────────────────────────────────────┘
```

- **当前值 input**：
  - `type="number"`（当范围是数值型时）或 `type="text"` 兜底
  - `inputMode="decimal"` 提示移动端数字键盘
  - 右侧 suffix 显示 `单位`（来自共享定义的 `unit` 字段，就近展示）
  - 越界（超 min/max）：`border: 2px solid var(--status-risk-high); aria-invalid="true"`，下方红字 `超过上限 4500`（或 `低于下限 2500`）
  - 推荐值之下显示浅灰 `推荐 3200`
- **偏差列**：自动计算 `(currentValue - recommendedValue) / recommendedValue`，展示百分比 + 色标
  - `|偏差| ≤ 10%` → 🟢 绿
  - `10% < |偏差| ≤ 25%` → 🟡 黄
  - `|偏差| > 25%` → 🔴 红
  - 偏差值不可编辑，派生于当前值和推荐值
- **更新时间列**（关键改动）：改为**只读时间戳**
  - 当前值修改时，自动写入 `new Date().toISOString()` 到 `values[projectId].updatedAt`
  - 展示逻辑：`Intl.RelativeTimeFormat` 相对时间 + 下方小字绝对时间 `2026-05-10 21:37`
  - Hover 整列单元格显示绝对时间 + 最后修改者（来自 `auditEvents` 最近一条）
  - 移除现有"可手填 input"——这是评测 #8 的修正
- **行背景**：越界行 `background: var(--status-risk-high-bg)` 浅色染色（不抢眼但可识别）

#### 6.4 字段级校验与数据迁移

**校验优先级**：

1. 参数名 snake_case 规则（格式错）> 其它所有
2. 数值越界（项目值 vs 共享定义的 min/max）
3. 范围 min/max 顺序（min > max 则两者都标红）
4. 推荐值在范围内
5. 重名检测

**迁移脚本（M1 里程碑）**：

当前 `range` 是自由字符串如 `"2500 - 4500"`。加一个 `migrateParameterRange(parameter)`：

```ts
function migrateParameterRange(parameter: ParameterEditorDraft): { min?: number; max?: number; raw: string } {
  const raw = parameter.range ?? "";
  const parts = raw.split(/[-–—~]/).map(s => s.trim());
  if (parts.length === 2 && !isNaN(Number(parts[0])) && !isNaN(Number(parts[1]))) {
    return { min: Number(parts[0]), max: Number(parts[1]), raw };
  }
  return { raw };  // 保留 raw，UI 显示需迁移
}
```

类型扩展见 §8。

### 7. 审计抽屉（D4 上下文联动）

#### 7.1 容器与触发

- 桌面 ≥1280：侧栏并列，通过 `[🕐 审计]` 按钮切换展开/收起。
- ≤1279：弹 Modal（shadcn `Dialog`）。

关闭行为：

- 按钮再次点击 → 收起/关闭
- `Esc` → 关闭（Modal 默认；侧栏需手动处理）
- 路由离开 → 自动关闭

状态（URL）：`?audit=open`；Modal 态在 <1280 时 URL 仍可以持有，resize 回桌面时自动转回侧栏。

#### 7.2 抽屉内容

```
┌─ 审计日志 ──────────────────────────────── [✕] ─┐
│ 🔗 仅看 fast_charge_current_limit_ma    [清除 ✕] │  ← 仅在列表选中某参数时出现
│ ─────────────                                    │
│ [全部] [当前*] [我的] [导入批次] [权限] [搜索]    │  ← 视角切换
│ ─────────────                                    │
│ ● 10:32  H. Zhao 修改此参数                      │
│   值变更：3800 mA → 3200 mA                      │
│   偏差 -15.8%  ·  IP 内部                         │
│   [在列表中定位 ↗]                                │
│ ─────────────                                    │
│ ● 09:18  Xu Yun 导入批次 BI-0042  ▾               │
│   8 项（+3 新增 · ✎5 更新 · -0 删除）            │
│   ▾ 展开查看受影响参数                            │
│     + new_bms_balance_threshold_mv               │
│     ✎ fast_charge_current_limit_ma               │
│     ✎ charge_voltage_limit_mv                    │
│     ... 展开查看所有                              │
│   [回看此批次 ↗]                                  │
│ ─────────────                                    │
│ ● 昨天 18:04  Li Min 删除 legacy_param_x          │
│   所属模块：Legacy · 影响 0 个项目（孤儿）        │
│ ─────────────                                    │
│ ● 昨天 14:22  Xu Yun 改 Zhao Heng 角色           │
│   参数管理员 → 平台管理员                         │
│   [打开权限 ↗]                                    │
└──────────────────────────────────────────────────┘
```

#### 7.3 视角切换 Chip

| Chip | 过滤规则 |
|---|---|
| 全部 | 不过滤（限制最近 50 条） |
| 当前 | `event.parameterId === selectedParameterId`（仅当有选中） |
| 我的 | `event.actor === state.currentUser.name`（用 `activeRoleId` 对应用户 as proxy） |
| 导入批次 | `event.kind === "batch-import"` |
| 权限 | `event.kind in ["user-role-change", "user-toggle", "user-add"]` |

**"当前"chip** 的存在条件：列表必须有选中参数。没选中时此 chip 置灰。

Chip 默认值：
- 如果列表有选中参数 → 默认"当前"
- 否则 → 默认"全部"

#### 7.4 事件渲染规则

每条事件的图标、颜色、动作按钮由 `event.kind` 决定：

| kind | 图标 | 色 | 可用动作 |
|---|---|---|---|
| `parameter-update` | ✎ | 中性 | `[在列表中定位 ↗]` |
| `parameter-add` | ＋ | 绿 | `[在列表中定位 ↗]` |
| `parameter-delete` | − | 红 | （仅文本，无跳转——参数已删） |
| `batch-import` | 📥 | 蓝 | `[回看此批次 ↗]` + 可展开受影响参数 |
| `batch-risk-change` | ⚡ | 橙 | `[查看批次 ↗]` |
| `user-role-change` | 👤 | 紫 | `[打开权限 ↗]` |
| `user-toggle` | 🔌 | 灰 | `[打开权限 ↗]` |
| `user-add` | ＋👤 | 绿 | `[打开权限 ↗]` |
| `export` | 📤 | 中性 | （仅文本） |
| `rollback-undo` | ↩ | 紫 | （说明上条被撤销） |

#### 7.5 反向跳转行为

- `[在列表中定位 ↗]`：
  1. 如果参数仍在库中 → 清空搜索 + 清空筛选 + 滚动到对应行 + 选中 + 高亮脉冲 1s
  2. 如果参数已删（`parameter-delete` 之后） → 按钮禁用 + Tooltip "参数已删除"
- `[回看此批次 ↗]`：按 `batchId` 过滤审计到这一批所有事件 + 展开批次详情
- `[打开权限 ↗]`：打开 `PermissionModal`，不关闭审计抽屉（桌面态）；移动态则关闭抽屉 Modal 再打开权限 Modal

#### 7.6 无限滚动与性能

- 抽屉内展示最近 50 条事件，滚动到底部触发加载下 50 条（mock 数据量控制在 200 条以内，无需真实分页 API）。
- 默认按 `event.time` 倒序。
- 无匹配时显示 `EmptyState`: `该视角下暂无审计事件 · 试试切换到"全部"`。

### 8. 权限管理弹窗（D5）

#### 8.1 入口与容器

- `[⛁ 权限]` 按钮打开 `PermissionModal`（shadcn `Dialog`）。
- 宽度 `min(90vw, 720px)`，高度 `min(85vh, 620px)`。
- 整个 Modal 有独立滚动，Header 粘性。

#### 8.2 Modal 结构

```
┌─ 权限设置 · 10 个用户 ─────────────────────────── [✕] ─┐
│ 🔍 搜索用户                           [+ 添加用户]       │
│ ────────                                                │
│ ┌──────────────────────────────────────────────────┐  │
│ │ Zhao Heng    zhao@chargelab.cn                    │  │
│ │ 硬件开发 ▾                       ● 活跃  🔌       │  │
│ ├──────────────────────────────────────────────────┤  │
│ │ Liu Min      liu@chargelab.cn                     │  │
│ │ 项目开发 ▾                       ● 活跃  🔌       │  │
│ ├──────────────────────────────────────────────────┤  │
│ │ Wang Jie     wang@chargelab.cn                    │  │
│ │ 参数管理员 ▾                     ● 活跃  🔌       │  │
│ ├──────────────────────────────────────────────────┤  │
│ │ Xu Yun       xu@chargelab.cn     (当前登录)       │  │
│ │ 平台管理员 ▾                     ● 活跃  🔌       │  │
│ ├──────────────────────────────────────────────────┤  │
│ │ (已停用) Tao Lin   tao@chargelab.cn               │  │
│ │ 硬件开发                         ○ 停用  🔌       │  │
│ └──────────────────────────────────────────────────┘  │
│                                                         │
│ ▾ 角色能力参考（只读）                                  │
│   硬件开发     只读参数                                  │
│   项目开发     只读 · 可编辑参数                         │
│   参数管理员   只读 · 可编辑 · 可发布                     │
│   平台管理员   全部 + 可改权限                           │
│                                                         │
│ [关闭]                                                   │
└─────────────────────────────────────────────────────────┘
```

#### 8.3 用户行交互

- **角色下拉**：`<RoleSelect>` 四档，切换立即 dispatch `ASSIGN_USER_ROLE`，Toast `已将 <user> 改为 <newRole> · 6s 内可撤销`（权限变更用 6s 窗口，比参数操作更短，强调"权限要谨慎"）。
- **活跃/停用切换 🔌**：click → 立即 dispatch `TOGGLE_USER_ACTIVE`，Toast + Undo 6s。
- **当前登录用户**：右侧显示 `(当前登录)` 灰色标记；角色下拉和停用按钮对当前登录用户**禁用**（防止管理员把自己锁出）。
- **停用用户**：行整体浅灰（`opacity: 0.6`），`(已停用)` 前缀标记。

#### 8.4 添加用户

`[+ 添加用户]` 打开 `AddUserDialog`（二级 Dialog）：

```
┌─ 添加用户 ─────────────────────────── [✕] ─┐
│ 姓名*       [___________________]            │
│ 邮箱*       [___________________]            │
│ 角色*       [硬件开发 ▾]                     │
│                                              │
│ [取消]  [添加]                               │
└──────────────────────────────────────────────┘
```

- 校验：
  - 姓名 1-32 字符
  - 邮箱正则 `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`
  - 邮箱唯一性检查
  - 角色必选
- 提交成功后：
  - `PermissionModal` 用户列表自动滚动到新用户
  - Toast `已添加 <name>`
  - 审计追加 `user-add` 事件
- 添加用户**不提供 Undo**（添加即可立即删除/停用，无需 Undo 语义）

#### 8.5 角色能力参考卡

- 只读展示，4 个角色 × 能力文本映射（硬编码在代码里不可改）。
- 折叠区，默认收起；点击 `▾` 展开。
- 能力条目：`只读` / `可编辑` / `可发布` / `可改权限`。
- 这里的"能力"是**叙事装饰**，不是真实 RBAC 逻辑——原型里所有角色实际上都能看、都能改；角色能力只影响演示叙事。

#### 8.6 权限变更审计

每次角色/停用/添加操作都追加 auditEvent：

```ts
{
  id: nanoid(),
  kind: "user-role-change" | "user-toggle" | "user-add",
  actor: state.currentUser.name,
  target: { userId, userName },
  from: prevValue,
  to: newValue,
  time: new Date().toISOString(),
  severity: "Medium",
}
```

### 9. 批量导入向导（D7 三步）

#### 9.1 触发与路由

- `[📥 批量导入]` 按钮 → `BulkImportWizard` 全屏 Dialog。
- 导入过程中禁止关闭浏览器窗口（`beforeunload` 额外守护）。
- 每步通过 `wizardStep` URL 参数持久化 `?import=step1|step2|step3`，刷新可恢复到当前步（数据不恢复，只恢复步骤位置）。

#### 9.2 Step 1 · 源

```
┌─ 批量参数导入 · Step 1/3 · 选择源 ───────────────── [✕] ─┐
│                                                          │
│ ⊙ 上传 JSON 文件                                          │
│     ┌────────────────────────────────────────────────┐  │
│     │   📥 拖放或点击选择                            │  │
│     │   支持 .json，最大 5MB                          │  │
│     └────────────────────────────────────────────────┘  │
│                                                          │
│ ○ 粘贴 JSON                                               │
│     [textarea rows=8 monospace disabled-until-selected] │
│                                                          │
│ ○ 从演示示例加载                                          │
│     [下拉：混合变更 (8 项) / 新增 3 项 / 更新 5 项]     │
│                                                          │
│                                [取消]  [下一步 →]        │
└──────────────────────────────────────────────────────────┘
```

- 三种方式单选；选中时对应区域激活。
- "演示示例"下拉预置 3 组 mock JSON（来自 `src/mockData.ts` 新增的 `importDemoSources`）。
- 点击"下一步"前做 schema 校验：
  - 必须有顶层 `{ parameterLibrary: [...] }`
  - 每条 parameter 必有 `id / name / module / values`
  - 任何一项 invalid → 红字显示"此处 JSON 无效：<reason>"，"下一步"禁用。

#### 9.3 Step 2 · Diff 预览

```
┌─ 批量参数导入 · Step 2/3 · 预览变更 ──────────────── [✕] ─┐
│ 将要：+3 新增 · ✎5 更新 · -0 删除 = 合计 8 项             │
│ [⚠ 高风险 2]  [⚠ 越界 1]                                  │
│ ─────────────────                                          │
│ 过滤：[全部] [新增] [更新] [删除] [高风险] [冲突]          │
│ 搜索 [name/key/module] 🔍                                  │
│ ─────────────────                                          │
│ ＋ new_bms_balance_threshold_mv         [取消导入此项]    │
│   Battery Safety · 🔴 高                                   │
│   AUR-Prod: 3450   NEB-RD: 3500   ATL-Intl: 3400          │
│ ─────                                                      │
│ ✎ fast_charge_current_limit_ma          [取消导入此项]    │
│   推荐值 3200 → 3000                                       │
│   （元数据变更，项目值不受影响）                           │
│ ─────                                                      │
│ ✎ charge_voltage_limit_mv   ⚠ 高风险    [取消导入此项]    │
│   推荐值 4400 → 4500 (+2.3%)                               │
│   AUR-Prod: 4400 → 4550  ⚠ 超过原范围上限 4500            │
│   NEB-RD: 4500 → 4550                                     │
│ ─────                                                      │
│ ... (其余条目省略)                                         │
│                                                            │
│           [← 上一步]      已保留 8 项 → [确认导入 8 项]    │
└────────────────────────────────────────────────────────────┘
```

**Diff 计算**（派生函数 `computeImportDiff(current, incoming)`）：

```ts
function computeImportDiff(current, incoming): ImportDiff {
  const added: Parameter[] = incoming.filter(p => !current.find(c => c.id === p.id));
  const updated: { parameter: Parameter; changes: ChangeRecord }[] = [];
  const deleted: Parameter[] = current.filter(c => !incoming.find(p => p.id === c.id) && c.isInIncomingScope);
  // ... 省略具体比较逻辑
  return { added, updated, deleted };
}
```

- **取消导入**：每条右侧按钮 → 该条从 `selectedItems` 移除；不影响其它条。计数实时更新。
- **过滤 chip**：`全部 / 新增 / 更新 / 删除 / 高风险 / 冲突`。"冲突"= 当前项目有用户已编辑未导出的变更，导入会覆盖掉。
- **AI 高风险标注**：Agent 预审（D11 `预审导入风险` 动作）给风险条目加 `⚠ 高风险` 徽标；具体判断规则：风险等级=High + 变更幅度 >20%。
- **搜索**：在预览范围内模糊匹配 name/key/module。
- 任意筛选/取消后 `已保留 N 项` 和 `确认导入 N 项` 同步更新。
- 如果 `N === 0`，`确认导入` 按钮禁用。

#### 9.4 Step 3 · 执行与反馈

点击"确认导入 N 项" → 立即：

1. dispatch `BATCH_IMPORT_PARAMETERS` with `batchId = "BI-" + nanoid(6)` + 选中条目
2. Wizard 关闭
3. Toast: `已导入 8 项（+3 新增 · ✎5 更新） · 10 秒内可撤销`
4. 追加 auditEvent `kind="batch-import", batchId, affectedIds, summary: "+3 ✎5 -0"`
5. 如果被影响的参数在当前列表筛选下，列表行高亮脉冲 1s

**撤销（10s 内）**：

- Toast 的 `[撤销]` 按钮 → dispatch `UNDO_BATCH_IMPORT` with `batchId`
- reducer 使用 `state._undoStack` 里存的 pre-state 快照还原 `configDraft`
- 追加一条 `kind="rollback-undo", originalBatchId=BI-xxxxx, reason="用户撤销"` 事件
- Toast 消失后不可再撤销

**演示源固定**：

- 示例 1 "新增 3 项"：3 个新参数（`new_bms_balance_threshold_mv` / `new_wireless_peak_w` / `new_sleep_drain_ua`），全高风险
- 示例 2 "更新 5 项推荐值"：5 个现有参数只改 `recommendedValue`
- 示例 3 "混合 8 项"：3 新增 + 5 更新（含 2 高风险变更 + 1 越界），默认选中

### 10. 破坏性操作统一组件（D6）

#### 10.1 UndoableToast

组件：`<UndoableToast message timeout onUndo />`

```tsx
<UndoableToast
  message="已删除 fast_charge_current_limit_ma"
  timeout={10000}
  onUndo={() => dispatch({ type: "UNDO_LAST_DESTRUCTIVE" })}
/>
```

- 基于 shadcn `Sonner`（若项目尚未引入则用简单的 fixed bottom-right `<div>` 实现）。
- 右侧 `[撤销]` 按钮 + 倒计时进度条（`<progress>` 或 CSS transition）。
- 超时自动消失；点击 `[撤销]` 立即消失。
- 最多同时 1 个 UndoableToast（新操作立即取代旧 toast，旧 toast 的 undo window 直接结束）。
- 默认 `timeout` 值：
  - 参数操作：10000ms
  - 批量操作：10000ms
  - 权限操作：6000ms（D5）

#### 10.2 ConfirmDialog 分级

复用现有 `ConfirmDialog` 组件，扩展 3 个变体：

**`<DeleteParameterDialog>`**：

```
⚠ 删除参数 fast_charge_current_limit_ma

该参数被 3 个项目使用：AUR-Prod · NEB-RD · ATL-Intl

删除后：
  · 所有项目的当前值将丢失
  · 这是跨项目共享定义，其它项目也会失去此参数
  · 10 秒内可通过 Toast 撤销

[取消]  [确认删除]
```

**`<BulkDeleteConfirmDialog>`**：

```
⚠ 批量删除 5 个参数

  · fast_charge_current_limit_ma  (3 项目使用)
  · legacy_wake_voltage_mv         (孤儿)
  · ...

合计影响 3 个项目的 N 个取值。
10 秒内可通过 Toast 撤销所有删除。

[取消]  [确认删除 5 项]
```

**`<ExportDiffDialog>`**：

```
将导出的快照包含以下变更（相对上次导出）：
+ 新增参数：1 项（new_bms_thr）
✎ 更新元数据：2 项（fast_charge · charge_voltage）
✎ 更新项目取值：3 处
- 删除参数：0 项

[取消]  [确认导出]
```

#### 10.3 Undo 栈语义

`state._undoStack` 只保留 `{ action: "...", snapshot: configDraft, createdAt: Date, expiresAt: Date }` 一项。

- 新的破坏性操作发生时：
  1. 先清掉上一条 pending undo（其 toast 也立即消失）
  2. 再执行当前操作并创建新的 undo 项
- 操作类型 vs undo 行为：
  - `DELETE_PROJECT_PARAMETER` → 还原被删参数
  - `BATCH_IMPORT_PARAMETERS` → 还原整个 configDraft 到 pre-import snapshot
  - `BULK_DELETE` → 还原 N 个参数
  - `BULK_CHANGE_RISK` → 还原 N 个参数的 risk 字段
  - `ASSIGN_USER_ROLE` / `TOGGLE_USER_ACTIVE` → 还原该用户的 `role` / `isActive`
- `_undoStack` 不持久化到 localStorage；刷新 = 放弃 undo。

### 11. AI Agent 升级（D11）

#### 11.1 `createAgentPlan("/parameter-admin")` 升级

```ts
case "parameter-admin":
  return {
    ...shared,
    contextTitle: "参数治理 Agent",
    contextSummary: "正在关注参数库健康、孤儿参数、权限异常和导入风险。",
    prompts: [
      "扫描孤儿参数",
      "预审下次导入风险",
      "汇总本周审计",
      "生成孤儿清理建议"
    ],
    actions: [
      { id: "scan-orphans", label: "扫描孤儿参数", requiresConfirm: false },
      { id: "preview-import", label: "预审导入风险", requiresConfirm: false },
      { id: "summarize-audit", label: "汇总本周审计", requiresConfirm: false },
      { id: "draft-cleanup", label: "生成清理建议", requiresConfirm: true },
    ],
  };
```

#### 11.2 动作到业务映射

| action.id | 行为 |
|---|---|
| `scan-orphans` | URL 切到 `?coverage=orphan`；列表自动过滤；Agent 浮窗出现说明卡"共 N 个孤儿参数，其中高风险 M 个" |
| `preview-import` | 打开 `BulkImportWizard` with Step=2，默认选中"混合 8 项"示例源；Agent 对 Step 2 内高风险条目叠加 ⚠ 标注（`aiFlaggedIds` 写进 Wizard state） |
| `summarize-audit` | 打开审计抽屉 + 顶部插入 AI 摘要卡"本周 23 条变更 · 高风险 5 条 · 权限变更 3 次"（从 `auditEvents` 派生生成） |
| `draft-cleanup` | 先切到孤儿视图；全选孤儿参数；浮出 BulkActionBar；Agent 建议"删除 2 个孤儿参数"—— `requiresConfirm: true` 走 Confirm Dialog |

#### 11.3 Agent 与 ConfirmDialog

- 凡 `requiresConfirm: true` 的 Agent 动作，最终都必须经过对应 Dialog。
- Agent 不绕过权限（虽然 prototype 里权限是装饰性的，但叙事上 Agent 以"当前登录用户"身份执行）。
- Agent 动作触发时，追加 auditEvent `kind="agent-action"` + `actionId`，与人工操作审计并排显示（抽屉里 actor 标注 `🤖 via Agent`）。

### 12. 细节交互清单

#### 12.1 键盘

| 键 | 行为 | 作用域 |
|---|---|---|
| `↑` `↓` / `J` `K` | 列表上下切换选中 | 列表聚焦 + 非输入态 |
| `Enter` | 打开当前行（与 Click 等价） | 列表行聚焦 |
| `Shift+↑/↓` | 扩展多选区间 | 列表聚焦 + 多选模式 |
| `Space` | 切换当前行选中状态 | 列表聚焦 + 多选模式 |
| `⌘/Ctrl + F` | 聚焦搜索框 | 全局 |
| `Esc` | 关闭 Dialog/Drawer/Wizard；取消多选 | 有开着的弹层或多选态 |
| `⌘/Ctrl + E` | 打开导出 diff 对话框 | 非输入态 |
| `⌘/Ctrl + I` | 打开批量导入 | 非输入态 |
| `?` | 快捷键帮助 Popover | 非输入态 |

- 对话框打开时屏蔽单字母快捷键。
- 搜索框聚焦时屏蔽单字母，允许正常输入。

#### 12.2 路由与 URL 单一真相

所有 UI 状态走 URL；reducer 只管业务数据：

```
/parameter-admin
  ?id=<parameterId>          // 当前选中（列表与详情联动）
  &q=<search>                // 搜索词
  &risk=<high|medium|low>    // 风险过滤
  &module=<m1,m2>            // 模块过滤（逗号分隔多选）
  &coverage=<all|full|partial|orphan>
  &sort=<field-direction>    // updatedAt-desc / name-asc / risk-desc / coverage-asc
  &audit=open                // 审计抽屉是否展开
  &import=step1|step2|step3  // 导入向导位置（数据不恢复）
  &permissions=open          // 权限弹窗是否展开
```

- Wrapper hook `useParamAdminSearch()` 封装读写。
- 读取：从 `PageProps.search` 或 `window.location` 解析。
- 写入：`updateSearch(patch)` → `window.history.pushState` → 通知 App 层重新渲染。
- 刷新：所有 UI 状态恢复（除 `_undoStack` 和多选 selectedIds 外）。

#### 12.3 数据流总览

```
    ┌──── UI Events ────┐
    │                   │
    ▼                   ▼
 reducer              URL (pushState)
    │                   │
    ▼                   ▼
 configDraft         useParamAdminSearch()
    │                   │
    │                   ▼
    │                Selectors
    │                   │
    └───── Component ──┘

 Side Effects (触发于 reducer 成功后):
    · Toast (via event emitter)
    · AuditEvent 追加 (在 reducer 内 pure 处理)
    · beforeunload 注册/注销 (useEffect 监听 dirty)
```



## 数据契约

### 13. 类型扩展（`src/mockData.ts`）

#### 13.1 新增类型

```ts
// 用户（D5 新增）
export type User = {
  id: string;
  name: string;
  email: string;
  roleId: string;         // 对应 roles[].id
  isActive: boolean;
  createdAt: string;      // ISO
};

// 角色能力（D5 静态参考）
export type RoleCapability = "view" | "edit" | "publish" | "manage-permissions";

export type Role = {
  id: string;
  name: string;
  capabilities: RoleCapability[];   // 新增：硬编码预设
  description: string;               // 新增：展示在角色能力参考卡
};

// 覆盖类型（D9 新增，派生属性，非存储字段）
export type ParameterCoverage = "full" | "partial" | "orphan";

// 导入批次（D7）
export type ImportBatch = {
  id: string;                        // "BI-xxxxxx"
  source: "file" | "paste" | "demo";
  demoSourceId?: string;             // 演示源 id
  submittedAt: string;               // ISO
  summary: { added: number; updated: number; deleted: number };
  affectedIds: string[];
  aiFlaggedIds: string[];            // D11 的 preview-import 标记结果
};

// 审计事件（D4 扩展既有 AuditEvent）
export type AuditEventKind =
  | "parameter-add"
  | "parameter-update"
  | "parameter-delete"
  | "batch-import"
  | "bulk-risk-change"
  | "bulk-module-change"
  | "bulk-delete"
  | "user-add"
  | "user-role-change"
  | "user-toggle"
  | "export"
  | "rollback-undo"
  | "agent-action";

// 现有 AuditEvent 保持兼容，新增可选字段
export type AuditEvent = {
  id: string;
  kind: AuditEventKind;        // 新增（原有 action 字段保留，但用 kind 做分派）
  app: PageKey;                // 沿用
  actor: string;               // 沿用
  action: string;              // 沿用（变为 human-readable summary）
  time: string;                // 沿用（ISO）
  severity: RiskLevel;         // 沿用
  parameterId?: string;        // 新增：D4 上下文联动依据
  batchId?: string;            // 新增：批次关联
  userId?: string;             // 新增：权限类事件指向的用户
  metadata?: {                 // 新增：事件 kind 特定上下文
    previousValue?: string;
    newValue?: string;
    previousRole?: string;
    newRole?: string;
    affectedIds?: string[];
    diffSummary?: { added: number; updated: number; deleted: number };
    snapshotName?: string;
    aiActionId?: string;
  };
  viaAgent?: boolean;          // 新增：D11 Agent 触发标记
};

// 演示导入源（D7）
export type ImportDemoSource = {
  id: string;
  label: string;
  description: string;
  payload: unknown;            // JSON shape 符合 PowerManagementConfig 部分结构
  expectedDiff: { added: number; updated: number; deleted: number };
};

// 参数范围扩展（§6.4 迁移）
export type ParameterRange = {
  min?: number;
  max?: number;
  raw: string;                 // 保留原字符串，兼容非数值范围
};
```

#### 13.2 扩展 PrototypeState

```ts
export type PrototypeState = {
  // 现有字段保留
  activeProjectId: string;
  activeRoleId: string;
  configDraft: PowerManagementConfig;
  parameters: ParameterRecord[];
  changeRequests: ChangeRequest[];
  logs: LogRecord[];
  devices: DeviceRecord[];
  debugParameters: DebugParameter[];
  auditEvents: AuditEvent[];
  lastDebugSnapshot: DebugSnapshot | null;

  // D5 新增
  users: User[];
  currentUserId: string;        // proxy：默认 = 第一个 platform-admin 用户

  // D8 新增
  lastExportedSnapshot: string; // JSON.stringify 快照；初值 = 启动时的 configDraft 序列化

  // D6 新增
  _undoStack: UndoEntry | null;

  // D11 新增
  insightDismissedIds: string[]; // 用户"今天先不看"的 insight id，sessionStorage 同步
  aiFlaggedImportIds: string[];  // preview-import 动作标记的参数 id
};

export type UndoEntry = {
  id: string;
  actionKind: AuditEventKind;
  message: string;                 // toast 显示
  snapshot: Partial<PrototypeState>; // 仅包含需要还原的切片
  createdAt: string;
  expiresAt: string;               // createdAt + timeout
  originalAuditEventId: string;
};
```

#### 13.3 Mock 数据规模

**用户 8-10 条**（覆盖 4 个角色）：

| 姓名 | 邮箱 | 角色 | 状态 |
|---|---|---|---|
| Xu Yun | xu@chargelab.cn | 平台管理员（当前登录） | 活跃 |
| Zhao Heng | zhao@chargelab.cn | 硬件开发 | 活跃 |
| Liu Min | liu@chargelab.cn | 项目开发 | 活跃 |
| Wang Jie | wang@chargelab.cn | 参数管理员 | 活跃 |
| Chen Na | chen@chargelab.cn | 项目开发 | 活跃 |
| Li Peng | lipeng@chargelab.cn | 硬件开发 | 活跃 |
| Sun Mei | sun@chargelab.cn | 参数管理员 | 活跃 |
| Tao Lin | tao@chargelab.cn | 硬件开发 | 停用 |

**角色 4 条**（扩展既有，加上 `capabilities` 和 `description`）：

| id | name | capabilities | description |
|---|---|---|---|
| hardware | 硬件开发 | `["view"]` | 读取参数库，无修改权限 |
| project | 项目开发 | `["view", "edit"]` | 可编辑参数与项目取值 |
| parameter-admin | 参数管理员 | `["view", "edit", "publish"]` | 可发布参数变更与导入 |
| admin | 平台管理员 | `["view", "edit", "publish", "manage-permissions"]` | 全部权限 + 改他人角色 |

**审计事件 20-30 条**（跨 kind 类型分布）：

- 7 条 `parameter-update` (分布到不同参数和时间)
- 3 条 `parameter-add`
- 2 条 `parameter-delete`
- 2 条 `batch-import`（不同 batchId）
- 3 条 `user-role-change`
- 2 条 `user-toggle`
- 1 条 `user-add`
- 2 条 `export`
- 1 条 `agent-action`
- 时间分布跨过去 7 天（今天 / 昨天 / 2-7 天前）

**演示导入源 3 条**（§9.4 已定义）。

#### 13.4 现有数据迁移

现有 `ParameterEditorDraft.range: string` → 保留不变；UI 读取时即时调用 `migrateParameterRange()` 派生 `{ min?, max?, raw }`，不做持久化迁移（下一版数据结构升级时再处理）。

现有 `parameter.values[projectId].updatedAt: string` → 现有 mock 数据里是自然语言文本（"1 小时前"），M1 里一次性用脚本迁移到 ISO 时间戳（新数据要求 ISO）；UI 展示时通过 `Intl.RelativeTimeFormat` 转自然语言。

现有 `AuditEvent` 记录里的 `action` 字段 → 保留；同时派生 `kind`（从 `action` 字符串做一次 pattern match 初始化）。新增事件用 `kind` 精准分类。

### 14. Reducer Actions 扩展

```ts
type Action =
  // 现有保留（不改签名）
  | { type: "UPDATE_PROJECT_PARAMETER_METADATA"; projectId: string; parameterId: string; patch: Partial<ParameterEditorDraft> }
  | { type: "UPDATE_PROJECT_PARAMETER_VALUE"; projectId: string; parameterId: string; patch: Partial<ParameterValueDraft> }
  | { type: "ADD_PROJECT_PARAMETER" }
  | { type: "DELETE_PROJECT_PARAMETER"; parameterId: string }
  | { type: "IMPORT_PARAMETERS" }  // 保留为兼容（不再使用，用下面的 BATCH_IMPORT）

  // D5 权限相关
  | { type: "ASSIGN_USER_ROLE"; userId: string; roleId: string }
  | { type: "TOGGLE_USER_ACTIVE"; userId: string; isActive: boolean }
  | { type: "ADD_USER"; name: string; email: string; roleId: string }

  // D6 Undo
  | { type: "UNDO_LAST_DESTRUCTIVE" }
  | { type: "CLEAR_UNDO" }         // 窗口期到了自动清除

  // D7 批量导入
  | { type: "BATCH_IMPORT_PARAMETERS"; batch: ImportBatch; payload: ImportPayload }

  // D9 批量操作
  | { type: "BULK_CHANGE_RISK"; parameterIds: string[]; risk: RiskLevel; batchId: string }
  | { type: "BULK_CHANGE_MODULE"; parameterIds: string[]; module: string; batchId: string }
  | { type: "BULK_DELETE"; parameterIds: string[]; batchId: string }

  // D8 导出
  | { type: "MARK_EXPORTED"; snapshotName: string; timestamp: string }

  // D11 Agent
  | { type: "AGENT_ACTION_EXECUTED"; actionId: string; metadata?: Record<string, unknown> }
  | { type: "SET_AI_FLAGGED_IMPORT_IDS"; ids: string[] }

  // Insight
  | { type: "DISMISS_INSIGHT"; insightId: string }
  ;
```

**每个 action 的执行都在 reducer 内附加一条审计事件**（纯函数，无副作用）。

**`UNDO_LAST_DESTRUCTIVE`** 的 reducer 逻辑：

```ts
case "UNDO_LAST_DESTRUCTIVE": {
  const entry = state._undoStack;
  if (!entry || Date.now() > new Date(entry.expiresAt).getTime()) {
    return state;  // 过期或空栈，静默
  }
  const restored = { ...state, ...entry.snapshot };
  const undoEvent: AuditEvent = {
    id: nanoid(),
    kind: "rollback-undo",
    app: "parameter-admin",
    actor: state.users.find(u => u.id === state.currentUserId)?.name ?? "unknown",
    action: `撤销 ${entry.actionKind}`,
    time: new Date().toISOString(),
    severity: "Low",
    metadata: { aiActionId: entry.id },
  };
  return {
    ...restored,
    _undoStack: null,
    auditEvents: [undoEvent, ...state.auditEvents],
  };
}
```

---

## Design Tokens 与视觉

### 15. 新增 CSS Variables

在 `src/styles.css` 的 `:root` 中新增（如果已有同名则复用，不重复定义）：

```css
:root {
  /* 脏态 */
  --dirty-pulse:         #d97706;
  --dirty-pulse-bg:      #fef3c7;

  /* 孤儿参数标记 */
  --orphan-mark:         #7c3aed;
  --orphan-mark-bg:      #f3e8ff;

  /* 偏差色标（项目值矩阵） */
  --deviation-ok:        #047857;      /* ≤10% */
  --deviation-warn:      #d97706;      /* 10-25% */
  --deviation-danger:    #ba1a1a;      /* >25% */

  /* 审计事件图标底色（按 kind） */
  --audit-update-bg:     rgba(107,114,128,0.1);
  --audit-add-bg:        rgba(4,120,87,0.1);
  --audit-delete-bg:     rgba(186,26,26,0.1);
  --audit-import-bg:     rgba(29,78,216,0.1);
  --audit-user-bg:       rgba(124,58,237,0.1);
  --audit-agent-bg:      rgba(217,119,6,0.1);

  /* Undo Toast */
  --toast-undo-bg:       #111827;
  --toast-undo-fg:       #f9fafb;
  --toast-progress:      #d97706;

  /* 列表选中（若未在 parameter-review spec 里定义则新增） */
  --selected-row-bg:     rgba(0, 64, 162, 0.08);
}
```

### 16. shadcn 组件选型

新增或复用（通过 `npx shadcn@latest add <name>` 按里程碑增量引入）：

| 组件 | 用途 | 状态 |
|------|------|------|
| `Button` | 所有按钮统一变体（default/destructive/outline/ghost） | 已存在 |
| `Dialog` | 批量导入向导 / 权限 Modal / Confirm Dialogs | 新增 |
| `Sheet` | 审计抽屉（移动端 Modal 形态） | 新增 |
| `Sonner` 或自制 Toast | UndoableToast | 新增 |
| `Popover` | 脏态徽章 diff 摘要 / 快捷键帮助 | 新增 |
| `Tooltip` | 偏差、越界、单位 suffix、`ⓘ` 提示 | 新增 |
| `DropdownMenu` | 排序下拉 / 模块多选 / 角色切换 / 导出 ▾ | 新增 |
| `Badge` | 风险、孤儿、脏态数、审计 kind | 新增 |
| `Checkbox` | 多选行 | 新增 |
| `Input`、`Textarea`、`Select` | 表单 | 新增（若 shadcn 有） |

> 引入顺序按 plan 里程碑安排，避免一次性大批量变更 package.json。

### 17. 密度与字号

| 元素 | 尺寸 |
|---|---|
| KPI Strip 高度 | 64px |
| KPI 主值字号 | 18px semibold |
| KPI label 字号 | 12px |
| 列表行高 | 64px |
| 列表主字号 | 13px monospace（参数名用 monospace） |
| 列表次字号 | 11px regular |
| 分组标题高度 | 38px |
| 分组标题字号 | 12px bold uppercase letter-spacing: 0.04em |
| 详情区 form 标签 | 12px |
| 详情区 form 值 | 13-14px |
| 项目矩阵行高 | 72px（双行信息） |
| 审计事件行高 | 可变（68-140px，视展开与否） |
| 审计事件时间字号 | 11px |
| 审计事件主字号 | 13px |
| 代码/JSON | 13px monospace |

### 18. Motion

- 抽屉展开/收起：`grid-template-columns transition 240ms cubic-bezier(0.2, 0, 0, 1)`
- 审计事件定位高亮脉冲：`@keyframes locate-pulse` 1s，透明度 0.6 → 0 + `box-shadow` 扩散
- Toast 进入：从底部滑入 180ms
- Undo 进度条：CSS transition `width: 0` over `timeout`
- Insight Bar 折叠/展开：`grid-template-rows 0 → auto transition 200ms`
- 列表行 Hover → 选中：背景色 transition 120ms
- Dialog 打开：默认 shadcn overlay

尊重 `prefers-reduced-motion: reduce`——所有 transition/animation 缩到 50ms 或关闭。

---

## 可访问性（A11y）

### 19. ARIA 与键盘

- 列表容器 `role="listbox"` + `aria-label="项目共享参数库"`。
- 列表行 `role="option"` + `aria-selected` + `tabindex` + roving focus。
- 风险徽章：`role="status"` + `aria-label="重要性：高"`，且图标不仅靠颜色区分——每个风险等级配独立符号（🔴 ⚠ 高 / 🟡 ● 中 / 🟢 ○ 低）。
- 孤儿徽章同理：`role="status"` + `aria-label="孤儿参数 · 无项目使用"`。
- 所有 icon-only button 加 `aria-label`。
- 输入框越界 `aria-invalid="true"` + `aria-describedby=<error-id>`。
- Modal / Sheet 交给 shadcn 原生实现（radix 已包含 focus trap + `aria-modal`）。
- Undo Toast：`role="status"` + `aria-live="polite"`；`[撤销]` 按钮必须可 Tab 到（避免 Toast 自动消失的焦点陷阱）。
- Insight Bar：`role="status"` + `aria-live="polite"`。
- 审计事件：时间用 `<time datetime="...">` 语义化；反向跳转按钮 `aria-label="在列表中定位参数 <name>"`。

### 20. 色彩对比

所有文字颜色满足 WCAG AA（正文 ≥ 4.5:1，大字号 ≥ 3:1）：

- 偏差色在 hover / focus 时加下划线或图标辅助，不仅靠颜色
- 风险徽章文字色与背景对比 ≥ 4.5:1
- 脏态 `●` 脉冲色单独达到 3:1（作为视觉提示非文字）

### 21. 键盘焦点可见

- `:focus-visible` 一律用 `outline: 2px solid var(--app-primary); outline-offset: 2px`（不移除 outline）。
- Tab 顺序：PageHeader 动作 → KPI Strip → Insight Bar → 搜索 → 过滤 chips → 排序 → 列表行 → 详情字段 → 项目矩阵 → （审计抽屉展开时）审计过滤 → 审计事件。

---

## 空态与错误态

### 22. 空态清单

| 场景 | 文案 | 视觉 |
|---|---|---|
| 参数库整体为空 | "还没有任何参数。从下方开始 →" | 中心图标 + `[新增参数]` 主按钮 + `[批量导入]` 次按钮 |
| 搜索无结果 | "没有匹配 '<q>' 的参数" | `[清除搜索]` |
| 筛选无结果 | "当前筛选下没有参数" | `[清除筛选]` |
| 孤儿参数视角无结果 | "🎉 所有参数都被项目使用中" | 图标 + 描述"参数库没有孤儿" |
| 某参数未选中时的详情区 | "选择一个参数查看定义与项目值" | 左侧图标 |
| 审计某视角无事件 | "该视角下暂无审计事件" | 切换到"全部"按钮 |
| 权限搜索无用户 | "没有匹配的用户" | |
| 用户列表为空（理论上不会） | "没有用户 · 点击 + 添加" | |

### 23. 错误态

| 场景 | 处理 |
|---|---|
| 导入 JSON schema 错误 | Step 1 红字显示具体 reason，不允许进入 Step 2 |
| 导入 JSON 解析失败（非 JSON） | "文件不是有效 JSON · 请检查格式" |
| 参数名重名 | 字段红边 + `<FieldError>` "已存在同名参数" |
| 参数名格式错 | "只允许小写字母、数字、下划线，且首字符为字母" |
| 邮箱格式错（添加用户） | "邮箱格式不正确" |
| 邮箱重复 | "此邮箱已存在" |
| 项目值越界 | input 红边 + `<FieldError>` "超过上限 4500" / "低于下限 2500" |
| Undo 窗口过期（用户点击时） | Toast 已消失则 noop；若 Toast 仍在但过期（竞态），点击显示 "撤销窗口已关闭" |

---

## 测试策略

### 24. 单元测试（Vitest，`src/*.test.ts`）

- `parameterCoverage.test.ts` — `getCoverage()` 对 3 个项目 × 覆盖分布的全组合
- `parameterRangeMigration.test.ts` — 数值范围解析 / 非数值 raw 保留 / 边界字符
- `importDiffCompute.test.ts` — added/updated/deleted 分类；取消条目后的重算
- `parameterAdminReducer.test.ts` — 所有新增 action 的 before/after + undo 还原
- `undoStack.test.ts` — 超时清除 / 新操作取代旧 undo / reducer 幂等
- `auditEventDerive.test.ts` — 每种 action 产生正确 kind 的事件 + metadata 完整
- `insightDerive.test.ts` — 孤儿阈值 / 权限异常阈值 / sessionStorage dismiss 恢复
- `agentActions.test.ts` — scan-orphans / preview-import / summarize-audit / draft-cleanup 的副作用
- `urlSearchParams.test.ts` — 所有 query param 的序列化/反序列化对称
- `dirtyCountDerive.test.ts` — configDraft 与 lastExportedSnapshot 差异计数

### 25. 组件测试（Testing Library）

- `ParameterLibraryList.test.tsx` — 搜索/筛选/分组/多选行为；键盘导航；aria-selected
- `RiskPicker.test.tsx` — 三档切换 + aria-label
- `ProjectValueMatrix.test.tsx` — 越界色标 / 偏差计算 / 只读 updatedAt 自动更新
- `AuditDrawer.test.tsx` — 视角切换 / 反向跳转 / 批次展开
- `PermissionModal.test.tsx` — 角色切换 + Undo / 停用 / 添加用户校验
- `BulkImportWizard.test.tsx` — 三步前进后退 / 取消条目 / 确认后状态
- `UndoableToast.test.tsx` — 10s 消失 + Undo / 新 Toast 覆盖旧
- `ExportDiffDialog.test.tsx` — diff 计算展示 + 导出确认 + 清零脏态
- `KeyboardShortcuts.test.tsx` — 输入态屏蔽 / Dialog 屏蔽 / 全局生效
- `AgentInsightBar.test.tsx` — 孤儿阈值触发 + 权限异常阈值 + dismiss 持久化
- `KpiStrip.test.tsx` — 可点击 KPI 跳转正确的 search 参数

### 26. 视觉/交互回归（Playwright MCP，人工）

存到 `qa-screenshots/parameter-admin-*.png`：

- `parameter-admin-1440.png` — 桌面抽屉收起
- `parameter-admin-1440-audit-open.png` — 桌面抽屉展开
- `parameter-admin-1280-audit-modal.png` — 中屏抽屉变 Modal
- `parameter-admin-1024.png` — 列表抽屉形态
- `parameter-admin-768.png` — 中窄屏
- `parameter-admin-390.png` — 移动端子路由
- `parameter-admin-bulk-import-step2.png` — Diff 预览
- `parameter-admin-permissions.png` — 权限 Modal
- `parameter-admin-delete-confirm.png` — Confirm Dialog
- `parameter-admin-undo-toast.png` — Toast 样式
- `parameter-admin-insight-bar.png` — Agent Insight
- `parameter-admin-orphan-view.png` — 孤儿过滤视角

**CI 不强制接入 Playwright**（与 parameter-review / debugging 保持一致，人工 QA 即可）。

### 27. 演示级验收（人工走查）

按下面脚本 3 分钟内走通：

1. 进入 `/parameter-admin` → 看到 KPI Strip、AgentInsightBar 显示"2 个高风险孤儿参数"
2. 点 Insight `[查看孤儿参数]` → 列表自动切到孤儿视角
3. 点顶部 `[⛁ 权限]` → 弹出权限 Modal
4. 改 Zhao Heng 角色 `硬件开发 → 参数管理员` → Toast + Undo（不点撤销让它消失）
5. 关闭权限 Modal → 打开审计抽屉 → 看到刚才的权限变更事件
6. 回到参数库，清除筛选 → 选中 `fast_charge_current_limit_ma`
7. 修改 `推荐值` 3200 → 3100 → 看到脏态徽章 `[● 1 处未导出]`
8. 点 `[📥 批量导入]` → 选演示源 "混合 8 项" → Step 2 看 diff → 取消 1 条 → 确认导入 7 项
9. Toast `已导入 7 项 · 10 秒内可撤销` → 脏态更新 → 点 Undo → Toast `已撤销` + 脏态回退
10. 点 `[📤 导出 JSON ▾]` → 选 `下载 JSON` → 看到 diff 摘要对话框 → 确认 → 浏览器下载 + 脏态清零

---

## 里程碑

| M | 内容 | 估算 |
|---|---|---|
| M1 | 数据契约扩展（User / Role.capabilities / AuditEvent.kind / ImportBatch / UndoEntry）+ mock 扩容 + reducer 所有新 action + 单测 | 1.0 d |
| M2 | 新骨架：PageHeader（精简 Topbar 标题）+ KPI Strip + AgentInsightBar（复用 debugging 组件）+ 断点 grid + Insight 派生 | 1.0 d |
| M3 | 参数库列表：搜索 + 筛选 chips（含"孤儿参数"）+ 排序 + 分组折叠 + URL 同步 + 行视觉 | 1.5 d |
| M4 | 详情区：共享定义表单（RiskPicker / 推荐值 ⓘ / 范围拆 min-max / 重名 + snake_case 校验）+ 项目值矩阵（偏差/越界/只读 updatedAt/单位 suffix） | 1.0 d |
| M5 | 审计抽屉：时间线 + 视角切换 chips + 反向跳转 + 批次展开 + 桌面并列 ↔ <1280 Modal 切换 | 1.0 d |
| M6 | 权限 Modal：用户列表 + 角色切换 + 停用 + 添加用户 Dialog + 角色能力参考 + 审计联动 | 0.8 d |
| M7 | 批量导入向导：Step1 源（3 演示源）+ Step2 diff 预览（过滤/搜索/逐项取消）+ Step3 执行 + batchId 审计 | 1.2 d |
| M8 | UndoableToast 统一组件 + 分级 ConfirmDialog（Delete/BulkDelete/ExportDiff）+ Undo 栈 reducer + beforeunload | 0.6 d |
| M9 | Dirty indicator + 导出 ▾ 菜单 + diff 摘要 dialog + 文件名规则 + MARK_EXPORTED | 0.4 d |
| M10 | 多选模式 + BulkActionBar（改风险/改模块/导出子集/删除）+ 批量 audit 和 Undo | 0.6 d |
| M11 | Agent 浮窗升级：新 prompts/actions + 四个动作映射实现 + viaAgent 审计标记 | 0.5 d |
| M12 | 键盘快捷键 + `?` 帮助 Popover + ARIA + 空态 + 错误态 | 0.5 d |
| M13 | 响应式断点细化（1024–1280 Modal 转换 + 768–1024 列表抽屉 + <768 子路由）+ 视觉回归截图 | 1.0 d |
| M14 | 文档与演示脚本：README 段落更新 + 演示走查 + 最终 CI 绿 | 0.3 d |

合计 ~11.4 工作日。每里程碑独立 commit 且可独立合入（M1 后 M2–M13 可按顺序，M11/M12/M13 内部可在 M10 后并行推进）。

### 28. 验收门槛

- [ ] `npm test` 全绿
- [ ] `npm run build` 通过，无 TS 错误
- [ ] 五档断点（1440/1280/1024/768/390）无布局塌陷
- [ ] `[● N 处未导出]` 徽章在编辑后立刻出现，在导出/撤销后正确清零
- [ ] beforeunload 在 `dirtyCount > 0` 时拦截关标签页；`dirtyCount === 0` 时不打扰
- [ ] 删除参数 + 批量删除 + 批量导入 + 批量改风险 五种操作都有 Undo Toast 且 10s 内可还原
- [ ] 选中列表参数后自动过滤审计到该参数；`[在列表中定位 ↗]` 能反向跳转并高亮脉冲
- [ ] 权限变更即时生效 + Toast 6s Undo + 审计记录
- [ ] 批量导入 diff 预览的 added/updated/deleted 计数与实际 reducer 写入一致
- [ ] Agent `scan-orphans` / `preview-import` / `summarize-audit` / `draft-cleanup` 四个动作均可从浮窗触发并正确联动 UI
- [ ] URL 携带完整 UI 状态刷新后可完全恢复（不含 Undo/多选态）
- [ ] 不做 `prefers-reduced-motion` 测试 → 手动 devtools 验证一次即可
- [ ] `/parameter-admin` 页面在 `npm run dev` 首屏 5s 内可交互
- [ ] 全页 Tab 键盘可达关键动作；风险徽章色盲模式仍可辨识

### 29. 风险与权衡

| 风险 | 缓解 |
|---|---|
| 新增 8–10 条 User mock + 20–30 条 AuditEvent 让初始 bundle 增大 | 数据放 `src/mockData.ts`，Vite 构建时原本就会 treeshake；单页 KB 级别膨胀可接受 |
| `_undoStack` 存 `Partial<PrototypeState>` 可能膨胀（大快照） | 只存最小切片（所涉参数+项目取值+用户字段），不存整个 configDraft |
| `ParameterRange` 迁移可能破坏 parameter-user-workbench / parameter-comparison 依赖的 `range: string` | M1 里让迁移函数 _派生_ 出 `{ min, max, raw }`，不改持久字段；其它页继续读 `range` 原字符串 |
| 审计抽屉与列表选中联动可能造成"在审计里点反跳 → 切回列表 → 抽屉自动过滤到新参数"的循环感 | 反跳行为明确：点"在列表中定位"只改 URL id，不改抽屉的过滤 chip（保持用户手动选择）。切换 chip 与选中参数是两个独立交互 |
| `PermissionModal` 里把当前登录用户角色改成"硬件开发"会让其失去权限管理权 | UI 禁用"对自己"的角色下拉与停用开关（§8.3） |
| BATCH_IMPORT 在大批量（数百条）下性能问题 | 原型数据量可控（演示源最多 8 项）；未来对接真实后端时再考虑 |
| Sonner 组件引入会增加 shadcn 依赖 | 如果引入压力大，可用一个 50 行的自制 `<UndoableToast>` 兜底；M8 里根据 bundle size 取舍 |
| Agent `preview-import` 要把 Wizard 打开到 Step 2 并预选示例 | 通过 URL `?import=step2&demo=mixed-8` + Wizard 的受控模式；M7 和 M11 顺序要配合 |
| 审计抽屉 Modal 态在 1024–1280 区间 resize 跨段时体验割裂 | 断点切换时 fade transition；Modal 与侧栏状态通过 `?audit=open` 单一参数共享 |
| 已有 `mockData.ts` / `powerManagementConfig.ts` 测试用例可能被 Type 扩展影响 | M1 先跑现有测试基线，发现改动用最小必要 patch 兼容 |

---

## 演示脚本（3 分钟）

面向产品评审或向管理员演示：

```
[00:00] 打开 /parameter-admin
  → 指向 KPI Strip："这是管理后台的健康度——共享参数 10 个，
     其中 4 个高风险，2 个孤儿。"
  → 指向 AgentInsightBar："AI 一进来就告诉你：孤儿参数 2 个，
     建议复核。"
  → 点 [查看孤儿参数]

[00:15] 列表自动筛选到孤儿
  → "这是管理员独有视角——找谁没用在项目里的'僵尸参数'。
     普通用户看不到这个维度。"

[00:35] 清除筛选 → 点选 fast_charge_current_limit_ma
  → 右侧详情展开
  → 指向"推荐值 ⓘ"："这个推荐值会影响所有项目，有 ⓘ 提示防误改。"
  → 指向项目值矩阵："偏差 +31.3% 红色——越界了。这是数据越界
     校验，以前的页面是自由文本、填什么都行。"
  → 指向更新时间："这是只读时间戳，改完自动更新——以前是可手填，
     谁都能写'1 小时前'干扰审计。"

[01:10] 修改推荐值 3200 → 3100
  → 顶部出现 [● 1 处未导出] 徽章
  → "有脏态提醒。如果我现在刷新，浏览器还会拦截我。"
  → hover 徽章看 Tooltip

[01:30] 点 [📥 批量导入]
  → 选"混合 8 项" → [下一步]
  → Step 2 Diff 预览："3 新增 ✎5 更新。AI 还标了 2 条高风险
     和 1 条越界。"
  → 点某高风险条目 [取消导入此项] → 计数变 7
  → [确认导入 7 项]

[02:00] Toast "已导入 7 项 · 10 秒内可撤销"
  → "注意，即便我自己确认过，还有 10 秒反悔。"
  → 等 3 秒 → 点 [撤销]
  → Toast 变 "已撤销"；脏态回退

[02:15] 打开审计抽屉（右上 [🕐 审计]）
  → "这里是 PRD 承诺的审计留痕，现在真有了。"
  → "看这条：10:32 Zhao 改了 fast_charge。点右侧 ↗ 可以跳回
     列表定位。"
  → 点 [在列表中定位] → 列表高亮脉冲

[02:35] 点顶部 [⛁ 权限]
  → 弹出权限 Modal
  → 改 Zhao Heng 角色 `硬件开发 → 参数管理员`
  → Toast + Undo 6 秒
  → "关键动作都进了审计——刚才改角色在抽屉里已经有一条。"

[02:55] 点 [📤 导出 JSON ▾] → 选 [下载]
  → 弹 diff 摘要对话框："告诉你这次导出包含 2 处变更，再确认。"
  → [确认导出] → 脏态清零

[03:00] 结束 · 回顾三支柱：管参数 / 管人 / 管变更。
```

---

## 参考文件

- `src/App.tsx` — 现 `ParameterAdminPage`（约 L2028–2160）
- `src/appConfig.ts` — `createAgentPlan("/parameter-admin")` 分支（约 L120–130）
- `src/mockData.ts` — `Role` / `AuditEvent` / `PrototypeState` 现有定义
- `src/powerManagementConfig.ts` — `ParameterEditorDraft` / `PowerManagementConfig` / `clonePowerManagementConfig`
- `src/config/power-management.json` — 参数库持久化源
- `src/styles.css` — 现 `.library-panel` / `.config-editor-panel` / `.config-admin-grid` 等样式
- `PRD.md` §5.3 — 功能覆盖要求
- `PRD.md` §10 / §11 — 原型边界与后续工程
- `docs/superpowers/specs/2026-05-10-parameter-review-workbench-redesign-design.md` — 姊妹 spec（master-detail + Resizable 模式）
- `docs/superpowers/specs/2026-05-10-debugging-workbench-redesign-design.md` — 姊妹 spec（分级确认 / Draft Sheet / AgentInsightBar / SessionSummary 模式）
- `docs/superpowers/specs/2026-05-10-parameter-user-workbench-redesign-design.md` — 姊妹 spec（多选 + 草稿 Sheet 模式）
- `qa-screenshots/parameter-admin-viewport-1440.png` / `parameter-admin-shared-definition-matrix.png` — 当前状态与历史设计对照
- 本次评测记录：对话上文对 `/parameter-admin` 的 17 条问题与 P0–P3 修复清单

## 下一步

写实施计划：调用 `superpowers:writing-plans`，将本 spec 展开为 `docs/superpowers/plans/2026-05-10-parameter-admin-redesign-m1.md`，按 §27 的 14 个里程碑拆成 bite-sized 步骤，每步包含 Files / Step / Command / Expected 四要素。
