# 模块归属重构 — 执行计划

> English: [`docs/exec-plans/active/2026-07-27-module-attribution-redesign.md`](../../../exec-plans/active/2026-07-27-module-attribution-redesign.md)  
> ADR: [`0004`](../../../adr/0004-module-tree-states-kind-and-origin.md)、[`0005`](../../../adr/0005-compatible-and-instance-are-the-only-attribution-levers.md)  
> 分支：`feat/module-attribution-model`（PR1）、`feat/module-attribution-ui`（PR2）

## 目标

把参数管理后台的归属页面从四张没有主次的卡片，改造成 Admin 能一路做到清空的工作队列。模块树上每个模块自己声明"我是什么"，不再靠名字猜；归属规则只保留真正起作用的两种；应用规则前先给出影响预览，再动参数。

## 问题

页面是 `src/components/parameter-topology/ParameterModuleMappingPanel.tsx`，由 `src/components/parameter-admin-next/OrganizationModuleGovernancePanel.tsx` 组装，入口在 `/parameter-admin` → 组织配置 → 驱动归属配置。五个缺陷叠加成"看不清这个页面在干什么"。

**一棵树里混着三类没有标签的东西。** 人工维护的业务模块、ingest 自动创建的驱动组与器件实例、以及 `未分类 · {driver}` 兜底桶，全部平铺成一个叫「业务模块」的列表。唯一的区分手段是「显示自动发现」复选框，背后是 `src/domain/parameter-topology/moduleProvenance.ts` 里的名字正则——它能认出 `i2c@FDF5E000`，但认不出 `cccv_para0`。见 ADR-0004。

**driver 队列不起任何作用。** `server/modules/parameter-modules/ensureInstanceModuleForBinding.ts:231` 只读 instance 和 compatible 两种映射；driver 映射只有走到 341 行的 `resolveModuleIdForBinding` 兜底才会被查，而那要求 binding 既没有实例名也没有 compatible。DTS 解析出来的 binding 必然带实例名。所以在 driver 队列点「归属到「Power」」会写一条规则、清掉一个条目，然后什么都没发生。见 ADR-0005。

**两个队列，两套口径。** compatible 队列来自服务端 `listObservedCompatiblesForDiscovery`（项目参数口径）；driver 队列在浏览器里由 `OrganizationModuleGovernancePanel.tsx:38-63` 对 `application.listSpecs({})` 聚合而成（定义库口径）。两者并排放在同一个标题下。

**队列清不空，按钮还隔空操作。** `listObservedCompatiblesForDiscovery` 没有过滤 scaffolding，`amba` / `gic` / `gpio` / `spmi` 这些被 `modulePlacement.ts` 明确排除在产品树之外的 compatible 会作为待办出现，而且没有「忽略」动作。更糟的是两个队列的操作按钮，目标都取自**另一张卡片**里的「目标模块」下拉框，只有按钮文案暗示了这一点。

**应用规则的行为不一致且无边界。** `createMapping` 不重算；`mapUnmappedCompatible` 却是建模块、建映射、再触发一次全量重算。而重算本身（`server/modules/parameter-modules/service.ts:96`）在单个事务里遍历组织内全部 binding，无批处理、无进度，一次唯一键冲突就整体回滚成 409，前端只渲染成一行原始字符串。

其他：v2 的 mapping 与 recompute 端点没有服务端审计，而 v1 模块 CRUD 有，这违反 `AGENTS.md` 里后端写操作必须服务端审计的规则；v2 路由不在 `server/modules/contracts/routeManifest.ts`；`discovery-hints` 没有上限；模块行直接打印英文 `medium`；重要性只能在创建时设定，所以自动创建的模块永远是默认值，M5 的重要性筛选几乎切不动任何东西。

## 领域决策

记录在 [`CONTEXT.md`](../../../../CONTEXT.md)、ADR-0004、ADR-0005。

