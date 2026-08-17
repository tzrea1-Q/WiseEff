# 参数定义身份纠错

> 状态：**进行中** — 批次 1–4 已于 2026-08-17 实现；等待父代理归档
> 日期：2026-08-04
> English: [`docs/exec-plans/active/2026-08-04-parameter-definition-identity-correction.md`](../../../exec-plans/active/2026-08-04-parameter-definition-identity-correction.md)
> 约束性决策：[ADR-0017](../../../adr/0017-definition-identity-is-correctable.md)
> 修订：[ADR-0013](../../../adr/0013-attribution-subjects-are-stable-catalog-entities.md)、[ADR-0014](../../../adr/0014-parameter-definitions-are-versioned-subjects.md)
> 前序计划：[`2026-08-03-parameter-spec-editor-fidelity.md`](../completed/2026-08-03-parameter-spec-editor-fidelity.md)

## 背景

前序计划关闭 SE-7 的做法是把驱动模块与所属模块合并成一个只读归属字段并给出模块管理入口，同时把"在编辑器里做再归属"列为明确非目标，理由是"按 ADR-0010，主体的位置在模块管理里改；本计划只让这条路径可被发现"。

2026-08-04 复查这个字段时发现，该非目标建立在一个错误前提上。模块管理能改名、移动模块、编辑 compatible / node-type 映射、重算绑定的 `module_id`、编辑注册元数据，但**没有任何路径写 `parameter_specs.attribution_subject_id`**——没有路由、没有服务、除迁移回填外没有 SQL。也就是说，创建时选错归属主体的操作者被指向了一个根本修不了这件事的页面，只能靠穷尽尝试才发现真实出路是废弃后重建。

而这条出路比听起来更糟。定义没有删除路由，废弃是软废弃（ADR-0011），所以每次纠错都会在目录里永久留下一条错误定义——它仍在审计中、仍可参与解析发布、仍在库检索里竞争。ADR-0014 当初拒绝"每次语义变更都新铸一个身份"时给的理由正是这个：身份抖动会破坏引用计数与连续性。

两个字段只读并不是 UI 保守。`parameter_specs.id` 就是身份三元组的哈希，且有三处"找不到就建"的路径靠重算这个哈希来判断定义是否存在。改了存储的身份字段而 id 不变，这些路径就会认定定义不存在并插入重复行。所以要让字段可编辑，必须先把 id 降级为代理键——这正是 ADR-0017 所定的事。

## 目标

管理员能在定义库中就地纠正被写错的参数定义身份，带审计轨迹，不需要废弃定义，不丢失版本历史与绑定，且不存在把一个属性静默拆成两条目录行的可能。

## 非目标

- 重命名已被项目引用的 `property_key`。按 D-ID-2 继续拒绝；ADR-0017 把它记为分阶段切换的待议问题，而不是编辑器字段。
- 改变归属范围（owner scope）。把组织定义提升到平台仍走独立的提升路径（对应 ADR-0009）。
- 定义的硬删除。仍在范围外，与 ADR-0011 一致。
- 让 `specification_key` 不再作为展示来源。D-ID-3 通过重写它来保持正确；清理那约二十处解析点属于 ADR-0017 的后续项。
- 再归属时改指已有绑定。绑定的 `module_id` 仍按 ADR-0010 由映射解析。
- 重开单元格数组的布局治理，该问题已由 [ADR-0016](../../../adr/0016-cell-arrays-are-governed-by-column-width-only.md) 定案。

## Git 与 PR 流程

| 角色 | 允许 |
| --- | --- |
| 实现子代理 | 在 `feat/parameter-definition-identity-correction` 上提交；不开、不合 GitHub PR |
| 父代理 | 审查、跑验证、开/合 PR，然后同步本地 `main` |

分支在编辑器保真度分支合并后从 `main` 切出。批次 1 是行为不变的重构，有自己的验证门禁，应与批次 2 分成不同的可审查提交——因为批次 1 出错的表现是产生重复行，而不是报错。

## 本计划必须关闭的发现

证据于 2026-08-04 从下列来源收集。

