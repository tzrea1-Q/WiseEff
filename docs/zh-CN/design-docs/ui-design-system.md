# UI 设计系统

> English: [English](../../design-docs/ui-design-system.md)

状态：**Current** · 日期：2026-08-24

这是 WiseEff 全部产品界面的可执行视觉与交互标准。它把 [`docs/DESIGN.md`](../../DESIGN.md) 的原则落成可强制执行的规则：设计令牌、组件契约、交互状态、动效、布局与产品文案语言。强制执行本规范的完成门禁是 [`docs/zh-CN/developer/ui-quality-checklist.md`](../developer/ui-quality-checklist.md)。存量代码向本标准的迁移由 [`docs/zh-CN/exec-plans/completed/2026-08-12-frontend-aesthetics-uplift.md`](../exec-plans/completed/2026-08-12-frontend-aesthetics-uplift.md) 交付完成;剩余存量以技术债 TD-111–TD-115 追踪。

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
| 令牌层 | `src/styles.css` 的 `:root` 块 + `.dark` 覆写块 | 唯一来源;颜色字面量只允许存在于这两个块内;shadcn `@theme inline` 键必须映射到同一套语义令牌,不许第二套色板 |
| Button | `src/styles.css` 的 `.button` 基础层 + `src/components/ui/button.tsx`(cva),同一套令牌 | 单一几何:尺寸 sm 28 / md 32 / lg 36;变体 `primary`/`subtle`/`ghost`/`danger`;作用域只允许加布局,不允许改几何或配色 |
| Dialog | `src/components/common/ModalDialog.tsx` + `ConfirmDialog` | portal、焦点陷阱、背景 `inert`、仅最顶层 Escape、遮罩关闭成对判定、统一 z-index 刻度、令牌化遮罩变暗与入场动效 |
| Toast | `src/components/common/toast/ToastProvider.tsx`(`useToast()`) | 单一 portal 队列、success/info/danger 三语气、右下角、4 秒自动消失 + 悬停暂停、`--z-toast` |
| 表格 | `src/components/admin/DataTable.tsx` | 标准列表外壳:分页、`aria-sort`、键盘行导航、筛选空态、集成 `ColumnFilter` |
| 列筛选 | `src/components/ColumnFilter.tsx` | 规格:[表格列多选筛选 UX](ux-table-column-filter.md) |
| 搜索框 | `src/components/common/SearchField.tsx` | 唯一搜索输入外观；过滤在 `src/lib/search/` 的 Profile 中，不在输入组件里 |
| 视图切换 | `src/components/ui/view-switch.tsx` + `view-switch.css` | 三种令牌化样式：`section` 章节导航（40px / full 圆角 / 14px，选中 `--nav-selected`）、`tabs` 内容标签页（32px / md 圆角 / 13px，选中 `--accent-soft`）、`toggle` 单选选项（28px / sm 圆角 / 12px，选中 `--surface`） |
| Bridge 安装步骤条 | `src/components/LocalDeviceBridgeWizard.tsx` + `src/styles.css` 中的 `.local-device-bridge-wizard__steps` | 有序的安装/连接进度，不是标签页或视图切换；独立的令牌化步骤样式是共享切换契约的例外 |
| 加载/空/错误 | `src/components/common/SectionState.tsx`(认证启动期另有 `AppShellSkeleton`) | 骨架 + 空态 + 可重试错误三件套;parameter-home 转为 re-export 同一组件 |
| 局部令牌派生 | `src/features/parameter-home/parameter-home.css` | 用 `color-mix()` 从全局令牌派生局部语义色,不发明新字面量 |
| 图标 | `lucide-react` | 不用 emoji,不用 `✓`/`↗` 等文本字符当图标 |

**视图切换契约（UIA-016）：**23 条审计路径上的切换项全部使用共享组件；这些界面不再保留局部切换样式或覆盖规则。`/organization` 和 `/organization/members` 使用章节导航；人员管理的账号库/注册申请工作区使用内容标签页。章节导航的方向键、Home/End 只移动焦点，Enter/空格执行导航。内容标签页采用手动激活和游走焦点，每个选项必须提供 `id`/`panelId`；调用方渲染当前 `role="tabpanel"`，使用对应面板 ID，通过 `aria-labelledby` 关联选项 ID，仅在面板没有可聚焦内容时提供键盘入口。含可聚焦控件的面板不设置 `tabIndex`；加载、空白或只读状态使用共享 `TabPanel`，让可聚焦性随实际渲染内容更新。单选选项使用方向键或空格选择。三种样式共享令牌化的可见键盘焦点及禁用状态。一致性项目在 `1440x900`、浅色和深色主题下检查每个可见切换项必须且只能匹配一种根令牌样式签名。`e2e/quality/consistency-routes.ts` 中的 `viewSwitchStyleExpectations` 列出全部 23 条路径及必需层级，包括重定向后必须显示章节导航和账号标签页的 `/user-permissions`。

