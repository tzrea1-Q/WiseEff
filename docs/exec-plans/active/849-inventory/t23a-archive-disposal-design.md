# T2.3a archive disposal and recovery — implementable design

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t23a-archive-disposal-design.md)

Companion to the [threat matrix](t23a-archive-disposal-threat-matrix.md). Independent Spec required before T2.3b. **T2.3a does not delete.**

Status: **Spec re-review PASS with P2.** Independent review `a53d7ed7-9e12-45a2-a3af-ed0889296b01`. T2.3b is **not** authorized by this PASS. No production delete, DROP, commit, PR, target, or Issue mutation in T2.3a.

## 1. What T2.3a is

Decide the exact online deletion scope for #849 item 4 after capture+rebuild. Capture (T0.3) already copies 34 declared per-Project relations and referenced source bytes into archive v2 and **leaves rows online**. Rebuild (T1.3) materializes Atlas/Aurora/Nebula **without** a disposal column. T2.3b will delete only **residue**: snapshot primary keys that are not current successor identities and are not RESTRICT/NO ACTION protected.

T2.3a also names recovery: authorized retrieval of the unchanged archive; whole-state restore of **database + object store** remains T3.3 (R3-14). T2.3b proves local refuse/idempotent delete only.

## 2. Why not DROP / why not “delete the 34 tables”

T1.3 successor and T2.2 families still query `project_parameter_bindings`, `dts_*` source structure, canonical catalog bindings, and preserved `parameter_specs` / modules. T1.4 leftover 49 are current scanner hits of that SQL. Dropping those tables would undo the successor. T0.3 already classified Organization/global tables as preserved/shared.

## 3. Delete-set (normative)

Input: `organizationId`, `projectId` ∈ {Atlas, Aurora, Nebula for that org}, `archiveId`, `archiveDigest`, operator + approval ref.

1. Load ledger row `project_parameter_plane_archives` for that org/project. Require `archive_id` and `archive_digest` equal the input (T0.3 exact-artifact guard).
2. Get the object; verify SHA-256, schema v2, `truncated=false`, 34 relation keys, counts, embedded bytes (T23A-01/02).
3. For each of the **34** relations, `snapshot_pks` from the document (stable PK / capture `orderBy`).
4. `successor_pks` per the matrix table (canonical current plane, current source structure, open workflow, history of retained parent). Same-id reuse retain.
5. Subtract RESTRICT-referenced PKs. Delete regenerable parse/validation children **before** residue file-version/logical-node DELETE so NO ACTION does not skip those parents forever.
6. Rehome `dts_reload_run_targets.project_parameter_binding_id` to NULL or an archived-notice column for Binding residue (T23A-05). Skip `dts_config_revisions` PKs that still parent `parameter_spec_review_tasks` (T23A-06).
7. DELETE **all** residue (public and canonical) only via `disposeProjectParameterPlaneResidue` → SQL `dispose_plane_residue` SECURITY DEFINER that fills `plane_disposal_allowlist` then DELETEs (T23A-17). Child→parent order as capture scopes. Ordinary SQL DELETE of residue still fails closed.
8. After residue file-version/candidate rows are gone, delete live object-store blobs whose `storage_key` has zero remaining live references (T23A-19). Keep archive-embedded copies and P7 objects (T23A-08).
9. Post-cutover inserts (PK not in snapshot) stay (T23A-11).
10. Other projects/orgs stay (T23A-10).

Empty residue is success. Replay is a no-op (PKs already absent).

## 4. Owner and seam

New functions next to `captureProjectParameterPlane` in `seedInitialization/archive.ts` (or `dispose.ts` beside it):

- `planProjectParameterPlaneDisposal` — read-only delete-set; no writes.
- `disposeProjectParameterPlaneResidue` — T2.3b only; not called from `materializeSeedSources`. Completed seed replay stays a no-op and **must not** start disposal.

Authorization: stricter than `parameter:edit`. Cutover-operator role + non-empty approval ref, same family as P7 `authorizeOperator`. Viewer/read-only leaves zero DELETE.

Journal: a dedicated disposal phase table in a **new** migration (do not edit 0148/0149/0151). Phases: `archive-verified` → `rehomed` (`dts_reload_run_targets` only) → `residue-deleted`. `pg_advisory_lock` per org+project. `recovery-required` on crash; resume skips completed phases.

