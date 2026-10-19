import type { Database, Queryable } from "../../shared/database/client";

export const MAX_SOURCE_SEARCH_RESULTS = 20;
export const MAX_SOURCE_RANGE_LINES = 80;
export const MAX_SOURCE_EXCERPT_CHARS = 400;
export const MAX_SOURCE_TOOL_BYTES = 16 * 1024;
export const MAX_SOURCE_SEARCH_CANDIDATES = 200;
export const SOURCE_SEARCH_TIMEOUT_MS = 1000;
const MAX_RANGE_CHUNKS = 80;
export const MAX_SOURCE_LINE_CHARS = 1000;

export type SourceSearchParams = { pathGlob: string; query: string; mode: "literal" | "full_text"; limit: number };
export type SourceSearchHit = { snapshotId: string; path: string; line: number; excerpt: string; rank: number; versionLabel: string };
export type SourceSearchResult = { items: SourceSearchHit[]; truncated: boolean; reason?: "statement_timeout" };
export type SourceRangeParams = { snapshotId: string; path: string; startLine: number; endLine: number };
export type SourceRangeResult = { snapshotId: string; path: string; startLine: number; endLine: number; totalLines: number;
  truncated: boolean; lines: Array<{ line: number; content: string }> };

/** Only constructed glob regex syntax reaches PostgreSQL; other path characters stay literal. */
function pathGlobRegex(glob: string) {
  return `^${glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\/|\*\*|\*|\?/g,
    (token) => token === "**/" ? "(?:.*/)?" : token === "**" ? ".*" : token === "*" ? "[^/]*" : "[^/]")}$`;
}

