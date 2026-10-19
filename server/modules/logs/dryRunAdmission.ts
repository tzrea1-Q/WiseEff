import { randomInt } from "node:crypto";
import { createDatabase, getRootPostgresPool, type Queryable, type Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";

export const LOG_DRY_RUN_INTERRUPTED = "服务重启，试运行已中断";
export const LOG_DRY_RUN_BUSY = "试运行繁忙，请稍后重试";
export const LOG_DRY_RUN_ADMISSION_LOCK = 7_154_230_001;
export const LOG_DRY_RUN_OWNER_LOCK_NAMESPACE = 7_141_230;

export function dryRunConcurrencyLimit(env: NodeJS.ProcessEnv = process.env) {
  const value = Number(env.LOG_DRY_RUN_MAX_CONCURRENT ?? 2);
  return Number.isInteger(value) && value >= 1 && value <= 4 ? value : 2;
}

/** A PostgreSQL session lock disappears when its API process/connection exits. */
export async function recoverInterruptedDryRuns(db: Queryable, organizationId?: string) {
  await db.query(`update log_skill_dry_runs run set status = 'failed', error = $1
    where run.status = 'processing' and ($2::text is null or run.organization_id = $2)
      and (run.deadline_at <= clock_timestamp() or not exists (
        select 1 from pg_locks owner where owner.locktype = 'advisory' and owner.granted
          and owner.pid = run.owner_pid and owner.classid = $3::oid
          and owner.objid = run.owner_key::oid and owner.objsubid = 2))`,
  [LOG_DRY_RUN_INTERRUPTED, organizationId ?? null, LOG_DRY_RUN_OWNER_LOCK_NAMESPACE]);
}

/** Keep one checked-out connection for each bounded run; never use an idle pooled PID as liveness. */
export async function acquireDryRunOwner(db: Database) {
  const pool = getRootPostgresPool(db);
  if (!pool) throw new ApiError("INTERNAL_ERROR", "Dry runs require a root PostgreSQL database.");
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
