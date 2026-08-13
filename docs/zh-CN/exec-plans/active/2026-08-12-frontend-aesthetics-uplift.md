# 前端美学提升计划

> Status: **Active**
> 日期: 2026-08-12
> 分支: 纲领计划——每阶段一个分支: `fix/ui-foundation-tokens`(P0)、`feat/ui-primitives-consolidation`(P1)、`fix/ui-page-defects-wave-1`(P2)、`feat/ui-motion-and-theme`(P3)、`feat/ui-quality-gates`(P4)
> English: [`docs/exec-plans/active/2026-08-12-frontend-aesthetics-uplift.md`](../../../exec-plans/active/2026-08-12-frontend-aesthetics-uplift.md)
> 标准: [`docs/zh-CN/design-docs/ui-design-system.md`](../../design-docs/ui-design-system.md) · 门禁: [`docs/zh-CN/developer/ui-quality-checklist.md`](../../developer/ui-quality-checklist.md)

## 背景

2026-08-12 完成一次完整的前端美学审计:API 模式下 25 条路由的真实浏览器走查(证据 `work/ui-checks/*.png`,桌面 1440 + 移动 390 抽查),加上样式/令牌、组件体系、页面交互流、质量流程文档四路并行静态审计。质量基准:Linear 级视觉品质。

关键数字:`src/styles.css` 单体 28,556 行(4,715 条选择器);令牌渗透率仅 10.8%;669 种颜色字面量(出现 2,230 次);60 种字号;40 种圆角;113 种阴影写法(91 种只用一次);36 种动效时长且默认 `ease` 占 65 次;90 条 `z-index` 中 84 条硬编码;42 个 CSS 作用域各自重写 `.button` 几何;9 套并行表格实现;约 30 个手写弹窗绕过 `ModalDialog`;21 个按钮作用域仅 3 个定义 `focus-visible`;中文优先的界面没有任何 CJK 字体栈,且从 Google Fonts 远程引入 Inter(自托管内网必然失败);18 个测试文件中 47 处对 CSS 原文的正则断言把单体文件锁死无法重构。

## 目标

按《UI 设计系统》把所有产品界面收敛到同一套设计语言(令牌、原语、状态、动效、文案规则),并用自动化门禁让回退在结构上变难——使任何开发者或 agent 默认产出 Linear 级 UI。

## 非目标

- 信息架构与产品流程的重设计(IA 不动;本计划修执行质量)。
- 深色模式上线(P3 只做布线;是否上线是独立决策)。
- 把所有旧页面迁到 Tailwind/shadcn(目标是统一令牌层与共享原语;迁移期各页 CSS 技术可以不同)。
- 超出共享组件顺带修复范围的 mock 演示打磨。

## Git & PR Workflow

| 角色 | 允许 |
| --- | --- |
| 实现 agent(子代理) | 从最新 `main` 拉取/检出阶段分支、实现、测试、在特性分支上提交 |
| 实现 agent(子代理) | 不得推送 `main`、不得开/合 GitHub PR、不得快进本地 `main` |
| 父 agent(架构/会话所有者) | 评审子代理产出、抽查验证、创建 PR、批准后合并、`git pull origin main` 同步 |

一个阶段 → 一个分支 → 一个 PR。后续阶段基于已合并的前序阶段 rebase。

## 发现清单

严重度:P0 = 阻塞收敛的地基缺陷;P1 = 用户可见的品质失败;P2 = 系统性打磨欠账。

### 地基(样式与令牌)

