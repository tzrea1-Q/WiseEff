# 项目运营界面加固

> 状态：**已于 2026-08-05 完成** —— 五个批次全部在 `feat/project-operations-dialog-hardening` 交付；**POD-D1 定为方案 A（回到整页路由）**；未交付范围转入 TD-056 – TD-059
> 日期：2026-08-05
> English: [`docs/exec-plans/completed/2026-08-05-project-operations-dialog-hardening.md`](../../../exec-plans/completed/2026-08-05-project-operations-dialog-hardening.md)
> 信息架构：[ADR-0001](../../../adr/0001-parameter-admin-organized-by-governance-scope.md) —— **重申而非修订，见 POD-D1**
> 与之共享模态缺陷：[`2026-08-03-parameter-spec-editor-fidelity.md`](./2026-08-03-parameter-spec-editor-fidelity.md)（SE-17 – SE-21、SE-R5、SE-R6）
> 前序计划：[`2026-08-02-parameter-admin-ux-polish.md`](./2026-08-02-parameter-admin-ux-polish.md)（Batch 1–3 已随 `59f8d23c` 合入）

## 背景

`3b18433e`（"Fix project admin table scroll and open file ops in a modal."，PR #224，已合入 `main`）把四个项目级视图 —— 参数文件 / 配置集与基线 / 结构浏览 / 冲突裁决 —— 从页面正文搬进了新建的 `ProjectOperationsDialog` 弹窗。该提交加了弹窗容器，但没有一并带入弹窗该有的契约：没有焦点管理、没有背景惰性化、没有未保存内容守卫，也没有为"原本占满一整页的内容"重新分配布局预算。

2026-08-05 的检视在真实浏览器中以 mock 模式走完四个页签，覆盖 1440×900 / 768×1024 / 390×844 三档视口，并对焦点顺序、层叠关系、滚动容器和溢出做了运行时测量。控制台干净（0 error、0 warning）。证据：`work/ui-checks/01-13-*.png`、`tablet-*.png`、`mobile-*.png`。

有三件事让它不只是一份打磨待办：

1. **弹窗与 ADR-0001 相矛盾。** 该 ADR 写明项目级工作应"由路由寻址而非嵌在弹窗内"，理由是深链能力。PR #224 保留了深链（URL 仍会变、刷新仍可用），但把呈现方式改回了弹窗。现在 ADR 文本与代码不一致，而下面多数布局问题都是"把一个四页签工作台塞进 `min(980px, 100vw-48px)` × `min(88vh, 920px)` 盒子"的直接后果。
2. **框架层缺陷是共享的，不是局部的。** `2026-08-03-parameter-spec-editor-fidelity.md` 已经为 `ParameterSpecDetailDialog` 记录了同一批缺陷（SE-17 层叠低于小泽悬浮按钮、SE-18 滚动边界、SE-19 无焦点陷阱、SE-20 `aria-modal` 挂在遮罩上、SE-21 Escape 关错弹窗）。分别修两次只会留下两套互相偏离的弹窗实现。本计划负责建共享原语，见 POD-D4。
3. **有一个组件完全没有样式。** `StructuredValueEditor` 输出的每一个 `structured-value-*` 类名在 `src/styles.css` 及其他任何样式表中都不存在，因此结构化属性编辑器 —— 弹窗内风险最高的写入路径 —— 呈现为裸 HTML。

## 目标

1. **Batch 1（框架）** —— 建立一套共享弹窗原语，正确处理焦点、惰性化、层叠、Escape 与关闭语义；服务于 Batch 2 之后仍然存在的弹窗（编辑项目、删除项目、Batch 4 的各确认框），并供 `2026-08-03-parameter-spec-editor-fidelity.md` 消费。
2. **Batch 2（退回路由）** —— 按 POD-D1 方案 A 把四个视图还原为整页路由，同时保留 PR #224 的项目清单横向滚动修复与现有深链。
3. **Batch 3（结构化编辑器）** —— 为 `StructuredValueEditor` 补齐样式，让结构浏览在三档视口下均可用。
4. **Batch 4（治理安全）** —— 为不可逆操作补确认与强制拦截；不再有静默无响应；不再有静默丢数据。
5. **Batch 5（数据与文案诚实性）** —— 从用户可见面移除教学/mock 资产与裸内部值；让两个 DTS 页签互相一致。

## 非目标

- 不重开 ADR-0001 中"组织与项目为对等区域"的结构。POD-D1 是重申它的"弹窗 vs 路由"条款，而不是修改它。
- 不做参数定义编辑器的写入契约工作（SE-1 – SE-16、SE-22 – SE-23 归 `2026-08-03-parameter-spec-editor-fidelity.md`）。
- 不改基线/配置集的后端语义。本计划改的是现有 API 的呈现、确认与拦截，不改 API 契约。
- 参数治理 deferred D1–D8 与归属 deferred D-AG-*。
- TD-042 拓扑 cutover 演练。

## Git 与 PR 流程

| 角色 | 允许的操作 |
| --- | --- |
| 实施 agent | 在 `feat/project-operations-dialog-hardening` 上提交；不开、不合 GitHub PR |
| 父 agent | 审查、跑验证、开/合 PR，然后同步本地 `main` |

