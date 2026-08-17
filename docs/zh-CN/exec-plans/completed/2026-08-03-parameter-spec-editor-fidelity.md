# 参数定义编辑器保真度

> 状态：**已完成 2026-08-17** — 写入契约与批次 2–5 已关闭（#496、#499、#500 及本批次）
> 日期：2026-08-03
> English: [`docs/exec-plans/completed/2026-08-03-parameter-spec-editor-fidelity.md`](../../../exec-plans/completed/2026-08-03-parameter-spec-editor-fidelity.md)
> 约束性 IA：[ADR-0001](../../../adr/0001-parameter-admin-organized-by-governance-scope.md)、[ADR-0015](../../../adr/0015-governance-queues-live-with-the-object-they-govern.md)
> 相关决策：[ADR-0010](../../../adr/0010-attribution-tree-is-taxonomy-not-topology.md)（归属树是分类而非拓扑）、TD-047（`driverModule` 仅用于展示）
> 前序计划：[`2026-08-03-parameter-admin-org-ia-consolidation.md`](./2026-08-03-parameter-admin-org-ia-consolidation.md)

## 已落地与剩余

**已落地：** SE-D1（编辑器写入路径已去掉 `policyTarget`）；SE-D2 约束在 update 与 activate 上改为替换；SE-D3 服务端按键是否出现判定（`units` 不再用 `coalesce` 忽略 null）；SE-D4 激活会接受并持久化 `units` / `exampleValue`；SE-5 空展示名可往返；SE-D6 PATCH 仅在 `valueShape` 变化时运行 `assertSpecActivatable`；SE-D5 保存前 `valueShape`/`constraints` 对比，以及被引用定义的确认勾选；共用 `ValueShapeFields`；SE-17–SE-21 的 ModalDialog 外壳；批次 2 展示诚实（SE-6–SE-9）；批次 3 编辑形态（SE-10–SE-15）；批次 4 弹窗外壳余量（SE-18 分隔、SE-22 cutover class、叠层 `--z-modal-backdrop-nested`）；批次 5 `PARAM-SPEC-EDIT-001` / `PARAM-SPEC-EDIT-002` 与文档矩阵。

**剩余：** 本计划无剩余。产品作用域策略目标写入面仍为 TD-055。新 ID 的阻塞级 Playwright 暂缓（TD-079）；覆盖为单测 + playwright-cli。

## 背景

`ParameterSpecDetailDialog` 是管理员编辑参数定义的唯一入口。2026-08-03 对照 API 契约做的逐字段审查发现，弹窗与写入路径在两个方向上都对不上：它开放了服务端从不落库的编辑，隐藏了服务端本可接受的编辑，还渲染了四个取值只能是占位文本的字段。

其中三处是静默的。管理员改了字段、请求成功、提示保存完成、弹窗关闭——而数据没有变化。mock 运行时持久化了其中两处，所以组件测试在 API 并不具备的行为上是绿的。

弹窗还压在小泽悬浮按钮之下。`.parameter-spec-library-layout > .modal-backdrop` 落到基础规则的 `z-index: 1000`，因为 `styles.css:12347` 那条 `.param-admin-shell > .modal-backdrop` 要求直接子元素，而 `.xiaoze-chat-toggle-anchor` 是 `1100`。同样的问题已经在一个同级弹窗上打过补丁并留了注释：

```css
/* src/styles.css:23671 */
.organization-driver-schema-stack-backdrop {
  /* Above Xiaoze FAB (1100) so dialog actions remain clickable. */
  z-index: 1300;
}
```

本计划先关闭写入路径缺陷，再处理展示缺陷，最后是弹窗外壳。

## 目标

弹窗声明为可编辑的每个字段都能被 API 持久化；声明为只读的每个字段都是管理员能在某处处置的事实；界面上不存在永久占位。弹窗的动作按钮可点，且弹窗可以纯键盘操作。

## 非目标

- 重开 [`2026-07-30-parameter-governance-deferred-questions.md`](../../../design-docs/2026-07-30-parameter-governance-deferred-questions.md) 的 D1/D2。"对启用态定义做语义修改是否应产生新版本或直接禁止"继续挂起；本计划只让已经发生的编辑变诚实。
- 建设策略目标的编辑面。本计划移除这个已损坏的字段，见 SE-D1。
- 改动生命周期语义。废弃/恢复/版本切换行为不变。
- 在定义编辑器里做再归属。按 ADR-0010，主体的位置在模块管理里改；本计划只让这条路径可被发现。
- 重做定义库表格。