| ID | 级 | 发现 | 证据 |
| --- | --- | --- | --- |
| FA-01 | P0 | 两套互不连通的设计体系:shadcn/Tailwind 原语(`src/components/ui/*`,17 个,几乎无人用)与 28,556 行手写 `src/styles.css`;`--primary: oklch(0.205 0 0)`(近黑)与 `--app-primary: #003d9b`(品牌蓝)并存,两套按钮主色不同 | `src/styles.css:37-44`、`:13492-13533`、`components.json` |
| FA-02 | P0 | 约 89% 声明绕过令牌:1,786 处 `var()` 对 16,578 条声明;669 种颜色字面量;间距/字号/行高/字重/动效完全无令牌;圆角令牌使用率 3.8%、z-index 6.7% | 全量统计;如 `--outline` 定义于 `src/styles.css:35`,却有 9 个近似灰共用 107 次 |
| FA-03 | P0 | 字体三重冲突且无 CJK 栈:远程 Google Fonts `@import` 进入产物(自托管内网失败);Geist 已打包但只作用于弹窗/卡片标题;`lang="zh-CN"` 界面无 PingFang/YaHei/Noto 回退;114 处使用不存在的字重(850/750/650/760/720) | `src/styles.css:1`、`:11`、`:13493-13494`、`src/components/ui/dialog.tsx:138`、`src/components/ui/card.tsx:41` |
| FA-04 | P1 | 26 处 `var()` 引用从未定义的令牌导致静默渲染错误:`--text-muted`(14)、`--xiaoze-radius-sm`(4,圆角塌成直角)、`--app-border`(2,整个 `color-mix()` 失效)、`--app-text`、`--ink`、`--font-mono` | `src/styles.css:3974`、`:4291`、`:15060`、`:10130` |
| FA-05 | P1 | 18 个测试文件 47 处 CSS 原文正则断言把 `styles.css` 锁死 | `src/App.test.tsx`(12)、`src/components/ParametersTable.test.tsx`(8)等 |
| FA-06 | P1 | z-index 无政府状态(文档明令禁止仍发生):84/90 硬编码、30 个层级、+1 逃生舱(40/41、30/31、60/61)、TSX 里 `zIndex: 60` | `src/styles.css:690,700,14536,14632,23823,23827`、`src/components/ColumnFilter.tsx:34,44` |
| FA-07 | P2 | 无字阶/间距刻度:60 种字号(px/rem 混用)、25 种行高、68 种 gap、215 种 padding、91 处 `!important` | 全量统计;目标刻度见《UI 设计系统》 |
| FA-08 | P2 | 113 种阴影(91 种一次性);焦点环透明度三种并存(0.10/0.12/0.14) | 全量统计 |
| FA-09 | P2 | 动效:36 种时长、7 种缓动、默认 `ease` 65 次;好曲线只在小泽弹窗;多个无限循环未受 `prefers-reduced-motion` 保护 | `src/styles.css:13900-13919`(正面);`logPulse`/`confidenceShimmer`/`dirty-pulse`(未守护) |

### 组件