分支：`feat/project-operations-dialog-hardening`，从最新 `main` 切出。Batch 1、2 合入后，Batch 3–5 可以重排到从 `main` 切出的后续分支。Batch 1 必须先于 `2026-08-03-parameter-spec-editor-fidelity.md` 的第 19–21 项实施，否则那三项应改为"启用共享原语"。

## 待定决策

### POD-D1 —— 这个界面到底是弹窗还是路由？—— **2026-08-05 定案：方案 A，回到整页路由**

ADR-0001 选了路由；PR #224 交付了一个保留 URL 的弹窗。四个页签装的是：一个文件管理器、一个配置集/基线治理控制台、一个带编辑器的双栏结构浏览器、一个冲突裁决队列。980 × 88vh 盒子的实测后果：弹窗顶边随页签在 62px / 126px / 240px 之间移动；节点树被限制在写死的 360px 滚动容器里，而它外层的弹窗体本身也在滚动；390px 宽下树的每一行都溢出弹窗 26px 并被裁掉。

已考虑的方案：

| 方案 | 后果 |
| --- | --- |
| **A. 回到整页路由** —— **已选择** | 恢复 ADR-0001 的决定。POD-L1、L4、L6、L7、F6、F7 在这个界面上自然消解，无需逐项修。需要保留 PR #224 修掉的问题（项目清单横向滚动）。 |
| B. 保留弹窗，给它真实的预算 | 固定高度、吸顶标题与页签条、单一滚动区、≤768px 全屏 sheet。每条布局问题都要逐项修并在三档视口重验，且必须修订 ADR-0001。 |
| C. 拆分 —— 贴近列表的轻量操作留弹窗，结构浏览与基线控制台走路由 | 与各页签的分量匹配，但会让同一个项目上下文出现两种导航模型，需要单独的 IA 说明。 |

**理由。** 这四个视图是工作台，不是确认框。其中三个（基线控制台、结构浏览加编辑器、冲突队列）是用户会停留并反复回访的目的地，这正是 ADR-0001 所说的"由路由寻址"。方案 B 会把 Batch 2 花在"在一个盒子里重新推导一整页的布局预算"上，而且页签条、节点树高度和移动端形态仍将是永久约束而非已解决的问题。方案 A 同时也消除了 POD-F6 的小泽悬浮按钮碰撞与 POD-F7 的滚动边界在这个界面上存在的前提。

**对本计划的影响。**

- Batch 2 从"修弹窗"变为"退掉弹窗"。`ProjectOperationsDialog` 被删除而非加固。
- POD-L1、L4、F6（就本界面而言）、F7 通过移除得到解决。POD-L6 写死的 `max-height: 360px` 与 POD-L7 的移动端溢出仍需在页面上验证 —— 固定 360px 滚动容器在路由下同样是错的，因此它们移入 Batch 3 而非随弹窗消失。
- Batch 1 仍然必要，但启用目标改变：原语服务于确实应当存在的弹窗（编辑项目、删除项目、Batch 4 的确认框）以及参数定义编辑器。POD-F1 – POD-F5 不再针对本界面，而成为那些弹窗必须满足的契约。
- ADR-0001 是**被重申**而非被修订。它在文档矩阵中的动作从"修订条款"变为"记录代码已回到该 ADR"。
- POD-R3 现在是承重项：PR #224 的横向滚动修复必须在回退中存活。
- 深链必须与今天完全一致地继续工作；URL 契约是 PR #224 做对的那一件事，不在变更范围内。

Batch 1、3、4、5 在设计上就独立于本决策，保持不变。

### POD-D2 —— 页签语义 —— **由 POD-D1 一并解决**

已合入的 `PA-D4` 有意选择了 `role="navigation"` + 按钮 + `aria-current="page"`，让项目视图与组织子导航一致，而不用 `role="tablist"`。这个选择之所以曾显得可疑，只是因为这些视图被塞进了弹窗。回到路由后，`aria-current="page"` 就是正确语义，PA-D4 原封不动成立 —— 不需要第三次翻案。剩下的缺口只是键盘遍历：为视图链接补左右方向键移动。无其他待定项。

### POD-D3 —— 未保存内容策略

实测：填了配置集名称后切走再切回，值已丢失；结构浏览的 `drafts`、筛选词、选中节点、检索结果在每次切换时全部重置；有待提交 `drafts` 时按 Escape 或点遮罩会直接关闭且无提示。在 POD-D1 之下关闭路径会改变 —— Escape 与点遮罩消失，"离开"变成从项目导航走开 —— 但"切视图即卸载"造成的丢失不变，因为每个视图仍按路由挂载。

建议实质不变：让各视图状态跨切换存活（把状态提升到视图边界之上，或保持面板挂载），仅在带未提交 `drafts` 离开项目时提示。对一个"本来就要在四个视图间来回走"的界面，每次切视图都提示是错误的取舍。

### POD-D4 —— 共享弹窗原语归谁

