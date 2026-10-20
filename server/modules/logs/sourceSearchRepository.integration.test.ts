import { describe, expect, it } from "vitest";
import { createEphemeralTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { createPostgresDatabase } from "../../shared/database/client";
import { seedCoreGraph } from "../../testing/fixtures";
import { makeTestAuthContext } from "../../testing/authContext";
import { createUserInvocation } from "../auth/trustedInvocation";
import { createLogSkill } from "./skillsService";
import { sourceChunks } from "./sourceArchive";
import { MAX_SOURCE_SEARCH_CANDIDATES, SOURCE_SEARCH_TIMEOUT_MS, readSourceRange, searchSource } from "./sourceSearchRepository";
import { readSourceExcerpt } from "./sourceStatementRepository";

const available = await isTestDatabaseAvailable();
describe.skipIf(!available)("indexed source search and range reads over PostgreSQL", () => {
  it("bounds scoring before ranking common tokens and degrades database timeouts without leaking transaction state", async () => {
    const ephemeral = await createEphemeralTestDatabase("sourcebudget");
    const db = createPostgresDatabase(ephemeral.url);
    const organizationId = "source-budget-org";
    try {
      await seedCoreGraph(db, { organization: { id: organizationId }, users: [{ id: "source-budget-admin" }] });
      const auth = makeTestAuthContext({ organizationId, userId: "source-budget-admin", roles: [{ roleId: "admin", projectId: null }], permissions: ["logs:admin-domains"] });
      const skill = await createLogSkill(db, auth, { name: "Search budget" }, createUserInvocation(auth), { requestId: "source-budget" });
      await db.query(`insert into log_source_snapshots(id,organization_id,skill_id,version_label,status,storage_key,file_name)
        values('source-budget',$1,$2,'v1','ready','unused','source.zip')`, [organizationId, skill.id]);
      await db.query(`insert into log_source_files(id,organization_id,snapshot_id,path,size_bytes,sha256,line_count,language)
        select 'budget-file-' || i,$1,'source-budget','drivers/common-' || i || '.c',2097088,'unused',64,'c'
        from generate_series(0,63) i`, [organizationId]);
      // 64 files below 2 MiB each, 4096 near-32 KiB chunks: approximately 128 MiB, all matching return.
      await db.query(`insert into log_source_chunks(id,organization_id,snapshot_id,file_id,start_line,end_line,content,chunk_ordinal)
        select 'budget-' || i,$1,'source-budget','budget-file-' || ((i-1)/64),(i-1)%64+1,(i-1)%64+1,
          'return ' || repeat('padding ',4095),(i-1)%64
        from generate_series(1,4096) i`, [organizationId]);
      await db.query("analyze log_source_chunks");
      const base = { organizationId, snapshotId: "source-budget", pathGlob: "drivers/**", query: "return", limit: 1 };
      await db.transaction(async (tx) => {
        // Session-local lookup probes count actual scoring calls, including any repeated evaluation.
        await tx.query("create schema score_probe");
        await tx.query("create sequence score_probe.calls");
        await tx.query(`create function score_probe.similarity(text,text) returns real volatile language plpgsql as $$
          begin perform nextval('score_probe.calls'); return public.similarity($1,$2); end $$`);
        await tx.query(`create function score_probe.ts_rank_cd(tsvector,tsquery) returns real volatile language plpgsql as $$
          begin perform nextval('score_probe.calls'); return pg_catalog.ts_rank_cd($1,$2); end $$`);
        await tx.query("set local search_path = score_probe, public, pg_catalog");
        for (const mode of ["literal", "full_text"] as const) {
          await tx.query("select setval('score_probe.calls', 1, false)");
          const started = performance.now();
          const result = await searchSource(tx, { ...base, mode });
          const elapsed = performance.now() - started;
          console.info(`source search ${mode}: ${elapsed.toFixed(1)} ms, ${result.items.length} hits, ${result.reason ?? "completed"}`);
          expect(result.items).toHaveLength(1);
          expect(result.truncated).toBe(true);
          expect(result.reason).toBeUndefined();
          expect(elapsed).toBeLessThan(SOURCE_SEARCH_TIMEOUT_MS);
          expect((await tx.query<{ last_value: string }>("select last_value from score_probe.calls")).rows[0].last_value)
            .toBe(String(MAX_SOURCE_SEARCH_CANDIDATES));
          console.info(`source search ${mode}: counter confirms ${MAX_SOURCE_SEARCH_CANDIDATES} scored / 4096 chunks`);
        }
      });
      await expect(searchSource(db, { ...base, mode: "literal", pathGlob: "**" })).rejects.toThrow("搜索词过于常见，且未指定固定路径前缀。请缩小 pathGlob（例如 drivers/power/**）或使用更具体的搜索词。");
      for (const mode of ["literal", "full_text"] as const)
        await expect(searchSource(db, { ...base, mode, query: "ab" })).rejects.toThrow(/至少需要三个字符/);
      await db.transaction(async (tx) => {
        await tx.query("set local statement_timeout = '5s'");
        await searchSource(tx, { ...base, mode: "literal" });
        expect((await tx.query<{ timeout: string }>("select current_setting('statement_timeout') as timeout")).rows[0].timeout).toBe("5s");
      });
      await db.transaction(async (blocker) => {
        await blocker.query("lock table log_source_chunks in access exclusive mode");
        const started = performance.now();
        expect(await searchSource(db, { ...base, mode: "literal" })).toEqual({ items: [], truncated: true, reason: "statement_timeout" });
        const elapsed = performance.now() - started;
        expect(elapsed).toBeGreaterThanOrEqual(SOURCE_SEARCH_TIMEOUT_MS - 50);
        expect(elapsed).toBeLessThan(SOURCE_SEARCH_TIMEOUT_MS + 500);
        console.info(`source search blocked-query deadline: ${elapsed.toFixed(1)} ms`);
        await db.transaction(async (tx) => {
          await tx.query("set local statement_timeout = '100ms'");
          const nestedStarted = performance.now();
          expect(await searchSource(tx, { ...base, mode: "literal" })).toEqual({ items: [], truncated: true, reason: "statement_timeout" });
          const nestedElapsed = performance.now() - nestedStarted;
          expect(nestedElapsed).toBeLessThan(500);
          expect((await tx.query<{ timeout: string }>("select current_setting('statement_timeout') as timeout")).rows[0].timeout).toBe("100ms");
          console.info(`source search nested 100ms deadline: ${nestedElapsed.toFixed(1)} ms`);
        });
      });
      expect((await searchSource(db, { ...base, mode: "literal" })).items).toHaveLength(1);
    } finally { await db.close(); await ephemeral.drop(); }
  }, 120_000);

  it("uses literal/full-text predicates, path globs and exact numbered ranges under tenant and ready scope", async () => {
    const ephemeral = await createEphemeralTestDatabase("sourcesearch");
    const db = createPostgresDatabase(ephemeral.url);
    const organizationId = "source-search-org";
    try {
      await seedCoreGraph(db, { organization: { id: organizationId }, users: [{ id: "source-search-admin" }] });
      const auth = makeTestAuthContext({ organizationId, userId: "source-search-admin", roles: [{ roleId: "admin", projectId: null }], permissions: ["logs:admin-domains"] });
      const skill = await createLogSkill(db, auth, { name: "Source search" }, createUserInvocation(auth), { requestId: "source-search" });
      await db.query(`insert into log_source_snapshots(id,organization_id,skill_id,version_label,status,storage_key,file_name)
        values('source-search-snapshot',$1,$2,'v1','ready','unused','source.zip')`, [organizationId, skill.id]);
      const content = Array.from({ length: 120 }, (_, i) => i === 4 ? "power_limit = thermal_foldback; // abc%_ exact literal"
        : i === 89 ? "power_limit = recovery;" : `// source line ${i + 1}`).join("\n");
      for (const [id, path, text] of [["root", "drivers/power/main.c", content], ["nested", "drivers/power/nested/deep.c", "thermal power recovery"],
        ["other", "drivers/other/main.c", "thermal power recovery"], ["long", "long.c", "x".repeat(40_000) + "\nnext"],
        ["boundary", "boundary.c", "x".repeat(32_764) + " thermal"], ["short-boundary", "short-boundary.c", "x".repeat(32_766) + " abc"],
        ["newline", "newline.c", "// trailing newline\n"]]) {
        await db.query(`insert into log_source_files(id,organization_id,snapshot_id,path,size_bytes,sha256,line_count,language)
          values($1,$2,'source-search-snapshot',$3,$4,'unused',$5,'c')`, [id, organizationId, path, text.length, text.split("\n").length]);
        let ordinal = 0;
        for (const chunk of sourceChunks(text)) await db.query(`insert into log_source_chunks(id,organization_id,snapshot_id,file_id,start_line,end_line,content,chunk_ordinal)
          values($1,$2,'source-search-snapshot',$3,$4,$5,$6,$7)`, [`${id}-${ordinal}`, organizationId, id, chunk.startLine, chunk.endLine, chunk.content, ordinal++]);
      }
      const base = { organizationId, snapshotId: "source-search-snapshot", pathGlob: "drivers/power/**/*.c", limit: 20 };
      const literal = await searchSource(db, { ...base, query: "abc%_", mode: "literal" });
      expect(literal.items).toEqual([expect.objectContaining({ path: "drivers/power/main.c", line: 5, snapshotId: base.snapshotId })]);
      const fullText = await searchSource(db, { ...base, query: "thermal power", mode: "full_text" });
      expect(fullText.items).toEqual([expect.objectContaining({ path: "drivers/power/nested/deep.c", line: 1 }),
        expect.objectContaining({ path: "drivers/power/main.c", line: 5 })]);
      expect(fullText.items[0].rank).toBeGreaterThan(0);
      for (const mode of ["literal", "full_text"] as const) {
        expect((await searchSource(db, { ...base, pathGlob: "boundary.c", query: "thermal", mode })).items)
          .toEqual([expect.objectContaining({ path: "boundary.c", line: 1 })]);
      }
      expect((await searchSource(db, { ...base, pathGlob: "short-boundary.c", query: "abc", mode: "literal" })).items)
        .toEqual([expect.objectContaining({ path: "short-boundary.c", line: 1 })]);
      const capped = await searchSource(db, { ...base, query: "source line", mode: "literal", limit: 1 });
      expect(capped.items).toHaveLength(1); expect(capped.truncated).toBe(true);
      await db.query(`insert into log_source_files(id,organization_id,snapshot_id,path,size_bytes,sha256,line_count,language)
        values('split',$1,'source-search-snapshot','capped/a.c',3000,'unused',402,'c'),
          ('combined',$1,'source-search-snapshot','capped/z.c',10,'unused',1,'c')`, [organizationId]);
      await db.query(`insert into log_source_chunks(id,organization_id,snapshot_id,file_id,start_line,end_line,content,chunk_ordinal)
        select 'split-' || i,$1,'source-search-snapshot','split',i*2-1,i*2,E'alpha\\nbeta',i
        from generate_series(1,201) i`, [organizationId]);
      await db.query(`insert into log_source_chunks(id,organization_id,snapshot_id,file_id,start_line,end_line,content,chunk_ordinal)
        values('combined-0',$1,'source-search-snapshot','combined',1,1,'alpha beta',0)`, [organizationId]);
      // Chunk matches can span lines even though a citable hit must identify one exact line.
      expect(await searchSource(db, { ...base, pathGlob: "capped/*.c", query: "alpha beta", mode: "full_text" }))
        .toMatchObject({ items: [], truncated: true });
      const range = await readSourceRange(db, { ...base, path: "drivers/power/main.c", startLine: 1, endLine: 100 });
      expect(range).toMatchObject({ startLine: 1, endLine: 80, totalLines: 120, truncated: true });
      expect(range?.lines).toHaveLength(80); expect(range?.lines[4]).toEqual({ line: 5, content: content.split("\n")[4] });
      const long = await readSourceRange(db, { ...base, path: "long.c", startLine: 1, endLine: 2 });
      expect(long?.lines.map((item) => [item.line, item.content.length])).toEqual([[1, 1000], [2, 4]]);
      expect(long?.truncated).toBe(true);
      expect((await readSourceRange(db, { ...base, path: "newline.c", startLine: 2, endLine: 2 }))?.lines)
        .toEqual([{ line: 2, content: "" }]);
      expect(await readSourceExcerpt(db, { ...base, path: "newline.c", line: 2 }))
        .toMatchObject({ line: 2, startLine: 1, excerpt: "// trailing newline\n" });
      expect((await searchSource(db, { ...base, organizationId: "other-org", query: "thermal", mode: "literal" })).items).toEqual([]);
      expect(await readSourceRange(db, { ...base, organizationId: "other-org", path: "long.c", startLine: 1, endLine: 2 })).toBeNull();
      await db.query("update log_source_snapshots set status='indexing' where id=$1", [base.snapshotId]);
      expect((await searchSource(db, { ...base, query: "thermal", mode: "literal" })).items).toEqual([]);
      expect(await readSourceRange(db, { ...base, path: "long.c", startLine: 1, endLine: 2 })).toBeNull();
    } finally { await db.close(); await ephemeral.drop(); }
  }, 120_000);
});