## Git 与 PR 流程

| 角色 | 允许 |
| --- | --- |
| 实现子代理 | 在 `feat/parameter-spec-editor-fidelity` 上提交；不开、不合 GitHub PR |
| 父代理 | 审查、跑验证、开/合 PR，然后同步本地 `main` |

分支：`feat/parameter-spec-editor-fidelity`，在组织 IA 合并分支之后从 `main` 切出。批次 1、2 改动 API 契约，理论上可与批次 3–4 分开发布，但验收 ID 有重叠，因此更推荐一个分支、每批次一个可审查提交。

## 本计划必须关闭的发现

证据取自运行中的应用 `/parameter-admin/specs?spec=pspec:vendor/nodename/middle_cpu:active_perf_limit`，以及下列服务端源码。

### 静默无效的写入

| ID | 发现 | 证据 |
| --- | --- | --- |
| SE-1 | **`policyTarget` 从不落库。** `updateParameterSpecBodySchema` 接受它、`handleSaveSpec` 也发送，但 `updateParameterSpec` 只写 `parameter_spec_versions` 与 `dts_property_specs`，从未触及 `parameter_policy_targets`。 | `server/modules/parameter-specs/service.ts:1222-1262`；对比 mock 的 `src/infrastructure/mock/mockParameterTopologyRepository.ts:632`，那里是会持久化的 |
| SE-2 | **约束键无法删除。** 服务端做浅合并 `{ ...spec.constraints, ...input.constraints }`。在 JSON 编辑框里删掉一个键再保存，该键原样保留。 | `server/modules/parameter-specs/service.ts:1214-1217`；`activateParameterSpec` 在 `:936-939` 有同样的合并 |
| SE-3 | **`units` 无法清空。** SQL 用 `units = coalesce($7, units)`，而客户端为清空的字段发送 `units: null`，于是 null 被读成"未提供"。`exampleValue` 在同一条路径上行为不同，因为 `JSON.stringify(null)` 产生的 jsonb `null` 能穿过 `coalesce`。 | `server/modules/parameter-specs/service.ts:1229-1242`；`buildSpecEditorSavePayload` 在 `src/components/parameter-topology/ParameterSpecDetail.tsx:149` |
| SE-4 | **激活路径丢掉三个可见字段。** `activateParameterSpecBodySchema` 不接受 `units`、`exampleValue`、`policyTarget`，`mode === "activate"` 分支也不发送——但弹窗在组织自有草稿上照样把这三个渲染成可编辑。 | `server/modules/parameter-specs/schemas.ts:159-180`；`src/components/parameter-admin-next/OrganizationSpecGovernancePanel.tsx:406-414` |
| SE-5 | **打开再保存会写入一个从未输入过的展示名。** `createSpecEditorDraft` 用 `propertyKey` 预填 `displayName`，`buildSpecEditorSavePayload` 又用 `propertyKey` 兜底。"无展示名"不可表达，也无法恢复。 | `src/components/parameter-topology/ParameterSpecDetail.tsx:75,147` |

### 校验缺口

| ID | 发现 | 证据 |
| --- | --- | --- |
| SE-23 | **PATCH 从不检查值形状完整性，而线上数据已经不合格。** `assertSpecActivatable` 要求 `cells`、`phandle-list`、`u32-array` 必须带 `bits` / `groups` / `cellsPerGroup`，但 `updateParameterSpec` 不调用它。实测启用态的 `active_perf_limit` 持有 `{"kind": "u32-array"}`，三者皆无——这是激活会拒绝的形状。这一条本身就卡住 SE-10：一个会补齐缺失键的值形状编辑器，会在"打开再保存"时静默改掉形状，也就是又一次 SE-5。 | `server/modules/parameter-specs/specCompleteness.ts:71-100`；`service.ts:1213`（无完整性调用）；运行时实测 |

### 无法承载真实取值的字段

