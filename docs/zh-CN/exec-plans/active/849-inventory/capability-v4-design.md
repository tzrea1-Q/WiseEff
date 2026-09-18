# T1.2 catalog-capability/v4 — 可实现设计

> English: [English](../../../../exec-plans/active/849-inventory/capability-v4-design.md)

配合[威胁矩阵](capability-v4-threat-matrix.md)。ADR-0046 已关闭的产品问题不再讨论。

状态：**设计已通过 Spec 评审（grok-4.6 复审 PASS）。** 实现位于 Scratch 树；见[验收回执](capability-v4-acceptance.md)。

## 1. 改什么

复用现有 capability allow-list、后继构建器、厂商导入器、内核编译器、installer 和消费者准入。不另建平行校验器或插件注册表。

| 接缝 | 文件 | 变更 |
| --- | --- | --- |
| 当前修订 | `server/modules/catalog-publication/builder/types.ts` | `CATALOG_CAPABILITY_CONTRACT_REVISION = "catalog-capability/v4"` |
| 冻结 v3 allow-list | `builder/capabilities.ts` | 把今日的关键词集合与非递归数组 items 保留为 `CATALOG_CAPABILITY_V3_ALLOW_LIST` |
| v4 allow-list | `builder/capabilities.ts` | 递归 `SupportedValueSchema`；数组关键词 `type`、`items`、`description`、`minItems`、`maxItems`；预算见下 |
| DTO | `server/modules/contracts/dtoSchemas/parameterCatalog.ts` | `z.lazy` 递归值 schema；嵌套 examples |
| 消费者准入 | `runtime/capabilities.ts` | 当前集合 = v1,v2,v3,v4。冻结 v3 集合保留。精确字符串成员，无前缀 |
| installer 门禁 | `verifyAuthorizationForActivation` + `installPublishedRelease` 编译后的 allow-list 遍历 | online-publication：拒绝消费者集合不含的候选 `capability_contract.revision`。所有模式：拒绝未通过消费者 allow-list 的定义 `valueSchema`。都在 materialize 之前。原因为 `unsupported-consumer-capability-revision`。生产路径没有消费者覆盖 |
| 厂商约束 | `import/vendorAdapter.ts` 的 `foldConstraints` | 把受审的 `cells`／`description` 折到嵌套数组上；永不扁平化 |
| 厂商嵌套形状 | `import/vendorYaml.ts` 的 `vendorValueSchemaFor` | 两个封闭形状：`nested-string-array`、`nested-u32-array` |
| gpio_int | 既有 `mt-mt5788.yaml`、`sc8562.yaml` | 字节不变；映射改变 |
| charging_core | 新 `schemas/dts/vendor/wiseeff/nodename-charging-core.yaml` + `catalog.json` | 仅 NodeType；用 `vendorDirectoryHash` 更新 `vendorContentHash` |
| 前端 fixture | `src/application/parameter-catalog/fixtures.ts` 及对应客户端测试 | 当前修订字面量跟随常量 |

不新增 ADR。不新增 SQL 迁移。不改写已应用历史或 T1.1 的 0151–0153。

## 2. 值 schema 契约（v4）

`SupportedValueSchema` 递归。标量与 v3 相同。mixed 仍是无 `type`、无其它键的 `{ description: string }`。

数组 schema：

```text
{
  type: "array",
  description?: 非空字符串，控制字符规则与其它 description 相同,
  minItems?: 整数 >= 0,
  maxItems?: 整数 >= 0,
  items?: SupportedValueSchema   // 标量、mixed 或另一数组
}
```

规则：

1. 未知键在多余键路径上以 `unknown-json-schema-keyword` 失败。
2. `$ref`／`$dynamicRef` 仍为 `json-schema-ref-forbidden`。
3. 作者提供的 `minItems`／`maxItems` 为 `>= 0` 的整数；`minItems > maxItems` 失败；各自不得超过 `maxItemsBound`。折入的厂商 `cells` 更严：整数 `>= 1`（ADR-0016 正列宽）。`cells: 0`／负数／非整数以 `invalid-cells-cardinality` 失败。
4. 只有作者／厂商元数据提供时才出现基数。缺席表示不受约束，不是零，也不是“按示例观测”。
5. `exampleMatchesSchema` 递归。`SupportedDefinitionContent.examples` 为 `readonly ContractJsonValue[]`。示例长度永不写入 `minItems`／`maxItems`。
6. 根级 mixed 不变。mixed **items** 才是 v4 新增。

### 预算（写入 allow-list 身份）

| 预算 | 取值 | 理由 |
| --- | --- | --- |
| `maxArraySchemaDepth` | 4 | 只计算 `type: "array"` 的对象。根数组 = 1；gpio_int／charging_core 嵌套 = 2；深度 5 失败。mixed 或标量 `items` 不增加数组深度。 |
| `maxSchemaContainerNodes` | 256 | schema JSON 对象图遍历。严于编译器 JSON Schema 遍历（64／4096）。 |
| `maxItemsBound` | 4096 | 阻止巨大声明边界；不是行数推断 |
| 既有显示名／文档／示例／变更集预算 | 不变 | |

