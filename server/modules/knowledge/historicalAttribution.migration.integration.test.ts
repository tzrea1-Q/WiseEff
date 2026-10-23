import { describe, expect, it } from "vitest";
import { applyTestMigrations, migrationsDir, withTempDatabase } from "../../testing/tempDatabase";
import { isTestDatabaseAvailable } from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import { makeTestAuthContext } from "../../testing/authContext";
import { createMemoryObjectStore } from "../../testing/objectStore";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { requestJson } from "../../test/testClient";
import { registerKnowledgeRoutes } from "./routes";
import type { KnowledgeEntryDto } from "./types";

const available = await isTestDatabaseAvailable();

describe.skipIf(!available)("historical attribution migration", () => {
  it("marks backfilled names honestly, keeps missing actors unknown, and restores published-revision protection", async () => {
    await withTempDatabase({ prefix: "history1386upgrade", migrate: false }, async ({ db }) => {
      await applyTestMigrations(db, migrationsDir, { through: "0258_workflow_publication.sql" });
      const auth = makeTestAuthContext({ organizationId: "legacy-history", userId: "legacy-manager" });
      await seedCoreGraph(db, { organization: { id: auth.organization.id, name: "Migration-time organization" },
        users: [{ id: auth.user.id }, { id: "legacy-known", name: "Migration-time name" }, { id: "legacy-erased" }] });
      const knownId = "7ca3da01-10db-46dd-9a49-18ae00001386";
      const missingId = "7ca3da02-10db-46dd-9a49-18ae00001386";
      await db.query(`insert into knowledge_entries(id,organization_id,title,content_form,created_by_user_id)
        values($1,$3,'Known legacy author','markdown','legacy-known'),($2,$3,'Missing legacy author','markdown','legacy-erased')`,
      [knownId, missingId, auth.organization.id]);
      await db.query("delete from users where id='legacy-erased'");
      await db.transaction(async (tx) => {
        await tx.query("insert into log_domains(id,organization_id,name) values('history-skill',$1,'Legacy skill')", [auth.organization.id]);
        await tx.query(`insert into log_skill_revisions(id,organization_id,skill_id,revision_number,status,spec,content_hash,
          created_by_user_id,published_by_user_id) values('history-revision',$1,'history-skill',1,'published',
          '{"schemaVersion":"skill/v1"}','legacy-fixture','legacy-known','legacy-known')`, [auth.organization.id]);
      });
      await db.query("alter table log_skill_revisions enable always trigger log_skill_revision_immutable");
      await applyTestMigrations(db, migrationsDir);
      const router = createRouter();
      registerKnowledgeRoutes(router, { db, objectStore: createMemoryObjectStore(), getCurrentAuthContext: () => auth });
      const read = (id: string) => requestJson<{ item: KnowledgeEntryDto }>(createHttpServer(router), `/api/v1/knowledge/entries/${id}`);
      const expected = { organization: { id: auth.organization.id, name: "Migration-time organization", source: "legacy-current" },
        actors: { created_by_user_id: { id: "legacy-known", name: "Migration-time name", source: "legacy-current" } } };
      expect((await read(knownId)).body.item.historicalAttribution).toEqual(expected);
      expect((await read(missingId)).body.item.historicalAttribution?.actors.created_by_user_id)
        .toEqual({ id: null, name: null, source: "unknown" });
      await db.query("update users set name='Later name' where id='legacy-known'");
      await db.query("update organizations set name='Later organization' where id=$1", [auth.organization.id]);
      expect((await read(knownId)).body.item.historicalAttribution).toEqual(expected);
      expect((await db.query("select tgenabled from pg_trigger where tgrelid='log_skill_revisions'::regclass and tgname='log_skill_revision_immutable'")).rows)
        .toEqual([{ tgenabled: "A" }]);
      await expect(db.query("update log_skill_revisions set content_hash='rewritten' where id='history-revision'"))
        .rejects.toThrow(/immutable/);
    });
  }, 120_000);
});