| ID | 发现 | 证据 |
| --- | --- | --- |
| SE-6 | **业务分类恒为 `—`。** `reloadSpecs` 从不把 `businessCategory` 传进 `mapParameterSpecToLibraryRow`，定义库表格也已不再渲染该列，只剩 URL 筛选键。 | `src/components/parameter-admin-next/OrganizationSpecGovernancePanel.tsx:161-177`；`src/components/parameter-topology/ParameterSpecLibrary.tsx:92,262` |
| SE-7 | **驱动模块是所属模块的后缀。** 在 `active_perf_limit` 上实测：驱动模块 = `middle_cpu`，所属模块 = `Power / Battery / Battery Protection / hisi_vbat_drop_protect_v2 / middle_cpu`。而定义库表格中*名为*驱动模块的那一列展示的是完整路径，同一个标签在两个界面上指两件事。 | `formatSpecAttributionLabel` / `formatSpecDriverModuleLabel` 在 `src/components/parameter-topology/ParameterSpecLibrary.tsx:110-152`；TD-047 |
| SE-8 | **使用与历史是合成的。** `toSpecDetailView` 把 `usage: []` 写死，使用情况只能渲染兜底文案；`schemaHistory` 是用 `currentVersion` 拼出的单行，实测为 `v1 · vendor/nodename/middle_cpu`。 | `src/components/parameter-admin-next/OrganizationSpecGovernancePanel.tsx:65-68` |
| SE-9 | **引用数被陈述两次。** 头部显示 `引用数：0`，使用情况显示 `暂无项目参数`，说的是同一件事。 | `src/components/parameter-topology/ParameterSpecDetailDialog.tsx:150-154` |

### 编辑形态

| ID | 发现 | 证据 |
| --- | --- | --- |
| SE-10 | **`valueShape.kind` 是封闭枚举却渲染成自由 JSON。** 服务端联合类型只接受 `bool`、`empty`、`string-list`、`u32-array`、`phandle-list`、`bytes`、`mixed`、`unknown`。 | `server/modules/parameter-specs/schemas.ts:251-261` |
| SE-11 | **四个视觉相同的等宽编辑框，两套契约。** `parseJsonField` 对示例值与策略目标做了特判，解析失败时按纯字符串收下；而值形状与约束必须是 JSON 对象。实测的示例值是一段 DTS 片段，不是 JSON。 | `src/components/parameter-topology/ParameterSpecDetail.tsx:96-98` |
| SE-12 | **值类型与值形状陈述同一事实且会失同步。** 值类型只读，在加载时从 `valueShape.kind` 派生；编辑 JSON 不会更新它。 | `src/components/parameter-topology/ParameterSpecLibrary.tsx:63-70` |
| SE-13 | **修改原因必填但无标记。** 只有点保存后才校验。 | `src/components/parameter-topology/ParameterSpecDetail.tsx:136-138,394-402` |
| SE-14 | **只读仅靠底色区分。** 实测 `rgb(240, 243, 255)` 对 `rgb(255, 255, 255)`，边框完全一致，没有图标或文字标记。 | `src/styles.css:16425-16430` |
| SE-15 | **废弃态定义头部仍宣称可编辑。** `editable` 是 `typeof onSave === "function"`，不看 `isDeprecated`，而正文用 `editable && !isDeprecated` 渲染。 | `src/components/parameter-topology/ParameterSpecDetailDialog.tsx:48,139,225` |
| SE-16 | **文档记载的保存前 diff 并不存在。** D2 写明"前端在保存前展示 diff 与引用数"。引用数在，定义编辑器里没有任何 diff 组件。 | `docs/design-docs/2026-07-30-parameter-governance-deferred-questions.md:41` |

### 弹窗外壳

| ID | 发现 | 证据 |
| --- | --- | --- |
| SE-17 | **小泽 FAB 渲染在模态之上并盖住保存按钮。** 实测遮罩 `z-index: 1000` 对 FAB `1100`；1024×747 下 FAB 占 `x 944-1000, y 667-723`，保存占 `x 905-969, y 645-679`。 | `src/styles.css:9425-9428,12347,12729-12733`；已修补先例在 `:23671-23674` |
| SE-18 | **滚动边界把输入框拦腰截断且无任何提示。** 正文滚动高度 1545px 对可视 640px；动作条紧贴裁切处，无分隔线也无阴影。 | `.param-admin-editor-dialog-body` 在 `src/styles.css:16694-16700` |
| SE-19 | **焦点从不进入弹窗。** 打开后 `document.activeElement` 仍是模态背后的编辑按钮；没有焦点陷阱，Tab 会到达背景内容。 | 运行时实测 |
| SE-20 | **`role="dialog" aria-modal="true"` 挂在全屏遮罩而非弹窗卡片上。** `h2` 上的 `id="parameter-spec-detail-dialog-title"` 无人引用——`aria-labelledby` 未被使用。 | `src/components/parameter-topology/ParameterSpecDetailDialog.tsx:126-140` |
| SE-21 | **在废弃/恢复确认框内按 Escape 会关掉编辑器。** keydown 监听没有检查 `lifecycleKind`。确认框的取消按钮也缺 `disabled={pending}`。两个弹窗同时是 `aria-modal="true"`。 | `src/components/parameter-topology/ParameterSpecDetailDialog.tsx:71-79,278-317` |
| SE-22 | **版本切换面板使用内联样式。** `style={{ marginBottom: "1rem" }}` 与 `style={{ marginTop: "0.75rem" }}`，正是前序计划在别处清除过的反模式。 | `src/components/parameter-topology/ParameterSpecDetailDialog.tsx:169,189` |

