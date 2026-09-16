# Migrations 0148/0149 — retrospective R3 threat matrix

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/migrations-0148-0149-r3-threat-matrix.md)

Issue: #849, tracked by #853 T0.3. Scope: `0148_seed_initialization_runs.sql`,
`0149_project_parameter_plane_archives.sql`, and the seed-initialization services that enforce those schemas.

## Evidence boundary

This is a **retrospective** review. The migrations and their original services reached `main` in PR #858 before
an R3 threat matrix or independent Spec review existed. This document does not relabel that historical delivery
as pre-implementation R3 compliance. It records the current threats, the corrective candidate, and the successor
gates that remain outside T0.3.

T0.3 covers the capture-only archive and run journal. It does not authorize archived-plane deletion, target-host
execution, recovery claims, or production readiness. Those remain #853 T2.3 and T3.3/T3.4.

## Protected invariants

1. One seed digest can initialize only Atlas, Aurora, and Nebula inside the authenticated Organization.
2. A completed `(organization_id, seed_digest)` is terminal and replay is a no-op.
3. At most one materialization of the fixed three-Project scope executes at a time per Organization, even for different seed digests.
4. A rebuild starts only after the exact archive returned by its capture is complete, readable, and consistent with its ledger digests.
5. Capture preserves every non-regenerable online row and every referenced source-version byte. Disposal is a separate destructive operation with separate approval.
6. The archive ledger and run journal retain history when a Project, Organization, or initiating User changes.

## Threat matrix

| ID | Failure or attack | Control and evidence | Result / owner |
| --- | --- | --- | --- |
| R3-01 | Caller supplies another Organization id | `materializeSeedSources` binds input to `auth.organization.id`; integration test expects `FORBIDDEN` | Corrected in the T0.3 candidate |
| R3-02 | Read-only actor creates a durable `running` journal or replays a completed run before authorization fails | All three target edit permissions are checked before journal writes and before completed replay; denial leaves no new run or result | Corrected; `materialize.test.ts` |
| R3-03 | Two processes with the same or different seed digests write the shared Atlas/Aurora/Nebula scope concurrently | Session-level PostgreSQL advisory lock covers the full operation for Organization + fixed target scope; every contender gets `CONFLICT` | Corrected; deterministic held-object-store concurrency cases |
| R3-04 | A completed run is downgraded to `running` or `failed` through the journal seam | The upsert refuses updates when the stored state is `completed` | Corrected; `plan.test.ts` terminal-state case |
| R3-05 | Wrong or missing project identity is guessed or created | Stable id, Organization and reviewed project code must all match; blocked plans create no project | Existing `plan.test.ts` evidence |
| R3-06 | Capture silently omits a non-regenerable relation or another Project's child rows bleed in | Thirty-two relations cover the per-Project legacy and canonical plane; canonical values/history use the canonical Binding owner while legacy revisions use the legacy owner. The disposition inventory below classifies every table in the legacy/project-plane recon as captured, preserved/shared, regenerable, or already absent | Corrected; real non-zero graph and isolation evidence |
| R3-06a | Capture claims idempotency only because of timestamp or physical row order | Reuse ignores capture time and every relation is ordered by stable primary key, never `ctid`; ordinary calls reuse an unchanged logical plane | Corrected; production-shaped idempotency case |
| R3-06b | Source metadata is archived but a file-version or unactivated candidate object's bytes are missing or changed | Archive v2 reads both object classes, verifies stored SHA-256 and size, and embeds the bytes; missing or mismatched objects fail closed | Corrected; byte-content assertions |
| R3-06c | Relation rows or up to 5,000 source objects exhaust process memory while the archive JSON is assembled | Relation JSON size is preflighted inside the repeatable-read snapshot before rows are returned; unique source bytes are preflighted from metadata and then read through a 64 MiB-bounded local/S3 adapter. Either aggregate exceeding 64 MiB fails closed | Corrected; relation preflight plus adapter and aggregate-cap refusal cases |
| R3-07 | Separate count and row reads observe a torn plane, or a bounded relation is treated as complete | Capture runs under one repeatable-read transaction; `truncated=true` blocks rebuild; the guard requires exact declared relation keys and row lengths equal to ledger counts | Corrected; forged torn-artifact refusal |
| R3-08 | The captured object is removed/corrupted, or a newer valid archive masks that failure | Guard selects the exact capture ID + digest and verifies object SHA-256, archive digest, schema version, Organization, Project, truncation, relation counts and embedded file bytes | Corrected; tampered and exact-artifact cases |
| R3-09 | Capture is mistaken for disposal | Test proves source drafts remain after capture; schema intentionally has no disposal/deletion marker | Characterized; disposal remains #853 T2.3 |
| R3-10 | Ledger ownership is erased by parent deletion | Organization/Project FKs use `ON DELETE RESTRICT`; initiating User uses nullable history via `ON DELETE SET NULL` | Real-PostgreSQL schema assertion + generated schema |
| R3-11 | Journal loses run uniqueness | Primary key is `(organization_id, seed_digest)` and the status index is Organization-scoped | Real-PostgreSQL schema assertion + generated schema |
| R3-12 | Concurrent writes change the plane during capture or after capture before final destructive work | Repeatable-read makes one capture internally consistent; final execution still requires the target-host write-quiescence gate across capture and later destructive work | Local control corrected; successor gate remains #853 T3.3 |
| R3-13 | Object write succeeds but the ledger insert fails, leaving an orphan object | No preserved data is lost; object cleanup and final retention policy belong to the independently reviewed disposal operation | Residual operational risk: #853 T2.3 |
| R3-14 | Captured bytes cannot be restored with the database and durable stores at one boundary | Local capture tests are not recovery evidence | Open successor gate: #853 T3.3 |
| R3-15 | Applied migrations are rewritten to hide a defect | `0148` and `0149` remain byte-unchanged; corrections live in service/test/doc files | Enforced by candidate diff review |

