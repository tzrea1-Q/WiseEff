import type { Queryable } from "../../shared/database/client";

/** Call while holding the skill lock in the artifact's audited write. */
export async function recordSkillArtifacts(db: Queryable, organizationId: string, skillId: string, keys: string[]) {
  if (!keys.length) return;
  await db.query(`insert into log_skill_artifact_objects(organization_id,skill_id,object_key)
    select $1,$2,unnest($3::text[]) on conflict do nothing`, [organizationId, skillId, keys]);
}
