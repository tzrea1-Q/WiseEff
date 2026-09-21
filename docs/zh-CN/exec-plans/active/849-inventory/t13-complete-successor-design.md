# T1.3 完整后继与 B2 物化 — 可实现设计

> English: [English](../../../../exec-plans/active/849-inventory/t13-complete-successor-design.md)

配合[威胁矩阵](t13-complete-successor-threat-matrix.md)。ADR-0045／0046、T1.1、T1.2 已关闭的产品问题不再讨论。

状态：**设计 Spec PASS with P2（grok-4.6 复审）。** 实现本地候选：Standards PASS with P2，Spec PASS with P2。回执：[t13-complete-successor-acceptance.md](t13-complete-successor-acceptance.md)。

## 1. 改什么

复用既有后继构建器、厂商导入器、publisher／installer、种子初始化、JSON 源所有者与模块所有者。不另建平行 catalog 写入者、第二条 JSON 摄入路径，也不让种子臆造放置。

| 接缝 | 文件 | 变更 |
| --- | --- | --- |
| v4 变更集预算 | `builder/capabilities.ts` | **只**覆盖 `CATALOG_CAPABILITY_ALLOW_LIST.budgets.maxChangeSetOps` 为 `128`。**不**改 `SHARED_BUDGETS`（冻结 v3 必须保持 32）。共享 display／doc／example 预算不变 |
| ConfigurationSchema 构建器证明 | `builder/completeSuccessor.test.ts` | 覆盖 `kind: "configuration-schema"`／`configuration-schema-id` 的 `create-subject-with-definitions`，且 `productPath: "m2-core"` |
| 厂商生产导入 | `import/vendorAdapter.ts` `importVendorCatalog` | 算法不变；v4 预算足够后约 48 个 `create-subject-with-definitions` 加 revise 可以成功。ConfigurationSchema 是**第二个**单操作后继，不占用厂商预算 |
| ConfigurationSchema 后继 | `catalog-publication/import/` 里紧挨 `importVendorCatalog` 的编排 | 厂商后继安装之后，以前驱做 `buildCompleteSuccessor({ productPath: "m2-core", ... })`，带一个 ConfigurationSchema 主体和两条定义。厂商导入器从不读 `power-management.json` |
| JSON 种子摄入 | `seedInitialization/materialize.ts` | 混合配置集：DTS `base`／`overlay` + JSON `misc`。`ingestConfigRevision` 接收**全部成员**（JSON 在 revision 成员列表中，从 DTS 解析集过滤掉）。JSON 绑定经 `registerCanonicalJsonSource`，且**在**全项目放置屏障**之后**。删除 `TD-124-json-project-source-semantics`。YAML/TOML/ENV 仍是 `TD-124` |
| 受审放置 | 新 `seedInitialization/placementCapacity.ts` | 额外空闲 `driver-group` 经 `createParameterModule`（`kind: "driver-group"`，`origin: "curated"`，**无** compatible 映射）。空闲 `business` 模块仅在测到短缺时同样处理。不用 `registerOrClaimDriver`。不从 `materializeSeedSources` 内部调用。已完成重放时幂等 claim-or-skip |
| 种子源 | `realSeedSources()` helpers | 每项目：`vendor-drivers.dts`（基线）、`charging-thermal.dts`（overlay）、`power-config.json`（JSON 所有者） |
| 清单诚实 | `scripts/lib/seedReconciliation.ts` | DTS 兼容项 `merge` 到 `node-type:charging_core`。JSON 项取 ConfigurationSchema 正式主体。守恒仍 127；计划绑定仍 124 |
| 身份预言 | 新集成测试 | 断言 124／372 自然键与稳定已分配 ID；无容量时 B6 零绑定失败关闭 |

无新 ADR。无新 SQL 迁移。不改写已应用历史或 T1.1 的 0151–0153。D1 `vendor-catalog-1.yaml` 仍是 compile-vendor-catalog-release 产物，**不是**生产种子发布路径。

## 2. 清单与合并

当前轮规则（已在 `manifest.json` 的 `scope.currentRoundRule`）：

1. 115 条厂商定义是当前的，包括 `charging_core` 的 `fast-charge-profile-matrix` 与 `battery-thermal-derate-curve`。
2. 四条兼容项是当前的（两条 JSON、两条 DTS）。
3. 八条 YAML/TOML/ENV 保持 `defer`／TD-124。
4. 计划绑定仍为每项目 124，因为两条新厂商属性**就是**两条 DTS 定位的正式定义。

