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
| R3-06 | Capture silently omits a non-regenerable relation or another Project's child rows bleed in | Twenty-four relations additionally include canonical pending drafts, change requests and binding history; canonical values/history use the canonical Binding owner while legacy revisions use the legacy owner | Corrected; real non-zero graph and isolation evidence |
| R3-06a | Capture claims idempotency only because of timestamp or physical row order | Reuse ignores capture time and every relation is ordered by stable primary key, never `ctid`; ordinary calls reuse an unchanged logical plane | Corrected; production-shaped idempotency case |
| R3-06b | Source metadata is archived but a file-version or unactivated candidate object's bytes are missing or changed | Archive v2 reads both object classes, verifies stored SHA-256 and size, and embeds the bytes; missing or mismatched objects fail closed | Corrected; byte-content assertions |
| R3-06c | Up to 5,000 source objects exhaust process memory while the archive JSON is assembled | Unique referenced source bytes have a 64 MiB aggregate cap checked from metadata before object reads; over-cap capture fails closed | Corrected; aggregate-cap refusal case |
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
- The same suite proves all twenty-four relation counts, stored rows, file-version and candidate bytes, child scoping,
  cross-Project isolation, unchanged source rows, aggregate-cap enforcement, idempotent reuse, missing/truncated/torn refusal,
  exact-artifact selection, authorization, and object integrity.
- `plan.test.ts` proves fixed target identity, no implicit project creation, retry blocker visibility,
  completed-run idempotency, and terminal-state immutability.
- `materialize.test.ts` proves the three-project path, completed replay, fail-closed subject blockers, explicit
  JSON refusal, Organization binding, authorization-before-journal, and concurrent single-flight behavior.

## Review disposition

The implementing agent's self-review is **not** the required independent review. The candidate may enter seal only
after independent Standards and Spec reviewers examine the diff from its fixed base and this matrix. A review
finding must be repaired or explicitly retained as a successor gate; it must not be converted into an unqualified
PASS. Even after T0.3 closes, T2.3 and T3.3 remain blocking for #849 completion.