调试后台和参数后台使用章节导航，包含定义库/节点对应确认的嵌套路由。节点调试和 DTS 重载使用 HDC/ADB 内容标签页，并关联所选协议的工作台面板。新版参数值/成员删除审核（提交页也使用）及旧版审阅使用内容标签页，关联待处理/历史面板。一致性样式断言同时覆盖这些路由及参数后台重定向，检查每个可见切换项，但保留 Bridge 安装进度条作为独立模式。既有路由/查询状态、协议会话重置、请求选择及操作禁用契约保持不变。

非当前标签页的面板保持挂载并隐藏，确保每个 `aria-controls` 都有有效目标；非当前面板的内容可以卸载。

### Local Device Bridge 安装步骤条

节点调试和 DTS 重载共用紧凑就绪栏，仅提供一个「连接本机」操作和「安装指南」入口。服务端 Bridge 列表中存在任意未撤销记录，即视为回访用户，不按平台区分，也不默认展示内联安装指南。没有有效记录时，每次进入页面先展示一次内联指南；收起或尝试连接后不再自动展开，不使用浏览器存储判断。按需指南使用右侧抽屉，复用 `ModalDialog` 的焦点限制、Escape 关闭与焦点返回，保留工作台可见。连接成功后仅显示「已连接 · <机器名>」状态，设备检测仍由现有顶栏承担。普通未运行探测不显示警告；连接尝试失败时，就绪栏保留中文本地 Bridge 提示和技术详情。配对、协议及设备写入审批门禁不变。

节点调试和 DTS 重载中的 Bridge 向导依次展示三个步骤：安装 Bridge、连接本机、插入 USB 设备。它使用标注 `Bridge 连接步骤` 的 `ol` 和表示进度的 `li`；`data-active` 标记当前展示的步骤，`data-done` 标记已完成步骤。只有已可达且非当前的步骤才显示为可回访按钮。未到达步骤不可交互，前置条件检查继续决定进度。这不是 `tablist`、`radiogroup` 或自由视图选择，不关联标签页面板，也不采用标签页的方向键激活规则。`.local-device-bridge-wizard__steps` 保留独立样式；一致性断言仅豁免这些列表项，绝不豁免向导旁的 HDC/ADB 协议标签页。

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
| `--text-muted` | 三级/元信息文本 | 石板灰：浅色 `#536277`，深色 `#8b99b3` |
| `--accent` | 品牌强调色（链接、交互强调） | 品牌蓝 `#0052cc` 族 |
| `--primary` / `--app-primary` | 唯一的主动作静止背景色；均为 `--accent` 的别名 | 浅色 `#0052cc`，深色 `#4c8dff` |
| `--accent-hover` / `--accent-pressed` | 交互深浅 | 派生 |
| `--nav-selected` | 实心导航的选中态，不是动作或按下态 | 浅色 `#003d9b`，深色 `#4c8dff` |
| `--accent-soft` | 选中/活动背景、徽章 | 派生浅色 |
| `--success` / `--warning` / `--danger` / `--info` | 状态色 + 各自 `-soft` 浅色 | 每类一族 |
| `--ring` | 焦点环 | 基于 accent,一个值 |

规则:

- 颜色字面量**只允许**出现在令牌块内;其余一律 `var()` 或基于令牌的 `color-mix()`（参照 `parameter-home.css` 模式）。
- shadcn 的 `--primary`/`--muted`/`--border` oklch 键必须成为上述语义令牌的别名;同一问题存在两套答案即缺陷。
- **主色契约（UIA-017）：**所有可用主动作静止时的计算背景色必须等于解析后的 `--primary`，包括节点调试和 DTS 重载中的本地设备桥接安装、连接动作。CSS `.button.primary` 与共享 Button 默认变体使用同一令牌；Bridge 作用域只能补充布局，不能重定义主色。浅色和深色主题采用相同的别名映射，包括旧别名 `--app-primary` → `--primary` → `--accent`。悬停和按下态分别使用 `--accent-hover`、`--accent-pressed`；实心导航选中态使用独立命名的 `--nav-selected`。选中导航不是主动作。质量一致性项目在两种主题的 `1440x900` 视口下，将可见且可用的主动作与根令牌进行比较，局部覆盖不能改变预期主色。原生禁用或 `aria-disabled="true"` 的控件仍纳入测量，但使用独立的禁用视觉状态，不参与可用主动作静止背景色断言。
- 主动作测量使用共享按钮标记，而不是页面专属类名白名单。未使用 `.button.primary` 或共享 Button 默认/主动作变体的已有共享动作声明 `data-primary-action="true"`。每条一致性路由只要渲染可用主动作，就必须采集其测量；禁用动作仍纳入采集，但不参与主色断言。
- 中性色承载界面,颜色只为交互与状态服务;图表使用与 accent 对齐的令牌化分类色带（`--chart-1..5`）,不接受图表库默认配色。

