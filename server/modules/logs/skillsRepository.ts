import { randomUUID } from "node:crypto";
import type { Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { LogSkillSpec } from "./skillSpec";
import type { ParseTestRun } from "./parseTestSpec";

export type LogSkillRevisionDto = {
  parseTestRun?: ParseTestRun;
  id: string;
  skillId: string;
  number: number;
  status: "draft" | "published" | "superseded";
  spec: LogSkillSpec;
  contentHash: string;
  createdByUserId: string | null;
  createdAt: string;
  publishedAt: string | null;
  publishedByUserId: string | null;
  publishedByDisplayName?: string | null;
};

const selectRevision = `select id, skill_id as "skillId", revision_number as number, status, spec,
  content_hash as "contentHash", created_by_user_id as "createdByUserId", created_at as "createdAt",
  published_at as "publishedAt", published_by_user_id as "publishedByUserId",
  (select u.name from users u where u.id = published_by_user_id and u.organization_id = log_skill_revisions.organization_id) as "publishedByDisplayName"
  from log_skill_revisions`;

export async function listSkillRevisions(db: Queryable, organizationId: string, skillId: string): Promise<LogSkillRevisionDto[]> {
  const result = await db.query<LogSkillRevisionDto>(`${selectRevision}
    where organization_id = $1 and skill_id = $2 order by revision_number desc`, [organizationId, skillId]);
  return result.rows.map((row) => ({ ...row, createdAt: new Date(row.createdAt).toISOString(),
    publishedAt: row.publishedAt ? new Date(row.publishedAt).toISOString() : null }));
}

/** Serializes draft edits and publication against each other and shared run pins. */
export async function lockSkill(db: Queryable, organizationId: string, skillId: string) {
  const result = await db.query(`select id from log_domains where organization_id = $1 and id = $2 for update`, [organizationId, skillId]);
  if (!result.rows.length) throw new ApiError("NOT_FOUND", "Analysis skill was not found.");
}

export async function insertSkillRevision(db: Queryable, input: {
  organizationId: string; skillId: string; spec: LogSkillSpec; userId: string; published?: boolean;
}): Promise<string> {
  const id = randomUUID();
  await db.query(`insert into log_skill_revisions
    (id, organization_id, skill_id, revision_number, status, spec, content_hash, created_by_user_id, published_at, published_by_user_id)
    select $1, $2, $3, coalesce(max(revision_number), 0) + 1, $4, $5::jsonb,
      encode(sha256(convert_to(($5::jsonb)::text, 'UTF8')), 'hex'), $6,
      case when $7 then now() end, case when $7 then $6 end
    from log_skill_revisions where organization_id = $2 and skill_id = $3`,
  [id, input.organizationId, input.skillId, input.published ? "published" : "draft", JSON.stringify(input.spec), input.userId, Boolean(input.published)]);
  return id;
}

export async function publishSkillRevision(db: Queryable, organizationId: string, skillId: string, draftId: string, userId: string) {
  const draft = await db.query(`select id from log_skill_revisions
    where organization_id = $1 and skill_id = $2 and id = $3 and status = 'draft'`, [organizationId, skillId, draftId]);
  if (!draft.rows.length) throw new ApiError("LOG_SKILL_DRAFT_CONFLICT", "Skill draft is missing or stale.");
  await db.query(`update log_skill_revisions set status = 'superseded'
    where organization_id = $1 and skill_id = $2 and status = 'published'`, [organizationId, skillId]);
  await db.query(`update log_skill_revisions set status = 'published', published_at = now(), published_by_user_id = $4
    where organization_id = $1 and skill_id = $2 and id = $3`, [organizationId, skillId, draftId, userId]);
  // Keep legacy GET/edit forms coherent; workers never read these columns.
  await db.query(`update log_domains d set format_profile = s.spec->'formatProfile',
    model_override = s.spec->>'modelOverride', description = coalesce(s.spec->>'description', d.description), updated_at = now()
    from log_skill_revisions s where d.organization_id = $1 and d.id = $2 and s.id = $3 and s.organization_id = $1`,
  [organizationId, skillId, draftId]);
}

export async function currentSkillRevisionId(db: Queryable, organizationId: string, skillId?: string): Promise<string | null> {
  if (!skillId) return null;
  const skill = await db.query(`select id from log_domains where organization_id = $1 and id = $2 for share`, [organizationId, skillId]);
  if (!skill.rows.length) throw new ApiError("NOT_FOUND", "Analysis skill was not found.");
  const result = await db.query<{ id: string }>(`select id from log_skill_revisions
    where organization_id = $1 and skill_id = $2 and status = 'published'`, [organizationId, skillId]);
  if (!result.rows[0]) throw new ApiError("CONFLICT", "Analysis skill has no published revision.");
  return result.rows[0].id;
}
