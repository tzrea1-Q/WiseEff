# T1.3 完整 successor 与 B2 物化 — 本地实现回执

> English: [English](../../../../exec-plans/active/849-inventory/t13-complete-successor-acceptance.md)

状态：**T1.3 本地候选完成。** 独立设计 Spec PASS with P2，随后实现 Standards PASS with P2 与 Spec PASS with P2（grok-4.6；要求的 gpt-5.6-luna 不可用）。不执行正式 SEALED、commit、PR、合并、Hosted、目标环境或 Issue 更新。

契约：[威胁矩阵](t13-complete-successor-threat-matrix.md)、[设计](t13-complete-successor-design.md)、[设计 Spec 评审](t13-complete-successor-spec-review.md)、[实现复审](t13-complete-successor-impl-review.md)、#849／#853 T1.3。

## 候选

- 工作树：`/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`
- 分支：`codex/849-853-t11-source-identity`
- HEAD（未改）：`f9c710f6a90d67462965a06abd47e33aa200e75e`
- 已接受 main：`46b6068693942b95f7cba28ee5de6748a97170fa`
- T1.1 仍是未提交脏工作。T1.2 与 T1.3 是同一树上的额外脏／未跟踪改动。无 commit。

## 已交付行为

1. v4 `CATALOG_CAPABILITY_ALLOW_LIST.budgets.maxChangeSetOps` 为 128。`SHARED_BUDGETS` 与冻结 v3 仍为 32。修订字符串仍是 `catalog-capability/v4`。
2. Helper PG 上经真实 publisher/installer 走两次后继：`importVendorCatalog`（仅厂商 YAML，115 个属性键），然后 `buildPowerConfigSuccessor`（`wiseeff.power-config`，`productPath: "m2-core"`，原 REVIEWER）。acme 保持退役，不重新分配身份。
3. 混合 config-set 成员：DTS `base`／`overlay`，JSON `misc`（绝不是 overlay）。`ingestConfigRevision` 接收全部成员；JSON 从 DTS 解析集过滤。JSON 绑定在全部项目放置屏障之后经 `registerCanonicalJsonSource` 写入，调用 `createUserInvocation(auth)`。
4. JSON 预检（解析、Pointer 读取、已发布定义解析）在放置屏障之后、DTS 值同步之前。YAML 种子源仍为 `UNSUPPORTED_FORMAT`／`deferredTo: "TD-124"`。
5. 放置整理 `curateReviewedSeedPlacementCapacity` 使用 `createParameterModule`（`origin: "curated"`，无 compatible 映射），不从 `materializeSeedSources` 调用。缺少空闲 driver-group 时 B6 仍失败关闭且零绑定。
6. B6 注册列表为 DTS 观测主体并上已发布 ConfigurationSchema 主体。`materializeSeedSources` 要求 `RootDatabase`（`isRootDatabase`）才能构造 JSON 拒绝审计 sink。
7. Oracle 源：`src/config/dts-seed/<project>-board.dts` 作为 `board.dts`，加上 `charging-thermal.dts` 与 `power-config.json`。原先缺少 `compatible` 的板级 overlay 片段现声明受审厂商 driver compatible。NodeType `charging_core` 嵌在 `wiseeff_node_type_demo` 下，避免与板级 `&charging_core`／`huawei,charging_core` overlay 合并。nebula `rx_mod_cm_cfg` 8-bit cell 为 `0xfa`。
8. 种子 digest 所有者 `canonicalSeedInitializationDigest` 对 `wiseeff.seed-initialization.digest.v1` + 组织 + 排序后的目标 + 每项目 `board.dts`／`charging-thermal.dts`／`power-config.json` 的 sha256 hex 做哈希。完成态重放返回 `{ status: "already-complete" }`，不再写入。
9. 库存诚实：守恒 127（115 厂商 + 12 兼容）；本轮 119；8 项 TD-124；计划 124×3=372。厂商 `charging_core` 属性与两个 DTS 兼容 locator **合并**；JSON 项取 `configuration-schema:wiseeff.power-config`，Pointer 为 `/charger.cv.limitMv` 与 `/battery.thermal.targetTempC`。

## 验证（不可相加）

Helper PostgreSQL：端口 55438（`wiseeff-g668-pg`），一次性数据库 `wiseeff_t13_successor` 已启用 `vector`（不是 `wiseeff_lane_849`，不是 compose `5432/wiseeff`）。持久 lane 未动。`TEST_DATABASE_URL=postgres://wiseeff:wiseeff@127.0.0.1:55438/wiseeff_t13_successor`。测试从该服务器创建一次性克隆。

| 命令 | 结果 |
| --- | --- |
| `test:server` T1.3 核心（capabilities、completeSuccessor、vendorAdapter、configurationSchemaSuccessor、digest、materialize、B6、nodeType、t13、seedSources.fidelity） | 10 文件，**86 passed**／0 failed／0 skipped |
| 其中 `t13CompleteSuccessor.integration.test.ts` | **1/1 passed**（Atlas/Aurora/Nebula 各 124，合计 372，6 条 JSON 绑定，重放 `already-complete` 仍为 372） |
| 其中 `canonicalBindingMaterialization.integration.test.ts` | **1/1 passed**（无额外 driver-group 时 B6 零绑定） |
| `test:scripts` seed-reconciliation-manifest | **14/14 passed** |
| `seed:reconcile:check` | 当前 |
| `git diff --check` | 通过 |
| `docs:check` | 通过（治理 + db-schema 产物当前） |
| `npm run build` | 通过（`materialize.ts` 增加 `isRootDatabase` 收窄之后） |

不是完整 `test:server` 套件。不是 S1／S2、Hosted 或目标。本地初始化不算目标执行。T1.1 的 171 文件结果不是本候选。

## 剩余限制（实现复审 P2）

- 身份 oracle 断言了 124／372 计数、6 条 JSON 行和重放无操作；尚未断言完整 B2-11 自然键 `(projectId, occurrenceKind, locator, subjectKind, subjectCanonicalKey, propertyKey)`、JSON Pointer、charging-thermal 的 NodeType 而非 driver、`logicalNodeId: null`、文件顺序置换，或自定义项目／非参数 checksum。
- 放置整理仍接收 `organizationId` 而非种子管理员 `AuthContext`；不调用 `createParameterModuleForAuth`，因为该路径会走 `registerOrClaimDriver` 并发明 compatible。
- 已删除的 `sha256:seed-materialize-json` 拒绝用例没有作为具名混合成员测试反转；YAML TD-124 存在，没有单独的 TOML／ENV 种子用例。
- `completeSuccessor.test.ts` 内联的 ConfigurationSchema `documentation` 与 `powerConfigChangeSet` 已漂移。
- JSON `sortOrder` 为 `100 + dtsSeen`，不是草图中的字面 sort 2。

无 commit／PR／seal。
