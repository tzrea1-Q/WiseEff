# T1.1 Source Occurrence Schema 契约

> English: [English contract](../../../../exec-plans/active/849-inventory/source-occurrence-schema-contract.md)

状态：T1.1 仅设计契约。本文不代表已实现或已验收任何迁移、应用代码或目标环境能力。

依据：

- [ADR-0046](../../../../adr/0046-source-occurrence-identity-spans-dts-and-software-configuration.md)
- [B1 威胁矩阵](../../../../exec-plans/active/849-inventory/source-occurrence-threat-matrix.md)
- 当前 Catalog schema：`server/migrations/0137_canonical_parameter_catalog_schema.sql:1133-1324,2991-3249`
- 当前文件/DTS 来源图：`server/migrations/0041_project_parameter_files.sql:1-27`、`0043_dts_config_set_baseline.sql:1-42`、`0048_parameter_topology_schema_shadow.sql:91-195`
- 当前替换投影与 resolver：`server/migrations/0144_definition_replacement.sql:352-530`

用户已确认两个 T1.1 身份决定：JSON instance 使用服务端生成、绑定以下不可变所有权范围的稳定 ID；任何无法证明的既有 Binding、observation 或 match 都使整个 backfill 事务失败。本文把这两个决定落实为可实现的 schema 形状，不启动 T1.2，也不新增产品能力。

## 1. 不变量

1. Binding 表示一个 Catalog Definition 在一个 source root occurrence 上的绑定。source revision、file version、参数 locator 都是 ProjectValue/source-pin 事实，不是 Binding 身份。
2. DTS occurrence 使用现有真实的 `dts_logical_nodes.id`；JSON occurrence 使用服务端生成的 `configuration_instance_id`。不得给 JSON 行伪造 DTS logical node。
3. JSON instance 身份为 `(organization_id, project_id, config_set_id, file_id, configuration_instance_id, configuration_schema_subject_id, root_pointer)`。仅在不可变范围被证明相同的情况下复用。相同 `file_id` 的文件改名保留 instance；切换 config-set、替换为新 `file_id`、更换 schema/model 或移动 root 会创建新 instance，不自动转移历史。
4. occurrence root 与参数 locator 分离：root 归 unified source-occurrence relation；精确 property/pointer locator 归不可变 ProjectValue source pin，并冻结到 draft/change request。
5. `source_ref` 仅为兼容性的显示/审计标签，不能作为 writeback、export、ownership 或身份解析的权威。
6. identity-only placeholder **value** 是历史的、不可 draft 的 value。它没有 source pin。backfill 期间每个 Binding 仍必须获得已证明的 source occurrence；不能用 placeholder current value 掩盖无法证明的 Binding root。
7. 既有 DTS Binding ID、ProjectValue ID、history ID、observation ID 与 match ID 不重新派生、不改写。backfill 只在 provenance 证明后增加 link 与不可变 pin 行。
8. 已被引用的 source occurrence、source pin 或 history 不得因父对象移动/删除而改绑或消失。移动必须创建新的 file/instance occurrence，而不是原地改身份。

## 2. Relation 与 key

### 2.1 Unified source occurrence

新增 `parameter_catalog.project_parameter_source_occurrences`：

| 列 | 契约 |
| --- | --- |
| `id` | 服务端 opaque ID，主键；source revision 间只生成一次并保持稳定。 |
| `organization_id`, `project_id` | `not null`；指向 `public.projects` 的租户完整复合 owner key。 |
| `config_set_id` | `not null`；现有 `dts_config_set` 作为两种格式共用的项目 configuration-set 存储。 |
| `file_id` | `not null`；不可变 source-file 身份，不是 `current_version_id`。 |
| `occurrence_kind` | `not null`，只能是 `dts` 或 `json`。 |
| `logical_node_id` | 仅对 `json` 可为空；`dts` 必须非空，并 FK 到 `dts_logical_nodes` 的租户完整 key。 |
| `configuration_instance_id` | 仅对 `dts` 可为空；`json` 必须非空，由服务端生成且全局唯一。 |
| `configuration_schema_subject_id` | 仅对 `dts` 可为空；`json` 必须非空，FK 到 `parameter_catalog.catalog_configuration_schemas(subject_id)`。 |
| `root_pointer` | 仅对 `dts` 可为空；`json` 必须非空，为 canonical RFC 6901 pointer。 |
| `root_pointer_digest` | 仅对 `dts` 可为空；`json` 必须非空。 |
| `created_at` | 追加创建时间。 |

必须具备：

