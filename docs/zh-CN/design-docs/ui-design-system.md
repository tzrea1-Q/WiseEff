# UI 设计系统

> English: [English](../../design-docs/ui-design-system.md)

状态：**Current** · 日期：2026-08-12

这是 WiseEff 全部产品界面的可执行视觉与交互标准。它把 [`docs/DESIGN.md`](../../DESIGN.md) 的原则落成可强制执行的规则：设计令牌、组件契约、交互状态、动效、布局与产品文案语言。强制执行本规范的完成门禁是 [`docs/zh-CN/developer/ui-quality-checklist.md`](../developer/ui-quality-checklist.md)。存量代码向本标准迁移由 [`docs/zh-CN/exec-plans/active/2026-08-12-frontend-aesthetics-uplift.md`](../exec-plans/active/2026-08-12-frontend-aesthetics-uplift.md) 跟踪。

质量基准：对标 Linear 的专注、高密度、快速工作台——克制的色彩、严格的字阶与间距刻度、严格的层次（elevation）、细腻一致的动效、零内部信息泄漏。

## 不可妥协项

1. **令牌是视觉取值的唯一来源。** 组件与页面 CSS 不得出现裸 hex/rgb/oklch 颜色、裸 `z-index` 数字、随手写的字号、一次性发明的阴影。新值要么进入令牌层，要么不进入代码。
2. **只有一个主交互色。** 产品只有一个 accent（品牌蓝）。黑色实心按钮、青绿色步骤条等脱离色板的一次性用色都是缺陷。
3. **五态不齐不上线。** 每个可交互元素必须定义 rest、hover、active、focus-visible、disabled；异步操作另加 loading。移除焦点轮廓而不给等效可见替代是禁止的。
4. **一职一件。** 一个 Button、一个 Dialog（`ModalDialog` 契约）、一套表格基座、一条 Toast 管线、一套 空态/加载/错误 语言。要做局部变体，必须收编或包装旧实现,不允许并行造第二套。
5. **中文优先的产品语言。** UI 中不得出现原始英文片段、原始错误串、事件 slug、ISO 时间戳、里程碑代号或调试文案。一切用户可见内容都经产品语言与共享格式化函数输出。
6. **页面标题归壳层所有。** TopBar 渲染页面标题/副标题,页面主体不得再复述自己的 `h1`/`h2` 大标题;页内标题从分区级开始。
7. **密度是能力。** 主工作表格必须在 1280px 内容宽度内放下所有列,不允许因外框留白导致横向滚动;溢出的细节进检查器/弹窗,而不是加列。
8. **动效令牌化且克制。** 时长与缓动一律来自 motion 令牌;禁用 `ease` 关键字与 >400ms 的 UI 过渡;无限循环动画必须响应 `prefers-reduced-motion`。
9. **演示数据即产品数据。** 种子环境不得在用户界面暴露测试残留（`FoldRegistryTestDG`、`probe-edit-*.dts`、验收 fixture 账号等）。
10. **每个可见变更都要真实浏览器验证。** 按检查清单在 1440/768/390 三档宽度验证后才算完成。

## 规范实现

| 部件 | 规范位置 | 说明 |
| --- | --- | --- |
| 令牌层 | `src/styles.css` 的单一 `:root` 块 | 唯一来源;shadcn `@theme inline` 键必须映射到同一套语义令牌,不许第二套色板 |
| Button | `src/components/ui/button.tsx`（cva）与 `.button` 基类统一 | 目标:一套实现;见下文「按钮」 |
| Dialog | `src/components/common/ModalDialog.tsx` + `ConfirmDialog` | portal、焦点陷阱、背景 `inert`、仅最顶层 Escape、遮罩关闭成对判定、统一 z-index 刻度 |
| 表格 | `src/components/admin/DataTable.tsx` 模式 | 分页、`aria-sort`、键盘行导航、集成 `ColumnFilter` |
| 列筛选 | `src/components/ColumnFilter.tsx` | 规格:[表格列多选筛选 UX](ux-table-column-filter.md) |
| 加载/空/错误 | `src/features/parameter-home/components/SectionState.tsx` 模式 | 骨架 + 空态 + 可重试错误三件套;待提升为共享组件 |
| 局部令牌派生 | `src/features/parameter-home/parameter-home.css` | 用 `color-mix()` 从全局令牌派生局部语义色,不发明新字面量 |
| 图标 | `lucide-react` | 不用 emoji,不用 `✓`/`↗` 等文本字符当图标 |

## 设计令牌

具体数值在提升计划的 P0 令牌 PR 中定案;下述语义词汇表立即生效。

### 颜色

语义角色（浅色主题;深色主题从同一套角色派生）:

