import { randomUUID } from "node:crypto";
import { runInNewContext } from "node:vm";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { withAuditedWrite, type AuditedWriteContext, type AuditSpec } from "../audit/auditedWrite";
import type { AuthContext } from "../auth/types";
import { assertTrustedInvocationMatchesAuth, type TrustedInvocationContext } from "../auth/trustedInvocation";
import { findLogDomainByName, getLogDomainById, insertLogDomain, listLogDomains, updateLogDomainRow } from "./domainsRepository";
import { requireLogAdminDomains, requireLogUpload, requireLogView } from "./policy";
import { aggregateFeedbackInsights, relatedParameterVisibilityValues } from "./repository";
import { logSkillSpecSchema, type LogSkillSpec } from "./skillSpec";
import { insertSkillRevision, listSkillRevisions, lockSkill, publishSkillRevision } from "./skillsRepository";
import { logSkillTemplates } from "./skillTemplates";
import { parsingSpecSchema } from "./parsing/spec";
import { decodeLogFilesCooperatively } from "./parsing/workerDecoding";
import { MAX_DECODE_EVENTS } from "./parsing/engine";
import { validateDefaultSourceSnapshot } from "./sourceSnapshots";

export const PARSE_PREVIEW_MAX_MS = 100;
export const PARSE_PREVIEW_MAX_LINES = 5000;

export function listLogSkillTemplates(auth: AuthContext) {
  requireOrganization(auth);
  requireLogAdminDomains(auth);
  return { items: logSkillTemplates };
}

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
  const heads = await db.query<{ id: string; skill_id: string; revision_number: number; published_at: Date | null; status: string; has_source_snapshots: boolean; ready_source_versions: string[] }>(
    `select id, skill_id, revision_number, published_at, status,
      exists (select 1 from log_source_snapshots ss where ss.organization_id = sr.organization_id
        and ss.skill_id = sr.skill_id and ss.status <> 'archived') as has_source_snapshots,
      array(select ss.version_label from log_source_snapshots ss where ss.organization_id = sr.organization_id
        and ss.skill_id = sr.skill_id and ss.status = 'ready' order by ss.version_label) as ready_source_versions
      from log_skill_revisions sr where organization_id = $1 and status in ('published', 'draft')`, [auth.organization.id]);
  return { items: identities.map((identity) => {
    const current = heads.rows.find((r) => r.skill_id === identity.id && r.status === "published")!;
    const feedback = insights.filter((r) => r.logDomainId === identity.id);
    const total = feedback.reduce((sum, r) => sum + r.totalCount, 0);
    return { ...identity, currentRevision: { id: current.id, number: current.revision_number, publishedAt: current.published_at?.toISOString() ?? null },
      hasSourceSnapshots: current.has_source_snapshots,
      readySourceVersions: current.ready_source_versions,
      hasDraft: heads.rows.some((r) => r.skill_id === identity.id && r.status === "draft"), analyses7d: counts.rows.find((r) => r.skill_id === identity.id)?.count ?? 0,
      helpfulRate7d: total ? feedback.reduce((sum, r) => sum + r.helpfulCount, 0) / total : null };
  }) };
}

export async function listLogSkillSourceVersions(db: Queryable, auth: AuthContext, skillId: string) {
  requireOrganization(auth);
  if (auth.permissions.includes("logs:view")) requireLogView(auth);
  else requireLogUpload(auth);
  if (!await getLogDomainById(db, { organizationId: auth.organization.id, domainId: skillId })) {
    throw new ApiError("NOT_FOUND", "Analysis skill was not found.");
  }
  const result = await db.query<{ version_label: string }>(`select version_label from log_source_snapshots
    where organization_id = $1 and skill_id = $2 and status = 'ready' order by version_label`, [auth.organization.id, skillId]);
  return { items: result.rows.map((row) => row.version_label) };
}