- 唯一 `(id, organization_id, project_id)`，供 Binding 与 pin 的租户完整 FK 使用。现有父表若缺租户完整 unique key，先补充后再依赖它们。
- DTS 部分唯一键为 `(organization_id, project_id, config_set_id, file_id, logical_node_id) where occurrence_kind = 'dts'`。JSON 同时有 natural replay key `(organization_id, project_id, config_set_id, file_id, configuration_schema_subject_id, root_pointer)` 与 `unique (configuration_instance_id)`。因此新 instance ID 不能掩盖重复 root，instance ID 也不能跨范围复用。
- `(project_id, organization_id)` → `public.projects`；`(config_set_id, organization_id, project_id)` → `dts_config_set`；`(file_id, organization_id, project_id, config_set_id)` → `project_parameter_files`；DTS 的 `(logical_node_id, organization_id, project_id, config_set_id)` → `dts_logical_nodes`。现有父表若缺租户完整 unique key，先补充后再依赖这些 FK。
- 三个父级 FK 均为 `on delete restrict`，不得让 source occurrence cascade。引用后允许改 `file_name`，但拒绝修改 file 的 organization/project/config-set；移动必须使用新的 file identity，因而产生新的 occurrence。
- kind CHECK 是表级契约：DTS 要求 `logical_node_id` 非空且所有 JSON 列为空；JSON 要求 instance、schema、root pointer、digest 非空且 `logical_node_id` 为空。SQL 检查 pointer 的语法，source service 针对解析文档检查语义；延迟 owner trigger 检查 JSON schema 与 organization 的 registration。
- 应用必须使用已评审的 ConfigurationSchema→pointer 映射，不得从文件名或 Definition property key 推断身份。root pointer `''` 合法；`~0`、`~1` 是唯一转义；数组 token 由解析文档校验。

node path 与 property occurrence 随 revision 变化，不进入身份表。精确历史 `dts_property_occurrences.id` 及 node/file locator 进入下述 source pin。

### 2.2 Binding 身份迁移

向 `parameter_catalog.project_parameter_bindings` 增加 `source_occurrence_id`：

- 扩展列仅在 all-or-nothing backfill 完成前可为空。之后每个既有 Binding 都必须有已证明的非空 source occurrence；placeholder current value 只能表示 value-history 状态，不能表示 Binding 身份未证明。
- 增加 `(source_occurrence_id, organization_id, project_id)` 到 unified occurrence 的租户完整 FK，同时保留现有 owner/Definition FK。
- source-backed 行增加 `(project_id, source_occurrence_id, definition_id)` 唯一键，以及 observation/match 所需的租户完整等价 key。扩展及 dual-read 阶段仍保留旧 `(project_id, logical_node_id, definition_id)` key。
- 保留 `logical_node_id` 作为兼容投影：DTS 行保持已证明的 logical node；只有在 fenced 旧 writer 后切换，JSON 行才允许为空。Binding 不添加 JSON 专用列。完整 B1 矩阵通过前，旧 DTS resolver 继续使用该投影。
- `protect_binding_identity()` 在 backfill 完成并验证新 link 后，再扩展为拒绝 `source_occurrence_id` 修改，并继续拒绝删除。

placeholder ProjectValue 保持显式的 non-source value：在追加真实 source-backed value 以前，不可 draft、write、export 或 reimport。Binding 本身仍有 source occurrence；不得用 placeholder 满足 Binding FK。

### 2.3 不改写不可变 ProjectValue 的 source pin

不要向不可变的 `parameter_catalog.project_parameter_values` 历史行增加需要回写的 source 列。新增 `parameter_catalog.project_value_source_pins`：

| 列 | 契约 |
| --- | --- |
| `id` | 不可变 opaque pin ID，主键。 |
| `project_value_id` | `not null`、唯一；FK 到不可变 ProjectValue，`on delete restrict`。 |
| `binding_id`, `organization_id`, `project_id` | 租户完整 Binding ownership proof。 |
| `source_occurrence_id` | root occurrence pin。 |
| `config_revision_id` | 该 value 使用的精确 revision。 |
| `file_id`, `file_version_id` | 精确不可变 source object；通过租户完整 file/version key FK。绝不通过 `project_parameter_files.current_version_id` 解析。 |
| `format` | `dts` 或 `json`，必须等于 occurrence kind。 |
| `property_occurrence_id` | 仅 JSON 可为空；DTS 必须非空并 FK 到精确历史 `dts_property_occurrences` 行。 |
| `locator` | `jsonb not null` 的 typed locator object。DTS 要求 `kind='dts-property'` 及 pinned property/node locator；JSON 要求 `kind='json-pointer'` 及 canonical pointer。 |
| `locator_digest` | 格式专属 pin payload 与 source checksum 的 digest。 |
| `created_at` | 追加时间。 |