| ID | 发现 | 证据 |
| --- | --- | --- |
| ID-1 | **`attribution_subject_id` 创建后没有写入方。** `updateParameterSpecBodySchema` 与 `activateParameterSpecBodySchema` 都不接受它，两处服务 UPDATE 都不碰它。ingest 的 upsert 用 `coalesce(…, excluded.…)`，只填空不覆盖。 | `schemas.ts:159-208`；`service.ts:1154-1161,1241-1287`；`repository.ts:1325-1326` |
| ID-2 | **`property_key` 创建后没有写入方。** 两个请求体同样缺失；唯一的 `property_key` 更新是 ingest upsert，而其 `id` 本身由该 key 派生，因此改不了它。 | `schemas.ts:159-208`；`repository.ts:1372-1384`；`specIdentity.ts:149-151` |
| ID-3 | **只读提示把操作者引向一个帮不上忙的页面。**「归属在 模块管理 中调整」链到 `/parameter-admin/modules`，那里写 `parameter_modules`、`parameter_module_mappings`、`driver_registrations` 和绑定的 `module_id`，从不写 `parameter_specs.attribution_subject_id`。 | `ParameterSpecDetail.tsx:304-307`；`parameter-modules/service.ts:512-716`；`parameterModuleRepository.ts:311-407` |
| ID-4 | **身份是行的地址，不只是被存储的事实。** 三处 find-or-create 靠重算 `buildSubjectScopedManualSpecIds` 判断定义是否存在。 | `provisionalSurfaceBinding.ts:22`；`reviewApply.ts:483`；`driverSchemaOverlayService.ts:110`；生成器在 `specIdentity.ts:139-144` |
| ID-5 | **身份唯一性只被间接约束。** 约束是 `unique nulls not distinct (organization_id, source_kind, specification_key)`，落在一个派生字符串上；三元组本身没有约束。 | `0048_parameter_topology_schema_shadow.sql:15`；派生逻辑在 `specIdentity.ts:137-138` |
| ID-6 | **`property_key` 与 `attribution_subject_id` 不在同一张表。** key 在 `dts_property_specs`（通过唯一的 `parameter_spec_id` 一对一），subject 在 `parameter_specs`，因此按现状无法在单表上表达三元组约束。 | `0048_parameter_topology_schema_shadow.sql:9-16,53-64` |
| ID-7 | **`specification_key` 被约二十处读取点当作事实解析。** 多数已改为优先 `coalesce(dps.property_key, …)`，但模块筛选、迁移匹配器、语义身份命名、模块仓储、小泽感知仍在直接解析它。 | `semanticParameterReads.ts:58`；`migration.ts:230-252`；`semanticParameterIdentityNames.ts:17-30`；`parameter-modules/repository.ts:379-381`；`perceptionTools.ts:90-93` |
| ID-8 | **编辑器连"当初选了哪个主体"都显示不出来。** `attributionSubjectId` 在详情 DTO 里但未渲染；所属模块优先展示实测绑定，无绑定时回退到主体**显示名**加「（未实测）」，因此一个名字看着合理的错误主体与正确主体无法区分。 | `schemas.ts:35`；`formatSpecAttributionLabel` 在 `ParameterSpecLibrary.tsx:110-121`；`repository.ts:1077-1138,1186-1188` |

## 决策（2026-08-04 定案）

### D-ID-1 — 行 id 降级为代理键，查找改为按列解析

被否方案是保留 `id` 为身份哈希、在约十二张带 `parameter_spec_id` 的表上级联重写 id。这在单个事务里机械可行，但审计行以旧 id 作为 `target_id`，纠错动作会抹掉自己的轨迹。完整论证见 ADR-0017。

三处 find-or-create 改为用 `(organization_id, attribution_subject_id, property_key)` 查询定位既有定义，`buildSubjectScopedManualSpecIds` 只在即将插入新行时用于生成 id。既有行的历史 id 保持不动。

### D-ID-2 — 两个字段的门禁不同

再归属改变的是定义被归类和被声明覆盖的位置，从不改变写入设备的字节，因此在任意生命周期状态下都允许，包括已启用且有引用。

`property_key` 改名会改变写进每个已绑定项目 DTS 的属性名。在有引用的情况下这是对已交付配置的语义变更而非纠错，应归入分阶段切换（ADR-0014）而不是内联字段。仅在 `referenceCount = 0` 时允许，引用数由既有的 `loadReferenceCountsBySpecIds` 计算（`repository.ts:1056-1075`）。

### D-ID-3 — `specification_key` 同步重写

冻结它会让被纠正的定义在 ID-7 那五处直接解析点上仍按错误身份参与筛选与匹配。它继续作为派生值，在同一事务内按新三元组重算，并保留既有唯一约束作为新三元组索引之外的第二道防线。

`dts_property_specs.schema_namespace` 由同一主体派生，随之重写。

### D-ID-4 — 纠错是二级动作，不是内联字段

