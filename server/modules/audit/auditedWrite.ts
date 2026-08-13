/**
 * Audited write seam (ADR-0027): an audit event must commit in the same transaction
 * as the domain write it describes. `AuditTx` is the proof-of-transaction brand —
 * `withAuditedWrite` is the normal way to obtain it, `asAuditTx` is the explicit
 * escape hatch for callers that already orchestrate their own transaction.
 *
 * The deprecated `createAuditEvent(db, …)` path (audit outside the write's
 * transaction) is being retired call site by call site; `auditRatchet.test.ts`
 * pins the remaining count so it can only go down.
 */
import { randomUUID } from "node:crypto";

import type { AuthContext } from "../auth/types";
import type { Database, Queryable } from "../../shared/database/client";
import { createAuditEvent } from "./repository";
import type { AuditActorType, AuditSeverity } from "./types";

declare const auditTxBrand: unique symbol;

/**
 * A Queryable proven (or explicitly asserted) to be the same transaction that
 * carries the domain write being audited.
 */
export type AuditTx = Queryable & { readonly [auditTxBrand]: true };

/**
 * Explicit escape hatch: the caller asserts `tx` is the transaction wrapping the
 * domain write being audited. Use only inside a `db.transaction(...)` callback;
 * prefer `withAuditedWrite`, which brands the transaction for you.
 */
export function asAuditTx(tx: Queryable): AuditTx {
  return tx as AuditTx;
}

/** Correlation is mandatory at this seam: a missing requestId is a compile error, not a random traceId. */
export type AuditedWriteContext = {
  requestId: string;
};

/**
 * What a write must state about itself. Actor and organization fields derive
 * from `auth`; id and traceId derive from the seam, so call sites stop
 * hand-copying them.
 */
export type AuditSpec = {
  app: string;
  kind: string;
  action: string;
  severity: AuditSeverity;
  projectId: string | null;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  /** Defaults to "user". */
  actorType?: AuditActorType;
  /** Defaults to a fresh UUID. */
  id?: string;
};

/** Write one audit event inside a proven transaction. */
export async function writeAuditEventInTx(
  tx: AuditTx,
  auth: AuthContext,
  context: AuditedWriteContext,
  spec: AuditSpec
): Promise<void> {
  await createAuditEvent(tx, {
    id: spec.id ?? randomUUID(),
    organizationId: auth.organization.id,
    projectId: spec.projectId,
    actorUserId: auth.user.id,
    actorType: spec.actorType ?? "user",
    app: spec.app,
    kind: spec.kind,
    action: spec.action,
    severity: spec.severity,
    targetType: spec.targetType,
    targetId: spec.targetId,
    metadata: spec.metadata,
    traceId: context.requestId
  });
}

async function writeStandaloneAuditEvent(
  db: Database,
  auth: AuthContext,
  context: AuditedWriteContext,
  spec: AuditSpec
): Promise<void> {
  await createAuditEvent(db, {
    id: spec.id ?? randomUUID(),
    organizationId: auth.organization.id,
    projectId: spec.projectId,
    actorUserId: auth.user.id,
    actorType: spec.actorType ?? "user",
    app: spec.app,
    kind: spec.kind,
    action: spec.action,
    severity: spec.severity,
    targetType: spec.targetType,
    targetId: spec.targetId,
    metadata: spec.metadata,
    traceId: context.requestId
  });
}

/**
 * Write refusal evidence that must SURVIVE the caller's rollback. A refusal audit
 * describes a deny-then-throw: there is no domain write to be atomic with, and if
 * the surrounding transaction rolls back, the evidence must remain. The spec is
 * therefore written through the POOL handle as its own auto-committed statement,
 * deliberately outside any transaction — the opposite contract from
 * `writeAuditEventInTx`. Pass the pool `Database`, never the enclosing tx.
 */
export async function writeRefusalAudit(
  db: Database,
  auth: AuthContext,
  context: AuditedWriteContext,
  spec: AuditSpec
): Promise<void> {
  await writeStandaloneAuditEvent(db, auth, context, spec);
}

/**
 * Write milestone evidence for a long-running, stepwise flow (a reload deploy, an
 * agent tool run): "this step was reached", recorded immediately on the pool handle
 * so it exists even if a later step fails, throws, or never completes. Milestones
 * mark intent/progress, not results — a step's RESULT commits with that step's
 * state write via `withAuditedWrite`/`writeAuditEventInTx` instead.
 */
export async function writeMilestoneAudit(
  db: Database,
  auth: AuthContext,
  context: AuditedWriteContext,
  spec: AuditSpec
): Promise<void> {
  await writeStandaloneAuditEvent(db, auth, context, spec);
}

export type AuditedWriteOutcome<T> = {
  result: T;
  /**
   * Audit evidence for what the write did — computed after the write, so it can
   * reference created ids. `null` states "nothing happened worth auditing"
   * (for example an update that matched no row).
   */
  audit: AuditSpec | AuditSpec[] | null;
};

/**
 * Run a domain write and its audit evidence in one transaction: both commit or
 * both roll back. Nested `tx.transaction(...)` calls inside `fn` degrade to
 * savepoints (shared/database client), so audited writes compose with services
 * that open their own transactions.
 */
export async function withAuditedWrite<T>(
  db: Database,
  auth: AuthContext,
  context: AuditedWriteContext,
  fn: (tx: Database & AuditTx) => Promise<AuditedWriteOutcome<T>>
): Promise<T> {
  return db.transaction(async (tx) => {
    const outcome = await fn(tx as Database & AuditTx);
    if (outcome.audit !== null) {
      const specs = Array.isArray(outcome.audit) ? outcome.audit : [outcome.audit];
      for (const spec of specs) {
        await writeAuditEventInTx(asAuditTx(tx), auth, context, spec);
      }
    }
    return outcome.result;
  });
}