## Schema and data-disposition evidence

- `docs/generated/db-schema.md` is regenerated from all 147 migrations through 0149. It records both tables,
  their primary/unique keys, checks, indexes, `RESTRICT` ownership FKs, and nullable User-history policy.
- `archive.integration.test.ts` runs on real PostgreSQL, verifies the two retention FKs, the User-history FK,
  the journal primary key, and the deliberate absence of `disposed_at`/`deleted_at`.
- The same suite proves all thirty-two relation counts, stored rows, file-version and candidate bytes, child scoping,
  cross-Project isolation, unchanged source rows, aggregate-cap enforcement, idempotent reuse, missing/truncated/torn refusal,
  exact-artifact selection, authorization, and object integrity.
- `objectStore.test.ts` and `s3ObjectStore.test.ts` prove the local adapter rejects from file metadata before reading,
  the HTTP adapter cancels a stream as soon as it crosses the limit, and custom transports without a bounded-read
  primitive fail closed.
- `plan.test.ts` proves fixed target identity, no implicit project creation, retry blocker visibility,
  completed-run idempotency, and terminal-state immutability.
- `materialize.test.ts` proves the three-project path, completed replay, fail-closed subject blockers, explicit
  JSON refusal, Organization binding, authorization-before-journal, and concurrent single-flight behavior.

### Table-by-table disposition

This inventory is the T0.3 capture boundary, not permission to delete anything. `Captured` means the row and any
referenced source bytes are in archive v2. `Preserved/shared` means T2.3 must leave the table online because its
owner is Organization/global control-plane state rather than one Project. `Regenerable` means capture omits the
derived row; T3.3 must prove deterministic regeneration and foreign-key/locator mapping before any disposal.
`Absent/dropped` means the table does not exist in the current schema and therefore has no online rows to dispose.

