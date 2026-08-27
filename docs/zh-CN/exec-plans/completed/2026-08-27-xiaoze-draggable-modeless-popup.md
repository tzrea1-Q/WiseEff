# 小泽可拖动非模态浮窗

> English: [English](../../../exec-plans/completed/2026-08-27-xiaoze-draggable-modeless-popup.md)

状态：**Completed — 已实现并完成本地验证**
日期：2026-08-27  
Owner 与最终合入批准人：Tzrea1 / `@tzrea1-Q`  
功能分支：`codex/frontend-ui-optimization-20260827`  
工作区：`/Users/tzrea1/Develop/WiseEff-worktrees/frontend-ui-optimization-20260827`  
已集成基线：`80d70f0058c953879598630c09565b57cc47f143`

## 目标

把桌面和平板上已打开的小泽对话窗改造成可拖动的非模态陪伴浮窗。用户移动、缩放小泽时仍可操作下方 WiseEff 页面；同一浏览器保留一份安全布局，并能恢复默认布局。固定入口继续易于发现，手机端继续使用全屏对话。

只有鼠标、触屏、键盘、持久化、视口恢复、非模态焦点、跨路由连续性、业务弹窗层级、小泽审批卡交互、响应式与无障碍全部得到测试及真实浏览器证据后，本计划才算完成。

## 已确认的产品决策

Owner 在设计树的每一轮都采用了推荐答案：

1. 只允许拖动**已打开的对话窗**；圆形小泽入口继续固定在右下角。
2. 桌面和平板（`>=768px`）支持拖动；手机（`<768px`）保持现有全屏形态，不显示拖动把手。
3. 桌面/平板小泽改为**非模态**：对话窗保持打开时，用户可以继续操作下方业务页面。
4. 标题栏中央的小泽品牌区是明确拖动把手；历史、新对话、复位和关闭按钮绝不触发拖动。
5. 整个窗口始终位于带安全边距的可视区内，不做边缘吸附。
6. 点击业务页面不关闭小泽；切换路由时保持展开，并刷新页面上下文。
7. 布局偏离默认值后显示恢复默认位置控件；聚焦拖动把手时按 `Home` 执行同一复位。
8. 业务模态框覆盖非模态小泽并保留其状态；小泽自己的审批卡继续位于小泽之上且可操作。
9. 位置与尺寸共用一个版本化浏览器本地布局记录；同设备刷新和重启浏览器后保留，不做账号/跨设备同步。
10. 缩放把手移到常见的右下角，缩放时保持左上位置不变。
11. 布局保存绝对 CSS 像素坐标；视口或窗口尺寸变化后重新夹取。手机全屏期间不覆盖桌面/平板布局记录。

## 当前代码事实

- `src/features/agent/XiaozePopupView.tsx` 渲染入口、全视口 layer、scrim 与 dialog；当前展开态使用 `aria-modal="true"`，点击外部关闭、恢复焦点，并在路由变化时关闭。
- `src/styles.css` 把桌面/平板 layer 固定为 `right: 1.5rem; bottom: 6rem`；入口是另一个独立 fixed 元素。`768px` 以下为全屏对话。
- `src/features/agent/xiaozePopupLayout.ts` 负责窗口尺寸夹取及 `wiseeff.xiaoze.popup.size.v1` `sessionStorage`，尚无位置模型。
- `src/features/agent/useXiaozePopupResize.ts` 使用原生 Pointer Events、pointer capture 和命令式注入的左上缩放把手；`XiaozePopupChrome.tsx` 是现有 chrome 行为接缝。
- `src/features/agent/XiaozeChatHeader.tsx` 在历史/新对话与关闭操作之间已有中央品牌区。
- 窗口进出动画已经占用 `transform`；拖动位置必须使用 `left`/`top` 或专用 CSS 变量，不能争用 transform。
- 小泽审批内容 portal 到 `body`，依赖声明式审批层与 outside-close 例外；`XIAOZE-APPROVAL-CARD-001` 是强制回归门禁。
- 当前覆盖矩阵没有浮窗移动或非模态页面共存对应的 requirement/operation ID。

## 成功标准