#### 经测试的对比度配对（UIA-001）

小字号文本（包括加粗状态芯片，以及对辅助技术隐藏但仍然可见的行号）要求**至少 4.5:1**。以下配对保留现有色相族，定义统一放在 `src/styles.css` 的令牌块中；组件只消费令牌，不自行组合未经验证的前景与背景。

| 前景 | 背景 | 对比度（浅色 / 深色） | 使用场景 |
| --- | --- | --- | --- |
| `--text-muted` | `--bg`、`--surface`、`--surface-raised`、`--surface-sunken`、`--surface-low/mid/high`、`--accent-soft` | 最低 4.81 / 4.58 | 元信息、日志趋势备注、调试覆盖徽章、未选中的热榜切换项 |
| `--success`（`#0d714d` / `#10b981`） | `--success-soft` | 5.06 / 5.26 | 成功状态文本和徽章 |
| `--warning`（`#965500` / `#f59e0b`） | `--warning-soft` | 4.92 / 6.08 | 警告状态文本和徽章 |
| `--danger` | `--danger-soft` | 5.00 / 4.99 | 危险状态文本和徽章 |
| `--info`（`#036b9f` / `#38bdf8`） | `--info-soft` | 4.89 / 5.92 | 信息状态文本和芯片 |
| `--success` | `color-mix(in srgb, var(--success) 14%, var(--surface))` | 4.91 / 至少 4.5 | “工作配置”芯片 |
| `--configuration-source-text` | `--configuration-source-surface` | 两个主题均为 13.69 | 深色源码画布和统一差异视图 |
| `--configuration-source-line-number`（别名指向 `--configuration-source-text-muted`） | `--configuration-source-surface` | 6.66；聚焦行上为 5.25 | 两种源码查看器的行号栏，包括悬停与聚焦行 |
| `--configuration-source-text-muted/secondary/strong` | `--configuration-source-surface`、`--configuration-source-surface-raised` | 两个主题均至少 4.5 | 源码元信息和标题栏 |
| `--configuration-source-surface` | `--configuration-source-find`、`--configuration-source-find-active` | 默认 11.16；当前命中 7.96（两个主题相同） | 搜索命中：不透明黄/琥珀色底配显式深色文本 |

配置源码画布在两个主题中均保持深色。独立源码查看器使用 `--surface-sunken` 背景，以及 `--text-secondary` 和 `--text-muted` 文本。`src/contrast.styles.test.ts` 检查实际样式声明，解析令牌派生并先合成半透明行背景，再验证 WCAG 门槛。无障碍质量门禁在 1440×900 下扫描 UIA-001 的全部十个路径，不再排除热榜切换项、工作配置芯片或源码行号。令牌配对测试不能替代真实 API 运行时的无障碍扫描和前后截图。

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

TopBar 使用 `--text-xl` / `--leading-xl`（20/28）。应用内标题和按钮文案只使用这套字号，包括旧控件与通过 Portal 渲染的确认弹窗。一致性采集器检查每个可见标题和按钮，要求恰好一个 TopBar 标题，并在所有一致性路由的 1440×900 明暗主题检查中拒绝空采集或刻度外字号。公开营销首页的排版不属于应用壳层契约。

### 间距

4px 栅格。令牌 `--space-1..-16` = 4、8、12、16、20、24、32、40、48、64。默认:

- 页面内容内边距:桌面 24px,移动 16px。
- 卡片内边距:16–20px。分区间距:24px。工具栏控件间距:8px。
- 偏离 4px 栅格的值（6px、10px、14px 间距等）只做迁移,不再新增。

### 内容宽度

| 令牌 | 值 | 用途 |
| --- | --- | --- |
| `--xiaoze-welcome-copy-width` | `270px` | 与字体无关的小泽欢迎页副标题最大宽度；在不同 CJK 回退字体度量下保持已提交的 Linux 视觉基线稳定 |

内容宽度令牌描述有意设置的换行约束，不属于通用容器几何。小泽欢迎文案宽度必须保持令牌化的固定像素值：字符相对单位 `ch` 会使中文换行随实际生效的回退字体变化。

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