`locator` CHECK 按格式要求唯一的 typed object shape。延迟 trigger 检查 DTS property 属于 pinned `config_revision_id` 与 `file_version_id`、property key 等于 Binding Definition、node 属于 Binding occurrence。JSON 由 service 验证 decoded-key 唯一、数组 index、pointer 位于 occurrence root 内、parsed-index 成员及 file checksum。pin trigger 同时证明 `file_id` 是 `file_version_id` 所属 file，且 revision member 一致。

base pin 与 JSONB locator 均不可变。source revision 变化只追加新的 ProjectValue 与新 pin，不更新旧 pin。`locator` CHECK 与延迟 owner trigger 是唯一 typed-pin seam，不再增加第二套格式专属 pin 表。

DTS pin 持久化键精确为 `kind, propertyOccurrenceId, nodeOccurrenceId, fileVersionId, propertyName`；JSON pin 只有 `kind, pointer`，精确 file version 已由单独的受归属约束 pin 列保存。locator 值必须全部为 JSON 字符串，禁止多余键或类型转换。observation provenance 不同：按 §2.5，其 JSON locator 在 `kind, pointer` 外还包含 `fileVersionId`。不得将 observation 专用字段加入旧 pin 而改变 digest preimage。

`project_parameter_values.source_ref` 与 `config_revision_id` 仍保留用于兼容、展示及旧 history 查询，但 source-pin relation 才是 writeback、export、stale 检查和 ownership 的权威。placeholder ProjectValue 有意不创建 pin。

source pin 对 ProjectValue 与 Binding 使用租户完整复合 FK，并以延迟 ownership 检查证明 pin 的 `(binding_id, project_id, organization_id)` 与 `source_occurrence_id` 和 ProjectValue 的 Binding/occurrence 完全一致。历史 pin 不必等于 current tip；延迟 current-tip guard 只约束 Binding 当前的 non-placeholder tip。此类 tip 必须恰有一个匹配 pin，且 pin 必须匹配同一 Binding、occurrence、不可变 file/version 与 revision member。placeholder current tip 没有 pin，会阻止 upgrade/workflow 启用；只有在同一个原子 append transaction 立即安装已证明的 source-backed replacement 时，才允许 runtime transient placeholder。

### 2.4 Draft、candidate 与 change-request pin

Revision member alias 修正：在既有 `dts_config_revision_members` 增加 nullable `source_name`，不新增关系。它是稳定解析／导出 alias，不是文件身份或当前展示名。非空 alias 遵守相对逻辑路径规则，同 revision 跨格式唯一。canonical source pin 所引用 revision 的全部成员必须有已证明 alias；既有 pinned-member 不可变 guard 也覆盖此列。历史回填只使用唯一历史 manifest，或与历史 file／version／member 归属交叉证明的不可变命名证据。证据缺失／冲突整次升级中止，当前 `file_name` 和 storage key 不构成证据；未引用旧成员可为空。运行时 `sourceName` 与展示 `fileName` 分开；canonical load／prepare／commit／export 拒绝空 alias，后续 canonical revision 沿用 pinned alias。完整证明边界见 workflow 的精确导出小节。

向 `project_parameter_value_drafts` 与 `project_parameter_value_change_requests` 增加 `source_pin_id`：

- 扩展阶段旧行可为空；切换后的 canonical workflow 中，source-backed draft/request 必须非空。
- 复合 FK 证明 `(source_pin_id, organization_id, project_id, binding_id)` 所有权。延迟 trigger 证明 pin 的 `project_value_id` 等于 `base_current_value_id`。
- submit 将 draft 的精确 pin ID 复制到 change request。`source_ref` 只是展示快照。review 在 append/writeback 前重新验证 pin、file checksum、config revision/member 归属、occurrence 身份与 current-value CAS。
- current value 为 placeholder 的 Binding 没有 pin，不能创建 draft/request。已有无 pin 的 pending 行是迁移 blocker，不得静默转为另一种身份状态。

source-edit artifact 复用 `public.project_parameter_file_candidates`；不得增加 generic artifact 或第二套 candidate 表。向现有 candidate 行增加服务端持有字段：