- 在 `1440x900` 和 `768x1024` 下，用户可用鼠标或触屏从专用标题把手拖动小泽，也可使用键盘移动。
- 拖动、缩放、刷新、路由变化、浏览器 resize 或恢复存储数据后，窗口都不会越过安全可视区。
- 点击和输入下方页面时小泽保持打开；切换 WiseEff 路由时保留同一对话并更新页面上下文。
- 在 `390x844` 下，小泽保持全屏，不显示拖动/缩放把手，也不覆盖已保存的桌面/平板布局。
- 同一浏览器刷新后恢复最后提交的 `{x, y, width, height}`；复位回到当前视口的默认右下布局。
- 业务模态框在视觉和交互上覆盖小泽；小泽审批卡继续高于小泽，批准/拒绝不关闭对话。
- pointer cancel、capture 丢失、卸载、路由变化和 resize 后，不残留 cursor、选区锁、animation frame、事件监听或 body class。
- 精确实现树上的鼠标、触屏、键盘、reduced-motion、无障碍、视觉、响应式、构建、文档和验收门禁全部通过。

## 范围

### 范围内

- 一个同时管理位置和尺寸的深层浮窗布局模型。
- 版本化本地持久化，以及从现有仅尺寸 session 记录迁移。
- 通过既有小泽 chrome 接缝实现桌面/平板拖动与缩放。
- 桌面/平板 modal → modeless、焦点/关闭语义、跨路由连续性和层级调整。
- 保留手机全屏形态。
- 恢复默认位置与键盘移动。
- 单元、组件、浏览器验收、视觉、响应式、无障碍和 operation evidence 覆盖。
- 更新中英文 frontend/design/quality 文档，并修正与当前 token 不一致的小泽层级说明。

### 范围外

- 拖动或移动圆形小泽入口。
- 手机可拖浮窗、边缘吸附、磁性停靠、规避任意页面内容或逐路由布局。
- 跨设备或服务端布局同步。
- 多边/八方向缩放。
- 修改小泽对话、模型、tool、审批、持久 provenance 或后端 API。
- 广泛重做 CopilotKit、业务 dialog、toast 基础设施或应用壳。

## 架构

### 1. 单一版本化布局模型

把 `src/features/agent/xiaozePopupLayout.ts` 从尺寸 helper 深化为唯一浮窗布局边界：

```ts
type XiaozePopupLayoutV2 = {
  version: 2;
  x: number;
  y: number;
  width: number;
  height: number;
};
```

该模块统一负责：

- 根据视口、现有 `24px` 右偏移、现有 `96px` 底偏移和默认 `420x680` 推导默认布局；
- 保留现有 `320x420` 最小尺寸；
- 对齐 token/4px 网格的视口安全边距（目标 `16px`，并考虑相关 CSS safe-area inset）；
- finite number 与 schema 校验；
- 先夹尺寸、再夹位置；
- 与当前默认布局比较，以决定是否展示复位控件；
- 读取、迁移、写入、复位和应用布局；
- 判断桌面/平板能力，手机激活时不删除布局。

使用新的本地 key，例如 `wiseeff.xiaoze.popup.layout.v2`。如果没有合法 v2，则读取合法的 v1 session 尺寸一次，与默认位置组合，成功写入 v2 后再删除 v1。非法 JSON、非有限数字、不支持版本、不可实现几何或 storage 异常均安全回退，渲染期间不得抛错。

只在 pointer/键盘/缩放/复位动作提交时持久化，不在每次 pointer move 时写 storage。同一浏览器跨账号共用布局是已确认行为，storage key 不加入用户 id。

### 2. 不拦截页面的全视口桌面 layer

在 `>=768px` 下保留 fixed 全视口小泽 layer，并设为 `pointer-events: none`；只有窗口及其自有交互后代接收 pointer。这个断点下移除可见/可交互 scrim 和 outside-click close，通过 layer 内的 `left`/`top` CSS 变量定位窗口。

窗口进出动画继续独占现有 `transform` 轨道。拖动和缩放不得写 transform。手势期间只暂停位置/尺寸 transition 与文本选择；保留 reduced-motion 行为和既有动画 token。

在 `<768px` 下继续使用现有全屏 modal 合同，不应用或持久化桌面位置/尺寸。

### 3. 非模态语义与生命周期

桌面/平板：

- 保留 `role="dialog"` 和可访问名称，但移除 `aria-modal="true"`、背景 `inert`、focus trap 和 outside-click close；
- 从入口打开时可以把焦点送入小泽；随后页面与浮窗共享正常焦点顺序；
- 关闭时仅在入口仍存在且没有更新的显式焦点目标接管时，把焦点恢复到入口；
- `Escape` 只在焦点位于小泽或其自有审批 surface 时关闭，不得在用户编辑无关业务页面控件时关闭；
- 路由变化不关闭小泽；移除或替换 `XiaozePopupView.tsx` 与 `XiaozePopupOpenPolicy.tsx` 的重复路由关闭 effect，改为刷新上下文；
- 开合/对话状态与布局持久化保持独立。

