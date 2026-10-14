# CSS 测试迁移（#1175）

> English: [English](../../developer/css-test-migration.md)

## 范围

基线为 `1e8923061189793280a50e1a007d25068b916c80`。清单记录 97 个含待审声明断言的测试，以及一个源码顺序测试。混合 RTL 测试保留行为断言；T1/T2 是保留策略，不是删除的行为保证。生产样式及组件没有变更。

替代测试位于 `e2e/quality/styles.consistency.collector.spec.ts`，由现有 consistency 项目在两个 consistency 分片中发现。`e2e/quality/quality-partition.ts` 按固定注册顺序交替分配到 consistency-1 和 consistency-2（分别 16、15 个测试）；未设置分片时注册全部 31 个。`scripts/quality-partition.test.ts` 检查实际 Playwright 注册结果，确保每个样式固定样本恰好执行一次，并保持分片数量均衡。多数测试在同源隔离 HTML 中加载真实 Vite CSS，检查浏览器布局、实际滚动、可见性及命中，不依赖源码声明拼写。R29 使用真实应用外壳和抽屉控件，并安装现有 consistency 只读保护。默认 1440×900；窄窗口仅复现原测试已有断点。隔离固定样本不能证明真实组件挂载或 API 验收，原有 RTL、真实路由 quality / acceptance 仍需执行。

固定样本就绪阶段请求减少动态效果，并等待字体、绘制帧及有限动画结束。页脚检查验证它与滚动内容分离、位于卡片及视口内，且竖直移动不超过 2px。固定标识列在两个实际横向滚动位置相对滚动容器的 0px/48px 锚点验证，不再比较未滚动时的自然位置。向导固定样本分别触发表格滚动及外层主内容溢出，二者均不得使页脚离开视口。

真实外壳检查依赖 quality 运行时的标准种子用户。它保留 consistency 只读保护，将无关的小泽主动建议请求替换为空建议列表，不放行后端写入，也不忽略被阻止的请求。

固定样本响应显式声明 UTF-8，保留真实中文无障碍名称。R16 使用组件的状态容器、测试 ID 及真实中文触发名称，确保对话框隐藏提示后仍能验证其指针事件；暴露的页脚操作必须收到点击。R22 使用真实 `timeline submission-timeline` 结构验证五个等宽轨道，不假设步骤标签同一行，并在页面滚动后检查审阅操作与代码区域分离以及代码命中。统一收件箱中的审阅代码按设计不限制高度；历史预览另行验证受限滚动区域。R23 将搜索外框和筛选控件与 `--space-8` 对照，将无边框输入框与外框内高对照（32px 带边框控件内为 30px）。R25 将计算后的 `normal` 与 `0px` 字距视为等价的零额外间距，并使用文档坐标验证悬停上移 4px，避免 Playwright 自动滚动干扰结果。R29 使用现有验收辅助函数登录，通过真实控件收起侧边栏、打开窄窗口抽屉，再点击可见导航项关闭抽屉，不再通过直接修改外壳类名模拟打开。

## 替代索引与缺陷类别

测试名称说明保留的缺陷类别；下面保留英文名称以便精确检索。