| Table | Disposition | Reason |
| --- | --- | --- |
| `public.project_parameter_values` | Captured | Legacy per-Project values |
| `public.parameter_drafts` | Captured | Legacy per-Project pending edits |
| `public.parameter_draft_identity_invalidations` | Captured | Project-scoped invalidation state |
| `public.parameter_history_entries` | Captured | Legacy per-Project history |
| `public.parameter_submission_rounds` | Captured | Project-scoped review workflow |
| `public.parameter_submission_items` | Captured | Child of a captured submission round |
| `public.parameter_change_requests` | Captured | Project-scoped change workflow |
| `public.parameter_review_decisions` | Captured | Child of a captured change request |
| `public.project_parameter_bindings` | Captured | Legacy per-Project identity binding |
| `public.project_parameter_binding_revisions` | Captured | Child history of a captured binding |
| `public.project_parameter_files` | Captured | Per-Project source metadata |
| `public.project_parameter_file_candidates` | Captured | Per-Project unactivated source metadata and bytes |
| `public.project_parameter_file_versions` | Captured | Child source metadata and bytes |
| `public.project_parameter_initialization_drafts` | Captured | Per-Project initialization proposal |
| `public.project_parameter_initialization_reviews` | Captured | Per-Project initialization review |
| `public.parameter_import_batches` | Captured | Per-Project import provenance |
| `public.parameter_file_sync_conflicts` | Captured | Per-Project unresolved sync state |
| `public.identity_mapping_tasks` | Captured | Per-Project unresolved identity work |
| `public.parameter_spec_matcher_overrides` | Captured | Project-scoped matching override |
| `public.dts_property_occurrence_spec_decisions` | Captured | Non-regenerable human decision; restore mapping remains T3.3 |
| `public.project_parameter_value_drafts` | Captured | Canonical per-Project pending edit |
| `public.project_parameter_value_change_requests` | Captured | Canonical per-Project change workflow |
| `public.dts_config_set` | Captured | Per-Project source structure |
| `public.dts_release_baseline` | Captured | Child of a captured config set |
| `public.dts_release_baseline_members` | Captured | Child of a captured baseline |
| `public.dts_config_revisions` | Captured | Per-Project source revision |
| `public.dts_config_revision_members` | Captured | Child of a captured revision |
| `public.dts_logical_nodes` | Captured | Per-Project logical identity |
| `public.dts_logical_node_revisions` | Captured | Child history of a captured logical node |
| `parameter_catalog.project_parameter_bindings` | Captured | Canonical per-Project identity binding |
| `parameter_catalog.binding_history_events` | Captured | Child history of a canonical binding |
| `parameter_catalog.project_parameter_values` | Captured | Canonical per-Project values |
| `public.parameter_specs` | Preserved/shared | Organization/global catalog control plane |
| `public.parameter_spec_versions` | Preserved/shared | Version history shared by Projects |
| `public.parameter_definitions` | Preserved/shared | Organization definition registry |
| `public.parameter_modules` | Preserved/shared | Organization attribution taxonomy |
| `public.parameter_module_mappings` | Preserved/shared | Organization attribution mapping |
| `public.parameter_module_dismissed_compatibles` | Preserved/shared | Organization governance decision |
| `public.parameter_spec_review_tasks` | Preserved/shared | Organization specification workflow |
| `public.parameter_policy_targets` | Preserved/shared | Organization policy control plane |
| `public.parameter_reload_bindings` | Absent/dropped | Created by migration 0026 and removed by 0037; no current rows |
| `public.parameter_identity_migration_runs` | Preserved/shared | Cross-Project migration control record |
| `public.parameter_identity_migration_phases` | Preserved/shared | Child of a preserved migration run |
| `public.parameter_identity_cutovers` | Preserved/shared | Cross-Project cutover control record |
| `public.parameter_definition_reconciliation_runs` | Preserved/shared | Organization reconciliation control record |
| `public.parameter_definition_reconciliation_items` | Preserved/shared | Child of a preserved reconciliation run |
| `public.parameter_spec_version_cutover_runs` | Preserved/shared | Organization cutover control record |
| `public.parameter_spec_version_cutover_items` | Preserved/shared | Child of a preserved cutover run |
| `public.parameter_spec_property_key_cutover_runs` | Preserved/shared | Organization cutover control record |
| `public.parameter_spec_property_key_cutover_items` | Preserved/shared | Child of a preserved cutover run |
| `public.dts_node_occurrences` | Regenerable | Derived by parsing captured source versions; T3.3 must prove locator mapping |
| `public.dts_property_occurrences` | Regenerable | Derived by parsing captured source versions; T3.3 must remap captured decisions |
| `public.dts_occurrence_effects` | Regenerable | Derived analysis output |
| `public.dts_validation_runs` | Regenerable | Re-runnable validation output |
| `public.dts_validation_diagnostics` | Regenerable | Child output of validation runs |

`parameter_bindings` without the `project_` prefix does not exist and therefore has no disposition row.

## Review disposition

The implementing agent's self-review is **not** the required independent review. The candidate may enter seal only
after independent Standards and Spec reviewers examine the diff from its fixed base and this matrix. A review
finding must be repaired or explicitly retained as a successor gate; it must not be converted into an unqualified
PASS. Even after T0.3 closes, T2.3 and T3.3 remain blocking for #849 completion.