T1.3 清单更新（生成器所有，然后 `seed:reconcile`）：

| 输入 | 旧正式主体 | 新正式主体 | 处置 |
| --- | --- | --- | --- |
| 厂商 `charging_core`／`fast-charge-profile-matrix` | `nodename=charging_core` | 不变 | `preserve` |
| 厂商 `charging_core`／`battery-thermal-derate-curve` | `nodename=charging_core` | 不变 | `preserve` |
| 兼容 `/parameterLibrary/9` | `compatibility-item`／`dts-fast-charge-profile-matrix` | `node-type:charging_core` | **`merge`** 进厂商定义；保留 `oldIdentity` |
| 兼容 `/parameterLibrary/10` | `compatibility-item`／`dts-battery-thermal-derate-curve` | `node-type:charging_core` | 同样 **`merge`** |
| 兼容 `/parameterLibrary/1` | `compatibility-item`／`charge-voltage-limit` | `configuration-schema:wiseeff.power-config`／`charger.cv.limitMv` | 内容 `preserve`；身份 transform |
| 兼容 `/parameterLibrary/2` | `compatibility-item`／`battery-temp-target` | `configuration-schema:wiseeff.power-config`／`battery.thermal.targetTempC` | 内容 `preserve`；身份 transform |

charging-thermal 的 `realSource.subjectSelection` 变为 `node-type:charging_core`（不再是 `pending-reviewed-subject-selection`）。JSON 的 `subjectSelection` 变为 `configuration-schema:wiseeff.power-config`。

绑定算术不变，本轮要测到：

```text
120 条板级业务出现
+ 2 条 charging-thermal DTS 出现（一条矩阵、一条曲线）
+ 2 条 JSON Pointer
= 124 绑定／项目
× 3 项目
= 372
```

共享定义的重复板级出现仍是各自绑定（出现上 `disposition: merge`，不是第二条定义）。结构键保持排除。

## 3. 变更集预算

今日 `SHARED_BUDGETS.maxChangeSetOps = 32` 被冻结 v3 与 v4 共用。完整厂商导入为每个新主体发出一个 `create-subject-with-definitions`（T1.2 的 D1 快照 49 个主体减去 acme 前驱主体后约 48）再加上 revise。这就是 T1.2 生产导入仍 `resource-budget-exceeded` 的原因。

| Allow-list | `maxChangeSetOps` | 原因 |
| --- | --- | --- |
| `CATALOG_CAPABILITY_V3_ALLOW_LIST` | **32** | v3 原义不放宽 |
| `CATALOG_CAPABILITY_ALLOW_LIST`（v4） | **128** | 完整厂商树 + ConfigurationSchema + 余量。仍是封闭预算，不是无界 |

提高 v4 数字会改变已发布 allow-list 摘要（allow-list 身份的 `canonicalDigest`）。从所有者钉住新摘要；不手改 golden。修订字符串仍为 `catalog-capability/v4`。T1.2 installer 证明（冻结 v3 写入前拒绝、原因 `unsupported-consumer-capability-revision`）保留。

实现约束：`SHARED_BUDGETS.maxChangeSetOps` 保持 32。冻结 v3 复制它。v4 展开 `{ ...SHARED_BUDGETS, maxChangeSetOps: 128, maxArraySchemaDepth, ... }`。改共享常量会放宽 v3，B2-20 失败。

否决的替代：把厂商导入分页成多个后继（会拆开「完整后继」）；取消预算（无界变更集）；提高冻结 v3 或 `SHARED_BUDGETS`（放宽 v3）。

## 4. 两个后继，一个当前 pin

`importVendorCatalog` 已经调用 `buildCompleteSuccessor`，且必须保持只读厂商 YAML（inventory 排除 `power-management.json`）。ConfigurationSchema 不是厂商 YAML。第二个后继的所有者是 `server/modules/catalog-publication/import/` 里**紧挨** `importVendorCatalog` 的薄编排（不是 seedInitialization）。它传 `productPath: "m2-core"`；其它 product path 会拒绝 `create-subject-with-definitions`（`unsupported-change-op`）。

在 helper 所属数据库上的顺序：

