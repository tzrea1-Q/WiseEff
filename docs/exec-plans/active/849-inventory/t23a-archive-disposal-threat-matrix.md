# T2.3a archive disposal and recovery — pre-implementation threat matrix

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t23a-archive-disposal-threat-matrix.md)

Contract: #849/#853 T2.3a. Capture already exists (0149 + `seedInitialization/archive.ts`). This matrix freezes **what may be deleted online** and **what must stay**. T2.3b implements only after independent Spec PASS of this matrix and the companion design, and after the concrete destructive action below is approved.

Status: **Spec re-review PASS with P2** `a53d7ed7-9e12-45a2-a3af-ed0889296b01`. Prior FAILs `7c3e9a14-…`, `b056e58b-…`, `fb9a54cc-…` closed. T2.3b is **not** authorized by this PASS.

## Lane and boundaries

- Worktree `/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`, branch `codex/849-853-t11-source-identity`, HEAD `f9c710f6a90d67462965a06abd47e33aa200e75e` plus uncommitted Scratch (T1.1–T1.4 Repair C).
- Risk **R3**. Threat matrix + design Spec **before** any delete path.
- Helper PG **55438** disposable DBs only. Never `wiseeff_lane_849`, never compose `5432/wiseeff`.
- Reviewers: grok-4.6 (requested gpt-5.6-luna unavailable; disclose).
- T1.4 is **not** zero (49 unallowlisted scanner hits). That forbids dropping live tables those hits still query. It does **not** forbid row-level residue disposal of **pre-rebuild captured PKs that are not current successor identities**.
- T2.3a does not execute T2.3b. T3.3 owns target quiescence and whole-deployment restore.

## Invariant under protection

After approved disposal: (1) offline archives remain readable with unchanged digests; (2) no unauthorized **online** old payload of replaced pre-rebuild rows; (3) no dangling FK and no cascaded non-parameter deletion; (4) current successor bindings/values/source pins/occurrences for Atlas/Aurora/Nebula stay; (5) preserved/shared Organization/global tables stay online; (6) corrupt/missing archive refuses the delete; (7) post-cutover writes into successor tables are not deleted as residue; (8) stale replay cannot resurrect disposed rows.

## Two archive systems (do not mix)

| System | Ledger | Object | T2.3 role |
| --- | --- | --- | --- |
| Seed plane capture | `public.project_parameter_plane_archives` | Object-store document v2 (counts + digests + embedded file/candidate bytes) | **This disposal.** Delete online residue of a named capture |
| Catalog cutover P7 | `parameter_catalog.parameter_catalog_archives` | Encrypted `WEARC1` local FS objects | **Keep.** Lookup 410 `legacy-id-archived`. Do not decrypt onto the public seam. Do not drop this ledger |

## Captured relation inventory (current code)

`ARCHIVED_PARAMETER_PLANE_RELATIONS` is **34** keys (T0.3 docs said 32; T1.1 added `canonical_source_occurrences` and `canonical_source_pins`). T2.3a freezes the **code list**, not the stale 32.

Captured (row-level residue candidates, tables stay):

- public: `parameter_drafts`, `project_parameter_values` (legacy), `parameter_draft_identity_invalidations`, `parameter_history_entries`, `parameter_submission_rounds`, `parameter_submission_items`, `parameter_change_requests`, `parameter_review_decisions`, `project_parameter_bindings`, `project_parameter_binding_revisions`, `project_parameter_files`, `project_parameter_file_candidates`, `project_parameter_file_versions`, `project_parameter_initialization_drafts`, `project_parameter_initialization_reviews`, `parameter_import_batches`, `parameter_file_sync_conflicts`, `identity_mapping_tasks`, `parameter_spec_matcher_overrides`, `dts_property_occurrence_spec_decisions`, `project_parameter_value_drafts`, `project_parameter_value_change_requests`, `dts_config_set`, `dts_release_baseline`, `dts_release_baseline_members`, `dts_config_revisions`, `dts_config_revision_members`, `dts_logical_nodes`, `dts_logical_node_revisions`
- parameter_catalog: `project_parameter_bindings`, `project_parameter_source_occurrences`, `project_value_source_pins`, `binding_history_events`, `project_parameter_values`

**Preserved/shared (no T2.3 delete, no DROP):** `parameter_specs`, `parameter_spec_versions`, `parameter_definitions`, `parameter_modules`, `parameter_module_mappings`, `parameter_module_dismissed_compatibles`, `parameter_spec_review_tasks`, `parameter_policy_targets`, `dts_reload_runs`, `debugging_parameters`, `node_operations`, `legacy_parameter_migration_evidence`, `parameter_catalog.parameter_observations`, `parameter_observation_matches`, `definition_replacement_projects`, identity/cutover/reconciliation run tables. Leftover T1.4 hits live here and in live binding SQL.

