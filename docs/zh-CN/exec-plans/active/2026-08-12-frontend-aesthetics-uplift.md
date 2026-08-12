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
- [x] 以 ADR-0025 记录令牌单一来源决策,并更新 `CONTEXT.md` 词汇(design token、elevation、accent)。
- [x] 基于 `--ring` 的全局 `:focus-visible` 基线;移除 6 处 hover+focus 合并(FA-11 基线)。

### P1 — 原语收敛(分支 `feat/ui-primitives-consolidation`)

- [ ] 一个 Button:按规范落基础几何 + 变体/尺寸;收编 42 个作用域覆写;黑/藏青一次性按钮迁到 `primary`/`secondary`(FA-10、FA-19 部分)。
- [ ] 一个 Dialog:约 30 个手写遮罩迁到 `ModalDialog`/`ConfirmDialog`;删除 `window.confirm`;补遮罩与进出场动效(FA-12)。
- [ ] 一条 Toast 管线(portal、队列、语气);退役 `.logs-feedback-toast` 复制与死代码 `.undo-toast`(FA-14)。
- [ ] 把 `parameter-home` 的 `SectionSkeleton`/`SectionEmpty`/`SectionError` 提升为共享组件;应用启动壳骨架替代白屏(FA-14、FA-21 部分)。
- [ ] 表格收敛第一步:确立 `admin/DataTable` 为标准外壳,重命名 `workbenchUi` 同名冲突,再接入 2–3 个列表页(FA-13)。
- [ ] 删除死组件与 `App.tsx` 逐字节重复;共享实现抽到 `src/components`(FA-15)。变体词汇统一为 `variant` + `size`(FA-16)。

### P2 — 页面缺陷第一波(分支 `fix/ui-page-defects-wave-1`)

- [ ] 文案本地化清扫:共享时间格式化(相对/绝对)、百分比格式化(修 `0.91%`)、错误映射层杜绝原始 `error.message`/slug/ISO/代号;替换 `Showing X of Y`、`never`、`Report ID`、英文权限卡与 eyebrow(FA-17、FA-18、FA-21 百分比)。
- [ ] 布局预算:修复 1440 下 `/parameters` 与项目清单横向溢出(缩减外框留白、次要列进检查器);嵌套 ≤ 2 层(FA-20 桌面、FA-22 双标题)。
- [ ] 移动端:<768px 侧边栏改抽屉浮层;恢复用户菜单可达;修一字一行竖排;路由切换重置滚动;着陆页改 SPA 链接(FA-20 移动、FA-22)。
- [ ] 状态覆盖:`/node-debugging` 与 `/user-permissions` 补加载/空/错误;认证失败路径改为产品语言重试态,不再踢回登录页(FA-21)。
- [ ] 种子卫生:演示种子清除/改名测试残留实体;工作台树的原始版本 id 收进标签(FA-23)。
- [ ] 看板统一:`/log-dashboard` 卡片改用令牌色与字阶;移除黑条/黑顶边(FA-19 余量)。

### P3 — 动效与主题就绪(分支 `feat/ui-motion-and-theme`)

- [ ] 动效令牌铺开到弹窗/菜单/hover/按压;补齐 `prefers-reduced-motion` 覆盖(FA-09)。
- [ ] 图表主题化:recharts 消费 `--chart-*`/`--border`/`--text-muted` 令牌。
- [ ] 基于语义令牌层的深色主题布线(class 策略 + 持久化),是否上线另行决策。

### P4 — 让标准长牙的门禁(分支 `feat/ui-quality-gates`)

- [ ] `npm run ui:check` 脚本:对令牌块之外的裸颜色、裸 `z-index`、裸 `font-size`、`window.confirm`、新增 `modal-backdrop` div 直接失败;接入 CI(FA-24)。
- [ ] ESLint + `jsx-a11y` + `react-hooks`(作用域化,防新增欠账;存量逐步清偿)。
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
- 门禁脚本:`scripts/check-ui-tokens.ts`(名称待定)+ `.github/workflows/ci.yml`。

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
- [x] P0:ADR-0025 记录;`CONTEXT.md` + `docs/adr/README.md` 更新;`design-system-reference-llms.txt` 对齐;TD-070/TD-071 登记
- [ ] P4:`docs/QUALITY_SCORE.md` + zh 与 `docs/developer/verification-matrix.md` + zh 描述 `ui:check` 与扩展质量 spec
- [ ] 递延发现登记 `docs/exec-plans/tech-debt-tracker.md` + zh
- [ ] 移入 `completed/` 前 `npm run docs:check` 通过
