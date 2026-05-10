# 项目参数对比分析页面 · 重设计规范（Parameter Comparison Redesign Design Spec）

- 文档版本：v1
- 起草日期：2026-05-10
- 作者：Kiro（brainstorming session with user）
- 对象文件：`src/App.tsx` 中 `ParameterComparisonPage`（行号约 1517–1750）
- 原始设计稿：`stitch_ai_driven_business_synergy_platform/项目参数对比分析/code.html`
- 相关现状截图：`qa-screenshots/parameter-comparison.png`（旧版含 Insights 面板）、`comparison-page-full.png`（当前简化版）

---

## 1. 背景与目标

### 1.1 页面职责
`/parameter-comparison` 是 WiseEff 中的**决策驱动型对比工作台**（非只读查看视图）。当前副标题"对比两个实际项目的充电、温控与电池保护参数差异，查看风险并同步选择项"清晰定义了用户任务链：

1. 选择两个项目（基准 vs 对比）
2. 快速识别哪些参数漂移、哪些风险高
3. 理解漂移的业务含义与后果
4. 逐项决策：采纳 / 跳过 / 进一步调试
5. 批量执行并留痕

### 1.2 现状问题（UX 评测提炼）
- 项目选择器占据过多首屏空间（约 130px 两卡），挤压表格到 y≈700px 才开始
- 摘要 Metric 卡和 AI 洞察面板（旧版曾有）已缺失
- 对比值缺少差异量化（Δ 徽章），用户必须心算差异百分比
- 同步动作方向含糊（箭头图标未明示 target→base 还是反向）
- 无批量复选、无确认对话框、无撤销机制
- 无参数名搜索、无"仅看漂移" toggle
- 参数键不可钻取
- 重要性徽章独立成列，信噪比低

### 1.3 本次重设计目标（成功标准）
新用户在不看文档的前提下，能在 **90 秒内**：
1. 看到哪些参数有漂移（Metric + 色条 + Δ 徽章 立刻告知）
2. 理解漂移量级和业务风险（Δ 徽章 + 洞察条）
3. 勾选 2–3 项关键漂移
4. 完成一次批量同步，并能在 toast 窗口内撤销
5. 知道操作方向（回填到基准项）而不产生困惑

---

## 2. 基础架构决定（Q&A 共识）

| # | 决定 | 选项/值 |
|---|------|---------|
| 1 | 范围 | 全量重设计 |
| 2 | AI 洞察呈现 | 顶部水平洞察条（非右侧栏、非全局 dock only） |
| 3 | 批量同步模型 | 暂存模型：勾选=暂存，顶部 CTA 统一提交并弹确认对话框 |
| 4 | 同步写方向 | 对比项 → 基准项（采纳对比项值覆盖基准项，target→base） |

**相关语义**：基准项 = 权威主线，对比项 = 候选源。确认对话框和 Toast 文案全部按"将对比项值采纳到基准项"方式表达。

---

## 3. 页面整体骨架

### 3.1 垂直布局（1440×900 设计锚点）

```
[0] 全站顶栏                                        (保持不变)
[1] Page Header         H1 + 项目 Chip + ⇄ + CTA    ~80–88px
[2] Metric 摘要条       三张卡                        ~84px
[3] WiseAgent 洞察条    2–3 张精简洞察卡（可折叠）       ~120px
[4] 筛选工具条          搜索 + 仅看漂移 + 筛选 + 清除     ~56px
[5] 参数差异矩阵        5 列主表格，内部垂直滚动          剩余
```

全局附加：
- 右下角 `UnifiedAgent` dock 保留（现有组件，承担对话式深入）
- 批量操作触发确认 Dialog
- 单次批量后提供 Toast 撤销（5 秒窗口）

### 3.2 关键决定与理由

| 决定 | 理由 |
|------|------|
| 项目选择器从独立大卡片并入 H1 Chip | 每次会话只切 1–2 次项目，不值得常驻 260px |
| 动态 H1 承担上下文信息 | 面包屑与顶栏副标题已表达"这是什么页"，H1 应讲"当前对什么" |
| 摘要条 + 洞察条分两行 | 度量与解读职责不同，合并降低可扫描性 |
| 移除"重要性"独立列，用左侧 4px 色条 | 节省列空间，重要性本质是行属性 |
| 移除"参数含义"独立列 | 与参数键高度冗余；hover popover 展示即可 |
| 默认打开"仅看漂移"toggle | 符合进入页面的最高频意图；已同步项可一键看 |

---

## 4. Page Header & 项目切换

### 4.1 结构

```
[面包屑: 参数 › 对比分析]

[● AUR-Prod        ▾]   ⇄   [● NEB-RD              ▾]    [⋯]
  Aurora 量产平台                Nebula 高频调试项目

                                       [↑ 导出]  [⟳ 同步已选 (3)]
```