状态侧线（`--shadow-status-warning`、`--shadow-status-accent`、`--shadow-status-accent-light`）以及轮廓、焦点和脉冲配方（`--ring-soft`、`--ring-outline`、`--ring-secondary`、`--ring-accent`、`--ring-pulse-start`、`--ring-pulse-end`）统一定义在根令牌块。这些是语义描边，不是新增的层次等级；页面 CSS 不得内联发明其尺寸和颜色。配置工作台底部锚定的任务面板使用方向性 `--shadow-sheet-above` 配方，使阴影投向上方内容而非视口下方。

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

页面内容内部使用命名子阶梯：`--z-content-base`（0）、`--z-content`（1）、`--z-content-sticky`（2）、`--z-content-panel`（3）、`--z-content-toolbar`（4）、`--z-content-menu`（5）、`--z-content-overlay`（10）。它保留工作台、树、检查器和底部任务区的现有叠放关系，全部低于应用级吸顶层（20）。

`:root` 中只声明一条阶梯；组件 CSS 或 TSX 里的裸数字一律禁止。浮层刻度为 `--z-xiaoze-fab: 1100`、`--z-xiaoze-popup: 1140`、`--z-modal-backdrop: 1150`、`--z-modal-backdrop-nested: 1160`、`--z-xiaoze-approval: 1250`、`--z-toast: 1350`，吸顶头、侧边栏、下拉/浮层等应用层令牌位于其下。无模态小泽窗口刻意低于业务弹窗，小泽审批层和 toast 刻意高于业务弹窗。「+1 逃生舱」（40 对 41、60 对 61）是缺陷。

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

旧 `.button` 和共享 `Button` 使用同一张基于现有间距与字号令牌的 CSS 尺寸表，不再分别定义 Tailwind 与 CSS 尺寸：

| 尺寸 | 高度 | 字号/行高 | 水平内边距 |
| --- | --- | --- | --- |
| `xs`（共享辅助控件） | 24px | 11/16 | 4px |
| `sm`（行操作） | 28px | 12/18 | 8px |
| `md`（共享 `default`） | 32px | 13/20 | 12px |
| `lg` | 36px | 13/20 | 16px |

尺寸表只在共享 `.button-size-*` 规则及并列的旧选择器中定义一次。图标变体使用对应高度的方形边长、零内边距；图标为 16px，`xs` 图标为 12px。小控件内容间距为 4px，默认和大控件为 8px。两种实现均使用中等圆角和 600 字重。页面不得重定义这些几何值。

### 行操作

`src/components/common/RowActionMenu.tsx` 是后续列表迁移共用的行操作契约。每行至多展示一个文本操作（`primaryAction`）和一个有名称的「更多」入口。可见操作与入口使用 `Button size="sm" variant="ghost"`，菜单项使用相同的小尺寸。本次契约工单不迁移旧页面的行操作。

- `label` 为辅助技术标识该行的操作组和菜单。`items` 提供稳定 ID、文案、可选禁用状态和 `onSelect` 回调。空菜单集合不渲染「更多」。
- Radix DropdownMenu 提供 menu/menuitem 语义、游走焦点、方向键、Home/End、输入定位、Escape、点击外部关闭和焦点返回。菜单通过 Portal 渲染，不被表格滚动区域裁切。
- 危险项必须声明 `destructive: true`，并提供包含标题、影响范围说明和确认文案的 `confirmation`；可选风险勾选复用 ConfirmDialog 契约。危险项不能成为可见文本操作，只在菜单中显示红字，不在表格行中放实心红按钮。选择危险项只打开 `ConfirmDialog`。
- 仅在用户确认后执行危险回调。提交中禁用重复提交和关闭；失败保留弹窗并显示经共享格式化器处理的中文错误，允许重试；取消和成功后焦点返回「更多」。普通操作的结果仍由调用方处理。

### 输入与选择

- 最小高度 32px、`--radius-sm`、令牌化边框、按上文规则显示焦点环、可见 label 或 `aria-label`、错误文案经 `aria-describedby` 关联。
- PC 筛选、排序及分页条数选择器显式使用 `.compact-filter-control`（原生）或 `SelectTrigger size="filter"`（自定义），共享唯一的 32px 边框盒高度（`--space-8`）、边框、圆角、字体和箭头契约。分页操作复用默认 32px `.button` 原语，不使用 `sm` 变体。仅为这些控件标记 `data-compact-control="filter"`、`"sort"` 或 `"pagination"` 以供一致性测量。搜索组合框、模块导航、表头排序按钮、表单字段和对话框保留各自的原语；页面局部规则仅添加布局，不重复定义紧凑控件的几何或外观。
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

- 一条 toast 管线（`src/components/common/toast` 的 `useToast()`）:单一 portal、队列、三种语气（成功/信息/危险）、4 秒自动消失（悬停暂停）+ 可选操作,全产品统一右下角堆叠。
- 横幅只用于持续性上下文（降级模式、权限范围）,不用于操作结果。
- 展示给用户的错误一律映射为产品语言;原始 `error.message`、HTTP 载荷、堆栈片段不得渲染。字段错误位于字段下方,以 `aria-describedby` 与 `aria-invalid` 关联。

