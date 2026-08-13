# ADR-0027: Audit events commit in the same transaction as their domain write

- Status: Accepted
- Date: 2026-08-12
- Amended: 2026-08-13 (refusal audits)

## Context

`createAuditEvent(db, …)` accepted any `Queryable`, so nothing expressed the product's non-negotiable "backend writes must enforce audit server-side" as an invariant. On 2026-08-12 the backend architecture review measured the consequence: 33 of 41 call sites wrote the audit event outside the transaction that carried the domain write. Project update/delete committed first and audited after (an audit-insert failure silently lost the evidence), project creation wrote no audit at all, structured-edit submission audited before a submit that could still fail, and bulk conflict arbitration ran one transaction per conflict with no compensation. Correctness relied on 41 separate acts of discipline.

## Decision

An audit event must commit in the same database transaction as the domain write it describes — both commit or both roll back.

The invariant is carried by a seam, not by convention: `withAuditedWrite(db, auth, context, fn)` runs the write and its audit evidence in one transaction (nested service transactions degrade to savepoints via the shared database client), and `writeAuditEventInTx` accepts only the branded `AuditTx` type, whose sole sources are `withAuditedWrite` itself and the explicit escape hatch `asAuditTx` for callers that orchestrate their own transaction. Correlation is mandatory at the seam (`requestId: string`), so a missing trace id is a compile error instead of a silently random `traceId`. Audit evidence is returned by the write callback (`{ result, audit }`), so it can reference created ids; `audit: null` states that nothing happened worth auditing.

The deprecated direct `createAuditEvent` path is retired call site by call site. `auditRatchet.test.ts` pins the remaining direct calls per file so the count can only decrease; when it reaches zero, `createAuditEvent` and the ratchet are deleted and the brand becomes the only way to write audit events.

## Amendment (2026-08-13): refusal audits are the deliberate inverse

A **refusal audit** describes a deny-then-throw (agent blocked on a critical sensitive
node, agent refused from reload mutating paths). It has no domain write to be atomic
with, and the throw usually rolls the caller's transaction back — so the evidence must
be written **outside** that transaction or the rollback erases it. The migration found
this happening in production paths: the merge transaction was erasing sensitive-node
deny audits.

`writeRefusalAudit(db, auth, context, spec)` carries this inverse contract: it takes the
pool `Database` (never the enclosing tx) and writes the deny evidence as its own
auto-committed statement. Guards that can run inside a caller's transaction
(`assertSensitiveNodeWriteAllowed`) accept a `refusalDb` pool handle from the caller;
guards that by design run before any transaction (`assertDtsReloadHumanActor`,
`assertSensitiveReloadBatchAllowed`) take `Database` directly so the type states the
requirement.

Stepwise flows (the reload deploy state machine, the agent tool/approval state machine)
add a third shape: **milestone evidence** (`writeMilestoneAudit`, same standalone-write
mechanics as refusals). A milestone marks "this step was reached" — reload started,
deploy started — and is recorded immediately on the pool handle so it exists even if a
later step fails, throws, or never completes. A step's **result** (blocked/validated,
the deploy terminal, tool succeeded/failed) is not a milestone: it commits with that
step's state write.

An audit event is therefore exactly one of: **audited write evidence** (commits with the
write, `writeAuditEventInTx`/`withAuditedWrite`), **refusal evidence** (survives the
rollback, `writeRefusalAudit`), or **milestone evidence** (recorded before the outcome
exists, `writeMilestoneAudit`). Which one is a semantic decision made at the call site,
never a default.

## Consequences

- A failed audit insert now rolls back the domain write (and vice versa) at migrated call sites; audit evidence cannot be silently lost or orphaned.
- Batch operations that are one human decision (for example bulk conflict arbitration) wrap the batch in one transaction and fail whole, not half-applied.
- The brand is deliberately narrow: `Database.transaction` callbacks keep their ordinary type, so test fakes and existing services are untouched; only audit writes demand proof.
- Migration status is mechanically auditable via the ratchet allowlist rather than by re-reviewing call sites.
- Refusal evidence survives the rollback its own throw causes; a denied agent write on a critical sensitive node is provable even though the merge transaction rolled back.
