import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWiseEffServer } from "../../app";
import { createPostgresDatabase } from "../../shared/database/client";
import { requestJson } from "../../test/testClient";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import { createMemoryObjectStore } from "../../testing/objectStore";
import type { getLogSkill } from "./skillsService";
import { processLogAnalysisJobById } from "./worker";
import { exportSkillPackageArchive } from "./skillPackageArchive";

type Skill = Awaited<ReturnType<typeof getLogSkill>>;

describe("analysis skill rename and archive restoration HTTP", () => {
  let database: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>;
  const store = createMemoryObjectStore();
  beforeAll(async () => {
    database = await createEphemeralTestDatabase("skill-lifecycle");
    db = createPostgresDatabase(database.url);
    for (const organizationId of ["skill-lifecycle", "skill-foreign"]) {
      await seedCoreGraph(db, { organization: { id: organizationId }, users: [{ id: `${organizationId}-admin` }] });
      await db.query(`insert into user_role_bindings(id,user_id,organization_id,project_id,role_id)
        values($1,$2,$3,null,'admin')`, [`${organizationId}-role`, `${organizationId}-admin`, organizationId]);
    }
    await db.query("insert into users(id,organization_id,name,title,is_active) values('skill-member','skill-lifecycle','Member','Member',true)");
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('skill-member-role','skill-member','skill-lifecycle','software-user')");
  });
  afterAll(async () => { await db?.close(); await database?.drop(); });
  const request = <T = unknown>(path: string, method = "GET", body?: unknown, userId = "skill-lifecycle-admin") =>
    requestJson<T>(createWiseEffServer({ db, objectStore: store }), path, { method, headers: { "X-WiseEff-User": userId },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const create = async (name: string) => {
    const response = await request<{ item: Skill }>("/api/v1/log-skills", "POST", { name });
    expect(response.status).toBe(201);
    return response.body.item;
  };
  const path = (id: string) => `/api/v1/log-domains/${id}`;

  it("names the actual same-organization occupier and retains the original skill after a conflict", async () => {
    const skill = await create("Lifecycle original");
    const occupied = await create("Occupied archived name");
    expect((await request(`${path(occupied.id)}/archive`, "POST", {})).status).toBe(200);
    expect(await request(path(skill.id), "PATCH", { name: occupied.name })).toMatchObject({ status: 409, body: { error: {
      code: "CONFLICT", details: { conflictingSkill: { id: occupied.id, name: occupied.name, status: "archived" } },
    } } });
    expect((await request<{ item: Skill }>(`/api/v1/log-skills/${skill.id}`)).body.item).toMatchObject({ id: skill.id, name: skill.name });
    expect((await request(path(skill.id), "PATCH", { name: "Forbidden" }, "skill-member")).status).toBe(403);
    expect((await request(path(skill.id), "PATCH", { status: "active" }, "skill-foreign-admin")).status).toBe(404);
  });

  it("renames and restores the same published skill, history and references without reviving revoked credentials", async () => {
    const skill = await create("Lifecycle retained identity");
    const skillPath = `/api/v1/log-skills/${skill.id}`;
    const credential = await request<{ item: { id: string }; token: string }>("/api/v1/log-integration-credentials", "POST", {
      name: "Lifecycle pipeline", skillId: skill.id,
    });
    expect(credential.status).toBe(201);
    const upload = await request<{ log: { id: string; skillRevision: { id: string } }; job: { id: string } }>("/api/v1/log-files", "POST", {
      fileName: "lifecycle.log", contentType: "text/plain", contentBase64: Buffer.from("INFO retained history\n").toString("base64"), skillId: skill.id,
    });
    expect(upload.status).toBe(201);
    expect(await processLogAnalysisJobById({ db, objectStore: store, jobId: upload.body.job.id })).toMatchObject({ status: "processed" });
    const history = (await request<{ item: { reportId: string; conclusion: string } }>(`/api/v1/logs/${upload.body.log.id}`)).body.item;
    const revisions = (await request(`${skillPath}/revisions`)).body;
    expect((await request(path(skill.id), "PATCH", { name: "Renamed lifecycle identity" })).status).toBe(200);
    expect((await request(`${path(skill.id)}/archive`, "POST", {})).status).toBe(200);
    expect((await request(path(skill.id), "PATCH", { status: "active" })).status).toBe(200);
    expect((await request<{ item: Skill }>(skillPath)).body.item).toMatchObject({
      id: skill.id, skillKey: skill.skillKey, name: "Renamed lifecycle identity", status: "active", currentRevision: skill.currentRevision,
    });
    expect((await request(`${skillPath}/revisions`)).body).toEqual(revisions);
    expect((await request<{ item: { logDomainId: string; skillRevision: { id: string } } }>(`/api/v1/logs/${upload.body.log.id}`)).body.item)
      .toMatchObject({ logDomainId: skill.id, skillRevision: upload.body.log.skillRevision, reportId: history.reportId, conclusion: history.conclusion });
    const credentials = await request<{ items: { id: string; status: string }[] }>("/api/v1/log-integration-credentials");
    expect(credentials.body.items.find(item => item.id === credential.body.item.id)?.status).toBe("revoked");
    expect((await requestJson(createWiseEffServer({ db, objectStore: store }), "/api/v1/log-files", {
      method: "POST", headers: { authorization: `Bearer ${credential.body.token}` }, body: JSON.stringify({
        fileName: "revoked.log", contentType: "text/plain", contentBase64: Buffer.from("INFO forbidden\n").toString("base64"),
      }),
    })).status).toBe(401);
  });

  it("keeps an imported unpublished skill unpublished when restoring its archived identity", async () => {
    const bytes = await exportSkillPackageArchive("Unpublished lifecycle", "unpublished-lifecycle", { schemaVersion: "skill/v1" }, [], new Map());
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(bytes)], { type: "application/zip" }), "skill.zip");
    form.append("status", "draft");
    const encoded = new Request("http://fixture", { method: "POST", body: form });
    const imported = await requestJson<{ item: Skill }>(createWiseEffServer({ db, objectStore: store }), "/api/v1/log-skills/import", {
      method: "POST", headers: { "Content-Type": encoded.headers.get("content-type")!, "X-WiseEff-User": "skill-lifecycle-admin" }, body: await encoded.arrayBuffer(),
    });
    expect(imported.status, imported.bodyText).toBe(201);
    const skill = imported.body.item;
    expect(skill.currentRevision.status).toBe("draft");
    expect((await request(`${path(skill.id)}/archive`, "POST", {})).status).toBe(200);
    expect((await request(path(skill.id), "PATCH", { status: "active" })).status).toBe(200);
    expect((await request<{ item: Skill }>(`/api/v1/log-skills/${skill.id}`)).body.item).toMatchObject({
      id: skill.id, status: "active", currentRevision: { id: skill.currentRevision.id, status: "draft", publishedAt: null },
    });
    expect(await request("/api/v1/log-files", "POST", { fileName: "not-published.log", contentType: "text/plain",
      contentBase64: Buffer.from("INFO no publication\n").toString("base64"), skillId: skill.id,
    })).toMatchObject({ status: 409, body: { error: { code: "CONFLICT", message: "此分析技能尚未发布。" } } });
  });

  it("returns the actual name owner after concurrent renames compete", async () => {
    const first = await create("Concurrent lifecycle first");
    const second = await create("Concurrent lifecycle second");
    const result = await Promise.all([first, second].map(skill => request<{ error: { details: { conflictingSkill: { id: string } } } }>(
      path(skill.id), "PATCH", { name: "Concurrent lifecycle winner" },
    )));
    expect(result.map(item => item.status).sort()).toEqual([200, 409]);
    const winner = result.findIndex(item => item.status === 200);
    expect(result[1 - winner]!.body.error.details.conflictingSkill.id).toBe([first, second][winner]!.id);
  });
});
