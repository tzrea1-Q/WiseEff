import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createEphemeralTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { createPostgresDatabase } from "../../shared/database/client";
import { seedCoreGraph } from "../../testing/fixtures";
import { makeTestAuthContext } from "../../testing/authContext";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { requestJson } from "../../test/testClient";
import { registerLogRoutes } from "./routes";
import { createLocalObjectStore } from "./objectStore";
import { logSkillTemplates } from "./skillTemplates";
import type { getLogSkill } from "./skillsService";
import type { getLogSkillSample } from "./skillSamplesService";

const available = await isTestDatabaseAvailable();
type Skill = Awaited<ReturnType<typeof getLogSkill>>;
type Sample = NonNullable<Awaited<ReturnType<typeof getLogSkillSample>>>;
const auth = (organizationId = "org-templates", permissions = ["logs:view", "logs:admin-domains"]) => makeTestAuthContext({
  organizationId, userId: `${organizationId}-admin`, roles: [{ roleId: "admin", projectId: null }], permissions
});
describe.skipIf(!available)("skill templates and samples over PostgreSQL", () => {
  it("creates templates and draft/published copies, isolates samples, and audits transactional writes", async () => {
    const ephemeral = await createEphemeralTestDatabase("skilltemplates");
    const db = createPostgresDatabase(ephemeral.url);
    const root = await mkdtemp(join(tmpdir(), "skill-samples-"));
    try {
      for (const id of ["org-templates", "org-other"]) await seedCoreGraph(db, {
        organization: { id, name: id }, users: [{ id: `${id}-admin`, name: "Admin" }]
      });
      let current = auth();
      const router = createRouter();
      const store = createLocalObjectStore(root);
      registerLogRoutes(router, { db, objectStore: store, getCurrentAuthContext: () => current });
      const request = <T,>(url: string, method = "GET", body?: unknown) => requestJson<T>(createHttpServer(router), url,
        { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      expect((await request("/api/v1/log-skill-templates")).body).toEqual({ items: logSkillTemplates });
      const skills: Skill[] = [];
      for (const template of logSkillTemplates) {
        const created = await request<{ item: Skill }>("/api/v1/log-skills", "POST", { name: template.id, startingPoint: { templateId: template.id } });
        expect(created.status).toBe(201);
        expect(created.body.item.currentRevision).toMatchObject({ number: 1, status: "published", spec: template.spec });
        expect(created.body.item.currentRevision.spec).toEqual(template.spec);
        skills.push(created.body.item);
      }
      expect((await request("/api/v1/log-skills", "POST", { name: "bad", startingPoint: { templateId: "unknown" } })).status).toBe(400);
      const skill = skills[1], base = `/api/v1/log-skills/${skill.id}`;
      const copy = async (name: string) => request<{ item: Skill }>("/api/v1/log-skills", "POST", { name, startingPoint: { copyFromSkillId: skill.id } });
      expect((await copy("published copy")).body.item.currentRevision.spec).toEqual(skill.currentRevision.spec);
      const draftSpec = { ...skill.currentRevision.spec, procedure: "## Custom draft", description: "draft", modelOverride: "copied-model" };
      expect((await request(`${base}/draft`, "PUT", { spec: draftSpec, baseDraftRevisionId: null, basePublishedRevisionId: skill.currentRevision.id })).status).toBe(200);
      const draftCopy = (await copy("draft copy")).body.item;
      expect(draftCopy.currentRevision.spec).toEqual(draftSpec);
      expect(draftCopy.modelOverride).toBe("copied-model");
      const put = (content: Buffer, fileName = "sample.log") => request(`${base}/sample`, "PUT", { fileName, contentBase64: content.toString("base64") });
      expect((await request<{ item: Sample | null }>(`${base}/sample`)).body.item).toBeNull();
      expect((await put(Buffer.from("first\r\nsecond"))).status).toBe(200);
      expect((await request<{ item: Sample }>(`${base}/sample`)).body.item).toMatchObject({ fileName: "sample.log", content: "first\nsecond", lineCount: 2, truncated: false });
      const objectKey = (await db.query<{ object_key: string }>("select object_key from log_skill_samples where skill_id=$1", [skill.id])).rows[0].object_key;
      expect((await put(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("你好\r\n日志", "utf16le")]))).status).toBe(200);
      expect((await request<{ item: Sample }>(`${base}/sample`)).body.item).toMatchObject({ encoding: "utf-16le", content: "你好\n日志", lineCount: 2 });
      const many = Array.from({ length: 5001 }, (_, i) => `line ${i + 1}`).join("\n");
      expect((await put(Buffer.from(many))).status).toBe(200);
      const sample = (await request<{ item: Sample }>(`${base}/sample`)).body.item;
      expect(sample).toMatchObject({ lineCount: 5001, truncated: true });
      expect(sample.content.split("\n")).toHaveLength(5000);
      expect(sample.content).not.toContain("line 5001");
      expect((await put(Buffer.from([0, 1, 2, 3]))).status).toBe(400);
      expect((await put(Buffer.from("text"), "sample.zip")).status).toBe(400);
      expect((await put(Buffer.from([0x50, 0x4b, 3, 4]), "sample.log")).status).toBe(400);
      expect((await put(Buffer.alloc(2 * 1024 * 1024 + 1, 65))).status).toBe(400);
      expect((await request<{ item: Sample }>(`${base}/sample`)).body.item.id).toBe(sample.id);
      const copied = (await copy("copy without sample")).body.item;
      expect((await request<{ item: Sample | null }>(`/api/v1/log-skills/${copied.id}/sample`)).body.item).toBeNull();
      current = auth("org-other");
      expect((await copy("cross-org copy")).status).toBe(404);
      expect((await request(`${base}/sample`)).status).toBe(404);
      expect((await put(Buffer.from("other"))).status).toBe(404);
      expect((await request(`${base}/sample`, "DELETE")).status).toBe(404);
      current = auth("org-templates", ["logs:view"]);
      expect((await request(`${base}/sample`)).status).toBe(200);
      expect((await request("/api/v1/log-skill-templates")).status).toBe(403);
      expect((await put(Buffer.from("viewer"))).status).toBe(403);
      expect((await request(`${base}/sample`, "DELETE")).status).toBe(403);
      current = auth();
      await db.query("alter table audit_events add constraint reject_sample_audit check (kind not in ('log-skill-sample-replace', 'log-skill-sample-delete')) not valid");
      expect((await put(Buffer.from("audit must succeed"))).status).toBe(500);
      expect((await request(`${base}/sample`, "DELETE")).status).toBe(500);
      expect((await request<{ item: Sample }>(`${base}/sample`)).body.item.id).toBe(sample.id);
      await db.query("alter table audit_events drop constraint reject_sample_audit");
      expect((await request(`${base}/sample`, "DELETE")).status).toBe(204);
      expect((await request<{ item: Sample | null }>(`${base}/sample`)).body.item).toBeNull();
      expect((await store.get(objectKey)).toString()).toBe("first\r\nsecond");
      const events = await db.query<{ kind: string; metadata: unknown }>("select kind, metadata from audit_events where target_id=$1 order by created_at", [skill.id]);
      expect(events.rows.filter((e) => e.kind === "log-skill-sample-replace")).toHaveLength(3);
      expect(events.rows.filter((e) => e.kind === "log-skill-sample-delete")).toHaveLength(1);
      expect(events.rows.find((e) => e.kind === "log-skill-create")!.metadata).toMatchObject({ templateId: "linux-dmesg" });
      expect((await db.query<{ metadata: unknown }>("select metadata from audit_events where target_id=$1 and kind='log-skill-create'", [copied.id])).rows[0].metadata).toMatchObject({ copyFromSkillId: skill.id });
    } finally { await db.close(); await ephemeral.drop(); await rm(root, { recursive: true, force: true }); }
  }, 120_000);
});