### 4.2 项目 Chip（取代旧版大 `<select>` 卡）
- 按钮 + popover（非原生 `<select>`，要支持搜索、副标题、禁用状态）
- Chip 内容：风险圆点（基准 `#3b82f6` 蓝 / 对比 `#8b5cf6` 紫）+ 项目 code（粗）+ 项目 name（灰细）+ `▾`
- Popover 宽 320px：顶部搜索框 → 列表项（`code · name` + 当前✓ + 在另一侧已选则 disabled + tooltip）→ 项目 ≥ 8 滚动
- 键盘：`↑/↓/Enter/Esc`；`aria-haspopup="listbox"`

### 4.3 互换按钮 ⇄
- 位置：两 Chip 正中，36×36px 图标按钮
- 点击：立即互换项目、**保留**当前已暂存的同步选择、弹 toast `已互换项目，同步方向现在是 AUR-Prod → NEB-RD`
- 快捷键：`Alt+S`

### 4.4 溢出菜单 `⋯`（二级动作）
- `清空暂存选择`（n ≥ 1 时可见）
- `重置筛选条件`
- `查看同步历史`（原型占位，实装为抽屉）
- `键盘快捷键` 对话框

### 4.5 主 CTA

| 按钮 | 样式 | 启用条件 | 行为 |
|------|------|---------|------|
| 导出 | secondary outline | 总可用 | 导出**当前筛选后**矩阵为 Excel（沿用 `exportComparisonRowsAsExcel`） |
| 同步已选 (n) | primary solid | n ≥ 1 启用 | n=0 时 disabled，hover tooltip `先勾选要同步的漂移行`；打开 SyncConfirmDialog |

### 4.6 面包屑与副标题
- 面包屑仅两段：`参数 › 对比分析`（第三段的项目对移除，由 H1 承担）
- 移除通用副标题"对比两个实际项目的充电、温控与电池保护..."；不替换为动态文案（与 Metric 冗余）

### 4.7 响应式
- ≥ 1280px：Chip 全展开
- 960–1280px：Chip 只显示 code，name 进入 tooltip
- < 960px：两 Chip 垂直堆叠，⇄ 变全宽 text button；CTA 独占一行

### 4.8 可访问性
- Chip：`role="button"`，`aria-expanded`，`aria-label="基准项目：AUR-Prod Aurora 量产平台，点击切换"`
- `⇄`：`aria-label="互换基准与对比项目"`
- `同步已选 (n)`：`aria-disabled`，`aria-describedby` 指向 tooltip

---

## 5. Metric 摘要条

三张等宽卡，紧贴在 Header 下方。

| 卡 | 标题 | 主值 | 副信息 | 色调 | 可点 |
|----|------|------|--------|------|------|
| 1 | 对比范围 | `10 项参数` | 涉及模块简述（前 3 "充电·电池·温控 等"） | slate 中性 | 否 |
| 2 | 漂移参数 | `{drift}/{total}` + 细进度条 | 百分比 | amber；drift=0 时 green "已全部同步" | 点击=打开"仅看漂移"toggle |
| 3 | 高重要性差异 | `{highDrift}` 数字 | `WiseAgent 已生成 N 条风险说明` | red；0 时灰隐显示 `0` | 点击=滚到第一条高重要性漂移行并高亮 |

**规格**：
- 卡间距 16px，整行高度 84px
- 不展示趋势 delta（此处只是当前对比快照）
- 不做第 4 张"已忽略数"——会话级忽略不值得占 25% 宽度

---

## 6. WiseAgent 洞察条

### 6.1 结构与单卡

```
WiseAgent 洞察                                                [折叠]

┌ 高风险 · 电压上限差异 ──────────────┐  ┌ 偏紧 · 温控 ───────────────┐
│ charge_voltage_limit_mv              │  │ battery_temp_target_c        │
│ 对比项 4380mV 高于基准 4350mV，建议    │  │ 对比项 40°C 相较基准 38°C      │
│ 回填前评估电池寿命影响。                │  │ 仅 +2°C，风险可控。            │
│ [查看此项 ↗]   [跳过 ✕]              │  │ [查看此项 ↗]   [跳过 ✕]      │
└──────────────────────────────────────┘  └──────────────────────────────┘
```

**卡片规格**（宽 340–400px，高 ~140px）：

| 区块 | 内容 | 规则 |
|------|------|------|
| eyebrow | 图标 + 风险等级短句 + `·` + 模块短语 | 例 `高风险 · 电压上限差异` |
| 主参数键 | mono 字体；点击=滚动+高亮对应行 | 主要锚点 |
| 正文 | 1–2 行解读（来自 `createComparisonInsights()`） | 最多 80 字符，超了省略并可 hover 展开 |
| CTA | `[查看此项 ↗]` `[跳过 ✕]` | 小号 text button |

### 6.2 生成规则（prototype）
- 最多 3 条
- 优先级：`High + drift 最大` → `High + drift 次大` → `Medium + 差异百分比最大`
- 0 条漂移：单张 success 卡 `✓ 两个项目已完全对齐 · 10 / 10 项参数一致，无需同步`
- 全部高风险被跳过：`ℹ 剩余洞察已被跳过，点此恢复`

### 6.3 折叠
- 默认展开
- 折叠后变为 chip `WiseAgent 洞察 · 3 条 · 展开 ▾`（高 40px）
- 折叠状态持久化到 `sessionStorage`