## 决策（2026-08-03 已定）

### SE-D1 —— 策略目标从弹窗移除

`parameter_policy_targets` **在整个仓库里没有任何写入方**。`insert into parameter_policy_targets` 零匹配；`migration.ts:1468` 写明 "Never promote recommended_value into schema_default or policy_target"；`migration.test.ts:796-800` 断言迁移后该表为空。三个读取方（`repository.ts:1227`、`editService.ts:354`、`perceptionTools.ts:121`）在读一张没人写的表。

因此该字段展示的值恒为 null，接受的编辑无处可去。它在结构上也无法作为定义级字段工作：该表以 `(organization_id, parameter_spec_id, product_code)` 为键，而详情读取取的是所有产品中最近更新的那一行。

从弹窗、`updateParameterSpecBodySchema`、`UpdateParameterSpecInput` 与 mock 中移除 `policyTarget`。表与三个读取方保持不动。为产品维度的策略目标编辑面登记 **TD-055**。

### SE-D2 —— `constraints` 改为替换而非合并

2026-08-03 枚举结果：`PATCH /api/v2/parameter-specs/:specId` 的生产调用方只有 `OrganizationSpecGovernancePanel.tsx:417`；`activateParameterSpec` 有两处，同在该文件（`:407`、`:650`）。其余引用全是测试。`assertSpecActivatable` 仅在 `constraints.cells` 为数字时才校验（`specCompleteness.ts:101-124`），因此删键不会破坏激活。现有审计测试从 `previousConstraints: {}` 起步（`specLifecycle.integration.test.ts:310`），不受影响。

对 `updateParameterSpec` 与 `activateParameterSpec` 一并改为替换。需要注意：activate 当前的合并允许调用方省略 constraints 而继承草稿推断出的 `{ cells: N }`；改为替换后客户端必须发送完整对象——编辑器本就如此，因为 `constraintsText` 由存储值播种。

### SE-D3 —— 以"键是否出现在解析后的 body 中"作为意图信号

zod 本来就保住了这个区分：`units: null` 解析为 `null`，省略则为 `undefined`；是服务端的 `coalesce` 把它扔掉了。把每处 `coalesce` 换成 `case when $flag then $value else column end`，其中 `$flag` 为 `input.field !== undefined`。同时应用于 `units`、`displayName`、`description`、`exampleValue`，让这四者不再无意中行为各异。

把 `displayName` 与 `description` 改为 `.nullable().optional()` 以便发送 null，并在 `createSpecEditorDraft` 与 `buildSpecEditorSavePayload` 中去掉前端的 `propertyKey` 兜底。**这一处改动同时关闭 SE-5。**

### SE-D4 —— 扩大 activate 载荷，并让编辑器复用创建对话框的值形状控件

`createParameterSpecBodySchema` 本就接受 `units` 与 `exampleValue`，`SpecCreateDialog.tsx:288-289` 也确实设置了两者。草稿因此可能从出生就带着它们，而在激活之前无从修正。隐藏字段会让"创建 → 激活"这条路有损。

为 `activateParameterSpecBodySchema` 增加 `units` 与 `exampleValue`，与 update 对齐。不加 `policyTarget`（SE-D1）。

`SpecCreateDialog` 已经把 SE-10 与 SE-11 做对了：`valueShapeKind` 是基于 `VALUE_SHAPE_OPTIONS` 的 `<select>`，配合由 `buildValueShape` 组装的条件式 `bits` / `groups` / `cellsPerGroup` / `length` 数字输入，`defaultConstraintsForShape` 兜底并带示例占位符，示例值标注为"（JSON，可空）"并走 `parseOptionalJson`。抽取该控件在编辑器中复用，不要再写第二份。

