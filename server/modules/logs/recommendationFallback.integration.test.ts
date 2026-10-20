import { readFileSync } from "node:fs";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { createEphemeralTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { createPostgresDatabase, type Database } from "../../shared/database/client";
import { seedCoreGraph } from "../../testing/fixtures";
import { makeTestAuthContext } from "../../testing/authContext";
import { createMemoryObjectStore } from "../../testing/objectStore";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { requestJson } from "../../test/testClient";
import { registerLogRoutes } from "./routes";
import { provisionChargingSkill } from "./provisionChargingSkill";
import { insertSkillRevision, lockSkill, publishSkillRevision } from "./skillsRepository";
import type { LogRecordDto } from "./types";

const available = await isTestDatabaseAvailable();
const auth = makeTestAuthContext({ organizationId: "fallback-org", userId: "fallback-user",
  roles: [{ roleId: "admin", projectId: null }], permissions: ["logs:view", "logs:upload"] });
const sample = readFileSync("test-fixtures/logs/charging-foldback.log");
const uploadBody = { fileName: "charging.log", contentType: "text/plain", contentBase64: sample.toString("base64") };
type Upload = { log: LogRecordDto; fileObject: { id: string }; job: { id: string } };

function api(db: Database, objectStore = createMemoryObjectStore()) {
  const router = createRouter();
  registerLogRoutes(router, { db, objectStore, getCurrentAuthContext: () => auth });
  return <T,>(path: string, method = "GET", body?: unknown) => requestJson<T>(createHttpServer(router), path,
    { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

async function seed(db: Database) {
  await seedCoreGraph(db, { organization: { id: auth.organization.id, name: "Fallback" }, users: [{ id: auth.user.id, name: "Uploader" }] });
  await provisionChargingSkill(db, auth.organization.id);
}

describe.skipIf(!available)("advisory routing cannot abort uploads", () => {
  it("preserves the caller's statement timeout and restores its lock timeout", async () => {
    const ephemeral = await createEphemeralTestDatabase("reco_timeout");
    const db = createPostgresDatabase(ephemeral.url);
    try {
      await seed(db);
      await db.transaction(async (tx) => {
        await tx.query("select set_config('statement_timeout', '5s', true), set_config('lock_timeout', '3s', true)");
        let observed = false;
        const inspect = (connection: Database): Database => ({
          query: async <Row,>(sql: string, values?: unknown[]) => {
            if (sql.includes('r.skill_id as "skillId"')) {
              observed = true;
              expect((await connection.query("select current_setting('statement_timeout') as statement, current_setting('lock_timeout') as lock")).rows)
                .toEqual([{ statement: "5s", lock: "200ms" }]);
            }
            return connection.query<Row>(sql, values);
          },
          transaction: (fn) => connection.transaction((inner) => fn(inspect(inner)))
        });
        const response = await api(inspect(tx))<Upload>("/api/v1/log-files", "POST", uploadBody);
        expect(response.status).toBe(201);
        expect(response.body.log.skillSelection?.mode).toBe("recommended");
        expect(observed).toBe(true);
        expect((await tx.query("select current_setting('statement_timeout') as statement, current_setting('lock_timeout') as lock")).rows)
          .toEqual([{ statement: "5s", lock: "3s" }]);
      });
    } finally { await db.close(); await ephemeral.drop(); }
  });

  it("pins the scored immutable revision when a newer revision publishes before intake", async () => {
    const ephemeral = await createEphemeralTestDatabase("reco_pin");
    const db = createPostgresDatabase(ephemeral.url);
    try {
      await seed(db);
      const skillId = `seed-charging:${auth.organization.id}`;
      const nextRevisionId = await insertSkillRevision(db, { organizationId: auth.organization.id, skillId,
        userId: auth.user.id, spec: { schemaVersion: "skill/v1" } });
      let published = false;
      const interleave = (connection: Database): Database => ({
        query: async <Row,>(sql: string, values?: unknown[]) => {
          const result = await connection.query<Row>(sql, values);
          if (!published && sql.includes('r.skill_id as "skillId"')) {
            published = true;
            await db.transaction(async (publisher) => {
              await lockSkill(publisher, auth.organization.id, skillId);
              await publishSkillRevision(publisher, auth.organization.id, skillId, nextRevisionId, auth.user.id);
            });
          }
          return result;
        },
        transaction: (fn) => connection.transaction((tx) => fn(interleave(tx)))
      });
      const response = await api(interleave(db))<Upload>("/api/v1/log-files", "POST", uploadBody);
      expect(response.status).toBe(201);
      expect(published).toBe(true);
      expect(response.body.log).toMatchObject({ logDomainId: skillId,
        skillRevision: { id: `seed-charging-revision:${auth.organization.id}`, number: 1 },
        skillSelection: { mode: "recommended", reasons: expect.arrayContaining([expect.objectContaining({ detail: expect.stringContaining("thermal-foldback") })]) } });
      expect((await db.query("select id from log_skill_revisions where organization_id=$1 and status='published'", [auth.organization.id])).rows)
        .toEqual([{ id: nextRevisionId }]);
    } finally { await db.close(); await ephemeral.drop(); }
  });

  it("skips a locked published skill for both upload APIs while its transaction remains open", async () => {
    const ephemeral = await createEphemeralTestDatabase("reco_lock");
    const db = createPostgresDatabase(ephemeral.url), blocker = new pg.Client({ connectionString: ephemeral.url });
    try {
      await seed(db);
      const request = api(db);
      const source = await request<Upload>("/api/v1/log-files", "POST", { ...uploadBody, skillSelection: "generic" });
      expect(source.status).toBe(201);
      await blocker.connect();
      await blocker.query("begin");
      await blocker.query("select id from log_domains where organization_id=$1 for update", [auth.organization.id]);
      await blocker.query("select id from log_skill_revisions where organization_id=$1 and status='published' for update", [auth.organization.id]);
      const held = (await blocker.query("select txid_current_if_assigned()::text as id")).rows[0].id;
      // Cleanup guard for a blocking regression, not a latency assertion.
      const watchdog = setTimeout(() => { void blocker.query("rollback"); }, 20_000);
      try {
        for (const [path, body] of [["/api/v1/log-files", uploadBody], ["/api/v1/logs", {
          fileObjectId: source.body.fileObject.id, fileName: uploadBody.fileName
        }]] as const) {
          const response = await request<Upload>(path, "POST", body);
          expect(response.status).toBe(201);
          expect(response.body.log).toMatchObject({ skillRevision: null, skillSelection: { mode: "generic", reasons: [] } });
          expect(response.body.log.logDomainId).toBeUndefined();
          const readback = await request<{ item: LogRecordDto }>(`/api/v1/logs/${response.body.log.id}`);
          expect(readback.body.item.skillSelection?.mode).toBe("generic");
          expect((await blocker.query("select txid_current_if_assigned()::text as id")).rows[0].id).toBe(held);
        }
      } finally { clearTimeout(watchdog); }
    } finally {
      await blocker.query("rollback").catch(() => undefined);
      await blocker.end(); await db.close(); await ephemeral.drop();
    }
  });

  it.each(["error", "cancellation"] as const)("recovers a PostgreSQL recommendation %s inside the upload transaction", async (fault) => {
    const ephemeral = await createEphemeralTestDatabase(`reco_${fault}`);
    const db = createPostgresDatabase(ephemeral.url);
    try {
      await seed(db);
      const objectStore = createMemoryObjectStore();
      const source = await api(db, objectStore)<Upload>("/api/v1/log-files", "POST", { ...uploadBody, skillSelection: "generic" });
      expect(source.status).toBe(201);
      // Execute a real PostgreSQL error/cancellation on the same session: catching
      // a JavaScript rejection alone would not prove transaction recovery.
      const inject = (connection: Database): Database => ({
        query: (sql, values) => sql.includes('r.skill_id as "skillId"')
          ? connection.query(fault === "error" ? "select 1/0"
            : "do $$ begin raise exception 'injected query cancellation' using errcode='57014'; end $$") : connection.query(sql, values),
        transaction: (fn) => connection.transaction((tx) => fn(inject(tx)))
      });
      const request = api(inject(db), objectStore);
      for (const [path, body] of [["/api/v1/log-files", uploadBody], ["/api/v1/logs", {
        fileObjectId: source.body.fileObject.id, fileName: uploadBody.fileName
      }]] as const) {
        const response = await request<Upload>(path, "POST", body);
        expect(response.status).toBe(201);
        expect(response.body.log).toMatchObject({ skillRevision: null, skillSelection: { mode: "generic", reasons: [] } });
        expect(response.body.job.id).toBeTruthy();
        const readback = await request<{ item: LogRecordDto }>(`/api/v1/logs/${response.body.log.id}`);
        expect(readback.body.item.skillSelection?.mode).toBe("generic");
      }
      const explicit = await request<Upload>("/api/v1/log-files", "POST", { ...uploadBody, skillId: `seed-charging:${auth.organization.id}` });
      expect(explicit.status).toBe(201);
      expect(explicit.body.log).toMatchObject({ logDomainId: `seed-charging:${auth.organization.id}`, skillSelection: { mode: "explicit", reasons: [] } });
    } finally { await db.close(); await ephemeral.drop(); }
  });
});
