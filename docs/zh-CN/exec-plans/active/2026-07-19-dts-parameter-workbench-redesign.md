# DTS 参数工作台重设计实施计划

> **面向执行智能体：** 必须使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans，按任务逐项执行。本计划使用 - [ ] 跟踪状态。

> English: [English](../../../exec-plans/active/2026-07-19-dts-parameter-workbench-redesign.md)

**目标：** 以成熟参数工作台为 API 模式 /parameters 的主框架，深度融合嵌套 DTS 拓扑、语义 binding、来源链、类型化草稿和真实提交身份。

**架构：** 保留 ParametersPage 与 WorkbenchLayout 页面外壳；ApiProjectTopologyWorkspace 继续负责 API 数据协调，但用纯行/树视图模型、内嵌拓扑导航、响应式语义列表、原详情对话框心智模型和本轮修改区替代纯三栏拓扑界面。现有 topology repository 与 binding/spec/candidate 合同继续作为事实来源。

**技术栈：** React 19、TypeScript、Vitest、Testing Library、Lucide React、WiseEff CSS 令牌、Playwright acceptance、API 模式拓扑仓储。

**设计规格：** [DTS 参数工作台深度重设计](../../../superpowers/specs/2026-07-19-dts-parameter-workbench-redesign.md)

---

## 成功标准

1. API 模式 /parameters 回归原工作台层级，不再以永久三栏拓扑页替代。
2. gpio_int 行完整展示属性、驱动、器件地址、拓扑路径、raw value、value shape、schema/policy 和源码 occurrence，身份不来自路径。
3. 源树/生效树是真实可展开父子树，选中节点后主列表联动筛选。
4. 搜索覆盖属性、驱动、实例/地址、路径、源码和 raw value；清除筛选不删除草稿。
5. 详情沿用原对话框/sheet，包含身份、位置、来源链、值契约、诊断和类型化编辑。
6. typed draft 进入“本轮已修改参数”，提交只使用显式 draftId + projectParameterBindingId + parameterSpecId + action。
7. 项目切换在加载新项目之前清除树、列表、详情和草稿状态。
8. mock 模式旧工作台保持；API 模式无 teaching 回退和旧推荐值语义。
9. 桌面、平板和 390px 移动端焦点可见且无页面横向溢出。
10. 测试、构建、文档、拓扑验收和 evidence 通过，不夸大生产结论。

## 文件结构

新增语义行/树模型及测试、嵌套导航器、语义工作台、响应式列表、DTS 详情对话框和本轮修改区。修改 API coordinator、ParametersPage、styles.css、topology acceptance、FRONTEND 双语文档和验收覆盖矩阵。具体路径与职责以英文主计划“File map”为准。

## 任务 1：先锁定 API 模式页面边界

**文件：** src/ParametersPage.test.tsx

- [ ] 添加 RED 测试，要求存在 DTS 参数工作台 region、搜索 DTS 参数 searchbox、生效 DTS 拓扑 tree。
- [ ] 断言 API 模式不存在“当前 → 推荐”和“推荐值”。
- [ ] 保留 mock 模式 ParametersTable 和旧草稿流程测试。
- [ ] 运行 npm test -- src/ParametersPage.test.tsx，确认新断言失败。
- [ ] 提交 test(parameters): define integrated DTS workbench boundary。

~~~tsx
expect(await screen.findByRole("region", { name: "DTS 参数工作台" })).toBeInTheDocument();
expect(screen.getByRole("searchbox", { name: "搜索 DTS 参数" })).toBeInTheDocument();
expect(screen.getByRole("tree", { name: "生效 DTS 拓扑" })).toBeInTheDocument();
expect(screen.queryByText("推荐值")).not.toBeInTheDocument();
~~~

## 任务 2：建立 DTS 语义行模型

**文件：** workbenchTypes.ts、buildDtsWorkbenchRows.ts 及测试。

- [ ] 定义 binding/spec/logical node/property/driver/instance/address/path/source/raw/effective/shape/schema/policy/mapping/effects/search 字段；禁止 recommendedValue。
- [ ] 先写 amba/i2c@FDF5E000/sc8562@6E/gpio_int fixture 的 RED 测试。
- [ ] 实现 buildDtsWorkbenchRows；用 logical parent 重建展示路径，用最后 sourceOrder effect 定位 occurrence。
- [ ] 路径只用于显示，不参与身份。
- [ ] cell 值摘要为 phandle-list 或 cell-array · N bit · M cells。
- [ ] 运行 mapper 和 topology domain 测试并提交 feat(parameters): map DTS bindings into workbench rows。

治理状态：

~~~ts
const governanceState =
  binding.schemaState === "invalid" || binding.policyState === "fail"
    ? "blocked"
    : mappingOpen || binding.schemaState === "unreviewed"
      ? "attention"
      : "valid";