- **R01**: `topbar search fits its control and the compact project selector fits its parent` — consistency-1.
- **R02**: `Bridge readiness wraps without overflow and stacks at the existing narrow breakpoint` — consistency-2.
- **R03**: `Bridge guide is a right-edge scrollable drawer without an opaque workbench scrim` — consistency-1.
- **R04**: `debugging installation context and multiline values cannot push task rows out of view` — consistency-2.
- **R05**: `portaled governance confirmation has visible actions, separated content and a pinned footer (TD-084)` — consistency-1.
- **R06**: `history diff uses the large dialog tier and readable title at desktop and compact widths` — consistency-2.
- **R07**: `module editing sections are separated and driver fields fill two columns then stack` — consistency-1.
- **R08**: `the portaled module menu stays on top and its items do not wrap` — consistency-2.
- **R09**: `reload candidate operation track stays compact and centers its action` — consistency-1.
- **R10**: `shared table scrollports keep readable floors and portaled filters escape clipping` — consistency-2.
- **R11**: `parameter table fits desktop, pins identity columns on scroll and wraps long names and values` — consistency-1.
- **R12**: `admin list preserves its gutter, action space, desktop rail and narrow card labels` — consistency-2.
- **R13**: `wizard keeps long tables readable inside its scrolling main and leaves footer actions visible` — consistency-1.
- **R14**: `feedback dialog keeps two usable columns, its header close slot and bounded screenshot previews` — consistency-2.
- **R15**: `auth registration and structured editors retain scroll, wrapping and visible validation affordances` — consistency-1.
- **R16**: `Xiaoze hints leave footer actions clickable while dialogs are open (TD-091)` — consistency-2.
- **R17**: `approval content is hit-testable above the modeless popup and business modal` — consistency-1.
- **R18**: `shared navigator bounds long labels, preserves counts and gives the task the remaining width` — consistency-2.
- **R19**: `catalog selection does not shift labels and compact tables keep status and actions inside the task` — consistency-1.
- **R20**: `DTS table panes scroll independently, bound identity groups and use cards below their breakpoint` — consistency-2.
- **R21**: `configuration panes fill the routed wrapper and switch inspector between overlay and persistent placement` — consistency-1.
- **R22**: `history and review diff surfaces bound long code without moving inspector actions over it` — consistency-2.
- **R23**: `overview templates keep the shell gutter and settings controls keep their compact geometry` — consistency-1.
- **R24**: `risk tooltip is an overlay and button chrome survives permission, draft and user-management contexts` — consistency-2.
- **R25**: `homepage keeps a light foundation, compact headline and raised entry cards` — consistency-1.
- **R26**: `wizard project information stays two-column while source and scope use the full task width` — consistency-2.
- **R27**: `shared button sizes, view switches, destructive menus and debugging search keep usable chrome` — consistency-1.
- **R28**: `shared library rows wrap long identities, retain selection and scroll inside their task pane` — consistency-2.
- **R29**: `sidebar feedback stays bottom-aligned and the existing compact drawer can reveal navigation` — consistency-1.

- **DTS detail (consistency-1) / compare (consistency-2)**：`portaled DTS ${kind} card keeps its footer visible while the body scrolls`；卡片边界、外观、内容滚动及页脚不移动。
- **T1**：保留根令牌及三操作列令牌关联断言。
- **T2**：保留令牌扫描；font 简写原始长度改为解析规则后检查。

## 逐测试清单

保留原始标题便于源码定位。每个索引说明相同缺陷类别；参数化用例沿用同一对应关系。