| ID | 级 | 发现 | 证据 |
| --- | --- | --- | --- |
| FA-10 | P0 | 无按钮基础层:`.button` 无基础规则;42 个作用域重写几何(9 种高度 24–44px、5 种字号、6 种字重、3 种圆角);504 处裸 `<button>` 对 66 处 `<Button>` | `src/styles.css:458,924,1202,4776,7552,10910,22829,25401,27707` |
| FA-11 | P0 | 交互状态大面积缺失:21 个按钮作用域中 18 个缺 `focus-visible`、14 个缺 `active`;6 处合并 hover+focus 后 `outline: none`;全站 38 处 `outline: none`;按钮内 spinner 为零 | `src/styles.css:762-766,2885,4244,6626,13406,19816` |
| FA-12 | P0 | 弹窗碎片化:契约正确的 `ModalDialog` 只有 4 个消费者;约 30 个手写 `modal-backdrop` 弹窗无焦点陷阱/Escape(实测:添加用户弹窗无遮罩、Escape 关不掉、可与小泽面板自由叠加);4 处 `window.confirm` | `src/components/RollbackConfirmDialog.tsx:28`、`src/components/LocalDeviceBridgePanel.tsx:314`、`src/components/ParameterImportWizard/ParameterImportWizard.tsx:214`、`src/components/admin/ModuleEditDialog.tsx:460`;截图 `work/ui-checks/17-add-user-dialog.png`、`18-xiaoze-panel.png` |
| FA-13 | P1 | 9 套表格实现;只有 `admin/DataTable` 有分页/`aria-sort`/键盘行(2 个消费者);`src/workbenchUi.tsx:41` 存在同名 `DataTable` | `src/components/admin/DataTable.tsx`、`src/components/parameter-topology/DtsParameterWorkbenchTable.tsx:262` |
| FA-14 | P1 | 反馈碎片化:toast 复制 3 处且无队列/portal;确认路径 6 种;错误类名 26 种;`aria-describedby` 仅 5 处;加载/空/错误三态只有 `parameter-home` 完整 | `src/App.tsx:5227,5232`、`src/components/parameter-admin-next/useGovernanceToast.tsx:24`、`src/features/parameter-home/components/SectionState.tsx` |
| FA-15 | P2 | `App.tsx`(6,089 行)是影子组件库:`WorkbenchLayout`/`SectionLabel`/`EmptyState` 逐字节重复;死组件(`RadioDropdownFilter`、`FilterChipGroup`、`ProjectValueMatrix`、`ui/avatar`、`ui/toggle`、`.undo-toast` CSS);死布局层 `WorkspaceHeader`/`PageToolbar` | `src/App.tsx:5997,6039,6075` 对 `src/workbenchUi.tsx:24,67,89` |
| FA-16 | P2 | 变体词汇分裂:`variant`/`tone`/`severity`/`kind` 六套取值表达同一语义轴;19 处 `<Button className=...>` 覆盖重新发明既有变体 | `src/components/AgentInsightBar.tsx:8`、`src/components/common/ConfirmDialog.tsx:11`、`src/components/admin/ArchiveDebugParameterDialog.tsx:53` |

### 页面、文案与流程(浏览器实测)

| ID | 级 | 发现 | 证据 |
| --- | --- | --- | --- |
| FA-17 | P0 | 原始内部信息漏给用户:审阅页 ISO 时间戳 + 英文调试文案;日志页英文报错重复渲染并泄露内部代号;审计中心原始 slug;工作台命令栏英文原始错误;登录页 `Failed to fetch` | `work/ui-checks/07-review-1440.png`、`13-logs.png`、`14-audit.png`、`12-config-workbench.png` |
| FA-18 | P0 | 界面中英混排:4 个组件硬编码 `Showing X of Y`(测试还断言英文);`userGovernanceClient` 输出 `never`/`2h ago`/`just now`;表头 `Report ID`;英文权限拒绝卡;英文 eyebrow | `src/components/ParametersTable.tsx:355,372`、`src/NodeDebuggingPage.tsx:1109`、`src/features/dts-reload/DtsReloadPage.tsx:2139`、`src/infrastructure/http/userGovernanceClient.ts:64`、`src/app/routes.tsx:152-163` |
| FA-19 | P1 | 6+ 页面实测脱板一次性用色:黑色实心按钮(`#111827`)、黑色 KPI 条、黑顶边看板卡、青绿提交步骤条、藏青登录按钮——两代设计并存 | `src/styles.css:496,8054,8088,8105,20481`;截图 `07/08/09/13-log-dashboard/14-*` |
| FA-20 | P1 | 布局预算失败:1440 下 `/parameters` 表格需 1100px 只得 782px(横向滚动);项目清单同样溢出;390 下常驻 76px 窄轨吃掉 18% 宽度、`.topbar-user-switcher` 在 <900px 被 display:none(无法退出登录)、托盘文字一字一行竖排 | 实测 `dts-workbench-list__scroll-x` sw=1100 cw=782;`src/styles.css:13075-13081`;`work/ui-checks/20-mobile-*.png` |
| FA-21 | P1 | 状态覆盖漏洞:认证启动期白屏;API 瞬断把用户踢回登录页并显示原始错误;`/node-debugging` 与 `/user-permissions` 缺加载/空/错误;置信度渲染成 `0.91%`(0–1 小数直接拼 `%`) | `src/App.tsx:1369,4403`;API 重启期间实测 |
| FA-22 | P2 | 页面级零过渡词汇:raw-backdrop 弹窗无开合动画、路由切换不重置滚动、着陆页链接整页刷新;双页面标题(`/parameters`、`/platform-console`)违背"标题归壳层" | `src/App.tsx:2519-2537`、`src/linear-template/LinearTemplateHome.tsx:99-110`、`work/ui-checks/05-parameters-1440.png` |
| FA-23 | P2 | 种子演示暴露测试残留:`FoldRegistryTestDG`、名为「测试」的驱动组、`probe-edit-*.dts`、用户名录中的验收 fixture 账号;工作台树暴露原始版本 id | `work/ui-checks/10-param-admin-modules.png`、`12-config-workbench.png`、`14-user-permissions.png` |