手机继续保持现有 modal/full-screen 语义，但共享修正后的跨路由连续性规则。

### 4. 拖动交互合同

把 `XiaozeChatHeader.tsx` 中央品牌区改为专用可聚焦把手，提供中文可访问名称和简短说明。操作按钮区域不能成为拖动 surface。

Pointer 行为：

- 只响应 primary pointer/button；
- 只在把手使用 `touch-action: none`；
- 复用既有 Pointer Events 与 `setPointerCapture` 模式；
- 经过小幅移动阈值后才进入 dragging，避免把 click/focus 误判为拖动；
- 每个 animation frame 最多更新一次视觉位置；
- 每帧夹取渲染位置，`pointerup` 时只提交一次；
- `pointercancel`、capture 丢失、卸载、断点变化和关闭都必须完整清理。

聚焦把手后的键盘行为：

- Arrow 每次移动 `8px`；
- `Shift+Arrow` 每次移动 `32px`；
- `Home` 恢复默认布局；
- 每次动作都夹取并提交；
- 把手具备可见 focus、rest、hover、active/grabbing 和 disabled 状态。

### 5. 缩放协同

把命令式注入的左上缩放把手替换为同一 chrome/layout controller 管理的显式右下缩放把手。尺寸变化时保持左上 `{x, y}` 不变；先夹尺寸，再夹位置，保证整个窗口可达。拖动和缩放手势互斥并共用清理逻辑，不能由两个 hook 分别遗留 document 全局状态。

优先在 popup view、header 与 chrome 之间建立显式 React ref/contract，不继续扩大当前 body-wide `MutationObserver`。如果 CopilotKit ownership 阻止直接 ref，则把 DOM discovery 限定在 chrome adapter 内，布局数学、手势状态和持久化仍保持 framework-independent、可单测。

### 6. 层级合同

调整声明式语义 token，使普通业务 modal 位于非模态小泽之上，不新增 raw `z-index`。继续保证：

- 小泽关闭时固定入口容易发现；
- 小泽审批 overlay/content 位于小泽之上且可操作；
- toast 位于仓库声明的最高通知层；
- nested business modal 继续遵循现有 modal 合同。

中英文 UI design system 必须按真实 token ladder 更新，不能复制当前已经陈旧、只描述 toast 的层级文字。

## 状态转换

| 事件 | 桌面/平板结果 | 手机结果 | 持久化 |
| --- | --- | --- | --- |
| 首次打开且无存储 | 默认右下浮窗 | 全屏对话 | 仅完成布局动作或迁移后写入 |
| 鼠标/触屏拖动 | 移动并夹取 | 不提供 | 只在结束/取消且完成合法变化时提交 |
| 键盘移动 | 移动并夹取 | 不提供 | 每次离散按键提交 |
| 缩放 | 右下缩放并夹取 | 不提供 | 结束时提交 |
| 复位 | 当前视口默认布局 | 不展示 | 用合法默认布局替换存储 |
| 浏览器 resize/显示器变化 | 先夹尺寸再夹位置 | 全屏 | 只在桌面/平板持久化修正布局 |
| 路由变化 | 保持展开和对话/布局，刷新上下文 | 保持展开并刷新上下文 | 除非 clamp 改变布局，否则不写 |
| 业务 modal 打开 | 小泽保留挂载并位于 modal 下 | 继续现有全屏/modal 仲裁 | 不写 |
| 关闭再打开 | 恢复已存布局 | 全屏 | 读取并夹取 v2 |
| 非法/历史存储 | 迁移或使用安全默认 | 忽略桌面布局 | 不抛错、不写入非法数据 |

## 计划修改文件