| 列 | 契约 |
| --- | --- |
| `base_digest`, `proposed_digest`, `diff_digest` | `text`；扩展期间 legacy/unprepared candidate 可为空；prepared source artifact 中三个 digest 必须成组存在，均为 canonical SHA-256 digest。`base_digest` 是 candidate-file base bytes（新文件使用空字节），`proposed_digest` 是 candidate bytes（规范化后等于现有 stored `checksum`），`diff_digest` 是 canonical reviewed diff 的 digest。 |
| `frozen_member_manifest` | `jsonb`；扩展期间 legacy/unprepared candidate 可为空；否则必须是按 `fileId` 排序的完整 `{configSetId,memberId,fileId,fileVersionId,sourceName,checksum,sizeBytes,format,role,sortOrder,isCandidateFile}` 数组。包含受影响配置集的全部成员，而不只是修改文件；commit 以此执行 CAS。 |
| tenant key | 增加 `unique (id, organization_id, project_id)`，让每个 request FK 证明 candidate 属于已认证 tenant。现有 candidate 的 `file_id` ownership 必须补为租户完整，不能 cascade 删除被引用的 candidate。 |
| `frozen_binding_manifest` | `jsonb`，下文定义的完整有序受影响 Binding 集合；纳入同一 prepared artifact 字段组，提交后不可变。 |

`base_version_id`、`file_id`、`file_name`、`format`、`storage_key`、`checksum`、`size_bytes`、`parsed_index`、`diagnostics`、`impact`、`blockers`、三个 digest 与两个 manifest 都是 payload/base 字段。既有 legacy candidate 可保持新增字段组为空；source-backed candidate 必须一次填齐五个 prepared 字段，draft/request 只有在成组完整后才能引用。只要任一 submitted change request 引用 candidate（pending、approved、rejected 或 withdrawn），trigger 就拒绝修改；生命周期 status 遵循既有状态机，被引用时禁止删除。不可变 manifest 的 canonical bytes 属于评审 artifact，重试不能静默替换源或受影响集合。

向 draft 与 request 同时增加 nullable `candidate_id`、`candidate_base_digest`、`candidate_proposed_digest`、`candidate_diff_digest`、`candidate_member_manifest` 和 `candidate_binding_manifest`，使既有行无需臆造 artifact。draft copy 仅在 submit 前可编辑。submitted source-backed request 保存 candidate ID 与五个不可变 snapshot，并以租户完整 FK `(candidate_id, organization_id, project_id)` 指向 candidate；后续不信任重新读取的 candidate。延迟 trigger 要求 submit 时 snapshot 与 candidate 一致，并在此后拒绝编辑。request 的两个 manifest 必须完整且分别与 candidate 对应项 canonical 相同。

commit 前 candidate 必须为 `ready`，所有 member file version 仍匹配 frozen manifest，object-store bytes 必须匹配 `proposed_digest`。writer 按排序锁定所有 affected config-set ID，再按排序锁定 member file ID、affected Binding ID、request ID；在这些锁下比较完整 member version ID/digest、candidate digest、source-pin locator 与 request/base CAS 后才能写入，绝不解析 current-only snapshot。

与 candidate manifest 关联的 JSON locator，以及 source pin、draft、request 中的 JSON locator，都是 document-absolute RFC 6901 pointer。containment 比较 decoded token array，并接受 root equality；禁止 textual 或 encoded-string prefix 检查。若 import 改变 array position 或旧 root 无法证明，必须拒绝 in-place activation；调用方需注册新 file identity/instance 或提交显式的新 root mapping，旧 instance 与 history 绝不静默复用。

在准备而非审批时冻结受影响 Binding 集合。增加 candidate 的 `frozen_binding_manifest` 及 draft/request 的 `candidate_binding_manifest` JSON 数组，纳入同一全有或全无的 prepared artifact 字段组及不可变快照校验。按 Binding ID 排序，完整记录受影响租户／项目／配置集内既有 source-backed Binding 的 `bindingId, oldValueId, sourcePinId, sourceOccurrenceId, definitionId, effectiveRevisionId, catalogReleaseId, locator, valueKind, valueDigest, configSetId`，并随 diff 展示。审批锁定并逐项比较准确集合，包含成员增删；新增／移除 Binding、placeholder、值／pin／locator／Definition／release 漂移或归属未获证明时，整体以 stale-cohort 拒绝，不静默纳入新工作。DTS property occurrence 随 revision 改变；须在新 revision 的同一 source occurrence 内重新解析语义 property，不能复用旧 offset/property-occurrence ID。非目标 typed business value 必须不变，所有传播对象的旧 pending draft/request 保持不可变且过期。

