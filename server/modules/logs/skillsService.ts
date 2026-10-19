import { randomUUID } from "node:crypto";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { withAuditedWrite, type AuditedWriteContext, type AuditSpec } from "../audit/auditedWrite";
import type { AuthContext } from "../auth/types";
import { assertTrustedInvocationMatchesAuth, type TrustedInvocationContext } from "../auth/trustedInvocation";
import { findLogDomainByName, getLogDomainById, insertLogDomain, listLogDomains } from "./domainsRepository";
import { requireLogAdminDomains, requireLogView } from "./policy";
import { aggregateFeedbackInsights, relatedParameterVisibilityValues } from "./repository";
import { logSkillSpecSchema, type LogSkillSpec } from "./skillSpec";
import { insertSkillRevision, listSkillRevisions, lockSkill, publishSkillRevision } from "./skillsRepository";

function requireOrganization(auth: AuthContext) {
  if (auth.user.organizationId !== auth.organization.id) throw new ApiError("FORBIDDEN", "Log organization access is required.");
}

function skillAudit(skillId: string, kind: string, metadata: Record<string, unknown> = {}): AuditSpec {
  return { app: "log-analysis", kind, action: kind, severity: "Medium", projectId: null,
    targetType: "log-skill", targetId: skillId, metadata };
}

function parseSpec(value: unknown): LogSkillSpec {
  const result = logSkillSpecSchema.safeParse(value);
  if (!result.success) throw new ApiError("VALIDATION_FAILED", "Invalid analysis skill spec.", { issues: result.error.issues });
  return result.data;
}

async function readSkill(db: Queryable, organizationId: string, skillId: string) {
  const identity = await getLogDomainById(db, { organizationId, domainId: skillId });
  if (!identity) throw new ApiError("NOT_FOUND", "Analysis skill was not found.");
  const revisions = await listSkillRevisions(db, organizationId, skillId);
  return { ...identity, currentRevision: revisions.find((r) => r.status === "published")!,
    draft: revisions.find((r) => r.status === "draft") ?? null };
}

export async function getLogSkill(db: Queryable, auth: AuthContext, skillId: string) {
  requireOrganization(auth);
  requireLogView(auth);
  return readSkill(db, auth.organization.id, skillId);
}

export async function listLogSkills(db: Queryable, auth: AuthContext, includeArchived = false) {
  requireOrganization(auth);
  requireLogView(auth);
  const identities = await listLogDomains(db, { organizationId: auth.organization.id, includeArchived });
  const insights = await aggregateFeedbackInsights(db, auth, { timeWindow: "7d" });
  const { organizationWide, projectIds } = relatedParameterVisibilityValues(auth);
  const counts = await db.query<{ skill_id: string; count: number }>(`select s.skill_id, count(*)::int as count
    from log_analysis_runs a join log_skill_revisions s on s.id = a.skill_revision_id and s.organization_id = a.organization_id
    join log_records lr on lr.id = a.log_record_id and lr.organization_id = a.organization_id
    where a.organization_id = $1 and a.created_at >= now() - interval '7 days'
      and (lr.related_parameter_id is null or (
        lr.related_parameter_project_id is not null
        and exists (select 1 from projects p where p.id = lr.related_parameter_project_id and p.organization_id = lr.organization_id)
        and ($2::boolean or lr.related_parameter_project_id = any($3::text[]))))
    group by s.skill_id`, [auth.organization.id, organizationWide, projectIds]);
  const heads = await db.query<{ id: string; skill_id: string; revision_number: number; published_at: Date | null; status: string }>(
    `select id, skill_id, revision_number, published_at, status from log_skill_revisions
      where organization_id = $1 and status in ('published', 'draft')`, [auth.organization.id]);
  return { items: identities.map((identity) => {
    const current = heads.rows.find((r) => r.skill_id === identity.id && r.status === "published")!;
    const feedback = insights.filter((r) => r.logDomainId === identity.id);
    const total = feedback.reduce((sum, r) => sum + r.totalCount, 0);
    return { ...identity, currentRevision: { id: current.id, number: current.revision_number, publishedAt: current.published_at?.toISOString() ?? null },
      hasDraft: heads.rows.some((r) => r.skill_id === identity.id && r.status === "draft"), analyses7d: counts.rows.find((r) => r.skill_id === identity.id)?.count ?? 0,
      helpfulRate7d: total ? feedback.reduce((sum, r) => sum + r.helpfulCount, 0) / total : null };
  }) };
}

