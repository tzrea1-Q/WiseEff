# ADR-0044：Definition 替换在迁移当前引用时保留历史身份

> English companion: [English decision record](../../adr/0044-definition-replacement-preserves-historical-identity.md)

日期：2026-09-14

## 状态

已接受为 [#847](https://github.com/tzrea1-Q/WiseEff/issues/847) 受治理 Definition 身份纠正迁移的合同冻结（issue 决策 17 与 18）。本记录编号为 ADR-0044。`docs/adr/` 中 ADR-0043 之后下一个未占用编号是 0044；0040–0043 仍是规范模型、发布完整性、registration 与 catalog 编写决策。

本 ADR 记录实现必须满足的冻结语义合同。它本身**不**证明 migration `0144`、替换关系、当前选择投影、HTTP 路由、新模块、UI 或任何威胁矩阵行已经完成并核验；该核验来自可执行矩阵行与计划门禁，而非本记录。

计划依据是 [Parameter definition workspace restoration and governed identity migration (#847)](../exec-plans/active/2026-09-14-parameter-definition-workspace-restoration.md)。逐行冻结设计是 [Definition identity correction migration — frozen threat matrix and interface design (R3, sealed)](../../exec-plans/active/2026-09-14-definition-identity-correction-threat-matrix.md)；其第 1–7 节是本记录所载名称与规则的规范来源。

冻结声明固定了 migration `0144` 的关系名。计划依据中较早的架构草图把逐项目关系称作 `parameter_catalog.project_parameter_binding_replacements`，本 ADR 记录的是冻结名称 `parameter_catalog.definition_replacement_projects`。重命名任一关系都需要在矩阵中记录一次显式重新冻结，而不是实现层的选择。

## 背景

[ADR-0017](../../adr/0017-definition-identity-is-correctable.md) 确立了定义身份可纠正，且标识符是代理值而非含义。[ADR-0033](../../adr/0033-identity-mapping-uses-protected-re-resolve.md) 确立了身份错误的受保护重解析，[ADR-0034](../../adr/0034-referenced-property-key-rename-is-a-source-cutover.md) 确立了被引用的属性键重命名是分阶段的源改写 cutover，而不是就地编辑。

随后 [ADR-0040](../../adr/0040-canonical-parameter-catalog-relational-model.md) 抹去了就地纠正的空间：`(subject_id, property_key)` 在全部历史中永久且唯一；`ParameterDefinition` 是不透明稳定身份；任何持久内容变更都铸造一个不可变 `DefinitionRevision`；Binding 的身份列（`organization_id`、`project_id`、`logical_node_id`、`registration_id`、`subject_id`、`definition_id`）不可变；`ProjectValue` 不可变，并钉住解释它所使用的那一精确 revision；历史重放读取被钉住的 release membership 与 definition head，而不是 `catalog_state`。[ADR-0042](../../adr/0042-organizations-register-canonical-subjects-once.md) 使 registration 与 placement 成为显式的组织动作，[ADR-0043](../../adr/0043-catalog-authoring-and-online-publication.md) 使冻结 Candidate、绑定 Authorization 加上唯一同步器成为定义身份成真的唯一途径，并明确要求后续 registration 失败不得把已经成功的 Catalog 发布呈现为回滚。

因此，批准了错误属性键或错误 Catalog subject 的操作者不能通过编辑定义、复用键或改指既有 binding 来修正。唯一合法的纠正方式是：通过既有发布管道把**替换身份**作为新定义发布，然后把一份显式选定、已授权的项目清单的*当前*引用从旧身份迁移到新身份，逐项目进行，并对任何无法迁移的项目显式续做。

该能力是**协调，不是新引擎，也不是第二个 Catalog writer**。它编排类型化编写与完整后继构建、Candidate/Artifact/Authorization 与 publication job、同步器物化、source-candidate 改写、Binding/ProjectValue 变更，以及可信审计——这些能力各自已经拥有自己的事务边界。它绝不插入或更新 `parameter_catalog.parameter_definitions`、`definition_revisions`、`catalog_release_definition_heads`、`catalog_state`、`catalog_subjects`、release membership、aliases 或 `catalog_activation_receipts`；替换记录只*引用*已发布的 Candidate 与 job。

兼容性义务是绝对的。旧定义、旧 revision、旧 Binding、旧 ProjectValue 与旧 `binding_history_events` 字节在数据存续期内保持可读、可解释。历史、钉住与按 revision 寻址的读取绝不查询替换投影。

## 决策

### 1. 已批准的替换记录及其逐项目清单

冻结设计把已批准的替换语义放在既有 `parameter_catalog` schema 的两个关系中，二者都遵循其物理风格（不透明 `text` id、`unique` 约束、`on delete restrict`、可延迟复合外键、经 `server/migrations/0137_canonical_parameter_catalog_schema.sql` 中 `parameter_catalog.reject_immutable_catalog_change()` 的 append-only 触发器）。两者都由 migration `0144` 添加。

`parameter_catalog.definition_replacements` 是已批准的替换记录。它冻结旧身份三元组与基准 revision（`old_definition_id`、`old_subject_id`、`old_property_key`、`old_revision_id`），以及替换身份三元组与 revision（`new_definition_id`、`new_subject_id`、`new_property_key`、`new_revision_id`），并冻结 `preview_fingerprint`、前驱 `preview_catalog_release_id` / `preview_catalog_release_digest`、`candidate_id` / `publication_job_id` / `authorization_id` 证据引用、批准主体与审批主体、治理 `reason` 与 `created_at`。复合外键证明每个身份三元组都是真实的 `(id, subject_id)` 定义，且每个 revision 都属于其定义；一个 `check` 要求 `old_definition_id <> new_definition_id`，因为 `(subject_id, property_key)` 永久且唯一。

一个 `before update or delete` 触发器冻结 `id`、全部 `old_*` 与 `new_*` 列、`preview_fingerprint`、preview release pins、Candidate/job/Authorization 引用、`approval_principal_id`、`reason` 与 `created_at`；`DELETE` 抛出 `55000`。**可变**列只有 `status`（`pending | executing | completed | blocked | failed`）、`replacement_version`（ETag / `If-Match` 版本）、`success_audit_ref`、`superseded_at` 与 `updated_at`。

`parameter_catalog.definition_replacement_projects` 是逐项目范围清单。每个 `(replacement_id, project_id)` 一行，承载 old→new 配对——`old_binding_id`、`old_value_id`、`new_binding_id`、`new_value_id`——外加反规范化的 `old_definition_id` / `new_definition_id`，以便复合外键证明归属；还承载 `status`（`pending | completed | blocked | failed`）、`blocker_reason`、`blocked_evidence`、`attempt_count`，以及最后的错误类别与原因。一个 `check` 要求 `new_binding_id` 与 `new_value_id` 恰好在行状态为 `completed` 时非空，因此 binding/value 对只在项目完成事务内写入，重试不会重复创建 binding 或 value。`foreign key (project_id, organization_id)` 引用 `public.projects(id, organization_id)`；这是数据库层对跨组织项目选择的屏障。一个触发器冻结清单身份列并禁止删除。

### 2. 当前选择规则

单一 SQL 接缝决定哪条 binding 对当前操作有效。对于 `(organization_id, project_id, logical_node_id, definition_id)` 上的当前操作，有效 binding 经替换投影解析：当一条 `status = 'completed'` 的 `definition_replacement_projects` 行把被查询 binding 记为其 `old_binding_id` 时，**new** binding 有效，被查询的旧 binding 属于历史；否则被查询 binding 本身有效。

Migration `0144` 把该规则暴露为 `parameter_catalog.current_project_parameter_bindings`——一个基于 `parameter_catalog.project_parameter_bindings` 的视图，排除每一条作为某 `completed` 替换项目 `old_binding_id` 的 binding——加上精确身份辅助函数 `parameter_catalog.resolve_current_binding(p_project_id, p_logical_node_id, p_definition_id)`，返回有效 binding id。该辅助函数恰好沿 completed 替换边前进一次；migration `0144` 拒绝目标定义本身是另一条非 `failed` 替换的 `old_definition_id` 的新替换，因此不会形成链。

**历史、钉住与按 revision 寻址的读取绝不查询替换投影。** 它们寻址自己钉住的精确 binding id 与精确 `definition_revision_id`，因此有记录的 release 重放、按 binding 与 revision 读取值历史，以及 legacy `public.project_parameter_bindings` 消费者都保持既有解释。该投影只是当前选择规则。

### 3. 不可变 `project_parameter_values` 关系上的值来源

被迁移的项目在新 binding 下向 `parameter_catalog.project_parameter_values` 追加一行新的不可变记录，该行记录其字节来自何处。Migration `0144` 添加可空列 `replaced_from_value_id`，以及证明被引用行是旧定义的真实值行——而非任意指针——的候选键与复合外键，并加一个禁止自引用的 `check`。既有 append-only 触发器仍拒绝一切 `UPDATE` 与 `DELETE`，因此新列只在 `INSERT` 时填充。

被结转的行保持 `value`、`value_digest`、`value_kind`、`source_ref` 与 `config_revision_id` 与旧行逐字节相同，并钉住新的 `definition_id` 与已批准的 `definition_revision_id`。与替换 revision 不兼容的值绝不插入、转换、截断、钳制或被默认值替代：项目改为进入 `blocked`。

### 4. 命名已替换当前 binding 的写入被拒绝

三层拒绝命名已被替换 binding 的写入：

1. **端口层。** 解析器返回新 binding，因此命名旧 binding 的操作会得到既有类型化 block 形状、原因 `binding-replaced`（`server/modules/parameter-bindings/adapters/dto.ts` 经 `writebackAdapter.ts`）。
2. **锁层。** `loadBindingById(..., "update")` 与 `casCurrentTip` 被约束到当前 binding 视图，因此过期 writer 会丢失其行锁，而不是追加值。
3. **数据库层。** Migration `0144` 添加可延迟、初始延迟的约束触发器 `parameter_catalog.assert_value_target_binding_is_current()`，作用于 `parameter_catalog.project_parameter_values` 的 `after insert`，当 `new.binding_id` 是某 `completed` 替换项目的 `old_binding_id` 时以 `constraint = 'project_value_current_binding_ck'` 抛出 `55000`。它镜像 `server/migrations/0137_canonical_parameter_catalog_schema.sql` 中既有的 `assert_binding_effective_revision_is_verified_head()` 模式。

因此数据库是最后一道防线：即便 writer 绕过了端口层与锁层，也无法向已替换 binding 追加当前值。

### 5. 每个旧定义恰好一个当前后继

一个部分唯一索引——`definition_replacements_current_successor_unique`，作用于 `(old_definition_id)` 且 `where status in ('pending','executing','completed','blocked')`——对每个旧定义至多允许一条非 `failed` 替换。`failed` 行被排除，因此真实失败后可以重新 preview。`blocked` 行则有意**占据该槽位**：对该旧定义而言，纠正路径是续做这条被阻塞的替换，而不是发起第二条替换。

### 6. 已确认的默认值

以下是已确认的 issue 规格默认值（决策 17）；上述替换语义不得弱化它们。

1. 引用迁移仅限于**当前组织内该 actor 可管理的显式选定项目**。其他组织不变，且清单就是已授权范围——绝不是被发现或推断出的范围。
2. 经精确影响确认后，合格项目自动推进；被阻塞项目保留以供续做。
3. 旧定义在迁移期间及之后保持可用，且**绝不**因 preview、execute 或 continue 而被自动弃用。
4. 只有在权威证据表明相关当前引用已迁移之后，才提供独立弃用；不完整的限定范围使用计数不能证明全局完成。
5. 不兼容的值以及挂起或冲突的工作会阻塞受影响项目：**不得**自动转换、截断、默认值替代、丢弃草稿或重新钉住审批。
6. 属性键纠正复用既有的 DTS 保源能力（`server/modules/parameter-specs/propertyKeyCutover.ts`）；其他来源格式不得被静默声明为受支持。

## 后果

### 历史身份与两条历史事件

一个项目的迁移会写**两条** `parameter_catalog.binding_history_events` 记录：一条在旧 binding 的值指针变化时写在旧 binding 上，一条写在新 binding 上。这是由 `parameter_catalog.assert_binding_history_event_owners()`（`server/migrations/0137_canonical_parameter_catalog_schema.sql` 中的 `binding_history_event_owner_fk` 约束触发器）强制的：它要求每个被引用的 revision 与 value 都属于同一 binding 与同一定义。old→new 对在构造上跨越两条 binding，因此一条事件无法承载它。本设计**不**放宽该触发器：每条事件各自内部一致，跨身份关联从 `definition_replacement_projects` 与 `replaced_from_value_id` 读取。

### 成功的 Catalog 发布绝不被呈现为回滚

替换身份的发布与引用的迁移是两个独立事务边界。当 Catalog 发布成功、但随后的 registration、准备或某个逐项目写入失败时，替换记录 `blocked`（或某个项目带着其 blocker reason 记录 `blocked`）——而**不是**回滚 Catalog release。`catalog_state.current_catalog_release_id` 与 Activation Receipt 保持发布时的原样。把一次成功的发布呈现为已撤销，会违反 ADR-0043 关于后续 registration 失败不得把成功的 Catalog 发布呈现为回滚的规则，并使 Catalog 与其自身 receipt 不一致。

### 恢复是显式续做

恢复是经治理边界的显式 HTTP `continue`，不是第二个 scheduler，也不是后台管理进程步骤。管理进程 job 需要自己的授权复检，并会重复 `installPublishedRelease` 的事务所有权。执行与续做按组织范围的 `parameter_catalog.governance_command_idempotency` family 幂等——`definition-replacement-execute` 与 `definition-replacement-continue`——以 `(organization_id, command_family, idempotency_key)` 为键，并以覆盖规范命令模型的 `request_fingerprint` 为准。重放命令报告 `outcome: "replayed"` 且行数不变；同一键配不同请求体是类型化冲突。已提交项目保持已提交，未提交项目保持 `pending`，重启不会重复任何内容。

### 弃用是独立的、以证据为门禁的动作

退休旧定义不属于迁移。弃用是一个独立治理动作，只有在权威证据表明相关当前引用已迁移之后才提供。在项目范围上计算的使用计数无法证明全局完成，因此仅有范围计数会被拒绝，且只要被计数范围之外可能存在任何当前引用，旧定义就保持 `active`。

### 权衡

- **旧定义在每个项目迁移完成前保留其当前引用计数。** 在最后一个项目提交之前，旧身份在某处仍是真正的当前身份。正因如此，使用计数与 catalog 读表面必须只统计当前 binding 视图：统计原始 `project_parameter_bindings` 会让旧定义在迁移后仍留有幻影计数。
- **被阻塞的替换占据唯一的当前后继槽位。** 由于部分唯一索引包含 `blocked`，对同一旧定义的另一项纠正无法启动，除非把该被阻塞替换续做到完成，或显式将其置为 `failed` 并取代。这是有意为之——为同一身份并行两条替换比串行一条更糟——但它使续做成为必需的运维动作，而非可选项。
- **当前读取多付一次投影查找。** 每个当前 binding 读取都会增加一次对替换投影的查找。本设计把它限制为一个视图谓词或一次精确身份辅助函数调用，而不是一条 join 链，并把代价仅限在当前读取上，因为历史与钉住读取不受影响。

## 必须保持的核验

可执行矩阵是 `docs/exec-plans/active/2026-09-14-definition-identity-correction-threat-matrix.md` 中的冻结威胁矩阵（63 行）。必须持续成立的 ADR 级不变量：

- 旧定义、revision、binding、value 与 history 字节与迁移前逐字节相同（矩阵 `IV-01`、`IV-02`、`IV-06`）。
- 被结转的值保持 `value`、`value_digest`、`value_kind`、`source_ref` 与 `config_revision_id` 相同，并记录 `replaced_from_value_id`（`VL-01`）。
- 不兼容的值阻塞其项目，且不发生转换、截断或默认值替代（`VL-02`）。
- 当前读取恰好返回一条有效 binding，且使用计数与之一致（`IV-04`）。
- 命名已替换当前 binding 的写入在端口层以 `binding-replaced` 失败，在数据库层以 `project_value_current_binding_ck` 失败（`IV-05`）。
- 每个旧定义至多存在一条非 `failed` 替换，而 `failed` 行可被取代（`IV-03`）。
- Catalog 成功之后 registration 或准备失败时，当前 Catalog release 与 Activation Receipt 保持不变，并记录 `blocked`（`PA-01`）。
- 以同一幂等键重复 execute 或 continue 不会创建重复的 binding、value 或 history 行（`RC-01`–`RC-05`）。
- 跨组织项目、binding 与 actor 选择失败关闭（`TN-01`–`TN-04`、`AU-01`–`AU-04`）。
- 旧定义绝不被自动弃用，且限定范围的使用计数绝不证明全局完成（`IV-08`、`IV-09`、`IV-10`）。
- 自 migration `0137` 继承的可延迟约束触发器——包括 `binding_history_event_owner_fk` 与 `project_parameter_binding_effective_revision_head_fk`——在 `0144` 之后仍保持可延迟且初始延迟（`IV-14`）。