apply 幂等性复用 `parameter_catalog.binding_history_events`，不增加 generic idempotency table。增加 nullable `applied_request_id`、request FK 及非空值的 `unique (applied_request_id)`，仅目标 history 携带该键。延迟 owner check 证明 request 与 event Binding 的 organization/project 一致。在既有目标 `applied_value_id`、`apply_outcome`、`applied_at` 旁增加不可变 `applied_history_event_id`、`applied_audit_ref`、有序 `applied_file_version_ids` 及 `applied_source_result jsonb`。result 对象的有序 `bindings` 条目记录 `ordinal, bindingId, oldValueId, newValueId, sourcePinId, configRevisionId, fileVersionId, historyEventId, kind`（`target` 或 `sibling-derived`），Binding ID 与 ordinal 各自唯一。此结构化不可变结果将每个同级 history 关联回 request，不能只用 reason 字符串。一个批准批次为每个受影响 Binding 追加一次 value/pin/history，每个配置集一次 revision，整批仅一份用户生效 audit，所有 history 引用它；不能直接循环现有独立审计的 append。生效 audit 包含 target、cohort/result digest/count 与新 revision 元数据。获授权重试返回存储的完整结果，不追加任何 version/value/history/applied audit；不同 request ID 不算幂等重放。

### 2.5 Observations 与 matches

扩展阶段向 `parameter_catalog.parameter_observations` 与 `parameter_catalog.parameter_observation_matches` 增加 `source_occurrence_id`：

- Observation 的租户完整 FK 目标为 `(observation_id, organization_id, catalog_release_id, matcher_revision, project_id, source_occurrence_id)`。切换前保留 `logical_node_id` DTS 投影；新的 source-backed 行必须携带同一个 occurrence。
- 将当前 `(organization_id, source_identity)` 唯一性替换为精确 replay key：`(organization_id, project_id, source_occurrence_id, config_revision_id, parameter_locator_digest, catalog_release_id, matcher_revision)`。`parameter_locator_digest` 是带格式标签的规范**参数**定位（DTS 精确 property occurrence/file-version，或文档绝对 JSON Pointer/file-version）的 SHA-256，而不是根 occurrence；定位存入 `source_locator`，验证 digest 及 occurrence 归属。重放比较完整 locator 和 evidence payload，矛盾即拒绝，不只凭 digest 相等。一个 occurrence 内两个不同参数都必须保留。`source_identity` 仍是幂等/evidence digest，不作为 ownership identity。
- Match 增加 `(binding_id, organization_id, project_id, source_occurrence_id, registration_id, subject_id, definition_id)` 到 Binding 的复合 FK，并对 Observation 使用相同 occurrence 归属。即使 subject/Definition 相同，不同 occurrence 也必须失败。
- 既有 `parameter_review_evidence` 保留 ID；其 observation FK 随 expanded key 更新。

### 2.6 Replacement projection 与 resolver

`definition_replacement_projects` 继续保留旧/新 Binding 投影（`server/migrations/0144_definition_replacement.sql:352-412`）。新增延迟完成 guard：旧、新 Binding 必须有同一 `source_occurrence_id`；替换同时移动 source root 时拒绝完成，改走新的 occurrence workflow。现有 current-binding view 继续隐藏已完成替换的旧 Binding。

增加不同名称的 resolver，例如：

`parameter_catalog.resolve_current_binding_by_source_occurrence(text project_id, text source_occurrence_id, text definition_id) returns text`

其要求：

- 先解析 completed replacement，再解析未被替换的 source-backed Binding；
- 0 个候选返回无结果；
- 多于 1 个候选，或 replacement 的 occurrence 与旧 Binding 不同，抛出明确 ambiguity 错误；
- 绝不使用 `limit 1` 隐藏重复所有权；
- 保留旧三参数 `resolve_current_binding(project, logical_node, definition)` 作为 DTS 兼容投影，直到 B1 完成，但移除其当前任意的 `limit 1`：0 个候选无结果，多于一个 replacement/base 候选抛出相同 typed ambiguity error。

### 2.7 父级 ownership 与删除

在校验 occurrence FK 前，为项目/config-set/file/version/revision-member 现有表补充作为复合 FK 目标的租户完整 unique key，然后执行：

- source occurrence → config set/file：`on delete restrict`；
- source pin → occurrence/file version/config revision：`on delete restrict`；
- Binding、ProjectValue、observation、match、draft、request、replacement history：保留现有 `on delete restrict`；
- 稳定 `file_id` 时允许改名；
- 已引用 file/config-set/project/organization 不允许重新归属；移动必须创建新 file/instance；
- JSON root/schema relocation 创建新的 `configuration_instance_id`，不自动转移历史。