### 加载、空、错误

- 加载:内容区域用骨架屏占住真实布局（列表、卡片、画布）;spinner 只用于行内/按钮级等待。认证/启动阶段渲染应用壳骨架,绝不允许白屏。
- 空态:图标（lucide）+ 一句状态 + 可选一句指引 + 可选主操作。禁止"表格只剩表头"式裸空态。
- 错误:产品语言的消息 + 重试操作。API 瞬断不得静默把用户登出或让页面失联。

### 图表

Recharts 图表消费令牌:分类色带 `--chart-1..5`、网格线 `--border`、坐标文字 `--text-muted`（`--text-sm`）、tooltip 按浮层规格（`--surface-raised`、`--shadow-2`）。不接受图表库默认样式。

色带批准值（P3）:`--chart-1` 别名 `--accent`;`--chart-2` teal `#0e7490`、`--chart-3` violet `#7c3aed`、`--chart-4` sky `#0284c7`（即 `--info` 色相）、`--chart-5` slate `#64748b`——浅色下对 `--surface` 全部 ≥3:1,五个中四个 ≥4.5:1。深色主题将 `--chart-2..5` 提亮一档（`#22b8cf` / `#a78bfa` / `#38bdf8` / `#94a3b8`）,`--chart-1` 跟随深色 accent。请经由 `src/domain/format/chartTheme.ts` 消费色带（系列色/状态色/网格线/坐标刻度/tooltip 样式以 `var()` 引用导出）,不要硬编码取值,使图表随激活主题切换。

## 布局与页面结构

### 壳层边距与导航

应用壳层拥有 `--page-gutter`（PC 为 24px）。`.main-content` 与 `.topbar` 消费此令牌；`.page-content` 无额外内边距地包裹路由内容，应用页脚仍是它在壳层中的同级区域。页面根容器不添加外层内边距或外边距。卡片与工作台面板保留内部留白；不要删除这些内部内边距，也不要用全局覆写替代页面局部 CSS。配置工作台保留现有的不显示页脚行为。

配置内容包装层保留通往有界面板的满高链。源码画布沿用 `--font-code` 字体栈、`--text-sm` 字号和 1.75 行高比例（12/21px）；令牌迁移不得改变源码行尺寸。紧凑壳层底部留白为 4px 网格上的 120px，而不是单个 64px 间距刻度。仅供屏幕阅读器的图表回退文本使用负的 `--stroke-hairline` 外边距，而非负的内容间距。

共享导航展开和折叠状态均使用 4px 间距令牌；普通导航项最小高度为 40px，垂直/水平内边距为 8px/12px，图标与标签间距为 12px。明暗主题的活动项都使用命名的 `--shadow-1` 层级，不允许自定义活动阴影或刻度外导航间距。

一致性测试在每条路由比较壳层令牌定义的左边缘与路由内容、页面根内容、TopBar、页脚左边缘（±1px）。区域缺失或非有限测量值均失败。仅当 DOM 中不存在壳层页脚时，页脚区域才是可选的（包括重定向到配置工作台的旧版项目链接）；所有存在的页脚即使隐藏也必须测量并检查。仍需真实运行时截图与质量/验收测试，静态测试不能替代它们。

### 管理列表页面

`src/components/layout/` 中的 `AdminListPage` 负责页头操作、紧凑筛选栏、共享 `DataTable`、可选通知与可选详情抽屉/弹窗。页面标题与边距来自壳层；模板不再添加重复标题或外层留白。次要操作排在主动作之前，主动作保持在最右端。页面只填充槽，并删除旧列表布局 CSS，不覆盖模板。

多集合管理页使用 URL 驱动的 `ViewSwitch` 内容标签、一个可见面板与一个可见 `AdminListPage`，不再堆叠集合卡片。知识治理选择 `tab=drafts`（默认）、`tab=index` 或 `tab=archived`；日志后台选择 `tab=records`（默认）、`tab=domains` 或 `tab=quality`。无效标签回退到默认；切换保留其他查询参数与片段，新增历史记录，并支持浏览器前进/后退恢复。离开日志业务域标签时保留编辑器的本地输入。仅有重试操作的索引行与只读反馈行不放空的「更多」菜单；多操作行复用共享菜单，危险操作保留确认。每个集合分别纳入浅色/深色 1440×900 一致性测量。