### 6.4 "跳过"语义
- 仅当前 session 隐藏，刷新/重开恢复
- 右上角 `N 条已跳过 · 恢复` 链接恢复全部
- 不影响参数本身状态（和同步无关）

### 6.5 两条 strip 视觉对比
- Metric：实底色块 + 轻描边，tone 区分
- 洞察：白底卡 + 左侧 4px 风险色条 + 淡色 eyebrow
- 两者间留 12px 空隙

### 6.6 可访问性
- 洞察条：`role="region"` `aria-label="WiseAgent 风险洞察"`
- 每卡：`role="article"`，CTA 独立 `aria-label`（含参数名）
- 折叠按钮：`aria-expanded` `aria-controls`

---

## 7. 参数差异矩阵（主表格）

### 7.1 列结构（5 列）

```
┌─┬──┬──────────────────────────────┬─────────────┬──────────────────────────┬──────────┐
│ │☐│ 参数键                        │ AUR-Prod 基准│ NEB-RD 对比              │ 操作      │
├─┼──┼──────────────────────────────┼─────────────┼──────────────────────────┼──────────┤
│▐│☐│ ⚠ charge_voltage_limit_mv    │  4350 mV    │  4380 mV   +0.7% ↑      │ ⇐ 采纳    │
│ │ │   Charging Policy            │             │                          │   ⊘ 跳过  │
├─┼──┼──────────────────────────────┼─────────────┼──────────────────────────┼──────────┤
│▐│☑│ ⚠ fast_charge_current_li...  │  3850 mA    │  4200 mA   +9.1% ↑      │ ✓ 已暂存  │
│ │ │   Charging Policy            │             │                          │   [取消]  │
├─┼──┼──────────────────────────────┼─────────────┼──────────────────────────┼──────────┤
│ │—│ ✓ max_concurrent_sessions    │  2048       │  2048   已同步            │           │
└─┴──┴──────────────────────────────┴─────────────┴──────────────────────────┴──────────┘
 ↑ 4px 重要性色条
```

| # | 列 | 宽度 | 对齐 | 内容 |
|---|----|------|------|------|
| — | 色条 | 4px | — | 重要性：高 red / 中 amber / 低 slate；已同步无色 |
| 1 | ☐ | 44px | 中 | 复选框；仅 drift 行可选；同步/跳过行显示 `—` |
| 2 | 参数键 | flex 1 (min 260px) | 左 | 状态图标 + mono 参数名（粗） + 模块名（灰细，下一行） |
| 3 | 基准 AUR-Prod | 180px | 右 | Pill + 数值 + 单位；灰底"参照物" |
| 4 | 对比 NEB-RD | 240px | 右 | Pill + 数值 + 单位 + Δ 徽章 |
| 5 | 操作 | 140px | 右 | 依行状态渲染 |

- 表头 sticky 粘顶
- 列头带小字副标和圆点：`基准 · AUR-Prod`、`对比 · NEB-RD`
- 悬停列头展示完整项目名 tooltip

### 7.2 参数键列视觉层
```
⚠  charge_voltage_limit_mv
   Charging Policy
```
- 状态图标：⚠ drift（amber 16px）/ ✓ synced（green）/ ⏱ staged（blue）/ ⊘ ignored（slate）
- 参数键：mono 14px/600，可点 → `ParameterDetailDialog`（4.5 定义）
- 模块名：12px 灰

**hover 参数键**：400ms 延迟弹 popover tooltip：
- 参数含义（`parameter.description`）
- 类型、单位、取值范围（若有）
- "在工作台中打开 ↗" 链接

### 7.3 Δ 徽章规则（核心视觉）

| 类型 | 展示 | 触发 |
|------|------|------|
| 百分比差 | `+9.1% ↑` / `−14.3% ↓` | 数值型、基准值非 0 |
| 绝对差 | `+30 mV` / `−2 °C` | 基准值为 0 或百分比 > 999% |
| 离散值差 | `已变更` chip | 枚举/字符串 |
| 新增 | `新增` chip（蓝） | 对比有、基准无 |
| 未配置 | `未配置` chip（灰） | 基准有、对比无 |
| 无差异 | `已同步`（绿） | 值完全相等 |

**视觉**：
- 位置：紧贴对比值 Pill 右侧，同一水平线
- 颜色：偏离增大 amber `#f59e0b`；偏离减小 teal `#0d9488`
- 尺寸：12px 字号，padding 2px 8px，radius full
- 方向本身不代表风险，风险由左侧色条表达

### 7.4 操作列按行状态

| 行状态 | 操作列 | 触发 |
|--------|--------|------|
| drift | `[⇐ 采纳]` 主 + `[⊘ 跳过]` 次 | 值不同、未暂存、未忽略 |
| staged | `✓ 已暂存` 文案 + `[取消]` 小 link | 勾选复选框后 |
| ignored | `已跳过` 灰 + `[恢复]` 小 link | 点 ⊘ 后 |
| synced | `已同步` 灰字 | 基准 === 对比 |