### 2.8 已 pin 来源图的追加修正提案（2026-09-17）

历史设计门禁：独立 Spec（`t06_status_audit`）与 Standards（`t11_design_spec`）于 2026-09-17 在实现授权前批准下述具体设计。两者发现按所选行保护未冻结完整导出图，未 pin DELETE 又错误返回 NEW。其后已以 0152 实现，并保留冻结字节。后续[已接受修复契约](source-occurrence-review-repair-design.md)仅授权另一项未发布 0151 修复和新增 0153 约束。集成前仍须与最新 main 核对迁移编号。

首个 pin 建立后的不变量覆盖整个 revision，而非仅目标属性：全部 member、logical-node revision、node/property occurrence 和有序 effect（包含 property 为空的 delete effect）不可变。新 revision 先完整建立再建首个 pin；新版本／revision 仍是受支持的写入方式。后继替换既有保护函数，保留 owner、SECURITY DEFINER、固定 search_path 和受限 EXECUTE ACL。六张来源图表的触发器覆盖 INSERT/UPDATE/DELETE，检查 OLD 和 NEW 的受影响 revision ID 并集（revision 行用 id，child 行用 config_revision_id）。任一 revision 已有 pin 则返回 SQLSTATE 55000；允许的未 pin 删除返回 OLD，允许的新增／更新返回 NEW。不禁用 FK／trigger，不改既有 pin／history 身份。

仅事务内来源锁不能保护提交后的历史。pinned revision 任意 member 引用的每个 file-version 一律拒绝 UPDATE/DELETE，不限目标 pin 的 version。pinned member 的 file 行拒绝 DELETE，UPDATE 只允许改变 `file_name`、`current_version_id`、`updated_at`；身份／organization／project／config-set／format 等其他列均保持原样。不把当前 tip 或显示名固定为历史身份。新增未引用 version 仍允许。来源对象保持内容寻址；本 SQL 不宣称跨存储原子性，也不防范管理员绕过存储契约替换对象字节。

首个 pin 与旧 graph/version writer 的并发采用以下具体协议：

1. 所有首次 pin owner（`catalogProjectValueSync`、JSON registration、migration adapter、replacement、approved source commit）发现完整来源图，按 workflow 完整 source-prefix 锁序取锁，重验 membership，再读权威 bytes/facts。可先发现既有 pin，但不能先加载其字节。新 revision 在所属事务内完整建立后才建首个 pin。复用来源 owner 锁操作，不发明可信调用方标记或 SQL 代理。
2. pin BEFORE INSERT trigger 对 revision `FOR UPDATE NOWAIT`。若尚无 pin，则执行真实 `UPDATE dts_config_revisions SET id=id`，再重验归属并插入 pin；后续 pin 不再 touch。该 tuple-version 写屏障使旧 REPEATABLE READ snapshot writer 得到 `40001`，不能继续把 revision 当作未 pin。后继迁移还在迁移隔离内对每个已有 pinned revision touch 一次。所有值完全不变的 revision UPDATE 是唯一 pinned graph no-op 例外；任何实际字段变化仍 `55000`。
3. graph mutation trigger 从 OLD/NEW 派生 revision，按字典序 `FOR UPDATE NOWAIT` 后再查 pin。已持 child 行的旧 writer 竞争时立即拒绝，不能倒序等待 revision。file/version trigger 在查 pin 前先发现引用 OLD/NEW identity 的全部 member，同序锁 revision，然后重读完整 member-ID／identity 集合和 pin；membership 变化即拒绝，不临时补拿新锁。source-prefix owner fence 也须重验 version membership。
4. SQL trigger 仅锁／touch revision，不笼统声称完整 prefix。只向既有 `NOLOGIN catalog_migration_owner` 授 `public.dts_config_revisions` 的 `UPDATE(id)`，保留 SELECT 和固定 SECURITY DEFINER search path。runtime synchronizer/governance/coordinator 不获新权限；新 trigger function 保持 owner-only EXECUTE ACL。按真实 owner 核验，不借测试 superuser 权限通过。
5. `55P03`／`40001` 转为可重试冲突并回滚整个事务，不能继续使用失败事务。reservation/publication/finalization 保持分阶段，不持来源锁跨网络／publication。不增加运行时表锁或通用锁框架。

