import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { quoteIdent } from "../../modules/catalog-kernel/security/catalogRoleManifest";
import { createEphemeralTestDatabase, isTestDatabaseAvailable, withTestClusterRoleCatalogLock } from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import { createPostgresDatabase } from "./client";

const available = await isTestDatabaseAvailable();

describe.skipIf(!available)("log skill revisions migration backfill over PostgreSQL", () => {
  it("backfills published v1 and run pins without changing existing identities or references", async () => {
    await withTestClusterRoleCatalogLock(async () => {
      const ephemeral = await createEphemeralTestDatabase("skillbackfill");
      const db = createPostgresDatabase(ephemeral.url);
      const writer = `logskills_writer_${randomUUID().replaceAll("-", "")}`;
      try {
        // Rewind this migration's DDL on a disposable clone, then upgrade real data.
        await db.query(`drop trigger log_skill_requires_publication on log_domains;
          alter table log_analysis_runs drop column skill_revision_id;
          drop table log_skill_revisions;
          drop function protect_log_skill_revision(); drop function require_log_skill_published_revision();`);
        await db.query(`create role ${quoteIdent(writer)} nologin; grant usage on schema public to ${quoteIdent(writer)};
          grant select, insert, update, delete on log_domains to ${quoteIdent(writer)};`);
        await seedCoreGraph(db, { organization: { id: "org-skills", name: "技能" }, users: [{ id: "org-skills-admin", name: "管理员" }] });
        await db.query(`insert into log_domains (id, organization_id, name, format_profile, model_override)
          values ('legacy-skill', 'org-skills', '旧技能', '{"severityMap":{"error":["ALERT"]}}', 'old-model');
          insert into log_file_objects (id, organization_id, storage_key, file_name, content_type, file_size_bytes, checksum_sha256)
          values ('legacy-file', 'org-skills', 'legacy-file', 'legacy.log', 'text/plain', 1, 'hash');
          insert into log_records (id, organization_id, file_object_id, file_name, source, status, log_domain_id)
          values ('legacy-record', 'org-skills', 'legacy-file', 'legacy.log', 'upload', 'complete', 'legacy-skill'),
            ('generic-record', 'org-skills', 'legacy-file', 'legacy.log', 'upload', 'complete', null);
          insert into log_analysis_runs (id, organization_id, log_record_id, status, current_stage, progress)
          values ('legacy-run', 'org-skills', 'legacy-record', 'complete', 'report', 100),
            ('generic-run', 'org-skills', 'generic-record', 'complete', 'report', 100);`);
        await db.query(`insert into knowledge_entries (id, organization_id, title, content_form, status, source_type, created_by_user_id, search_text)
          values ('40000000-0000-4000-8000-000000000001', 'org-skills', '知识', 'markdown', 'published', 'human', 'org-skills-admin', '知识');
          insert into log_domain_knowledge_links (id, organization_id, log_domain_id, knowledge_entry_id, created_by_user_id)
          values ('legacy-link', 'org-skills', 'legacy-skill', '40000000-0000-4000-8000-000000000001', 'org-skills-admin');
          insert into log_feedback (id, organization_id, log_record_id, run_id, user_id, rating)
          values ('legacy-feedback', 'org-skills', 'legacy-record', 'legacy-run', 'org-skills-admin', 'helpful');
          insert into log_webhook_outbox (id, organization_id, log_domain_id, log_record_id, run_id, payload)
          values ('legacy-webhook', 'org-skills', 'legacy-skill', 'legacy-record', 'legacy-run', '{"old":true}');`);
        const preservedTables = ["log_records", "log_domains", "log_feedback", "log_domain_knowledge_links", "log_webhook_outbox"];
        const before = await Promise.all(preservedTables.map(async (table) => (await db.query(`select * from ${table} order by id`)).rows));
        const migration = await readFile(new URL("../../migrations/0187_log_skill_revisions.sql", import.meta.url), "utf8");
        await db.transaction(async (tx) => { await tx.query(migration); });
        expect((await db.query(`select revision_number, status, spec from log_skill_revisions where skill_id = 'legacy-skill'`)).rows).toEqual([{
          revision_number: 1, status: "published", spec: { schemaVersion: "skill/v1", formatProfile: { severityMap: { error: ["ALERT"] } }, modelOverride: "old-model" }
        }]);
        expect((await db.query(`select id, skill_revision_id from log_analysis_runs order by id`)).rows).toEqual([
          { id: "generic-run", skill_revision_id: null }, { id: "legacy-run", skill_revision_id: "skill-revision-1:legacy-skill" }
        ]);
        expect(await Promise.all(preservedTables.map(async (table) => (await db.query(`select * from ${table} order by id`)).rows))).toEqual(before);
        for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
          expect((await db.query<{ allowed: boolean }>(`select has_table_privilege($1, 'log_skill_revisions', $2) as allowed`, [writer, privilege])).rows[0].allowed).toBe(true);
        }
        expect((await db.query(`select confdeltype from pg_constraint
          where conrelid = 'log_skill_revisions'::regclass and confrelid = 'users'::regclass`)).rows)
          .toEqual([{ confdeltype: "n" }, { confdeltype: "n" }]);
        await db.transaction(async (tx) => {
          await tx.query(`set local role ${quoteIdent(writer)}`);
          expect((await tx.query(`select id from log_skill_revisions`)).rows).toHaveLength(1);
          await tx.query(`insert into log_skill_revisions (id, organization_id, skill_id, revision_number, status, spec, content_hash)
            values ('runtime-draft', 'org-skills', 'legacy-skill', 2, 'draft', '{"schemaVersion":"skill/v1"}', 'fixture');
            update log_skill_revisions set content_hash = 'updated' where id = 'runtime-draft';
            delete from log_skill_revisions where id = 'runtime-draft';`);
        });
        await expect(db.query(`insert into log_domains (id, organization_id, name) values ('no-revision', 'org-skills', '没有版本')`)).rejects.toThrow(/requires one published/);
      } finally {
        await db.query(`drop owned by ${quoteIdent(writer)}; drop role if exists ${quoteIdent(writer)}`);
        await db.close(); await ephemeral.drop();
      }
    });
  }, 120_000);
});
