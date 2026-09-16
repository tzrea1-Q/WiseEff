# 迁移 0148/0149——回溯式 R3 威胁矩阵

> English: [English](../../../../exec-plans/active/849-inventory/migrations-0148-0149-r3-threat-matrix.md)

Issue：#849，由 #853 T0.3 跟踪。范围包括 `0148_seed_initialization_runs.sql`、
`0149_project_parameter_plane_archives.sql`，以及执行这两项 schema 契约的种子初始化服务。

## 证据边界

这是一次**回溯式**评审。两项迁移及其原始服务先通过 PR #858 进入了 `main`，当时没有 R3 威胁
矩阵和独立 Spec 评审。本文不会把历史交付重新描述成“实现前已满足 R3”；它只记录当前威胁、
修正候选和 T0.3 之外仍需完成的后继门禁。

T0.3 只覆盖捕获式归档和运行日志，不授权删除归档平面，也不构成目标主机执行、恢复或生产就绪
证据。这些工作仍属于 #853 T2.3 和 T3.3/T3.4。

## 受保护的不变量

1. 一个种子 digest 只能在已认证组织内初始化 Atlas、Aurora、Nebula。
2. `(organization_id, seed_digest)` 一旦完成即为终态，重放只能是空操作。
3. 每个组织同一时刻最多执行一个固定三项目范围的物化任务，即使 seed digest 不同也一样。
4. 只有本次捕获返回的精确归档完整、可读取且与账本摘要一致时，重建才能开始。
5. 捕获保留全部已声明逐项目行和每个已引用源版本的实际字节；直接依赖的不可再生记录按明确处置继续在线保留。处置是需要另行批准的破坏性操作。
6. 项目、组织或发起用户变化时，归档账本和运行日志仍保留历史。

## 威胁矩阵