| 区域 | 预期文件 | 用途 |
| --- | --- | --- |
| 布局模型 | `src/features/agent/xiaozePopupLayout.ts`、`xiaozePopupLayout.test.ts` | versioned rect、迁移、夹取、默认值、存储 |
| Chrome 手势 | `XiaozePopupChrome.tsx`、`useXiaozePopupResize.ts`、新增或合并后的 drag/layout hook 与测试 | pointer、touch、keyboard、resize、cleanup |
| Header/View | `XiaozeChatHeader.tsx`、`XiaozePopupView.tsx`、对应测试、`XiaozePopupOpenPolicy.tsx` | 把手/复位、非模态语义、路由连续性、焦点/关闭规则 |
| 样式 | `src/styles.css` | CSS 变量、pointer routing、状态、断点、语义 z-index 顺序 |
| 浏览器覆盖 | 新增 `e2e/acceptance/xiaoze-popup-layout.acceptance.spec.ts`；小泽审批及 quality visual/responsive/a11y spec/helper | 端到端行为与回归 |
| 覆盖治理 | 中英文 browser acceptance/operation matrix，以及 requirements/operation registry | `XIAOZE-POPUP-MOVE-001` 覆盖与证据 |
| Frontend/design 文档 | `docs/FRONTEND.md`、`docs/zh-CN/frontend.md`、中英文 UI design system 与本计划 | 持久交互和层级合同 |

新增 hook 的准确文件名可在 TDD 时调整，但实现必须保留一个 layout owner 和一个 gesture-cleanup owner，不能形成并行 drag/resize 子系统。

## 验收与操作覆盖

实现完成前必须增加：

- requirement ID `XIAOZE-POPUP-MOVE-001`：桌面/平板用户可移动、缩放、复位、刷新、切换路由，并在浮窗安全保持展开时继续操作下方页面；手机保持全屏；
- operation ID `XIAOZE-POPUP-MOVE-001`：P1、Agent 域、automated、代表性 API-mode 路由（如 `/parameters`）、Admin、断言 `ui`（布局、焦点、持久化、页面共存），并保留 screenshot/trace evidence；
- browser owner：`e2e/acceptance/xiaoze-popup-layout.acceptance.spec.ts`；
- 回归关联：`e2e/acceptance/xiaoze-action.acceptance.spec.ts` 中的 `XIAOZE-APPROVAL-CARD-001`。

如果 evidence generator 需要把键盘/复位或跨路由连续性拆成独立 operation，必须在实现前拆分，不能等测试完成后把所有行为硬塞进一个 operation record。

## TDD 实施任务

### Task 1 — Layout v2 Red -> Green

- 先为默认值、v1 迁移、非法值、四边夹取、先尺寸后位置、local storage 异常、视口变化和手机不写入增加失败的纯函数测试。
- 实现版本化 layout 模块，不混入 DOM 手势代码。
- 除非失败的视口案例证明必须显式调整 token，否则保留现有默认/最小尺寸。

### Task 2 — Pointer、touch、keyboard 与 resize Red -> Green

- 先为 primary pointer 过滤、阈值、capture/release、`pointercancel`、capture 丢失、交互子元素排除、animation-frame cleanup、Arrow/Shift+Arrow/Home、复位显示和 drag/resize 互斥增加失败测试。
- 通过单一 chrome controller 实现显式品牌把手和右下缩放把手。
- 验证只在定义的提交点持久化。

### Task 3 — Modeless lifecycle Red -> Green

- 先增加组件失败测试：桌面 `role=dialog` 但无 modal/inert background，点击页面不关闭、路由连续、页面上下文更新、焦点行为、限定范围的 Escape、业务 modal 层级和手机 modal 保留。
- 删除重复 route-close 行为和桌面 scrim 拦截。
- 保留审批卡 portal 例外与关闭/焦点 cleanup。

### Task 4 — 浏览器验收与视觉质量

- 先登记新的 requirement/operation ID，再修改它们的 owner spec。
- 自动化 mouse、touch-equivalent pointer、keyboard、reset、reload、route change、background form interaction、viewport clamp、resize 和 approval-card regression。
- 扩展 visual、responsive 和 focused accessibility 覆盖；现有 a11y 排除 popup layer 的行为不能作为新把手的语义证据。

### Task 5 — 文档和最终 review

- 同步完成 Documentation Impact Matrix 中所有 `Update` 行的中英文内容。
- 运行精确验证矩阵，保留真实 result、skip、warning、screenshot、trace 和 operation evidence。
- 对最终 diff 进行独立 Standards 与 Spec review；修复 findings 或记录 owner decision，实现者不得自批或自合。

## 验证矩阵

开发期 focused 命令：

```bash
npm test -- --run src/features/agent/xiaozePopupLayout.test.ts
npm test -- --run src/features/agent/XiaozePopupView.test.tsx
npm test -- --run src/features/agent/XiaozeChatHeader.test.tsx
```