建议：本计划负责建，`2026-08-03-parameter-spec-editor-fidelity.md` 负责消费。那份计划的第 19–21 项（层叠、滚动边界、焦点陷阱）随之变成"启用原语"而不是三处独立修复，SE-R5 关于"别往 z-index 阶梯上再加第四个随手数字"的警告也就自然满足。本计划合入时需在那份计划里加一条说明。

## 问题清单

### Batch 1 —— 框架（共享弹窗契约）

| ID | 问题 | 位置 |
| --- | --- | --- |
| POD-F1 | **焦点从不进入弹窗，也从不归还。** 打开后 `document.activeElement` 仍是「管理文件」触发按钮；深链进入时是侧边栏 logo。无初始焦点、无陷阱、关闭后无归还。 | `src/components/admin/ProjectOperationsDialog.tsx:43-60` |
| POD-F2 | **`role="dialog" aria-modal="true"` 挂在全屏遮罩上而非弹窗卡片上。** `aria-labelledby` 指向写死的 `project-operations-dialog-title`，副标题也没有被 `aria-describedby` 引用。 | `ProjectOperationsDialog.tsx:66-81` |
| POD-F3 | **背景既非 `inert` 也非 `aria-hidden`，`aria-modal` 是 DOM 并未兑现的声明。** 实测共 43 个可聚焦元素，仅 11 个在弹窗内；Tab 可达侧边栏、顶栏以及遮罩背后的表格行。已复现：Tab 到背景的「编辑」按钮可打开第二个同为 `z-index: 1000` 的弹窗，两层遮罩互相压暗。 | `ProjectOperationsDialog.tsx`；`src/styles.css:9426-9435` |
| POD-F4 | **Escape 关掉的是最底层弹窗。** 运营弹窗与「编辑项目详情」同时打开时，按一次 Escape 关掉了运营弹窗并跳转到项目清单，把编辑弹窗孤立地留在上面。监听是无条件的 `window` keydown，没有最顶层判定。 | `ProjectOperationsDialog.tsx:48-55`；与 SE-21 同源 |
| POD-F5 | **遮罩关闭只看 pointer-up。** 遮罩上的 `onClick={onClose}` 意味着"在弹窗内按下、在弹窗外松开" —— 比如一次普通的节点路径文本选择 —— 就会关闭弹窗并跳转。已用 mousedown (700,400) → mouseup (1350,400) 复现。 | `ProjectOperationsDialog.tsx:71` |
| POD-F6 | **层叠阶梯有三处错误。** (a) `.xiaoze-chat-toggle-anchor` 是 `z-index: 1100`，高于遮罩的 `1000`，因此小泽悬浮按钮及其气泡压在弹窗右下角上。(b) `.param-admin-shell > .modal-backdrop`（`z-index: 120`、`backdrop-filter: blur(6px)`）对本弹窗从不匹配，因为遮罩是 `section.param-admin-main` 的子元素；实测 `backdropFilter: "none"`、`zIndex: "1000"`，观感与同族参数后台弹窗不一致。(c) 该规则块在 `styles.css:12350-12359` 与 `12361-12370` 逐字重复。 | `src/styles.css:9426, 12350, 12361, 12732-12736`；与 SE-17 / SE-R5 同源 |
| POD-F7 | **滚动区没有边界可供性。** 内容在页签条处和弹窗底边被从行中间切断，没有分隔线、阴影或渐隐。 | `.project-parameter-files-dialog-body`，`src/styles.css:14977-14980`；与 SE-18 同源 |

### Batch 2 —— 外壳与布局（范围取决于 POD-D1）

| ID | 问题 | 位置 |
| --- | --- | --- |
| POD-L1 | **弹窗高度随内容收缩，导致页签条跳动。** 1440×900 下实测顶边：结构浏览 62px、参数文件 126px、配置集 240px —— 在本应对等的视图之间切换时，共享的导航条移动超过 170px。 | `.project-parameter-files-dialog`，`src/styles.css:14921-14927` |
| POD-L2 | **治理审计提示被插在标题与页签条之间**，任何审计事件触发时都会把整个界面往下顶。它没有时间戳、不可关闭、会无限驻留。 | `ProjectsOperationsPanel.tsx:403-410`；`.project-parameter-files-dialog-audit`，`styles.css:14929-14931` |
| POD-L3 | **PA-A1 修好的标题重复又回来了。** 现在「项目运营」同时出现在弹窗 eyebrow、scope 胶囊和顶栏副标题上，随后视图名又在 `<h2>` 和面板自己的标题里各出现一次。`ParameterFileConflictPanel` 用的是 `<h2>` —— 与弹窗标题同级，且明显大于另外三个页签用的 `<h3>`。 | `ProjectOperationsDialog.tsx:77-91`；`ParameterFileConflictPanel.tsx:120`；`ProjectParameterFilesPanel.tsx:191` |
| POD-L4 | **移动端是局促的浮动卡片而非 sheet。** 390×844 下 eyebrow、换行标题、三行副标题和两行页签在任何内容之前就吃掉约 250px。关闭按钮 32×32、其余动作高 34px，低于本产品其他地方采用的 44px 点击区。 | `styles.css:14921-14927`；`.audit-dialog-close-icon` |
| POD-L5 | **页签条同时是两套设计。** 基类 `.project-parameter-files-tab` 是下划线式页签（`border-radius: 8px 8px 0 0`、`margin-bottom: -1px`），而 `.param-admin-main .project-parameter-files-tab` 把它覆盖成胶囊并把容器的 `border-bottom` 归零，于是整条页签条悬空无边界。 | `src/styles.css:14933-14975` |
| POD-L6 | **节点树被锁在写死的 `max-height: 360px`**，且位于本身已在滚动的弹窗体内，形成嵌套滚动，最后一行（`demo_regulator`）被从字形中间切断 —— 而当时弹窗有 775px 可用高度。 | `.dts-node-tree-view__list`，`src/styles.css:15120-15128`；`DtsStructureBrowserPanel.tsx:245-254` |
| POD-L7 | **移动端结构行溢出弹窗并被裁切。** 390px 下弹窗右边界 x=366，而每个 `.dts-node-tree-view__item` 都延伸到 x=392，被 `overflow: hidden` 抹掉。该列表自身还带横向滚动（`scrollWidth 308` vs `clientWidth 222`），于是同一区域出现三条滚动轴。 | `DtsNodeTreeView` 样式 |
| POD-L8 | **参数文件页签末尾是一条分隔线加一段死空白**，因为 `.dts-search-panel` 带 `border-bottom` 与 `padding-bottom: 16px`，而它是该页签的最后一个元素 —— 这条规则是为"后面还有内容"的面板写的。 | `src/styles.css:14982-14988` |