必需真实 PostgreSQL 用例：两 member／两 node 图含未选 property 和空 property delete effect；逐表 pinned insert、未 pin 行移入 pinned revision、未选行 update/delete；每个 member 的 version metadata 漂移；允许显示名／current-tip 变化；真实 unpinned DELETE RETURNING、提交后消失及 rollback 恢复；混合 pinned/unpinned statement 整体回滚；首个 pin 与 mutation 的双向双连接竞争；历史导出字节完全一致；owner/ACL 负向断言不变。补充既有 migration、source-proof 和 workflow 测试，本地 superuser 结构测试不单独充当真实角色验收。

## 3. Backfill 与切换顺序

阶段 A/B/C/D 是同一个事务中的逻辑检查点，不得在检查点之间留下旧 writer 可竞争的空隙。

### 阶段 A：只扩展，不改变行为

1. 创建 unified occurrence 与 unified typed source-pin relation，均由 `catalog_migration_owner` 持有。
2. 向现有表增加 nullable `source_occurrence_id` 与 pin 引用；补充租户完整 candidate key；按 PostgreSQL 顺序需要时先加 `NOT VALID` FK。
3. 增加 occurrence resolver、ownership/one-of/placeholder 延迟 trigger 与精确 ACL。旧 logical-node writer/resolver 继续工作；不启用 JSON writer。

### 阶段 B：只读 provenance preflight

迁移先在同一事务中获得真实 PostgreSQL writer fence，再读取 provenance。按此精确顺序对 `dts_config_set`、`project_parameter_files`、`project_parameter_file_versions`、`dts_config_revisions`、`dts_config_revision_members`、`dts_node_occurrences`、`dts_property_occurrences`、`dts_logical_nodes`、`dts_logical_node_revisions`、`dts_occurrence_effects`、`parameter_catalog.project_parameter_bindings`、`parameter_catalog.project_parameter_values`、`parameter_catalog.parameter_observations`、`parameter_catalog.parameter_observation_matches`、`project_parameter_value_drafts`、`project_parameter_value_change_requests`、`parameter_catalog.definition_replacement_projects` 执行 `LOCK TABLE ... IN SHARE ROW EXCLUSIVE MODE`；再在每张表按排序后的 ID 锁定受影响行。锁必须持续到 preflight、backfill、compare、switch 完成；A/B/C/D 之间不得出现旧 writer 可以竞争证明的间隙。fence 必须是数据库 `LOCK`/`FOR UPDATE` 边界，不能只依赖未强制执行的 application advisory lock。

对每一个既有 canonical Binding、current ProjectValue、observation、match 以及 pending canonical draft/request：

1. 证明 organization → project → config set → 不可变 file ID ownership。
2. 通过精确 `config_revision_id`、`dts_config_revision_members.file_version_id` 再到 `dts_property_occurrences.file_version_id` 解析 DTS provenance；绝不使用 current file version。显式 DTS source ref 必须精确命中一个历史 member/locator；opaque `config-set:<id>` 必须精确命中一个 effect。
3. 拒绝 placeholder source 作为 value pin、缺 revision、缺 file/version、跨租户 owner、矛盾 locator、0 个或多个匹配。即使 Binding root 已证明，placeholder current value 也因缺少当前 source pin 而阻断 preflight：整个升级回滚，保留旧 schema/data。非 current 的历史 placeholder 在 root 证明后可作为不可变 lineage 保留；runtime transient placeholder 仅允许存在于同一个立即安装已证明 source-backed replacement 的原子 append 中。
4. 若已有 JSON canonical identity，必须已经有经过评审的 ConfigurationSchema、instance ID、file ID 与 root pointer。不得从文件名或 Definition key 推断。
5. 输出 `(table, row_id, organization_id, project_id, reason, candidate source rows)` blocker 组；只要任何既有 Binding、observation 或 match 无法证明，整个迁移失败。旧 schema/data 保持可用。只有在 Binding root 已证明后，非 current 的、无法 pin 的历史 placeholder ProjectValue 才可作为不可变 lineage 保留；无法 pin 的 current tip 或 pending draft/request 阻止 workflow 开启。

### 阶段 C：全有或全无的 backfill

干净 preflight 后在一个 migration transaction 内：

- 每个已证明的 root natural key 插入一个 source occurrence；重试时必须逐字段一致；
- 设置 Binding `source_occurrence_id`，保留每个既有 Binding ID 与 `logical_node_id`；每个 non-placeholder current value 都必须通过 deferred current-tip guard；不能错误地强迫历史 pin 等于 current tip。
- 为每个已证明的 current ProjectValue 插入 source pin；在 Binding root 已证明后，placeholder ProjectValue 作为显式 non-source history 保留、无 pin；
- 设置 observation/match occurrence link 并验证全部复合 FK；
- 只有 base value 精确证明时，才给既有 pending 行设置 source-pin ID。