新增 drag/chrome 测试命名后，把准确路径加入 focused 命令。完成门禁：

```bash
npm test
npm run ui:check
npm run build
npm run acceptance:browser
npm run acceptance:evidence
npm run docs:check
git diff --check origin/main...HEAD
```

真实浏览器必须用 API-mode 本地路由和 `playwright-cli` 验证：

- `1440x900`：鼠标拖到各边界、键盘移动/复位、右下缩放、页面表单/导航交互、跨路由、刷新持久化、业务 modal 层级、审批卡；
- `768x1024`：触屏/pointer 拖动、resize/等价旋转后的 clamp、页面共存、复位；
- `390x844`：全屏、无 drag/resize handle、无横向溢出、输入/审批内容可达、桌面布局记录不变。

每个相关页面/视口都执行 `snapshot`、`screenshot`、`console error`，并检查失败/关键请求及交互相关 network。证据使用确定性名称保存到 `work/ui-checks/xiaoze-popup-move/`。最终报告必须包含 URL/route、viewport、interaction、截图路径、console/network 结果、发现并修复的问题、acceptance run ID、operation evidence 路径与 exact-tree commit。

## 风险与缓解

| 风险 | 缓解 / stop rule |
| --- | --- |
| drag transform 与窗口动效冲突 | 位置只用 `left`/`top`；如果实现把 drag 状态写入动画 transform，立即停止。 |
| modeless shell 仍拦截页面输入 | 全 layer pointer-transparent；浏览器测试必须点击/输入窗口外页面。 |
| 全局 Escape 在编辑页面时关闭小泽 | 桌面只对小泽/自有 surface 响应 Escape，并增加 page-input 回归。 |
| 标题按钮误触拖动 | 专用品牌把手 + threshold；显式测试历史/新对话/复位/关闭。 |
| resize 与 drag 互相破坏 | 单一 layout controller、互斥 gesture state、size-first clamp。 |
| 存储数据让窗口离屏 | 校验 finite v2，并在 restore/viewport/size 转换时全部 clamp。 |
| 手机覆盖桌面布局 | `768px` 以下禁止布局写入，并测试断点往返。 |
| 业务 modal 或审批层不可达 | 只调整 token ladder，并同时回归 modal 与 approval。 |
| CopilotKit DOM ownership 阻止稳定 ref | 限定为窄 adapter；不得把 selector/MutationObserver 扩散到多个组件。 |
| 干扰已有端口/工作区 | 只使用本工作区及分配的前端端口；不得 signal 或重配无关 listener。 |
| 范围膨胀到 Agent/server | 停止并请求独立 owner decision；本计划不改变小泽后端合同。 |

## 文档影响矩阵

| 区域 | 状态 | 准确路径与所需证据 |
| --- | --- | --- |
| 仓库地图与 agent 指南 | Review | `AGENTS.md`、`ARCHITECTURE.md`、`docs/README.md`；只有 routing 变陈旧才更新。 |
| 计划与技术债 | Update | 本中英文计划、`docs/PLANS.md`、`docs/zh-CN/PLANS.md`；review `docs/exec-plans/tech-debt-tracker.md`，只有接受残留才加行。 |
| 产品规格 | Review | `docs/product-specs/index.md`、`product-spec.md`、`prototype-functional-spec.md`；只有已有小泽产品行为需要同步时更新。 |
| 架构与领域模型 | Review | `docs/design-docs/full-stack-architecture.md`、`domain-model.md`；预期无 server/domain 变化。 |
| API/contracts/generated/references | No change | `docs/api/`、`server/modules/contracts/`、`docs/generated/`、`docs/references/`；布局只在浏览器本地，不新增 API/schema。 |
| 安全/治理 | Review | `docs/SECURITY.md`；确认未改变审批、auth、audit 或 trusted provenance 语义。 |
| 可靠性/runbook | Review | `docs/RELIABILITY.md`、`docs/runbooks/manual-acceptance.md` 及中文对应页；更新手工小泽 UI 验收步骤。 |
| 质量/测试 | Update | 中英文 browser acceptance/operation matrix、requirement/operation registry、相关 acceptance/quality spec。 |
| Frontend/design | Update | `docs/FRONTEND.md`、`docs/zh-CN/frontend.md`、中英文 `ui-design-system.md`；记录 modeless/drag/layout/layer 合同并修正 z-index ladder。 |
| 环境/部署 | No change | `.env.example`、`docs/developer/environment-variables.md`、`ops/self-hosted/`；无 runtime variable 或部署变化。 |

