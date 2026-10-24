import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { getAuthContext } from "../auth/repository";
import { allowOrganizationMaintenance } from "../auth/organizationLifecycle";
import type { UserInvocationContext } from "../auth/trustedInvocation";
import { requireUserInitiatedInvocation } from "../auth/trustedInvocationPolicy";
import type { organizationErasureSchema, startOrganizationErasureSchema } from "../contracts/dtoSchemas/organizationDeletion";
import { listUsableAdministratorIds, lockAdministratorMutation } from "./administratorContinuity";
import { admitOrganizationDeletion, previewOrganizationDeletion } from "./organizationDeletion";
import { organizationErasureDomains, type OrganizationErasureContext } from "./organizationErasureDomains";
import { requirePlatformOrganizationManager } from "./platformOrganizations";
import { revokePersonalAccess } from "./personalAccess";

type Erasure = z.infer<typeof organizationErasureSchema>;
const projection = `id,target_organization_id as "targetOrganizationId",actor_user_id as "actorUserId",status,stage,counts,attempts,
  error_code as "errorCode",created_at::text as "createdAt",updated_at::text as "updatedAt",completed_at::text as "completedAt"`;
const managementCategories = new Set(["accounts", "teams-invitations", "audit", "platform-catalog"]);

async function authorize(db: Database, caller: UserInvocationContext) {
  requireUserInitiatedInvocation(caller);
  requirePlatformOrganizationManager(await getAuthContext(db, caller.principal.user.id));
}
export async function listOrganizationErasures(db: Database, caller: UserInvocationContext) {
  await authorize(db, caller);
  return (await db.query<Erasure>(`select ${projection} from organization_erasures order by created_at desc,id`)).rows;
}
export async function readOrganizationErasure(db: Database, caller: UserInvocationContext, id: string) {
  await authorize(db, caller);
  const result = (await db.query<Erasure>(`select ${projection} from organization_erasures where id=$1`, [id])).rows[0];
  if (!result) throw new ApiError("NOT_FOUND", "Organization cleanup was not found.");
  return result;
}

export async function startOrganizationErasure(db: Database, caller: UserInvocationContext, organizationId: string,
  input: z.infer<typeof startOrganizationErasureSchema>, context: OrganizationErasureContext = {}) {
  if (input.confirmationOrganizationId !== organizationId) throw new ApiError("VALIDATION_FAILED", "请输入待删除组织的完整编号。");
  const id = randomUUID();
  await db.transaction(async tx => {
    const preview = await admitOrganizationDeletion(tx, caller, organizationId, input.stateDigest, context);
    if (!["active", "suspended"].includes(preview.status)) throw new ApiError("CONFLICT", "组织已经进入清理，请从清理记录继续。");
    const supported = new Set([...managementCategories, ...organizationErasureDomains.flatMap(adapter => adapter.inventoryCategories)]);
    const unsupported = preview.inventory.filter(item => item.count && !supported.has(item.category));
    // NULL-organization facts may belong to global erasure proofs and retained
    // foreign source pins even when their operator Home is outside this target.
    // Their finite custody/compaction adapter must be installed before admission.
    const globalFacts = (await tx.query<{ count: number }>(`select count(*)::int count from audit_events where organization_id is null
      and ((target_type='organization' and target_id=$1) or metadata->>'operatingOrganizationId'=$1)`, [organizationId])).rows[0]!.count;
    if (globalFacts && !supported.has("shared-provenance")) unsupported.push({ key: "platform-global-audit-provenance", category: "shared-provenance", count: globalFacts });
    if (unsupported.length || (!organizationErasureDomains.length && (preview.storage.exclusiveObjects || preview.storage.sharedObjects))) {
      throw new ApiError("CONFLICT", "此组织仍关联尚不能完整清理的业务资产或共享来源记录，暂不能执行彻底删除。", { code: "organization-erasure-unsupported", inventory: unsupported });
    }
    const counts = preview.inventory.filter(item => !["shared-references", "platform-catalog"].includes(item.category))
      .reduce<Record<string, number>>((sum, item) => { sum[item.category] = (sum[item.category] ?? 0) + item.count; return sum; }, {});
    await tx.query("insert into organization_erasures(id,target_organization_id,actor_user_id,status,stage,counts) values($1,$2,$3,'queued','domains',$4)", [id, organizationId, caller.principal.user.id, counts]);
    await allowOrganizationMaintenance(tx, caller, organizationId);
    // Admission retains global administrator -> experience -> Organization locks.
    // Disable/revoke before deleting fence; no target platform login can then be
    // considered an outside survivor by a concurrent administrator mutation.
    const members = (await tx.query<{ id: string }>("select id from users where organization_id=$1 order by id for update", [organizationId])).rows;
    for (const member of members) await revokePersonalAccess(tx, organizationId, member.id);
    await tx.query("update users set is_active=false where organization_id=$1", [organizationId]);
    await tx.query("update public_experience_registration set enabled=false,organization_id=null where organization_id=$1", [organizationId]);
    await tx.query("update organizations set status='deleting',lifecycle_version=lifecycle_version+1 where id=$1", [organizationId]);
  });
  return retryOrganizationErasure(db, caller, id, context);
}

/** Same durable row-lock + expired-lease pattern as jobs/repository. A retry uses
 * its admitted intent, never the preview digest invalidated by its own cleanup. */