### Batch 3 —— 结构化编辑器

| ID | 问题 | 位置 |
| --- | --- | --- |
| POD-E1 | **`StructuredValueEditor` 在整个仓库里没有任何 CSS。** `structured-value-editor`、`structured-value-string-row`、`structured-value-cell`、`structured-value-bytes`、`structured-value-phandle-list`、`structured-value-bool`、`structured-value-mixed`、`structured-value-normalized-preview`、`structured-value-empty-note` 全部未定义。文本输入框没有边框，「移除」/「添加字符串」呈现为裸文字，规范化预览是松散的正文。 | `src/components/parameters/StructuredValueEditor.tsx:75-461`；`src/styles.css` 中缺失 |
| POD-E2 | **「提交变更请求」是嵌套滚动区底部的非主按钮**，位于差异视图之下，待提交数量只是一句散文。弹窗里风险最高的动作没有常驻操作栏。 | `DtsStructureBrowserPanel.tsx:331-347` |
| POD-E3 | **权限失败暴露内部 slug。** 「需要 parameter:edit 权限」「需要 parameter:edit-critical 权限」直接给终端用户看，而编辑器仍在报错下方以禁用态渲染，而不是一次性把状态讲清楚。 | `DtsStructureBrowserPanel.tsx:303-312` |
| POD-E4 | **安全关键节点的提示权重不足。** 在会写 regulator 与 thermal 值的路径上，「安全关键节点（regulator / thermal）」只是灰色的 `role="note"` 文字。 | `DtsStructureBrowserPanel.tsx:262-266` |

### Batch 4 —— 治理安全

| ID | 问题 | 位置 |
| --- | --- | --- |
| POD-G1 | **没有任何不可逆操作带确认步骤。** 发布基线、回滚基线（会恢复 N 项参数）、移除成员，以及两个冲突裁决按钮，全部从 `onClick` 直接执行。同一目录下的 `DeleteProjectDialog` 就是本仓库既有的确认范式，却没有被用上。 | `ConfigSetBaselinePanel.tsx:477-552`；`ParameterFileConflictPanel.tsx:160-185` |
| POD-G2 | **修订门禁返回的 `requiresConfirmation` 只被打印，从未被强制。** 没有任何分支消费它来拦截或加门。 | `ConfigSetBaselinePanel.tsx:568-577` |
| POD-G3 | **门禁结果是裸调试输出，且渲染在首屏之外。** 它输出 `mode: warn` / `requiresConfirmation: false` / `ok: true` 三行未本地化的 camelCase，并渲染在滚动区底部，因此点「校验修订」在不滚动的情况下看不到任何反馈。 | `ConfigSetBaselinePanel.tsx:568-577` |
| POD-G4 | **没有任何动作有 pending 或 disabled 态**，因此创建配置集 / 添加成员 / 创建基线 / 发布都可被重复提交。`loading` 只切换一行文字。 | `ConfigSetBaselinePanel.tsx:387, 408-415` |
| POD-G5 | **空的配置集名称提交是静默无响应** —— 没有校验提示、没有禁用按钮、没有任何反馈。 | `ConfigSetBaselinePanel.tsx:398-416` |
| POD-G6 | **冲突裁决在推荐一侧、又扣留了证据。** 「保留界面值」是 `button primary`，「保留文件值」是 `button subtle`，尽管两者都不可逆地丢弃数据。没有作者、时间或来源版本；没有差异强调；审计模型带 `reason` 字段却没有理由输入；多条冲突时也没有计数与批量处理。 | `ParameterFileConflictPanel.tsx:160-185`；`parameterAdminState.ts` 审计提示结构 |
| POD-G7 | **未保存内容在三条路径上被静默丢弃** —— 切页签（卸载）、Escape、点遮罩，包含结构浏览待提交的 `drafts`。见 POD-D3。 | `ProjectsOperationsPanel.tsx:412-461`；`ProjectOperationsDialog.tsx:48-71` |