- `table` 沿用 DataTable 契约，包括受控 `sort`、`onSort`、`page` 和 `onPageChange`。路由负责序列化：项目试点将搜索（`q`）、状态（`status`）、排序（`sort`）与分页（`page`）保存在 URL，支持刷新和浏览器历史恢复。筛选/排序变化回到第一页；第一页省略 URL 参数，无效页码归一为一。
- 模板启用 DataTable 的 `compactControls` 模式：列筛选配置由共享 `ColumnFilter` 渲染，可排序表头保留 `aria-sort`。两者使用令牌化的 32px `.compact-filter-control` 几何与显式 `data-compact-control` 筛选/排序标记，供一致性采集器测量。模板以外的原生表头控件保留原有尺寸和测量范围。
- `rowActions` 提供 `RowActionMenu` 参数，而非任意按钮组：每行至多一个小尺寸文本操作加「更多」。操作可选 `ariaLabel` 与 `descriptionId` 保留逐行名称和禁用说明。规范历史项目仍禁用删除；允许的删除通过 ConfirmDialog 复用项目影响范围文案。提交中与失败状态遵循共享菜单确认契约。
- `emptyState` 必须提供一条消息和唯一下一步，由 SectionEmpty 在表格内渲染。无项目时提供创建，无匹配时提供清除筛选。`detailDrawer` 接入调用方已有的可访问弹窗，不替换其焦点管理。
- 布局常量只在根令牌定义一次：`--admin-list-table-min-width`（1080px）、`--admin-list-name-max-width`（240px）与 `--admin-list-detail-width`（520px）。长名称保留完整名称提示，共享滚动条与已有小窗口卡片字段标签继续保留；删除页面专属表格规则，试点的详情表单也改用令牌。
- 真实运行时一致性项目在浅色/深色 1440×900 下检查项目试点：页头/筛选/表格对齐、首行可见、每行小尺寸操作加「更多」、无可见危险操作，并沿用边距、字号、主色与裁切契约。组件和纯采集器测试不能替代真实 API、无障碍、验收或截图证据。

### 概览与退役页面模板

`src/components/layout/` 中的 `OverviewPage` 按顺序组织摘要条、响应式内容网格和可选快捷操作。页面通过 `summary`、`children`、`quickActions` 填充槽，并提供可访问的 `label`，不在页面 CSS 中重新实现网格。模板继承壳层间距，复用现有间距和字号刻度，仅定义指标卡与内容网格的最小宽度布局令牌。指标使用描述列表中的 `OverviewTile` 展示数值、标签和可选趋势；实际观测到的零数值和零趋势仍保留。

调用方根据指标的真实来源，为每张指标卡或 `OverviewVerdict` 提供 `hasSamples`。没有观测时，共享策略将数值替换为「暂无样本」、判断替换为「暂无样本，无法判断」，并隐藏趋势，不伪造成功判断或百分比。加载、错误与风险数据不可用仍保持原有含义。`/parameter-home` 使用当前概览范围，保留项目选择、时间窗口、快捷操作和热榜标签页。`/log-dashboard` 使用今日未归档日志，质量指标仅使用已完成日志的置信度观测，原有导航动作仍位于 TopBar。公共首页仍在应用壳层之外。

`RetiredNotice` 将退役的参数对比与调试模拟器页面统一为一个标题、一句解释和一个主替代链接。`/parameter-comparison` 链接到 `/parameters`，`/debugging` 链接到 `/node-debugging`。链接有真实 `href`，普通激活使用应用导航，修饰键点击保留原生行为，不显示误导性的 404 错误。

组件测试覆盖槽、无样本策略和替代导航。一致性测试要求四条路由在 1440x900、明暗主题中都有非空模板测量，检查槽与壳层边缘对齐、指标卡包含关系、页面横向溢出、首个内容区可见及无样本数值与判断，并验证退役提示的主链接目的地。真实运行时质量/验收测试和改动前后截图仍是独立证据；样式守卫要求视觉声明只使用令牌，`ui:check` 计数下降时同步下调基线。

### 导航工作台

`src/components/layout/` 中的 `NavigatorWorkbench` 负责固定顺序：工具栏（主动作位于最右端）、可选的紧凑上下文、至多一个通知槽，然后是有名称的导航、任务及可选检查器区域。页面只填充槽，不重定义网格、面板宽度或滚动预算。`/parameters` 的 DTS 与 JSON 均使用此模板。Catalog 参数定义页面（`/parameter-admin`、`/parameter-admin/specs` 及其参数定义别名、`/parameters/definitions`）将发布条放在上下文槽、治理提示放在通知槽，并保留现有定义对话框。Catalog 管理别名共用 `catalog-definitions` 折叠键；只读的 `/parameters/definitions` 使用 `parameter-definitions`。模拟模式的平面参数表及其他路由在各自迁移前保留原有布局。