**动作语义改动（相对现状）**：
- `→` 图标改为 `⇐`（`ArrowLeft` / `ArrowLeftCircle`），对齐 target→base
- `⇐ 采纳` tooltip 完整文案：`采纳对比项 NEB-RD 的值（4380 mV）覆盖基准项 AUR-Prod（当前 4350 mV）`
- `⊘ 跳过` tooltip：`在本次会话中忽略此项，不会修改任何值`
- 点 `⇐ 采纳` 与勾选复选框**等效**（都进入暂存，不立即生效）

### 7.5 行样式

| 状态 | 背景 | 左色条 | 图标 | 透明度 |
|------|------|--------|------|--------|
| drift | 白 | 风险色 | ⚠ amber | 100% |
| staged | 浅蓝 `#eff6ff` | 蓝 + 风险色双条 | ⏱ blue | 100% |
| synced | 白 | 无 | ✓ green | 70% |
| ignored | 灰 `#f9fafb` | 虚线灰 | ⊘ slate | 60% |

### 7.6 排序
- 默认：漂移优先 + 高重要性优先 + 差异百分比降序
- 可点列头单列排序：参数键（字母）、基准值（数值）、对比值（数值）、差异量
- 列头小三角标当前排序
- 不支持多列组合排序（shift 不做）

### 7.7 滚动
- 表格 `max-height: calc(100vh - [header+metric+insight+filter 高度])`
- 表头 sticky
- 原型数据量 ≤ 30，不做虚拟化（标注 future work）

### 7.8 空状态
| 场景 | 表格内容 |
|------|---------|
| 筛选后无结果 | 插画 + `无匹配的漂移参数` + `[清除筛选]` |
| 两项目无共同参数 | `两个项目没有共同参数键...` + `了解更多` link |
| 仅看漂移 ON 但 drift=0 | `✓ 没有待处理的漂移 · 切换到全部参数` link |

### 7.9 可访问性
- `<table>` `role="table"`；`role="columnheader"`；`role="row"` + `aria-rowindex`
- 排序列 `aria-sort="ascending"`
- 行复选框 `aria-label="选择 charge_voltage_limit_mv 进行同步"`
- `⇐ 采纳`：`aria-label="采纳对比项 NEB-RD 值 4380 mV 覆盖基准项 AUR-Prod"`
- 键盘：Tab 入表 → `↓/↑` 跳行 → `Space` 勾选 → `Enter` 主操作 → `X` 跳过

---

## 8. 选择 + 批量同步 + 撤销

### 8.1 状态模型

```typescript
type ComparisonRowState = "drift" | "staged" | "ignored" | "synced";

type ComparisonUIState = {
  stagedKeys: Set<string>;
  ignoredKeys: Set<string>;
  lastApplied: {
    timestamp: number;
    changes: Array<{ key: string; from: string; to: string; projectId: string }>;
  } | null;
};
```

**持久化规则**：
- `stagedKeys`、`ignoredKeys` 不持久化（refresh 清空）
- `lastApplied` 保留 5 秒供撤销，过期清空
- 切换基准/对比项目时清空 `stagedKeys` 和 `ignoredKeys`；若切换前暂存非空，先弹确认 `切换项目会丢弃当前 N 项暂存，是否继续？[取消] [切换并丢弃]`

### 8.2 进入暂存的三种途径
1. 勾选复选框 → 加入 `stagedKeys`
2. 点击行内 `⇐ 采纳` → 等价勾选
3. 表头复选框 "全选当前可见的漂移行"（仅筛选后的 drift 行；文案 `已选中 6 项漂移（当前筛选范围内）`）

进入暂存不弹 toast（动作频繁，避免轰炸）。行视觉变为 staged 浅蓝 + 双色条；Header CTA 从 `同步已选` 变为 `同步已选 (6)` 并启用。

### 8.3 跳过（Ignore）
- 点 `⊘ 跳过` → 加入 `ignoredKeys`，操作列变 `已跳过 [恢复]`
- 不提供批量跳过（低频，YAGNI）
- 跳过行自动从洞察条去重

### 8.4 取消暂存
- staged 行操作列 `[取消]` 移出集合
- 再次点复选框取消勾选
- Header `⋯` 菜单 `清空暂存选择 (n)`

### 8.5 批量同步确认对话框

点击 `同步已选 (n)` 后：

```
┌─ 确认同步 ──────────────────────────────────────────────────────────┐
│ 将对比项 NEB-RD 的值采纳到基准项 AUR-Prod（3 项变更）                 │
│                                                                    │
│ ⚠ charge_voltage_limit_mv    4350 mV → 4380 mV   (+0.7%)  [高]     │
│ ⚠ fast_charge_current_li...  3850 mA → 4200 mA   (+9.1%)  [高]     │
│ ⓘ battery_temp_target_c      38 °C   → 40 °C     (+2 °C)  [中]     │
│                                                                    │
│ ℹ 其中 2 项为高重要性，请确认已评估风险。                             │
│                                                                    │
│ □ 我已确认以上变更                                                   │
│                                                                    │
│                                           [取消]  [同步 3 项 ⇐]    │
└────────────────────────────────────────────────────────────────────┘
```

