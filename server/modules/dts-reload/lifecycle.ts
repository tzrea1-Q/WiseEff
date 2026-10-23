import { withWriteTransactions, type Database, type Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { requireActiveOrganization } from "../auth/organizationLifecycle";

export async function requireCurrentReloadLifecycle(db: Queryable, organizationId: string, runId: string) {
  await requireActiveOrganization(db, organizationId, true);
  const current = await db.query(`select r.id from public.dts_reload_runs r join public.organizations o on o.id=r.organization_id
    where r.id=$1 and r.organization_id=$2 and r.organization_lifecycle_version=o.lifecycle_version`, [runId, organizationId]);
  if (!current.rowCount) throw new ApiError("CONFLICT", "组织停用后，原设备部署意图已失效，请重新创建并确认部署。", { reason: "organization-lifecycle-changed", runId });
}

/** Result bookkeeping is restricted to the already-selected run/device; new RPCs have their own gate. */
export function reloadCompletionDatabase(db: Database, input: { runId: string; organizationId: string; deviceId: string; wasClaimed: () => boolean }): Database {
  async function transaction<T>(write: (tx: Database) => Promise<T>): Promise<T> {
    return db.transaction(async tx => {
      // Before the real compare-and-set claim, every write still uses normal admission.
      if (input.wasClaimed()) {
        const run = await tx.query("select id from public.dts_reload_runs where id=$1 and organization_id=$2 and deploy_claimed_at is not null", [input.runId, input.organizationId]);
        if (!run.rowCount) throw new ApiError("CONFLICT", "Reload execution is no longer admitted.");
        await tx.query("select set_config('wiseeff.lifecycle_completion',$1,true)", [JSON.stringify({ kind: "reload-device", organizationId: input.organizationId, runId: input.runId, deviceId: input.deviceId })]);
      }
      return write(tx);
    });
  }
  return withWriteTransactions(db, transaction);
}