| ID | 故障或攻击 | 控制与证据 | 结果／责任项 |
| --- | --- | --- | --- |
| R3-01 | 调用者提交其他组织的 id | `materializeSeedSources` 将输入绑定到 `auth.organization.id`；集成测试要求返回 `FORBIDDEN` | 已在 T0.3 候选修正 |
| R3-02 | 只读用户在鉴权失败前留下持久 `running` 日志，或绕过鉴权重放已完成结果 | 写日志前和完成态重放前都检查三个目标项目的编辑权限；拒绝后不产生新运行或结果 | 已修正；`materialize.test.ts` |
| R3-03 | 相同或不同 seed digest 的两个进程并发写共享的 Atlas／Aurora／Nebula 范围 | PostgreSQL session advisory lock 覆盖完整操作，键为组织 + 固定目标范围；所有竞争者都收到 `CONFLICT` | 已修正；确定性的同摘要／跨摘要并发用例 |
| R3-04 | 已完成运行经日志入口降级为 `running` 或 `failed` | 已存状态为 `completed` 时 upsert 不再更新 | 已修正；`plan.test.ts` 终态用例 |
| R3-05 | 猜测或创建错误／缺失的项目身份 | 稳定 id、组织和已评审项目 code 必须全部匹配；阻断计划不会创建项目 | 既有 `plan.test.ts` 证据 |
| R3-06 | 漏捕获已声明关系、丢失依赖记录，或混入其他项目的子行 | 32 个关系覆盖被捕获的逐项目 legacy 与 canonical 平面；处置清单还把每个直接外部 FK、trigger 和 view 依赖归为保留或可再生，精确 PostgreSQL 库存测试会在 schema 漂移时失败 | 已修正；真实非零图、保留 observation／match、依赖和隔离证据 |
| R3-06a | 归档幂等只因时间戳或物理行顺序相同而成立 | 复用忽略捕获时间，所有关系都按稳定主键而非 `ctid` 排序；未变化的逻辑平面可由普通调用复用 | 已修正；生产形态幂等用例 |
| R3-06b | 只归档源元数据，文件版本或未激活 candidate 的对象字节缺失／已变化 | 归档 v2 读取两类对象，校验所存 SHA-256 和大小并嵌入字节；缺失或不匹配时 fail closed | 已修正；字节内容断言 |
| R3-06c | 关系行、源对象、归档文档或 S3 错误体耗尽进程内存 | 返回行前预检关系 JSON；源字节经 64 MiB 有界本地／S3 适配器；复用／守卫按推导出的 214+ MiB 文档上限读取；S3 错误详情上限 64 KiB。无有界读取能力的 store 会 fail closed | 已修正；关系／源／文档／适配器拒绝用例 |
| R3-07 | 分离的计数／行读取观察到撕裂平面，或把有界关系当作完整归档 | 捕获在一个 repeatable-read 事务内运行；`truncated=true` 阻止重建；守卫要求精确关系键集合和等于账本计数的行长度 | 已修正；伪造撕裂对象拒绝用例 |
| R3-08 | 本次捕获对象被删除／损坏／替换为超大对象，却被一份更新且有效的归档掩盖 | 复用和守卫按文档字节上限读取；守卫按本次捕获的精确 ID + digest 取对象，并校验对象 SHA-256、归档摘要、schema 版本、组织、项目、截断、关系计数和内嵌文件字节 | 已修正；有界、篡改与精确对象用例 |
| R3-09 | 把捕获误认为处置 | 测试证明捕获后源草稿仍存在；schema 刻意没有处置／删除标记 | 已定性；处置仍是 #853 T2.3 |
| R3-10 | 父记录删除导致账本所有权丢失 | 组织／项目 FK 使用 `ON DELETE RESTRICT`；发起用户使用 `ON DELETE SET NULL` 的可空历史策略 | 真实 PostgreSQL schema 断言 + 生成 schema |
| R3-11 | 运行日志失去唯一性 | 主键为 `(organization_id, seed_digest)`，状态索引按组织划分 | 真实 PostgreSQL schema 断言 + 生成 schema |
| R3-12 | 捕获期间，或捕获之后到最终破坏性工作之前，并发写改变数据平面 | repeatable-read 保证单次捕获内部一致；最终执行仍需目标主机写静默门禁覆盖捕获和后续破坏性工作 | 本地控制已修正；后继门禁仍为 #853 T3.3 |
| R3-13 | 对象写成功、账本写失败，留下孤儿对象 | 已保存数据不会丢失；对象清理和最终保留策略属于独立评审的处置操作 | 剩余运维风险：#853 T2.3 |
| R3-14 | 无法按同一边界恢复归档字节、数据库和持久存储 | 本地捕获测试不是恢复证据 | 未完成后继门禁：#853 T3.3 |
| R3-15 | 通过重写已应用迁移掩盖缺陷 | `0148`、`0149` 字节不变；修正只进入服务、测试和文档 | 由候选 diff 评审约束 |

## Schema 与数据处置证据

- `docs/generated/db-schema.md` 由截至 0149 的 147 项迁移重新生成，记录两张表的主键／唯一键、
  检查、索引、`RESTRICT` 所有权 FK 和可空用户历史策略。
- `archive.integration.test.ts` 在真实 PostgreSQL 上验证两个保留 FK、用户历史 FK、运行日志主键，
  以及刻意不存在 `disposed_at`／`deleted_at`。
- 同一套件还证明 32 个关系的计数和内容、文件版本与 candidate 字节、子行作用域、跨项目隔离、
  源数据未删除、聚合上限、幂等复用、缺失／截断／撕裂拒绝、精确对象选择、有界文档读取、鉴权、
  对象完整性、非零保留 observation／match，以及精确的外部 FK／trigger／view 闭包。
- `objectStore.test.ts` 与 `s3ObjectStore.test.ts` 证明本地适配器先按文件元数据拒绝而不读入文件、HTTP
  适配器在流越界时立即取消，以及没有有界读取原语的自定义 transport 会 fail closed。
- `parameter-catalog-migration/guards.integration.test.ts`（7 项）提供非零
  `definition_replacement_projects` 历史，并证明不能伪造其项目／组织 Binding 所有权。
- `plan.test.ts` 证明固定目标身份、禁止隐式创建项目、重试 blocker 可见性、完成重放幂等和终态不可变。
- `materialize.test.ts` 证明三项目路径、完成重放、subject blocker fail-closed、明确拒绝 JSON、组织绑定、
  先鉴权再写日志，以及并发单飞。

### 逐表处置清单

