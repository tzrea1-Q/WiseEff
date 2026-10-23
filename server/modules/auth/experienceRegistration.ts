import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { writePlatformAuditEvent } from "../audit/repository";
import { projectTrustedInvocationForAudit } from "../audit/trustedAudit";
import { requirePlatformOrganizationManager } from "../users/platformOrganizations";
import { EVALUATION_ORGANIZATION_ID, isRetiredDepartmentOrganizationId, isRetiredDepartmentOrganizationName } from "./evaluationOrganization";
import type { UserInvocationContext } from "./trustedInvocation";
import { requireUserInitiatedInvocation } from "./trustedInvocationPolicy";

export type ExperienceRegistrationDefaults = { selfRegisterEnabled?: boolean; registrationOrganizationId?: string };
export type ExperienceRegistrationSettings = { enabled: boolean; organizationId: string | null; organizationName: string | null; source: "platform" | "environment" | "default"; available: boolean };

// The shared admission boundary is also used inside registration's transaction.
export async function requireExperienceRegistrationOrganization(db: Queryable, organizationId: string | null, lock = false) {
  if (!organizationId) throw new ApiError("FORBIDDEN", "公开体验注册未配置有效的目标组织，请联系平台管理员。");
  const row = (await db.query<{ id: string; name: string }>(`select id, name from organizations where id = $1${lock ? " for share" : ""}`, [organizationId])).rows[0];
  if (!row || isRetiredDepartmentOrganizationId(row.id) || isRetiredDepartmentOrganizationName(row.name)) {
    throw new ApiError("FORBIDDEN", "体验目标组织当前不能接纳注册，请联系平台管理员。");
  }
  return row;
}

export async function getExperienceRegistrationSettings(db: Queryable, defaults: ExperienceRegistrationDefaults = {}, lock = false): Promise<ExperienceRegistrationSettings> {
  const row = (await db.query<{ enabled: boolean | null; organization_id: string | null }>(`select enabled, organization_id from public_experience_registration where singleton=true${lock ? " for share" : ""}`)).rows[0];
  if (!row) throw new ApiError("INTERNAL_ERROR", "体验注册配置暂不可用，请重试。");
  const saved = row.enabled !== null;
  const enabled = row.enabled ?? defaults.selfRegisterEnabled === true;
  const organizationId = saved ? row.organization_id : defaults.registrationOrganizationId ?? (defaults.selfRegisterEnabled === true ? EVALUATION_ORGANIZATION_ID : null);
  let organizationName: string | null = null;
  try { organizationName = (await requireExperienceRegistrationOrganization(db, organizationId, lock)).name; }
  catch (error) { if (!(error instanceof ApiError) || error.code !== "FORBIDDEN") throw error; }
  return { enabled, organizationId, organizationName, source: saved ? "platform" : defaults.selfRegisterEnabled !== undefined ? "environment" : "default", available: organizationName !== null };
}

export async function updateExperienceRegistrationSettings(db: Database, invocation: UserInvocationContext, input: { enabled: boolean; organizationId: string | null }, requestId: string, defaults: ExperienceRegistrationDefaults) {
  requireUserInitiatedInvocation(invocation);
  requirePlatformOrganizationManager(invocation.principal);
  return db.transaction(async (tx) => {
    await tx.query("select singleton from public_experience_registration where singleton=true for update");
    if (input.enabled || input.organizationId !== null) await requireExperienceRegistrationOrganization(tx, input.organizationId, true);
    await tx.query("update public_experience_registration set enabled=$1, organization_id=$2 where singleton=true", [input.enabled, input.organizationId]);
    const actor = projectTrustedInvocationForAudit(invocation);
    await writePlatformAuditEvent(tx, { app: "platform", kind: "experience-registration", action: "update", severity: "High", projectId: null,
      targetType: "experience-registration", targetId: "platform", actorUserId: actor.actorUserId, actorType: actor.actorType, traceId: requestId,
      affectedOrganizationIds: [], metadata: { ...actor.metadata, ...input } });
    return getExperienceRegistrationSettings(tx, defaults);
  });
}