- **三层结构，显式声明而非推断。** 业务分类 → 驱动组 → 器件实例，参数挂在实例上。每个模块声明 `kind` 和 `origin`，两者正交。
- **纳入是副作用。** 重命名、移动或改重要性一个自动发现的模块，它就变成 curated；此后 ingest 不再改它的名字和位置。这要求 ingest 改用稳定的 `source_key` 定位，而不是 `(parent_id, name)`。
- **归属杠杆只有 compatible 和 instance。** `driver` 匹配类型废除。
- **队列必须能清空。** scaffolding 的 compatible 不进队列，Admin 可以「忽略」一个条目，该决定可撤销并有审计。
- **先预览，再按范围应用。** 提交规则先返回影响，确认后只重算该规则命中的 binding。全量重算保留为运维工具并支持 dry-run，不再是日常路径。
- **应用时回收空桶。** 已经空掉、`origin = auto`、`kind = unclassified` 且无子节点的 `未分类 · x` 模块在同一事务里删除，并写审计。
- **操作按 kind 分级。** 业务分类可完整编辑；驱动组可改名、移动、解除匹配，删除即解散并把 compatible 退回队列；器件实例只能改名；`未分类` 根只读。
- **重要性只属于业务分类。** 驱动组和实例继承最近的祖先业务分类，工作台读继承后的值。

## Git & PR

| 角色 | 允许 |
| --- | --- |
| 实现 | 依次在 `feat/module-attribution-model`（PR1）、`feat/module-attribution-ui`（PR2）提交，各自从最新 `main` 切出 |
| 实现 | 不得推 `main`、开/合 PR、快进本地 `main` |
| 父会话 | 审阅、开 PR、合并、同步 `main` |

PR2 在 PR1 合并后才开始，这样 UI 直接对着真实的 `kind` / `origin` / 预览字段写，不用做一堆过渡兼容。PR1 不改动现有页面的运行。

## 前置事实

2026-07-27 对本地已 seed 的数据库（`wiseeff`，经 `compose.yaml`）实测。启发式认领比例可接受——不是几乎全是实例。

| 事实 | 数量 |
| --- | --- |
| 待删除的失效 `driver` 映射 | **3** |
| 被 `compatible` 映射指向 → driver-group | **3**（`hl7603`、`mt5788`、`sc8562`） |
| 被 `instance` 映射指向 → instance | **44** |
| 名字以 `未分类` 开头 → unclassified | **1**（仅组织根；当前没有 `未分类 · x` 桶） |
| 地址形名字（`@hex`） | **9**（全部有 binding） |
| scaffolding 形名字（`i2c\|spi\|pmic\|batt\|scharger…`） | **18** |
| 模块总数 | **72** |
| 有 binding 的去重模块数 | **46** |
| 空模块（无 binding） | **26** |
| 能通过 binding 定 `source_key` 的实例映射模块 | **42** |
| match_kind 分布 | compatible 3 / driver 3 / instance 45 |

强化后的回填认领（顺序：compatible → instance 映射 → `未分类%` → 剩余地址/scaffolding 名 → 其余）：

| 分支 | 数量 |
| --- | --- |
| `driver-group` / `auto` | 3 |
| `instance` / `auto`（经 instance 映射） | 44 |
| `unclassified` / `auto` | 1 |
| 剩余名字启发式实例（`i2c@…`、`pmic@0`） | 3 |
| `business` / `curated` | **21**（真实业务分类：Power、Battery Gauge 等） |

因此迁移 0072 也把被 `instance` 映射指向的模块标为 `instance` / `auto`——若只靠「驱动组后代 + 名字」分支，会剩约 24 个含机器名的模块。
## PR1 — 数据模型与服务端语义

分支 `feat/module-attribution-model`。不动前端；现有面板对着未变的读取结构继续工作。

### 批次 1 — 迁移

- [ ] `server/migrations/0072_module_kind_origin.sql`
  - `parameter_modules.kind text not null default 'business'`，check 取值 `business | driver-group | instance | unclassified`。
  - `parameter_modules.origin text not null default 'curated'`，check 取值 `curated | auto`。
  - `parameter_modules.source_key text null`，并在 `(organization_id, source_key) where source_key is not null` 上建部分唯一索引。格式：驱动组为 `compatible:{normalized}`，实例为 `node:{nodePath}`。
  - 按以下顺序回填，后一分支不覆盖前一分支：（1）被 `compatible` 映射指向的模块 → `driver-group` / `auto`，`source_key = 'compatible:' || lower(match_value)`；（2）被 `instance` 映射指向的模块 → `instance` / `auto`；（3）名字以 `未分类` 开头的 → `unclassified` / `auto`；（4）剩余名字匹配 `@[0-9a-fA-F]+` 或 `^(i2c|spi|pmic|batt|scharger)[@_0-9a-z]*$` 的 → `instance` / `auto`；（5）其余保持 `business` / `curated`。
  - 对拥有 binding 的实例模块尽力回填 `source_key`，通过 `project_parameter_bindings` 关联最新的 `dts_logical_node_revisions` 取节点路径。空的实例模块 `source_key` 留空，由 ingest 下次触碰时补键。
  - 删除 `parameter_module_mappings where match_kind = 'driver'`，并从 `match_kind` 的 check 约束中去掉 `driver`。