1. **厂商后继。** 从 acme 前驱 `importVendorCatalog` → 持久化候选 → 原审阅人授权 → 原批准人 `installPublishedRelease`。内容：115 条厂商定义、`charging_core` NodeType、gpio_int 嵌套数组、无 `successorId` 地退役 acme。
2. **ConfigurationSchema 后继。** 以**已安装厂商**后继为前驱调用 `buildCompleteSuccessor`，变更集见下 → 持久化 → 同一套审阅／授权／安装规则。这就是 ConfigurationSchema 走过构建器的证明，`completeSuccessor.test.ts` 目前没有。
3. 种子物化读取**当前**已安装 release（第 2 步）。

不要把 ConfigurationSchema 操作拼进 `importVendorCatalog`。不要用手写厂商变更集当生产证据。

### 4.1 ConfigurationSchema 变更集

受治理模型 id `wiseeff.power-config`（合法 `parseCanonicalConfigurationSchemaId`；禁止逗号／文件名后缀）。

```text
{
  op: "create-subject-with-definitions",
  kind: "configuration-schema",
  canonicalKey: "wiseeff.power-config",
  selector: { kind: "configuration-schema-id", value: "wiseeff.power-config" },
  definitions: [
    {
      propertyKey: "charger.cv.limitMv",          // 18 字符，点合法
      content: {
        displayName: "Charge voltage limit",
        documentation: "<受审 power-management.json 中 charge-voltage-limit 的 description + explanation>",
        unit: "mV",
        valueSchema: { type: "integer", minimum: 4200, maximum: 4500 },
        examples: [4300]
      }
    },
    {
      propertyKey: "battery.thermal.targetTempC", // 27 字符
      content: {
        displayName: "Battery thermal target",
        documentation: "<受审 power-management.json 中 battery-temp-target 的 description + explanation>",
        unit: "°C",
        valueSchema: { type: "integer", minimum: 30, maximum: 42 },
        examples: [36]
      }
    }
  ]
}
```

范围和 `documentation` 复制受审 `power-management.json` 元数据（`description` + `explanation`）；不从 JSON 示例文件推断。`validateSupportedDefinitionContent` **要求** `documentation`（`capabilities.ts`）；草图不得缺它就落地。冻结身份分配一个主体 id 和两个定义 id。无 driver nature／cardinality。不臆造 compatible。编排调用 `buildCompleteSuccessor` 时带 `productPath: "m2-core"`（与 `importVendorCatalog` 相同）。

单测：`completeSuccessor.test.ts` 在小型前驱上以 `productPath: "m2-core"` 构建该变更，断言主体 kind、选择器命名空间、两个属性键、必填 documentation，以及前驱成员被携带。集成：作为第 2 步的真实 PG 安装。

## 5. JSON 与 DTS 物化

每项目受审文件已存在：

| 配置集 role | 路径 | 摄入／绑定所有者 |
| --- | --- | --- |
| `base`（sort 0） | `src/config/seed-sources/<project>/vendor-drivers.dts` | parameter-topology：DTS 解析 + revision 成员 |
| `overlay`（sort 1） | `src/config/seed-sources/<project>/charging-thermal.dts` | 同上；列入 `overlayOrder` |
| `misc`（sort 2） | `src/config/seed-sources/<project>/power-config.json` | 成员经 `ingestConfigRevision`；**绑定**经 `registerCanonicalJsonSource`。绝不是 `overlay` |

`materializeSeedSources` 今日拒绝一切非 DTS 文件，并带 `deferredTo: "TD-124-json-project-source-semantics"`。T1.1 之后该原因是错的。它还把 `role` 设成 `index === 0 ? "base" : "overlay"`，并把 `overlayOrder` 设成 `files.slice(1)`，这会让 JSON 变成 overlay，DTS 解析以 `include-missing` 失败。

格式分流：

```text
dts, dtsi → 上传 + 配置集成员（base/overlay）+ ingestConfigRevision 解析集
json     → 上传 + 配置集成员（role misc，不是 overlay）+ ingest 成员列表
           + 放置屏障之后的 registerCanonicalJsonSource
yaml/yml/toml/env → UNSUPPORTED_FORMAT, deferredTo: "TD-124"
其他     → 既有 VALIDATION_FAILED
```

### 5.1 混合 revision 成员（P1-1）