## 文档更新门禁

- [x] 所有 `Update` 行已按需同步中英文。
- [x] 所有 `Review` 行已记录准确结果；没有接受残留需要新增技术债行。
- [x] requirement 与 operation truth source 中均已存在 `XIAOZE-POPUP-MOVE-001`。
- [x] 手工验收文档已说明桌面/平板 modeless 行为与手机全屏行为。
- [x] Frontend/design 文档已说明布局持久化、键盘/复位、跨路由、业务 modal 与小泽 approval 层级。
- [x] 真实浏览器及 operation evidence 已记录在下方完成记录。
- [x] 实现树上的 `npm run docs:check` 已通过。
- [x] 实现、聚焦验证、独立 Standards/Spec review 与中英文文档门禁均已完成。

## Git 与 PR 工作流

实现保留在上述隔离 worktree 的 `codex/frontend-ui-optimization-20260827`。修改产品代码前 fetch `origin/main`、披露分歧，并用仓库批准的非破坏流程集成当前 `main`；绝不触碰或清理原 `/Users/tzrea1/Develop/WiseEff` 工作区。

实现型子智能体只能在该功能分支编辑、测试和 commit；不得 push `main`、开/合 GitHub PR 或同步本地 `main`。父会话/owner review 精确 diff 与证据、创建 PR、等待 required CI、批准后合并，再同步本地 `main`。现有无关 worktree 修改与服务不属于本计划。

## 完成记录

已在隔离 feature branch 上实现已确认的小泽可拖动/modeless 合同。桌面/平板由同一个 pointer + keyboard layout controller 管理拖动、右下缩放、复位、v1→v2 本地持久化、视口夹取、跨路由连续性和页面共存。手机继续使用背景 inert、焦点陷阱的全屏 dialog，不展示也不持久化桌面控制。业务 modal 位于小泽之上，小泽审批与 toast 继续位于更高的语义层级。

文档 review 结果：仓库地图、产品规格、架构/领域、安全/治理、环境/部署和技术债 tracker 仍准确，无需修改；中英文 frontend/design、手工验收、browser/operation coverage、requirement/operation registry、quality spec 与本计划已同步。没有后端/API/schema 或目标设备行为变化。

在精确实现树上观测到的本地验证：

- 小泽 popup chrome/view 最终聚焦测试 `22/22`，此前较宽聚焦组合 `30/30`；
- TypeScript（`npx tsc -b --pretty false`）、`npm run build`、`npm run ui:check -- --update-baseline`、12 项覆盖矩阵和 `npm run docs:check` 均通过；
- 自有 API-mode acceptance `e2e/acceptance/xiaoze-popup-layout.acceptance.spec.ts` 为 `2/2`（含 warmup）；小泽 responsive 为 `4/4`；聚焦 a11y 为 `2/2`；聚焦 visual 与已存 baseline 通过；
- 完整 `npm test`：`416` 个文件通过，`2` 个文件出现 3 个无关的五秒超时（`3114/3117` 测试通过）；精确重跑这 3 项时 `3/3` 通过；
- 独立 Spec review 无残留 actionable finding。独立 Standards review 提出的手机断点焦点/inert、键盘缩放和 Playwright 可访问名称定位器问题均已修复并复验。

真实浏览器使用 API-mode `http://127.0.0.1:5191/` 与 API `http://127.0.0.1:8791`，覆盖 `1440x900`、`768x1024`、`390x844`。已验证鼠标/触屏等价拖动、右下缩放、Arrow/Shift/Home、复位、刷新恢复、页面输入、跨路由、业务 modal 层级、手机焦点/全屏，以及手机不覆盖桌面布局。截图位于 `work/ui-checks/xiaoze-popup-move/`，最终手机截图为 `mobile-fullscreen-final.png`；自有 operation artifact 位于 `test-results/acceptance/xiaoze-popup-layout.accept-8f7d2-reserves-mobile-full-screen-Desktop-Chrome/attachments/`。所测安全路由的浏览器 console error 为 0；手机观察到 2 条非 error warning。

证据边界：以上均为本地 macOS/浏览器证据，不代表 Hosted CI、目标设备、staging、release、push、PR 或 merge 已完成。