export async function searchSource(db: Database, input: SourceSearchParams & { organizationId: string; snapshotId: string }): Promise<SourceSearchResult> {
  const literal = input.mode === "literal";
  if (input.query.trim().length < 3 || input.query.length > 200 || !input.pathGlob || input.pathGlob.length > 1024
    || literal && (!/[\p{L}\p{N}]{3}/u.test(input.query) || /[\r\n]/.test(input.query))) {
    throw new Error("Queries require at least three characters; literal queries need three consecutive letters or numbers and no newlines.");
  }
  const limit = Math.min(MAX_SOURCE_SEARCH_RESULTS, Math.max(1, Math.floor(input.limit)));
  const needle = literal ? `%${input.query.replace(/[\\%_]/g, "\\$&")}%` : input.query;
  const prefix = input.pathGlob.split(/[*?]/, 1)[0];
  // Materialization bounds scoring and line splitting to admitted candidate ids. A bounded metadata
  // lookup also checks split-line boundaries: their cross-boundary trigrams do not exist in the index.
  // ponytail: at most 200 indexed chunks and 200 boundary windows; add cursor paging if needed.
  try {
    return await db.transaction(async (tx) => {
      const previous = (await tx.query<{ timeout: string; timeoutMs: number }>(
        `select current_setting('statement_timeout') as timeout, setting::integer as "timeoutMs"
          from pg_settings where name = 'statement_timeout'`)).rows[0];
      await tx.query("select set_config('statement_timeout', $1, true)", [String(Math.min(SOURCE_SEARCH_TIMEOUT_MS, previous.timeoutMs || SOURCE_SEARCH_TIMEOUT_MS))]);
      const result = (await tx.query<{ items: Array<SourceSearchHit & { excerptTruncated: boolean }>; candidatesTruncated: boolean; queryTooBroad: boolean }>(`with indexed_ids as materialized (
    select c.id
    from log_source_chunks c
    join log_source_files f on f.id=c.file_id and f.organization_id=c.organization_id and f.snapshot_id=c.snapshot_id
    join log_source_snapshots s on s.id=c.snapshot_id and s.organization_id=c.organization_id
    where c.organization_id=$1 and c.snapshot_id=$2 and s.status='ready' and f.path ~ $4 and f.path like $9 escape '\\'
      and (($5::boolean and c.content ilike $6 escape '\\')
        or (not $5::boolean and c.search_vector @@ plainto_tsquery('simple', $3)))
    limit 201
  ), admission as materialized (
    select $8::boolean and (select count(*) from indexed_ids) > 200 as too_broad
  ), indexed_candidates as materialized (
    select c.content, c.start_line, c.chunk_ordinal, f.path, s.version_label, c.start_line=c.end_line as single_line,
      case when $5::boolean then similarity(substring(c.content from greatest(1, strpos(lower(c.content), lower($3)) - 100) for 400), $3)
        else ts_rank_cd(c.search_vector, plainto_tsquery('simple', $3)) end as rank
    from (select id from indexed_ids limit 200) ids
    join log_source_chunks c on c.id=ids.id
    join log_source_files f on f.id=c.file_id and f.organization_id=c.organization_id and f.snapshot_id=c.snapshot_id
    join log_source_snapshots s on s.id=c.snapshot_id and s.organization_id=c.organization_id
    where not (select too_broad from admission)
  ), boundary_ids as materialized (
    select c.id as previous_id, n.id as next_id, c.end_line as start_line, c.chunk_ordinal, f.path, s.version_label
    from log_source_chunks c
    join log_source_chunks n on n.organization_id=c.organization_id and n.snapshot_id=c.snapshot_id
      and n.file_id=c.file_id and n.chunk_ordinal=c.chunk_ordinal+1 and n.start_line=c.end_line
    join log_source_files f on f.id=c.file_id and f.organization_id=c.organization_id and f.snapshot_id=c.snapshot_id
    join log_source_snapshots s on s.id=c.snapshot_id and s.organization_id=c.organization_id
    where c.organization_id=$1 and c.snapshot_id=$2 and s.status='ready' and f.path ~ $4 and f.path like $9 escape '\\'
      and not (select too_broad from admission)
    limit 201
  ), boundary_content as materialized (
    select regexp_replace(right(c.content, 200), E'^.*[\\r\\n]', '', 's')
      || regexp_replace(left(n.content, 200), E'[\\r\\n].*$', '', 's') as content,
      b.start_line, b.chunk_ordinal, b.path, b.version_label, true as single_line
    from (select * from boundary_ids order by path, chunk_ordinal limit 200) b
    join log_source_chunks c on c.id=b.previous_id join log_source_chunks n on n.id=b.next_id
  ), candidates as materialized (
    select * from (select * from indexed_candidates order by rank desc, path, start_line, chunk_ordinal limit 200) indexed
    union all
    select *, case when $5::boolean then similarity(content, $3)
      else ts_rank_cd(to_tsvector('simple', content), plainto_tsquery('simple', $3)) end as rank
    from boundary_content where ($5::boolean and content ilike $6 escape '\\')
      or (not $5::boolean and to_tsvector('simple', content) @@ plainto_tsquery('simple', $3))
  ), hits as (
    select distinct on (c.path, c.start_line + l.ordinality - 1)
      $2::text as "snapshotId", c.path, (c.start_line + l.ordinality - 1)::integer as line,
      substring(l.content from (case when $5::boolean then greatest(1, strpos(lower(l.content), lower($3)) - 100) else 1 end) for 400) as excerpt,
      length(l.content) > 400 as "excerptTruncated",
      c.rank, c.version_label as "versionLabel"
    from candidates c
    cross join lateral regexp_split_to_table(c.content, E'\\r\\n|\\r|\\n') with ordinality l(content, ordinality)
    where ($5::boolean and l.content ilike $6 escape '\\')
      or (not $5::boolean and l.content <> '' and (c.single_line or to_tsvector('simple', l.content) @@ plainto_tsquery('simple', $3)))
    order by c.path, c.start_line + l.ordinality - 1, c.rank desc
  ), limited_hits as (select * from hits order by rank desc, path, line limit $7)
  select coalesce(jsonb_agg(h order by rank desc, path, line), '[]'::jsonb) as items,
    ((select count(*) from indexed_ids) > 200
      or (select count(*) from boundary_ids) > 200) as "candidatesTruncated",
    (select too_broad from admission) as "queryTooBroad" from limited_hits h`,
      [input.organizationId, input.snapshotId, input.query, pathGlobRegex(input.pathGlob), literal, needle, limit + 1,
        !prefix, `${prefix.replace(/[\\%_]/g, "\\$&")}%`])).rows[0];
      if (result.queryTooBroad) throw new Error("Source query is too common without a literal path prefix. Narrow pathGlob (for example drivers/power/**) or use a more specific query.");
      await tx.query("select set_config('statement_timeout', $1, true)", [previous.timeout]);
      return { items: result.items.slice(0, limit).map(({ excerptTruncated: _excerptTruncated, ...item }) => item),
        truncated: result.candidatesTruncated || result.items.length > limit || result.items.some((row) => row.excerptTruncated) };
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "57014") {
      return { items: [], truncated: true, reason: "statement_timeout" };
    }
    throw error;
  }
}

export async function readSourceRange(db: Queryable, input: SourceRangeParams & { organizationId: string }): Promise<SourceRangeResult | null> {
  if (!Number.isSafeInteger(input.startLine) || !Number.isSafeInteger(input.endLine) || input.startLine < 1
    || input.endLine < input.startLine || !input.path || input.path.length > 1024) return null;
  const file = (await db.query<{ lineCount: number }>(`select f.line_count as "lineCount" from log_source_files f
    join log_source_snapshots s on s.id=f.snapshot_id and s.organization_id=f.organization_id
    where f.organization_id=$1 and f.snapshot_id=$2 and f.path=$3 and s.status='ready'`,
  [input.organizationId, input.snapshotId, input.path])).rows[0];
  if (!file || input.startLine > file.lineCount) return null;
  const endLine = Math.min(input.endLine, input.startLine + MAX_SOURCE_RANGE_LINES - 1, file.lineCount);
  const chunks = (await db.query<{ startLine: number; content: string }>(`select c.start_line as "startLine", c.content from log_source_chunks c
    join log_source_files f on f.id=c.file_id and f.organization_id=c.organization_id and f.snapshot_id=c.snapshot_id
    where c.organization_id=$1 and c.snapshot_id=$2 and f.path=$3 and c.start_line <= $5 and c.end_line >= $4 - 1
    order by c.start_line, c.chunk_ordinal limit 81`,
  [input.organizationId, input.snapshotId, input.path, input.startLine, endLine])).rows;
  const seen = new Map<number, string>();
  let truncated = input.endLine > endLine || chunks.length > MAX_RANGE_CHUNKS;
  for (const chunk of chunks.slice(0, MAX_RANGE_CHUNKS)) {
    const fragments = chunk.content.split(/\r\n|\r|\n/);
    for (let at = 0; at < fragments.length; at++) {
      const line = chunk.startLine + at;
      if (line < input.startLine || line > endLine) continue;
      const content = (seen.get(line) ?? "") + fragments[at];
      truncated ||= content.length > MAX_SOURCE_LINE_CHARS;
      seen.set(line, content.slice(0, MAX_SOURCE_LINE_CHARS));
    }
  }
  const lines = [...seen].map(([line, content]) => ({ line, content }));
  return { snapshotId: input.snapshotId, path: input.path, startLine: input.startLine,
    endLine: lines.at(-1)?.line ?? input.startLine, totalLines: file.lineCount,
    truncated: truncated || lines.length < endLine - input.startLine + 1, lines };
}