T1.1 的 `registerCanonicalJsonSource` 只复用 `resolved`+`complete`、且**成员数等于当前配置集全部文件**（DTS 和 JSON）的 DTS revision，成员必须匹配 file id／version／role／sort_order／source_name。当前成员含 DTS 时它不会伪造 DTS revision。证据：`canonicalJsonSource.integration.test.ts` 混合集用例——JSON role 是 `misc` 不是 `overlay`；在该混合成员 revision 存在之前注册是 `CONFLICT`。

`ingestConfigRevision` 已经把 JSON 从 DTS 解析集过滤掉（`dtsMembers = members.filter(format !== "json")`），同时仍对**全部** `manifest.members` 调用 `insertConfigRevisionMembers`。这是混合集获得可复用 revision 的既有唯一路径。

每项目所需 ingest 清单：

- `entryFile`：`vendor-drivers.dts`
- `overlayOrder`：仅 `[charging-thermal.dts]` —— JSON 不是 overlay，也不在 DTS `files` map 里
- `members`：三个文件都在，JSON 为 `role: "misc"`、`format: "json"`

因此 JSON **作为成员**传给 `ingestConfigRevision`，**不作为** DTS 解析／overlay 输入。B2-09 必须写清这一区分。禁止先只 ingest DTS 再后加 JSON：复用会失败，两条 JSON 绑定永远不会出现。

### 5.2 绑定写入只在放置屏障之后（P1-2）

`registerCanonicalJsonSource` 不是暂存助手。它立即 `stabilizeCanonicalBinding` 并 `writebackProtectedReference`。若在每项目 stage 循环里调用，即使 `csub_drv_sc8562` 没有空闲 driver-group 也会写入 JSON 绑定，破坏 B6 的零绑定失败关闭。

`materializeSeedSources` 内顺序：

1. **暂存（无绑定写入），三个项目都做：** 重建前归档；上传三个文件；按上述 role 加入配置集；`ingestConfigRevision` 混合成员；`ensureSeedSubjectRegistrations` 使用 DTS 观测主体**加上**显式 ConfigurationSchema 主体（见 §6）。
2. **放置屏障：** 若有任何 `missing-placement-module`（driver-group **或** ConfigurationSchema 的 business），记 `failed`，抛 `SeedInitializationBlockedError`，**零**绑定——不做 DTS 同步，不注册 JSON。
3. **JSON 预检（无写入）：** 解析每个 `power-config.json`，并对照已发布快照解析两条 mapping。任何 mapping／解析失败在此失败运行，JSON 绑定为零。
4. **DTS 值同步**，按项目（既有 `syncPublishedCatalogProjectValuesInTransaction`）。
5. **JSON 注册**，按项目经 `registerCanonicalJsonSource`，使用 `createUserInvocation(auth)`（既有助手，不伪造系统用户）和 `canAdminParameters`。
6. **已完成重放：** `(organization_id, seed_digest)` 返回 `already-complete`，无归档、无摄入、无 JSON 注册、无策展、无绑定写入。所有者 `canonicalSeedInitializationDigest`（`seedInitialization/`）对下面精确 UTF-8 载荷（末尾换行、无时间戳）做 SHA-256，并加上 `sha256:` 前缀：

```text
wiseeff.seed-initialization.digest.v1
organization=<organizationId>
targets=<按项目 id 排序的 atlas,aurora,nebula>
<projectId>/board.dts=<文件精确 UTF-8 字节的 sha256 hex>
<projectId>/charging-thermal.dts=<sha256 hex>
<projectId>/power-config.json=<sha256 hex>
```

项目按与 `targets` 相同的排序 id 输出。文件名固定；省略 `power-config.json` 会改变摘要，因此仅含 DTS 的载荷不能 `already-complete` 跳过 JSON。摘要不含其它计划字段（目标身份已经是那三个 id）。

因此 JSON mapping 失败不能把运行标成 `completed`。写入前预检意味着 mapping 错误产生零条 JSON 绑定。预检之后意外的注册失败与后一项目 DTS 同步失败同类：运行不是 `completed`，也不是 B6 旁路。

### 5.3 JSON 注册参数