实现注意（非决策）：`assertSpecActivatable` 的 `storedValueShape` 守卫（`specCompleteness.ts:137-149`）在草稿已有推断形状时，禁止激活阶段改动 `kind` / `bits` / `groups` / `cellsPerGroup` / `length` / `cells`。当前草稿提示「值形状 valueShape · ⓘ 激活前可修订」对这类草稿是错的，需一并改。

### SE-D5 —— 实现保存前 diff

D2 的审计那一半已经落地：`spec-updated` 元数据携带 `previousValueShape`、`nextValueShape`、`previousConstraints`、`nextConstraints`，由 `specLifecycle.integration.test.ts:310` 覆盖。缺的只是前端那一半，而且成本很低——`detail.valueShape`、`detail.constraints` 与草稿文本都在手上。

在 `valueShape` 或 `constraints` 任一发生变更时展示前后对比，并在 `referenceCount > 0` 时要求显式二次确认。`2026-07-30-parameter-governance-deferred-questions.md:41` 由此变为字面为真。

### SE-D6 —— PATCH 校验值形状，但仅当它发生变更时

`updateParameterSpec` 从不调用 `assertSpecActivatable`，而存量启用态数据已经违反它（SE-23）。无条件校验会让每一条存量违规都挡住无关的文档修改；完全不校验则会让新的形状编辑器写出激活拒绝的形状。

仅当传入的 `valueShape` 与存储值不同时，从 `updateParameterSpec` 调用 `assertSpecActivatable`。与之配套的 SE-23 约束：形状编辑器在加载时不得自动补齐缺失键，这样打开并保存一条不完整的历史定义在形状上仍是空操作。

## 风险

| ID | 风险 | 必须的处理 |
| --- | --- | --- |
| SE-R1 | **关闭 SE-2 与 SE-3 会改变既有调用方的写入语义。** | 调用方枚举已完成（见 SE-D2），两边各只有一个生产调用方。剩余处理：在 `specLifecycle.integration.test.ts` 中补"删除约束键""清空单位""清空展示名"的服务端集成覆盖，以及两个新字段的 activate 路径用例。 |
| SE-R2 | **mock 与 API 在 `policyTarget` 上已经不一致。** 在 SE-D1 之下，mock 在 `:632` 的持久化会变成死代码，仍会让组件测试对一个已移除的字段保持绿色。 | 在与服务端同一批次改 `mockParameterTopologyRepository.ts`，不要拖到之后。 |
| SE-R3 | **移除 SE-5 的兜底会改变"展示名为空"的含义。** | 确认没有读取方假设 `displayName` 非空。`formatSpecPrimaryLabel` 本就使用 `propertyKey`，展示是安全的，但检查必须覆盖工作台、审核队列候选标签与导出路径。 |
| SE-R4 | **把驱动模块并入所属模块会触及 TD-047 的展示专用契约与验收选择器。** | API `driverModule` 保持不变。仅在弹窗内重命名或移除；若表格列改名，须在同一提交中重新指向每一个读取列头的验收选择器。 |
| SE-R5 | **把模态抬到 FAB 之上不能同时越过小泽弹层。** | 弹层是 `1200`，两个同级遮罩已经占了 `1300` / `1400`。修复选择器，让 `.param-admin-shell` 的后代继承一个有意为之的值，而不是再加第四个随手数字。 |
| SE-R6 | **焦点陷阱必须跟随最顶层弹窗。** 废弃/恢复确认框叠在编辑器之上。 | 按弹窗分别做陷阱与焦点归还，并让 Escape 只关闭最顶层的那个（SE-21）。 |
| SE-R7 | **删除使用与历史分组会移除操作者可能依赖的界面。** | 在选择删除而非补数据之前，确认该分组对所有定义都是占位，而不只是抽样的那一条。 |

## 交付批次

### 批次 1 — 静默无效的写入