| 槽 | 契约 |
| --- | --- |
| `toolbar` / `primaryAction` | 搜索、视图切换、筛选及次要动作放在控件组中；可选主动作固定在最右端。 |
| `context` | 工具栏下方可选的紧凑发布、项目或状态条。 |
| `notice` | 上下文下方至多一个紧凑通知槽；使用共享提示样式，保留页面现有的关闭行为。 |
| `navigator` | 有名称、可折叠的模块或对象区域；内容在面板内滚动。 |
| `children` / `taskState` | 有名称的任务区拥有滚动容器。加载、空状态及可重试错误交给 `SectionState`；搜索无匹配时仍保留表头和筛选入口。 |
| `inspector` | 任务区之后可选的有名称详情区域，由页面决定何时打开。参数定义详情与历史保留在现有对话框中，不占用常驻检查器。 |

布局常量仅在 `src/styles.css` 根令牌块定义一次：`--navigator-workbench-navigator-width`（18rem，为模块数量预留空间）、`--navigator-workbench-navigator-cap`（别名为 `--module-navigator-max-width`，即 `min(32.5rem, 42vw)`）、`--navigator-workbench-collapsed-width`（`--space-10`，40px）、`--navigator-workbench-inspector-width`（20rem）、`--navigator-workbench-gap` 与 `--navigator-workbench-toolbar-padding`（`--space-3`，12px）、`--navigator-workbench-pane-height`（`min(670px, calc(100vh - 230px))`）及 `--navigator-workbench-scroll-rail-height`（14px）。主体网格使用导航宽度与上限的较小值、`minmax(0, 1fr)` 任务轨道，以及可选的检查器宽度。在 1440×900 下，导航从模板左边界开始，任务区左边界为一个有上限的导航宽度加一个间距。标签保持单行并使用省略号；数量列保留固有宽度，不收缩或裁切。溢出只在导航或任务滚动容器内处理，不延伸到页面。工具栏、面板、树和参数表的颜色使用语义主题令牌，深色模式也遵循 Phase 2 对比度配对。已迁移页面不得在模板外再套一层带留白的卡片，也不得保留局部网格、面板宽度或滚动高度规则。

折叠通过浏览器本地存储 `wiseeff.navigator-workbench.collapsed:<pageKey>` 持久化；存储不可用时，选择仅在当前挂载期间保留。`/parameters` 在项目间以及 DTS/JSON 格式间共享页面键。折叠将导航轨道替换为 40px 窄轨，隐藏导航内容但不卸载，保留模块选择和 URL 状态（`project`、`moduleNode`；Catalog 保留 `moduleNodeId`）。切换按钮通过 `aria-controls` 指明受控内容，并暴露 `aria-expanded`。导航、任务和检查器均为有名称的区域，不新增 `main` 地标；保留应用壳的主地标与跳转链接。任务滚动容器复用 TabPanel 的键盘入口：没有可 Tab 聚焦的内容时，有名称的区域获得 `tabIndex=0`。DOM 与键盘顺序为工具栏控件 → 主动作 → 上下文 → 通知 → 导航切换按钮和树 → 任务 → 检查器，跳过未提供或隐藏的内容。可选结果标签通过名称关联主体 `tabpanel`；格式切换后焦点回到当前格式标签。

项目配置复用同一模板：配置集与成员文件放在导航区，各源码模式及现有空状态保留在任务区，现有检查器放入检查器槽。源码、结构、冲突使用 URL 驱动的内容标签（`tab`）；旧文件/配置集链接保留检查器选择，结构链接选择结构标签，`tasks=conflicts` 或 `dock=conflicts` 选择冲突标签。切换标签保留配置集、文件、节点、属性、源码模式与版本焦点。当常驻检查器会使源码区不足 640px 时，共享检查器槽以浮层呈现，不占用网格列。配置工作台保留受限壳高度与内部滚动容器，不再添加外层卡片或留白。一致性项目在浅色、深色主题的 1440×900 视口下覆盖每个配置子路由、全部五种源码模式，以及检查器深链接。

样式表中仍保留 `.dts-parameter-workbench__body` / `.dts-workbench-topology` 旧规则；它们不是已迁移 `/parameters`、Catalog 或项目配置界面的面板覆盖。本契约不改变配色、字体、密度、权限、服务端或 Agent/设备写入行为；平板与手机重新设计仍不在范围内。

日志工作台（`/logs`，页面键 `logs`）把历史记录放在可折叠导航区。报告、元数据与相关内容标签共享任务区；成功与处理中的记录显示分析，失败记录仅显示失败摘要。相关知识保留现有能力检查。上传操作放在工具栏主动作槽；上传与重新上传后回到所选记录的报告。选择仍通过 `logId` 分享，不受标签切换与导航折叠影响。共享面板几何与滚动容器替代页面自建网格。 已完成报告无需切换标签即可访问带标签的已发布相关知识区域；结论动作（包括能力门控的知识沉淀）在报告与相关内容标签中均可用。