**规则**：
- 条目按重要性（高→低）+ 差异量降序排
- High 重要性徽章红底强调；中/低弱化
- `我已确认` 复选框仅当含 High 时出现；主按钮在未勾选时 disabled
- 主按钮动态文案 `同步 N 项 ⇐`；样式 `bg-primary`
- **键盘默认焦点在"取消"**（防止误按 Enter）
- Esc / 点遮罩关闭
- 顶部标题色调：全中/低=蓝，含高=amber

### 8.6 执行 + Toast 撤销

确认后：
1. 对话框关闭
2. 表格立即更新：对应行 staged → synced，值变为对比项值，行透明度降到 70%
3. Metric 更新（drift 数减 N）
4. 右上角 Toast（5s 自动消失）：

```
┌──────────────────────────────────────────────────────────┐
│ ✓ 已同步 3 项参数到 AUR-Prod       [撤销]  5s ●●●●○   × │
└──────────────────────────────────────────────────────────┘
```

- Toast 带进度条
- 点 `撤销` → 回滚全部，值恢复为基准项原值，重新放入 `stagedKeys`（保留用户的选择状态），Toast 变 `已撤销 · 3 项重新进入暂存`
- 5s 后撤销按钮消失，操作不可逆
- 关闭按钮 `×` 不等于撤销，仅隐藏 toast

**撤销原则**：把数据和暂存都回到确认前一瞬间，不丢失勾选。

### 8.7 错误路径

| 场景 | 行为 |
|------|------|
| 对话框打开后用户切换了项目 | 对话框自动关闭 + toast `项目已切换，同步已取消` |
| 暂存的行被另一人修改（多用户） | 原型不处理，标注 future work |
| 部分成功部分失败（真实后端） | 原型不处理，标注 future work |

### 8.8 同步历史
- `⋯` 菜单 → `查看同步历史`，实装为抽屉（Drawer）
- 展示当前会话的 `lastApplied` + 最近 5 次批次
- 每批展示时间、项目对、N 条变更、可展开详情
- **不支持**再次撤销历史批次

### 8.9 键盘快捷键

| 键 | 行为 | 范围 |
|----|------|------|
| `↑/↓` | 行焦点移动 | 表格 |
| `Space` | 勾选/取消当前行 | 表格 |
| `Enter` | 当前行主操作（采纳/取消暂存） | 表格 |
| `X` | 跳过当前行 | 表格 |
| `A` | 全选当前可见漂移 | 表格 |
| `Alt+S` | 互换基准/对比项目 | 全页 |
| `Alt+Enter` | 打开确认对话框（n≥1） | 全页 |
| `Ctrl/⌘+Z` | 撤销最近同步（5s 内） | 全页 |
| `Esc` | 关闭对话框 / 清除行焦点 | 上下文 |

### 8.10 可访问性
- 确认对话框：`role="alertdialog"`（含 High）/ `role="dialog"`；`aria-labelledby` `aria-describedby`
- Toast：`role="status"` `aria-live="polite"`
- 撤销按钮：`aria-label="撤销最近一次同步（剩余 5 秒）"`
- `⋯` 菜单暴露 `键盘快捷键` 对话框入口

---

## 9. 筛选工具条

### 9.1 结构

```
[🔍 搜索参数键…] [● 仅看漂移] [重要性 ▾] [模块 ▾] [清除]      12 / 10 项
───── 已筛选 ─────
[🏷 仅漂移 ✕] [🏷 重要性: 高 ✕] [🏷 模块: Charging Policy ✕]
```

### 9.2 控件

| 控件 | 类型 | 默认 | 说明 |
|------|------|------|------|
| 搜索框 | input + 🔍 | 空 | 匹配参数键/模块名；debounce 150ms；`<mark>` 黄底 `#fef3c7` 高亮 |
| 仅看漂移 | toggle switch | **ON** | ON = drift+staged；OFF = 全部 |
| 重要性 | 多选 dropdown | 空=全部 | 高/中/低 + 计数；触发按钮显示已选数 |
| 模块 | 多选 dropdown + 内部搜索 | 空=全部 | 选项动态去重 + 计数 |
| 清除 | text button | 隐藏 | 有非默认筛选时出现；点击重置到默认（**仅看漂移=ON**） |
| 计数 | label | 动态 | `{filtered} / {total} 项` |

### 9.3 筛选逻辑

所有筛选 **AND** 组合：
```
显示 = 全部参数
  .filter(仅看漂移 ? row.state ∈ {drift, staged} : true)
  .filter(重要性 ∈ selected || selected.length === 0)
  .filter(模块 ∈ selected || selected.length === 0)
  .filter(搜索命中 参数键 || 命中 模块名 || 搜索为空)
```

已跳过行在默认视图隐藏；恢复通过"全部参数"或洞察条"恢复全部"。

### 9.4 筛选 Chip 条
- 工具条下方展示已激活筛选，每维度/每值一个 chip
- 单独 ✕ 移除该维度
- 多选下每值独立 chip
- `仅看漂移=OFF` 时出 chip `显示已同步项`（提醒用户看到的是全集）
- 右侧 `清除全部` text button