**Regenerable (do not primary-delete):** parse/validation trees (`dts_nodes`, `dts_properties`, `dts_phandle_refs`, `dts_node_occurrences`, `dts_property_occurrences`, `dts_occurrence_effects`, `dts_validation_*`). May CASCADE when a captured parent file-version/revision residue is deleted. T3.3 must prove locator remapping for restored decisions.

**View:** `parameter_catalog.current_project_parameter_bindings` — regenerable; not dropped.

**Absent:** `parameter_reload_bindings` (dropped 0037).

## External FK closure that blocks naive DELETE

Measured by `archive.integration.test.ts` against the captured relation set:

| Child | Parent | ON DELETE | T2.3a required action before parent residue delete |
| --- | --- | --- | --- |
| `dts_reload_run_targets` | `public.project_parameter_bindings` | **CASCADE** | Rehome or archive targets first. Do not let Binding residue delete wipe reload evidence |
| `parameter_spec_review_tasks` | `public.dts_config_revisions` | **CASCADE** | Preserved/shared child. Rehome or skip deleting that revision if it is still a live review parent |
| `parameter_catalog.parameter_observation_matches` | `parameter_catalog.project_parameter_bindings` | **RESTRICT** | Never delete a canonical Binding that still has a match. Those IDs are successor, not residue |
| `parameter_catalog.definition_replacement_projects` | canonical Binding/Value | **RESTRICT** | Same: skip those PKs |
| `parameter_catalog.parameter_observations` | `project_parameter_source_occurrences` | **RESTRICT** | Skip occurrence PKs that still have observations |
| `debugging_parameters`, `node_operations`, `legacy_parameter_migration_evidence` | `public.project_parameter_bindings` | **NO ACTION** | Skip Binding PKs still referenced |
| `dts_reload_runs` | `dts_config_revisions` | **SET NULL** | Allowed; evidence stays |
| parse tables | file versions / revisions | CASCADE or NO ACTION | Regenerable CASCADE is allowed only for residue parents |

Triggers stay enabled. **Every residue DELETE** (all 34, not only catalog) runs inside one new `SECURITY DEFINER` disposer (new migration; do not rewrite 0148/0149/0151/0152). The disposer writes a definer-only session table `parameter_catalog.plane_disposal_allowlist(archive_id, relation_key, pk)` (REVOKE ALL FROM PUBLIC) and DELETEs those PKs. Ordinary sessions cannot insert into the allow-list.

T2.3b must extend **every** trigger on the captured 34 that raises on `TG_OP = 'DELETE'` with `OR the row is on the allow-list for this archive_id`. Known DELETE-rejectors today include at least: `protect_binding_identity`, `protect_project_parameter_binding_source_identity`, `protect_source_occurrence_identity`, `reject_immutable_catalog_change`, `reject_immutable_project_value_source_pin`, `protect_pinned_source_provenance`, `protect_pinned_source_file`, `protect_submitted_source_request`. `protect_submitted_candidate_payload` is UPDATE-only and is **not** a DELETE gate. A T2.3b Red fails if `archive.integration.test.ts` freeze plus `pg_trigger` on the 34 shows a DELETE-raising function not updated. Do not `DISABLE TRIGGER`. Do not use a user-settable GUC as the gate. Allow-list inserts and residue DELETEs are **one transaction**; leftover allow-list rows cannot authorize a later session.

Regenerable parse children are deleted first (via the same disposer) so NO ACTION parents no longer block residue file-version/node delete.

## Delete-set rule (the whole decision)

For a named `(organization_id, project_id, archive_id, archive_digest)`:

```
residue(relation) = snapshot_pks(relation)
  minus successor_pks(relation)
  minus restrict_referenced_pks(relation)
```

`snapshot_pks` come from the **exact** archive document, not a live `SELECT *`. Empty residue ⇒ no-op. Never `TRUNCATE` / `DROP TABLE`. Never delete the archive object or ledger row.

**Per-relation `successor_pks` (all 34 classified):**

| Class | Relations | Successor retain |
| --- | --- | --- |
| Canonical current plane | catalog `project_parameter_bindings`, `project_parameter_values`, `project_parameter_source_occurrences`, `project_value_source_pins`; public `project_parameter_bindings` whose id is the live seed/backfill identity | PK still current for the project after T1.3 (same-id reuse retain) |
| Current source structure | `project_parameter_files`, `_file_versions`, `_file_candidates` still in the default config-set; `dts_config_set` default set; its baselines/revisions/members; logical nodes/revisions of that set | PK still a current config-set member |
| Open workflow | `parameter_drafts`, `project_parameter_value_drafts`, change-requests/reviews/submissions/items/invalidations, init drafts/reviews, identity_mapping_tasks, file_sync_conflicts | PK still **open/in-flight** on a retained successor parent |
| History of retained parent | `binding_history_events`, `project_parameter_binding_revisions` | parent Binding PK retained |
| Always residue if in snapshot and not successor/open | public legacy `project_parameter_values`, closed drafts/history/submissions/CRs (including closed `project_parameter_value_change_requests`), import batches, matcher overrides, occurrence spec decisions, init records not in-flight | delete **via disposer** (not ordinary DELETE) |
| Regenerable | parse/validation trees | delete children first, then residue parents |

