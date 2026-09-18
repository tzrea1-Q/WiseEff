# T1.3 实现复审

> English: [English](../../../../exec-plans/active/849-inventory/t13-complete-successor-impl-review.md)

模型：grok-4.6（要求的 gpt-5.6-luna／max 不可用）。与实现者独立。评审者未改文件、未 commit，也未勾选 T1.3。

对照 HEAD `f9c710f6a90d67462965a06abd47e33aa200e75e` 的 T1.3 工作树双轴复审。T1.1 来源身份 schema／UI 与 T1.2 数组 schema 语义不在范围内，只审 v4 `maxChangeSetOps` 覆盖。

## Standards

**PASS with P2** — 最重：生产放置整理写入没有鉴权／审计。

硬问题 — `placementCapacity.ts`。`curateReviewedSeedPlacementCapacity` 会写入 driver-group／business 模块，但没有 `AuthContext`、没有 `requireParameterAdmin`／`canAdminParameters`、没有事务、没有审计。它接收裸 `organizationId` 并调用 `createParameterModule`（仓储）。这违反 docs/SECURITY.md（生产写必须有审计证据）、CONTRIBUTING.md（生产路径：鉴权、校验、事务、审计）、AGENTS.md（保留授权、租户隔离、审计）以及 catalog-change skill。已接受设计可以跳过 `registerOrClaimDriver`／`createParameterModuleForAuth`（那些会注入 compatible）；它没有豁免鉴权或审计。设计 §6.1 仍要求「种子管理员的真实鉴权」。

不构成违反（覆盖基线）：v4 `maxChangeSetOps: 128` 且 `SHARED_BUDGETS` 仍为 32。composer 紧挨 `importVendorCatalog`，使用 `buildCompleteSuccessor` + `productPath: "m2-core"`。JSON 使用 `createUserInvocation(auth)` 与 `registerCanonicalJsonSource`。清单 `unhandledVendorConstraints` 重复是设计记录的导入器镜像。测试里的一次性 PG + 内存对象存储是既有 harness，不是伪造 Catalog 适配器。

基线味道（判断）：Duplicated Code — `completeSuccessor.test.ts` 内联 ConfigurationSchema change set 而不是 `powerConfigChangeSet`；thermal `documentation` 已漂移。Feature Envy — `configurationSchemaSuccessor.ts` 从 `seedInitialization/powerConfig.ts` 导入 `SEED_POWER_CONFIG_SCHEMA_ID`。Mysterious Name — digest／文件身份写死 `board.dts`，默认 helper 在未传 `{ board: true }` 时仍发出 `vendor-drivers.dts`。

## Spec

**PASS with P2** — 最重：B2-11 oracle 只数条数，不是规定的自然键元组。

核心路径符合设计：v4 `maxChangeSetOps` 128，`SHARED_BUDGETS`／v3 仍为 32；两次后继（`importVendorCatalog` 然后 `buildPowerConfigSuccessor`／`productPath: "m2-core"`）；JSON `misc` 不是 overlay；屏障之后才 register；ConfigurationSchema 并入 B6；整理器在 `materializeSeedSources` 之外；B6 vendor-drivers 失败关闭与 124 跑分库。

board 与 `vendor-drivers.dts`：§5 表／B2-10 把 `vendor-drivers.dts` 列为 base，但 §8 算术是 `120 板级业务出现 + 2 charging-thermal + 2 JSON = 124`，§5.2 digest 是 `<projectId>/board.dts`。唯一厂商节点给不出 120 条板级行。把 `src/config/dts-seed/<project>-board.dts` 当作 `board.dts` 加载是 124 加数，不是实现漏规。一旦该 board（含 `&charging_core`／`huawei,charging_core`）是 base，就必须把 overlay `charging_core` 嵌到 `wiseeff_node_type_demo` 下。

缺失／部分：B2-11／§8 oracle 断言了 124／372 计数、6 条 JSON 行和重放计数 — 没有键、JSON Pointer、charging-thermal 的 NodeType 而非 driver、`logicalNodeId: null`，也没有稳定已分配 ID。§5.3 对 `sha256:seed-materialize-json` 的反转被删；YAML TD-124 存在，没有 TOML／ENV 种子测试。§8／B2-17／B2-15／B2-19 缺少非参数＋自定义项目捕获、文件顺序置换，以及 JSON 映射预检 → 总计零绑定。§3 allow-list digest 只断言了 32 对 128，没有钉死 digest。§6.1／B2-18 整理器只收 `organizationId`。§9 helper 55438／`wiseeff_t13_successor` 是操作者 pin，套件没有写死（对 `TEST_DATABASE_URL` 做一次性克隆）。

未要求：板级 overlay 增加 `compatible`；nebula `rx_mod_cm_cfg` `0xfffffffa` → `0xfa`。JSON `sortOrder` 为 `100 + dtsSeen`，不是 §5 的「misc (sort 2)」。

看起来做了但看起来不对：`completeSuccessor.test.ts` 的 thermal `documentation` 不是受审 `power-management.json` 的 `description`+`explanation`（§4.1）；composer 才是。若快照缺少 ConfigurationSchema，它会从 B6 并集省略，然后 `CONFLICT`，不是 `missing-placement-module`（§6.2／B2-13）。

## 摘要

Standards：PASS with P2（最重：整理器写入无鉴权／审计）。Spec：PASS with P2（最重：B2-11 oracle 只数条数）。