任何矛盾都抛错并回滚所有新 relation 行与 link，不得部分 quarantine 后声称完成。

### 阶段 D：compare、fence、switch

1. 对未修改行、completed replacement 以及重复/歧义案例，比较旧 DTS resolver 与 occurrence resolver；比较 Binding ID、current tip、observation/match ID 与 source-pin digest。移除保留 compatibility resolver 中任意的 `limit 1`：0 个候选返回无结果，多于一个 base/replacement 候选抛出 typed ambiguity error。
2. backfill 完成后才扩展 identity immutability、validate 新 FK。fence 只支持 logical-node 的 writer；新的 source-backed write 必须有 occurrence 和精确 source pin。
3. 增加 source-occurrence uniqueness index，切换 canonical read/write。保留 `logical_node_id`、旧 resolver 与旧 projection query，直到完整 B1 矩阵通过。
4. 切换后出现运行时缺陷时，fence 新写入并回退 reader 到保留的 DTS projection；不得重写已应用迁移或临时 downgrade。

## 4. ACL 与 trigger 契约

遵循 `server/migrations/0138_canonical_parameter_catalog_roles.sql:1-33,233-322` 及 publication roles `0140_catalog_publication_control_plane.sql:1041-1107`：

- `catalog_migration_owner` 持有全部新 relation/function 并运行 preflight/backfill；`NOLOGIN`，生产 login 不可 `SET ROLE`。
- `catalog_synchronizer_role` 不获得新的 source-occurrence、source-pin、Binding 或 ProjectValue 直接权限。应用写入仍只能通过现有 canonical writer boundary；需要的 owner-mediated insert 归既有 owner/security-definer 契约，不新增 role grant。
- `parameter_governance_writer_role` 保留现有 observation/match `SELECT/INSERT`；不得直接操作 source occurrence、Binding、ProjectValue；security-definer 延迟检查负责 occurrence ownership。
- `catalog_publication_coordinator_role` 与 `catalog_baseline_reader_role` 不获得新的 source-occurrence 或 pin 权限。需要读取时通过已有 owner/security-definer boundary；不得修改 occurrence、pin 或 Binding identity。
- `PUBLIC` 不获得 schema/table/function 权限。新 resolver 为 owner-only：明确从 `PUBLIC`、`catalog_synchronizer_role`、`parameter_governance_writer_role`、`catalog_publication_coordinator_role`、`catalog_baseline_reader_role` revoke `EXECUTE`，与 `0144` 旧 resolver 政策一致；不增加同签名 overload。
- identity trigger 使用 `SECURITY DEFINER`、由 `catalog_migration_owner` 持有，固定 `search_path = pg_catalog, parameter_catalog`；writer role 不获得 trigger function 的 `EXECUTE`。

## 5. 实现前的聚焦证据

- Real PostgreSQL migration：`server/modules/parameter-topology/schemaMigration.test.ts`、`server/modules/parameter-bindings/binding/binding.integration.test.ts`、`binding/concurrency.integration.test.ts`，以及覆盖 placeholder、缺失/重复 provenance、ID 保留的 populated-upgrade case。
- Observation/replacement：`server/modules/parameter-catalog-migration/evaluate.test.ts`、`provenance.integration.test.ts`、`server/modules/parameter-topology/postCutoverWorkflow.integration.test.ts`，并加入 occurrence resolver equality/ambiguity case。
- Source pin/workflow：`server/modules/parameter-bindings/drafts/drafts.integration.test.ts`、`catalogProjectValueSync.integration.test.ts` 与真实鉴权 route tests。现有 `drafts/drafts.integration.test.ts:572-606` 的 DTS export/reimport 必须增加 historical file-version pin assertion，不得只验证 current snapshot。
- JSON seam：`server/modules/parameter-files/parseIndex.test.ts`、`writebackService.test.ts`、candidate tests，以及 strict pointer、duplicate key、precision、array negative cases。这些只证明 parser/writeback，不替代 migration/auth evidence。
- ACL canary 必须验证精确 role grant 与 SQLSTATE `42501` negative；count、failure、skip、dedicated DB identity 及独立 Spec/Standards review 都是显式 evidence 字段。

本文仅定义 T1.1 schema 设计边界，不授权实现 schema、启动 T1.2、执行迁移、建 PR、合并或目标环境资格验证。