export async function createLogSkill(db: Database, auth: AuthContext, input: {
  name: string; description?: string; formatProfile?: unknown;
  startingPoint?: { templateId: string } | { copyFromSkillId: string };
}, invocation: TrustedInvocationContext, context: AuditedWriteContext) {
  assertTrustedInvocationMatchesAuth(auth, invocation, "Create analysis skill");
  requireOrganization(auth);
  requireLogAdminDomains(auth);
  const name = input.name.trim();
  if (!name) throw new ApiError("VALIDATION_FAILED", "Analysis skill name must not be blank.");
  return withAuditedWrite(db, invocation, context, async (tx) => {
    const start = input.startingPoint;
    let source: LogSkillSpec;
    if (start && "copyFromSkillId" in start) {
      await lockSkill(tx, auth.organization.id, start.copyFromSkillId);
      const skill = await readSkill(tx, auth.organization.id, start.copyFromSkillId);
      source = { ...(skill.draft ?? skill.currentRevision).spec };
      // Source snapshots belong to the original skill and cannot be copied as defaults.
      delete source.defaultSourceSnapshotId;
    } else {
      const template = logSkillTemplates.find((item) => item.id === (start?.templateId ?? "generic-text"));
      if (!template) throw new ApiError("VALIDATION_FAILED", "未找到所选技能模板。");
      source = start || input.formatProfile == null ? template.spec : { schemaVersion: "skill/v1", formatProfile: input.formatProfile } as LogSkillSpec;
    }
    const spec = parseSpec({ ...source, ...(input.description !== undefined ? { description: input.description } : {}) });
    if (await findLogDomainByName(tx, { organizationId: auth.organization.id, name })) {
      throw new ApiError("CONFLICT", "An analysis skill with this name already exists.");
    }
    const skill = await insertLogDomain(tx, { id: randomUUID(), organizationId: auth.organization.id, name,
      description: spec.description, formatProfile: spec.formatProfile });
    if (spec.modelOverride) await updateLogDomainRow(tx, { organizationId: auth.organization.id, domainId: skill.id, modelOverride: spec.modelOverride });
    await insertSkillRevision(tx, { organizationId: auth.organization.id, skillId: skill.id, spec, userId: auth.user.id, published: true });
    return { result: await readSkill(tx, auth.organization.id, skill.id),
      audit: skillAudit(skill.id, "log-skill-create", start ?? (input.formatProfile == null ? { templateId: "generic-text" } : {})) };
  });
}

export async function saveLogSkillDraft(db: Database, auth: AuthContext, skillId: string, value: unknown, baseDraftRevisionId: string | null, basePublishedRevisionId: string, invocation: TrustedInvocationContext, context: AuditedWriteContext) {
  assertTrustedInvocationMatchesAuth(auth, invocation, "Save analysis skill draft");
  requireOrganization(auth);
  requireLogAdminDomains(auth);
  const spec = parseSpec(value);
  return withAuditedWrite(db, invocation, context, async (tx) => {
    await lockSkill(tx, auth.organization.id, skillId);
    const revisions = await listSkillRevisions(tx, auth.organization.id, skillId);
    const baseSpec = (revisions.find((r) => r.status === "draft") ?? revisions.find((r) => r.status === "published"))?.spec;
    await validateDefaultSourceSnapshot(tx, auth.organization.id, skillId, spec, spec.defaultSourceSnapshotId === baseSpec?.defaultSourceSnapshotId);
    if (revisions.find((r) => r.status === "published")?.id !== basePublishedRevisionId) {
      throw new ApiError("LOG_SKILL_DRAFT_CONFLICT", "Skill publication has changed.");
    }
    const draft = revisions.find((r) => r.status === "draft");
    if ((draft?.id ?? null) !== baseDraftRevisionId) {
      throw new ApiError("LOG_SKILL_DRAFT_CONFLICT", "Skill draft has changed.");
    }
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
    // Workspace saves validate both heads under this lock; publish consumes that
    // exact draft id, and restore refuses drafts, so no extra publish token is needed.
    const draft = (await listSkillRevisions(tx, auth.organization.id, skillId)).find((revision) => revision.id === draftId && revision.status === "draft");
    if (draft) parseSpec(draft.spec);
    if (draft) await validateDefaultSourceSnapshot(tx, auth.organization.id, skillId, draft.spec, true);
    await publishSkillRevision(tx, auth.organization.id, skillId, draftId, auth.user.id);
    return { result: await readSkill(tx, auth.organization.id, skillId), audit: skillAudit(skillId, "log-skill-publish", { draftRevisionId: draftId }) };
  });
}

