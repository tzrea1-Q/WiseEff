import { randomBytes, randomUUID } from "node:crypto";
import type { z } from "zod";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { AuthContext } from "../auth/types";
import { hashIntegrationSecret } from "../auth/integrationCredentialResolver";
import { assertTrustedInvocationMatchesScope, type TrustedInvocationContext } from "../auth/trustedInvocation";
import { requireUserInitiatedInvocation } from "../auth/trustedInvocationPolicy";
import { withAuditedWrite, type AuditedWriteContext, type AuditSpec } from "../audit/auditedWrite";
import { requireLogAdminDomains } from "./policy";
import { lockSkill } from "./skillsRepository";
import { issueLogIntegrationCredentialBodySchema } from "./schemas";
export { issueLogIntegrationCredentialBodySchema } from "./schemas";

type CredentialRow = {
  id: string; organization_id: string; name: string; skill_id: string | null; skill_name: string | null;
  status: "active" | "revoked"; created_by: string | null; created_at: Date | string;
  rotated_at: Date | string | null; revoked_at: Date | string | null; last_used_at: Date | string | null;
};

const iso = (value: Date | string | null) => value === null ? null : new Date(value).toISOString();
function dto(row: CredentialRow) {
  return { id: row.id, organizationId: row.organization_id, name: row.name, skillId: row.skill_id,
    skillName: row.skill_name, status: row.status, createdBy: row.created_by, createdAt: iso(row.created_at)!,
    rotatedAt: iso(row.rotated_at), revokedAt: iso(row.revoked_at), lastUsedAt: iso(row.last_used_at) };
}

async function readCredential(db: Queryable, organizationId: string, id: string) {
  const row = (await db.query<CredentialRow>(`select c.id,c.organization_id,c.name,c.skill_id,s.name as skill_name,
    c.status,c.created_by,c.created_at,c.rotated_at,c.revoked_at,c.last_used_at
    from log_integration_credentials c left join log_domains s on s.id=c.skill_id and s.organization_id=c.organization_id
    where c.organization_id=$1 and c.id=$2`, [organizationId, id])).rows[0];
  if (!row) throw new ApiError("NOT_FOUND", "未找到集成凭据。");
  return dto(row);
}

function credentialAudit(item: { id: string; name: string; skillId: string | null; skillName: string | null }, action: "issue" | "rotate" | "revoke"): AuditSpec {
  const actions = { issue: "签发集成凭据", rotate: "轮换集成凭据", revoke: "撤销集成凭据" };
  return { app: "log-analysis", kind: `log-integration-credential-${action}`, action: actions[action], severity: "Medium",
    projectId: null, targetType: "log-integration-credential", targetId: item.id,
    metadata: { name: item.name, skillId: item.skillId, skillName: item.skillName } };
}

export async function listIntegrationCredentials(db: Queryable, auth: AuthContext, invocation: TrustedInvocationContext, organizationId = auth.organization.id) {
  requireUserInitiatedInvocation(invocation);
  assertTrustedInvocationMatchesScope(auth, invocation, organizationId, "List integration credentials");
  requireLogAdminDomains(auth);
  const rows = await db.query<CredentialRow>(`select c.id,c.organization_id,c.name,c.skill_id,s.name as skill_name,
    c.status,c.created_by,c.created_at,c.rotated_at,c.revoked_at,c.last_used_at
    from log_integration_credentials c left join log_domains s on s.id=c.skill_id and s.organization_id=c.organization_id
    where c.organization_id=$1 order by c.created_at desc,c.id`, [organizationId]);
  return { items: rows.rows.map(dto) };
}

export async function issueIntegrationCredential(db: Database, auth: AuthContext,
  input: z.infer<typeof issueLogIntegrationCredentialBodySchema>, invocation: TrustedInvocationContext, context: AuditedWriteContext, organizationId = auth.organization.id) {
  requireUserInitiatedInvocation(invocation);
  assertTrustedInvocationMatchesScope(auth, invocation, organizationId, "Issue integration credential");
  requireLogAdminDomains(auth);
  const id = randomUUID();
  const secret = randomBytes(32).toString("base64url");
  return withAuditedWrite(db, invocation, context, async (tx) => {
    if (input.skillId) {
      // Same row lock as archive/key edits: issuance cannot race a skill archive.
      await lockSkill(tx, organizationId, input.skillId);
      const row = (await tx.query<{ status: string }>("select status from log_domains where organization_id=$1 and id=$2", [organizationId, input.skillId])).rows[0];
      if (!row || row.status !== "active") throw new ApiError("NOT_FOUND", "未找到可用的分析技能。");
    }
    await tx.query(`insert into log_integration_credentials (id,organization_id,name,skill_id,secret_hash,created_by)
      values ($1,$2,$3,$4,$5,$6)`, [id, organizationId, input.name, input.skillId ?? null, hashIntegrationSecret(secret), auth.user.id]);
    const item = await readCredential(tx, organizationId, id);
    return { result: { item, token: `wie_${id}_${secret}` }, audit: credentialAudit(item, "issue") };
  });
}

export async function rotateIntegrationCredential(db: Database, auth: AuthContext, id: string, invocation: TrustedInvocationContext, context: AuditedWriteContext, organizationId = auth.organization.id) {
  requireUserInitiatedInvocation(invocation);
  assertTrustedInvocationMatchesScope(auth, invocation, organizationId, "Rotate integration credential");
  requireLogAdminDomains(auth);
  const secret = randomBytes(32).toString("base64url");
  return withAuditedWrite(db, invocation, context, async (tx) => {
    const updated = await tx.query(`update log_integration_credentials set secret_hash=$3,rotated_at=clock_timestamp()
      where organization_id=$1 and id=$2 and status='active' returning id`, [organizationId, id, hashIntegrationSecret(secret)]);
    if (!updated.rows.length) throw new ApiError("NOT_FOUND", "未找到有效的集成凭据。");
    const item = await readCredential(tx, organizationId, id);
    return { result: { item, token: `wie_${id}_${secret}` }, audit: credentialAudit(item, "rotate") };
  });
}

export async function revokeIntegrationCredential(db: Database, auth: AuthContext, id: string, invocation: TrustedInvocationContext, context: AuditedWriteContext, organizationId = auth.organization.id) {
  requireUserInitiatedInvocation(invocation);
  assertTrustedInvocationMatchesScope(auth, invocation, organizationId, "Revoke integration credential");
  requireLogAdminDomains(auth);
  return withAuditedWrite(db, invocation, context, async (tx) => {
    const updated = await tx.query(`update log_integration_credentials set status='revoked',revoked_at=clock_timestamp()
      where organization_id=$1 and id=$2 and status='active' returning id`, [organizationId, id]);
    const item = await readCredential(tx, organizationId, id);
    return { result: { item }, audit: updated.rows.length ? credentialAudit(item, "revoke") : null };
  });
}
