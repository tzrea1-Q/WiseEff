# T1.3 完整后继与 B2 物化 — 实施前威胁矩阵

> English: [English](../../../../exec-plans/active/849-inventory/t13-complete-successor-threat-matrix.md)

契约：#849、#853 T1.3、[ADR-0045](../../../design-docs/adr-0045-configuration-schema-subject-and-seed-rebuild.md)、[ADR-0046](../../../design-docs/adr-0046-source-occurrence-identity-spans-dts-and-software-configuration.md)、T1.1 源出现身份、T1.2 `catalog-capability/v4` 与 `charging_core` NodeType。本轮 DTS+JSON、TD-124 YAML/TOML/ENV 延期、软件配置用 ConfigurationSchema、Atlas/Aurora/Nebula 各 124 条绑定、无放置容量时 B6 失败关闭，均已决定。本矩阵只冻结仍未决的实现与安全边界。

状态：**设计 Spec PASS with P2（grok-4.6 复审）。** P1-1／P1-2／P1-3 已关闭。配套：[可实现设计](t13-complete-successor-design.md)。可以开始实施。本 todo 无 commit、PR 或 seal。

## 工作分支与边界

- 工作树：`/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`，分支 `codex/849-853-t11-source-identity`。
- 继承 HEAD `f9c710f6a90d67462965a06abd47e33aa200e75e`；已接受 main `46b6068693942b95f7cba28ee5de6748a97170fa`。T1.1 与 T1.2 仍是未提交脏候选，不得改写。
- 风险 **R3**。对本矩阵与[可实现设计](t13-complete-successor-design.md)的独立 Spec 评审必须先于生产修改；本地转绿后再做独立 Standards 与 Spec 实现复审。
- T1.3 本地交付后停止。不做 T2.4 工具链、T2.1 UI、T2.2 消费者族、commit、PR、合并、Hosted、目标环境或 Issue 变更。
- 只用 helper PostgreSQL：端口 **55438** 上的一次性 pgvector 库，不用 compose `5432/wiseeff`，也不用持久 lane `wiseeff_lane_849`。
- 要求的独立评审模型 `gpt-5.6-luna` / `max` 在本运行时不可用；评审使用 `grok-4.6` 并必须披露该替换。

## 受保护不变量

经真实 publisher／installer 安装的完整 Catalog 后继，加上受审 DTS 与 JSON 项目源，产生精确 Binding 身份集：**Atlas／Aurora／Nebula 各 124 条，合计 372**。每个当前范围输入都记录源摘要、精确定位、旧／正式身份、preserve／transform／merge／exclude 处置和前驱谱系。TD-124 项不产生活动绑定或值。结构键与歧义 fixture 保持排除。缺少放置容量时仍失败关闭且绑定为零。初始化走既有审阅／授权、one-in-flight 和归档后再重建；不用直接 SQL，不臆造审批。已完成运行重放是空操作。自定义项目与非参数身份保持不变。

## 清单对账（125 对 127）

todolist 仍写「125 个输入：113 厂商 + 4 个当前 DTS/JSON + 8 个 TD-124」。T1.2 增加了两条受审 `charging_core` NodeType 属性。守恒与绑定计划为：

| 数字 | 含义 |
| --- | --- |
| 127 | 守恒：115 厂商 + 12 兼容 |
| 119 | 当前轮：115 厂商 + 4 个 DTS/JSON 兼容 |
| 8 | TD-124 YAML/TOML/ENV 延期；无种子绑定或值 |
| 124 | 每项目绑定 = 120 条板级业务出现 + 2 条 charging-thermal DTS + 2 条 JSON |
| 372 | 124 × 3 项目 |
| 合并 | 两条新厂商属性（`fast-charge-profile-matrix`、`battery-thermal-derate-curve`）是两条 DTS 兼容定位的**正式主体**，不另增绑定 |

未解决的当前范围字段／身份或无法解释的遗漏阻断发布。T1.3 文档把清单措辞改成上述诚实计数；不重开产品问题。

## 行