- `configurationSchemaId`：`wiseeff.power-config`
- `rootPointer`：`""`（文档根；键是字面带点的顶层键）
- `mappings`：已发布定义 id，`charger.cv.limitMv` → JSON Pointer `/charger.cv.limitMv`，`battery.thermal.targetTempC` → `/battery.thermal.targetTempC`（必须有前导斜杠；点是一个 pointer token）
- 清单生成器目前把 `realSource.locator` 存成没有斜杠的 `charger.cv.limitMv`；T1.3 更新生成器，使记录的定位与运行时 JSON Pointer 一致
- 授权：与 DTS 上传相同的种子 admin；`createUserInvocation(auth)` + `parameter:file-admin`

各项目 JSON 值保持受审文件字节（`atlas` 4300/36，`aurora` 4350/38，`nebula` 4380/40）。推荐值留在兼容记录的元数据上；当前值来自源文件。

`canonicalBindingMaterialization.integration.test.ts` 与 `nodeTypeSubjectBinding.integration.test.ts` 里的 `realSeedSources()` 目前只加载 `vendor-drivers.dts`。T1.3 按上述 role 加载全部三个文件。

种子 YAML/TOML/ENV 拒绝的证据是**种子**物化测试（扩展 `materialize.test.ts`），`deferredTo: "TD-124"`，不只是 `unsupportedFormat.test.ts`。T1.3 之后既有 JSON 物化用例（`seedDigest: "sha256:seed-materialize-json"`）必须从拒绝翻转为混合成员路径。

## 6. 受审放置容量与 ConfigurationSchema 注册

B6 已对**观测到的 DTS 主体**实现：`ensureSeedSubjectRegistrations` 挑选所需 kind、且没有 `subject_placements` 行的既有模块。Driver 需要 `driver-group`；node-type 需要 `node-type`；ConfigurationSchema 需要 `business`。未修改的受审 DTS 切片对 `csub_drv_sc8562` 缺少一个空闲 **driver-group**。

这对 JSON 不够：

- `observedSubjectsWithDefinitions` 只用 DTS 的 `compatible` + `nodeName` 调用 `resolveObservedSubject`，从不接收 ConfigurationSchema id。`charging-thermal.dts` 的节点 `charging_core` 没有 `compatible`，因此注册的是 NodeType，不是 `wiseeff.power-config`。
- `registerCanonicalJsonSource` 要求活动的受治理注册与放置（`CONFLICT`：「An active governed registration and placement are required.」）。
- 测到再策展一个空闲 `business` 模块只创造**容量**。若不把 ConfigurationSchema 主体放进注册列表，JSON 仍失败关闭，124／372 不可达（P1-3）。

因此 T1.3：

1. **策展容量**是显式操作员步骤，不在 `materializeSeedSources` 内部。
2. **显式注册已发布的 ConfigurationSchema 主体**，在暂存循环里与 DTS 观测主体求并，**在**空闲 `business` 模块存在之后、**在**放置屏障之前。

### 6.1 策展者

新所有者 `curateReviewedSeedPlacementCapacity`：

- 额外空闲 `driver-group`：`createParameterModule`，`kind: "driver-group"`，`origin: "curated"`，**无** compatible 映射。**不要**用 `registerOrClaimDriver`（该 API 要求精确 compatible 和 business 父级，并且总会插入 compatible 映射——禁止假的 `sc8562` compatible）。
- 额外空闲 `business` 模块：仅当测量显示 ConfigurationSchema 放置没有空闲 business 模块时，才 `createParameterModule` `kind: "business"`。若已有一个，不要再造备件。
- 种子 admin 的真实授权。幂等 claim-or-skip：初始化规程的已完成重放对策展者也是空操作，不只是归档／摄入／JSON／绑定。
- 不从 `materializeSeedSources` 调用。测试用该所有者替换 `nodeTypeSubjectBinding.integration.test.ts` 里的裸 `INSERT`。

### 6.2 B6 列表上的显式 ConfigurationSchema

`ensureSeedSubjectRegistrations` 的输入 =

```text
observedSubjectsWithDefinitions(snapshot, dtsObservedRows)
  ∪ [{ subjectId: 已发布 wiseeff.power-config 主体 id, subjectKind: "configuration-schema" }]
```

ConfigurationSchema id 来自当前已安装快照（第 2 步后继），绝不来自 DTS 节点名，也绝不臆造。若快照里没有该主体，那是发布失败，不是静默跳过。

求并之后若所需模块仍缺失，`materializeSeedSources` 仍失败关闭：`failed` + `missing-placement-module`（包括 ConfigurationSchema 主体）+ 零绑定。

## 7. 授权、锁、归档