### Batch 5 —— 数据与文案诚实性

| ID | 问题 | 位置 |
| --- | --- | --- |
| POD-C1 | **教学 fixture 被当成产品可供性暴露出来。** 「加载教学结构」按钮写死 `DTS_TEACHING_FILE_ID` / `DTS_TEACHING_VERSION_ID`；空态文案是「可点击「加载教学结构」拉取 **mock** 教学样例（上次：`file-teaching-dts` / `version-teaching-1`）」；`revisionId` 兜底为 `"revision-teaching-1"`，随后出现在审计提示里成为「已校验修订 revision-teaching-1（passed）」。 | `DtsStructureBrowserPanel.tsx:20-21, 222-243`；`ProjectsOperationsPanel.tsx:426`；`ConfigSetBaselinePanel.tsx:82` |
| POD-C2 | **两个 DTS 页签在构造上就互相矛盾。** `mockDtsStructuredRepository.getStructure` 为"教学便利"忽略 `projectId`，对任何项目都返回 fixture；而 `search` 在 `requestedProjectId !== projectId` 时返回 `{ hits: [] }`。结构浏览列出 `amba/i2c@XXXX0000/chip@6E`，同一弹窗内检索 `chip` 却报「无命中结果」。mock 模式是演示路径，所以这在演示中就可见。 | `src/infrastructure/mock/mockDtsStructuredRepository.ts:262-280` |
| POD-C3 | **检索命中是死按钮。** `DtsSearchPanel` 挂载时未传 `onSelectHit`，因此每条结果都是一个什么都不做的可聚焦按钮，而该面板的文案承诺「定位节点」。它应当在结构浏览中选中该节点。 | `ProjectsOperationsPanel.tsx:416`；`DtsSearchPanel.tsx:103-115` |
| POD-C4 | **裸枚举值直达界面。** 成员角色选项是 `base` / `overlay` / `charging` / `thermal` / `misc`；基线状态渲染为 `draft` / `released`。 | `ConfigSetBaselinePanel.tsx:456-468, 518-519` |
| POD-C5 | **实现说明被当成产品文案发布。** 三个页签副标题都带「页面可通过 URL 深链与刷新保持」；结构浏览写着「回写载荷使用 rawText」与「本地预览规范化值」。 | `ProjectsOperationsPanel.tsx:77-103`；`DtsStructureBrowserPanel.tsx:220, 322-324` |
| POD-C6 | **版本历史信息不足以支撑治理。** 展开后只有「版本 1 · upload · 64 bytes」 —— 没有时间戳、没有作者、不能下载指定版本、不能回滚到某版本。 | `ProjectParameterFilesPanel.tsx` 版本列表 |
| POD-C7 | **不存在的项目 ID 会打开一个可用的弹窗。** `/parameter-admin/projects/does-not-exist-999/files` 渲染出「参数文件 · does-not-exist-999」，以裸 ID 充当项目名，并列出文件。没有 not-found 态、没有重定向。 | `ProjectsOperationsPanel.tsx:332`（`projectName` 兜底链） |
| POD-C8 | **配置集相关空态缺失**，导致「配置集 / 基线」页签首次打开时像坏了：配置集列表、配置集成员、基线列表都渲染为空 `<ul>`，无提示、无下一步动作。PA-V2 为节点对应确认、定义匹配审核和冲突裁决建立了范式，但没覆盖这三处。 | `ConfigSetBaselinePanel.tsx:418-432, 477-494, 515-552` |

## 交付批次

### Batch 1 —— 框架

在 POD-D1 之下，本批次不再服务 `ProjectOperationsDialog`（Batch 2 会删掉它）。它定义的是那些确实应当存在的弹窗 —— 编辑项目、删除项目、Batch 4 的确认框 —— 以及 `2026-08-03-parameter-spec-editor-fidelity.md` 所要消费的契约。

1. [x] 抽出共享弹窗原语（组件 + hook），由它负责：卡片上的 `role="dialog"` + `aria-modal`、生成式 `aria-labelledby` / `aria-describedby` id、初始焦点、焦点陷阱、关闭后焦点归还触发元素、背景 `inert`、仅最顶层响应 Escape、遮罩关闭要求 pointer-down 与 pointer-up 成对（POD-F1、F2、F3、F4、F5）。
2. [x] 用一套声明式阶梯取代随手写的 z-index，使参数后台弹窗高于 `.xiaoze-chat-toggle-anchor`（1100）、低于 `.xiaoze-popup-layer`（1200）；修正 `.param-admin-shell > .modal-backdrop` 的后代选择器，并删除 `styles.css:12361-12370` 的重复块（POD-F6、SE-R5）。
3. [x] 在 `ProjectAdminFormDialog` 与 `DeleteProjectDialog` 中启用该原语 —— 这是本界面上在 Batch 2 后仍存活的两个弹窗。
4. [x] 测试：打开时焦点进入、关闭时归还触发元素；Tab 无法离开弹窗；Escape 只关最顶层；内按外松不关闭。POD-F4 的双弹窗叠加场景作为回归测试。
5. [x] 在 `2026-08-03-parameter-spec-editor-fidelity.md` 中记录其第 19–23 项改为"启用共享原语"（POD-D4）—— 已于 2026-08-05 完成。