| ID | 维度 | 预期观察 | 证据所有者 |
| --- | --- | --- | --- |
| B2-01 | 守恒 | 清单恰好记录 127 个输入。115 厂商、12 兼容、119 当前、8 延期。结构键与歧义 fixture（`common-status.yaml`、`test-ambiguous-*.yaml`）保持排除。悬空 overlay 目标保持测到的每板 **29** 个未解析 `&label` 和 **37** 个缺失 `&name` 引用；它们不铸造 canonical 绑定（桩移除归 T2.4）。120 条板级业务出现仍是绑定加数 | `seed:reconcile:check` |
| B2-02 | 合并而非额外绑定 | 兼容 DTS 项 `/parameterLibrary/9` 与 `/parameterLibrary/10` 合并到 `node-type:charging_core` 的 `fast-charge-profile-matrix` 与 `battery-thermal-derate-curve`。旧 power-management slug 留在 `oldIdentity`。不产生第二条定义，也不产生第 126／127 条绑定 | 清单处置 + 身份预言 |
| B2-03 | JSON 正式主体 | JSON 项 `/parameterLibrary/1` 与 `/parameterLibrary/2` 保留内容与各项目值，正式主体为 `configuration-schema:wiseeff.power-config`，属性键 `charger.cv.limitMv` 与 `battery.thermal.targetTempC`。定位为 JSON Pointer `/charger.cv.limitMv` 与 `/battery.thermal.targetTempC`。`subjectSelection` 不再是 `requires-configuration-schema-subject` | 清单 + ConfigurationSchema 后继 |
| B2-04 | TD-124 泄漏 | YAML/TOML/ENV 兼容项保持 `defer`／`TD-124`。种子物化仍以 `UNSUPPORTED_FORMAT` 且 `deferredTo: "TD-124"` 拒绝这些格式。它们产生零绑定、零 ProjectValue。证据是**种子**物化测试，不只是 T1.1 的 `unsupportedFormat.test.ts` | 种子 `materialize.test.ts` + `unsupportedFormat.test.ts` |
| B2-05 | 变更集预算 | v4 `maxChangeSetOps` 为 128，**只**覆盖 `CATALOG_CAPABILITY_ALLOW_LIST`。`SHARED_BUDGETS` 与冻结 v3 保持 32。生产 `importVendorCatalog` 导入完整厂商树成功（不是 `resource-budget-exceeded`）。ConfigurationSchema 是第二个单操作后继。超预算变更集仍失败关闭 | capabilities + `importVendorCatalog` PG |
| B2-06 | 厂商后继完整 | `importVendorCatalog` 发出覆盖全部 115 条当前厂商定义的后继，含 `node-type:charging_core` 与 gpio_int 嵌套数组，从新选择中退役 acme 且无 `successorId`、不复用身份。前驱 release 与回执保留 | 厂商导入 + installer PG |
| B2-07 | ConfigurationSchema 经构建器 | 紧挨 `importVendorCatalog` 的编排以 `productPath: "m2-core"` 调用 `buildCompleteSuccessor`，`kind: "configuration-schema"`／`configuration-schema-id`，必填 `documentation`，冻结身份，并在 `wiseeff.power-config` 上安装两条 integer 定义。`completeSuccessor.test.ts` 覆盖该路径。厂商导入器不读取 `power-management.json` | 构建器单测 + PG 安装 |
| B2-08 | 发布路径 | 两个后继都只经 compile → admit → 持久化候选 → **原批准人**授权 → `installPublishedRelease` 进入数据库。发布者不能批准自己的候选。证据中没有直接 SQL 插入主体／定义／release／绑定 | 授权 + installer PG |
| B2-09 | JSON 摄入所有者 | JSON 种子文件是配置集成员，role 为 **`misc`**（绝不是 `overlay`）。它们**作为 revision 成员**传给 `ingestConfigRevision`（以便混合成员完整），**不**进入 DTS 解析集、`entryFile` 或 `overlayOrder`。绑定只由 `registerCanonicalJsonSource`（parameter-files 所有者）创建，且**在**全项目放置屏障**之后**。删除 T1.1 的 `deferredTo: "TD-124-json-project-source-semantics"` 拒绝 | `materialize.ts` + 混合集 JSON 注册测试 |
| B2-10 | DTS 摄入所有者 | DTS 种子文件（`vendor-drivers.dts` 基线、`charging-thermal.dts` overlay）仍走 `ingestConfigRevision` 解析。已摄入 revision 的成员列表包含 JSON `misc` 文件。JSON 注册复用该唯一完整混合 revision，绝不伪造 DTS revision。禁止先只 ingest DTS 再后加 JSON（复用会 `CONFLICT`） | `canonicalJsonSource.ts` + `ingestService.ts` + materialize |
| B2-11 | 精确绑定预言 | 在受审放置容量下成功物化后，Atlas／Aurora／Nebula 各有**恰好 124** 条 canonical 绑定（120 板级业务 + 2 charging-thermal + 2 JSON），合计 372。预言键为 `(projectId, occurrenceKind, locator, subjectKind, subjectCanonicalKey, propertyKey)` 加上已分配绑定 ID。JSON 定位是带前导斜杠的 JSON Pointer。无法解释的多余或缺失行失败 | 新身份预言集成测试 |
| B2-12 | 放置容量 | 为 `csub_drv_sc8562` 准备的受审空闲 `driver-group` 经 `createParameterModule`（`kind: "driver-group"`，`origin: "curated"`，**无** compatible 映射）应用，不用 `registerOrClaimDriver`，不在 `materializeSeedSources` 内部，不臆造 SQL。ConfigurationSchema 需要空闲 `business` 模块；测到短缺时同样处理。暂存注册输入是 DTS 观测主体**并上**已发布的 `wiseeff.power-config` 主体。策展者在已完成重放时幂等 | 放置策展 + B6 测试 |
| B2-13 | B6 失败关闭 | 没有额外 driver-group（以及若需要时没有空闲 business 模块），或注册列表漏掉 ConfigurationSchema，物化记 `failed`，为每个项目／主体记 `missing-placement-module`，抛 `SeedInitializationBlockedError`，写入**零**绑定（无 DTS 同步、无 JSON 注册）。不能落到 `completed` | `canonicalBindingMaterialization` + `materialize.test.ts` |
| B2-14 | 授权与锁 | 种子初始化要求每个目标都有 parameter-edit，使用 0148 one-in-flight 咨询锁，重建前归档，拒绝缺失／歧义／组织不匹配的项目身份。不臆造审批。已完成的 `(organization_id, seed_digest)` 重放返回 `already-complete` 且无写入 | plan + materialize 测试 |
| B2-15 | 确定性／顺序 | 相同输入、不同文件或变更集顺序，产生相同后继摘要、相同绑定 ID、相同预言集。`buildCompleteSuccessor` 已排序变更集；种子文件顺序不得铸造身份 | 构建器确定性 + 预言 |
| B2-16 | 重放与普通启动 | 已完成运行是空操作，包括策展、摄入、JSON 注册和绑定写入。`seed_digest` 覆盖每项目全部三个文件。普通进程启动、升级 helper 或发布无关 release 不会重置或重新物化 Atlas／Aurora／Nebula。三个目标之外的自定义项目不被触碰 | plan 测试 6 + 保全捕获 |
| B2-17 | 非参数保全 | 物化前后非参数身份、字段、关系和共享对象校验和精确一致。归档 v2 守卫仍拒绝截断／篡改对象。处置不在范围 | 归档集成 + 新的前后探测 |
| B2-18 | 跨租户／角色 | 外组织或没有 `parameter:edit`／`parameter:file-admin` 的审阅者不能物化、注册 JSON 或策展放置。Catalog 安装仍要求原批准人 | 既有授权测试扩展 |
| B2-19 | 部分失败 | 暂存循环不写绑定。JSON 解析／mapping 预检在放置屏障**之后**、DTS 同步**之前**、第一次 `registerCanonicalJsonSource` 之前，覆盖三个项目。该预检上的 mapping／解析失败产生**总共零条绑定**（无 DTS 同步、无 JSON 注册），且不把运行标成 `completed`。已完成重放跳过 JSON 注册。预检通过后后一项目 DTS 同步失败仍不完成运行（既有类别） | materialize 两阶段 + JSON 预检 |
| B2-20 | 历史／capability | v1–v3 原义与冻结 v3 写入前拒绝保持。提高 v4 `maxChangeSetOps` 只改变 v4 allow-list 摘要；不是新 capability 修订，也不放宽 v3 | capabilities 测试 + 保留 T1.2 installer 证明 |
| B2-21 | acme 退役 | acme 主体／别名保持退役且无 `successorId`。`crel_acme_1` 的 release 与激活回执不变。新选择不提供 acme | 后继文档 + PG |
| B2-22 | 本地 ≠ 目标 | helper PG 证据不是目标主机执行、不是 Hosted、也不是 lane `wiseeff_lane_849`。持久 0151 校验和不得改写 | diff 评审 + 库名断言 |

## 非目标

- 真实 `dtc`／`fdtoverlay`（T2.4）、参数 UI（T2.1）、十一类消费者（T2.2）、归档处置（T2.3）。
- 把 TD-124 YAML/TOML/ENV 项目源当成活动种子。
- 新 SQL 迁移。T1.1 未发布的 0151–0153 保持不动。
- 把 D1 slug 分配（`compile-vendor-catalog-release.ts`）扩成正式生产 ID。
- commit、PR、合并、Hosted、目标环境、Issue 变更或持久 lane 写入。

## 自审限度

本矩阵由协调实施者撰写。生产修改前必须做独立 Spec 评审；本文件不是那次评审。