| 令牌 | 角色 | 起始值 |
| --- | --- | --- |
| `--bg` | 应用背景 | `#f7f8fc` 族（一个值） |
| `--surface` | 卡片、面板、表格行 | `#ffffff` |
| `--surface-raised` | 浮层、弹窗 | `#ffffff` + 阴影 |
| `--surface-sunken` | 凹陷区、代码画布、输入底色 | 一个弱色调 |
| `--border` | 默认细边 | 一个值（收编现存约 10 种近似灰） |
| `--border-strong` | 强调分隔、聚焦输入 | 一个值 |
| `--text` | 主文本 | 一个近黑 |
| `--text-secondary` | 次文本 | 一个灰 |
| `--text-muted` | 三级/元信息文本 | 一个灰（当前被引用却未定义,必须补上） |
| `--accent` | 交互主色（按钮、链接、活动导航、选中） | 品牌蓝 `#0052cc` 族 |
| `--accent-hover` / `--accent-pressed` | 交互深浅 | 派生 |
| `--accent-soft` | 选中/活动背景、徽章 | 派生浅色 |
| `--success` / `--warning` / `--danger` / `--info` | 状态色 + 各自 `-soft` 浅色 | 每类一族 |
| `--ring` | 焦点环 | 基于 accent,一个值 |

规则:

- 颜色字面量**只允许**出现在令牌块内;其余一律 `var()` 或基于令牌的 `color-mix()`（参照 `parameter-home.css` 模式）。
- shadcn 的 `--primary`/`--muted`/`--border` oklch 键必须成为上述语义令牌的别名;同一问题存在两套答案即缺陷。
- 中性色承载界面,颜色只为交互与状态服务;图表使用与 accent 对齐的令牌化分类色带（`--chart-1..5`）,不接受图表库默认配色。

### 字体排印

字体栈:

```css
--font-sans: "Geist Variable", -apple-system, BlinkMacSystemFont, "PingFang SC",
  "HarmonyOS Sans SC", "Microsoft YaHei", "Noto Sans SC", "Helvetica Neue", Arial, sans-serif;
--font-mono: ui-monospace, "SF Mono", "SFMono-Regular", Menlo, Consolas,
  "Liberation Mono", monospace;
```

- Geist Variable 已打包自托管;必须移除远程 Google Fonts `@import`（自托管内网必然不可达）,且不得换成另一个远程字体。
- CJK 回退链是强制的:界面以中文为主,而拉丁 webfont 不含 CJK 字形。
- 字重:**只允许 400、500、600、700。** 650/720/750/760/850 之类会塌陷到相邻档,一律禁止。

字阶（px;可用统一 rem 基准,但同一界面不得混用单位）:

| 令牌 | 字号/行高 | 用途 |
| --- | --- | --- |
| `--text-xs` | 11/16 | eyebrow、高密度元信息 |
| `--text-sm` | 12/18 | 表格元信息、说明、徽章 |
| `--text-base` | 13/20 | 正文、表格单元格、输入框、按钮 |
| `--text-md` | 14/22 | 强调正文、弹窗正文 |
| `--text-lg` | 16/24 | 分区标题、弹窗标题 |
| `--text-xl` | 20/28 | 页面级标题（TopBar） |
| `--text-2xl` | 24/32 | 看板大数字 |

不允许其它 `font-size` 值。`letter-spacing` 只允许 `0`（正文）与 `0.04em`（仅大写 eyebrow）。

### 间距

4px 栅格。令牌 `--space-1..-16` = 4、8、12、16、20、24、32、40、48、64。默认:

- 页面内容内边距:桌面 24px,移动 16px。
- 卡片内边距:16–20px。分区间距:24px。工具栏控件间距:8px。
- 偏离 4px 栅格的值（6px、10px、14px 间距等）只做迁移,不再新增。

### 圆角

| 令牌 | 值 | 用途 |
| --- | --- | --- |
| `--radius-sm` | 6px | 输入框、chip、菜单项 |
| `--radius-md` | 8px | 按钮、卡片、浮层 |
| `--radius-lg` | 12px | 弹窗、侧板、页面级面板 |
| `--radius-full` | 999px | 胶囊、头像 |

不允许 7/9/10/14px 一次性值。

### 层次（Elevation）

只有四级;阴影不允许内联发明:

| 令牌 | 用途 |
| --- | --- |
| `--shadow-1` | 静置卡片、吸顶表头（细边 + 微环境光） |
| `--shadow-2` | 浮层、下拉、hover 抬升卡片 |
| `--shadow-3` | 弹窗、侧板 |
| `--ring` | 焦点环:`0 0 0 2px` 固定透明度的 accent,可按表面色偏移 |

### 动效