### Batch 2 —— 退掉弹窗（POD-D1 方案 A）

6. [x] 把四个视图还原为整页路由并删除 `ProjectOperationsDialog`，保证现有每一条深链原样可用。POD-L1、L4、F6、F7 由这一步解决，不再逐项修。
7. [x] 保留 PR #224 的项目清单横向滚动修复；先读 `3b18433e`，确认该修复与弹窗无关（POD-R3）。
8. [x] 把审计提示移出标题/导航流；补时间戳与关闭可供性（POD-L2）。
9. [x] 恢复 PA-A1：每个视图只有一个权威标题，四个面板统一标题层级（POD-L3）。
10. [x] 把视图导航收敛为单一设计语言，并按 POD-D2 补左右方向键遍历（POD-L5）。
11. [x] 收窄 `.dts-search-panel` 的尾随 `border-bottom`，使视图内最后一个元素不带悬空分隔线（POD-L8）。
12. [x] 在 1440×900 / 768×1024 / 390×844 重验四个视图，并确认共享导航不再随视图移动。

### Batch 3 —— 结构化编辑器与结构浏览

13. [x] 为编辑器输出的每种值类型补样式：string-list、u32 矩阵、bytes、phandle-list、bool、mixed，以及规范化预览与空值说明（POD-E1）。
14. [x] 让「提交变更请求」获得主按钮权重并置于常驻操作位，待提交数量做成真正的计数器（POD-E2）。
15. [x] 用产品语言替换权限 slug，并渲染单一权威状态，而不是"报错 + 下方禁用编辑器"（POD-E3）。
16. [x] 把安全关键节点的呈现权重提到与写入风险相称（POD-E4）。
17. [x] 把节点树写死的 `max-height: 360px` 换成随页面伸展的高度，并去掉嵌套滚动容器。固定 360px 滚动容器在路由下同样是错的，因此 POD-L6 移到这里而非随弹窗消失。
18. [x] 验证移动端节点行不再溢出其容器，且单区域只有单条滚动轴（POD-L7）。
19. [x] 按值类型编写组件测试，覆盖禁用态与关键节点锁定态。

### Batch 4 —— 治理安全

20. [x] 为发布基线、回滚基线、移除成员和两个裁决动作补确认，基于 Batch 1 的原语并遵循 `DeleteProjectDialog` 范式，在每个确认中说明影响范围（POD-G1）。
21. [x] 让 `requiresConfirmation` 真正拦截它所描述的操作（POD-G2）。
22. [x] 把门禁结果改为产品语言并给出真实的严重度呈现，且在用户点击处附近可见（POD-G3）。
23. [x] 为每个写操作补 pending / disabled 态（POD-G4）。
24. [x] 校验配置集名称与基线名称并给出可见提示；不再静默无响应（POD-G5）。
25. [x] 重做冲突裁决：对称权重、出处（作者/时间/来源版本）、差异强调、可选理由写入审计提示、计数与批量处理（POD-G6）。
26. [x] 实施 POD-D3：各视图状态跨切换存活；带未提交草稿离开项目时确认（POD-G7）。

### Batch 5 —— 数据与文案诚实性

27. [x] 从产品面移除「加载教学结构」与教学 ID；空态改为指向真实下一步；移除 `"revision-teaching-1"` 兜底，使教学 ID 不可能进入审计记录（POD-C1）。
28. [x] 让 mock 仓储的 `getStructure` 与 `search` 在项目作用域上一致，并加一条"浏览与检索看到同一批节点"的一致性测试（POD-C2）。
29. [x] 接上 `onSelectHit`，使检索命中能在结构浏览中选中该节点（POD-C3）。
30. [x] 为成员角色与基线状态补展示文案（POD-C4）。
31. [x] 把副标题与编辑器说明重写为产品文案。在 POD-D1 之下，「页面可通过 URL 深链与刷新保持」这一句应直接删除 —— 它描述的实现属性现在就是路由的平常行为（POD-C5）。
32. [x] 版本历史补时间戳、作者、按版本下载与回滚到版本；若 API 无法提供则将缺口登记为技术债（POD-C6）。
33. [x] 为未知项目 ID 增加 not-found 态，不再用裸 ID 作页面标题（POD-C7）。
34. [x] 把 PA-V2 的空态范式套用到配置集列表、配置集成员与基线列表（POD-C8）。

## 关键接缝（起点）