### 9.5 URL 参数同步
```
/parameter-comparison?base=AUR-Prod&target=NEB-RD
                     &driftOnly=1
                     &risk=High,Medium
                     &module=Charging%20Policy
                     &q=voltage
```
- 进入页面读 URL 初始化筛选
- 筛选变化 → `history.replaceState`（不产生历史条目）
- 洞察条"查看此项"支持 URL fragment `#param-charge_voltage_limit_mv`

### 9.6 下拉视觉规范
- 触发：`[维度 ▾]` / `[维度 (2) ▾]`
- 下拉 popover：280px，每项复选框 + 文案 + 计数（`高 (3)`）
- 底部 `[清除] [关闭]`

### 9.7 响应式
- ≥ 1280px：搜索框 280px，一行排列
- 960–1280px：搜索 200px，计数移右下
- < 960px：工具条两行

### 9.8 与其他区域联动
- 点 Metric "漂移参数"：`driftOnly = ON`
- 点 Metric "高重要性差异"：`driftOnly = ON` + `risk=[High]`
- 点洞察"查看此项"：**先清空所有筛选** + 滚动定位 + 高亮闪烁
- 空状态 "清除筛选" 按钮：一键重置

### 9.9 可访问性
- 搜索框：`role="searchbox"` + `aria-label`
- 多选下拉：`role="listbox"` `aria-multiselectable="true"`；项 `role="option"` + `aria-selected`
- Toggle：`role="switch"` + `aria-checked`
- Chip 条：`role="list"`；每个 chip `role="listitem"`
- 高亮用 `<mark>` 语义

---

## 10. 边界状态汇总

| # | 场景 | 表现 |
|---|------|------|
| 1 | 两项目无共同参数 | Metric 全 0；洞察条 info 卡；表格空状态插画 + `两个项目没有共同参数...` |
| 2 | 全部已同步（drift=0） | Metric 2 green "已全部同步"；洞察条 success 卡；表格 empty `✓ 没有待处理的漂移 · 切换到全部参数` |
| 3 | 筛选后无结果 | 插画 + `无匹配项` + 筛选摘要 + `[清除筛选]` |
| 4 | 搜索无结果 | 插画 + `没有匹配 "xxx" 的参数` + `[清除搜索]` |
| 5 | 仅一项漂移 | 正常流程；确认对话框不展示统计条 |
| 6 | 全部被跳过 | 洞察条 `ℹ 当前 3 条洞察已被跳过 · 恢复全部` |
| 7 | 切换项目时有暂存 | `切换项目会丢弃当前 N 项暂存...[取消] [切换并丢弃]` |
| 8 | 对比项=基准项（异常） | 自动回退到 fallback + toast `对比项已自动调整为 NEB-RD` |
| 9 | URL 带无效项目 ID | 静默回退默认对，console warn |
| 10 | `createComparisonInsights` 返回空 | 洞察条折叠态 `WiseAgent 暂无新洞察 · 两项目配置相似度高` |

---

## 11. 视觉令牌

### 11.1 色彩（语义角色 → token → hex）

| 角色 | Token | Hex | 用途 |
|------|-------|-----|------|
| 风险·高 | `--risk-high` | `#dc2626` | 色条、高徽章、高风险洞察头 |
| 风险·中 | `--risk-medium` | `#f59e0b` | 色条、中徽章、drift 图标 |
| 风险·低 | `--risk-low` | `#64748b` | 色条、低徽章 |
| Δ 增大 | `--delta-warn` | `#f59e0b` | Δ 徽章（+） |
| Δ 减小 | `--delta-ease` | `#0d9488` | Δ 徽章（−） |
| 暂存 | `--state-staged` | `#3b82f6` | 暂存行背景/色条 |
| 已同步 | `--state-synced` | `#16a34a` | 同步图标、success metric |
| 已跳过 | `--state-ignored` | `#94a3b8` | 跳过行、虚线色条 |
| 基准项点 | `--proj-base` | `#3b82f6` | 列头圆点、Chip |
| 对比项点 | `--proj-target` | `#8b5cf6` | 列头圆点、Chip |
| 搜索高亮 | `--hl-search` | `#fef3c7` | `<mark>` 背景 |
| 暂存行底 | `--bg-staged` | `#eff6ff` | |
| 跳过行底 | `--bg-ignored` | `#f9fafb` | |

**纪律**：
- 红 `--risk-high` 只用于高重要性与关键警示，不用于 Δ
- 同行不同时 red 色条 + red Δ：若行色条 red，Δ 降为内敛灰，避免双红

### 11.2 字体

```
Page H1         24px / 600 / 1.3
Section heading 16px / 600 / 1.4
Metric value    28px / 700 / 1.2
Metric label    12px / 600 / 1.2 / upper + tracking 0.05em
Insight title   14px / 600
Insight body    13px / 400 / 1.5
Table header    12px / 600 / upper + tracking 0.05em
Parameter key   14px / 600 / mono
Param module    12px / 400 / 灰
Value pill      14px / 500 / mono
Delta badge     12px / 600
Body            14px / 400 / 1.5
Small           12px / 400 / 1.4
```

mono 用于：参数键、基准值、对比值、Δ 徽章中的数字。