1. [x] 决定 SE-D1 至 SE-D6，并把每条记入本计划。
2. [x] 关闭 SE-1：从弹窗、`updateParameterSpecBodySchema`、`UpdateParameterSpecInput` 与 mock 移除 `policyTarget`；为产品维度的编辑面登记 TD-055。
3. [x] 关闭 SE-2：约束在 `updateParameterSpec` 与 `activateParameterSpec` 上改为替换。
4. [x] 一并关闭 SE-3 与 SE-5：`units` / `displayName` / `description` / `exampleValue` 用 `case when $flag` 取代 `coalesce`（SE-3 已在 `main`）；`displayName` 与 `description` 改为可空；去掉前端的 `propertyKey` 兜底（SE-5）。
5. [x] 关闭 SE-4：`activateParameterSpecBodySchema` 增加 `units` 与 `exampleValue`，activate 分支随之发送（已在 `main`）。
6. [x] 按 SE-D6 关闭 SE-23：`valueShape` 变更时 `updateParameterSpec` 执行 `assertSpecActivatable`。
7. [x] 本批次每一处契约变更都让 mock 同步（SE-R2）。
8. [x] 按 SE-R1 补服务端集成覆盖。

### 批次 2 — 无法承载真实取值的字段

9. [x] 移除业务分类（SE-6）以及失效的 `businessCategories` / `category` URL 筛选键。定义库行不再携带未使用的 `businessCategory`。
10. [x] 把定义库中*名为*驱动模块的列收敛为所属模块（SE-7），与弹窗字段和列筛选标签一致。API `driverModule` 不变（SE-R4）。声明主体的纠正仍走「修正归属」（ADR-0017）；不要为此把操作者打发到模块管理。
11. [x] 删除「使用与历史」分组（SE-8 / SE-R7）。`toSpecDetailView` 始终发送空 `usage`，以及由 `currentVersion` 拼出的一行假 `schemaHistory`（TD-048：每个定义都是 version 1）。
12. [x] 弹窗头部只保留一处「引用数」（SE-9）。

### 批次 3 — 编辑形态

13. [x] 把 `SpecCreateDialog` 的值形状控件（`VALUE_SHAPE_OPTIONS`、`needsCellFields`、`buildValueShape`、`defaultConstraintsForShape`）抽成共享组件并在编辑器中使用（SE-10、SE-12、SE-D4）。它不得自动补齐存储形状所缺的键（SE-23）。已落地为 `ValueShapeFields` 的 `mode="edit"`。
14. [x] 从编辑器去掉值类型（SE-12）。定义库表仍以 `valueType` 展示上次保存的 kind 快照；弹窗不再在形状控件旁复述。
15. [x] 在视觉与语义上区分 JSON 编辑框与自由文本框（SE-11）：约束是带即时校验的 JSON 对象编辑器；示例值接受 DTS 或 JSON，不会把片段当成非法 JSON。
16. [x] 在保存确认步标记修改原因为必填（SE-13：`aria-required`、必填提示、未填则禁用确认）。用只读/实测/声明提示标记只读字段，而不只靠底色（SE-14）。
17. [x] 修正废弃态定义的可编辑/只读眉标（SE-15）。草稿提示「激活前可修订」已去掉；组织草稿仍说明保存即激活。
18. [x] 按 SE-D5 关闭 SE-16：`valueShape` 与 `constraints` 的前后对比，`referenceCount > 0` 时加二次确认。

### 批次 4 — 弹窗外壳

> **SE-17 – SE-21 是共享弹窗缺陷，不是本弹窗独有的。** 共享原语已经存在：`src/components/common/` 下的 `ModalDialog` 与 `ConfirmDialog` 随 [`2026-08-05-project-operations-dialog-hardening.md`](./2026-08-05-project-operations-dialog-hardening.md)（POD-D4，2026-08-05 完成）交付，负责 z-index 刻度、焦点陷阱与归还、背景 `inert`、卡片级 `role="dialog"` + `aria-labelledby`、仅最顶层响应 Escape、遮罩关闭成对判定。因此下面第 19–23 项应作为**接入原语**一次性交付，而不是五处独立修复；迁移债见 TD-059。注意原语会 portal 到 `document.body`，任何写成页面级类后代的弹窗样式都需要补一份按遮罩类名的选择器。只有第 23 项里「取消在 pending 时禁用」和第 24 项仍是本弹窗特有。

19. [x] 修复遮罩层叠，使弹窗动作永不被遮挡（SE-17、SE-R5）——共享 z-index 刻度（`--z-modal-backdrop` 1150 > FAB 1100；叠层确认 `--z-modal-backdrop-nested` 1160；聊天弹层仍为 1200）。
20. [x] 给滚动边界加分隔线或阴影，并避免拦腰截断字段（SE-18）——外壳归原语；编辑区保持 `overflow: auto`，动作条以 `--border` 分隔，并设 `scroll-padding-bottom`。
21. [x] 加入焦点陷阱、初始焦点与焦点归还（SE-19、SE-R6）——经原语。
22. [x] 把 `role="dialog"` 移到弹窗卡片上并使用 `aria-labelledby`（SE-20）——经原语。
23. [x] 把 Escape 收敛到最顶层弹窗；确认框的取消在 pending 时禁用（SE-21）（保存、版本切换、生命周期、身份）。
24. [x] 用类替换版本切换面板的内联样式（SE-22）。