| 令牌 | 值 | 用途 |
| --- | --- | --- |
| `--duration-fast` | 120ms | hover/按压反馈、小型淡入淡出 |
| `--duration-base` | 160ms | 菜单、tooltip、列表反馈 |
| `--duration-slow` | 240ms | 弹窗、侧板、面板滑动 |
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | 入场 |
| `--ease-in-out` | `cubic-bezier(0.45, 0, 0.25, 1)` | 位移、出场 |

规则:禁用 `ease` 关键字;UI 过渡不超过 400ms;入场只动 opacity/transform;所有无限循环动画必须带 `prefers-reduced-motion: reduce` 回退。

### z-index

`:root` 中只声明一条阶梯;组件 CSS 或 TSX 里的裸数字一律禁止。阶梯向下扩展现有浮层刻度（`--z-xiaoze-fab: 1100`、`--z-modal-backdrop: 1150`、`--z-modal-backdrop-nested: 1160`、`--z-xiaoze-popup: 1200`）,补充应用层令牌（吸顶头、侧边栏、下拉/浮层）。「+1 逃生舱」（40 对 41、60 对 61）是缺陷。

## 交互状态

每个可交互元素必须定义全部状态:

| 状态 | 要求 |
| --- | --- |
| Rest | 表面、边框、文字颜色均取自令牌 |
| Hover | 可见但克制的变化（背景微调或边框加深）,`--duration-fast` |
| Active | 按压反馈（更深的色调和/或 1px 位移）——强制;廉价感最先从这里暴露 |
| Focus-visible | `--ring` 焦点环,浅色页面与弹窗遮罩上都要可见;不得 `outline: none` 而无替代 |
| Disabled | 降低不透明度 + `cursor: not-allowed`;因校验而禁用的按钮必须暴露原因（tooltip 或行内提示） |
| Loading（异步） | 行内 spinner + 文案,元素尺寸不变,`aria-busy="true"` |

hover 与 focus-visible 必须保持视觉可区分（不得合并成同一条规则再清掉 outline）。

## 组件标准

### 按钮

- 只有一套实现。变体:`primary`（accent 实心）、`secondary`（表面 + 边框）、`ghost`（透明）、`danger`（危险实心或描边）、`link`（文本)。尺寸:`sm` 28px、`md` 32px（默认）、`lg` 36px;纯图标按钮为方形、内含居中 16px 图标。
- `docs/FRONTEND.md` § Button And Action Styling 的完整视觉契约继续生效。当前 42 个作用域各自覆写 `.button` 几何属于缺陷,按计划迁移。
- 每个视图只有一个主按钮。

### 输入与选择

- 最小高度 32px、`--radius-sm`、令牌化边框、按上文规则显示焦点环、可见 label 或 `aria-label`、错误文案经 `aria-describedby` 关联。
- 原生 `<select>` 仅在存量界面临时允许;P1 落地样式化 Select 原语后,新界面一律使用。原生日期/文件选择器保留原生弹层但触发器需样式化。

### 弹窗

- 所有弹窗走 `ModalDialog`/`ConfirmDialog`（或既有 Radix `ui/dialog` 封装）——禁止手写 `<div className="modal-backdrop">`,禁止 `window.confirm`。
- 遮罩强制;卡片以 `--duration-slow` + `--ease-out` 淡入/缩放入场;Escape 只关最顶层;焦点被陷阱并在关闭后归还。
- 宽度:`sm` 400px、`md` 560px、`lg` 720px;内容滚动,外框不滚。

### 表格

- 表头行 36–40px,`--text-sm` 600 标签;正文行 40–44px（紧凑 36px）,单元格 `--text-base`;行 hover 着色;选中行用 `--accent-soft`。
- 表头在表格滚动容器内吸顶;列筛选用 `ColumnFilter`;可排序列暴露 `aria-sort`;可点击行必须支持键盘激活。
- 列预算:主表格在 1280px 内容宽度内放下;次要元数据（原始 id、长出处）进入行检查器。逐行常驻操作按钮优先改为 hover/focus 显示或单一溢出菜单。
- 数字列右对齐并使用 `font-variant-numeric: tabular-nums`;标识符/参数值使用 `--font-mono`。

### 反馈

- 一条 toast 管线:单一 portal、队列、三种语气（成功/信息/危险）、4 秒自动消失 + 可选操作,位置全产品统一（底部居中或右上,二选一）。
- 横幅只用于持续性上下文（降级模式、权限范围）,不用于操作结果。
- 展示给用户的错误一律映射为产品语言;原始 `error.message`、HTTP 载荷、堆栈片段不得渲染。字段错误位于字段下方,以 `aria-describedby` 与 `aria-invalid` 关联。

### 加载、空、错误