- [ ] `server/migrations/0073_dismissed_compatibles.sql` — `parameter_module_dismissed_compatibles (id, organization_id, compatible, reason, dismissed_by, dismissed_at)`，在 `(organization_id, lower(compatible))` 上建唯一索引。
- [ ] 在 `server/shared/database/migrationInvariant.test.ts` 中补 0072/0073 的不变量，对齐现有 0066/0067 的断言方式。

### 批次 2 — 给 ingest 一个稳定身份

- [ ] `server/modules/parameter-modules/ensureInstanceModuleForBinding.ts` 里的 `ensureNamedModule` 和 `resolveBindingInstanceModuleId` 先按 `source_key` 查找。查不到时回落一次到现有的 `(organization_id, parent_id, name)`，命中未定键的行就写入 `source_key` 完成收编。两者都没命中才创建模块，创建时写入 `kind`、`origin = 'auto'`、`source_key`。
- [ ] 对 `origin = 'curated'` 的模块，ingest 永不写 `name` 和 `parent_id`，但仍可往里面归 binding。
- [ ] 测试：把一个自动实例模块重命名，对同一节点重跑 ingest，断言只有一个模块、人工名字保留、`origin = 'curated'`。整个"纳入"决策成立与否就靠这条回归。

### 批次 3 — 废除 driver 杠杆

- [ ] 在 `src/domain/parameter-topology/moduleRegistry.ts`、`server/modules/parameter-modules/schemas.ts`、`resolveModuleForBinding.ts` 以及 port/HTTP 客户端类型中，把 `ModuleMatchKind` 收窄为 `compatible | instance`。
- [ ] 去掉 `deriveModuleAssignment` 的 driver 分支，删除 `src/domain/parameter-topology/moduleDiscovery.ts` 里的 `filterUnmappedDrivers` / `mappedDriverValues` / `UnmappedDriverHint`。
- [ ] 更新 `MODULE_MATCH_PRIORITY` 及 `moduleRegistry.test.ts` / `resolveModuleForBinding.test.ts`。

### 批次 4 — 一个能清空的队列

- [ ] `server/modules/parameter-modules/repository.ts` 的 `listObservedCompatiblesForDiscovery` 复用现有 `isScaffoldingDriverLabel` 排除 scaffolding，排除已忽略项，接受 limit 并给出确定性的次级排序，同时返回总数。
- [ ] 每个 hint 带上 UI 需要的影响信息：参数数、涉及项目数、建议驱动组名。
- [ ] 新增 `POST /api/v2/parameter-modules/discovery-hints/dismissals` 与 `DELETE .../dismissals/:compatible`，均为 `admin:access`，均写审计，均返回刷新后的队列。

### 批次 5 — 预览与按范围应用

- [ ] `POST /api/v2/parameter-modules/mappings/preview` 返回 `{ affectedBindings, byProject[], fromModules[], toModuleId, emptiedModules[], conflicts[] }` 且不写任何数据。`(project_id, logical_node_id, parameter_spec_id, module_id)` 唯一键冲突在这里作为阻断项呈现，而不是事后抛 409。
- [ ] `POST /mappings` 和 `DELETE /mappings/:id` 只重算该规则命中的 binding，单事务完成，按预览的结构返回实际结果。
- [ ] 同一事务回收空桶：`origin = 'auto'`、`kind = 'unclassified'`、无子节点、无 binding。
- [ ] 全量 `recompute-bindings` 增加 `dryRun`，保留现有冲突语义，文档上定位为运维工具。

### 批次 6 — 治理与继承

- [ ] 为 v2 的每个写操作补服务端审计——映射创建/删除、compatible 忽略/恢复、按范围应用、空桶回收、全量重算——沿用 `server/modules/parameters/service.ts:2215` 的 `createParameterModuleAudit` 模式。
- [ ] 把 v2 路由登记进 `server/modules/contracts/routeManifest.ts`。
- [ ] `PATCH /api/v1/parameter-modules/:id` 对 `kind` 不是 `business` 的模块拒绝修改 `importance`。
- [ ] 注册表 DTO 带上 `effectiveImportance`（向上走到最近的祖先业务分类求得）和每模块的 `parameterCount`。
- [x] 服务端落实按 kind 的写入约束，让 UI 的限制是被强制执行而不只是显示：`instance` 不可删、`未分类` 根完全只读、`driver-group` 的删除等于解散——删映射、把 compatible 退回队列、把它的 binding 重新归位。