export async function retryOrganizationErasure(db: Database, caller: UserInvocationContext, id: string, context: OrganizationErasureContext = {}) {
  const leaseOwner = randomUUID();
  const claimed = await db.transaction(async tx => {
    await lockAdministratorMutation(tx); await authorize(tx, caller);
    const intent = (await tx.query<Erasure>(`select ${projection} from organization_erasures where id=$1 for update`, [id])).rows[0];
    if (!intent) throw new ApiError("NOT_FOUND", "Organization cleanup was not found.");
    if (intent.status === "deleted") return null;
    if (intent.status === "running" && (await tx.query("select id from organization_erasures where id=$1 and lease_expires_at>clock_timestamp()", [id])).rowCount) throw new ApiError("CONFLICT", "组织清理正在执行，请刷新进度。");
    const usable = await listUsableAdministratorIds(tx, null, "platform-admin", context);
    const outside = await tx.query("select id from users where id=any($1::text[]) and organization_id<>$2", [usable, intent.targetOrganizationId]);
    if (!outside.rowCount) throw new ApiError("CONFLICT", "At least one usable platform super administrator must remain.");
    await tx.query("update organization_erasures set status='running',attempts=attempts+1,error_code=null,lease_owner=$2,lease_expires_at=clock_timestamp()+interval '1 minute',updated_at=clock_timestamp() where id=$1", [id, leaseOwner]);
    return intent;
  });
  if (!claimed) return readOrganizationErasure(db, caller, id);
  try {
    if (claimed.stage === "domains") {
      for (const adapter of organizationErasureDomains) await adapter.erase(db,
        { id, targetOrganizationId: claimed.targetOrganizationId, actorUserId: caller.principal.user.id, leaseOwner },
        { ...context, renewLease: () => db.transaction(async tx => {
          await ownLease(tx, id, leaseOwner);
          await tx.query("update organization_erasures set lease_expires_at=clock_timestamp()+interval '1 minute' where id=$1 and lease_owner=$2", [id, leaseOwner]);
        }) });
      await advance(db, id, leaseOwner, "management");
    }
    if (claimed.stage !== "finalize") {
      // Recheck actual domain/runtime ownership after adapters, rather than
      // trusting their success return or the intent's now-stale initial digest.
      const remaining = await previewOrganizationDeletion(db, caller, claimed.targetOrganizationId, context);
      if (remaining.inventory.some(item => item.count && !managementCategories.has(item.category)) || remaining.storage.exclusiveObjects || remaining.storage.sharedObjects) {
        throw new ApiError("CONFLICT", "业务资产或未核实归属尚未清理完成。");
      }
      await db.transaction(async tx => {
        await ownLease(tx, id, leaseOwner);
        await tx.query("select set_config('wiseeff.organization_erasure_id',$1,true),set_config('wiseeff.organization_erasure_lease',$2,true)", [id, leaseOwner]);
        const org = claimed.targetOrganizationId;
        // Explicit management cleanup; domain adapters have already stopped all
        // producers and captured any account-linked ownership before this point.
        await tx.query("delete from auth_sessions where organization_id=$1", [org]);
        await tx.query("delete from organization_invitations where organization_id=$1", [org]);
        await tx.query("delete from organization_team_members where organization_id=$1", [org]);
        await tx.query("delete from organization_teams where organization_id=$1", [org]);
        await tx.query("delete from local_registration_role_requests where organization_id=$1", [org]);
        await tx.query("delete from user_role_bindings where organization_id=$1", [org]);
        await tx.query("delete from audit_events where organization_id=$1", [org]);
        const members = (await tx.query<{ id: string }>("select id from users where organization_id=$1 order by id for update", [org])).rows;
        await tx.query("select set_config('wiseeff.organization_erasure_users',$1,true)", [JSON.stringify(members.map(member => member.id))]);
        await tx.query("delete from users where organization_id=$1", [org]);
        await tx.query("delete from organizations where id=$1", [org]);
        await tx.query("update organization_erasures set stage='finalize',updated_at=clock_timestamp() where id=$1", [id]);
      });
    }
    await db.transaction(async tx => {
      await ownLease(tx, id, leaseOwner);
      if ((await tx.query("select id from organizations where id=$1", [claimed.targetOrganizationId])).rowCount) throw new Error("Organization remains");
      await tx.query("update organization_erasures set status='deleted',stage='complete',lease_owner=null,lease_expires_at=null,error_code=null,completed_at=clock_timestamp(),updated_at=clock_timestamp() where id=$1", [id]);
    });
  } catch {
    // Do not persist database errors, file keys or tenant business payloads.
    await db.query("update organization_erasures set status='failed',error_code='cleanup-failed',lease_owner=null,lease_expires_at=null,updated_at=clock_timestamp() where id=$1 and lease_owner=$2", [id, leaseOwner]);
  }
  return readOrganizationErasure(db, caller, id);
}

async function ownLease(tx: Database, id: string, leaseOwner: string) {
  const result = await tx.query(`with locked as materialized (select id,status,lease_owner,lease_expires_at from organization_erasures where id=$1 for update)
    select id from locked where status='running' and lease_owner=$2 and lease_expires_at>clock_timestamp()`, [id, leaseOwner]);
  if (!result.rowCount) throw new ApiError("CONFLICT", "组织清理的执行租约已失效，请重试。");
}
async function advance(db: Database, id: string, leaseOwner: string, stage: "management") {
  await db.transaction(async tx => {
    await ownLease(tx, id, leaseOwner);
    await tx.query("update organization_erasures set stage=$3,updated_at=clock_timestamp() where id=$1 and lease_owner=$2", [id, leaseOwner, stage]);
  });
}