### 批次 5 — 测试、验收、文档

25. [x] 为 `buildSpecEditorSavePayload` 与 `createSpecEditorDraft` 的每条变更规则补单测。
26. [x] 登记并覆盖下列新验收 ID。
27. [x] 完成文档影响矩阵，含 TD-055。
28. [x] 在 1440×900 / 768×1024 / 390×844 下产出 playwright-cli 证据，0 控制台错误，覆盖启用态定义、组织自有草稿与废弃态定义。2026-08-17 mock 走查 `http://127.0.0.1:5180/parameter-admin/specs`（会话 `spec-batch4`）：截图在 `work/ui-checks/param-spec-editor-batch4/`。编辑器遮罩 `z-index` 1150，叠层确认 1160；Escape 只关最顶层。mock 无小泽 FAB（`fab: false`）；EDIT-002 的 FAB 重叠由刻度闭合（`--z-xiaoze-fab` 1100 < `--z-modal-backdrop` 1150 < `--z-xiaoze-popup` 1200）。点击打开后 Escape，焦点回到「编辑 gpio_int」。

## 关键接缝（切入点）

- 弹窗外壳、生命周期二级弹窗、版本切换面板：`src/components/parameter-topology/ParameterSpecDetailDialog.tsx`。
- 字段布局、草稿构造、载荷构建、JSON 解析：`src/components/parameter-topology/ParameterSpecDetail.tsx`。
- 行映射与归属标签工具：`src/components/parameter-topology/ParameterSpecLibrary.tsx:40-152`。
- 详情视图组装与保存派发：`src/components/parameter-admin-next/OrganizationSpecGovernancePanel.tsx:31-70,389-445`。
- 写入契约：`server/modules/parameter-specs/schemas.ts:159-207`；服务在 `service.ts:905-1294`。
- 详情读取（含策略目标 lateral join）：`server/modules/parameter-specs/repository.ts:1195-1270`。
- mock 对等：`src/infrastructure/mock/mockParameterTopologyRepository.ts:587-640`。
- 层叠：`src/styles.css:9425,12347,12729,23671`。

## 文档影响矩阵

| 领域 | 动作 | 路径 |
| --- | --- | --- |
| 仓库地图 | Review | `AGENTS.md`、`ARCHITECTURE.md` — 确认二者都未描述定义编辑器的字段 |
| 规划 | Update | 本计划；`docs/PLANS.md`；`docs/zh-CN/PLANS.md`；英文伴生计划；`docs/exec-plans/tech-debt-tracker.md` 的 TD-055 及其他延后项 |
| 架构 / ADR | Review | SE-D2 已定性为缺陷修复而非新治理规则，预期无需 ADR；把这个结论记下来，不要留空 |
| 领域词表 | Update | `CONTEXT.md` —— 「Policy target」须写明该概念今天没有写入方（SE-D1），以免下一位读者重建同一个死字段 |
| 产品规格 | Review | `docs/product-specs/prototype-functional-spec.md` 中关于定义编辑的描述 |
| API 契约 | Update | `docs/design-docs/api-contract.md` 与 `docs/references/productization-api-contract-draft.md` 中变化的 PATCH / activate 载荷 |
| 设计文档 | Update | `docs/design-docs/2026-07-30-parameter-governance-deferred-questions.md:41` 在 SE-D5 之后必须为真；注明 D2 与 SE-2 的关系 |
| 前端 / 设计 | Update | `docs/FRONTEND.md` 与 `docs/zh-CN/frontend.md` 中描述定义编辑器的部分 |
| 质量 / 测试 | Update | `docs/developer/browser-acceptance-coverage-map.md`（含中文）与 `docs/developer/user-operation-coverage-matrix.md`（含中文）中的新 ID |
| 安全 / 治理 | Review | `docs/SECURITY.md` — `spec-updated` 的审计元数据应反映任何新落库的字段 |
| 可靠性 / 运行手册 | Review | 若 `docs/runbooks/parameter-identity-cutover.md` 引用了编辑器 |
| 生成物 | Review | `docs/generated/acceptance-operation-evidence.md`；若有迁移落地则含 `docs/generated/db-schema.md` |
| 参考 | Review | `docs/references/*` 中引用的编辑器文案或字段清单 |

