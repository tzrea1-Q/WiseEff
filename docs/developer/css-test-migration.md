# CSS Test Migration (#1175)

> Chinese: [Chinese](../zh-CN/developer/css-test-migration.md)

## Scope

Baseline: `1e8923061189793280a50e1a007d25068b916c80`. The inventory records 97 tests containing declaration assertions reviewed for migration, plus one source-order test. Mixed RTL tests keep behavior assertions. T1/T2 are retained policy exclusions, not deleted behavior guarantees. No production stylesheet or component changes.

Replacements live in `e2e/quality/styles.consistency.collector.spec.ts`, discovered by the existing consistency project in both consistency partitions. `e2e/quality/quality-partition.ts` assigns successive fixture registrations alternately to consistency-1 and consistency-2 (16 and 15 tests respectively); an unset lane registers all 31. `scripts/quality-partition.test.ts` checks the actual Playwright registration union for exactly-once coverage and balanced lane sizes, including every stylesheet fixture. Most load real Vite CSS in same-origin isolated HTML and observe browser geometry, actual scrolling, visibility and hit testing instead of declaration spelling. R29 uses the real app shell and drawer controls with the existing consistency read guard. Default viewport: 1440×900; compact viewports reproduce only breakpoints already covered by migrated tests. Isolated fixtures are not real component mounting or API acceptance; existing RTL and live-route quality/acceptance remain required.

Fixture readiness requests reduced motion and waits for fonts, a painted frame and finite animations to finish. Footer checks assert separation from the scrolled body, containment within the card/viewport and no more than 2px vertical movement. Sticky identity columns are checked against their scrollport's 0px/48px anchors at two real horizontal scroll offsets, not their unscrolled natural positions. The wizard fixture separately exercises the bounded table scrollport and overflowing main body; neither may move the footer out of view.

The real-shell check requires the quality runtime's standard seeded users. It retains the consistency read guard and fulfills the unrelated proactive Xiaoze suggestion request with an empty suggestion list, rather than allowing a backend write or ignoring blocked requests.

Fixture responses explicitly declare UTF-8, preserving the real Chinese accessible names. R16 uses the component's status container/test ID and actual Chinese trigger name, so dialog-hidden hints remain addressable for pointer-event assertions; the exposed footer action must receive a click. R22 uses the real `timeline submission-timeline` structure to check five equal tracks without assuming step-label row alignment, and measures inspector-action/code separation plus code hit testing after page scrolling. The unified inbox intentionally leaves review code unbounded; the history previews separately exercise their bounded scrollports. R23 checks the search wrapper and filter against `--space-8`, and the borderless input against the wrapper's inner height (30px inside the 32px bordered control). R25 treats computed `normal` and `0px` letter spacing as equivalent zero extra spacing, and measures the 4px hover lift in document coordinates so Playwright's automatic scroll cannot change the result. R29 signs in with the existing acceptance helper, collapses the real sidebar, opens the narrow drawer with its accessible toggle and clicks a visible navigation item to close it; it never simulates opening by setting shell classes.

## Replacement Key And Defect Classes

Each test name describes its preserved defect class.

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

- **DTS detail (consistency-1) / compare (consistency-2)**: `portaled DTS ${kind} card keeps its footer visible while the body scrolls`; card bounds/chrome, actual content scrolling and stationary footer.
- **T1**: retain root-token and three-action-track token linkage assertions.
- **T2**: retain token scans; check raw font shorthand lengths over parsed rules.

## Per-Test Inventory

Original titles enable source lookup. Each replacement key names its preserved defect class. Parameterized cases use the same mapping.

| Original test file | Original test title | Replacement / retention |
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

## Retained Guarantees And Guard

- Mixed RTL tests keep roles, full tooltip text, filtering, events and content checks.
- Numerical contrast after token resolution remains in `src/contrast.styles.test.ts` and `src/rawLogViewer.styles.test.ts`; rail focus contrast checks remain too.
- Literal parser fixtures in `src/test/cssAssertions.test.ts`, `scanCssContent`, type-scale policy, token references and root custom properties remain. `scripts/overview-styles.test.ts` still checks raw-length policy across entire stylesheets including logs.
- `src/features/agent/XiaozeApprovalCard.styles.test.ts` retains stacking-token ordering and ownership; R17 additionally checks actual hit testing.
- `hasRule` / `hasAtRule` source ownership and retired-selector policy remain, but do not establish rendered layout.
- ESLint `wiseeff/no-raw-css-text-assertions` covers src/scripts TS/TSX tests, rejecting direct CSS text, parsed declarations, imported aliases, raw imports and common derived string/numeric assertions while retaining tokens and semantic scan results. It is bounded dataflow, not whole-program analysis. New helper wrappers still require review and must not bypass policy.

## Coordinator Acceptance

The implementer runs only focused Vitest, final related, changed-file ESLint and the two TypeScript project checks. Browser fixtures require coordinator execution; this inventory is not a passing runtime receipt.

```sh
npx playwright test --config playwright.quality.config.ts --project consistency e2e/quality/styles.consistency.collector.spec.ts
```

The coordinator also runs existing Playwright quality/acceptance, `ui:check`, full Vitest, build, repository lint, docs/contract/boundary and PR CI. Review screenshots of real wizard/parameter tables, topology/catalog/configuration, review/history, feedback, homepage/sidebar, Bridge/debugging and Xiaoze overlays at default PC 1440×900. No Linux screenshot baselines are regenerated and no production appearance intentionally changes. Green PR CI remains outstanding.
