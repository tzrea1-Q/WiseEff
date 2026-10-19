import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createEphemeralTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { createPostgresDatabase } from "../../shared/database/client";
import { applyMigrations } from "../../shared/database/migrations";
import { seedCoreGraph } from "../../testing/fixtures";
import { makeTestAuthContext } from "../../testing/authContext";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { requestJson } from "../../test/testClient";
import { registerLogRoutes } from "./routes";
import { createLocalObjectStore } from "./objectStore";
import { processLogAnalysisJobById } from "./worker";
import type { getLogSkill } from "./skillsService";
import type { LogRecordDto } from "./types";
import type { LogSkillRevisionDto } from "./skillsRepository";

const available = await isTestDatabaseAvailable();
type Skill = Awaited<ReturnType<typeof getLogSkill>>;
const auth = (organizationId = "org-keys") => makeTestAuthContext({ organizationId,
  userId: `${organizationId}-admin`, roles: [{ roleId: "admin", projectId: null }],
  permissions: ["logs:view", "logs:upload", "logs:admin-domains"] });

describe.skipIf(!available)("analysis skill integration keys over PostgreSQL", () => {
  it("creates stable unique keys, audits admin edits, resolves both upload APIs and pins the published revision", async () => {
    const ephemeral = await createEphemeralTestDatabase("skillkeys");
    const db = createPostgresDatabase(ephemeral.url);
    const objectRoot = await mkdtemp(join(tmpdir(), "log-skill-keys-"));
    try {
      for (const id of ["org-keys", "org-other"]) await seedCoreGraph(db, {
        organization: { id, name: id }, users: [{ id: `${id}-admin`, name: "Administrator" }]
      });
      let currentAuth = auth();
      const objectStore = createLocalObjectStore(objectRoot);
      const router = createRouter();
      registerLogRoutes(router, { db, objectStore, getCurrentAuthContext: () => currentAuth });
      const request = <T,>(url: string, method = "GET", body?: unknown) => requestJson<T>(createHttpServer(router), url,
        { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const create = async (name: string) => (await request<{ item: Skill }>("/api/v1/log-skills", "POST", { name })).body.item;
      const skill = await create("Device Analysis");
      expect(skill.skillKey).toBe("device-analysis");
      const collision = await create("Device---Analysis");
      expect(collision.skillKey).toMatch(/^device-analysis-[a-f0-9]{8}$/);
      const unicode = await create("设备诊断");
      expect(unicode.skillKey).toMatch(/^skill-[a-f0-9]{8}$/);
      // Replay only this migration against identities predating skillKey.
      await db.query("alter table log_domains drop column skill_key cascade; drop function assign_log_skill_key() cascade");
      await db.query("delete from schema_migrations where name = '0202_log_skill_keys.sql'");
      expect(await applyMigrations(db, fileURLToPath(new URL("../../migrations", import.meta.url)))).toEqual(["0202_log_skill_keys.sql"]);
      expect((await request<{ items: Skill[] }>("/api/v1/log-skills")).body.items.map((item) => item.skillKey).sort())
        .toEqual([skill.skillKey, collision.skillKey, unicode.skillKey].sort());
      expect((await request<{ item: Skill }>(`/api/v1/log-domains/${skill.id}`, "PATCH", { name: "Renamed Device" })).body.item.skillKey).toBe(skill.skillKey);
      for (const skillKey of ["UPPER", "x", "-invalid", "a".repeat(64), collision.skillKey]) {
        expect((await request(`/api/v1/log-domains/${skill.id}`, "PATCH", { skillKey })).status).toBe(400);
      }
      currentAuth = { ...auth(), permissions: ["logs:view"] };
      expect((await request(`/api/v1/log-domains/${skill.id}`, "PATCH", { skillKey: "device-results" })).status).toBe(403);
      currentAuth = auth();
      expect((await request(`/api/v1/log-domains/${skill.id}`, "PATCH", { skillKey: "device-results" })).status).toBe(200);
      expect((await db.query<{ metadata: unknown }>(`select metadata from audit_events where target_id=$1
        and metadata->>'previousSkillKey'=$2`, [skill.id, skill.skillKey])).rows[0].metadata)
        .toMatchObject({ previousSkillKey: "device-analysis", skillKey: "device-results" });

      const base = `/api/v1/log-skills/${skill.id}`;
      const draft = (await request<{ item: LogSkillRevisionDto }>(`${base}/draft`, "PUT", {
        spec: { schemaVersion: "skill/v1", description: "Next published configuration" },
        baseDraftRevisionId: null, basePublishedRevisionId: skill.currentRevision.id
      })).body.item;
      const uploadBody = { fileName: "device.log", contentType: "text/plain", skillKey: "device-results",
        contentBase64: Buffer.from("ERROR failed\n").toString("base64") };
      type Upload = { log: LogRecordDto; fileObject: { id: string }; job: { id: string } };
      const before = await request<Upload>("/api/v1/log-files", "POST", uploadBody);
      expect(before.status).toBe(201);
      expect(before.body.log.skillRevision).toEqual({ id: skill.currentRevision.id, number: 1 });
      expect((await request(`${base}/publish`, "POST", { draftRevisionId: draft.id })).status).toBe(200);
      const uploaded = await request<Upload>("/api/v1/log-files", "POST", uploadBody);
      expect(uploaded.status).toBe(201);
      expect(uploaded.body.log.skillRevision).toEqual({ id: draft.id, number: 2 });
      await processLogAnalysisJobById({ db, objectStore, jobId: uploaded.body.job.id });
      expect((await request<{ item: LogRecordDto }>(`/api/v1/logs/${uploaded.body.log.id}`)).body.item)
        .toMatchObject({ status: "complete", skillRevision: { id: draft.id, number: 2 } });
      const fromFile = { fileObjectId: uploaded.body.fileObject.id, fileName: "device.log", skillKey: "device-results" };
      const reused = await request<{ log: LogRecordDto }>("/api/v1/logs", "POST", fromFile);
      expect(reused.status).toBe(201);
      expect(reused.body.log.skillRevision).toEqual({ id: draft.id, number: 2 });
      for (const [path, body] of [["/api/v1/log-files", uploadBody], ["/api/v1/logs", fromFile]] as const) {
        for (const selection of [{ skillKey: "missing-skill" }, { skillKey: "device-results", skillId: collision.id },
          { skillKey: "device-results", logDomainId: collision.id }, { skillId: skill.id, logDomainId: collision.id }]) {
          expect((await request(path, "POST", { ...body, ...selection })).status).toBe(400);
        }
        expect((await request(path, "POST", { ...body, skillId: skill.id, logDomainId: skill.id })).status).toBe(201);
        currentAuth = auth("org-other");
        expect((await request(path, "POST", body)).status).toBe(400);
        currentAuth = auth();
      }
      currentAuth = auth("org-other");
      expect((await create("Device Results")).skillKey).toBe("device-results");
    } finally {
      await db.close();
      await ephemeral.drop();
      await rm(objectRoot, { recursive: true, force: true });
    }
  }, 120_000);
});
