import { randomInt, randomUUID } from "node:crypto";
import { createDatabase, getRootPostgresPool, type Queryable, type Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { withAuditedWrite } from "../audit/auditedWrite";
import { createSystemInvocation } from "../auth/trustedInvocation";

export const LOG_DRY_RUN_INTERRUPTED = "服务重启，试运行已中断";
export const LOG_DRY_RUN_BUSY = "试运行繁忙，请稍后重试";
export const LOG_DRY_RUN_ADMISSION_LOCK = 7_154_230_001;
export const LOG_DRY_RUN_OWNER_LOCK_NAMESPACE = 7_141_230;
// Retain capacity until uncooperative providers settle, even after owner loss.
export const activeDryRunWork = new Map<string, string>();

export async function assertDryRunCapacity(db: Queryable, organizationId: string) {
  const active = (await db.query<{ total: number; organization: number }>(`select count(*)::int as total,
    count(*) filter (where organization_id = $1)::int as organization from (
      select owner_pid, owner_key, organization_id from log_skill_dry_runs
      union all select owner_pid, owner_key, organization_id from log_skill_analysis_case_runs
    ) run where exists (select 1 from pg_locks owner where owner.locktype = 'advisory' and owner.granted
      and owner.pid = run.owner_pid and owner.classid = $2::oid and owner.objid = run.owner_key::oid and owner.objsubid = 2)`,
  [organizationId, LOG_DRY_RUN_OWNER_LOCK_NAMESPACE])).rows[0];
  if (active.total >= dryRunConcurrencyLimit() || active.organization >= 1
    || activeDryRunWork.size >= dryRunConcurrencyLimit() || [...activeDryRunWork.values()].includes(organizationId)) {
    throw new ApiError("RATE_LIMITED", LOG_DRY_RUN_BUSY);
  }
}

export function dryRunConcurrencyLimit(env: NodeJS.ProcessEnv = process.env) {
  const value = Number(env.LOG_DRY_RUN_MAX_CONCURRENT ?? 2);
  return Number.isInteger(value) && value >= 1 && value <= 4 ? value : 2;
}

/** A PostgreSQL session lock disappears when its API process/connection exits. */
export async function recoverInterruptedDryRuns(db: Database, organizationId?: string) {
  await db.query(`update log_skill_dry_runs run set status = 'failed', error = $1
    where run.status = 'processing' and ($2::text is null or run.organization_id = $2)
      and exists(select 1 from public.organizations o where o.id=run.organization_id and o.status='active')
      and (run.deadline_at <= clock_timestamp() or not exists (
        select 1 from pg_locks owner where owner.locktype = 'advisory' and owner.granted
          and owner.pid = run.owner_pid and owner.classid = $3::oid
          and owner.objid = run.owner_key::oid and owner.objsubid = 2))`,
  [LOG_DRY_RUN_INTERRUPTED, organizationId ?? null, LOG_DRY_RUN_OWNER_LOCK_NAMESPACE]);
  await withAuditedWrite(db, createSystemInvocation({ kind: "service", name: "log-analysis-case-recovery" }), { requestId: randomUUID() }, async (tx) => {
  const recovered = await tx.query<{ id: string; organization_id: string; skill_id: string }>(`update log_skill_analysis_case_runs run set status = 'failed', error = $1
    where run.status = 'processing' and ($2::text is null or run.organization_id = $2)
      and exists(select 1 from public.organizations o where o.id=run.organization_id and o.status='active')
      and (run.deadline_at <= clock_timestamp() or not exists (
        select 1 from pg_locks owner where owner.locktype = 'advisory' and owner.granted
          and owner.pid = run.owner_pid and owner.classid = $3::oid
          and owner.objid = run.owner_key::oid and owner.objsubid = 2)) returning id, organization_id, skill_id`,
  [LOG_DRY_RUN_INTERRUPTED, organizationId ?? null, LOG_DRY_RUN_OWNER_LOCK_NAMESPACE]);
  return { result: null, audit: recovered.rows.map((row) => ({ organizationId: row.organization_id,
    app: "log-analysis", kind: "log-analysis-case-run-interrupted", action: "log-analysis-case-run-interrupted", severity: "Medium" as const,
    projectId: null, targetType: "log-skill", targetId: row.skill_id, metadata: { runId: row.id } })) };
  });
}

/** Keep one checked-out connection for each bounded run; never use an idle pooled PID as liveness. */
export async function acquireDryRunOwner(db: Database) {
  const pool = getRootPostgresPool(db);
  if (!pool) throw new ApiError("INTERNAL_ERROR", "试运行需要根 PostgreSQL 数据库连接。");
  const client = await pool.connect();
  const controller = new AbortController();
  let broken = false, closed = false;
  const onError = (error: Error) => { broken = true; controller.abort(error); };
  client.on("error", onError);
  const key = randomInt(1, 2_147_483_647);
  const close = async () => {
    if (closed) return;
    closed = true;
    try { if (!broken) await client.query("select pg_advisory_unlock($1, $2)", [LOG_DRY_RUN_OWNER_LOCK_NAMESPACE, key]); }
    catch { broken = true; }
    client.removeListener("error", onError);
    client.release(broken);
  };
  try {
    const result = await client.query<{ pid: number; locked: boolean }>(
      "select pg_backend_pid() as pid, pg_try_advisory_lock($1, $2) as locked", [LOG_DRY_RUN_OWNER_LOCK_NAMESPACE, key]);
    if (!result.rows[0].locked) throw new ApiError("RATE_LIMITED", LOG_DRY_RUN_BUSY);
    return { pid: result.rows[0].pid, key, signal: controller.signal, close,
      db: createDatabase({ query: client.query.bind(client) }) };
  } catch (error) { await close(); throw error; }
}