- 弹窗容器及其键盘/关闭逻辑：`src/components/admin/ProjectOperationsDialog.tsx`。
- 页签接线、视图元数据、审计提示、面板挂载：`src/components/parameter-admin-next/ProjectsOperationsPanel.tsx`。
- 模态/遮罩/z-index 规则：`src/styles.css:9426-9435`、`12350-12370`、`12732-12736`、`14921-14980`。
- 结构化编辑：`src/components/parameters/StructuredValueEditor.tsx`、`DtsStructureBrowserPanel.tsx`、`DtsNodeTreeView`。
- 配置集与基线：`src/components/admin/ConfigSetBaselinePanel.tsx`。
- 冲突：`src/components/admin/ParameterFileConflictPanel.tsx`。
- Mock 一致性：`src/infrastructure/mock/mockDtsStructuredRepository.ts`。
- 可复用的既有确认范式：`src/components/admin/DeleteProjectDialog.tsx`。

## 风险

| ID | 风险 | 处理 |
| --- | --- | --- |
| POD-R1 | 把参数后台弹窗抬到小泽悬浮按钮之上，不能同时抬到小泽弹层（1200）或已占用 1300/1400 的两个同族遮罩之上。 | 把完整阶梯一次性声明为 token，并用测试断言顺序，而不是再加第五个随手数字（对应 SE-R5）。 |
| POD-R2 | 背景 `inert` 在较老浏览器支持不完整，且可能破坏那些"弹窗打开时仍查询背景节点"的既有测试。 | `inert` 搭配 `aria-hidden` 兜底，并在同一批次内审计受影响的测试。 |
| POD-R3 | **在 POD-D1 方案 A 之下已成承重项。** 回退 PR #224 的呈现方式不能让它修掉的问题回归，也不能破坏它带来的深链。 | Batch 2 开始前先读 `3b18433e`，确认项目清单横向滚动修复与弹窗无关；保证现有每一条 `/parameter-admin/projects/:id/:view` URL 可用，并为每个视图加路由测试。 |
| POD-R4 | Batch 1 一旦被采用，就成为其他弹窗共用的原语。 | 本计划只在 `ProjectAdminFormDialog`、`DeleteProjectDialog` 与 Batch 4 的确认框中启用；其他弹窗通过各自计划迁移。 |
| POD-R5 | 修 POD-C2 可能暴露 API 模式存在同样或相反的作用域不对称。 | 两种运行模式都验证；若 API 模式不一致，应登记问题而不是让 mock 去迁就一个坏掉的 API。 |
| POD-R6 | Batch 4、5 会改动测试与文档可能断言的审计提示文案与载荷。 | 修改前先 grep 审计摘要字符串；在同一次变更中更新 `docs/references/*` 中的引用。 |

## Documentation Impact Matrix

| 领域 | 动作 | 路径 |
| --- | --- | --- |
| 仓库地图 | Review | `AGENTS.md`、`ARCHITECTURE.md` —— 确认路由描述与 Batch 2 之后的形态一致 |
| 规划 | Update | 本计划；`docs/PLANS.md`；`docs/zh-CN/PLANS.md`；英文对照计划；在 `2026-08-03-parameter-spec-editor-fidelity.md` 中加交叉引用 |
| 架构 / ADR | Update | `docs/adr/0001-parameter-admin-organized-by-governance-scope.md` —— 记录 PR #224 曾偏离"弹窗 vs 路由"条款、以及 Batch 2 回到该条款，使下一个读者不再重复这一趟往返 |
| 产品规格 | Review | `docs/product-specs/prototype-functional-spec.md` —— Batch 2 的呈现方式变化，以及 Batch 4–5 的文案与确认步骤变化 |
| 前端 / 设计 | Update | `docs/FRONTEND.md`（+ 英文）记录共享弹窗原语、z-index 阶梯、项目视图的路由形态与空态套用；`docs/design-docs/full-stack-architecture.md` 记录路由形态 |
| 领域词表 | Review | `CONTEXT.md` —— 若 Batch 5 改动了任何用户可见的配置集 / 基线 / 冲突裁决措辞 |
| 质量 / 测试 | Update | `docs/developer/browser-acceptance-coverage-map.md`（+ 英文）与 `docs/developer/user-operation-coverage-matrix.md`（+ 英文），登记下列新需求 ID |
| 安全 / 治理 | Update | `docs/SECURITY.md` —— Batch 4 为基线发布/回滚与冲突裁决加入人工确认，这是审批模型层面的陈述 |
| 可靠性 / 运维手册 | No change | 预期无部署或任务行为变化 |
| 生成产物 | No change | 预期无迁移、无 API 契约变化 |
| 参考资料 | Review | 若 `docs/references/*` 引用了审计提示或门禁结果文案 |

## Documentation Update Gate

在把本计划移入 `completed/` 之前：

1. Impact Matrix 中每一条 `Update` / `Review` 都已更新，或以证据记录为无需变更。
2. POD-D1 至 POD-D4 均已连同理由记录 —— D1、D2 已于 2026-08-05 定案；D3、D4 已有建议，需在实施时确认 —— 且 ADR-0001 与已发布代码一致。
3. 五个批次全部交付，或剩余项已重新登记到 `exec-plans/tech-debt-tracker.md`。
4. 下列新需求 ID 的浏览器验收覆盖已通过自动化或补充证据登记。
5. `npm run docs:check` 通过。

## UI 交互覆盖

每个批次都改变用户可见的交互行为，因此 UI 交互自动化规则适用。