~~~

## 任务 3：建立真实嵌套源树/生效树

**文件：** buildDtsTopologyTree.ts 及测试、DtsTopologyNavigator.tsx 及测试。

- [ ] 定义 DtsWorkbenchTreeNode，包含 parent、label、address、compatible、binding 和 attention 聚合。
- [ ] 先写 amba → i2c@FDF5E000 → sc8562@6E、顺序、祖先计数和 ARIA RED 测试。
- [ ] 源树使用 parentOccurrenceId，生效树使用 parentLogicalNodeId。
- [ ] 实现逐节点/全部展开收起、选中路径展开、Enter/Space 和左右方向键。
- [ ] 运行聚焦测试并提交 feat(parameters): add nested DTS topology navigator。

## 任务 4：实现语义工具栏和主列表

**文件：** DtsParameterWorkbench.tsx、DtsParameterWorkbenchTable.tsx 及测试。

- [ ] 先写搜索 gpio13、清除全部、节点联动、结果数和状态 badge 的 RED 测试。
- [ ] 工作台集中管理 search、governance filter、source/effective view、selected node、selected binding。
- [ ] clearFilters 不得修改 pendingDrafts。
- [ ] 桌面列为属性、器件/驱动、DTS 位置、生效值、类型、治理、操作；移动端改卡片。
- [ ] key 与 data-binding-id 使用 binding ID；禁止转成旧 ParameterRecord。
- [ ] 运行测试并提交 feat(parameters): restore semantic parameter workbench list。

## 任务 5：融合原详情对话框与类型化编辑

**文件：** DtsBindingDetailDialog.tsx 及测试、工作台。

- [ ] 先写 gpio_int 参数详情、器件、路径、源码行、shape、effect 的 RED 测试。
- [ ] 原因为空时创建草稿禁用；填写 raw/原因后按 binding ID 调用 onCreateDraft。
- [ ] 实现身份、DTS 位置、来源链、值与约束、类型化编辑五个 labelled section。
- [ ] 沿用现有 modal/sheet 焦点；关闭只清 selected binding。
- [ ] 运行测试并提交 feat(parameters): add DTS binding workbench detail flow。

~~~ts
onCreateDraft({
  bindingId: "binding-gpio-int",
  rawValue: "<&gpio13 30 0>",
  reason: "Move interrupt line"
});
~~~

## 任务 6：恢复本轮修改区和语义提交

**文件：** DtsBindingDraftTray.tsx 及测试、工作台、API coordinator 及测试。

- [ ] 先写 typed draft 的当前→目标、原因、action、candidate、移除和角色 RED 测试。
- [ ] 提交 payload 必须包含 draftId、projectParameterBindingId、parameterSpecId、action、targetValue、reason，禁止 parameterId/recommendedValue。
- [ ] coordinator 把单个 pendingDraft 升级为按 binding 替换的 pendingDrafts。
- [ ] 项目切换立即清空；迟到响应继续由 activeProjectIdRef 忽略。
- [ ] 候选人/身份缺失或 submitting 时禁用提交。
- [ ] 移除草稿只影响本地展示，不虚构服务端删除。
- [ ] 运行测试并提交 feat(parameters): restore semantic current-edits submission tray。

~~~ts
setPendingDrafts((current) => [
  ...current.filter((item) => item.projectParameterBindingId !== draft.projectParameterBindingId),
  draft
]);
~~~

## 任务 7：替换 ParametersPage 的纯拓扑组合

**文件：** API coordinator 与测试、ParametersPage.tsx 与测试。

- [ ] coordinator 用纯 mapper 生成 rows，并传递真实 nodes、mapping、diagnostics、draft、candidate、validate/resolve/submit callbacks。
- [ ] 保留 loading、empty、error、retry、needs_mapping、invalid、stale 行为。
- [ ] ParametersPage 始终保留 WorkbenchLayout 和 parameters-page-layout。
- [ ] API 模式只显示语义工作台，mock 模式只显示旧表格/详情/草稿。
- [ ] 不恢复 e9eb025f 之前 API 模式同时显示旧推荐值表的行为。
- [ ] 运行页面/coordinator/workbench 测试并提交 refactor(parameters): integrate DTS topology into original workbench。

## 任务 8：应用成熟视觉系统和响应式布局

**文件：** src/styles.css 与新增工作台组件。

- [ ] 先添加 dts-parameter-workbench、dts-workbench-topology、dts-workbench-list、dts-draft-tray 结构断言。
- [ ] 使用 Lucide 搜索、清除、树、筛选、查看、编辑、状态图标；仅图标按钮有 aria-label。
- [ ] 复用 --surface、--radius-lg、--shadow-soft 和全局 .button，不创建第二按钮系统。
- [ ] 添加 hover、selected、draft、blocked、focus、disabled、skeleton、empty、error。
- [ ] 小于 1200px 折叠拓扑，小于 820px 行改卡片，小于 480px 详情满高、交互目标至少 44px、长路径换行。
- [ ] 运行前端聚焦测试和 npm run build，提交 feat(parameters): polish integrated DTS workbench UX。