### 流程缺口

| ID | 级 | 发现 | 证据 |
| --- | --- | --- | --- |
| FA-24 | P1 | 无任何 lint(ESLint/Stylelint/Prettier 均缺席);没有机制阻止新增硬编码;样式规则只有散文 + 3 个点状 `*.styles.test.ts` | `package.json`(无 lint script)、`.github/workflows/ci.yml` |
| FA-25 | P2 | 视觉/a11y/响应式门禁只覆盖 6–7 条路由且桌面优先;`/parameter-home`、配置工作台、`/dts-reload`、`/feedback-admin`、`/node-debugging` 未覆盖;`work/ui-checks/` 证据无机器校验 | `playwright.quality.config.ts`、`e2e/quality/*.quality.spec.ts` |

## 交付阶段

### P0 — 地基:令牌、字体、解冻(分支 `fix/ui-foundation-tokens`)

- [x] 把 18 个测试文件中 47 处 CSS 原文正则断言迁移为行为/DOM 断言或作用域 fixture,使单体可重构(FA-05;共享助手 `src/test/cssAssertions.ts`)。
- [x] 按设计系统定案令牌块:语义色(单一色板;shadcn 键做别名)、字阶、间距、圆角、层次、动效、扩展 z-index 阶梯(FA-01、FA-02、FA-07、FA-08、FA-09 地基)。
- [x] 补定义 16 个被引用未定义的令牌;删除约 29 个死令牌(FA-04;三重验证后删 25 个,其余见 P0 报告)。
- [x] 字体:删除 Google Fonts import;`--font-sans` 以 Geist Variable + CJK 回退链定案;统一 `--font-mono`;字重收敛到 400/500/600/700(FA-03)。
- [x] 以 ADR-0026 记录令牌单一来源决策,并更新 `CONTEXT.md` 词汇(design token、elevation、accent)。
- [x] 基于 `--ring` 的全局 `:focus-visible` 基线;移除 6 处 hover+focus 合并(FA-11 基线)。

### P1 — 原语收敛(分支 `feat/ui-primitives-consolidation`)

- [x] 一个 Button:基础几何 + 变体/尺寸落地;收编 42 个作用域覆写(145 个规则块 → 基础层 + 约 50 个纯布局/功能块);黑/藏青/青绿一次性用色迁入令牌(FA-10、FA-19 点名点位;`#111827` 归零)。
- [x] 一个 Dialog:24 个文件 35 个手写遮罩弹窗全部迁入 `ModalDialog`/`ConfirmDialog`(零保留);`window.confirm` 归零;遮罩统一变暗 + 令牌化入场动效(含 reduced-motion 回退)(FA-12)。
- [x] 一条 Toast 管线(`src/components/common/toast/`,portal + 队列 + success/info/danger + 悬停暂停,`--z-toast: 1180`);退役 `.logs-feedback-toast` 复制与 `useGovernanceToast`(FA-14)。
- [x] `SectionSkeleton`/`SectionEmpty`/`SectionError` 提升为共享组件 `src/components/common/SectionState.tsx`(parameter-home 转 re-export);`AppShellSkeleton` 取代 API 认证启动期白屏(FA-14、FA-21 部分)。
- [x] 表格收敛第一步:`admin/DataTable` 确立为标准列表外壳,`/user-permissions` 接入(排序/分页/键盘行/筛选空态);撞名的 `workbenchUi.DataTable` 已零消费者,直接删除(FA-13)。
- [x] 死组件与 `App.tsx` 逐字节重复清理(`SectionLabel`/`EmptyState`/`WorkbenchLayout` 去重;`MetricCard` 保留——`MetricBentoCard` 是图表卡,替换等于重设计)。共享组件变体词汇统一为 `variant`(`KpiStrip`、`PageInsightBar`、`AgentInsightBar`、`workbenchUi.Badge`);递延:`MetricBentoCard.severity`(其 `variant` 轴被可视化类型占用)、`ConfirmDialog.tone` 按设计保留(FA-15、FA-16)。