保持既有路径。不增加第二个初始化器。

| 门禁 | 所有者 |
| --- | --- |
| 目标身份 | `resolveSeedInitializationPlan` — 按稳定 id 解析 Atlas／Aurora／Nebula；`missing-project`／`organization-mismatch`／`identity-ambiguous` 阻断 |
| One-in-flight | 0148 咨询锁，固定三项目范围，即使摘要不同 |
| 重建前归档 | `captureProjectParameterPlane` + `assertProjectParameterPlaneArchived` |
| 参数编辑 | 每个目标上的 `canEditParameters` |
| JSON 管理 | `registerCanonicalJsonSource` 内的 `canAdminParameters`，调用 `createUserInvocation(auth)` |
| Catalog 安装 | 候选的原批准人（T1.2：发布者充当 installer → `publication-capability-missing`） |
| 已完成重放 | `(organization_id, seed_digest)` → `{ status: "already-complete" }`，无归档、无摄入、无 JSON 注册、无策展、无绑定写入。摘要覆盖每项目全部三个文件 |

生产路径不对绑定、出现、主体、release 或值使用直接 SQL。fixture SQL 仅用于无关表准备（组织、用户），不用于 Catalog 身份。

## 8. 身份预言与保全

**2026-09-21 owner 澄清：** 输入顺序的身份验收指在同一已完成实例上交换项目／文件输入后重放，全部已分配 binding ID 及预言集保持不变；变更集重排的后继摘要确定性要求仍保留。不要求独立初始化数据库随机分配出相同来源或绑定 ID，既有分配器及绑定键不变。这是 owner 接受的本地闭环边界，不新增跨数据库身份相等保证。

物化前捕获：

- 非参数关系计数与共享对象校验和（归档 v2 库存已列出的复用）
- `{atlas, aurora, nebula}` 之外的自定义项目 id
- 当前 Catalog release pin

成功物化后：

- 每项目绑定集等于下面 124 个自然键，合计 372
- 已分配绑定 ID 在第二次已完成重放后保持稳定（空操作，同一 ID）
- 三个种子文件的顺序置换不改变 ID
- 自定义项目与非参数校验和与物化前捕获一致
- TD-124 项没有绑定、没有 ProjectValue
- `charging_core` DTS 出现绑定到 NodeType 定义，而不是第二条兼容主体
- JSON 出现绑定到 `wiseeff.power-config`，JSON Pointer 定位，`logicalNodeId: null`

与顺序无关的自然键（这就是 B2-11 预言，不是更短的元组）：

```text
(projectId, occurrenceKind, locator, subjectKind, subjectCanonicalKey, propertyKey)
```

DTS 定位保持 DTS 路径／属性（T1.1）。JSON 定位保持带前导斜杠的 JSON Pointer（`/charger.cv.limitMv`、`/battery.thermal.targetTempC`）。不与 D1 slug 定义 id 比较；生产冻结身份是发布分配器。

悬空 overlay 目标保持测到的每板 **29** 个未解析 `&label` 和 **37** 个缺失 `&name` 引用（清单 `412-413`）。它们不铸造 canonical 绑定。120 条板级业务出现仍是绑定加数。桩移除归 T2.4。

helper PG 上的专用集成测试是证据所有者。清单里历史「PLANNED 124」在该测试转绿前仍标为计划；转绿后以测试而非清单散文为运行时事实。

## 9. 证据与环境

Helper PostgreSQL：端口 **55438**，一次性库名与 T1.2 的 `wiseeff_t12_capv4` 区分（例如 `wiseeff_t13_successor`）。绝不用 5432 上的 `wiseeff`，绝不用 `wiseeff_lane_849`。

必要检查（编辑期间用最窄有用集；交接前全部跑）：

- 含 ConfigurationSchema 的 `completeSuccessor` 单测
- capabilities 预算 128 对冻结 32
- `importVendorCatalog` 完整树后继（不是预算失败）
- 经真实 installer 的 ConfigurationSchema PG 安装
- JSON 仍由 `canonicalJsonSource` 所有
- materialize：接受 JSON，拒绝 YAML
- 无容量时 B6 失败关闭
- 有容量时身份预言 124×3
- 重放空操作
- `seed:reconcile:check`
- 受影响的 `test:server`／`test:scripts`
- `npm run build`（TypeScript／共享类型）
- `docs:check`、`git diff --check`

