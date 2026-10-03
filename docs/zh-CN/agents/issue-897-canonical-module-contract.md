# #897 规范模块流程：契约与派发包

> English companion: [English](../../agents/issue-897-canonical-module-contract.md)

状态：**待独立复核的方案**，不是实现，也不修改已接受的 ADR。实现固定基线：Draft A #939 `dcc3ed436617e01fc749ccecf02ed2c13a570bc2`（2026-09-28 已核对远端 head）。本文不改业务路径、migration、checker、allowlist 或 A 证明。

## 1. 精确树上已有的能力

| 用户流程 | 现有入口与 owner | 剩余缺口 |
| --- | --- | --- |
| 主体身份与展示 | `CanonicalSubjectPlacementPanel` 已使用 `getCatalog`、分页 `listSubjects`、`listRegistrations` 与 pin 后的 `listDefinitions`；Driver、NodeType、ConfigurationSchema 有独立 ID/种类。`RegistrationDialog` 调用登记与 Placement 治理命令。 | 不从模块名、compatible 后缀、property key 或 DTS overlay 猜主体。 |
| 定义选择 | `listModuleOverlayLibrarySpecs` 已通过 `listAllCanonicalPages` 读取全部有效且已登记定义，有第二页测试；主体详情也复用该游标 helper。 | 不重造分页；空态与失败态分开。 |
| 模块子树计数 | `readRegistry` 已使用 `listModuleRegistryFacts`、已捕获的 Catalog snapshot、`definitionFactsFromCatalog` 和 `rollupSubtreeAttributionCounts`。 | 保持有效 Definition ID 与当前 Binding ID 的不同口径；缺少 Catalog snapshot 时不能显示假零，不混入旧 Binding。 |
| 归属影响及写入 | `getRegistration` 向有权组织写入者提供当前 Binding／项目影响；`getPlacement` 返回 ETag。`createRegistration`／`updatePlacement` 已有 release pin、幂等、移动时 `If-Match`、目标归属及保留 Placement 的种类约束和治理审计。 | 展示一致的影响预览；任何要求的目标容量由 owner 校验。预览仅供确认，写入时的守卫才有权威性。 |
| 共享模块树变更 | `parameterModuleRepository` 重命名／换父级时保留模块 ID，删除时阻止仍被 Catalog Placement 引用的模块；数据库对保留的 Placement 有种类约束。 | 用仅规范引用验证重命名、换父级、改种类及删除；分类树修改留在该 owner，不能推断新 Subject 或改写 Binding。 |
| Driver 发现 | 模块页面仍调用 `getDiscoveryHints` 及旧 mapping／recompute 路由。规范 `listObservations`／`listReviewItems` 尚不提供精确 compatible 发现投影。 | 若现有 review 查询拿不到下列字段，只增加一个经鉴权的**只读**投影，不建第二个写入 owner。 |

相关 seam：`server/modules/parameter-governance/queries/registration.ts`、`server/modules/parameter-catalog-api/governance/`、`server/modules/parameters/parameterModuleRepository.ts`、`server/modules/parameter-modules/{repository,service,routes}.ts`、`src/components/parameter-admin-next/{CanonicalSubjectPlacementPanel,OrganizationModuleGovernancePanel}.tsx`、`src/components/parameter-topology/ParameterModuleMappingPanel.tsx`、`src/application/ports/{ParameterCatalogRepository,ParameterCatalogGovernanceRepository,ParameterModuleRegistryRepository}.ts`、`src/infrastructure/http/{parameterCatalogClient,parameterModuleRegistryClient}.ts`。

## 2. 最小用户契约

**身份和操作。** 一行以当前发布的 `subjectId` 为键，包含 `type`、`canonicalName`、别名、membership、组织登记状态／ID、Placement ID／模块 ID。Driver 的目标模块种类是 `driver-group`，NodeType 是 `node-type`，ConfigurationSchema 是 `business`；现有 guarded registration writer 已检查这些种类。仅当前发布有效的主体可显式登记。已登记主体通过自身登记的 Placement owner 调整归属；退役／恢复及未决识别留在 Governance／Review Queue。DTS 解析覆盖只作能力说明。保留共享 `public.parameter_modules` 分类树；模块行只是目标位置，不是 Catalog 身份。