- 既有 ID：`PARAM-ADMIN-001` / `PARAM-ADMIN-002` 覆盖导入流程；`PARAM-ADMIN-003` 覆盖移动端项目清单。没有一个覆盖项目运营界面、它的四个视图或弹窗行为。
- 在宣称实施完成前需新增：
  - `PROJ-OPS-001` —— 每条 `/parameter-admin/projects/:id/:view` 深链在加载与刷新后都能解析到对应视图（四个视图全覆盖），且视图间的前进/后退导航可用。这是 POD-R3 的守卫。
  - `PROJ-OPS-002` —— 四个视图在 1440×900 / 768×1024 / 390×844 下均无内容裁切与横向溢出，且共享的视图导航不随视图改变位置。
  - `PROJ-OPS-003` —— 基线发布、基线回滚、成员移除与冲突裁决各自需要显式确认并产生审计记录。
  - `PARAM-ADMIN-DIALOG-001` —— 对仍然保留的弹窗（编辑项目、删除项目、Batch 4 确认框）：打开时焦点进入，Tab 无法离开，Escape 只关最顶层，关闭后焦点归还触发元素，内按外松不关闭。
- 对涉及的自动化操作 ID，通过 `npm run acceptance:browser` 或 `npm run acceptance:evidence` 保留操作证据的生成。

## 验证

```bash
npm test -- src/ParameterAdminNextPage.test.tsx src/ParameterAdminNextPage.a11y.test.tsx
npm test -- src/components/admin/ParameterFileConflictPanel.test.tsx
npm run test:server
npm run build
npm run docs:check
# 浏览器证据存于 work/ui-checks/project-operations-dialog/batch{N}/
# 覆盖 1440x900、768x1024、390x844 的四个视图，并检查控制台错误
```

## 交付记录（2026-08-05）

五个批次全部在 `feat/project-operations-dialog-hardening` 交付。

| 批次 | 提交 | 说明 |
| --- | --- | --- |
| 1 —— 框架 | `e571ac74` | `src/components/common/` 下新增 `ModalDialog` 与 `ConfirmDialog`；z-index 收敛为 `:root` 一套刻度；在 `ProjectAdminFormDialog` 与 `DeleteProjectDialog` 启用。由于原语 portal 到 `document.body`，参数后台弹窗样式补上按遮罩类名的选择器，并由 `ModalDialog.styles.test.ts` 守住这对选择器。 |
| 2 —— 退掉弹窗 | `c6744573` | 删除 `ProjectOperationsDialog`；`ProjectOperationsView` 在各自路由上渲染四个视图，支持方向键移动焦点、每视图一个权威标题、面板统一 `<h3>`、审计提示带时间戳且可关闭。PR #224 的项目清单滚动修复未被触碰。 |
| 3 —— 结构化编辑器 | `4b2e96c1` | 所有 `structured-value-*` 类补齐样式；提交按钮为主操作并带真实计数，位于常驻动作条；权限与安全关键状态改为产品语言；节点树跟随页面高度，只保留一个滚动轴。 |
| 4 —— 治理安全 | `85cfda67` | 发布/回滚基线、移除成员与两侧裁决都加确认；`requiresConfirmation` 以勾选拦截发布；门禁结论按严重度以产品语言呈现；所有写操作有 pending 态与名称校验；视图间状态保留，带草稿离开会提示。 |
| 5 —— 数据与文案 | `b0511a32` | 移除教学资产与 `revision-teaching-1` 审计兜底；mock `getStructure` / `search` 口径一致；检索命中可定位节点；枚举改中文标签；版本历史补时间/操作人/大小/下载；未知项目 ID 走 not-found。 |
| 收尾 | 本次变更 | 修复三个弹窗因 portal 丢失样式的回归；审计提示改用 `data-audit-kind` 暴露类型，不再给读屏播报裸 slug；变更集列表显示节点路径而不是临时 `pending:` 键；mock 展示文件名不再叫 `teaching-sample.dts`。 |

验证：定向面板/页面测试、`npm test`（356 个文件）、`npm run build`、`npm run acceptance:operations`、`npm run docs:check`，以及 `work/ui-checks/project-operations-dialog/final/` 下四个视图在 1440×900 / 768×1024 / 390×844 的 playwright-cli 证据，控制台 0 错误，各视口 `documentElement.scrollWidth == clientWidth`。`npm run test:server` 在本机会因 `relation "project_parameter_values" does not exist` 失败，`main` 上同样失败——是本地数据库模板早于 TD-042 切换所致，与本次变更无关。

## 延后 / 技术债候选

已登记到 `exec-plans/tech-debt-tracker.md`：

- **TD-056** —— 回滚到指定版本，以及把版本操作人解析成显示名（POD-C6 已交付版本号、来源、时间、操作人 ID、大小与逐版本下载）。
- **TD-057** —— 给配置集视图接入真实配置修订来源，让修订门禁能在发布基线的界面上被触发。
- **TD-058** —— 冲突裁决的批量处理，以及冲突来源版本的可读标识（POD-G6 只交付了单条处理）。
- **TD-059** —— 把其余弹窗迁移到 Batch 1 的原语上，先从 `ParameterSpecDetailDialog` 开始。