身份纠错不属于内容编辑：它的授权后果不同、两个字段的门禁不同、失败形态（重复行）也是普通字段编辑不具备的。把它做成又一个可编辑输入框，会招致操作者在调文档时顺手改掉它。

每个字段配一个显式的"修正"动作，打开的确认框陈述前后身份、引用数，改名被拒时说明有引用这一原因。主体选择器复用 `SpecCreateDialog` 已有的主体树（`subjectsFromModules` + 归属主体控件），不另写一套。

### D-ID-5 — 让"实测"与"声明"的区别可见

ID-8 意味着操作者无法核对自己被要求纠正的那个事实。所属模块继续报告实测绑定，因为那是真实且有用的事实；同时把声明的归属主体作为独立的、有标签的只读行并列展示，"修正"动作挂在它上面。这也顺带消除了「（未实测）」静默把字段含义从实测切换为声明所造成的歧义。

## 风险

| ID | 风险 | 必要处理 |
| --- | --- | --- |
| ID-R1 | **查找层重构出错会静默产生重复定义。** 不会有任何报错：ingest 只是为一个属性建出第二行，把绑定拆开。 | 批次 1 单独落地并单独验证，先于任何写入路径存在。集成测试必须断言：同一身份重复 ingest 恰好产生一行；纠错之后 ingest 解析到被纠正的那一行，而不是重建旧行。 |
| ID-R2 | **三元组唯一索引可能在现有数据上建不起来。** 若历史上已有两行共享同一三元组——这有可能，因为唯一性一直只落在派生 key 上，而遗留哈希公式是有损的（`findLegacyManualSpecIdentityCollisions` 的存在正是为此）——迁移 `0090` 会中止。 | 写迁移前先跑重复项预检查询。若存在重复，迁移必须带报告 fail-closed，与 `0088` 处理无法解析行的方式一致；不得静默挑一个赢家。 |
| ID-R3 | **纠正主体可能与既有定义冲突。** 目标三元组可能已被占用，且占用方可能是默认库视图里不可见的废弃行。 | 返回 409 并带上冲突定义的 id 与生命周期，让操作者看到"被一条废弃定义挡住"，而不是一个无从解释的失败。 |
| ID-R4 | **重写 `specification_key` 会改变派生的展示与匹配行为。** 迁移匹配器（`migration.ts:230-252`）按它给候选排序。 | 按 D-ID-3 视为预期行为，但需验证未被纠正的行其排序不受影响，并在 API 契约中注明该字段是派生的、可能变化。 |
| ID-R5 | **平台全局定义不得被普通组织管理员纠正。** | 复用废弃/恢复的归属划分：持 `platform-admin` 时才用 `requireOrgOrGlobalSpec`，否则 `requireOrgOwnedSpec`。 |
| ID-R6 | **mock 运行时不会知道新能力**，会让组件测试在 API 不具备的行为上是绿的——正是前序计划 SE-R2 踩过的坑。 | 与服务端同批次改 `mockParameterTopologyRepository.ts`，不要留到之后。 |
| ID-R7 | **再归属后 `attributionModules` 会与声明的主体不一致**，直到下一次 ingest。 | 按 ADR-0017 这是设计使然，但 D-ID-5 的标签必须让"实测 vs 声明"可读，以免这种不一致被当成缺陷。 |

## 交付批次

### 批次 1 — 让查找与身份哈希解耦（行为不变）

1. [x] 对现有行按 `(organization_id, attribution_subject_id, property_key)` 跑重复项预检（ID-R2）。
2. [x] 迁移 `0090`：三元组唯一索引，遇重复 fail-closed，并解决 ID-6 的跨表问题。
3. [x] 新增单一的 `findParameterSpecByIdentity`，把三处 find-or-create 全部改走它，`buildSubjectScopedManualSpecIds` 只保留插入时生成 id 的职责（ID-4、D-ID-1）。
4. [x] 按 ID-R1 补集成测试：同一身份重复 ingest 只产生一行；解析器能找到历史 id 与当前哈希公式不符的行。
5. [x] 验证门禁：完整 `npm run test:server -- parameter-specs` 与拓扑相关套件全绿，才开始批次 2。

### 批次 2 — 身份纠错服务