**Compatible 发现。** 推荐从 `parameter_catalog.parameter_observations` 中已验证的 DTS 观测读取，以精确组织／项目、逻辑节点、捕获的配置修订连接 `dts_logical_node_revisions`。`parameter_review_evidence` 仅在自身溯源足够时提供关联的复核状态；它的 `observation_id` 可为空，不能冒充已证明的 DTS 观测。可操作队列只收录可证明属于当前源上下文的证据；历史或过期证据保留为历史，不列为当前可操作项。各个 compatible selector 必须来自 DTS ingest/parser owner（`parameter-topology/ingestService.ts`、`parseCompatibleList`），不能在查询侧复制解析规则；再按 ADR-0040 将**完整** selector 逐字节校验。持久化的 `dts_logical_node_revisions.compatible` 文本本身不能证明 token 边界：`vendor,device` 中的逗号属于一个 selector。不得转小写、裁剪、去引号、按后缀匹配或从名称生成身份。通过捕获发布上的 `CatalogSnapshot.resolveSubject`／`catalog-kernel/runtime/subjectMatch.ts` 得到权威匹配，且**只传**已解析的 `driverCompatibles`、`nodeTypeFallback: { kind: "absent" }`，不传 `configurationSchemaIds`；否则未知 compatible 可能借 NodeType fallback 匹配。compatible 是证据，不是 `subjectId`。

最窄只读结果为按发布 pin 和游标分页的 `{ compatible, evidenceCount, projectCount, evidenceRefs: [{ observationId, projectId, logicalNodeId, configRevisionId }], candidate: { kind: "recognized", subjectId, registrationId? } | { kind: "review-required", reviewItemIds } | { kind: "unavailable", reason }, catalogReleaseId, matcherRevision }`。仅现有精确 Catalog matcher 证明在当前发布唯一匹配时才返回 `subjectId`；否则行须待复核或不可用，不能猜登记目标。`evidenceCount` 按精确逻辑节点／配置修订观测去重，不按属性行或 Binding 计；`projectCount` 是授权可见项目去重数。展示分组键为组织＋完整 compatible 原值＋捕获的发布／matcher 修订。无可证明 DTS 溯源的 review evidence 留在 Review Queue，不虚构观测引用。保留各 review item ID：多个 item 可以共用 compatible，不能用猜出的组 ID 一次解决。限制页大小与证据引用数量；不向无权者泄露原始证据或外组织项目 ID。若现有 Review Queue 投影能准确提供该结果，直接复用；否则只在 Governance 查询／HTTP seam 增加此读口，不建新模块 taxonomy 服务。

**忽略语义与计数。** “忽略”是对**一个**有权 review item 带理由、ETag、release pin、幂等键执行 `resolveReviewItem({ resolution: { type: "mark-out-of-scope" }, reason })`，不是永久的 `(organization, compatible)` 屏蔽行。一个 compatible 分组若有多个 open item，分别链接到每项处理，不加未审查的批量动作。模块页的 `ignoredReviewItemCount` 按有权组织、捕获的 Catalog 发布，对 `status = 'out-of-scope'` 的 `parameter_review_items.id` 去重计数；页面标为“已忽略复核项”，不能标为“已忽略 compatible”，历史发布的决策保留为持久历史，不计入当前卡片。现有 `listReviewQueue` 只提供 open 项，因此该数字需要窄范围鉴权投影。范围外结果不自动重新打开，沿用 ADR-0042。旧 `parameter_module_dismissed_compatibles` 是 legacy 状态，不是规范历史。

**计数。** 模块 `definitionCount` 是子树中经有效登记／Placement 继承的、当前发布有效 Definition ID 去重集；没有 Binding 的定义也计入。模块 `parameterCount` 是子树中当前规范 Binding ID 去重集，借 `current_project_parameter_bindings` 排除删除／替换／非当前行。主体详情单独展示有效／废弃／退役定义数；`getRegistration.impact` 提供一次 Placement 移动的当前 Binding／不同项目数。不得将观测数称为 Binding 数、简单相加导致子树重复、用 ProjectValue 数替代，或在 Catalog／登记查询失败时返回零。复用现有 registry 汇总和 Catalog 分页，只修复实证差异。

**“重算”的含义。** 规范 Binding 使用 `registration_id`、`subject_id`，没有可变的逐 Binding `module_id`；旧批量 `update project_parameter_bindings set module_id` **没有等价操作**。一次 Placement 移动改变该登记下全部当前／未来 Definition 与 Binding 的**当前视图**，保留其身份、值、源 pin 与历史。若识别到了错误主体，走已有 review／身份纠正 owner，不能逐行搬 Binding。规范模式不提供“重算”写按钮；刷新只是读取。旧 mapping／recompute 控件和请求在规范页面既不能可操作，也不能在加载时发出。Overlay 编辑和共享分类树控件保持各自 owner。

**调整顺序。** 捕获同一 Catalog 发布；读取主体／登记与模块种类选项；取得 `getRegistration` 影响和 `getPlacement` ETag；展示原目标、新目标、有效定义数、当前 Binding／项目数，并标明预览仅供确认；由有权管理员确认；携带目标模块 ID、release pin、ETag、幂等键调用现有 `updatePlacement`；刷新规范主体、registry 和项目视图。Governance owner 在同一写事务校验组织、当前 membership、登记状态、目标存在／种类／适用的父级条件和任何已批准容量规则，并审计实际前后状态。过期 pin／ETag、容量失败、同键异请求或归属冲突均不得部分移动；同键同请求重放返回原结果。不增第二个 Placement writer，也不承诺预览计数等于写后瞬时数。模块重命名／换父级保留 Placement 的模块 ID；改种类或删除必须遵守 `parameterModuleRepository` 和数据库对保留 Placement 的约束。