## PR2 — 前端

分支 `feat/module-attribution-ui`，在 PR1 合并后切出。

### 批次 7 — 队列

- [x] 新增 `src/components/parameter-topology/UnclassifiedCompatibleQueue.tsx`：表格列为 compatible、影响参数数、涉及项目、建议驱动组；列筛选遵循 `docs/design-docs/ux-table-column-filter.md`；行复选框支持批量；提供忽略与恢复动作。
- [x] 新增 `ClassifyCompatibleDialog.tsx`：用 `ModuleTreeSelect` 选目标业务分类（限定 `kind = business`，支持就地新建），驱动组名可编辑并预填建议值，从预览端点取影响预览，阻断项按阻断项渲染。批量模式下多个 compatible 走同一个对话框归到同一业务分类。
- [x] 删除 `OrganizationModuleGovernancePanel.tsx` 里的 `observedDrivers` 属性和 `listSpecs({})` 聚合。

### 批次 8 — 树

- [x] 树重写为 `ModuleAttributionTree.tsx`：每个模块一行，含名称、kind 徽标、参数计数、已匹配的 compatible（若有），重要性只在业务分类行显示且用高/中/低。操作按 kind 出现，且只出现服务端会接受的那些。默认展开到驱动组层并显示实例计数，实例按需展开。
- [x] 用基于真实 `origin` 和 `kind` 的筛选取代「显示自动发现」复选框。若无其他消费方，删除 `isAutoDiscoveredModuleName`。
- [x] 去掉独立的「归属规则」卡片；规则渲染在它指向的模块上，删规则是该模块上的一个动作。
- [x] 移动目标选择器排除非业务分类模块。

### 批次 9 — 文案、mock 对齐与清理

- [x] 在 `src/application/parameters/parameterAdminUiCopy.ts` 里给这个页面改名。建议标签页改为「模块归属」，简介围绕三层结构和队列重写。`moduleMapping`、`moduleMappingBlurb`、`moduleDiscoveryDriver`、`mappingRules`、`addMapping`、`deleteMapping` 全部变更或消失；`adminSubtitle` 和三个 `xiaoze*` 字符串里出现了「驱动归属」，需一并跟进。
- [x] `OrganizationSpecGovernancePanel.tsx` 消费收窄后的 `deriveModuleAssignment`；定义库里的模块列标注为预测而不是既定归属。
- [x] 按 ADR-0002 做 mock 对齐：`mockParameterTopologyRepository` 与模块注册表 mock 提供 `kind`、`origin`、`effectiveImportance`、`parameterCount`、预览与忽略。
- [x] 更新 `src/ParameterAdminNextPage.test.tsx`，为队列、对话框、按 kind 的树操作补组件测试。
- [x] 移除旧面板 header 里的内联 `style={{...}}`；新组件只用 `src/styles.css` 的类。

## UI 交互自动化

需要加进 `docs/developer/browser-acceptance-coverage-map.md` 的需求 ID 和 `docs/developer/user-operation-coverage-matrix.md` 的操作 ID，均落在 `e2e/acceptance/parameter-topology.acceptance.spec.ts`（已登记；浏览器用例体当前为 `test.skip`，与 `PARAM-ENABLE-*` 相同，待 disposable-DB playwright 补齐）：

| ID | PR | 行为 | 状态 |
| --- | --- | --- | --- |
| `MOD-ATTR-QUEUE-001` | 2 | 队列只列出非 scaffolding、未被忽略的 compatible，并显示参数数与项目数；忽略移除条目、恢复让它回来，两者都写审计 | 已登记 |
| `MOD-ATTR-CLASSIFY-001` | 2 | 归类一个 compatible 时展示影响预览，确认后应用，参数被移入新驱动组，空掉的 `未分类 · x` 桶被删除 | 已登记 |
| `MOD-ATTR-BULK-001` | 2 | 勾选多个 compatible，在一次确认里归到同一业务分类 | 已登记 |
| `MOD-ATTR-TREE-001` | 2 | 树上操作按 kind 分级：实例模块没有删除项；重命名自动模块即纳入；重命名后的名字能扛过一次重新 ingest | 已登记 |
| `MOD-ATTR-IMPORTANCE-001` | 2 | 在业务分类上设的重要性被驱动组和实例继承，并驱动工作台的重要性筛选 | 已登记 |