6. [x] `reattributeParameterSpec`：任意生命周期，重写 `attribution_subject_id`、`specification_key`、`schema_namespace`；三元组冲突时返回 409 并带上阻挡方的 id 与生命周期（D-ID-2、ID-R3）。
7. [x] `renameParameterSpecPropertyKey`：`referenceCount > 0` 时拒绝，错误信息给出引用数；重写 `property_key` 及同样的派生列（D-ID-2）。
8. [x] 授权按 ID-R5；审计新增两个 `GovernanceAuditAction` 成员 `spec-reattributed` 与 `spec-property-key-changed`（`governanceAudit.ts:8-23`），携带前后身份与 `reasonHash`。
9. [x] 两个动作的路由、`routeManifest` 与 OpenAPI 条目。
10. [x] 同批次做 mock 对齐（ID-R6）。

### 批次 3 — 编辑器界面

11. [x] 把声明的归属主体作为独立只读行呈现，与实测的所属模块区分开（D-ID-5、ID-8）。
12. [x] "修正归属"动作，复用主体树选择器并带前后对比确认（D-ID-4）。
13. [x] "修正属性键"动作，有引用时禁用并给出原因说明（D-ID-2、D-ID-4）。
14. [x] 替换有误导性的模块管理提示，新文案区分"位置"与"归属"（ID-3）。
15. [x] 两个动作的组件测试，含拒绝路径与冲突路径。

### 批次 4 — 文档与验收

16. [x] 处理下方的文档影响矩阵。
17. [x] 注册并覆盖新的验收 ID。
18. [x] playwright-cli 证据，1440×900 / 768×1024 / 390×844，0 控制台错误，覆盖一次成功再归属、一次被拒改名、一次冲突。

会话 `identity-batch4`（控制台复核用 `identity-batch4-clean`），mock Vite `http://localhost:5181/parameter-admin/specs`，角色 Admin Xu Yun。截图（gitignore）在 `work/ui-checks/param-spec-identity/`：

- `desktop-1440-library.png` — 库中两条 `gpio_int` 与 `mystery_prop`
- `desktop-1440-rename-refused.png` — 有引用的 `gpio_int`，「修正属性键」禁用，引用数：1
- `desktop-1440-collision-blocker.png` — 再归属到 MT5788；文案「目标身份已被定义「spec-mt5788-gpio-int」（已启用）占用，无法覆盖。」
- `desktop-1440-reattribute-success.png` — charger 主体，toast「已修正归属主体」
- `desktop-1440-reattribute-reopen.png` — 再打开：声明主体仍为 charger，已启用，引用数 1，库中仍两条 `gpio_int`
- `desktop-1440-rename-offered.png` — 零引用 `mystery_prop`，「修正属性键」可用
- `tablet-768-library.png` / `tablet-768-editor.png`
- `mobile-390-library.png` / `mobile-390-editor.png`

成功再归属后的干净会话 `console error`：0 条错误。

## 关键接缝（起点）

- id 生成与公式：`server/modules/parameter-specs/specIdentity.ts:111-160`。
- find-or-create 路径：`provisionalSurfaceBinding.ts:12-60`；`reviewApply.ts:470-560`；`driverSchemaOverlayService.ts:100-140`；创建在 `service.ts:809-900`。
- 写入契约与 DTO：`server/modules/parameter-specs/schemas.ts:27-208`。
- 引用数与详情读取：`server/modules/parameter-specs/repository.ts:1056-1075,1178-1270`。
- 审计动作联合类型：`server/modules/parameter-topology/governanceAudit.ts:8-23`。
- 归属标签助手：`src/components/parameter-topology/ParameterSpecLibrary.tsx:110-152`。
- 只读身份字段与提示：`src/components/parameter-topology/ParameterSpecDetail.tsx:290-310`。
- 可复用的主体选择器：`src/components/parameter-topology/SpecCreateDialog.tsx`（`subjectsFromModules`、归属主体控件）。
- mock 对齐：`src/infrastructure/mock/mockParameterTopologyRepository.ts`。

## 文档影响矩阵

