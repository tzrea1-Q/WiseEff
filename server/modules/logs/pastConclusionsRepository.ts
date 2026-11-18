import type { Queryable } from "../../shared/database/client";

type Scope = { organizationId: string; skillId: string; runId: string; projectId: string | null };

// Ranking and tool admission share the same revision-pinned scope and confirmation predicate.
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

type Candidate = { entryId: string; createdAt: Date; summary: string; rootCauseCategory: string | null };

export async function searchPastConclusions(
  db: Queryable, scope: Scope, { query, offset, limit }: { query: string; offset: number; limit: number }
) {
  const scopeParams = [scope.organizationId, scope.skillId, scope.runId, scope.projectId];
  const fts = (await db.query<Candidate>(`
    select "entryId", "createdAt", summary, "rootCauseCategory" from (${confirmed}) candidate
    where to_tsvector('english', search_text) @@ plainto_tsquery('english', $5)
      or strpos(lower(search_text), lower($5)) > 0
    order by ts_rank(to_tsvector('english', search_text), plainto_tsquery('english', $5)) desc,
      "createdAt" desc, "entryId"
    limit $6 offset $7`, [...scopeParams, query, limit + 1, offset])).rows;

  const page = fts.slice(0, limit);
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
  return { retrievalMode: "fts_only" as const, items, hasMore: fts.length > limit };
}