### 11.3 间距与圆角
```
容器圆角 lg (12px)     — 卡片、对话框、popover
内件圆角 md (8px)      — pill、按钮
徽章圆角 full          — Δ、重要性、chip

区段间距 16–24px
卡片 padding 16px
表格行 padding 12px 垂直 / 16px 水平
```

### 11.4 图标（lucide-react）

| 用途 | Icon |
|------|------|
| 漂移警示 | `AlertTriangle` |
| 同步完成 | `CheckCircle2` |
| 已暂存 | `Clock` |
| 已跳过 | `Ban` |
| 采纳方向 | `ArrowLeftCircle` |
| 互换 | `ArrowLeftRight` |
| 导出 | `Upload` |
| 同步 | `RotateCcw` |
| 搜索 | `Search` |
| 筛选 | `Filter` |
| 项目 chevron | `ChevronDown` |
| 撤销 | `Undo2` |

### 11.5 加载/骨架
- 首次渲染 + 切换项目：表格 skeleton 行 300ms
- 洞察生成中：3 张 skeleton 卡
- Metric：灰块 84px
- 骨架不必精准拟态，统一脉动灰块

### 11.6 动效

| 行为 | 动效 | 时长 |
|------|------|------|
| 行状态切换 | 背景色过渡 | 200ms ease-out |
| 洞察"查看此项"滚动 | smooth + 行高亮闪 3 次 | 1.2s |
| 对话框出现 | 背景 fade 150ms + 对话框 scale 0.96→1 + fade 180ms | |
| Toast 进出 | 右滑入 + fade | 200ms |
| 洞察条折叠 | 高度动画 | 200ms |

`prefers-reduced-motion` 下全部改为瞬时切换，仅保留透明度。

### 11.7 z-index
```
Toast              100
Dialog              80
Popover/Dropdown    60
Sticky 表头          20
洞察条粘顶（可选）     10
```

---

## 12. 组件拆分与目录结构

### 12.1 新目录

```
src/ParameterComparison/
  index.ts
  ParameterComparisonPage.tsx
  components/
    ComparisonHeader.tsx              § 4
    ProjectChip.tsx                   § 4.2
    ComparisonMetrics.tsx             § 5
    InsightStrip.tsx                  § 6
    InsightCard.tsx                   § 6
    ComparisonFilterBar.tsx           § 9
    ActiveFilterChips.tsx             § 9.4
    ComparisonMatrix.tsx              § 7
    ComparisonRow.tsx                 § 7
    DeltaBadge.tsx                    § 7.3
    ParameterKeyTooltip.tsx           § 7.2
    ParameterDetailDialog.tsx         § 7.2 链接
    SyncConfirmDialog.tsx             § 8.5
    SyncUndoToast.tsx                 § 8.6
    EmptyStates.tsx                   § 10
  hooks/
    useComparisonState.ts             § 8.1
    useComparisonFilters.ts           § 9.5
    useComparisonData.ts              组装 + 排序
    useInsights.ts                    § 6.2 + 跳过/恢复
    useKeyboardShortcuts.ts           § 8.9
  utils/
    deltaCalc.ts                      § 7.3
    rowSort.ts                        § 7.6
    exportToExcel.ts                  从 App.tsx 迁移
```

### 12.2 App.tsx 改动
- 删除 `ParameterComparisonPage` 内联实现
- `import { ParameterComparisonPage } from "./ParameterComparison"`
- `createComparisonInsights`、`getFallbackComparisonProjectId`、`ComparisonProjectSelection` 迁移到 `ParameterComparison/hooks`

### 12.3 样式归属
- 新样式写入 `src/styles.css` 末尾 `/* === Parameter Comparison (Redesign M1) === */`
- 旧 `.comparison-*` 选择器保留至新实现稳定；通过根类 `.comparison-page--v2` 隔离
- 最终阶段（M3 结束）统一删除旧选择器

### 12.4 状态管理纪律
- 沿用现有 `useState` / `useReducer` 模式
- **不**引入新状态库（Zustand/Redux 等）
- Hook 必须纯：仅依赖 props 和 dispatch，便于单测

---

## 13. 测试策略（Vitest + RTL）

### 13.1 新增测试文件

| 测试 | 重点 |
|------|------|
| `ParameterComparisonPage.test.tsx` | URL 加载 → 筛选初始化；切换项目清空暂存并弹确认；"查看此项" 滚动+高亮 |
| `ComparisonHeader.test.tsx` | Chip popover；选项禁用；互换后方向 toast |
| `ComparisonMetrics.test.tsx` | drift=0 green；highDrift=0 灰隐；点卡联动筛选 |
| `InsightStrip.test.tsx` | 跳过单条+恢复；折叠；0 洞察 empty |
| `ComparisonFilterBar.test.tsx` | 搜索 debounce；多选；chip 条增减；"清除"回默认（driftOnly=ON） |
| `ComparisonMatrix.test.tsx` | 排序；勾选 staged；参数键点击打开 dialog；空状态 |
| `DeltaBadge.test.tsx` | 所有 Δ 类型分支 |
| `SyncConfirmDialog.test.tsx` | 含 High 的"我已确认"必勾；默认焦点在"取消"；Esc 关闭 |
| `SyncUndoToast.test.tsx` | 5s 倒计时；撤销恢复数据+staging；关闭 ≠ 撤销 |
| `deltaCalc.test.ts` | 单位；基准 0；负 Δ；枚举 |
| `rowSort.test.ts` | 综合默认；单列排序 |
| `useComparisonState.test.ts` | staged/ignored 集合；切项目清空；lastApplied 5s TTL |
| `useComparisonFilters.test.ts` | replaceState 无历史污染；URL↔state；非法 URL 回退 |
| `useInsights.test.ts` | 跳过去重；恢复全部；切项目重置 |

