import type { Queryable } from "../../shared/database/client";
import { fuseKnowledgeSearchResults } from "../knowledge/hybridSearch";
import type { KnowledgeEmbeddingClient } from "../knowledge/indexing/embeddingClient";
import { hasKnowledgeVectorSupport, toVectorLiteral } from "../knowledge/indexing/repository";
import type { KnowledgeRetrievalMode } from "../knowledge/types";

type Scope = { organizationId: string; skillId: string; runId: string; projectId: string | null };

// Both rankings and tool admission share the same revision-pinned scope and confirmation predicate.
const confirmed = `
  select run.id as "entryId", report.created_at as "createdAt", left(report.conclusion, 800) as summary,
    run.eval_case_root_cause_category as "rootCauseCategory",
    concat_ws(' ', left(report.conclusion, 800), run.eval_case_root_cause_category) as search_text
  from log_analysis_runs run
  join log_skill_revisions revision on revision.organization_id = run.organization_id and revision.id = run.skill_revision_id
  join log_records record on record.organization_id = run.organization_id and record.id = run.log_record_id
  join log_analysis_reports report on report.organization_id = run.organization_id and report.run_id = run.id
    and report.log_record_id = record.id
  where run.organization_id = $1 and revision.skill_id = $2 and run.id <> $3 and run.status = 'complete'
    and (record.related_parameter_id is null or record.related_parameter_project_id = $4)
    and btrim(report.conclusion) <> ''
    and (run.eval_case_draft_exported_at is not null or exists (
      select 1 from log_feedback feedback where feedback.organization_id = run.organization_id
        and feedback.log_record_id = record.id and feedback.run_id = run.id and feedback.rating = 'helpful'
        and feedback.created_at >= report.created_at
    ))
`;

export async function hasPastConclusions(db: Queryable, scope: Scope) {
  const result = await db.query(`select 1 from (${confirmed}) candidate limit 1`,
    [scope.organizationId, scope.skillId, scope.runId, scope.projectId]);
  return result.rows.length > 0;
}

type Candidate = { entryId: string; createdAt: Date; summary: string; rootCauseCategory: string | null; search_text: string };
const SEMANTIC_CANDIDATES = 32;
const HYBRID_FTS_PREFIX = 64;

export async function searchPastConclusions(
  db: Queryable, scope: Scope, { query, offset, limit }: { query: string; offset: number; limit: number },
  embeddingClient?: KnowledgeEmbeddingClient
) {
  const scopeParams = [scope.organizationId, scope.skillId, scope.runId, scope.projectId];
  const end = offset + limit;
  const canUseVector = embeddingClient && await hasKnowledgeVectorSupport(db).catch(() => false);
  // A fixed fusion prefix gives consecutive pages one ranking. Older FTS hits
  // still follow the prefix in lexical order.
  const ftsLimit = canUseVector ? Math.max(HYBRID_FTS_PREFIX, end + SEMANTIC_CANDIDATES + 1) : end + 1;
  const fts = (await db.query<Candidate>(`
    select candidate.* from (${confirmed}) candidate
    where to_tsvector('english', search_text) @@ plainto_tsquery('english', $5)
      or strpos(lower(search_text), lower($5)) > 0
    order by ts_rank(to_tsvector('english', search_text), plainto_tsquery('english', $5)) desc,
      "createdAt" desc, "entryId"
    limit $6`, [...scopeParams, query, ftsLimit])).rows;
  let ranked = fts;
  let retrievalMode: KnowledgeRetrievalMode = "fts_only";
  if (embeddingClient && canUseVector) {
    try {
      // ponytail: embed a bounded recent window on read. Persist model-versioned vectors if older semantic-only hits need to compete.
      const recent = (await db.query<Candidate>(`
        select candidate.* from (${confirmed}) candidate order by "createdAt" desc, "entryId" limit $5`,
      [...scopeParams, SEMANTIC_CANDIDATES])).rows;
      if (recent.length) {
        const [needle, ...vectors] = await embeddingClient.embed([query, ...recent.map((item) => item.search_text)]);
        if (vectors.length !== recent.length) throw new Error("Incomplete historical conclusion embeddings.");
        const vector = (await db.query<Candidate>(`
          select candidate.* from (${confirmed}) candidate
          join unnest($5::text[], $6::text[]) scored(id, embedding) on scored.id = candidate."entryId"
          order by scored.embedding::vector <=> $7::vector, candidate."createdAt" desc, candidate."entryId"
        `, [...scopeParams, recent.map((item) => item.entryId), vectors.map(toVectorLiteral), toVectorLiteral(needle)])).rows;
        const prefix = fuseKnowledgeSearchResults({ fts: fts.slice(0, HYBRID_FTS_PREFIX), vector, limit: HYBRID_FTS_PREFIX + vector.length });
        const fusedIds = new Set(prefix.map((item) => item.entryId));
        ranked = [...prefix, ...fts.slice(HYBRID_FTS_PREFIX).filter((item) => !fusedIds.has(item.entryId))];
        retrievalMode = "semantic_fts";
      }
    } catch {
      // An unavailable vector extension/provider leaves the PostgreSQL FTS ranking intact.
    }
  }

  const page = ranked.slice(offset, end);
  const templates = page.length ? (await db.query<{ runId: string; evidenceTemplates: string[] }>(`
    select selected.id as "runId", array(
      select concat(stage, ' evidence: ', cardinality(line_numbers), ' log anchors',
        case when source_line is not null then ' and a source anchor' else '' end,
        case when rule_hit is not null then concat(' (rule ', left(rule_hit, 120), ')') else '' end)
      from log_evidence where organization_id = $1 and run_id = selected.id
      order by created_at, id limit 5
    ) as "evidenceTemplates" from unnest($2::text[]) selected(id)
  `, [scope.organizationId, page.map((candidate) => candidate.entryId)])).rows : [];
  const items = page.map((candidate) => ({
    runId: candidate.entryId, createdAt: candidate.createdAt.toISOString(), summary: candidate.summary,
    ...(candidate.rootCauseCategory ? { rootCauseCategory: candidate.rootCauseCategory } : {}),
    evidenceTemplates: templates.find((row) => row.runId === candidate.entryId)?.evidenceTemplates ?? []
  }));
  return { retrievalMode, items, hasMore: ranked.length > end };
}
