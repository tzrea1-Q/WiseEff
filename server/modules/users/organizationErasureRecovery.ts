import { z } from "zod";
import { isRootDatabase, type Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { getAuthContext } from "../auth/repository";
import { allowOrganizationMaintenance } from "../auth/organizationLifecycle";
import type { UserInvocationContext } from "../auth/trustedInvocation";
import { requireUserInitiatedInvocation } from "../auth/trustedInvocationPolicy";
import { requirePlatformOrganizationManager } from "./platformOrganizations";
import { lockAdministratorMutation } from "./administratorContinuity";
import { revokePersonalAccess } from "./personalAccess";
import { retryOrganizationErasure } from "./organizationErasure";
import type { OrganizationErasureContext } from "./organizationErasureDomains";

const receiptSchema = z.object({
  id: z.string().min(1).max(200), targetOrganizationId: z.string().min(1).max(200), actorUserId: z.string().min(1).max(200),
  status: z.enum(["queued", "running", "failed", "deleted"]), counts: z.record(z.string(), z.number().int().nonnegative()),
  createdAt: z.string().datetime({ offset: true }), completedAt: z.string().datetime({ offset: true }).nullable()
}).strict();
export const organizationErasureRecoverySchema = z.object({
  version: z.literal(1), capturedAt: z.string().datetime({ offset: true }),
  checkpointStore: z.object({ kind: z.enum(["postgres", "memory"]), id: z.string().min(1) }).strict(),
  receipts: z.array(receiptSchema)
}).strict().superRefine((state, ctx) => {
  if (new Set(state.receipts.map(item => item.id)).size !== state.receipts.length || new Set(state.receipts.map(item => item.targetOrganizationId)).size !== state.receipts.length) {
    ctx.addIssue({ code: "custom", message: "Duplicate erasure recovery identity" });
  }
});

async function checkpointIdentity(db: Database, runtime: OrganizationErasureContext) {
  if (!runtime.agentCheckpointer) throw new Error("Actual checkpoint runtime is required for recovery");
  const store = await runtime.agentCheckpointer.inspectStore();
  if (store.kind === "memory") {
    if (store.entries.length || (await db.query("select 1 from agent_checkpoint_namespaces where store_kind='memory' limit 1")).rowCount) {
      throw new Error("Memory checkpoint ownership cannot establish a durable recovery boundary");
    }
    return { kind: store.kind, id: "verified-empty" };
  }
  return { kind: store.kind, id: store.id };
}

/** Recovery owner calls this after fencing writers, before replacing any store.
 * The protected recovery journal, not the older DB snapshot, owns this file. */
export async function captureOrganizationErasureState(db: Database, runtime: OrganizationErasureContext) {
  const checkpointStore = await checkpointIdentity(db, runtime);
  const receipts = (await db.query(`select id,target_organization_id as "targetOrganizationId",actor_user_id as "actorUserId",status,counts,
    to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt",
    to_char(completed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "completedAt"
    from organization_erasures order by target_organization_id`)).rows;
  return organizationErasureRecoverySchema.parse({ version: 1, capturedAt: new Date().toISOString(), checkpointStore, receipts });
}

/** Only the isolated restore owner uses this; ordinary API retry cannot reset a
 * completed receipt. Every applicable target is fenced before replaying any IO. */
export async function replayOrganizationErasureState(db: Database, caller: UserInvocationContext, input: unknown, runtime: OrganizationErasureContext) {
  if (!isRootDatabase(db)) throw new Error("Organization deletion recovery requires its durable pool root");
  requireUserInitiatedInvocation(caller);
  const state = organizationErasureRecoverySchema.parse(input);
  const actor = await getAuthContext(db, caller.principal.user.id); requirePlatformOrganizationManager(actor);
  if (state.receipts.some(item => item.targetOrganizationId === actor.organization.id)) throw new Error("Recovery requires a real platform actor outside every erased Organization");
  const actual = await checkpointIdentity(db, runtime);
  if (actual.kind !== state.checkpointStore.kind || actual.id !== state.checkpointStore.id) throw new Error("Checkpoint recovery physical store identity does not match");
  const pending: string[] = [];
  await db.transaction(async tx => {
    await lockAdministratorMutation(tx);
    await tx.query("select singleton from public_experience_registration where singleton=true for update");
    for (const receipt of state.receipts) {
      const org = (await tx.query<{ status: string }>("select status from organizations where id=$1 for update", [receipt.targetOrganizationId])).rows[0];
      const previous = (await tx.query<{ id: string; status: string }>("select id,status from organization_erasures where target_organization_id=$1 for update", [receipt.targetOrganizationId])).rows[0];
      if (previous && previous.id !== receipt.id) throw new Error("Restored erasure intent identity conflicts with the latest deletion state");
      if (!org) {
        if ((await tx.query(`select 1 from parameter_catalog.organization_deletion_object_references() where (org=$1 or store='unknown') and object_ref is not null
          union all select 1 from agent_checkpoint_namespaces where organization_id=$1
          union all select 1 from jobs where organization_id=$1 limit 1`, [receipt.targetOrganizationId])).rowCount) throw new Error("Restored orphaned ownership must be resolved before reopening");
        if (previous?.status === "deleted") continue;
      }
      await tx.query(`insert into organization_erasures(id,target_organization_id,actor_user_id,status,stage,counts,created_at,domain_progress)
        values($1,$2,$3,'failed',$4,$5,$6,'{}') on conflict(id) do update set status='failed',stage=excluded.stage,counts=excluded.counts,
        actor_user_id=excluded.actor_user_id,created_at=excluded.created_at,domain_progress='{}',attempts=0,error_code=null,lease_owner=null,lease_expires_at=null,completed_at=null`,
      [receipt.id, receipt.targetOrganizationId, receipt.actorUserId, org ? "domains" : "finalize", receipt.counts, receipt.createdAt]);
      if (org && org.status !== "deleting") {
        await allowOrganizationMaintenance(tx, caller, receipt.targetOrganizationId);
        const users = (await tx.query<{ id: string }>("select id from users where organization_id=$1 order by id for update", [receipt.targetOrganizationId])).rows;
        for (const user of users) await revokePersonalAccess(tx, receipt.targetOrganizationId, user.id);
        await tx.query("update users set is_active=false where organization_id=$1", [receipt.targetOrganizationId]);
        await tx.query("update public_experience_registration set enabled=false,organization_id=null where organization_id=$1", [receipt.targetOrganizationId]);
        await tx.query("update organizations set status='deleting',lifecycle_version=lifecycle_version+1 where id=$1", [receipt.targetOrganizationId]);
      }
      pending.push(receipt.id);
    }
  });
  for (const id of pending) {
    const receipt = await retryOrganizationErasure(db, caller, id, runtime);
    if (receipt.status !== "deleted") throw new ApiError("CONFLICT", "Restored Organization deletion replay is incomplete; access and queues must remain stopped.");
    const original = state.receipts.find(item => item.id === id)!;
    if (original.completedAt) await db.query("update organization_erasures set completed_at=$2 where id=$1 and status='deleted'", [id, original.completedAt]);
  }
  return { replayed: pending.length, applicable: state.receipts.length };
}