该清单定义 T0.3 捕获边界，不授权删除。`已捕获`表示行及所引用源字节进入 archive v2；`保留／共享`
表示 T2.3 必须继续在线保留，因为其所有者是组织／全局控制面而非单个项目；`可再生`表示捕获不保存派生行，
T3.3 必须先证明确定性再生及外键／locator 映射，之后才可讨论处置；`已不存在／已删除`表示该表不在当前
schema 中，因此没有在线行需要处置。

| 表 | 处置 | 理由 |
| --- | --- | --- |
| `public.project_parameter_values` | 已捕获 | legacy 逐项目值 |
| `public.parameter_drafts` | 已捕获 | legacy 逐项目待处理编辑 |
| `public.parameter_draft_identity_invalidations` | 已捕获 | 项目范围身份失效状态 |
| `public.parameter_history_entries` | 已捕获 | legacy 逐项目历史 |
| `public.parameter_submission_rounds` | 已捕获 | 项目范围审核工作流 |
| `public.parameter_submission_items` | 已捕获 | 已捕获 submission round 的子记录 |
| `public.parameter_change_requests` | 已捕获 | 项目范围变更工作流 |
| `public.parameter_review_decisions` | 已捕获 | 已捕获 change request 的子记录 |
| `public.project_parameter_bindings` | 已捕获 | legacy 逐项目身份绑定 |
| `public.project_parameter_binding_revisions` | 已捕获 | 已捕获绑定的子历史 |
| `public.project_parameter_files` | 已捕获 | 逐项目源元数据 |
| `public.project_parameter_file_candidates` | 已捕获 | 逐项目未激活源元数据与字节 |
| `public.project_parameter_file_versions` | 已捕获 | 子源元数据与字节 |
| `public.project_parameter_initialization_drafts` | 已捕获 | 逐项目初始化提案 |
| `public.project_parameter_initialization_reviews` | 已捕获 | 逐项目初始化审核 |
| `public.parameter_import_batches` | 已捕获 | 逐项目导入溯源 |
| `public.parameter_file_sync_conflicts` | 已捕获 | 逐项目未解决同步状态 |
| `public.identity_mapping_tasks` | 已捕获 | 逐项目未解决身份任务 |
| `public.parameter_spec_matcher_overrides` | 已捕获 | 项目范围匹配覆盖 |
| `public.dts_property_occurrence_spec_decisions` | 已捕获 | 不可再生的人工决策；恢复映射仍属 T3.3 |
| `public.project_parameter_value_drafts` | 已捕获 | canonical 逐项目待处理编辑 |
| `public.project_parameter_value_change_requests` | 已捕获 | canonical 逐项目变更工作流 |
| `public.dts_config_set` | 已捕获 | 逐项目源结构 |
| `public.dts_release_baseline` | 已捕获 | 已捕获配置集的子记录 |
| `public.dts_release_baseline_members` | 已捕获 | 已捕获 baseline 的子记录 |
| `public.dts_config_revisions` | 已捕获 | 逐项目源修订 |
| `public.dts_config_revision_members` | 已捕获 | 已捕获修订的子记录 |
| `public.dts_logical_nodes` | 已捕获 | 逐项目逻辑身份 |
| `public.dts_logical_node_revisions` | 已捕获 | 已捕获逻辑节点的子历史 |
| `parameter_catalog.project_parameter_bindings` | 已捕获 | canonical 逐项目身份绑定 |
| `parameter_catalog.binding_history_events` | 已捕获 | canonical 绑定的子历史 |
| `parameter_catalog.project_parameter_values` | 已捕获 | canonical 逐项目值 |
| `public.parameter_specs` | 保留／共享 | 组织／全局目录控制面 |
| `public.parameter_spec_versions` | 保留／共享 | 多项目共享的版本历史 |
| `public.parameter_definitions` | 保留／共享 | 组织定义注册表 |
| `public.parameter_modules` | 保留／共享 | 组织归属分类体系 |
| `public.parameter_module_mappings` | 保留／共享 | 组织归属映射 |
| `public.parameter_module_dismissed_compatibles` | 保留／共享 | 组织治理决策 |
| `public.parameter_spec_review_tasks` | 保留／共享 | 组织规格工作流 |
| `public.parameter_policy_targets` | 保留／共享 | 组织策略控制面 |
| `public.parameter_reload_bindings` | 已不存在／已删除 | 迁移 0026 创建、0037 删除；当前没有行 |
| `public.dts_reload_runs` | 保留／共享 | reload 审计／证据继续在线；其 config-revision FK 为 `SET NULL` |
| `public.dts_reload_run_targets` | 保留／共享 | reload 证据继续在线；其 legacy Binding FK 当前为 `CASCADE`，T2.3 必须先重挂或归档再处置 Binding |
| `public.debugging_parameters` | 保留／共享 | 非参数调试状态；legacy Binding FK 为 `NO ACTION` |
| `public.node_operations` | 保留／共享 | 设备操作历史；legacy Binding FK 为 `NO ACTION` |
| `public.legacy_parameter_migration_evidence` | 保留／共享 | 迁移证据；legacy Binding FK 为 `NO ACTION` |
| `parameter_catalog.parameter_observations` | 保留／共享 | 不可变项目 observation 证据继续在线 |
| `parameter_catalog.parameter_observation_matches` | 保留／共享 | 已接受 match 证据继续在线，并以 `RESTRICT` 阻止删除 canonical Binding |
| `parameter_catalog.definition_replacement_projects` | 保留／共享 | 不可变 replacement 历史继续在线，并以 `RESTRICT` 阻止删除 canonical Binding／Value |
| `public.parameter_identity_migration_runs` | 保留／共享 | 跨项目迁移控制记录 |
| `public.parameter_identity_migration_phases` | 保留／共享 | 已保留迁移运行的子记录 |
| `public.parameter_identity_cutovers` | 保留／共享 | 跨项目 cutover 控制记录 |
| `public.parameter_definition_reconciliation_runs` | 保留／共享 | 组织 reconciliation 控制记录 |
| `public.parameter_definition_reconciliation_items` | 保留／共享 | 已保留 reconciliation 运行的子记录 |
| `public.parameter_spec_version_cutover_runs` | 保留／共享 | 组织 cutover 控制记录 |
| `public.parameter_spec_version_cutover_items` | 保留／共享 | 已保留 cutover 运行的子记录 |
| `public.parameter_spec_property_key_cutover_runs` | 保留／共享 | 组织 cutover 控制记录 |
| `public.parameter_spec_property_key_cutover_items` | 保留／共享 | 已保留 cutover 运行的子记录 |
| `public.dts_node_occurrences` | 可再生 | 由已捕获源版本解析；T3.3 必须证明 locator 映射 |
| `public.dts_property_occurrences` | 可再生 | 由已捕获源版本解析；T3.3 必须重映射已捕获决策 |
| `public.dts_occurrence_effects` | 可再生 | 派生分析输出 |
| `public.dts_nodes` | 可再生 | 已捕获文件版本的结构解析结果 |
| `public.dts_properties` | 可再生 | 结构解析子输出 |
| `public.dts_phandle_refs` | 可再生 | 引用解析子输出 |
| `public.dts_validation_runs` | 可再生 | 可重新运行的校验输出 |
| `public.dts_validation_diagnostics` | 可再生 | 校验运行的子输出 |
| `parameter_catalog.current_project_parameter_bindings` | 可再生 view | 从已捕获 canonical Binding 表派生 |

不存在不带 `project_` 前缀的 `parameter_bindings`，因此没有对应处置行。

PostgreSQL 闭包测试冻结了全部外部 FK 及其 delete action、挂在 32 个捕获关系上的全部非内部 trigger，
以及全部依赖 view。owner 已知的非 FK 消费者继续由 `cutover-consumers-recon.md` 枚举；其 JSONB、Agent
checkpoint／tool argument、日志建议、审计元数据和 URL payload 作为历史保留，T2.3 必须增加归档解析，
不得按同名新 id 批量替换。在逐行 T2.3 扫描或 T3.3 恢复映射仍开放时，不授权任何删除。

## 评审处置

实现智能体的自查不等于所需的独立评审。候选只有在独立 Standards／Spec 评审按固定基线检查 diff
和本矩阵后才能 seal。评审发现必须修复或明确保留为后继门禁，不能被改写成无条件 PASS。即使 T0.3
关闭，T2.3 和 T3.3 仍然阻断 #849 完成。