### P2 — 页面缺陷第一波(分支 `fix/ui-page-defects-wave-1`)

- [x] 文案本地化清扫:共享时间格式化(相对/绝对)、百分比格式化(修 `0.91%`)、错误映射层杜绝原始 `error.message`/slug/ISO/代号;替换 `Showing X of Y`、`never`、`Report ID`、英文权限卡与 eyebrow(FA-17、FA-18、FA-21 百分比)。已按 P2a 交付:`src/domain/format/`(`formatRelativeOrAbsolute`/`formatAbsolute`、`formatPercent`/`normalizePercentValue`、`formatLastActive`)、`src/infrastructure/http/presentError.ts`,以及 `src/domain/audit/auditSlugLabels.ts` 的审计 slug 标签(未知 slug 以代码样式渲染);高频页面之外的原始 `error.message` 渲染点(知识库、反馈后台、parameter-admin-next 治理面板、parameter-topology 弹窗)随各自波次处理。
- [x] 布局预算:修复 1440 下 `/parameters` 与项目清单横向溢出(缩减外框留白、次要列进检查器);嵌套 ≤ 2 层(FA-20 桌面、FA-22 双标题)。已按 P2b 交付:移除工作台 h2 块与 `/platform-console` h1(标题归壳层);工作台外层卡片收敛到一层可见卡片(嵌套 ≤ 2);表格预算 1100→680(≤1200:920→640)对齐 surface-mvp 列最小宽;`.param-admin-shell` 双层内边距移除后 1080px 项目清单放得下;1440 实测 `.dts-workbench-list__scroll-x` scrollWidth 866 == clientWidth(原 1100/782),项目清单 1100 == 1100。
- [x] 移动端:<768px 侧边栏改抽屉浮层;恢复用户菜单可达;修一字一行竖排;路由切换重置滚动;着陆页改 SPA 链接(FA-20 移动、FA-22)。已按 P2b 交付:抽屉(translateX + `--z-drawer-backdrop` 遮罩,Escape/遮罩/导航点击关闭,动效令牌 + reduced-motion 回退);769–900px 窄轨完全由 `.sidebar-collapsed` 承担(删除逐字重复的媒体查询);≤900px 用户菜单触发器改纯头像;托盘/表格计数 nowrap;`.main-content` 路由切换重置滚动;着陆页锚点保留 href 但普通左键走 SPA。
- [x] 状态覆盖:`/node-debugging` 与 `/user-permissions` 补加载/空/错误;认证失败路径改为产品语言重试态,不再踢回登录页(FA-21)。已按 P2c 交付:两页在 API 数据装载期渲染共享 `SectionSkeleton`、失败时渲染带重试的 `SectionError`(壳层新增 `debuggingRuntimeStatus`/`userDirectoryStatus`);节点表区分「暂无调试节点」与「筛选无结果」两种空态,演示模式检测失败以 toast 反馈不再静默;`/me` 探测的网络级失败进入全屏 `AppShellConnectionError` 重试态(保留会话令牌),仅鉴权被拒(401 类)才进登录页。
- [x] 种子卫生:演示种子清除/改名测试残留实体;工作台树的原始版本 id 收进标签(FA-23)。已按 P2c 交付:侦察(`FoldRegistryTestDG|fold_registry_test|probe-edit`)确认仓库种子/fixture 无残留——审计所见实体均为共享开发库的运行时写入(schema 晋升 runbook 演示、历史探针会话、e2e 验收 cast),无需改种子或重跑生成器;`reset-quality-runtime.ts` 已覆盖验收账号清理,但未覆盖运行时创建的驱动组模块与上传文件版本(仅报告,不改行为)。工作台源树、画布头与检查器改渲染「版本 v{n}」标签,原始版本 id 降级为 tooltip 或代码样式次要行。
- [x] 看板统一:`/log-dashboard` 卡片改用令牌色与字阶;移除黑条/黑顶边(FA-19 余量)。已按 P2c 交付:看板样式块内全部 hex/rgba 字面量迁入语义令牌(teal 质量色 → `--info` 家族;状态条 `--success`/`--accent`/`--danger`;卡片顶边统一语义状态色或 `--border-strong`);巨号数字与眉标改用 `--text-2xl`/`--text-xs..sm`;进度条/迷你图填充由 `--accent` 派生;`#0f766e/#11a3a3/#0d9488/#14b8a6` 全表归零(`module-tone-5` → `--app-secondary`)。recharts 完整图表主题化(`--chart-*`)留在 P3。

