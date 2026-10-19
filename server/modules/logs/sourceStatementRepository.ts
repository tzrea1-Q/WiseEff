import type { Queryable } from "../../shared/database/client";
import { MAX_SOURCE_LOCATE_LINE_LENGTH, matchesStatementSkeleton, statementMatchKeys } from "./sourceStatements";

export type SourceStatementMatch = { snapshotId: string; path: string; line: number; versionLabel: string; excerpt: string; startLine: number; confidence: number };
export type SourceStatementMatches = { items: SourceStatementMatch[]; truncated: boolean };
const MAX_CANDIDATES = 200;
export async function readSourceExcerpt(db: Queryable, input: { organizationId: string; snapshotId: string; path: string; line: number }): Promise<Omit<SourceStatementMatch, "confidence"> | null> {
  if (!Number.isSafeInteger(input.line) || input.line < 1 || input.path.length > 1024) return null;
  const file = (await db.query<{ versionLabel: string; lineCount: number }>(`select s.version_label as "versionLabel", f.line_count as "lineCount"
    from log_source_files f join log_source_snapshots s on s.id=f.snapshot_id and s.organization_id=f.organization_id
    where f.organization_id=$1 and f.snapshot_id=$2 and f.path=$3`, [input.organizationId, input.snapshotId, input.path])).rows[0];
  if (!file || input.line > file.lineCount) return null;
  const startLine = Math.max(1, input.line - 3), endLine = Math.min(file.lineCount, input.line + 3);
  const chunks = (await db.query<{ startLine: number; content: string }>(`select c.start_line as "startLine", c.content from log_source_chunks c
    join log_source_files f on f.id=c.file_id and f.organization_id=c.organization_id and f.snapshot_id=c.snapshot_id
    where c.organization_id=$1 and c.snapshot_id=$2 and f.path=$3 and c.start_line <= $5 and c.end_line >= $4
    order by c.start_line, c.chunk_ordinal limit 70`, [input.organizationId, input.snapshotId, input.path, startLine, endLine])).rows;
  const lines = new Map<number, string>();
  for (const chunk of chunks) {
    const fragments = chunk.content.split(/\r\n|\r|\n/);
    for (let at = 0; at < fragments.length; at++) {
      const line = chunk.startLine + at;
      if (line < startLine || line > endLine) continue;
      lines.set(line, ((lines.get(line) ?? "") + fragments[at]).slice(0, 1000));
    }
  }
  if (!lines.has(input.line)) return null;
  return { snapshotId: input.snapshotId, path: input.path, line: input.line, versionLabel: file.versionLabel, startLine,
    excerpt: Array.from({ length: endLine - startLine + 1 }, (_, at) => lines.get(startLine + at) ?? "").join("\n") };
}

export async function locateLogStatements(db: Queryable, input: { organizationId: string; snapshotId: string; line: string; limit?: number }): Promise<SourceStatementMatches> {
  if (!input.line.trim() || input.line.length > MAX_SOURCE_LOCATE_LINE_LENGTH) return { items: [], truncated: false };
  const limit = Math.min(10, Math.max(1, Math.floor(input.limit ?? 5)));
  const candidates = (await db.query<{ path: string; line: number; skeleton: string }>(`select st.path, st.line, st.skeleton
    from log_source_statements st join log_source_snapshots s on s.id=st.snapshot_id and s.organization_id=st.organization_id
    where st.organization_id=$1 and st.snapshot_id=$2 and s.status='ready' and st.match_key=any($3::text[])
    order by length(st.skeleton) desc, st.path, st.line limit $4`,
  [input.organizationId, input.snapshotId, statementMatchKeys(input.line), MAX_CANDIDATES + 1])).rows;
  const items: SourceStatementMatch[] = [];
  let truncated = candidates.length > MAX_CANDIDATES;
  for (const candidate of candidates.slice(0, MAX_CANDIDATES)) {
    if (!matchesStatementSkeleton(candidate.skeleton, input.line)) continue;
    if (items.length >= limit) { truncated = true; break; }
    const excerpt = await readSourceExcerpt(db, { ...input, path: candidate.path, line: candidate.line });
    if (excerpt) items.push({ ...excerpt, confidence: candidate.skeleton.includes(".*") ? 0.9 : 1 });
  }
  return { items, truncated };
}