| 原测试文件 | 原测试标题 | 替代 / 保留 |
| --- | --- | --- |
| `scripts/overview-styles.test.ts` | preserves the shell gutter on %s | R23 |
| `src/App.test.tsx` | keeps the auth screen scrollable when registration content exceeds the viewport | R15 |
| `src/App.test.tsx` | keeps submission round detail copy to a single prompt line and a single-row timeline | R22 |
| `src/App.test.tsx` | renders complex DTS values in personal submission history without stretching the detail layout | R22 |
| `src/App.test.tsx` | uses the same history card structure for simple values and compacts the submission metrics | R22 |
| `src/App.test.tsx` | combines parameter review filters into the table headers | R22 |
| `src/App.test.tsx` | keeps Excel-style header filters next to their header labels | R22 |
| `src/App.test.tsx` | renders mixed simple and complex review submission details with the history diff layout | R22 |
| `src/App.test.tsx` | provides a left-bottom feedback entry for internal testing feedback | R29 |
| `src/App.test.tsx` | keeps the drawer and rail styles on one owner in the stylesheet | R29 |
| `src/App.test.tsx` | keeps the feedback dialog wide enough for form and screenshot capture columns | R14 |
| `src/App.test.tsx` | keeps the project shared parameter library list breathable and scannable | R28 |
| `src/App.test.tsx` | keeps the debugging admin shell using the parameter-admin main surface layout | R28 |
| `src/NodeDebuggingPage.styles.test.ts` | bounds the first-time Bridge installer so both debugging workbenches keep their task rows in view | R04 |
| `src/NodeDebuggingPage.styles.test.ts` | keeps multiline current values readable inside a bounded preview | R04 |
| `src/ParametersPage.test.tsx` | 用代码预览布局展示复杂 DTS 参数的提交 diff | R22 |
| `src/ProjectParameterInitializationWizard.test.tsx` | styles table filter menus as compact floating panels | R10 |
| `src/ProjectParameterInitializationWizard.test.tsx` | keeps the initialization parameter table columns readable | R13 |
| `src/ProjectParameterInitializationWizard.test.tsx` | keeps footer actions in a stable bottom action bar | R13 |
| `src/ProjectParameterInitializationWizard.test.tsx` | presents the scope step as a full-width stacked layout for the parameter table | R26 |
| `src/ProjectParameterInitializationWizard.test.tsx` | presents the source step as a searchable compact project table | R26 |
| `src/ProjectParameterInitializationWizard.test.tsx` | presents the project information step as a focused two-column form card | R26 |
| `src/UserPermissionsPage.test.tsx` | keeps role selectors wide enough for split committer role names | R24 |
| `src/UserPermissionsPage.test.tsx` | gives user management action buttons visible chrome instead of text-only controls | R24 |
| `src/components/LocalDeviceBridgeWizard.styles.test.ts` | keeps readiness compact and the guide at the right edge without hiding the workbench | R02 |
| `src/components/LocalDeviceBridgeWizard.styles.test.ts` | keeps readiness copy and the launch action in a flexible row | R02 |
| `src/components/LocalDeviceBridgeWizard.styles.test.ts` | stacks the copy and action on narrow screens | R02 |
| `src/components/ParameterDraftDialog.test.tsx` | keeps draft action buttons visually styled as buttons | R24 |
| `src/components/ParametersTable.test.tsx` | keeps sticky columns anchored and gives the search wrapper a focus ring | R11 |
| `src/components/ParametersTable.test.tsx` | does not force desktop horizontal scrolling with a wide table min-width | R11 |
| `src/components/ParametersTable.test.tsx` | lets long DTS-style parameter descriptions wrap inside the name column | R11 |
| `src/components/ParametersTable.test.tsx` | keeps multiline parameter values inside the current-to-recommended column | R11 |
| `src/components/ParametersTable.test.tsx` | keeps column filter menus usable while the table scrolls horizontally | R10 |
| `src/components/ParametersTable.test.tsx` | keeps header filter buttons adjacent to header labels | R11 |
| `src/components/ParametersTable.test.tsx` | turns the parameter table into mobile cards instead of a forced wide grid | R11 |
| `src/components/ParametersTable.test.tsx` | keeps mobile card table values readable beside their labels | R11 |
| `src/components/ParametersTable.test.tsx` | keeps debugging toolbar search from stretching vertically on narrow viewports (TD-107) | R27 |
| `src/components/ProjectRiskBarChart.test.tsx` | keeps the hover tooltip out of normal layout flow | R24 |
| `src/components/admin/DataTable.test.tsx` | keeps data table header filters adjacent to header labels | R10 |
| `src/components/admin/DataTable.test.tsx` | keeps the table scrollport overflow-x auto when header filters are present | R10 |
| `src/components/admin/DebugModuleManagementDialog.styles.test.ts` | styles the portaled menu and its items inside the module dialog | R08 |
| `src/components/admin/ModuleEditDialog.styles.test.ts` | uses a consistent section stack and gives the category picker visible chrome | R07 |
| `src/components/admin/ModuleEditDialog.styles.test.ts` | lays out driver properties as readable full-width fields | R07 |
| `src/components/admin/ModuleEditDialog.styles.test.ts` | stacks driver properties on narrow screens | R07 |
| `src/components/admin/ProjectAdminTable.layout.test.tsx` | uses the tokenized scroll minimum without adding another page gutter | R12 |
| `src/components/admin/ProjectAdminTable.layout.test.tsx` | keeps cells on one line without crushing their content | R12 |
| `src/components/admin/ProjectAdminTable.layout.test.tsx` | bounds long names and reserves content width for actions | R12 |
| `src/components/admin/ProjectAdminTable.layout.test.tsx` | retains the shared visible rail and its keyboard-focus contrast | R12 |
| `src/components/admin/ProjectAdminTable.layout.test.tsx` | preserves the existing mobile card fields without leaking nowrap into them | R12 |
| `src/components/common/ModalDialog.styles.test.ts` | gives the governance confirmation its own spacing instead of inheriting the page's | R05 |
| `src/components/common/ModalDialog.styles.test.ts` | caps confirm dialogs with a scroll region to the viewport and pins the footer (TD-084) | R05 |
| `src/components/layout/AdminListPage.test.tsx` | pins the CI header row and compact search/select height regression | R23 |
| `src/components/parameter-topology/DtsBindingCompareDialog.styles.test.ts` | gives the portaled card its own chrome and pins scroll to the body | DTS compare |
| `src/components/parameter-topology/DtsBindingDetailDialog.styles.test.ts` | gives the portaled card its own chrome and pins scroll to the body | DTS detail |
| `src/components/parameter-topology/DtsBindingHistoryDiffDialog.styles.test.ts` | caps the shared history-diff surface at the lg dialog tier | R06 |
| `src/components/parameter-topology/DtsParameterWorkbench.test.tsx` | bounds long names, keys and node notices to two single-line groups with full tooltips | R20 |
| `src/components/parameter-topology/DtsParameterWorkbench.test.tsx` | keeps the responsive visual contract scoped to the DTS workbench | R20 |
| `src/components/parameter-topology/DtsParameterWorkbench.test.tsx` | reserves the same three-action track in header and rows, with or without draft selection | T1 |
| `src/components/parameter-topology/DtsTopologyNavigator.styles.test.ts` | grows the desktop navigator to its content while keeping labels on one line | R18 |
| `src/components/parameter-topology/DtsTopologyNavigator.styles.test.ts` | uses the full available width below the two-column breakpoint | R18 |
| `src/components/parameter-topology/DtsTopologyNavigator.styles.test.ts` | leaves DTS reload pane geometry to the shared navigator workbench | R18 |
| `src/components/parameter-topology/DtsTopologyNavigator.styles.test.ts` | fits parameter counts in the bounded navigator and ellipsizes only long labels | R18 |
| `src/components/parameter-topology/DtsTopologyNavigator.styles.test.ts` | does not stretch collapsed roots inside the shared navigation slot | R18 |
| `src/components/parameter-topology/ParameterModuleMappingPanel.styles.test.ts` | uses tokens throughout the module governance surfaces and keeps the shell gutter | R12 |
| `src/components/parameter-topology/ProjectTopologyWorkspace.test.tsx` | wraps long binding identity and provenance tokens inside the mobile detail pane | R15 |
| `src/components/parameter-topology/ProjectTopologyWorkspace.test.tsx` | allows topology panes and long locator labels to shrink inside the mobile viewport | R15 |
| `src/components/parameters/StructuredValueEditor.styles.test.ts` | gives the editor's inputs and buttons a visible affordance | R15 |
| `src/components/project-configuration-workbench/ProjectConfigurationWorkbench.test.tsx` | selects the deterministic default Config set and renders working source identities | R21 |
| `src/components/project-configuration-workbench/ProjectConfigurationWorkbench.test.tsx` | owns the project configuration workbench rules next to the feature module | R21 |
| `src/components/ui/view-switch.styles.test.ts` | keeps unselected options flat inside the sunken group | R27 |
| `src/features/agent/XiaozeToggleHint.styles.test.ts` | reserves a non-scrolling shell gutter and keeps the hint beside a left-docked launcher | R16 |
| `src/features/agent/XiaozeToggleHint.styles.test.ts` | disables pointer hit-testing and hides the hint while a dialog is open | R16 |
| `src/features/dts-reload/DtsReloadCandidateTable.styles.test.ts` | keeps the operation column compact and centers its action | R09 |
| `src/features/log-analysis/log-analysis.styles.test.ts` | leaves pane geometry to the shared template and consumes tokens for visual lengths | R18 |
| `src/features/parameter-catalog/parameter-catalog.styles.test.ts` | keeps a usable selection target without introducing padding or selection-border label drift | R19 |
| `src/features/parameter-catalog/parameter-catalog.styles.test.ts` | gives the definition table the main work area beside a bounded module navigator | R19 |
| `src/features/parameter-catalog/parameter-catalog.styles.test.ts` | keeps secondary table cells single-line without shrinking status or actions | R19 |
| `src/features/parameter-catalog/parameter-catalog.styles.test.ts` | fits the first row inside the compact task pane when its content width is below the table floor | R19 |
| `src/features/parameter-catalog/parameter-catalog.styles.test.ts` | keeps narrow-screen navigation and identity text manageable | R19 |
| `src/features/parameter-review/parameterActionPanel.test.tsx` | uses one structural action column without legacy full-width selectors | R22 |
| `src/features/parameter-review/parameterActionPanel.test.tsx` | bounds the unified inbox table and keeps inspector actions out of sticky code overlays | R22 |
| `src/features/parameter-review/parameterActionPanel.test.tsx` | gives history cards a page-scoped single-column rule that outranks the shared card grid | R22 |
| `src/features/product-feedback/FeedbackDialog.styles.test.ts` | keeps the close button in the header's top-right slot | R14 |
| `src/linear-template/lightHomepageTheme.test.ts` | keeps the page foundation light and the three entry cards restrained | R25 |
| `src/linear-template/lightHomepageTheme.test.ts` | keeps the workflow band and footer on light surfaces | R25 |
| `src/linear-template/lightHomepageTheme.test.ts` | keeps the hero headline compact for the shortened homepage | R25 |
| `src/permissionRouting.test.tsx` | keeps the permission denied action from rendering as text-only | R24 |
| `src/test/compactControls.test.tsx` | defines compact select geometry once using the PC tokens | R27 |
| `src/test/consistency.styles.test.ts` | keeps settings forms on token-only styles, one column and the section-title scale | R23 |
| `src/test/consistency.styles.test.ts` | preserves the bounded configuration pane height through the routed content wrapper | R21 |
| `src/test/consistency.styles.test.ts` | positions the configuration inspector as an overlay unless the pane is persistent | R21 |
| `src/test/consistency.styles.test.ts` | keeps entire touched page stylesheets and row actions free of raw visual values | T2 |
| `src/test/consistency.styles.test.ts` | uses one size table for legacy and shared buttons | R27 |
| `src/test/consistency.styles.test.ts` | aligns shell chrome and page roots without a second gutter | R23 |
| `src/test/consistency.styles.test.ts` | uses red text, not a solid destructive fill, in the row menu | R27 |
| `src/topbarStyles.test.ts` | keeps the global search field compact in the topbar | R01 |
| `src/topbarStyles.test.ts` | constrains the project selector to the narrow topbar width | R01 |
| `src/features/parameter-review/parameterActionPanel.test.tsx` | keeps the submission history mobile grid override after its base rule | R22 (900px rendered stacking) |

