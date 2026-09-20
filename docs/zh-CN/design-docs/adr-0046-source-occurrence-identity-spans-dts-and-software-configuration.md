# ADR-0046：源出现位置身份同时覆盖 DTS 出现位置与软件配置实例

> English companion: [English decision record](../../adr/0046-source-occurrence-identity-spans-dts-and-software-configuration.md)

日期：2026-09-15

## 状态

作为 [#849](https://github.com/tzrea1-Q/WiseEff/issues/849) 参数录入点统一的源身份契约被接受——范围第 2 项，实现决策 3、6、7、10、13，测试决策 6，以及用户故事 10、11、21。

本记录冻结实现必须满足的语义契约，**不**自行证明任何迁移、关系、路由、UI 界面或威胁矩阵行已经完成或已验证；那由可执行矩阵及其门禁给出。决策时实现在 `feat/849-parameter-unification`（PR #858）进行中，该分支占用 ADR-0045；这是历史编号背景，不代表当前交付状态。当前 T1.1 状态见[来源 occurrence 矩阵](../exec-plans/active/849-inventory/source-occurrence-threat-matrix.md)。合入前须按 [Fleet Coordination](../../agents/fleet-coordination.md) 再次复核 ADR 编号。

## 背景

当前 Canonical Binding 身份被钉死在 DTS 逻辑节点上：

- `parameter_catalog.project_parameter_bindings.logical_node_id` 为 `not null`（`server/migrations/0137_canonical_parameter_catalog_schema.sql:1139`），其唯一键中有三个包含它（`:1147`、`:1151`、`:1152-1156`）。
- `parameter_catalog.parameter_observations` 在自身复合键中包含 `logical_node_id text not null`（`:2995`、`:3006-3008`）；`parameter_catalog.parameter_observation_matches` 既引用该键（`:3214-3223`），又通过复合外键回指 Binding 的七列 match identity（`:3239-3244`）。
- 不可变触发器 `parameter_catalog.protect_binding_identity()` 在每次更新时比对 `logical_node_id` 等列（`:1300-1324`）。
- 当前解析是迁移自有函数且授权逐条枚举：`parameter_catalog.resolve_current_binding(text, text, text)`（`server/migrations/0144_definition_replacement.sql:499`，授权见 `:654-698`）。
- 写路径重复同一身份：`StabilizeBindingCommand.logicalNodeId: string`（`server/modules/parameter-bindings/binding/types.ts:19`）、非空校验失败即拒命令（`binding/service.ts:59-60`）、`deriveBindingId()` 将其纳入哈希（`binding/repositories.ts:42-63`），以及以 `(project_id, logical_node_id, definition_id)` 为键的 `loadBindingByComposite()` / `insertBinding()`（`:105-126`、`:143-148`）。

同步入口同样是 DTS 观测模型：`listObservedProperties()` 读取 `dts_occurrence_effects`、`dts_logical_node_revisions`、`dts_property_occurrences`，再把 `logicalNodeId` 传给 `stabilizeCanonicalBinding()`。因此缺口不是 `materialize.ts` 里的一个 `if`。

与此同时，JSON 软件配置既已部分可表达，也被显式延后：

- `project_parameter_values.value_kind` 允许 `'json'`（`0137:1214`），两个 JSON 种子源是标量 `number`，发布能力本就接受——所以值容器和定义能力都不是阻塞点。
- `server/modules/parameter-bindings/seedInitialization/materialize.ts:124-137` 在语义摄入前拒绝所有非 DTS 文件，抛 `UNSUPPORTED_FORMAT` 并标注 `deferredTo: TD-124-json-project-source-semantics`。

[#849](https://github.com/tzrea1-Q/WiseEff/issues/849) 已要求 Binding 边界区分 DTS 出现位置与软件配置实例，并且不得因为共享 Definition 就合并多个 config-set 或实例。

## 决策

1. **统一的源出现位置身份层。** 引入 `parameter_catalog.project_parameter_source_occurrences`，其身份至少包含 organization + project + config-set + occurrence-kind + instance-id，并额外钉住不可变的源文件身份与格式专属 locator。DTS 出现位置关联既有 `logical_node_id`；ConfigurationSchema 出现位置使用稳定的 `configuration_instance_id`；JSON locator 采用严格定义的 JSON Pointer 语法——明确 `~0`/`~1` 转义与数组下标规则——而不是含糊的点号字符串。
2. **Binding 唯一性跟随出现位置。** `project_parameter_bindings` 增加 `source_occurrence_id`，项目范围内唯一性收敛为 `(project_id, source_occurrence_id, definition_id)`。由于出现位置本身已区分 config-set 与实例，共享同一 Definition 的两个实例永不塌缩为一个 Binding。
3. **不采用可空平铺的 DTS 列。** 不把 `logical_node_id` 简单改为可空、再平铺一组 JSON 专用可空列；那会让 Binding 永久背负 DTS/JSON 的 XOR，并把未来格式继续塞进同一张表。既有 DTS Binding 原地 backfill、保留现有 Binding ID，其身份永不被重新派生；只有新的 JSON Binding 从出现位置派生身份。
4. **修订钉不是 Binding 身份。** 不可变的 file-version / config-revision 钉属于 ProjectValue 与源修订层。把它纳入 Binding 键会让每次合法写回都铸造一个新 Binding。
5. **历史能力修订保持原义。** `catalog-capability/v1`、`/v2`、`/v3` 不被重新解释：B1 是项目侧身份演化。运行时本就保留旧修订并接受当前修订，该历史兼容策略继续有效。
6. **JSON 写回契约。** 所有非目标语义必须保留，任何仅序列化层面的变化（空白、键序）必须进入评审可见的 diff。**不**承诺 JSON 逐字节不变，因为序列化本就会合理地重排或重排格式。
7. **先扩展、再验证、后切换。** 身份迁移采用 schema-expand：先新增出现位置关系并 backfill DTS，双读对齐后再切换唯一性与查询。完整矩阵通过前不删除 `logical_node_id`。失败时把消费者回退到旧的 DTS 投影——已应用的迁移永不改写。
8. **完成即完整矩阵。** B1 只有在面对 DTS 与 JSON 两者都跑通 import preview → candidate/draft → review → apply → source reparse → export → reimport 后才算关闭。"preview + apply" 是内部里程碑，不是验收。

本决策不改变种子相等性 oracle：受审 fixture 仍为每项目恰好 124 个 Binding（120 board + 2 DTS 兼容 + 2 JSON 兼容），三项目 372。现实中存在多个 config-set 与实例的项目当然可以超过 124；124 是该 fixture 的精确集合，不是 schema 上限，验收要求相等而非下界。

## 已接受的补充决策 — 2026-09-16

独立设计评审后，用户明确确认 T1.1 的以下决策：

- JSON 配置实例在显式导入／注册时由服务端分配 opaque ID，绑定组织、项目、配置集、不可变文件 ID、正式 ConfigurationSchema 和根／子树 JSON Pointer。同一已证明实例的版本更新／重导入，以及同一文件 ID 的改名保持身份；换文件 ID、配置集、模型或移动实例根则新建实例并显式映射，不自动转移历史／当前值。数组重排后不能仅凭索引推断连续性。统一 source-occurrence 关系拥有实例身份，参数 locator 和版本 pin 与实例根定位分开。
- 任一历史 Binding、observation 或 match 来源无法证明时，阻止**整个身份迁移**。沿历史版本的不可变文件 ID 追溯，不依赖当前版本指针；来源缺失、矛盾或歧义时报告并回滚事务。不伪造来源、不删除、不静默隔离后继续。旧 DTS schema／数据保持可用；未授权隔离后继续策略。

这只确定身份生命周期和升级可用性，不代表实现完成、迁移验收通过或目标／删除授权。

## 影响

- **共享 SQL 面比 Binding 表更宽。** `parameter_observations` 被 `logical_node_id` 钉住，`parameter_observation_matches` 复制了 binding 的 match identity，`resolve_current_binding` 是授权逐条枚举的迁移自有函数。同签名重载无法共存，因此扩展步骤新增**另一个函数名**并配自己的授权，ACL/角色面预期会变化。
- **触发器顺序。** `protect_binding_identity()` 阻止对身份列的任何更新，因此先 backfill 新列；backfill 之后、切换唯一性之前，才把该函数扩展为覆盖出现位置。
- **归属。** `parameter-files` 拥有 JSON 文件解析、locator、patch 与写回；Binding 层只消费统一的源出现位置契约。`parameter-topology/ingestService.ts` 仍是 DTS 归属方，不得变成 DTS+JSON 的合并解析器。
- **冻结指纹。** S2-SCH schema 指纹与 canonical 关系计数会变，角色清单与 ACL 指纹很可能随新函数授权而变。catalog capability allow-list digest、`catalog-capability/v3` 与编译器契约 golden **不应**因 B1 而变；若变化，应作为异常解释，而不是顺手更新。
- **先规格后实现。** 该变更是 R3。威胁矩阵与独立 Spec 评审先于实现，而不是之后。

### 随本 ADR 一并记录的决策

同一轮评审的另外两项决策记录于此，因为它们界定同一个参数平面；它们本身不是架构级身份决策。

**值能力修订。** 发布一次 `catalog-capability/v4`，覆盖递归/嵌套数组、`minItems`/`maxItems`、仅含 description 的 mixed item schema，以及数组自身的 `description`。基数只能来自权威的 vendor 元数据，绝不来自观测数据：`gpio_int` 的 cell 数是 `schemas/dts/vendor/wiseeff/mt-mt5788.yaml` 与 `sc8562.yaml` 中声明的 `constraints.cells: 3`，而复杂 DTS fixture 的 3 行是观测，不得成为 schema 约束。这些 fixture 的列语义在成为不变量前需要受审的源证据；把 cell 矩阵扁平化不可接受。`charging_core` 的正式主体是一项受审的 NodeType 发布决策，而不是与既有 `huawei,charging_core` Driver 的名称相似度匹配。`v1`/`v2`/`v3` 产物保持原义，且 v3 消费者必须在安装前拒绝 v4 内容，而不是容忍它。

**种子完成条件 fail-closed。** 任一必需主体没有同类空闲 placement 模块时，种子初始化不得报告 `completed`。`seed_initialization_runs.status` 已允许 `'failed'`，且运行本就带 `blocked` 数组（`server/migrations/0148_seed_initialization_runs.sql:15,18`），因此无需迁移——只需主体级 blocker DTO 与完成条件。自动创建用户可见 `business` 模块被否决：那会把 trusted-system 权限从数据初始化扩大到信息架构变更，而 ConfigurationSchema 主体没有可据以决定 taxonomy 位置的源拓扑证据。必须由操作者按评审补足。

## 验证责任人

- **身份与迁移：** canonical catalog schema 归属方与 Binding 仓库归属方，在真实 lane PostgreSQL 上验证，包含 backfill 不改变历史 DTS binding ID。
- **JSON 源语义：** parameter-files 归属方，覆盖 locator 语法、修订钉、陈旧修订 CAS、写回保真与 export/reimport locator 稳定性。
- **能力 v4：** catalog-publication builder 归属方，覆盖递归深度与容器预算、未知关键字 fail-closed，以及逐字段等于受审的 `gpio_int` 输出。
- **种子 fail-closed：** seed-initialization 归属方，覆盖 blocker 日志与第二次 completed 重放为 no-op。
- **独立评审：** Standards 与 Spec 在实现前评审威胁矩阵，并在任何验收声明前评审由此产生的 release 与 seed fixture。
