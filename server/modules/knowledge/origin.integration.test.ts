import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createEphemeralTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { createPostgresDatabase, getRootPostgresPool, type RootDatabase } from "../../shared/database/client";
import { installKnowledgeDefinitionReferencesCatalogFixture } from "../../testing/parameterCatalog";
import { seedCoreGraph } from "../../testing/fixtures";
import { makeTestAuthContext } from "../../testing/authContext";
import { createMemoryObjectStore } from "../../testing/objectStore";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { requestJson } from "../../test/testClient";
import { registerKnowledgeRoutes } from "./routes";
import { createAgentKnowledgeDraft } from "./service";
import { createAgentInvocation, createUserInvocation } from "../auth/trustedInvocation";
import { exportSkillPackageArchive } from "../logs/skillPackageArchive";
import { importLogSkillPackage } from "../logs/skillPackages";
import { createKnowledgeTools } from "../agent/tools/knowledgeTools";
import { searchPublishedKnowledgeForLogAnalysis } from "./logDomainRetrieval";
import { knowledgeEntryDtoSchema } from "../contracts/dtoSchemas/knowledge";

const available = await isTestDatabaseAvailable();

describe.skipIf(!available)("knowledge origin over HTTP and PostgreSQL", () => {
  let fixture: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: RootDatabase;
  let definitionId: string;
  const logId = randomUUID();
  const auth = makeTestAuthContext({ organizationId: "origin-org", userId: "origin-user",
    permissions: ["knowledge:view", "knowledge:edit", "knowledge:manage", "logs:view", "logs:admin-domains", "debugging:view", "parameter:view"] });
  const store = createMemoryObjectStore();

  beforeAll(async () => {
    fixture = await createEphemeralTestDatabase("origin");
    db = createPostgresDatabase(fixture.url);
    definitionId = (await installKnowledgeDefinitionReferencesCatalogFixture(getRootPostgresPool(db)!)).activeDefinitionId;
    await seedCoreGraph(db, { organization: { id: auth.organization.id }, users: [{ id: auth.user.id }], projects: [{ id: "origin-project" }] });
    await seedSources();
  });
  afterAll(async () => { await db?.close(); await fixture?.drop(); });

  async function seedSources() {
    const fileId = randomUUID(), runId = randomUUID();
    await db.query(`insert into log_file_objects
      (id, organization_id, storage_key, file_name, content_type, file_size_bytes, checksum_sha256, uploaded_by_user_id)
      values ($1,$2,$1,'origin.log','text/plain',12,'checksum',$3)`, [fileId, auth.organization.id, auth.user.id]);
    await db.query(`insert into log_records
      (id,organization_id,file_object_id,file_name,source,status,analysis_question,submitted_by_user_id)
      values ($1,$2,$3,'origin.log','upload','complete','originpaths',$4)`, [logId, auth.organization.id, fileId, auth.user.id]);
    await db.query(`insert into log_analysis_runs (id,organization_id,log_record_id,status,current_stage,progress)
      values ($1,$2,$3,'succeeded','report',100)`, [runId, auth.organization.id, logId]);
    await db.query("update log_records set current_run_id=$2 where id=$1", [logId, runId]);
    await db.query(`insert into log_analysis_reports
      (id,organization_id,log_record_id,run_id,confidence,conclusion,impact,severity,suggested_actions,raw_lines)
      values ($1,$2,$3,$4,90,'originpaths','originpaths','Info','[]','[]')`, [randomUUID(), auth.organization.id, logId, runId]);
    await db.query(`insert into dts_reload_runs (id,organization_id,project_id,status,created_by_user_id)
      values ('origin-reload',$1,'origin-project','failed',$2)`, [auth.organization.id, auth.user.id]);
  }

  async function request(method: string, path: string, body?: unknown, identity = auth) {
    const router = createRouter();
    registerKnowledgeRoutes(router, { db, objectStore: store, getCurrentAuthContext: () => identity });
    const result = await requestJson<{ item: { id: string; origin: string }; items: { id: string; origin: string }[] }>(
      createHttpServer(router), `/api/v1/knowledge/${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (result.body.item) knowledgeEntryDtoSchema.parse(result.body.item);
    if (path.startsWith("entries?") && result.body.items) result.body.items.forEach((entry) => knowledgeEntryDtoSchema.parse(entry));
    return result;
  }

  it("records authored by default and accepts uploaded markdown independently of content form", async () => {
    const body = { contentForm: "markdown", title: "Origin guidance", tags: [], contentMarkdown: "originneedle" };
    const authored = await request("POST", "entries", body);
    expect(authored.status).toBe(201);
    expect(authored.body.item.origin).toBe("authored");
    const uploaded = await request("POST", "entries", { ...body, origin: "uploaded" });
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.item.origin).toBe("uploaded");
    expect((await request("GET", `entries/${uploaded.body.item.id}`)).body.item.origin).toBe("uploaded");
    const filtered = await request("GET", "entries?origin=uploaded");
    expect(filtered.body.items.map((entry) => entry.id)).toEqual([uploaded.body.item.id]);
    expect((await request("GET", "entries?origin=unknown")).status).toBe(400);
    expect((await request("POST", "entries", { ...body, origin: "invented" })).status).toBe(400);
    expect((await request("POST", "entries", { ...body, origin: "agent-drafted" })).status).toBe(400);
    await request("PATCH", `entries/${uploaded.body.item.id}`, { expectedHeadRevisionNumber: 1, title: "Updated", origin: "authored" });
    expect((await request("GET", `entries/${uploaded.body.item.id}`)).body.item.origin).toBe("uploaded");
    const foreign = makeTestAuthContext({ organizationId: "foreign-org", userId: "foreign-user" });
    expect((await request("GET", "entries?origin=uploaded", undefined, foreign)).body.items).toEqual([]);
    expect((await request("GET", `entries/${uploaded.body.item.id}`, undefined, foreign)).status).toBe(404);
    expect((await request("GET", "entries?origin=uploaded", undefined, { ...auth, permissions: [] })).status).toBe(403);
  });

  it("records file, log, reload, Xiaoze and package origins and retrieves every published origin", async () => {
    const file = await request("POST", "entries", { contentForm: "file", title: "originpaths", tags: [],
      file: { fileName: "guide.txt", contentType: "text/plain", contentBase64: Buffer.from("originpaths").toString("base64") } });
    expect(file.status).toBe(201);
    expect(file.body.item.origin).toBe("uploaded");
    const log = await request("POST", "distill-from-log", { logId });
    expect(log.status).toBe(201);
    expect(log.body.item.origin).toBe("distilled");

    const reload = await request("POST", "distill-from-reload-run", { runId: "origin-reload" });
    expect(reload.status).toBe(201);
    expect(reload.body.item.origin).toBe("distilled");

    const agent = await createAgentKnowledgeDraft(db, auth, { title: "originpaths", tags: [], contentMarkdown: "originpaths",
      sessionId: "origin-session", sourceLogId: logId, sourceReloadRunId: "origin-reload" },
      createAgentInvocation(auth, { sessionId: "origin-session", toolCallId: "origin-draft", approval: { required: false } }));
    expect((await request("GET", `entries/${agent.id}`)).body.item.origin).toBe("agent-drafted");
    const archive = await exportSkillPackageArchive("Origin skill", "origin-skill", { schemaVersion: "skill/v1" },
      [{ path: "knowledge/guide.md", title: "originpaths", tags: [], body: "originpaths" }], new Map());
    const skill = await importLogSkillPackage(db, store, auth, archive, "draft", createUserInvocation(auth), { requestId: "origin-package" });
    const importedId = skill.currentRevision.spec.knowledgeEntryIds![0];
    expect((await request("GET", `entries/${importedId}`)).body.item.origin).toBe("imported");
    const authored = await request("POST", "entries", { contentForm: "markdown", title: "originpaths", tags: [], contentMarkdown: "originpaths" });
    const ids = [file.body.item.id, log.body.item.id, agent.id, importedId, authored.body.item.id];
    expect((await request("GET", "search?q=originpaths")).body.items).toEqual([]);
    for (const id of ids) {
      expect((await request("PUT", `entries/${id}/definition-references/${definitionId}`)).status).toBe(200);
      expect((await request("POST", `entries/${id}/publish`)).status).toBe(200);
    }
    const search = await request("GET", "search?q=originpaths");
    expect(search.body.items).toHaveLength(5);
    for (const origin of ["authored", "uploaded", "distilled", "agent-drafted", "imported"]) {
      const listed = await request("GET", `entries?origin=${origin}`);
      expect(listed.body.items.length).toBeGreaterThan(0);
      expect(listed.body.items.every((entry) => entry.origin === origin)).toBe(true);
    }
    const tools = createKnowledgeTools({ db });
    const context = { auth, requestId: "origin-retrieval", sessionId: "origin-session" };
    const agentSearch = await tools.find((tool) => tool.name === "knowledge.search")!.run(context, { query: "originpaths", limit: 10 });
    expect(agentSearch.citations?.map((citation) => citation.id).sort()).toEqual([...ids].sort());
    for (const id of ids) {
      const document = await tools.find((tool) => tool.name === "knowledge.getDocument")!.run(context, { entryId: id });
      expect(document.citations?.[0].id).toBe(id);
    }
    const worker = await searchPublishedKnowledgeForLogAnalysis(db, { organizationId: auth.organization.id, query: "originpaths", limit: 20 });
    expect(worker.items.map((entry) => entry.entryId).sort()).toEqual([...ids].sort());
    const related = await request("GET", `related-to-log?logId=${logId}&limit=20`);
    expect(related.status).toBe(200);
    expect(related.body.items).toHaveLength(5);
    const definitionRelated = await request("GET", `related-to-definition?definitionId=${definitionId}`);
    expect(definitionRelated.status).toBe(200);
    expect(definitionRelated.body.items).toHaveLength(5);
    await request("POST", `entries/${agent.id}/archive`);
    expect((await request("GET", `entries/${agent.id}`)).body.item.origin).toBe("agent-drafted");
    expect((await request("GET", "search?q=originpaths")).body.items).toHaveLength(4);
  });

  it("backfills only recorded evidence in precedence order and constrains future rows", async () => {
    // Recreate the pre-migration shape in this disposable database, then run the actual migration.
    await db.query("alter table knowledge_entries drop column origin");
    const cases = [
      ["agent-drafted", "agent", "file", "origin-reload", true, false],
      ["distilled", "human", "file", "origin-reload", false, false],
      ["distilled", "human", "file", null, true, false],
      ["distilled", "human", "file", null, false, true],
      ["uploaded", "human", "file", null, false, false],
      ["authored", "human", "markdown", null, false, false]
    ] as const;
    const ids: string[] = [];
    for (const [expected, source, form, reload, hasLog, deletedLog] of cases) {
      const id = randomUUID(); ids.push(id);
      await db.query(`insert into knowledge_entries
        (id,organization_id,title,content_form,source_type,source_session_id,source_log_id,source_reload_run_id,created_by_user_id,source_log_deleted)
        values ($1,$2,$3,$4,$5,'historical-session',$6,$7,$8,$9)`,
      [id, auth.organization.id, expected, form, source, hasLog ? logId : null, reload, auth.user.id, deletedLog]);
    }
    await db.query(await readFile(new URL("../../migrations/0246_knowledge_origin.sql", import.meta.url), "utf8"));
    for (const [index, [expected]] of cases.entries()) {
      expect((await request("GET", `entries/${ids[index]}`)).body.item.origin).toBe(expected);
    }
    await expect(db.query("update knowledge_entries set origin='unknown' where id=$1", [ids[0]])).rejects.toMatchObject({ code: "23514" });
    await expect(db.query("update knowledge_entries set origin=null where id=$1", [ids[0]])).rejects.toMatchObject({ code: "23502" });
    const defaultId = randomUUID();
    await db.query(`insert into knowledge_entries (id,organization_id,title,content_form,created_by_user_id)
      values ($1,$2,'Default origin','markdown',$3)`, [defaultId, auth.organization.id, auth.user.id]);
    expect((await request("GET", `entries/${defaultId}`)).body.item.origin).toBe("authored");
  });
});