## 3. 复核时需确认的决定

1. **发现证据当前性及 token 提取。** 推荐仅让已证明属于项目当前源／配置修订且由 parser 证明单项 selector 边界的 compatible 可操作；旧观测保留为持久历史。C1 须指出所用的权威当前源指针与 ingest/parser 产物。若 token 未持久化或源 owner 无法证明当前性，C1 须先由该 owner 提供窄范围读取 seam，或报告精确阻断；Governance 查询不能自行解析原文。未获证明的行排除在可操作列表外并显式提示不可用／错误。把全部不可变观测都算当前会让源替换后的旧发现复活；按逗号拆原文会破坏 `vendor,device` 身份。
2. **分组忽略。** 推荐逐 item `mark-out-of-scope`，compatible 分组只链接各 item。永久按 compatible 屏蔽需另定受治理身份、重开和审计契约，不在 #897 最小流程中。
3. **目标容量。** 若有适用的已批准登记／Placement 容量规则，推荐复用并在事务中验证。现有种类／归属检查不能证明容量政策；若一项移动确须容量批准却缺少已批准来源，报告精确关口并停止该次移动，不自造阈值。#815 的 Policy 使用量和 #816 的读查询预算是不同议题。

## 4. 顺序实现任务包

所有实现均从精确 A `dcc3ed436617e01fc749ccecf02ed2c13a570bc2` 开始，先复核本方案。每个 owner 记录实际输入／输出 SHA；依赖任务只从前项已接受的精确 SHA 开始，不从可变分支名开始。各包均不改 #913 冻结历史或 A 证明。

| 包 | 路径 owner 与交付 | 依赖与最小有效证明 |
| --- | --- | --- |
| C1 — 规范查询／治理 | 按需由 `parameter-topology/ingestService.ts` 源 owner、`parameter-governance/queries`、现有 review／registration owner、`parameter-catalog-api/governance`、`parameters/parameterModuleRepository` 协同；复用计数、命令与分类树约束，只在必要时增加 compatible 读投影。冻结当前性、parser token 溯源、仅 Driver 身份、分页／鉴权、忽略映射／计数及写时容量决定。 | A SHA。专用、真实角色 PostgreSQL 与已鉴权 HTTP：仅规范数据且旧表为空；完整 compatible（含 `vendor,device`）、未知 compatible 加已知 NodeType 不产生 Driver 候选、重复属性证据、过期源、跨组织隐藏、坏定位、超时、真零与不可用；忽略一个 review item 使 `ignoredReviewItemCount` 恰增 1，同 compatible 其他项仍 open，重复 evidence 不增加该项计数；Placement 同键重放／异请求、过期 ETag、已引用模块的重命名／换父级／改种类／删除，以及失败后数据／审计不变。C2 前独立 Spec 复核。 |
| C2 — HTTP／客户端 | 现有 Catalog route manifest／DTO／client／port；只在退出现行旧调用时涉及 `parameterModuleRegistryClient`。不增平行模块写入接口。 | 已接受 C1 SHA。契约／HTTP 检查完整字段、游标、发布漂移、鉴权、结构化错误与无空 canonical 回退。可先按冻结接口准备测试，但集成串行。 |
| C3 — 页面 | `OrganizationModuleGovernancePanel`、`CanonicalSubjectPlacementPanel`、`ParameterModuleMappingPanel` 与近旁测试。展示三种主体及有权操作；用 review item 决策、影响／Placement 命令及现成分页；停止规范页面加载时调用旧 hints／recompute／mapping 写入。 | 已接受 C2 SHA。真实 API＋专用 PostgreSQL、1440×900：仅规范主体／定义／Binding 的计数和导航一致；移动后两个视图一致且不改身份／值；检查键盘／焦点与 console/network；可从超过 50 条有效定义的后续页选择。复用已有第二页测试，只补真实流程缺口。 |
| C4 — 精确库存 | 原生 checker owner 仅做证明；运行时与相关测试一同审阅。 | 已接受 C3 SHA。精确 base/head 执行 checker，列出退休／迁移／新增／仍未放行的完整 ID 集。先验证运行时，再调整相关测试观测；不削弱 checker、不扩 allowlist、不改冻结历史、不靠改 SQL 字符串降计数。Hosted 另列证据。 |

C1 可独立核查 Catalog 读查询与 Governance 写行为；C3 可在 C1／C2 期间只读准备浏览器夹具。共享 DTO、生产代码和最终 checker 证明保持单一串行 owner。本文不授权合 main、部署、关单或破坏性数据操作。
