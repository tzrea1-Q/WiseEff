# T1.2 catalog-capability/v4 — 实施前威胁矩阵

> English: [English](../../../../exec-plans/active/849-inventory/capability-v4-threat-matrix.md)

契约：#849、#853 T1.2、[ADR-0046](../../../design-docs/adr-0046-source-occurrence-identity-spans-dts-and-software-configuration.md) 的值 schema 决定，以及 [ADR-0016](../../../../adr/0016-cell-arrays-are-governed-by-column-width-only.md) 的列宽规则。嵌套数组、mixed item schema、数组 `description`、元数据 `minItems`/`maxItems`、以及 `charging_core` 作为 NodeType，均已决定。本矩阵只冻结仍未决的实现与安全边界。

状态：**设计已通过 Spec 评审；实现位于 Scratch。** 见[设计](capability-v4-design.md)与[验收](capability-v4-acceptance.md)。无 commit／PR／seal。

## 工作分支与边界

- 工作树：`/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`，分支 `codex/849-853-t11-source-identity`。
- 继承 HEAD `f9c710f6a90d67462965a06abd47e33aa200e75e`；已接受 main `46b6068693942b95f7cba28ee5de6748a97170fa`。T1.1 仍是未提交的脏候选，不得改写。
- 风险 **R3**。对本矩阵与[可实现设计](capability-v4-design.md)的独立 Spec 评审必须先于生产修改；本地转绿后再做独立 Standards 与 Spec 实现复审。
- T1.2 本地交付后停止。不做 T1.3 后继／种子计数、消费者族迁移、commit、PR、合并、Hosted、目标环境或 Issue 变更。

## 受保护不变量

已发布 Catalog release 保持 `catalog-capability/v1`、`/v2`、`/v3` 的原义。新 release 只有在值 schema 落在 v4 allow-list、资源预算和未知关键词失败关闭策略之内时，才可声明 `catalog-capability/v4`。只准入 v1–v3 的消费者必须在任何 catalog 写入前拒绝 v4。基数只来自受审厂商元数据，绝不来自观测到的示例行数。`charging_core` 是独立 NodeType 主体，不得把 `huawei,charging_core` 改名或合并进去。

## 行