### P3 — 动效与主题就绪(分支 `feat/ui-motion-and-theme`)

- [x] 动效令牌铺开到弹窗/菜单/hover/按压;补齐 `prefers-reduced-motion` 覆盖(FA-09)。已按 P3a 交付:`styles.css`、`linear-template.css`、`parameter-home.css` 内全部 transition/animation 字面量改用 `--duration-fast/base/slow` + `--ease-out`/`--ease-in-out`(hover/按压反馈 fast+ease-out,展开/收起微状态 base+ease-in-out,面板/布局位移 slow);裸 `ease` 关键字归零;小泽弹窗打开 440→400ms(动效规则:UI 过渡不超过 400ms),其自带贝塞尔曲线映射到共享令牌;所有无限循环动画补齐 reduced-motion 守卫(api-runtime-sync 加载圈、日志分析脉冲、两处小泽流式光标、工作台子树之外的 `.dts-status-icon--spin`),死键帧 `xiaoze-reasoning-glow`/`xiaoze-icon-pulse` 删除。
- [x] 图表主题化:recharts 消费 `--chart-*`/`--border`/`--text-muted` 令牌。已按 P3a 交付:分类色带在令牌层批准落地(`--chart-1` 锚定 `--accent`;`--chart-2..5` 为 teal/violet/sky/slate,白底全部 ≥3:1,五个中四个 ≥4.5:1);新增 `src/domain/format/chartTheme.ts` 以 `var()` 引用导出系列色/状态色/网格线/坐标刻度/浮层规格 tooltip 样式,图表随激活主题切换;`UpdateTrendChart` 与 `ProjectRiskChart` 弃用旧调色板变量改走 helper(风险图保留 danger/warning 语义轴),`MetricBentoCard` 的 SVG 迷你图清除硬编码灰,`--risk-*` 别名改由状态/图表令牌派生;色带批准值记录进设计系统《图表》一节。
- [x] 基于语义令牌层的深色主题布线(class 策略 + 持久化),是否上线另行决策。已按 P3b 交付:`.dark` 块从 shadcn 遗留灰阶覆写重写为语义角色的完整暗色派生(slate 系中性色反转;accent 提亮一档至 `#4c8dff`,accent/danger 填充上的 `--primary-foreground` 翻转为近黑墨色;状态色与 soft 底色改在 `--surface` 上重混;阴影加深;legacy 调色板、小泽与图表令牌全覆盖;颜色字面量仅存在于 `:root`/`.dark`);新增 `src/application/theme/themeController.ts` 切换 `dark` class 与元素级 `color-scheme`,以 `localStorage["wiseeff.theme"]` 持久化 light|dark|system 三态,`system` 态跟随 `prefers-color-scheme`,上线决策前默认 light,暴露 `window.__wiseeffSetTheme` dev 探针(无用户可见开关;9 个单测锁定切换/持久化/系统跟随/销毁)。五个界面的暗色走查(/parameter-home、/parameters、/log-dashboard、/user-permissions、添加用户 ModalDialog;light/dark 证据在 `work/ui-checks/aesthetics-uplift-p3/`)顺带令牌化走查页面的浅色字面量残留——壳层 chrome 收进作用域令牌 `--shell-*`/`--feedback-entry-*`、工作台表格与 module-tone 徽章、共享弹窗遮罩改用新 `--backdrop-dim`(旧的 `var(--text)` 派生遮罩在暗色下翻白)——light 模式视觉保持不变。