超出预算为 `resource-budget-exceeded`。编译器 `valueSchemaRules.traversal` 仍是已持久化 release 文档的第二道围栏。

### 冻结 v3

`CATALOG_CAPABILITY_V3_ALLOW_LIST` 是今日 allow-list 的字节稳定副本：数组键只有 `type`+`items`；items 只有 `string` 或 `integer`（可带边界）；无数组 `description`／`minItems`／`maxItems`；无递归数组。`validateSupportedDefinitionContentAt(content, path, allowList)` 是共用 walker。发布使用 v4。测试与 v3 消费者证明使用冻结 v3 列表。不放宽 v3 含义。

## 3. 消费者对 bundle 的准入

今日 `catalogConsumerSupportsRevision` 是 v1／v2／v3 的精确 `Set`，只由 dual-fact readiness 用来核对**策略**。`installPublishedRelease` 不读取 capability 修订。内核 bundle／manifest 没有 capability 字段；**不要**加上（那会搅动编译器 golden）。现有安装路径的 `unsupported-catalog-capability` 表示**省略了 impact facts**，不是修订成员关系——不要复用。

新增独立授权原因 `unsupported-consumer-capability-revision`（新的 `PublicationAuthorizationReason`；OpenAPI／DTO 联合类型由该所有者再生）。

```text
CATALOG_CAPABILITY_V3_CONSUMER_REVISIONS = 冻结 ["catalog-capability/v1","catalog-capability/v2","catalog-capability/v3"]
SUPPORTED_CATALOG_CONSUMER_REVISIONS     = v3 集合 + "catalog-capability/v4"
admitCatalogCapabilityRevision(revision, supported = 当前集合) → boolean  // 精确 Set.has，无前缀
```

两道写入前检查，都在 `materializeCompiledRelease`／指针推进／receipt 插入之前。失败时域快照与调用前相等。

1. **候选修订（online-publication）。** 在 `verifyAuthorizationForActivation` 加载候选后，读取 `capability_contract.revision` 并调用 `admitCatalogCapabilityRevision`。即使所有 schema 碰巧是 v3 形态，v3 消费者也拒绝声明为 v4 的候选。
2. **已编译定义 allow-list（bootstrap、advance、online-publication、adopt）。** `compileCatalogRelease` 之后，对每个定义的 `valueSchema` 用消费者 allow-list 跑 `validateValueSchema`。失败同为 `publication-not-authorized`／`unsupported-consumer-capability-revision`（带失败路径），不是省略 impact 的 `unsupported-catalog-capability`。没有候选的嵌套数组编译 release 仍会被 v3 消费者拒绝。历史 integer／string／一维／mixed 的 v3 形状能通过 v4 walker。

生产 `installPublishedRelease` 与 `verifyAuthorizationForActivation` 始终使用当前 v1–v4 集合和 v4 allow-list。它们**不**接受消费者覆盖。

冻结 v3 注入只存在于 `installPublishedReleaseForTests`／`PublicationActivationTestOptions`：

```text
consumerCapability?: {
  revisions: ReadonlySet<string>;
  allowList: CapabilityAllowListIdentity;
}
```

`productionInstallOptions` 会剥掉该字段。B4-09 证据：持久化含 charging_core 或 gpio_int 嵌套 schema 的 v4 候选，用 `{ consumerCapability: { revisions: V3_SET, allowList: V3_ALLOW_LIST } }` 调用 `installPublishedReleaseForTests`，观察到 `publication-not-authorized`／`unsupported-consumer-capability-revision` 且快照不变；然后无覆盖的生产 `installPublishedRelease` 成功。

Readiness 仍用 `catalogConsumerSupportsRevision` 核对策略，使当前消费者准入 v4 策略、拒绝伪造的 `catalog-capability/v4-beta`。当前运行时仍准入历史 v1／v2／v3 策略和 v3 形态内容。

## 4. gpio_int 映射（不扁平化）

厂商字节保持：

```yaml
gpio_int:
  valueShape: mixed
  constraints:
    cells: 3
    description: phandle pin flags
```

今日 `foldConstraints` 只允许 `minimum`／`maximum`，因此会阻塞。种子对账里“把 cells 折成 mapped schema 上的 minItems=maxItems”是 **v4 之前的扁平化草稿**。以 ADR-0016 与 ADR-0046 为准：`cells` 是**列宽**，行数不是定义事实，禁止把 cell 矩阵扁平化。

受审映射：

```json
{
  "type": "array",
  "description": "phandle pin flags",
  "items": {
    "type": "array",
    "minItems": 3,
    "maxItems": 3,
    "items": { "description": "mixed" }
  }
}
```

外层数组 = specifier 组，不受约束。内层数组 = 恰好 3 个 cell 的一个 specifier。`valueShape: mixed` 提供 mixed items；`constraints.description` 是数组级 description；`constraints.cells` 只做内层基数。