| ID | 维度 | 预期观察 | 证据所有者 |
| --- | --- | --- | --- |
| B4-01 | 历史 v1/v2/v3 原义 | 既有 v1/v2/v3 产物、golden 与已准入历史 release 的编译、安装和读取解释不变。必须改到 v4 的当前修订 pin 只更新一次并说明原因 | 编译器／发布套件；冻结 v3 allow-list 测试 |
| B4-02 | v4 成功路径 | 嵌套数组、mixed item schema（无 `type` 的 `{description}`）、数组级 `description`、以及元数据 `minItems`/`maxItems` 能经正式 publisher／installer 编译、准入并持久化 | capability 单测 + 后继构建器 + 真实 PG 安装 |
| B4-03 | 未知关键词失败关闭 | `$ref`、`$dynamicRef`、`pattern`、`format`、`exclusiveMinimum`、`additionalItems`、`prefixItems`、`unevaluatedItems`、`contains` 及其它未列入关键词在第一个多余键处拒绝，不得丢弃 | `capabilities.test.ts` |
| B4-04 | 深度与容器预算 | 数组 schema 嵌套超过 `maxArraySchemaDepth`，或 schema 对象遍历超过 `maxSchemaContainerNodes`，在编译／安装前以 `resource-budget-exceeded` 失败。编译器 `valueSchemaRules` 复杂度限制仍生效 | capability + 编译器测试 |
| B4-05 | 基数来源 | `gpio_int` 的 `minItems`/`maxItems` 等于 `mt-mt5788.yaml` 与 `sc8562.yaml` 中的 `constraints.cells: 3`。3 行 DTS 示例不得生成行基数。未经受审的 4／5 列 fixture 不得生成内层宽度 | vendor adapter + gpio_int fixture |
| B4-06 | 禁止扁平化 | `constraints.cells` 成为嵌套数组的**内层**组宽。外层组数不受约束。拒绝 `minItems=maxItems=cells` 的一维扁平化 | vendor adapter Red／Green |
| B4-07 | 不兼容形状上的 cells | 标量／string／boolean／null 上的 `cells` 以 `cells-require-array-or-mixed` 失败。其它未知约束键仍为 `unhandled-constraint:<keys>`。不得静默丢弃 | 既有 charger-cells 测试，改靶到 cells 原因 |
| B4-08 | mixed item schema | 允许 `items: { description: "…" }` 且无 `type`。mixed 加未知键失败关闭。根级 mixed `{description}` 仍有效 | capability 测试 |
| B4-09 | v3 消费者拒绝 v4 | 冻结 v3 allow-list 拒绝嵌套数组／`minItems`／数组 `description`。带冻结 v3 `consumerCapability` 的 `installPublishedReleaseForTests` 在 materialize 之前拒绝 v4 候选**以及**嵌套数组编译 bundle；原因为 `unsupported-consumer-capability-revision`，不是省略 impact 的 `unsupported-catalog-capability`；域快照不变。生产 `installPublishedRelease` 没有覆盖参数 | `verifyAuthorizationForActivation` + installer materialize 前的 allow-list 遍历；真实 PG |
| B4-10 | 当前消费者承认历史 | 当前运行时仍准入 v1、v2、v3 **策略**修订和 v3 形态的定义 schema，不把那些 schema 重新解释成 v4。内核 bundle 没有 capability 字段 | 运行时 capability + 历史重放 |
| B4-11 | 前缀／通配伪造 | `catalog-capability/v4-beta`、`catalog-capability/v`、`catalog-capability/v10`、空串和未知字符串失败关闭，不做前缀匹配 | 运行时准入测试 |
| B4-12 | charging_core NodeType 身份 | 正式主体 `node-type:charging_core`，选择器 `node-type-name=charging_core`。下划线合法。与 `driver:huawei,charging_core` 不同。不从节点名发明 compatible | 后继构建器 + 厂商 YAML + PG 安装 |
| B4-13 | 名称相似合并 | 发布 `charging_core` 不复用、别名、退役或改写 `huawei,charging_core` 的身份、定义或选择器 | PG 身份断言 |
| B4-14 | 只走正式发布 | charging_core 与 gpio_int 的 v4 内容只能经 compile → admit → persist candidate → 授权 install 进入数据库。证据中不得有直接 SQL 插入主体／定义／release | 发布／installer PG |
| B4-15 | v3 内容历史重放 | v3 形态的 integer／string／boolean／null／一维数组／mixed 定义在 v4 上仍可发布，且不改写 schema | capability + 后继测试 |
| B4-16 | 示例与 schema | 嵌套示例必须匹配嵌套 schema。示例行数永远不变成 `minItems`/`maxItems`。超预算示例列表仍失败 | capability 示例匹配 |
| B4-17 | 并发／重复 NodeType | 两次并发引入 `node-type:charging_core` 不能提交成两个主体 | 既有唯一／锁测试扩展 |
| B4-18 | 生成产物 | OpenAPI DTO 递归、capability allow-list digest 与 vendorContentHash 由各自所有者再生。无法解释的 S2-SCH／ACL／关系计数／编译器 golden 漂移视为阻塞 | contract／docs／golden 检查 |
| B4-19 | 不泄漏 T1.3 范围 | Atlas／Aurora／Nebula 的 124／372 身份集、作为种子动作的 acme 退役、以及十一族消费者保持不变。gpio_int 解除阻塞只限于 capability／导入映射 | diff 审查 + 不改动种子计数测试 |

## 非目标

- 嵌套数组插件系统、JSON Schema 方言扩展（`$defs`、`oneOf`、`anyOf`、`allOf`、`not`），或第二套值 schema 引擎。
- 从 DTS／JSON 示例或现场观测推断矩阵宽高。
- 完整厂商后继、三项目物化，或 TD-124 格式。
- SQL 迁移。v4 是 capability 修订；T1.1 未发布的 0151–0153 保持不动。
- 把 v1／v2／v3 allow-list 重新解释为接受嵌套数组。

## 自评限制

本矩阵由实施协调者撰写。生产修改前必须有独立 Spec 评审；本文件不是该评审。