## 文档更新闸门

在把本计划移入 `completed/` 之前：

1. 影响矩阵中每一条 `Update` / `Review` 都已更新，或以证据记录为无变化。
2. SE-D1 至 SE-D6 连同理由一并记录 —— 已于 2026-08-03 完成；仅在实现推翻某条时才重开。
3. 二十三条 SE 发现全部关闭，或显式延后进 `exec-plans/tech-debt-tracker.md`。
4. 七条 SE-R 风险都以证据关闭。
5. 已为产品维度的策略目标编辑面登记 TD-055（SE-D1）。
5. `npm run docs:check`、`npm run acceptance:coverage`、`npm run acceptance:operations` 全绿。

## 文档矩阵收口（2026-08-17）

| 领域 | 结果 |
| --- | --- |
| 仓库地图 | 无变化。`AGENTS.md` 与 `ARCHITECTURE.md` 未描述定义编辑器字段。 |
| 规划 | 本计划完成；`docs/PLANS.md` / `docs/zh-CN/PLANS.md` 从剩余工作中移除；TD-055 已在债表。 |
| 架构 / ADR | 无新 ADR。SE-D2 是替换而非合并的缺陷修复。ADR-0016 计划路径改为 `completed/`。 |
| 领域词表 | `CONTEXT.md` 的 Policy target 行写明今天无生产写入（SE-D1 / TD-055）。领域模型中英同步。 |
| 产品规格 | 无变化。`prototype-functional-spec.md` 仍分字段暴露 example / schema default / policy target / effective。 |
| API 契约 | PATCH 已记载。activate 请求体补上可选 `units` / `exampleValue`。`docs/references/productization-api-contract-draft.md` 无编辑器字段清单。 |
| 设计文档 | 延后问题 D2 段落与已上线的保存前 diff（SE-D5）一致，并注明 SE-2 是写入诚实而非 D2 裁决。 |
| 前端 / 设计 | `docs/FRONTEND.md` / `docs/zh-CN/frontend.md` 记录 ModalDialog 外壳、叠层 z-index、滚动分隔与 cutover class。 |
| 质量 / 测试 | 已登记 `PARAM-SPEC-EDIT-001` / `002`；Blocking No；操作为 `future` 并写明暂缓理由（TD-079）。 |
| 安全 / 治理 | 无变化。`docs/SECURITY.md` 未引用 `spec-updated` 字段清单；审计 kind 在 API 契约。 |
| 可靠性 / 运行手册 | 无变化。`docs/runbooks/parameter-identity-cutover.md` 未引用定义编辑器。 |
| 生成物 | 无变化。无迁移。 |
| 参考 | 除 API 契约孪生外无变化。 |

## UI 交互覆盖

本计划改动表单行为、模态行为，以及驱动可见 UI 状态的后端响应，因此适用 UI 交互自动化规则。

现有 ID 及其暴露面：

- `PARAM-SPEC-GOVERN-001`（阻塞级）走的是定义匹配审核而非编辑器，应保持通过不变。
- `PARAM-ADMIN-IA-001`（来自前序计划）覆盖组织子导航，必须保持通过。
- 没有任何现有 ID 断言"在定义编辑器里所做的修改，重新打开弹窗后仍然存在"。正是这一缺口让 SE-1 至 SE-5 存活至今。

在宣称实现完成**之前**需要在 `docs/developer/browser-acceptance-coverage-map.md` 登记的新 ID：

- `PARAM-SPEC-EDIT-001` — 管理员在启用态定义上编辑单位、约束、示例值与参数说明，保存后重新打开，每个值都往返一致；删除约束键确实删除；清空单位确实清空。
- `PARAM-SPEC-EDIT-002` — 在 1440×900 / 768×1024 / 390×844 且小泽 FAB 存在的情况下，编辑器动作可达可操作；打开时焦点进入弹窗，关闭时焦点回到触发元素。

## 验证

```bash
npm test -- src/components/parameter-topology
npm test -- src/ParameterAdminNextPage.test.tsx src/ParameterAdminNextPage.a11y.test.tsx
npm run test:server -- parameter-specs
npm run build
npm run docs:check
npm run acceptance:coverage
npm run acceptance:operations
# 浏览器证据置于 work/ui-checks/param-spec-editor/
```