仅当 mapped schema 为 `array` 或 mixed（无 `type` 的 `{description}`，包括 `valueShape: mixed`）时才折入 `cells`。否则导入以 **`cells-require-array-or-mixed`** 失败（不是 `unhandled-constraint:cells`）。其它未知约束键仍以 `unhandled-constraint:<排序后的多余键>` 失败。空的 `constraints: {}` 仍为 structural-non-param。

内层 `items.description` 是既有 mixed 记号 `"mixed"`，来自 `vendorValueSchemaFor("mixed")`。厂商散文 `phandle pin flags` 只做**数组级** `description`。不要把该散文抄到 items 上。

不根据 `exampleValue`（`<&gpio6 15 0>`）来设定 3。不改厂商 YAML 去丢掉 `cells`。

## 5. charging_core NodeType

合法名称：`parseCanonicalNodeName("charging_core")` 已经成功（`[A-Za-z][A-Za-z0-9,._+-]{0,30}`）。不改语法。

新厂商文档 `nodename-charging-core.yaml`：

- 仅 `nodename: [charging_core]`。无 `compatible`。混合选择器仍拒绝。
- 两个受审 DTS 兼容字段使用封闭嵌套形状，**不带** min／max（3 行示例与 4／5 列是观测）：
  - `fast-charge-profile-matrix`：`nested-string-array`
  - `battery-thermal-derate-curve`：`nested-u32-array`
- 文档写明这是演示用 NodeType 主体，不是 `huawei,charging_core`。

`vendorValueSchemaFor`：

- `nested-string-array` → `{ type: "array", items: { type: "array", items: { type: "string" } } }`
- `nested-u32-array` → `{ type: "array", items: { type: "array", items: { type: "integer", minimum: 0 } } }`

把该文件列入 `schemas/dts/catalog.json`，并用 `vendorDirectoryHash(vendor/wiseeff)` 设置 `vendorContentHash`。不做额外目录遍历。

唯一发布路径：把 YAML 列入 `catalog.json`，跑 `importVendorCatalog`（它已为 nodename 文档发出 `create-subject-with-definitions`），持久化候选，然后在 helper 所属数据库上 `installPublishedRelease`。不以手写 change-set 作为 charging_core 证据路径。聚焦 fixture 可以只含本 NodeType 加上 acme 前驱——不是 113 个文件的后继。

断言：

- 主体 kind `node-type`，canonical key `node-type:charging_core`，选择器 `node-type-name`／`charging_core`
- 当前驱中若有 `driver:huawei,charging_core`，其身份、别名和定义不变
- 无 `compatible=charging_core`，也无指向华为驱动的别名

这不是 113 个文件的完整后继，也不是 124／372 项目绑定。

## 6. 编译器与运行时

内核 `inspectValueSchema` 已按 maxDepth 64／maxContainerNodes 4096 遍历嵌套 JSON Schema，并禁止 `$ref`。v4 schema 必须通过该遍历和 `requireValidSchema`。不提高这些限制。

运行时匹配器／主体种类仍是 Driver／NodeType／ConfigurationSchema。v4 不增加第四种。ProjectValue 存储已允许 JSON 数组；定义侧示例／schema 匹配必须接受嵌套数组。兼容 DTS 值的种子物化归 T1.3。

## 7. 测试（先 Red 后 Green）

生产补丁前的最小 Red：

1. 嵌套数组定义内容在**当前**（v3）allow-list 的 `validateSupportedDefinitionContent` 上失败。
2. 对 gpio_int YAML 的 `foldConstraints` 仍报告 `unhandled-constraint:cells,description`。
3. 冻结 v3 消费者集合对 `catalog-capability/v4` 返回 false。

然后实施，并补充：

- Capability：嵌套／mixed／description／minItems 成功；未知键；预算溢出；示例不匹配；v3 allow-list 仍拒绝 v4 形状；v4 仍接受 v3 形态内容。
- Vendor adapter：gpio_int 映射为上述嵌套 schema；标量上的 cells 仍阻塞；charging_core YAML 映射为 NodeType 而非 Driver。
- 真实 PostgreSQL 上的后继 + installer：导入器构建的含 charging_core 的 v4 后继经生产 `installPublishedRelease` 安装成功；同一候选在仅测试用的冻结 v3 `consumerCapability` 下返回 `unsupported-consumer-capability-revision` 且不写入；嵌套数组编译 bundle 在 bootstrap／advance 上被 v3 allow-list 遍历拒绝；历史 v3 integer 定义在当前消费者上仍能安装。
- 既有发布／编译器套件作为受影响回归。不得把 T1.1 的 171 当作本候选证据。

## 8. 文档与指纹

更新中英 T1.2 回执；仅在本地验收后勾选 todolist。capability allow-list digest **会**变化，这是 v4 的预期，必须从 `canonicalDigest(allow-list)` 再生。不得把历史 v3 golden 改写成 v4 schema。S2-SCH／ACL／canonical 关系计数应保持不变；无法解释的移动视为停止。

## 9. 明确不改

T1.1 脏文件、未发布的 0151–0153、持久 `wiseeff_lane_849`、allowance 基线，以及 `/Users/tzrea1/Develop/WiseEff` 检出都不在范围。本 todo 不 commit／不开 PR／不更新 Issue。
