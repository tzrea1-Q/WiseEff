# ADR-0027: Audit events commit in the same transaction as their domain write

- Status: Accepted
- Date: 2026-08-12

## Context

`createAuditEvent(db, …)` accepted any `Queryable`, so nothing expressed the product's non-negotiable "backend writes must enforce audit server-side" as an invariant. On 2026-08-12 the backend architecture review measured the consequence: 33 of 41 call sites wrote the audit event outside the transaction that carried the domain write. Project update/delete committed first and audited after (an audit-insert failure silently lost the evidence), project creation wrote no audit at all, structured-edit submission audited before a submit that could still fail, and bulk conflict arbitration ran one transaction per conflict with no compensation. Correctness relied on 41 separate acts of discipline.

## Decision

An audit event must commit in the same database transaction as the domain write it describes — both commit or both roll back.

The invariant is carried by a seam, not by convention: `withAuditedWrite(db, auth, context, fn)` runs the write and its audit evidence in one transaction (nested service transactions degrade to savepoints via the shared database client), and `writeAuditEventInTx` accepts only the branded `AuditTx` type, whose sole sources are `withAuditedWrite` itself and the explicit escape hatch `asAuditTx` for callers that orchestrate their own transaction. Correlation is mandatory at the seam (`requestId: string`), so a missing trace id is a compile error instead of a silently random `traceId`. Audit evidence is returned by the write callback (`{ result, audit }`), so it can reference created ids; `audit: null` states that nothing happened worth auditing.

The deprecated direct `createAuditEvent` path is retired call site by call site. `auditRatchet.test.ts` pins the remaining direct calls per file so the count can only decrease; when it reaches zero, `createAuditEvent` and the ratchet are deleted and the brand becomes the only way to write audit events.

## Consequences

- A failed audit insert now rolls back the domain write (and vice versa) at migrated call sites; audit evidence cannot be silently lost or orphaned.
- Batch operations that are one human decision (for example bulk conflict arbitration) wrap the batch in one transaction and fail whole, not half-applied.
- The brand is deliberately narrow: `Database.transaction` callbacks keep their ordinary type, so test fakes and existing services are untouched; only audit writes demand proof.
- Migration status is mechanically auditable via the ratchet allowlist rather than by re-reviewing call sites.