## 保留保证与防回归规则

- 混合 RTL 测试保留角色、提示完整文本、筛选、事件及内容检查。
- `src/contrast.styles.test.ts`、`src/rawLogViewer.styles.test.ts` 的令牌解析后数值对比度，以及滚动轨焦点对比度检查保留。
- `src/test/cssAssertions.test.ts` 字面量解析器样本、`scanCssContent`、字体比例、令牌引用及根自定义属性保留。`scripts/overview-styles.test.ts` 仍检查完整日志等样式表的原始长度策略。
- `src/features/agent/XiaozeApprovalCard.styles.test.ts` 保留层级令牌顺序及归属检查，R17 另验证实际命中。
- `hasRule` / `hasAtRule` 等源码归属及旧选择器退役策略保留，但不能证明布局。
- ESLint `wiseeff/no-raw-css-text-assertions` 覆盖 src / scripts 的 TS/TSX 测试；拒绝直接 CSS 文本、解析声明、导入别名、raw 导入及常见衍生字符串/数字断言，保留令牌和语义扫描结果。这是有限数据流规则，并非全程序分析；新包装器不能绕过策略，仍需审查。

## 协调者验收

实现者只执行定向 Vitest、最终 related、changed-file ESLint 及两个 TypeScript 项目检查。浏览器用例尚待协调者执行，本清单不是通过证明。

```sh
npx playwright test --config playwright.quality.config.ts --project consistency e2e/quality/styles.consistency.collector.spec.ts
```

协调者还需执行现有 Playwright quality / acceptance、`ui:check`、全量 Vitest、build、仓库 lint、docs/contract/boundary 和 PR CI。真实页面截图复核：向导/参数表、拓扑/目录/配置、审核历史、反馈、首页/侧栏、Bridge/调试及 Xiaoze 弹层。PC 默认 1440×900。不更新 Linux 截图基线，也没有预期生产外观变化。PR CI 通过仍待完成。