### P4 — 让标准长牙的门禁(分支 `feat/ui-quality-gates`)

- [x] `npm run ui:check` 脚本:对令牌块之外的裸颜色、裸 `z-index`、裸 `font-size`、`window.confirm`、新增 `modal-backdrop` div 直接失败;接入 CI(FA-24)。P4 第一波交付:`scripts/check-ui-standards.ts` + `scripts/ui-standards-baseline.json` + `scripts/check-ui-standards.test.ts`(经 `npm run test:scripts` 运行)。八条规则独立计数;因 P3 正在并行分支持续减少样式字面量,门禁采用棘轮模型锁住诚实存量而非假设为零:raw-color 1852、raw-font-size 977、raw-shadow 147、ease-keyword 105、raw-z-index 76(CSS 74 + `ColumnFilter.tsx` 2),window-confirm / hand-rolled-backdrop / english-chrome 基线为 0、从第一天起硬禁止。计数超基线即失败并打印 文件:行号 与设计系统章节指引;低于基线提示 `--update-baseline` 下调;全量扫描约 0.5s(逐行状态机,`:root`/`.dark`/`@theme` 令牌块豁免)。已接入 `build-and-test`,与 docs:check 相邻。
- [x] ESLint + `jsx-a11y` + `react-hooks`(作用域化,防新增欠账;存量逐步清偿)。P4 第一波交付:eslint 9 flat config(`eslint.config.js`)作用于 `src/**/*.{ts,tsx}`(含测试),两套 recommended 全量启用;零违规规则设 error,有存量的 19 条规则设 warn 并在配置内记录 2026-08-13 当日计数(共 297 条 warning;最大项:`react-hooks/set-state-in-effect` 135、`react-hooks/refs` 32、`jsx-a11y/label-has-associated-control` 27)。`npm run lint`(全量约 10s,启用 `--cache`)已接入 CI;error 阻断、warn 不阻断。
- [ ] 视觉/a11y/响应式质量 spec 扩展到 `/parameter-home`、配置工作台、`/dts-reload`、`/feedback-admin`、`/node-debugging`;为 Button/Dialog/Table 增加 hover/focus 状态快照(FA-25)。
- [ ] 更新 `docs/QUALITY_SCORE.md` 与 `docs/developer/verification-matrix.md`(含中文镜像)纳入新门禁。

## 成功标准

- P1 后 `src/styles.css` 颜色/圆角/阴影/z-index 声明的令牌渗透率 ≥ 70%;新代码经 `ui:check` 达 100%。
- 令牌块之外的颜色字面量:0(P4 门禁强制)。
- 一套按钮实现;作用域级 `.button` 几何覆写为 0。
- 手写弹窗遮罩为 0;`window.confirm` 为 0。
- 可交互原语 100% 定义五态;全局焦点环可见。
- 25 条路由复查零原始英文/slug/ISO/调试文案(以重跑走查为证据)。
- 1440 下主表格无横向滚动;390 下抽屉侧边栏 + 用户菜单可达。
- CI 跑通 `ui:check` + 扩展后的质量 spec。

## 关键接缝

- 令牌块:`src/styles.css` 的 `:root`(P0 后单块)+ `@theme inline` 别名。
- 原语:`src/components/ui/button.tsx`、`src/components/common/ModalDialog.tsx`、`src/components/admin/DataTable.tsx`、新增 `src/components/common/toast/*`、提升后的 `SectionState`。
- 格式化:新增 `src/domain/format/`(时间、百分比)+ `src/infrastructure/http/` 客户端错误映射。
- 门禁脚本:`scripts/check-ui-standards.ts` + `scripts/ui-standards-baseline.json` + `.github/workflows/ci.yml`。