export async function createLogSkill(db: Database, auth: AuthContext, input: {
  name: string; description?: string; formatProfile?: unknown;
}, invocation: TrustedInvocationContext, context: AuditedWriteContext) {
  assertTrustedInvocationMatchesAuth(auth, invocation, "Create analysis skill");
  requireOrganization(auth);
  requireLogAdminDomains(auth);
  const name = input.name.trim();
  if (!name) throw new ApiError("VALIDATION_FAILED", "Analysis skill name must not be blank.");
  const spec = parseSpec({ schemaVersion: "skill/v1", ...(input.formatProfile != null ? { formatProfile: input.formatProfile } : {}) });
  return withAuditedWrite(db, invocation, context, async (tx) => {
    if (await findLogDomainByName(tx, { organizationId: auth.organization.id, name })) {
      throw new ApiError("CONFLICT", "An analysis skill with this name already exists.");
    }
    const skill = await insertLogDomain(tx, { id: randomUUID(), organizationId: auth.organization.id, name,
      description: input.description, formatProfile: spec.formatProfile });
    await insertSkillRevision(tx, { organizationId: auth.organization.id, skillId: skill.id, spec, userId: auth.user.id, published: true });
    return { result: await readSkill(tx, auth.organization.id, skill.id), audit: skillAudit(skill.id, "log-skill-create") };
  });
}

export async function saveLogSkillDraft(db: Database, auth: AuthContext, skillId: string, value: unknown, invocation: TrustedInvocationContext, context: AuditedWriteContext) {
  assertTrustedInvocationMatchesAuth(auth, invocation, "Save analysis skill draft");
  requireOrganization(auth);
  requireLogAdminDomains(auth);
  const spec = parseSpec(value);
  return withAuditedWrite(db, invocation, context, async (tx) => {
    await lockSkill(tx, auth.organization.id, skillId);
    // A new draft id on every save makes stale publish requests detectable.
    await tx.query(`delete from log_skill_revisions where organization_id = $1 and skill_id = $2 and status = 'draft'`, [auth.organization.id, skillId]);
    const id = await insertSkillRevision(tx, { organizationId: auth.organization.id, skillId, spec, userId: auth.user.id });
    return { result: (await listSkillRevisions(tx, auth.organization.id, skillId)).find((r) => r.id === id)!,
      audit: skillAudit(skillId, "log-skill-draft-save", { draftRevisionId: id }) };
  });
}

export async function publishLogSkill(db: Database, auth: AuthContext, skillId: string, draftId: string, invocation: TrustedInvocationContext, context: AuditedWriteContext) {
  assertTrustedInvocationMatchesAuth(auth, invocation, "Publish analysis skill");
  requireOrganization(auth);
  requireLogAdminDomains(auth);
  return withAuditedWrite(db, invocation, context, async (tx) => {
    await lockSkill(tx, auth.organization.id, skillId);
    await publishSkillRevision(tx, auth.organization.id, skillId, draftId, auth.user.id);
    return { result: await readSkill(tx, auth.organization.id, skillId), audit: skillAudit(skillId, "log-skill-publish", { draftRevisionId: draftId }) };
  });
}

export async function readLogSkillRevisions(db: Queryable, auth: AuthContext, skillId: string) {
  await getLogSkill(db, auth, skillId);
  return listSkillRevisions(db, auth.organization.id, skillId);
}
