# 参数管理后台 UX 打磨

> Status: **进行中** — 三批已在 `feat/parameter-admin-ux-polish` 落地，待父代理评审 / 开 PR
> Date: 2026-08-02
> English: [`docs/exec-plans/active/2026-08-02-parameter-admin-ux-polish.md`](../../../exec-plans/active/2026-08-02-parameter-admin-ux-polish.md)
> 信息架构：[ADR-0001](../../../adr/0001-parameter-admin-organized-by-governance-scope.md)
> 列筛选约定：[`docs/design-docs/ux-table-column-filter.md`](../../../design-docs/ux-table-column-filter.md)

> **2026-08-06 产品方向：** 本计划中的项目清单和确凿缺陷修复继续有效，但四视图/弹窗不再是目标信息架构。已锁定的[项目配置工作台设计](../../../design-docs/2026-08-06-project-configuration-workbench-design.md)将其替换为一个以配置集与源码为中心的全屏工作区；第二、三批不能继续作为未来项目运营呈现合同。

## 背景

ADR-0001 的治理作用域信息架构已经落地：组织配置与项目运营平级、项目视图可深链、后台状态收在 `ParameterAdminProvider`。2026-08-02 以 Admin（`xu.yun`，API 模式）在 1440×900 / 768×1024 / 390×844 走查全部六个视图，控制台无报错，但发现一处移动端硬性布局故障、一处列筛选挂错列、结构浏览页的层叠破损，以及四个项目 tab 各用一套视觉语言。

本计划记录这些发现并排定修复顺序，不重开 ADR-0001 的架构决策。

## 目标

1. **第一批（确凿缺陷）** — 修移动端表格破损、列筛选错位、结构浏览层叠，以及削弱可靠性的 ARIA 与一致性缺口。
2. **第二批（视觉语言）** — 让四个项目 tab 共用一套容器与分组语言、一套空态范式，并让两级导航读得出层级。
3. **第三批（信息架构）** — 消除四重标题重复、给项目清单加治理信号、修正参数文件页的信息顺序。

## 非目标

- 重开 ADR-0001 的组织/项目平级架构。
- 参数治理 D1–D8 与归属 D-AG-*（各有归属计划）。
- 批量导入向导积压、审计中心 M2/M3、TD-042 cutover 彩排。

## Git & PR

分支：`feat/parameter-admin-ux-polish`。实现方只在该分支提交；父代理评审、开合 PR 并同步 `main`。第二、三批可在第一批合入后从 `main` 另起分支。

## 发现摘要

**第一批（缺陷）—— 已落地**

- `PA-D1` 项目清单桌面列宽规则已包进 `min-width: 961px`，并覆盖 `.parameters-table-scroll > table { min-width: 720px }`，≤960px 卡片布局下状态/计数/最近更新/操作完整可见。
- `PA-D2` 「归属模块」筛选已移到「驱动模块」列头（`ParameterSpecLibrary.tsx`）。
- `PA-D3` 结构浏览副标题与属性元数据改用 `--app-muted`，详情区独立卡片避免压住节点列表。
- `PA-D4` 项目视图改为 `nav` + `aria-current="page"`，与组织子导航一致。
- `PA-D5` 规格库表增加 `aria-label="参数定义库列表"`。
- `PA-D6` 「待审核」改为 `.param-admin-queue-summary`，去掉内联 style。
- `PA-D7` `title`/`subtitle`/`regionLabel` 合并进 `PROJECT_VIEW_META`。
- `PA-D8` 去掉 `as PrototypeState`；缺 state/dispatch 时显式报错。

**第二批（视觉语言）—— 已落地**

- `PA-V1` 四个项目 tab 共用 `.param-admin-panel` / `.param-admin-panel__section`。
- `PA-V2` `ParamAdminEmptyState` 用于节点对应确认、冲突裁决、定义匹配审核空队列与参数文件空列表。
- `PA-V3` 作用域导航改为 `.parameter-admin-scope-nav`（实心主色），组织子导航保持轻量 pill。
- `PA-V4` TopBar 操作按钮在 ≤900px 收紧；规格库表头 `white-space: nowrap`，审核状态列设 `min-width`。

**第三批（信息架构）—— 已落地**

- `PA-A1` 去掉正文重复的「项目运营」标题；权威标题为「项目清单」，TopBar 副标题按清单/深链视图区分。
- `PA-A2` 项目清单新增「冲突」「基线」列；API `ProjectAdminSummaryDto` 增加 `openConflictCount` / `releasedBaselineCount`（状态列继续承载待审阅）。
- `PA-A3` 参数文件页改为先文件列表、后结构化检索；文案区分检索与「结构浏览」。
- `PA-A4` 桌面行高收紧（`padding-block: 8px`），取消清单滚动高度上限，列对齐覆盖新增列。

## 文档影响与验证

完整的交付清单、文档影响矩阵、文档更新门禁与 UI 交互覆盖要求以英文计划为准。中文侧需同步更新的文件：`docs/zh-CN/PLANS.md`、`docs/zh-CN/FRONTEND.md`、`docs/zh-CN/developer/browser-acceptance-coverage-map.md`、`docs/zh-CN/developer/user-operation-coverage-matrix.md`。

```bash
npm test -- src/ParameterAdminNextPage.test.tsx src/ParameterAdminNextPage.a11y.test.tsx
npm run build
npm run docs:check
```