RESTRICT children (`observation_matches`, `definition_replacement_projects`, `parameter_observations`) ⇒ parent PK is successor, not residue. NO ACTION debugging/node_operations/migration_evidence on public Binding ⇒ skip those Binding PKs (full payload stays because they are still referenced; they are **exceptions**, not stubs). Regenerable NO ACTION is cleared by deleting regenerable children first — not by skipping the parent forever.

## Rows

| ID | Dimension | Expected observation | Evidence owner |
| --- | --- | --- | --- |
| T23A-01 | Capture complete | Delete refuses unless archive id+digest match, schema v2, not truncated, object SHA-256 matches, relation keys == 34 declared keys, row lengths == ledger counts, embedded bytes match | T2.3b Red: truncated/tampered/wrong-id |
| T23A-02 | Capture-before-delete | Re-read archive immediately before first DELETE; mismatch aborts with no row change | T2.3b |
| T23A-03 | Successor retain | Seed/backfill IDs present in both snapshot and live current set are not deleted | T2.3b + T1.3 124/372 oracle |
| T23A-04 | Restrict/NO ACTION | Referenced PKs skipped; no FK error; no child wipe | T2.3b |
| T23A-05 | Reload CASCADE | `dts_reload_run_targets` rehomed/archived before Binding residue delete; reload runs remain | T2.3b |
| T23A-06 | Review CASCADE | Do not delete a `dts_config_revisions` residue PK that still parents `parameter_spec_review_tasks` | T2.3b |
| T23A-07 | No table drop | Preserved/shared tables and captured **tables** remain. Information_schema still lists them | T2.3b |
| T23A-08 | Offline retain | Archive document and P7 encrypted objects still get/decrypt after disposal | T2.3b |
| T23A-09 | Corrupt refuse | Missing object, checksum mismatch, plaintext-leak path unused; no payload on public GET | existing archive tests + T2.3b |
| T23A-10 | Tenant | Other Organization / other Project rows untouched | T2.3b |
| T23A-11 | Post-cutover write | A binding created after the named capture is not in snapshot ⇒ not residue ⇒ not deleted | T2.3b |
| T23A-12 | Auth | `parameter:edit` insufficient; requires explicit disposal operator + approval ref. Viewer cannot dispose | T2.3b |
| T23A-13 | Resume | Phase journal: `archive-verified` → `rehomed` → `residue-deleted`. Rehome target is `dts_reload_run_targets` (Binding residue) only. Crash mid-phase → `recovery-required`; resume is idempotent on already-absent PKs | T2.3b |
| T23A-17 | Immutability | All residue DELETE (34 relations) only inside the disposer + allow-list table. Ordinary DELETE still fails. Red: every DELETE-raising trigger on the 34 is allow-list-aware | T2.3b Red |
| T23A-18 | Minimal stubs | Product old-id resolution is P7 lookup 410 / archived notice, not a second stub table. Skipped RESTRICT/NO ACTION **non-regenerable** parents keep full payload (named exception). No payload-null tombstone in T2.3a |
| T23A-19 | Live source bytes | After residue file-version/candidate row delete, delete object-store blobs whose `storage_key` has **zero** remaining live references (shared-object reverse-check). Archive-embedded copies stay | T2.3b |
| T23A-14 | History embeds | JSONB / Agent checkpoint / log / URL old ids are **not** bulk-rewritten. They resolve as archived notice or 410. T2.2-AGT already refuses stale tool writes | receipt; no rewrite job |
| T23A-15 | Dual-write/TD-125 | Not removed here. Named successor remains T1.4 leftover | T1.4 receipt |
| T23A-16 | Non-goals | DROP DATABASE, target host, P7 ledger drop, 0151–0153 rewrite, allowlist growth, Issue close | this matrix |

## Non-goals

- Executing the delete (T2.3b).
- Target quiescence / Docker rehearsal / whole-state restore (T3.3).
- Making T1.4 scanner hits zero.
- Rewriting unpublished Scratch 0151–0153.
- Commit / PR / Hosted.

## Self-review limit

Written by the coordinating implementer. Independent Spec required before T2.3b.
