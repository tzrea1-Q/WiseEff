# UI 质量检查清单

> English: [English](../../developer/ui-quality-checklist.md)

这是所有前端可见变更的完成门禁。它把 [`docs/zh-CN/design-docs/ui-design-system.md`](../design-docs/ui-design-system.md) 与 `AGENTS.md` 的浏览器验证规则落成逐条可执行的检查。前端可见变更在通过下述全部门禁（或显式上报阻塞）之前,**不允许宣称完成**。

适用范围:UI、布局、样式、交互、路由、组件、表单、弹窗、表格、动画、响应式行为、design tokens、公共资源或可见 UI 文案的变更。

## 1. 动手前

- [ ] 通读 [`docs/zh-CN/design-docs/ui-design-system.md`](../design-docs/ui-design-system.md)（令牌、组件标准、反模式）与受影响界面对应的 [`docs/FRONTEND.md`](../../FRONTEND.md) 章节。
- [ ] 先盘点既有原语:`ModalDialog`/`ConfirmDialog`、`src/components/ui/*`、`ColumnFilter`、`DataTable`、`SectionState`、`ModuleTreeSelect`、`WorkbenchSheet`。已有原语时不得新造,只能扩展规范实现。
- [ ] 预先设计全部状态:加载、空、错误（带重试）、禁用（带原因）,以及所有可点击元素的五种交互状态。
- [ ] 若变更影响用户可见交互行为,先确定受影响的 `e2e/acceptance/` spec、[`browser-acceptance-coverage-map.md`](../../developer/browser-acceptance-coverage-map.md) 的 requirement ID 与 [`user-operation-coverage-matrix.md`](../../developer/user-operation-coverage-matrix.md) 的 operation ID。

## 2. 开发中的硬规则

| 规则 | 快速自检 |
| --- | --- |
| 视觉取值只来自令牌 | `git diff` 中没有新增 hex/rgb/oklch、裸 `z-index`、裸 `font-size`、令牌块之外发明的 `box-shadow` |
| 只有一个 accent | 没有新增黑色/青绿/脱板实心控件;每个视图只有一个主按钮 |
| 五种交互状态 | rest / hover / active / focus-visible / disabled 全部定义;异步操作有尺寸稳定的 loading 态 |
| 焦点不可破坏 | 没有无替代的 `outline: none`;hover 与 focus-visible 可区分 |
| 弹窗走共享契约 | `ModalDialog`/`ConfirmDialog`（或既有 `ui/dialog` 封装）;不手写遮罩 `div`,不用 `window.confirm`;遮罩 + Escape + 焦点陷阱验证通过 |
| 表格遵循表格标准 | 表头吸顶、分类筛选用 `ColumnFilter`、`aria-sort`、行可键盘激活、1440 下不因外框留白横向滚动 |
| 产品语言中文优先 | 无原始英文片段、错误串、slug、ISO 时间戳、内部代号;错误映射为产品文案;日期与百分比走共享格式化函数 |
| 间距落在 4px 栅格 | 新增 padding/gap/margin 只取 4、8、12、16、20、24、32、40、48、64 |
| 动效使用令牌 | 时长/缓动来自 `--duration-*`/`--ease-*`;不用 `ease` 关键字;循环动画有 `prefers-reduced-motion` 守护 |
| 可访问性基础 | 所有输入有 label;错误用 `aria-describedby` 关联;可交互行/卡片键盘可达;对比度 ≥ 4.5:1 |

## 3. 完成定义门禁

宣称完成前全部执行:

```bash
npm test -- <目标测试文件>
npm run ui:check
npm run build
```

然后用 `playwright-cli` 做真实浏览器走查（强制;无法运行时必须停下上报阻塞）:

1. 启动应用（通常 `npm run dev`）,访问每个受影响页面或路由。
2. 至少验证三档视口:`1440x900`、`768x1024`、`390x844`。
3. 每个相关页面同时执行 `snapshot` 与 `screenshot`;截图存放在 `work/ui-checks/<topic>/`。
4. 每个访问过的页面检查 `console error`;变更影响加载、数据流、提交或错误处理时检查网络请求。
5. 演练真实交互:点击、输入、提交、开关弹窗与菜单、用键盘 hover/focus 控件,并在可达范围内触发加载、空、错误状态。

对每张截图做布局检查:

- [ ] 无元素重叠、文字溢出、按钮文案截断、控件被挤压。
- [ ] 任何测试视口下无意外横向滚动。
- [ ] 窄列中没有一字一行的竖排折行。
- [ ] 浮层（助手气泡、toast、弹窗）不遮挡主操作或正在阅读的内容。
- [ ] 视觉层级正确:一个页面标题（来自 TopBar）、其下为分区标题、一个主操作。

## 4. 自评量表

对照最终截图逐行打通过/不通过。任何一行不通过即视为未完成。

| # | 检查项 |
| --- | --- |
| 1 | 每个视觉取值都能追溯到令牌（抽查 diff） |
| 2 | 可交互元素有可见的 hover 和按压反馈 |
| 3 | 所有触达的可交互元素键盘焦点环可见 |
| 4 | 禁用控件能看出禁用原因 |
| 5 | 加载、空、错误状态齐全且符合共享词汇 |
| 6 | 页面上没有任何原始英文、slug、ISO 时间戳、调试文案 |
| 7 | 数字、日期、百分比经共享格式化函数输出 |
| 8 | 弹窗:遮罩变暗、Escape 关最顶层、焦点归还触发元素 |
| 9 | 390px:侧边栏按规范收敛为抽屉/窄轨、用户菜单可达、无断裂列 |
| 10 | 没有复制既有原语的一次性变体 |
| 11 | 卡片可见嵌套最多两层;无双重页面标题 |
| 12 | 所有访问页面 console 零错误 |

## 5. 必附证据

前端可见工作的最终回复与 PR 描述必须包含:

- 测试的本地 URL 或路由,以及所用 runtime mode。
- 测试过的视口与演练过的交互。
- `work/ui-checks/<topic>/` 下的截图路径。
- console/网络检查结果。
- 发现并修复的问题,或明确注明未发现问题。
- 交互行为变更:按 [`docs/zh-CN/PLANS.md`](../PLANS.md) 的 UI Interaction Automation Rule,列出复核过的验收 spec、requirement ID 与 operation ID。

## 6. 评审人检查单

评审人应拒绝以下前端变更:

- 引入裸视觉字面量、并行原语或新的 z-index 数字。
- 任何可交互元素缺 hover/active/focus-visible/disabled。
- 在产品 UI 中渲染原始错误或英文片段。
- 缺少三视口浏览器走查证据。
- 使覆盖路由的质量门禁回退:`npm run acceptance:a11y`、`npm run acceptance:visual`、`npm run acceptance:responsive`。
