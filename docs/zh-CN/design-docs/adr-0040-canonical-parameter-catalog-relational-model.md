# ADR-0040：规范参数目录将定义真相与组织使用关系分离

> English companion: [English decision record](../../adr/0040-canonical-parameter-catalog-relational-model.md)

日期：2026-08-31

## 状态

已被 [Wayfinder：用唯一规范定义模型替换参数目录](https://github.com/tzrea1-Q/WiseEff/issues/668) 接受为替换架构。本 ADR 描述目标模型，不表示当前运行中的数据库已经完成切换。

## 背景

当前目录把一份属性契约分散在 `parameter_specs`、`parameter_spec_versions`、归属主体、Schema 根/属性、组织 overlay、放置、评审、Binding，以及重复的 lifecycle/current 字段中。因此，组织 override、未匹配 DTS occurrence、待审提案或历史行都可能看起来像第二份当前定义。替换模型必须保留外部已引用的稳定身份和历史精确解释，同时把 Platform schema catalog 设为唯一结构真相来源。

[盘点当前参数目录契约和消费者](https://github.com/tzrea1-Q/WiseEff/issues/669) 确定了兼容义务；[分类旧参数行并确定修复语义](https://github.com/tzrea1-Q/WiseEff/issues/670) 确定旧行必须按完整关系图分类，R6/R7/R8 证据不能凭名称或 property key 变成当前定义；[选择规范参数目录关系模型](https://github.com/tzrea1-Q/WiseEff/issues/672) 确定了目标关系和剩余产品选择。

## 决策

### 核心关系

- `CatalogSubject` 是 Platform 所有的正式身份，具有且仅具有一个不可变 kind：`driver` 或 `node-type`。`Driver` 与 `NodeType` 是互斥的同级子类型，二者不互相拥有或包含。
- `ParameterDefinition` 恰好属于一个 CatalogSubject，并以 `(subject_id, property_key)` 在目录中唯一；不透明 `id` 是消费者使用的稳定引用。
- `DefinitionRevision` 是一份 ParameterDefinition 的不可变内容快照。包括已退役定义在内，每个定义都恰好有一个 current revision 指针；其余 revision 只是历史，不参与当前目录竞争。
- Organization 不拥有定义，只通过一个 `SubjectRegistration` 使用 CatalogSubject；该 registration 在组织 taxonomy 中有一个权威 `SubjectPlacement`。
- `ParameterObservation` 是不可变的项目/来源证据。成功匹配会记录当时使用的确切 definition 与 revision；未匹配或歧义只产生评审工作。
- `ParameterBinding` 是项目 logical node 通过组织 registration 与已匹配 ParameterDefinition 之间的稳定关联。Placement 通过 registration 推导，不属于 Binding 身份。
- `ProjectValue` 是某个 Binding 下的不可变值事实，并固定引用解释它的确切 DefinitionRevision；它不能修改定义内容。
- `DefinitionProposal` 是待治理的意图。它可以面向既有定义/revision，或提出新的 subject/property 身份，但它不是定义、revision、observation 或项目值。只有接受提案才能物化新定义或 revision。

一个 logical node 只解析到一个正式 subject：唯一 Driver `compatible` 匹配优先；仅当没有 Driver 匹配时，NodeType 才作为 fallback。两类定义不能在同一 observation 上合并。未知或歧义匹配必须失败关闭。

### 逻辑关系职责

下列名称表达目标职责。实现规范可以选择不同物理名称，但不得隐藏或削弱相同约束。

| 关系                                     | 职责与最小键                                                                                                                                                                                                                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `catalog_subjects`                       | Platform subject 根：不透明 `id`、`kind`、稳定目录 `canonical_key`、`status`。退役后仍永久保留 `UNIQUE (kind, canonical_key)`；没有 `organization_id`。                                                                                                                  |
| `catalog_drivers` / `catalog_node_types` | 恰好一个与 `catalog_subjects.kind` 相符的 subtype 行。Driver 专属 nature/cardinality 与 compatible 匹配语义位于 Driver 一侧；规范化 node-name fallback 语义位于 NodeType 一侧。发布产物、alias 和 matcher lifecycle 由后续发布决策治理。                                 |
| `parameter_definitions`                  | 不透明 `id`、`subject_id`、规范化 `property_key`、`current_revision_id`、`status`。永久 `UNIQUE (subject_id, property_key)`，并提供 `UNIQUE (id, subject_id)` 支持复合归属 FK；不包含组织、模块、来源优先级、提案或 observation 字段。                                   |
| `definition_revisions`                   | 不透明 `id`、`definition_id`、单调 `revision_number`、不可变 shape/constraints/units/documentation 与发布 provenance。`UNIQUE (definition_id, revision_number)`、`UNIQUE (definition_id, id)`；没有 current、lifecycle 或 precedence 标记。                              |
| `definition_proposals`                   | 不透明 proposal `id`、拟议身份/内容、可选目标定义、可选确切 base revision、评审状态、作者/provenance，以及可选 accepted revision。既有定义提案固定 base head，使接受操作执行 compare-and-swap，而不是覆盖并发目录变化。                                                  |
| 既有 DTS occurrence 关系                 | `dts_property_occurrences` 及其 logical-node/config-revision provenance 继续作为不可变 ParameterObservation 来源；它们不会被复制进目录或提升为定义。                                                                                                                     |
| `parameter_observation_matches`          | 每个不可变 occurrence 至多一条已接受匹配，连接确切 definition、definition revision、registration、binding 和匹配证据。没有行表示未识别；歧义是评审证据，不是 nullable 伪定义。                                                                                           |
| `organization_subject_registrations`     | 不透明 `id`、`organization_id`、`subject_id`、origin/proof、status。永久 `UNIQUE (organization_id, subject_id)`；退役不允许创建第二个 registration 身份。                                                                                                                |
| `subject_placements`                     | 不透明 `id`、`registration_id`、taxonomy module、placement provenance。`UNIQUE (registration_id)` 与 `UNIQUE (organization_id, module_id)` 确保一个当前权威放置，并阻止一个 module 放置两个 subject。                                                                    |
| `project_parameter_bindings`             | 不透明稳定 `id`、组织/项目/logical-node 身份、`definition_id`、`subject_id`、`registration_id`、显式 `current_value_id`。`UNIQUE (project_id, logical_node_id, definition_id)`；没有 `module_id`，placement 通过 registration 获得。                                     |
| project-value revisions                  | 当前 `project_parameter_binding_revisions` 的职责成为 ProjectValue：包含不透明 `id`、`binding_id`、`definition_id`、确切 `definition_revision_id` 的不可变 value/source/config 事实。`UNIQUE (binding_id, config_revision_id)`；任何查询都不得以最大行号或版本推断 tip。 |
| typed legacy-ID map 与 archive ledger    | 无法原样保留的 definition、revision、binding、subject、registration、placement ID 使用按 kind 区分的查询行。每个需要保留的 legacy ID 恰好映射一次；无法证明的对象映射到不可变 archive evidence，绝不能映射为运行态定义。                                                 |
| 既有 audit 关系                          | 治理与迁移 mutation 继续使用共享可信审计模型。Revision history 与 audit history 必须分离：前者说明契约是什么，后者说明谁或什么为何改变了目录状态。                                                                                                                       |

### 稳定 ID、当前 head 与退役

- 每个领域实体使用生成的不透明稳定 ID。`canonical_key`、`subject_id`、`property_key`、module path、内容或组织的 hash 都不是实体 ID；自然键纠正不应迫使外键重写。
- Definition 的唯一 current-revision 真相是 `parameter_definitions.current_revision_id`。可延迟复合 FK `(id, current_revision_id) → definition_revisions(definition_id, id)` 证明 head 属于该定义；事务提交时 `current_revision_id` 不得为空。
- Binding 的唯一 current-value 真相是显式 `current_value_id`，由同等的复合 FK 约束到该 Binding 所有的 ProjectValue。Reader 不得按数字顺序或时间戳选择“最新”行。
- CatalogSubject 或 ParameterDefinition 退役后，按适用范围禁止新识别、registration、binding 和发布；但不会删除行、清空 current revision、释放唯一键、重写 Binding 或重新解释 ProjectValue。恢复时重新启用同一稳定身份。
- 退役 subject 会使其定义不再用于新匹配；退役 definition 只影响该属性。既有 registration、placement、binding、observation、value、revision、引用和 audit 仍可读取。

### 数据库约束

数据库而不是只有 HTTP writer 必须执行以下不变量：

1. Catalog subject 只归 Platform、kind 互斥，并恰好有一个匹配 subtype；subject kind 不得原地改变。
2. 所有状态下，Definition 都按 subject/property 全局唯一；退役不是 partial index 的逃生口。
3. Revision 和 ProjectValue 行只追加。普通应用角色不能更新或删除；有界 migration role 只在已验证切换期间使用。
4. 复合 FK 证明 revision→definition、binding→definition/subject/registration、ProjectValue→binding/definition/revision、observation-match→definition/revision/registration/binding 一致。带 tenant 的关系使用包含 organization 的 candidate key，避免跨组织引用偶然满足 FK。
5. Placement 引用与 registration 同组织的 module。Driver registration 只能使用 driver-group module；NodeType registration 只能使用 node-type module。如果无法在不复制权威状态的情况下用复合 FK 加 `CHECK` 表达，就使用 constraint trigger 实施这个跨表 kind 规则。
6. 已识别 observation 必须引用 active、未退役的 subject/definition head 及组织 registration。未知或歧义证据没有 match 行，不能满足 Binding 创建条件。
7. 所有被保留的 subject、definition、revision、registration、placement、binding、ProjectValue、match、legacy map 和 audit 引用都限制删除。运行态退役是状态变化，绝不是级联删除历史。

### 事务不变量

- **发布：**锁定 definition 自然键或现有 head；验证 proposal/base revision 与发布产物；插入一个不可变 revision；compare-and-swap current pointer；解决 proposal；写入可信 audit；全成或全败。新 definition 在同一个可延迟约束事务中插入 root、首个 revision 和非空 head。
- **识别与绑定：**锁定 observation、`(organization, subject)` registration key 与 `(project, logical node, definition)` binding key。只有唯一 Driver 或 fallback NodeType 匹配才可创建/复用 registration 与 placement、创建/复用 Binding、插入初始 ProjectValue、记录 observation match、推进显式 value head 并审计。任何歧义都使 mutation 整体回滚，只留下 observation/review evidence。
- **修改项目值：**锁定 Binding head；重新验证确切 definition revision 与 write lock；插入一个不可变 ProjectValue；compare-and-swap `current_value_id`；审计治理工作流结果；全成或全败。
- **退役或恢复：**锁定 subject/definition，在不改变身份或 head 的情况下修改状态，并原子提交 audit；绝不以退役副作用重写既有引用。
- **移动 placement：**锁定 registration 与来源/目标 taxonomy key，在一个事务中更新单一 placement 并审计。具体 move/adoption 策略属于 registration/placement 决策，而不属于 Binding。
- **迁移：**一个保留对象、它的全部外键消费者、typed legacy-ID mapping/archive disposition 以及迁移 audit evidence 必须同时可见；部分映射或猜测身份不能提交。

### Driver 与 NodeType 差异所在层

差异只位于 CatalogSubject subtype、schema-publication matcher 和 placement 校验层：

- Driver 通过唯一权威 `compatible` 匹配，并携带 Driver 专属 nature/cardinality 事实。
- 仅当没有 Driver 匹配时，NodeType 才通过规范化 node name 作为 fallback。
- 两者的组织 module kind 约束不同。

ParameterDefinition、DefinitionRevision、Proposal、registration 身份、退役、稳定 ID、audit、Binding 和 ProjectValue 对两种 subject kind 使用同一 interface。因此，Definition 内容或 ProjectValue 存储中的 Driver/NodeType 分支属于放错层的关注点。

### 不再作为运行真相的现有结构

具体物理删除时机由 cutover/archive 决策确定，但目标稳态没有以下结构的等价物：

- 组织所有的 `parameter_specs`、organization-over-Platform precedence，或把 `parameter_specs.organization_id` 当作定义所有权；
- 当前定义路径上的 `source_kind`、`specification_key`、重复 subject/property/module 身份、重复 definition/version lifecycle、重复 current 标记或 hash-derived ID；
- 把 DriverSchema root 表示成 ParameterDefinition，或让 `dts_property_specs` 与 DefinitionRevision 并列成为第二份可变属性契约；
- `driver_schema_overlays`、`driver_schema_overlay_properties`、组织 schema promotion 与新的组织定义 override；
- 组织 shadow `attribution_subjects`；当前 `driver_registrations`/`node_type_definitions` 迁移为 Platform subject/subtype 身份；
- 仅适用于 Driver 的 `driver_registration_placements`；它由同时适用于两种 subject kind 的通用 registration 与 subject placement 替代；
- 作为竞争 placement/identity 事实的 `parameter_modules.attribution_subject_id` 和 `project_parameter_bindings.module_id`；
- unmatched surface provisional definition 与 definition-shaped `parameter_spec_review_tasks`；其职责由 observation 与 proposal 替代；
- “latest revision/version” 查询，或 legacy/canonical store 之间的长期 dual-write/trigger bridge。

这些行可以临时保留在 migration archive 或有界 compatibility adapter 中，但绝不能参与目标 current-definition 选择。

## 后果

- Catalog kernel 能为 Driver 与 NodeType 提供一个小而统一的 definition/revision interface，同时把发布、锁、ID translation 和不变量检查隐藏在 seam 后。
- Organization 使用关系不能改变结构真相。Registration 与 placement 可以演进而无需创建、复制或修改定义；移动 placement 不改变 Binding 身份。
- 即使发生语义发布、身份纠正、placement 移动或退役，历史 ProjectValue 仍由确切 revision 解释。
- 我们接受更多显式 join 与事务编排，以消除 polymorphic FK、按行顺序选取、nullable 伪定义，以及重复 current/lifecycle 真相。
- 发布产物/lifecycle、catalog module interface、registration 边界情况、API 过渡、populated-data mapping/archive 和 release gate 继续由既有 Wayfinder 票负责；它们可以细化工作流，但不得削弱本 ADR 的身份、分离、约束与事务不变量。