| 领域 | 动作 | 路径 | 证据 |
| --- | --- | --- | --- |
| 仓库地图 | 复查 | `AGENTS.md`、`ARCHITECTURE.md` — 确认二者未声明身份不可变 | 2026-08-17 无变化：两文件均未声称定义身份不可变或仅能在创建时确定。 |
| 计划 | 更新 | 本计划；英文对应计划；`docs/exec-plans/tech-debt-tracker.md`（含中文）记录被推迟的"有引用改名走切换" | 本计划批次 4 已勾选；**TD-117** 追加（origin/main 最高 Open 号为 TD-116；未改 TD-044 / TD-079）。 |
| 架构 / ADR | 已完成 | [ADR-0017](../../../adr/0017-definition-identity-is-correctable.md) 新增并入索引；ADR-0013、ADR-0014 追加取代说明 | 2026-08-04 已写；本批次未重开。 |
| 领域术语 | 更新 | `CONTEXT.md` — 「Attribution subject」不应再暗示身份只能在创建时确定；新增「Identity correction」 | 已在 origin/main：Attribution subject 写明可就地纠正（ADR-0017）；Identity correction 词条已在。本批次未改。 |
| API 契约 | 更新 | `docs/design-docs/api-contract.md`（含中文）补两个新路由、409 冲突结构、以及 `specification_key` 是派生值（ID-R4） | 已补 `POST .../reattribute` 与 `POST .../rename-property-key`；409 `{ parameterSpecId, lifecycle }`；身份段写明派生 `specification_key` 与代理键。 |
| 设计文档 | 更新 | `docs/design-docs/domain-model.md` 中陈述定义身份的段落；`2026-07-30-parameter-governance-deferred-questions.md` 若记录过再归属为待议 | ParameterSpec / 全局 / 手工身份行已中英更新。deferred-questions 未把再归属记为待议 — 无变化。 |
| 前端 / 设计 | 更新 | `docs/FRONTEND.md` 与 `docs/zh-CN/frontend.md` 补"声明 vs 实测"归属的区分 | 定义库段落现写明实测 vs 声明、「修正归属 / 修正属性键」门禁与冲突文案。 |
| 安全 / 治理 | 更新 | `docs/SECURITY.md` — 两个新审计动作及其归属划分（ID-R5） | 中英已记 `spec-reattributed` / `spec-property-key-changed`；组织 Admin vs `platform-admin` 与废弃/恢复相同。 |
| 质量 / 测试 | 更新 | `docs/developer/browser-acceptance-coverage-map.md`（含中文）与 `docs/developer/user-operation-coverage-matrix.md`（含中文） | 已登记 `PARAM-SPEC-IDENTITY-001` / `002`（`required: false`，操作为 `future`，暂缓理由 TD-079）。 |
| 生成产物 | 更新 | `docs/generated/db-schema.md` 记录迁移 `0090` | 产物已含 `parameter_specs_identity_triple_uidx`。`npm run db:schema-doc` 因本机 PostgreSQL 无 pgvector 而跳过（docs:check 亦跳过）。 |
| 可靠性 / 运维手册 | 复查 | `docs/runbooks/parameter-identity-cutover.md` — 可能需要在切换之外标注纠错路径 | 无变化：该手册是路径身份维护窗口 cutover，不是目录身份纠错。 |
| 产品规格 | 复查 | `docs/product-specs/prototype-functional-spec.md` 中关于定义编辑的描述 | 无变化：高层定义库治理，未声称身份不可变。 |
| 参考资料 | 复查 | `docs/references/productization-api-contract-draft.md` 中引用的 spec 请求体 | 无变化：草稿未引用 parameter-spec 写请求体。 |

## 文档更新门禁

在把本计划移入 `completed/` 之前：

1. 影响矩阵每一行都已更新，或已带证据记录为无变化。
2. 八条 ID 发现全部关闭，或明确推迟并记入 `exec-plans/tech-debt-tracker.md`。
3. 七条 ID-R 风险全部带证据关闭，其中 ID-R1 与 ID-R2 需要测试或查询输出，不接受口头断言。
4. 被推迟的"有引用改名走切换"已作为技术债记录，并指向 ADR-0017 的后续项。
5. `npm run docs:check`、`npm run acceptance:coverage`、`npm run acceptance:operations` 全绿。

## UI 交互覆盖

本计划新增会改变可见治理状态的写入路径，因此 UI 交互自动化规则适用。

需在声明实现完成**之前**注册到 `docs/developer/browser-acceptance-coverage-map.md` 的新 ID：

- `PARAM-SPEC-IDENTITY-001` — 管理员在库中纠正一条定义的归属主体，重新打开后声明的主体已更新，定义保持其生命周期与引用数，且同一属性没有出现第二条定义。
- `PARAM-SPEC-IDENTITY-002` — 零引用定义上提供改名，有引用定义上带明确原因拒绝；与既有定义（含废弃定义）冲突的纠错会显示阻挡方。

## 验证

```bash
npm run test:server -- parameter-specs
npm run test:server -- parameter-topology
npm test -- src/components/parameter-topology
npm test -- src/ParameterAdminNextPage.test.tsx
npm run build
npm run docs:check
npm run acceptance:coverage
npm run acceptance:operations
# 浏览器证据位于 work/ui-checks/param-spec-identity/
```
