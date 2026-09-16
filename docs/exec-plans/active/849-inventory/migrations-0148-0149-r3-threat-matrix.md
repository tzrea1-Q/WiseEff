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
3. At most one materialization of that key executes at a time across processes sharing PostgreSQL.
4. A rebuild starts only after the latest archive is complete, readable, and consistent with its ledger digests.
5. Capture preserves every online row. Disposal is a separate destructive operation with separate approval.
6. The archive ledger and run journal retain history when a Project, Organization, or initiating User changes.

## Threat matrix

| ID | Failure or attack | Control and evidence | Result / owner |
| --- | --- | --- | --- |
| R3-01 | Caller supplies another Organization id | `materializeSeedSources` binds input to `auth.organization.id`; integration test expects `FORBIDDEN` | Corrected in the T0.3 candidate |
| R3-02 | Read-only actor creates a durable `running` journal before authorization fails | All three target edit permissions are checked before the journal write; denial leaves no run | Corrected; `materialize.test.ts` |
| R3-03 | Two processes pass the completed-run check and both write source/value state | Session-level PostgreSQL advisory lock covers the full operation for Organization + seed digest; a contender gets `CONFLICT` | Corrected; deterministic held-object-store concurrency case |
| R3-04 | A completed run is downgraded to `running` or `failed` through the journal seam | The upsert refuses updates when the stored state is `completed` | Corrected; `plan.test.ts` terminal-state case |
| R3-05 | Wrong or missing project identity is guessed or created | Stable id, Organization and reviewed project code must all match; blocked plans create no project | Existing `plan.test.ts` evidence |
| R3-06 | Capture silently omits a declared relation or another Project's child rows bleed in | Fourteen relations are declared; child rows are reached through Project-owned parents; counts and cross-Project isolation are asserted | Existing `archive.integration.test.ts` evidence |
| R3-07 | A row cap produces a partial archive that is treated as complete | Counts are taken separately from bounded rows; `truncated=true` blocks rebuild | Existing guard case |
| R3-08 | Object was removed, corrupted, or replaced after the ledger row was written | Guard reads the object and verifies SHA-256, archive digest, schema version, Organization, Project, truncation and per-relation counts | Corrected; tampered-object case |
| R3-09 | Capture is mistaken for disposal | Test proves source drafts remain after capture; schema intentionally has no disposal/deletion marker | Characterized; disposal remains #853 T2.3 |
| R3-10 | Ledger ownership is erased by parent deletion | Organization/Project FKs use `ON DELETE RESTRICT`; initiating User uses nullable history via `ON DELETE SET NULL` | Real-PostgreSQL schema assertion + generated schema |
| R3-11 | Journal loses run uniqueness | Primary key is `(organization_id, seed_digest)` and the status index is Organization-scoped | Real-PostgreSQL schema assertion + generated schema |
| R3-12 | Concurrent writes change the plane between relation reads | Final execution requires the target-host write-quiescence gate; no snapshot-consistency claim is made here | Open successor gate: #853 T3.3 |
| R3-13 | Object write succeeds but the ledger insert fails, leaving an orphan object | No preserved data is lost; object cleanup and final retention policy belong to the independently reviewed disposal operation | Residual operational risk: #853 T2.3 |
| R3-14 | Captured bytes cannot be restored with the database and durable stores at one boundary | Local capture tests are not recovery evidence | Open successor gate: #853 T3.3 |
| R3-15 | Applied migrations are rewritten to hide a defect | `0148` and `0149` remain byte-unchanged; corrections live in service/test/doc files | Enforced by candidate diff review |

## Schema and data-disposition evidence

- `docs/generated/db-schema.md` is regenerated from all 147 migrations through 0149. It records both tables,
  their primary/unique keys, checks, indexes, `RESTRICT` ownership FKs, and nullable User-history policy.
- `archive.integration.test.ts` runs on real PostgreSQL, verifies the two retention FKs, the User-history FK,
  the journal primary key, and the deliberate absence of `disposed_at`/`deleted_at`.
- The same suite proves all fourteen relation counts, stored rows, child scoping, cross-Project isolation,
  unchanged source rows, idempotent reuse, missing/truncated refusal, authorization, and object integrity.
- `plan.test.ts` proves fixed target identity, no implicit project creation, retry blocker visibility,
  completed-run idempotency, and terminal-state immutability.
- `materialize.test.ts` proves the three-project path, completed replay, fail-closed subject blockers, explicit
  JSON refusal, Organization binding, authorization-before-journal, and concurrent single-flight behavior.

## Review disposition

The implementing agent's self-review is **not** the required independent review. The candidate may enter seal only
after independent Standards and Spec reviewers examine the diff from its fixed base and this matrix. A review
finding must be repaired or explicitly retained as a successor gate; it must not be converted into an unqualified
PASS. Even after T0.3 closes, T2.3 and T3.3 remain blocking for #849 completion.