The same new migration owns `dispose_plane_residue` and `plane_disposal_allowlist` (REVOKE ALL FROM PUBLIC). Triggers that raise on DELETE gain an allow-list exception; they keep rejecting ordinary DELETE. No GUC gate.

No `disposed_at` on 0149 (T0.3 R3-09). Disposal proof is the phase journal + residue count 0 for that archive id, not a capture-ledger rewrite.

## 5. Recovery

| Path | T2.3a decision |
| --- | --- |
| Authorized retrieval of capture v2 | No public HTTP GET today (capture is internal). T2.3b adds operator-only retrieve-by-archive-id on the cutover seam, not product UI. Custody: object-store key already used by capture; retention = existing 0149 ledger row lifetime (do not SET NULL). ADR-0045 publication isolation unchanged |
| P7 encrypted archive restore | Existing `restoreArchive`; public seam still refuses plaintext |
| Recreate deleted residue rows | Only via T3.3 whole-state restore of DB + object store from a recovery point taken **before** T2.3b. T2.3b is not a row-undelete API |
| Regenerable parse trees | Recreate by parsing retained or restored source versions (T3.3) |
| Current successor plane | Never in the delete-set; no restore needed |

## 6. Embedded historical references

Do **not** bulk-rewrite JSONB, Agent checkpoints, logs, audit metadata, or URLs. T2.2-AGT already refuses stale tool writes. Old links stay archived-notice / 410 (`legacy-id-archived` or gone). That 410 **is** the reviewed minimal stub for product resolution — not a second stub table and not payload-null tombstones. Non-regenerable RESTRICT/NO ACTION skipped parents keep full payload (named preserved exception).

## 7. Fence / dual-write

T1.4 leftover dual-write/TD-125 stays named, not removed here. Stale-draft fencing at rebuild epoch: drafts whose PK is residue are deleted with the plane; drafts whose PK is successor stay. No extra fence table in T2.3a.

## 8. Evidence for T2.3b (not this todo)

- Extend `archive.integration.test.ts` with residue/retain/restrict/cascade-rehome/tamper/auth/tenant/post-cutover cases. Nonzero collected tests on helper PG 55438.
- `git diff --check`. New migration if a journal table is added.
- Independent Spec of T2.3b bytes after this design PASS.
- No UI sweep unless a 410/notice copy changes; then 1440x900 once.
- Local PG proof is not target-host disposal (T3.3b).

## 9. Concrete destructive action (presented; not executed)

**Name:** `disposeProjectParameterPlaneResidue`

**Target:** online residue rows for one captured Atlas/Aurora/Nebula project, computed from one exact 0149 archive document.

**Not in the action:** DROP TABLE; TRUNCATE; delete archive objects; delete P7 archives; delete preserved/shared tables; delete successor PKs; other organizations; compose `5432/wiseeff`; `wiseeff_lane_849`; production/target hosts.

**Preconditions:** T2.3a Spec PASS; T2.3b implementation Spec PASS; capture-before-delete green on helper PG 55438; operator + approval ref.

**T2.3b may start only after a further explicit confirmation of this action.** User “全部授权” on the program is not a substitute for confirming this named action after Spec PASS.

## 10. Key decisions

1. 34 captured relations from current `ARCHIVED_PARAMETER_PLANE_RELATIONS`, not the historical 32. All 34 have a successor/residue class.
2. Row residue, never table drop.
3. Same-ID successor retain; open workflow on successor parents retain; history of retained parents retain.
4. FK rehome (`dts_reload_run_targets`) / skip RESTRICT / delete regenerable children before NO ACTION parents.
5. All residue DELETE only via disposer + allow-list table (T23A-17). Ordinary DELETE stays fail-closed. Inventory of DELETE-raising triggers is fail-closed against the freeze.
6. Live exclusive source bytes deleted after row residue; archive-embedded copies stay.
7. Two archive systems stay distinct. Operator retrieve-by-id is new cutover seam, not a product GET.
8. No 0148/0149/0151 rewrite.
9. No commit in T2.3a.

## Open questions

None that block Spec of this decision. Restore mapping for regenerable parse trees stays T3.3.
