import type { Database, Queryable } from "../../shared/database/client";
import type { AuthContext } from "../auth/types";
import { requireLogUpload } from "./policy";
import type { ObjectStore } from "./objectStore";
import type { LogSkillSpec } from "./skillSpec";
import type { LogRecordDto } from "./types";
import { LOG_SKILL_RECOMMENDATION_LIMITS as limits, recommendLogSkills, type LogSkillRecommendationResult } from "./skillRecommendation";

export type RecommendationFile = { path: string; head: string[] };

/** Immutable content and its revision id come from one unlocked snapshot read. */
async function recommendationCandidates(db: Queryable, organizationId: string) {
  const result = await db.query<{ skillId: string; revisionId: string; spec: LogSkillSpec }>(`select r.skill_id as "skillId", r.id as "revisionId", r.spec
    from log_skill_revisions r join log_domains d on d.id=r.skill_id and d.organization_id=r.organization_id
    where r.organization_id=$1 and r.status='published' and d.status='active'
    order by r.skill_id limit $2`, [organizationId, limits.skills + 1]);
  return result.rows;
}

/** Only active, published skills from this organization can participate. */
export async function recommendOrganizationLogSkills(db: Queryable, auth: AuthContext, files: RecommendationFile[]): Promise<LogSkillRecommendationResult> {
  requireLogUpload(auth);
  return recommendLogSkills(await recommendationCandidates(db, auth.organization.id), files);
}

/** Read a bounded prefix, never the full stored bundle. Oversized lines are ignored. */
export async function storedRecommendationFiles(store: ObjectStore, files: Array<{ path: string; objectKey: string | null }>): Promise<RecommendationFile[]> {
  let expired = false, activeStream: Awaited<ReturnType<NonNullable<ObjectStore["getStream"]>>> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const read = async () => {
    const maxBytes = limits.headLines * (limits.lineBytes + 2);
    const heads: RecommendationFile[] = [];
    for (const file of [...files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0).slice(0, limits.files)) {
      if (expired) return [];
      let head: string[] = [];
      if (file.objectKey) {
        let bytes: Buffer;
        if (store.getStream) {
          const chunks: Buffer[] = [];
          let size = 0;
          activeStream = await store.getStream(file.objectKey, { start: 0, end: maxBytes });
          if (expired) { activeStream.destroy(); return []; }
          for await (const chunk of activeStream) {
            const part = (chunk as Buffer).subarray(0, maxBytes + 1 - size);
            chunks.push(part); size += part.length;
            if (size > maxBytes) break;
          }
          bytes = Buffer.concat(chunks, size);
        } else if (store.getBounded) {
          // Legacy adapters without ranges may reject large objects; names
          // still participate without buffering the entire stored object.
          try { bytes = await store.getBounded(file.objectKey, maxBytes); }
          catch { bytes = Buffer.alloc(0); }
        } else { bytes = Buffer.alloc(0); }
        const prefix = bytes.subarray(0, maxBytes).toString("utf8");
        const lines = prefix ? prefix.split(/\r\n|\r|\n/) : [];
        if (bytes.length > maxBytes || /[\r\n]$/.test(prefix)) lines.pop();
        head = lines.slice(0, limits.headLines).filter((line) => Buffer.byteLength(line) <= limits.lineBytes);
      }
      heads.push({ path: file.path, head });
    }
    return heads;
  };
  try {
    return await Promise.race([read(), new Promise<RecommendationFile[]>((resolve) => {
      timer = setTimeout(() => { expired = true; activeStream?.destroy(); resolve([]); }, 500);
    })]);
  } catch { return []; }
  finally { clearTimeout(timer); }
}

export async function selectUploadLogSkill(db: Database, auth: AuthContext,
  input: { logDomainId?: string; skillSelection?: "generic" }, files: RecommendationFile[]) {
  if (input.logDomainId) return { logDomainId: input.logDomainId,
    skillSelection: { mode: "explicit", reasons: [] } satisfies NonNullable<LogRecordDto["skillSelection"]> };
  const generic = { logDomainId: undefined,
    skillSelection: { mode: "generic", reasons: [] } satisfies NonNullable<LogRecordDto["skillSelection"]> };
  if (input.skillSelection === "generic" || !files.length) return generic;
  requireLogUpload(auth);
  try {
    // A nested transaction is a SAVEPOINT: PostgreSQL errors/timeouts must not
    // leave the enclosing upload transaction aborted. Preserve statement_timeout.
    return await db.transaction(async (tx) => {
      const previous = (await tx.query<{ timeout: string }>("select current_setting('lock_timeout') as timeout")).rows[0];
      await tx.query("select set_config('lock_timeout', '200ms', true)");
      const candidates = await recommendationCandidates(tx, auth.organization.id);
      const ranked = recommendLogSkills(candidates, files);
      const best = ranked.recommendations.find((item) => item.skillId === ranked.recommendedSkillId);
      const candidate = candidates.find((item) => item.skillId === best?.skillId);
      if (best && candidate) {
        // The record/run foreign keys will need these key-share locks. Acquire
        // only the winner without waiting, so a source/sample write cannot stall
        // intake. A superseded revision remains immutable and safe to pin.
        const available = await tx.query(`select r.id from log_skill_revisions r
          join log_domains d on d.id=r.skill_id and d.organization_id=r.organization_id
          where r.organization_id=$1 and r.skill_id=$2 and r.id=$3
            and r.status in ('published', 'superseded') and d.status='active'
          for key share of d, r skip locked`, [auth.organization.id, best.skillId, candidate.revisionId]);
        if (!available.rows.length) throw new Error("Recommendation unavailable");
        await tx.query("select set_config('lock_timeout', $1, true)", [previous.timeout]);
        return { logDomainId: best.skillId, recommendedSkillRevisionId: candidate.revisionId,
          skillSelection: { mode: "recommended", reasons: best.reasons } satisfies NonNullable<LogRecordDto["skillSelection"]> };
      }
      await tx.query("select set_config('lock_timeout', $1, true)", [previous.timeout]);
      return generic;
    });
  } catch { return generic; }
}