## UI interaction coverage

本计划改变可见外观但不得改变工作流语义。按 UI Interaction Automation Rule:每个阶段 PR 都要复核所触路由在 `docs/developer/browser-acceptance-coverage-map.md` 的 requirement ID 与 `docs/developer/user-operation-coverage-matrix.md` 的 operation ID,并保持 `npm run acceptance:browser` / `npm run acceptance:evidence` 通过。已知受外观变更影响的 spec:`e2e/quality/visual.quality.spec.ts`(按阶段评审快照刷新)、`e2e/quality/a11y.quality.spec.ts`、`e2e/quality/responsive.quality.spec.ts`,以及 P1 迁移弹窗时相关验收 spec(如 `PROJ-CONFIG-*`、`PARAM-*` 弹窗流)。视觉快照刷新必须在 PR 中做前后对比评审,不得盲目重新生成。行为有变而缺 ID 时,先补 ID 再实现(如移动端抽屉导航)。

## 验证

```bash
npm test
npm run build
npm run docs:check
npm run acceptance:a11y
npm run acceptance:visual
npm run acceptance:responsive
# 各阶段浏览器证据: work/ui-checks/aesthetics-uplift-p{N}/
```

审计基线证据:`work/ui-checks/01-*.png` … `21-*.png`(2026-08-12 走查)。

## Documentation Impact Matrix

| Area | Action | Paths |
| --- | --- | --- |
| Repository maps | Update | `AGENTS.md` + `docs/zh-CN/root/AGENTS.md`(指向设计系统与检查清单——随本计划完成) |
| Planning | Update | `docs/PLANS.md` + `docs/zh-CN/PLANS.md`(活跃计划条目——已完成);本计划 + 中文伴侣 |
| Product specs | No change | 仅视觉执行;产品行为不变 |
| Architecture / ADR | Update | P0 新 ADR(令牌单一来源);`CONTEXT.md` 词汇;`docs/adr/README.md` |
| Frontend / design docs | Update | `docs/design-docs/ui-design-system.md` + zh(新建,已完成);`docs/design-docs/index.md` + zh(加行——已完成);`docs/FRONTEND.md` + `docs/zh-CN/frontend.md`(加节——已完成);`docs/DESIGN.md`(加指针——已完成) |
| Quality / testing | Update | `docs/developer/ui-quality-checklist.md` + zh(新建,已完成);`docs/QUALITY_SCORE.md` + zh 与 `docs/developer/verification-matrix.md` + zh(P4 门禁落地时) |
| Security / governance | No change | 无 authz/audit 面变化 |
| Reliability / runbooks | No change | 无运行时/运维变化 |
| Generated artifacts | No change | 无 schema/contract 变化 |
| References | Review | `docs/references/design-system-reference-llms.txt`(P0 与定案令牌对齐) |
| Tech debt | Update | 递延发现登记 `docs/exec-plans/tech-debt-tracker.md` + zh |

## Documentation Update Gate

- [x] `docs/design-docs/ui-design-system.md` + 中文伴侣创建,并从 `docs/design-docs/index.md`(+ zh)、`docs/FRONTEND.md`(+ zh)、`docs/DESIGN.md`、`AGENTS.md`(+ zh)接入
- [x] `docs/developer/ui-quality-checklist.md` + 中文伴侣创建,并登记进 `scripts/bilingual-docs.ts`
- [x] `docs/PLANS.md` + `docs/zh-CN/PLANS.md` 列入本计划
- [x] P0:ADR-0026 记录;`CONTEXT.md` + `docs/adr/README.md` 更新;`design-system-reference-llms.txt` 对齐;TD-080/TD-081 登记
- [ ] P4:`docs/QUALITY_SCORE.md` + zh 与 `docs/developer/verification-matrix.md` + zh 描述 `ui:check` 与扩展质量 spec
- [ ] 递延发现登记 `docs/exec-plans/tech-debt-tracker.md` + zh
- [ ] 移入 `completed/` 前 `npm run docs:check` 通过