~~~css
.dts-parameter-workbench {
  display: grid;
  gap: 16px;
  min-width: 0;
}

.dts-workbench-body {
  display: grid;
  grid-template-columns: minmax(260px, 300px) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
~~~

## 任务 9：可见验收、双语文档和最终门禁

- [ ] 更新 PARAM-TOPOLOGY-BROWSE-001、PARAM-TOPOLOGY-EDIT-001、PARAM-HAPPY-001，通过可见工作台执行搜索→树→行→详情→typed draft→本轮修改→角色提交→审核→merge。
- [ ] 不增加 repository/DB 业务绕过。
- [ ] 更新中英文 FRONTEND，记录 API 模式是融合语义工作台，不是纯拓扑替代或旧推荐值表。
- [ ] 审阅并记录 browser requirement 和 operation ID。
- [ ] 运行 contract:check、docs:check、build、test:all、git diff --check。
- [ ] 使用 playwright-cli 在 1440×900、768×1024、390×844 完成 snapshot、screenshot、console、network、交互和无溢出检查。
- [ ] 运行聚焦 topology acceptance、无 --skip-preflight/--skip-gates 的标准 local-non-hdc browser acceptance，以及 acceptance:evidence。
- [ ] 只从完整干净成功 full run 发布 generated evidence。
- [ ] 完成文档门禁后提交 test(parameters): verify integrated DTS workbench acceptance。

~~~ts
await page.getByRole("searchbox", { name: "搜索 DTS 参数" }).fill("gpio_int");
await page.getByRole("treeitem", { name: /sc8562@6E/ }).click();
await expect(page.getByRole("row", { name: /gpio_int/ })).toContainText("<&gpio13 29 0>");
await page.getByRole("button", { name: "查看 gpio_int" }).click();
~~~

## 实现约束

- 当前 binding DTO 不总是提供 compatible 或完整规格详情，只展示 API 已证明字段；本前端计划不新增 endpoint。
- 当前产品没有 delete authoring 控件，保留删除展示和既有验收，不虚构删除入口。
- 当前语义 coordinator 可能一次只支持一条安全 candidate chain。展示合同可以使用 drafts 数组，但在服务端测试证明多 candidate 安全前不得宣称批量 candidate 安全；必要时只保留最新 binding draft，并在计划结果中记录限制。
- 本地 non-HDC readiness 与 TD-042 语义不变。

## 文档影响矩阵

| 领域 | 影响 | 路径 |
| --- | --- | --- |
| 仓库地图 | 审阅 | AGENTS、ARCHITECTURE、docs/README；路由无实质变化则记录不改 |
| 计划 | 更新 | 本计划、英文计划、docs/PLANS 双语文件 |
| 产品规格 | 审阅 | product spec 双语文件；预计流程政策不变 |
| 架构/领域 | 审阅 | domain-model 双语文件；语义身份不变 |
| API 合同 | 审阅 | api-contract 双语文件；预计无 endpoint/身份变化 |
| 前端设计 | 更新 | FRONTEND 双语文件、已批准设计规格 |
| 质量/测试 | 更新 | browser acceptance coverage map、user operation matrix；审阅 testing strategy |
| 可靠性/runbook | 审阅 | manual acceptance 双语文件；runtime/readiness 不变 |
| 安全/治理 | 审阅 | SECURITY 双语文件；authz/人工批准不变 |
| Generated artifact | 更新 | 仅完整干净成功 full run 的 browser/operation evidence |
| References | 审阅 | productization API contract draft；预计不改 |
| 技术债 | 审阅 | tech-debt tracker；TD-042 保持 BLOCKER |

## 文档更新门禁

完成前必须：所有 Update 行完成；所有 Review 行记录修改或明确不改原因；docs:check 通过；requirement/operation/evidence 完整；不得关闭或弱化 TD-042。

## Git 与 PR 工作流

- 执行分支：fix/parameter-topology-round6-review-blockers。
- 本计划与 Round6 共享现有分支，因为依赖的语义拓扑尚未进入 main；不 squash/rebase 历史。
- 实现智能体只在特性分支提交，不 push、不开 PR、不合并、不修改 main。
- 父智能体负责 review 和验证；保留用户改动，使用 apply_patch，禁止破坏性 reset/checkout。

## 明确不宣称

完成只证明融合前端工作台和本地验收，不代表 pilot ready、production ready、cutover ready 或 merge ready。TD-042 在干净非客户快照 apply → cutover → 整库 restore → old API smoke 演练完成前继续为 BLOCKER。