不是 S1／S2，不是 Hosted，不是目标环境。本地初始化不是目标执行。

## 10. 关键决定

1. **诚实计数 127／119／124，而不是默默沿用 125。** T1.2 增加了两条厂商属性；它们合并到 DTS 定位上，而不是另增绑定。
2. **v4 预算 128，冻结 v3 保持 32。** 完成厂商导入且不新增 capability 修订。
3. **两个后继。** 厂商导入保持只读 YAML；ConfigurationSchema 是从已安装厂商前驱出发的独立 `buildCompleteSuccessor`。
4. **一个 ConfigurationSchema `wiseeff.power-config`。** 一个 JSON 文件、两个字面带点键、每项目一次 `registerCanonicalJsonSource`。编排紧挨 `importVendorCatalog`，并传 `productPath: "m2-core"`。
5. **JSON 成员 vs JSON 绑定。** JSON 是 ingest **成员**（role `misc`），以便混合 revision 可复用；JSON **绑定**仍经 `registerCanonicalJsonSource`，且在放置屏障之后。删除错误的 TD-124-json 拒绝。YAML/TOML/ENV 保持 TD-124，由种子物化测试证明。
6. **放置是策展的，不是臆造的。** 额外空闲 `driver-group`（以及需要时的 business）经 `createParameterModule`，无 compatible 映射。B6 看到 DTS 观测主体**以及**显式 ConfigurationSchema 主体，并仍失败关闭。
7. **原批准人安装。** 与 T1.2 授权教训相同。
8. **D1 slug 不是生产种子 ID。** 预言使用自然键加上发布分配的 ID。
9. **本 todo 无迁移、不改写 0151、不写 lane、不 commit。**

## 11. 实施顺序（Spec PASS 之后）

1. 提高 v4 `maxChangeSetOps`；钉住 allow-list 摘要；证明冻结 v3 仍为 32。
2. `buildCompleteSuccessor` 上的 ConfigurationSchema 单测覆盖。
3. helper PG 上完整 `importVendorCatalog` 后继；以原批准人授权；安装。
4. 从该前驱做 ConfigurationSchema 后继；安装。
5. 清单合并／身份更新；`seed:reconcile`。
6. 经模块所有者的放置策展；保留 B6 失败关闭测试。
7. 按 §5.1 做混合成员（JSON `misc` 成员，overlayOrder 仅 DTS）；加载全部三个种子文件；仅在放置屏障之后注册 JSON（§5.2）。
8. 身份预言 124／372、重放、保全、顺序无关。
9. 独立 Standards + Spec 实现复审。
10. 中英验收回执；停止并等待用户确认。

## 12. 未决问题

没有阻塞设计的问题。ConfigurationSchema 的 business 模块短缺是测量，不是产品问题：若求并后的 B6 列表对 ConfigurationSchema 主体报告 `missing-placement-module`，用 `createParameterModule` 策展一个受审 `business` 模块；若已有空闲 business 模块，不要再造备件。Spec P1-1／P1-2／P1-3 已在本修订关闭（混合 `misc` 成员、屏障之后注册 JSON、注册列表上的显式 ConfigurationSchema）。

## PR 计划

本 todo 不开 PR。本地候选留在 `codex/849-853-t11-source-identity`，与 T1.1／T1.2 脏工作在一起。之后另行授权的集成 PR 是 T3.4b。

| 步骤 | 标题 | 路径 | 依赖 |
| --- | --- | --- | --- |
| A | v4 变更集预算 128 | `builder/capabilities.ts`、capability 测试 | Spec PASS |
| B | ConfigurationSchema 构建器证明 + 后继 | `completeSuccessor.test.ts`、`catalog-publication/import/` 里紧挨 `importVendorCatalog` 的编排、installer PG | A |
| C | 完整厂商导入后继 | `vendorAdapter` 测试、vendorSuccessor 集成 | A |
| D | 混合 DTS+JSON `misc` 成员、屏障后注册 JSON、B6 列表上的显式 ConfigurationSchema、放置策展 | `materialize.ts`、`placementCapacity.ts`、种子 helpers | B、C |
| E | 身份预言 124／372 + B6 + 重放 | 新的／扩展的 seedInitialization 集成测试 | D |
| F | 清单诚实 + 中英回执 | `seedReconciliation.ts`、T1.3 验收文档 | E |