### 13.2 不测试
- 像素级样式
- 动效细节（仅测终态）
- lucide 图标渲染

### 13.3 纪律
严格遵守 `superpowers:test-driven-development`：每个组件先写失败测试，再写最小实现。

---

## 14. 实施阶段化

三轮可独立合入的 slice。每轮必须**通过全部测试且可运行**。

| Slice | 产出 | 可演示价值 |
|-------|------|---------|
| M1 · 骨架与表格 | 目录拆分；Header 新版；Metrics；Matrix；FilterBar；Δ 徽章；参数键 hover tooltip；**暂存/同步沿用当前即时逻辑**（stub 撤销） | 首屏体验升级（信息密度、Δ、搜索） |
| M2 · 决策流程 | 暂存状态模型；SyncConfirmDialog；SyncUndoToast；键盘快捷键；ParameterDetailDialog；项目切换确认 | 批量同步 + 撤销闭环 |
| M3 · 洞察与边缘 | InsightStrip；Metric/洞察↔筛选联动；跳过/恢复；全部空状态；URL 同步；同步历史 drawer（stub） | AI 洞察闭环 + 深链 |

每个 slice 独立可合入 main。

---

## 15. 明确不做（YAGNI 清单）

| 不做 | 理由 |
|------|------|
| >2 项目并排对比 | 需求未提；UI 从 diff 变矩阵，3x 工作量 |
| 多用户并发冲突检测 | 原型无后端 |
| 同步历史真实持久化 | 内存态即可，仅留最近 N 条 |
| 表格内直接编辑参数值 | 不是本页职责，工作台负责 |
| 深色模式 | 全站范围，不在本页 scope |
| 参数版本分析深度跳转 | `stitch_*` 另有版本分析页；本页仅保留 `在工作台中打开` link |
| 可保存的命名对比视图 | 低优；URL deep-link 已覆盖 80% |
| 带 AI 洞察的 PDF 导出 | Excel 足够，PDF 栈外 |
| 虚拟滚动 | 原型 ≤ 30 条 |
| i18n | 全站 zh-CN |

---

## 16. 已知风险与未来工作

1. **洞察质量依赖 `createComparisonInsights`**：当前规则打分，规模扩大可能漂移；迁移真 LLM 时重写
2. **URL 长度**：筛选全开时接近 2000 字符浏览器极限，通常没问题
3. **项目数扩展**：Chip popover 支持搜索，>50 项需虚拟列表（不在本次）
4. **撤销窗口**：5s 对大批量 50+ 项可能偏短，延长会有一致性风险

---

## 17. 交互原型验证锚点

本 spec 实施完成后，在不看文档前提下，新用户能在 **90 秒内**：
1. 看到哪些参数漂移（Metric + 色条 + Δ）
2. 理解量级与风险（Δ + 洞察条）
3. 勾选 2–3 项关键漂移
4. 完成一次批量同步并在 toast 窗口内撤销
5. 知道操作方向为回填到基准项

此标准作为 M3 完成后的可用性验证脚本。

---

## 18. 变更日志

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-05-10 | v1 | 首版，8 节设计评审通过，落为此 spec |

---

## 附录 A：与当前实现的 diff 一览

| 现有 | 重设计 |
|------|--------|
| 两大块项目选择卡（占 130px） | Chip + popover（并入 H1） |
| 通用 H1 "项目参数对比分析" | 动态 H1（当前项目对） |
| 3 张 Metric（代码中存在但渲染异常） | 恢复并交互联动 |
| 无 AI 洞察呈现 | 顶部 WiseAgent 洞察条 |
| 6 列表格（含"参数含义"独立列） | 5 列 + hover tooltip |
| 重要性独立列 + 徽章 | 左侧 4px 色条 |
| 无 Δ 量化 | Δ 徽章（百分比 / 绝对 / 枚举 / 新增 / 未配置） |
| `→` 箭头（方向含糊） | `⇐` + 完整 aria/tooltip 文案 |
| 仅单行即时操作 | 暂存模型 + 确认对话框 + Toast 撤销 |
| 无复选框 | 行首复选 + 全选可见漂移 |
| 2 个筛选 dropdown（重要性/模块） | 搜索 + 仅看漂移 + 多选筛选 + chip 条 + URL 同步 |
| 参数键不可钻取 | 点击 → ParameterDetailDialog |
| `ParameterComparisonPage` 塞在 App.tsx | 独立目录 `src/ParameterComparison/` |
| 部分测试散在 App.test.tsx | 独立测试文件 per 组件/hook |

---

**spec 结束**。
