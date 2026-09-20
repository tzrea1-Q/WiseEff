# T2.3a 档案处置与恢复 — 实施前威胁矩阵

> English: [English](../../../../exec-plans/active/849-inventory/t23a-archive-disposal-threat-matrix.md)

契约：#849/#853 T2.3a。捕获已存在（0149 + `seedInitialization/archive.ts`）。本矩阵冻结**线上可删什么**和**必须留下什么**。T2.3b 只能在本矩阵与配套设计独立 Spec PASS、且下方具名破坏动作被确认之后实现。

状态：**Spec 再评审 PASS with P2** `a53d7ed7-9e12-45a2-a3af-ed0889296b01`。本次 PASS **不**授权 T2.3b。T2.3a 不删行、不 DROP、不 commit、不开 PR、不上目标机、不改 Issue。

## 车道

工作树 `849-853-t11-source-identity`，HEAD `f9c710f6…` 加未提交 Scratch。风险 **R3**。Helper PG 仅 **55438**。评审 grok-4.6（要求的 gpt-5.6-luna 不可用）。T1.4 未清零（49 条 unallowlisted）；禁止 DROP 仍被查询的表，但不禁止删除「快照里有、已不是当前 successor、且不被 RESTRICT/NO ACTION 护住」的主键。

## 不变量

获准处置之后：离线档案仍可读且 digest 不变；被替换的重建前行不再作为未授权线上载荷；无悬空 FK、不级联删非参数数据；Atlas/Aurora/Nebula 的当前 successor 保留；Organization/全局 preserved 表保留；档案损坏则拒绝删除；捕获之后的新写入不是残留；无法用旧重放复活已删行。

## 两套档案（不要混）

种子平面捕获（`project_parameter_plane_archives` + 对象 v2）是本次处置对象。Catalog cutover P7 加密档案保持；lookup 仍 410 `legacy-id-archived`。

## 捕获清单（34）

`parameter_drafts`, `legacy_parameter_values`, `parameter_draft_identity_invalidations`, `parameter_history_entries`, `parameter_submission_rounds`, `parameter_change_requests`, `project_parameter_bindings`, `project_parameter_files`, `project_parameter_file_candidates`, `project_parameter_initialization_drafts`, `project_parameter_initialization_reviews`, `parameter_import_batches`, `parameter_file_sync_conflicts`, `identity_mapping_tasks`, `parameter_spec_matcher_overrides`, `dts_property_occurrence_spec_decisions`, `project_parameter_value_drafts`, `project_parameter_value_change_requests`, `parameter_review_decisions`, `parameter_submission_items`, `project_parameter_binding_revisions`, `project_parameter_file_versions`, `dts_config_set`, `dts_release_baseline`, `dts_release_baseline_members`, `dts_config_revisions`, `dts_config_revision_members`, `dts_logical_nodes`, `dts_logical_node_revisions`, `canonical_bindings`, `canonical_source_occurrences`, `canonical_source_pins`, `binding_history_events`, `canonical_values`。

T0.3 写 32；T1.1 加了 occurrences/pins。preserved/shared、regenerable、view、absent 沿用 T0.3。

FK（与 `archive.integration.test.ts` 冻结一致）：`dts_reload_run_targets`→Binding **CASCADE**（先迁）；`parameter_spec_review_tasks`→config_revisions **CASCADE**（仍被 review 引用则不删该 revision）；observation_matches / definition_replacement_projects / observations **RESTRICT**（父键视为 successor）；debugging/node_operations/migration_evidence **NO ACTION**（跳过仍被引用的 Binding，整行保留，这是具名例外不是 stub）；parse 树 CASCADE/NO ACTION：先删 regenerable 子行再删父残留。

捕获 34 张表上凡 `TG_OP = 'DELETE'` 会 raise 的触发器都拒绝普通 DELETE（至少包括 `protect_binding_identity`、`protect_project_parameter_binding_source_identity`、`protect_source_occurrence_identity`、`reject_immutable_catalog_change`、`reject_immutable_project_value_source_pin`、`protect_pinned_source_provenance`、`protect_pinned_source_file`、`protect_submitted_source_request`）。`protect_submitted_candidate_payload` 只挡 UPDATE。残留 DELETE 只走新 migration 的 `dispose_plane_residue` + definer-only allow-list 表（与 DELETE 同一事务）。禁止 DISABLE TRIGGER，禁止用用户可设的 GUC 当门。rehome 只针对 `dts_reload_run_targets`。分类表里「始终残留」也是 disposer 删除，不是普通 DELETE。

## 删除集

`residue = snapshot_pks − successor_pks − restrict_pks`。34 张都有 successor 类：canonical 当前平面、当前源结构、仍开放的 workflow、被保留父级的 history；其余快照内且非 successor 的为残留。禁止 TRUNCATE/DROP。

## 行

T23A-01…16 与英文相同。另：T23A-17 immutability 函数；T23A-18 最小 stub 是 P7 410／archived notice，不是第二张 stub 表；T23A-19 行删完后按 `storage_key` 反向检查删独占线上字节，档案内嵌副本保留。相位名与设计一致：`archive-verified` → `rehomed`（仅 `dts_reload_run_targets`）→ `residue-deleted`。

## 非目标

执行删除（T2.3b）；目标机/整库恢复（T3.3）；T1.4 清零；改 0151–0153；commit/PR。