export async function previewLogSkillParsing(db: Queryable, auth: AuthContext, skillId: string,
  input: { parsing?: unknown; sampleText: string; fileName?: string }) {
  requireOrganization(auth);
  requireLogAdminDomains(auth);
  if (!await getLogDomainById(db, { organizationId: auth.organization.id, domainId: skillId })) throw new ApiError("NOT_FOUND", "Analysis skill was not found.");
  const lines = input.sampleText === "" ? [] : input.sampleText.split(/\r\n|\n|\r/);
  if (Buffer.byteLength(input.sampleText, "utf8") > 1024 * 1024) throw new ApiError("VALIDATION_FAILED", "Sample exceeds 1 MiB.");
  const started = performance.now();
  let result: ReturnType<typeof parsingSpecSchema.safeParse>;
  try {
    // The watchdog evaluates only this constant callback, never administrator source.
    result = runInNewContext("validate()", { validate: () => parsingSpecSchema.safeParse(input.parsing) }, { timeout: PARSE_PREVIEW_MAX_MS });
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ERR_SCRIPT_EXECUTION_TIMEOUT")) throw error;
    return { valid: false, issues: [{ path: [], message: "Parsing validation exceeded the 100 ms preview budget" }], events: [],
      counts: { total: 0, byExtractor: {}, errors: { time_cap: 1 } }, unmatchedLineCount: lines.length, truncated: true, reason: "time_cap" as const };
  }
  if (!result.success) return { valid: false, issues: result.error.issues.map(({ path, message }) => ({ path, message })),
    events: [], counts: { total: 0, byExtractor: {}, errors: {} }, unmatchedLineCount: lines.length, truncated: false };
  const decoded = await decodeLogFilesCooperatively(result.data, [{ file: input.fileName ?? "sample.log", lines: lines.slice(0, PARSE_PREVIEW_MAX_LINES) }],
    { maxMs: Math.max(0, PARSE_PREVIEW_MAX_MS - (performance.now() - started)), maxEvents: MAX_DECODE_EVENTS, hardTimeout: true });
  const reason = decoded.counts.errors.time_cap ? "time_cap" as const : lines.length > PARSE_PREVIEW_MAX_LINES ? "line_cap" as const
    : decoded.events.length > 500 ? "event_cap" as const : undefined;
  return { valid: true, issues: [], ...decoded, unmatchedLineCount: decoded.unmatchedLineCount + Math.max(0, lines.length - PARSE_PREVIEW_MAX_LINES),
    events: decoded.events.slice(0, 500), truncated: !!reason, ...(reason ? { reason } : {}) };
}

export async function readLogSkillRevisions(db: Queryable, auth: AuthContext, skillId: string) {
  await getLogSkill(db, auth, skillId);
  return listSkillRevisions(db, auth.organization.id, skillId);
}

export async function discardLogSkillDraft(db: Database, auth: AuthContext, skillId: string, draftRevisionId: string, invocation: TrustedInvocationContext, context: AuditedWriteContext) {
  assertTrustedInvocationMatchesAuth(auth, invocation, "Discard analysis skill draft");
  requireOrganization(auth);
  requireLogAdminDomains(auth);
  return withAuditedWrite(db, invocation, context, async (tx) => {
    await lockSkill(tx, auth.organization.id, skillId);
    const draft = (await listSkillRevisions(tx, auth.organization.id, skillId)).find((r) => r.status === "draft");
    if (draft && draft.id !== draftRevisionId) throw new ApiError("LOG_SKILL_DRAFT_CONFLICT", "Skill draft has changed.");
    await tx.query(`delete from log_skill_revisions where organization_id = $1 and skill_id = $2 and status = 'draft' and id = $3`, [auth.organization.id, skillId, draftRevisionId]);
    return { result: undefined, audit: skillAudit(skillId, "log-skill-draft-discard") };
  });
}

export async function restoreLogSkillRevision(db: Database, auth: AuthContext, skillId: string, revisionId: string, invocation: TrustedInvocationContext, context: AuditedWriteContext) {
  assertTrustedInvocationMatchesAuth(auth, invocation, "Restore analysis skill revision");
  requireOrganization(auth);
  requireLogAdminDomains(auth);
  return withAuditedWrite(db, invocation, context, async (tx) => {
    await lockSkill(tx, auth.organization.id, skillId);
    const revisions = await listSkillRevisions(tx, auth.organization.id, skillId);
    const source = revisions.find((r) => r.id === revisionId && r.status !== "draft");
    if (!source) throw new ApiError("NOT_FOUND", "Skill revision was not found.");
    parseSpec(source.spec);
    await validateDefaultSourceSnapshot(tx, auth.organization.id, skillId, source.spec, true);
    if (revisions.some((r) => r.status === "draft")) throw new ApiError("LOG_SKILL_DRAFT_EXISTS", "Publish or discard the draft first.");
    const id = await insertSkillRevision(tx, { organizationId: auth.organization.id, skillId, spec: source.spec, userId: auth.user.id });
    await publishSkillRevision(tx, auth.organization.id, skillId, id, auth.user.id);
    return { result: await readSkill(tx, auth.organization.id, skillId),
      audit: skillAudit(skillId, "log-skill-restore", { fromRevisionId: revisionId, newRevisionId: id }) };
  });
}
