import { randomUUID } from "node:crypto";

import type pg from "pg";

import { proposalAuditTargetId, type ProposalCommand } from "./command";
import type { ProposalFailure } from "./failures";
import type { ProposalResultSnapshot } from "./result";

type AuditClient = {
  query: pg.PoolClient["query"];
};

const asJson = (value: unknown): string => JSON.stringify(value);

const insertAudit = async (
  client: AuditClient,
  input: {
    readonly id?: string;
    readonly organizationId: string;
    readonly action: string;
    readonly severity: "info" | "warning";
    readonly targetId: string;
    readonly traceId: string;
    readonly metadata: Record<string, unknown>;
  },
): Promise<string> => {
  const id = input.id ?? `audit_${randomUUID()}`;
  await client.query(
    `insert into public.audit_events (
       id, organization_id, actor_type, app, kind, action, severity,
       target_type, target_id, metadata, trace_id
     ) values ($1,$2,'user','parameter-governance','definition-proposal',$3,$4,
              'definition-proposal',$5,$6::jsonb,$7)`,
    [
      id,
      input.organizationId,
      input.action,
      input.severity,
      input.targetId,
      asJson(input.metadata),
      input.traceId,
    ],
  );
  return id;
};

export const writeSuccessAudit = async (
  client: AuditClient,
  command: ProposalCommand,
  targetId: string,
  fingerprint: string,
  resultSnapshot: ProposalResultSnapshot,
  auditId?: string,
): Promise<string> =>
  insertAudit(client, {
    id: auditId,
    organizationId: command.organizationId,
    action: `proposal-${command.kind}`,
    severity: "info",
    targetId,
    traceId: fingerprint,
    metadata: {
      commandKind: command.kind,
      actorKind: command.context.actorKind,
      principalId: command.context.principalId,
      fingerprint,
      resultSnapshot,
    },
  });

export const writeRefusalAudit = async (
  pool: pg.Pool,
  command: ProposalCommand,
  error: ProposalFailure,
): Promise<void> => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await insertAudit(client, {
      organizationId: command.organizationId,
      action: `proposal-${command.kind}-refused`,
      severity: "warning",
      targetId: proposalAuditTargetId(command),
      traceId: command.idempotencyKey,
      metadata: {
        commandKind: command.kind,
        actorKind: command.context.actorKind,
        principalId: command.context.principalId,
        failureKind: error.kind,
      },
    });
    await client.query("commit");
  } catch (caught) {
    await client.query("rollback").catch(() => undefined);
    throw caught;
  } finally {
    client.release();
  }
};