节点调试与 DTS 重载也使用 `NavigatorWorkbench`：Bridge 就绪条进入上下文槽，模块树进入导航槽，参数表及操作／运行历史进入任务槽。重载托盘位于候选表下方，使回访与已连接用户在 1440×900 下能看到首条数据行。协议保留为活动工作台外层的内容页签；`node-debugging` 与 `dts-reload` 页面键分别持久化折叠状态。下发与节点回滚保留现有审批和能力闸门。其他工作台由各自工单迁移。本契约不改变配色、字体、密度、URL、权限、服务端或 Agent/设备写入行为；平板与手机重新设计仍不在范围内。

模块治理（`/parameter-admin/modules`）使用 `module-governance` 折叠键。现有可编辑分类树位于导航区；内容标签分别显示规范主体与归属、兼容发现，以及只读历史注册表。各标签保留挂载内容，复用同一工作台几何。默认模块标签使用基础 URL；`?tab=queue` 和 `?tab=registry` 选择其他标签。旧 `/modules/queue` 和 `/modules/registry` 书签替换当前历史记录为对应标签 URL，保留其他查询参数；浏览器后退恢复标签状态。分类操作、规范权限检查及历史只读对话框均保持不变。

质量一致性项目在浅色、深色主题的 1440×900 视口下检查展开与折叠几何（±1px）、工具栏与动作位置、单一通知、首行可见、页面横向溢出，数量文字裁切，以及现有行操作和模块树契约。深色 `/parameters` 检查还运行无排除项的 axe 文字对比度扫描。截图附件是 Catalog 迁移前的审阅门槛；不得在本地重生成 Linux 视觉基线。

- 小泽入口与首次提示放在主滚动区之外的底部预留留白中，不得遮挡可见表格滚动区或吸附操作区。桌面拖动及左右方向键只沿该留白移动；入口移到左侧时提示朝内翻转。调整窗口后入口仍可达，键盘聚焦有可见反馈；Home 恢复右下角入口。关闭提示后，按用户保存偏好，SPA 导航及刷新均保持关闭（存储不可用时退回当前页面生命周期）。弹窗交互、Agent 行为及人工审批保持不变。一致性质量项目在 1440×900 下对全部目标路由断言不相交，包括首次提示可见状态。

- TopBar 从 `appConfig` 渲染页面标题与副标题;页面主体不得重复(不许双标题、不许并列 `h1`)。
- 可见圆角容器最多嵌套两层;更深的分组用间距与分隔线表达,而不是继续套框。
- 宽度预算纳入评审:1440px 视口下,任何主工作台表格不得因外框留白而横向滚动。
- 侧边栏:桌面展开 256px / 收起 76px;<768px 改为抽屉浮层(常驻窄轨吃掉手机屏幕 ~18% 宽度是缺陷)。任何宽度下用户菜单必须可达。
- 导航保持 SPA 行为(应用内链接不整页刷新)、路由切换重置主区滚动位置、活动态只保留一套视觉层级。

### 设置表单

`src/components/layout/` 中的 `SettingsFormPage` 与 `SettingsFormSection` 负责配置表单布局。组织设置（`/organization`）、DTS 重载默认值（`/debugging-admin`）与项目审核角色（`/parameter-admin/projects/:projectId/review-roles`）均采用单列布局，以 `--settings-form-max-width`（960px）限定最大宽度。外侧留白由应用壳负责，只有分节卡片增加内边距。每节包含标题与简短说明；审核角色矩阵仅在分节内横向滚动，不让页面横向溢出。

`useDirtyState` 比较可序列化为 JSON 的已保存快照与草稿；恢复已保存值后，保存条消失。存在未保存更改时显示粘性保存条，包含唯一主动作 保存 与 放弃。放弃恢复最后一次保存的快照，不发送服务端写入。保存失败保留草稿并显示有名称的错误摘要；字段校验就近展示并关联相应控件。保存期间禁用字段、保存/放弃与导航。应用壳导航、浏览器前进/后退及刷新会提醒未保存工作；审核角色的刷新动作使用同一离开守卫。

项目角色保存保留人工确认，并列出每位修改成员的变更前后角色。服务端写入仍为携带 `expectedRoles` 的逐成员乐观更新，而非原子批量写入：某次更新失败时，已保存成员保持已保存，其余草稿可重试或放弃。角色过期冲突会刷新受影响成员后再重试。一致性套件在 1440×900 的明暗主题下测量干净与未保存状态，并附带截图，不提交写入。

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