合并后需重新验证的既有 ID：`MOD-TREE-PARAM-001`、`MOD-TREE-PARAM-002`、`MOD-TREE-AUTHZ-001`、`PARAM-TOPOLOGY-BROWSE-001`。

## 文档影响矩阵

| 领域 | 动作 | 路径 | 状态 |
| --- | --- | --- | --- |
| 领域词表 | Update | `CONTEXT.md` | 完成 |
| ADR | Update | ADR-0004、ADR-0005、`CONTEXT.md` ADR 索引 | 完成 |
| 计划 | Update | `docs/PLANS.md`、`docs/zh-CN/PLANS.md`、本计划及英文版 | 完成 |
| 领域模型 | Update | `docs/design-docs/domain-model.md`（+ 中文） | 完成 |
| API 契约 | Update | `docs/design-docs/api-contract.md`（+ 中文） | 完成 |
| 前端 | Update | `docs/FRONTEND.md`、`docs/zh-CN/frontend.md` | 完成 |
| 安全 / 治理 | Update | `docs/SECURITY.md`、`docs/zh-CN/SECURITY.md` | 完成 |
| 实例子模块计划 | Update | `2026-07-21-instance-submodule-seed`（+ 中文） | 完成 |
| 模块重聚焦计划 | Review | `2026-07-20-dts-workbench-module-refocus` — 标记已被本改造取代 | 完成 |
| 验收覆盖 | Update | coverage map（+ 中文）、requirements、operationMatrix | 完成 |
| 生成的 schema 摘要 | Update | `docs/generated/db-schema.md` | 完成 |
| 产品规格 | Review | `prototype-functional-spec`（+ 中文） | 完成 |
| 测试策略 | Review | `testing-strategy`（+ 中文） | 完成 |
| 运维手册 | Review | `manual-acceptance.md` | 完成 |
| 架构 / AGENTS | Review | `ARCHITECTURE.md`（+ 中文） | 完成 |
| 可靠性 | No change | — | 不适用 |
| 参考资料 | No change | — | 不适用 |

## 文档更新闸门

阻断性。任一 PR 的文档行未处理不得合并；每一条 Update 与 Review 行完成或有证据记录为无需变更、且五个新的需求与操作 ID 已存在之前，本计划不得移入 `completed/`。运行 `npm run docs:check`。`MOD-ATTR-*` 的完整浏览器用例体延期为 `test.skip`（同 PARAM-ENABLE 模式）；ID 本身已登记。
## 验证

```bash
# PR1
npm run test:server -- --run server/modules/parameter-modules
npm run test:server -- --run server/modules/parameters
npm run test:server -- --run server/shared/database/migrationInvariant.test.ts
npm test -- --run src/domain/parameter-topology
npm run build

# PR2
npm test -- --run src/components/parameter-topology src/components/parameter-admin-next
npm test -- --run src/ParameterAdminNextPage.test.tsx
npm run test:all
npm run build
npm run docs:check
npm run acceptance:browser
```

PR1 还需要对本地已 seed 的数据库做一次人工检查：中间夹一次人工重命名地跑两遍 ingest，确认没有出现重复模块；然后建一条 compatible 规则，确认预览的数字与应用后返回的数字一致。

PR2 需要用 `playwright-cli` 对 `npm run dev` 在 1440x900、768x1024、390x844 三个视口验证，覆盖队列表格与列筛选、单条与批量归类对话框（含影响预览）、忽略与恢复、按 kind 的树操作、重要性编辑。`console error` 必须干净，截图放在 `work/ui-checks/`。

## 风险

批次 2 的稳定身份改造是全计划风险最高的一处。ingest 现在按名字找模块，所以迁移的 `source_key` 回填和那次一次性的名字回落必须完全一致，否则重新 ingest 会在人工模块旁边再造一个重复模块。它单独配一条回归测试，并且应当作为 PR1 合并前最后审阅的内容。

第二个风险是 0072 的回填是对真实数据的启发式判断。前置事实里的计数就是为了发现它认领了不合理比例的树——比如几乎所有模块都被判成实例，那么分支顺序必须在迁移跑到任何真实环境之前重新斟酌。
