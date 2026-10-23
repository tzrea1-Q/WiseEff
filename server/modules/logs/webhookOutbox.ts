import { randomUUID } from "node:crypto";
import type { Queryable } from "../../shared/database/client";
import { buildLogResultWebhookPayload, type LogAnalysisResultWebhookInput } from "./webhookPayload";

export type LogWebhookOutboxRow = {
  id: string;
  organization_id: string;
  log_domain_id: string;
  log_record_id: string;
  run_id: string;
  payload: ReturnType<typeof buildLogResultWebhookPayload>;
  attempts: number;
  lease_token: string;
};

export async function enqueueLogWebhook(db: Queryable, input: LogAnalysisResultWebhookInput): Promise<string | null> {
  const payload = buildLogResultWebhookPayload(input);
  const id = payload.eventId;
  const result = await db.query<{ id: string }>(
    `insert into log_webhook_outbox (id, organization_id, log_domain_id, log_record_id, run_id, payload)
     select $1, $2, id, $4, $5, $6::jsonb from log_domains
     where organization_id = $2 and id = $3 and webhook_enabled
       and nullif(webhook_url, '') is not null and nullif(webhook_secret, '') is not null
     on conflict (organization_id, run_id) do nothing returning id`,
    [id, input.organizationId, input.logDomainId, input.logId, input.runId, JSON.stringify(payload)]
  );
  return result.rows[0]?.id ?? null;
}

/** Runs inside the terminal-state transaction, independent of the queue transport. */
export async function enqueueTerminalLogWebhook(db: Queryable, input: { organizationId: string; runId: string }): Promise<void> {
  const result = await db.query<{
    log_domain_id: string; log_record_id: string; file_name: string; status: "complete" | "failed";
    completed_at: Date | string; error_message: string | null; related_parameter_snapshot: unknown;
    analysis_source: string | null; degraded_reason: string | null; severity: string | null;
    confidence: number | null; conclusion: string | null;
    skill_revision_id: string | null; skill_revision_number: number | null; skill_key: string;
  }>(
    `select r.log_domain_id, a.log_record_id, r.file_name, a.status, a.completed_at,
       a.error_message, a.related_parameter_snapshot, p.analysis_source, p.degraded_reason, p.severity, p.confidence, p.conclusion,
       a.skill_revision_id, s.revision_number as skill_revision_number, d.skill_key
     from log_analysis_runs a
     join log_records r on r.id = a.log_record_id and r.organization_id = a.organization_id
     join log_domains d on d.id = r.log_domain_id and d.organization_id = a.organization_id
     left join log_analysis_reports p on p.run_id = a.id and p.organization_id = a.organization_id
     left join log_skill_revisions s on s.id = a.skill_revision_id and s.organization_id = a.organization_id
     where a.organization_id = $1 and a.id = $2 and r.log_domain_id is not null
       and a.status in ('complete', 'failed')`,
    [input.organizationId, input.runId]
  );
  const row = result.rows[0];
  if (!row) return;
  await enqueueLogWebhook(db, {
    organizationId: input.organizationId, runId: input.runId, logDomainId: row.log_domain_id,
    logId: row.log_record_id, fileName: row.file_name, status: row.status,
    skillRevisionId: row.skill_revision_id, skillRevisionNumber: row.skill_revision_number,
    skillKey: row.skill_key,
    occurredAt: new Date(row.completed_at).toISOString(),
    analysisSource: row.analysis_source ?? undefined, degradedReason: row.degraded_reason ?? undefined,
    severity: row.severity ?? undefined, confidence: row.confidence ?? undefined,
    conclusion: row.related_parameter_snapshot ? undefined : (row.status === "failed" ? row.error_message : row.conclusion) ?? undefined
  });
}

export async function claimLogWebhook(db: Queryable, leaseTtlMs: number, id?: string): Promise<LogWebhookOutboxRow | null> {
  const result = await db.query<LogWebhookOutboxRow>(
    `update log_webhook_outbox set status = 'processing', lease_token = $1,
       lease_expires_at = now() + ($2 * interval '1 millisecond'), updated_at = now()
     where id = (
       select id from log_webhook_outbox
       where (($3::text is null) or id = $3)
         and exists(select 1 from public.organizations o where o.id=log_webhook_outbox.organization_id and o.status='active')
         and ((status in ('pending', 'retry') and next_attempt_at <= now())
           or (status = 'processing' and lease_expires_at <= now()))
       order by next_attempt_at, id for update skip locked limit 1
     ) returning *`,
    [randomUUID(), leaseTtlMs, id ?? null]
  );
  return result.rows[0] ?? null;
}