- 加载:内容区域用骨架屏占住真实布局（列表、卡片、画布）;spinner 只用于行内/按钮级等待。认证/启动阶段渲染应用壳骨架,绝不允许白屏。
- 空态:图标（lucide）+ 一句状态 + 可选一句指引 + 可选主操作。禁止"表格只剩表头"式裸空态。
- 错误:产品语言的消息 + 重试操作。API 瞬断不得静默把用户登出或让页面失联。

### 图表

Recharts 图表消费令牌:分类色带 `--chart-1..5`、网格线 `--border`、坐标文字 `--text-muted`（`--text-sm`）、tooltip 按浮层规格（`--surface-raised`、`--shadow-2`）。不接受图表库默认样式。

## 布局与页面结构

- TopBar 从 `appConfig` 渲染页面标题与副标题;页面主体不得重复(不许双标题、不许并列 `h1`)。
- 可见圆角容器最多嵌套两层;更深的分组用间距与分隔线表达,而不是继续套框。
- 宽度预算纳入评审:1440px 视口下,任何主工作台表格不得因外框留白而横向滚动。
- 侧边栏:桌面展开 256px / 收起 76px;<768px 改为抽屉浮层(常驻窄轨吃掉手机屏幕 ~18% 宽度是缺陷)。任何宽度下用户菜单必须可达。
- 导航保持 SPA 行为(应用内链接不整页刷新)、路由切换重置主区滚动位置、活动态只保留一套视觉层级。

## 内容与语言

- UI 文案使用简体中文。英文只允许出现在产品名、以代码形态呈现的标识符、以及法律要求文本中。
- 用户可见界面禁止:原始事件 slug（`recompute`、`auth-event`）、内部代号（M2、PPV）、原始 ISO 时间戳、英文相对时间（`2h ago`、`never`、`just now`）、未翻译的表格文案（`Showing X of Y`、`Report ID`）、调试占位文案（`empty init UI evidence`）。
- 一个共享时间格式化函数:7 天内相对时间（「3 分钟前」）,超出显示绝对时间（「2026-08-05 12:52」）;tooltip 可展示精确时间戳。
- 百分比经统一格式化函数,归一 0–1 小数与 0–100 整数两种来源（置信度 0.91 渲染为 91%）。
- 副标题与辅助文案:一行以内,不写机制长文;交互规则放 tooltip 或文档,不放表格上方的段落。

## 可访问性基线

- 文本对比度 ≥ 4.5:1（大字与图标 ≥ 3:1）;状态色必须配文字或图标,不允许仅靠颜色。
- 所有可交互元素键盘可达、可操作;可点击表格行与卡片实现 `tabIndex` + Enter/Space 激活。
- 弹窗语义遵循 `ModalDialog`（role 在卡片上、标题关联、焦点陷阱/归还）。
- 每个表单控件有程序化 label;每条错误有程序化关联。
- `npm run acceptance:a11y` 对覆盖路由保持通过;新增主路由必须纳入覆盖清单。

## 反模式（禁止上线）

- 组件/页面 CSS 中的裸 hex/rgb/oklch、裸 `z-index`、裸 `font-size`、内联发明的 `box-shadow`。
- 给同一原语造第二套视觉语言（新的按钮几何作用域、新弹窗基座、新表格外壳、新 toast 类名）。
- 黑色或脱离 accent 的实心按钮;单视图多个主按钮。
- `window.confirm` / `window.alert`;无遮罩、无 Escape、无焦点陷阱的弹窗;多个浮层无协调地叠加。
- `outline: none` 而无可见焦点替代;hover 与 focus-visible 合并。
- `ease` 关键字、>400ms 的 UI 过渡、未守护的无限动画。
- UI 中的英文片段、原始错误、slug、ISO 时间戳、里程碑代号。
- 启动白屏、"只剩表头"的裸空态、1440px 下因留白导致横向滚动的表格。
- 种子演示环境中可见的测试 fixture 或探针数据。
- 用静态 `style={{...}}` 写视觉（仅数据驱动值与 CSS 变量注入除外）。

## 验证

每个前端可见变更都执行 [`docs/zh-CN/developer/ui-quality-checklist.md`](../developer/ui-quality-checklist.md) 的完成门禁:目标测试、`npm run build`、真实浏览器三视口走查（1440×900、768×1024、390×844）,截图、控制台检查与交互证据存放在 `work/ui-checks/<topic>/`。质量门禁:`npm run acceptance:a11y`、`npm run acceptance:visual`、`npm run acceptance:responsive`。

## 变更控制

- 令牌值与刻度只能通过同时更新本文档与令牌块的 PR 修改,并附至少三个受影响界面的前后截图。
- 新组件变体的前提:现有变体确实不满足、变体加在规范原语上（不是本地分叉）、同一变更内更新本文档对应组件章节。
- 在代码中发现的偏离即缺陷:登记到提升计划或 `docs/exec-plans/tech-debt-tracker.md`,而不是照抄扩散。
