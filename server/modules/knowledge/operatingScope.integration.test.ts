import { createHmac, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createWiseEffServer } from "../../app";
import { requestJson } from "../../test/testClient";
import { seedCoreGraph } from "../../testing/fixtures";
import { createMemoryObjectStore } from "../../testing/objectStore";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { seedBaselineAuthCatalog } from "../auth/baselineCatalog";
import { createTokenVerifier } from "../auth/tokenVerifier";
import { processNextKnowledgeIndexJob } from "./indexing/worker";
import type { KnowledgeEntryDto, KnowledgeRevisionDto } from "./types";
import { persistXiaozeTurnMessages } from "../agent/xiaoze/threadRepository";

const available = await isTestDatabaseAvailable();
const secret = "knowledge-operating-test-only";
function token(userId = "kb-platform", organizationId = "kb-home") {
  const payload = Buffer.from(JSON.stringify({ iss: "kb-scope", sub: userId, org: organizationId, exp: 9_999_999_999 })).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

async function fixture() {
  const db = await createInMemoryTestDatabase();
  await seedCoreGraph(db, { organization: { id: "kb-home", name: "Home" }, users: [{ id: "kb-platform" }, { id: "kb-member" }] });
  await seedCoreGraph(db, { organization: { id: "kb-target", name: "Target" }, users: [{ id: "kb-manager" }] });
  await seedBaselineAuthCatalog(db);
  await db.query(`insert into user_role_bindings(id,user_id,organization_id,role_id) values
    ('kb-platform-role','kb-platform','kb-home','platform-admin'), ('kb-member-role','kb-member','kb-home','admin'),
    ('kb-manager-role','kb-manager','kb-target','admin')`);
  const server = createWiseEffServer({ db, objectStore: createMemoryObjectStore(), env: { AUTH_PROVIDER: "hmac" },
    auth: { mode: "production", verifier: createTokenVerifier({ issuer: "kb-scope", secret }) } });
  const request = <T,>(path: string, method = "GET", body?: unknown, bearer = token()) => requestJson<T>(server, path, {
    method, headers: { Authorization: `Bearer ${bearer}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  return { db, request };
}

function streamEvents(text: string) {
  return text.split("\n").filter((line) => line.startsWith("data:")).map((line) => JSON.parse(line.slice(5))) as Array<{
    type: string; message?: string; outcome?: { interrupts?: Array<{ metadata?: Record<string, unknown> }> };
  }>;
}

describe.skipIf(!available)("knowledge operating organization over real HTTP and PostgreSQL", () => {
  it("never attaches a persisted turn to an existing thread from another organization or actor", async () => {
    const { db } = await fixture();
    try {
      const input = { threadId: randomUUID(), runId: randomUUID(), pageContext: { pageKey: "knowledge", path: "/knowledge" },
        messages: [{ id: randomUUID(), role: "user" as const, content: "Private Home conversation" }] };
      await persistXiaozeTurnMessages(db, { ...input, organizationId: "kb-home", actorUserId: "kb-platform" });
      await expect(persistXiaozeTurnMessages(db, { ...input, messages: [{ id: randomUUID(), role: "assistant", content: "Foreign result" }],
        organizationId: "kb-target", actorUserId: "kb-platform" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(persistXiaozeTurnMessages(db, { ...input, messages: [{ id: randomUUID(), role: "assistant", content: "Other actor" }],
        organizationId: "kb-home", actorUserId: "kb-member" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect((await db.query("select organization_id,content from agent_messages where session_id=$1", [input.threadId])).rows)
        .toEqual([{ organization_id: "kb-home", content: "Private Home conversation" }]);
    } finally { await db.rollback(); }
  });
  it("governs and indexes the selected organization while retaining the actual Home actor and published-only retrieval", async () => {
    const { db, request } = await fixture();
    try {
      const create = (title: string, scope = "") => request<{ item: KnowledgeEntryDto }>(`/api/v1/knowledge/entries${scope}`, "POST",
        { title, contentForm: "markdown", tags: [], contentMarkdown: "scopeknowledgeunique" });
      const own = await create("Home knowledge");
      const created = await create("Target knowledge", "?organizationId=kb-target");
      expect(created.status, created.bodyText).toBe(201);
      expect(created.body.item).toMatchObject({ organizationId: "kb-target", createdByUserId: "kb-platform", status: "draft" });
      const id = created.body.item.id, scoped = (path: string) => `/api/v1/knowledge/${path}?organizationId=kb-target`;
      expect((await request<{ user: { organizationId: string } }>("/api/v1/me")).body.user.organizationId).toBe("kb-home");
      expect((await request<{ items: unknown[] }>(scoped("search") + "&q=scopeknowledgeunique")).body.items).toEqual([]);
      expect((await request(scoped(`entries/${own.body.item.id}`))).status).toBe(404);
      expect((await request(scoped("entries"), "GET", undefined, token("kb-member"))).status).toBe(403);
      const updated = await request<{ item: KnowledgeEntryDto }>(scoped(`entries/${id}`), "PATCH",
        { title: "Target revised", tags: ["scope"], contentMarkdown: "scopeknowledgeunique revised", expectedHeadRevisionNumber: 1 });
      expect(updated.status, updated.bodyText).toBe(200);
      expect(updated.body.item).toMatchObject({ organizationId: "kb-target", headRevisionNumber: 2 });
      const published = await request<{ item: KnowledgeEntryDto }>(scoped(`entries/${id}/publish`), "POST", {});
      expect(published.status, published.bodyText).toBe(200);
      for (let round = 0; round < 20; round++) if (await processNextKnowledgeIndexJob({ db }) === "idle") break;
      const search = await request<{ items: Array<{ entryId: string; revisionId: string }> }>(scoped("search") + "&q=scopeknowledgeunique");
      expect(search.status, search.bodyText).toBe(200);
      expect(search.body.items).toEqual([expect.objectContaining({ entryId: id, revisionId: published.body.item.headRevisionId })]);
      expect((await request<{ items: unknown[] }>("/api/v1/knowledge/search?q=scopeknowledgeunique")).body.items).toEqual([]);
      const chunks = await db.query("select organization_id,revision_id from knowledge_chunks where entry_id=$1", [id]);
      expect(chunks.rows.length).toBeGreaterThan(0);
      expect(chunks.rows).toEqual(expect.arrayContaining([expect.objectContaining({ organization_id: "kb-target", revision_id: published.body.item.headRevisionId })]));
      const revisions = await request<{ items: KnowledgeRevisionDto[] }>(scoped(`entries/${id}/revisions`));
      expect(revisions.body.items).toHaveLength(2);
      expect(revisions.body.items.every((revision) => revision.authorUserId === "kb-platform" && revision.organizationId === "kb-target")).toBe(true);
      const audit = await db.query<{ organization_id: string; actor_user_id: string; metadata: Record<string, unknown> }>("select organization_id,actor_user_id,metadata from audit_events where target_id=$1", [id]);
      expect(audit.rows.length).toBeGreaterThan(0);
      expect(audit.rows.every((event) => event.organization_id === "kb-target" && event.actor_user_id === "kb-platform")).toBe(true);
      expect(audit.rows[0].metadata).toMatchObject({ actorHomeOrganizationId: "kb-home", operatingOrganizationId: "kb-target" });
      expect((await request(scoped(`entries/${id}/archive`), "POST", {})).status).toBe(200);
      expect((await request<{ items: unknown[] }>(scoped("search") + "&q=scopeknowledgeunique")).body.items).toEqual([]);
      expect((await request(scoped(`entries/${id}`), "DELETE")).status).toBe(200);
      expect((await request(scoped(`entries/${id}`))).status).toBe(404);
    } finally { await db.rollback(); }
  });

  it("imports and batch publishes documents only within the fixed target, including asynchronous index work", async () => {
    const { db, request } = await fixture();
    try {
      const scoped = (path: string) => `/api/v1/knowledge/${path}?organizationId=kb-target`;
      const opened = await request<{ item: { id: string } }>(scoped("imports"), "POST", { tags: ["target"] });
      expect(opened.status, opened.bodyText).toBe(201);
      const batchId = opened.body.item.id;
      const imported = await request<{ item: { entryId: string; status: string } }>(scoped(`imports/${batchId}/documents`), "POST", {
        relativePath: "folder/scoped-guide.md", file: { fileName: "scoped-guide.md", contentType: "text/markdown", contentBase64: Buffer.from("importscopeduniqueword").toString("base64") }
      });
      expect(imported.status, imported.bodyText).toBe(200);
      expect(imported.body.item.status).toBe("created");
      expect((await request(`/api/v1/knowledge/imports/${batchId}`)).status).toBe(404);
      expect((await request(scoped(`imports/${batchId}/complete`), "POST", {})).status).toBe(200);
      const entryId = imported.body.item.entryId;
      expect((await request<{ item: KnowledgeEntryDto }>(scoped(`entries/${entryId}`))).body.item)
        .toMatchObject({ organizationId: "kb-target", createdByUserId: "kb-platform", status: "draft", contentForm: "markdown" });
      const published = await request<{ results: Array<{ status: string }> }>(scoped("entries/batch"), "POST", { action: "publish", entryIds: [entryId] });
      expect(published.status, published.bodyText).toBe(200);
      expect(published.body.results[0].status).toBe("succeeded");
      for (let round = 0; round < 20; round++) if (await processNextKnowledgeIndexJob({ db }) === "idle") break;
      expect((await request<{ items: Array<{ entryId: string }> }>(scoped("search") + "&q=importscopeduniqueword")).body.items.map((entry) => entry.entryId)).toEqual([entryId]);
      expect((await request<{ items: unknown[] }>("/api/v1/knowledge/search?q=importscopeduniqueword")).body.items).toEqual([]);
    } finally { await db.rollback(); }
  });

  it("keeps Agent approval, streamed results and private threads in the selected organization", async () => {
    vi.stubEnv("XIAOZE_DETERMINISTIC", "true");
    const { db, request } = await fixture();
    try {
      const path = "/api/v1/agent/xiaoze?organizationId=kb-target", threadId = "kb-target-thread";
      const body = { threadId, runId: "kb-target-run", messages: [{ id: "target-message", role: "user", content: "创建知识草稿:Target Agent draft" }],
        context: [{ description: "wiseeff.page", value: { pageKey: "knowledge", path: "/knowledge?organizationId=kb-target" } }] };
      const start = await request(path, "POST", body);
      expect(start.status, start.bodyText).toBe(200);
      const interrupt = streamEvents(start.bodyText).find((event) => event.type === "RUN_FINISHED")?.outcome?.interrupts?.[0]?.metadata;
      expect(interrupt, start.bodyText).toHaveProperty("approvalId");
      expect((await db.query("select organization_id,requested_by_user_id from agent_approvals where id=$1", [interrupt!.approvalId])).rows)
        .toEqual([{ organization_id: "kb-target", requested_by_user_id: "kb-platform" }]);
      expect((await db.query("select id from knowledge_entries where title=$1", ["Target Agent draft"])).rows).toEqual([]);
      const wrongScope = await request("/api/v1/agent/xiaoze", "POST", { ...body, runId: "wrong-home-resume", forwardedProps: { command: { resume: { decision: "approve" }, interruptEvent: interrupt } } });
      expect(wrongScope.status === 403 || wrongScope.status === 404 || streamEvents(wrongScope.bodyText).some((event) => event.type === "RUN_ERROR")).toBe(true);
      expect((await db.query("select id from knowledge_entries where title=$1", ["Target Agent draft"])).rows).toEqual([]);
      const resumed = await request(path, "POST", { ...body, runId: "target-resume", messages: [{ id: "approve", role: "user", content: "approve" }],
        forwardedProps: { command: { resume: { decision: "approve" }, interruptEvent: interrupt } } });
      expect(resumed.status, resumed.bodyText).toBe(200);
      expect(streamEvents(resumed.bodyText).filter((event) => event.type === "RUN_ERROR"), resumed.bodyText).toEqual([]);
      const entry = (await db.query<{ id: string; organization_id: string; created_by_user_id: string; status: string }>(
        "select id,organization_id,created_by_user_id,status from knowledge_entries where title=$1", ["Target Agent draft"])).rows[0];
      expect(entry).toMatchObject({ organization_id: "kb-target", created_by_user_id: "kb-platform", status: "draft" });
      expect(resumed.bodyText).toContain(`organizationId=kb-target`);
      const threads = await request<{ items: Array<{ id: string }> }>("/api/v1/agent/xiaoze/threads?organizationId=kb-target");
      expect(threads.body.items.map((item) => item.id)).toContain(threadId);
      expect((await request<{ items: unknown[] }>("/api/v1/agent/xiaoze/threads")).body.items).toEqual([]);
      expect((await request(`/api/v1/agent/xiaoze/threads/${threadId}?organizationId=kb-target`, "GET", undefined, token("kb-manager", "kb-target"))).status).toBe(404);
      const session = (await db.query("select organization_id,actor_user_id from agent_sessions where id=$1", [threadId])).rows[0];
      expect(session).toEqual({ organization_id: "kb-target", actor_user_id: "kb-platform" });
      const audit = await db.query("select organization_id,actor_user_id,actor_type,metadata from audit_events where kind='knowledge-entry-agent-draft' and target_id=$1", [entry.id]);
      expect(audit.rows[0]).toMatchObject({ organization_id: "kb-target", actor_user_id: "kb-platform", actor_type: "agent",
        metadata: { actorHomeOrganizationId: "kb-home", operatingOrganizationId: "kb-target", approvalId: interrupt!.approvalId } });
    } finally { await db.rollback(); vi.unstubAllEnvs(); }
  });

  it("distills only log and stored reload evidence owned by the selected organization", async () => {
    const { db, request } = await fixture();
    try {
      const logIds: Record<string, string> = {};
      for (const organizationId of ["kb-home", "kb-target"]) {
        const userId = organizationId === "kb-home" ? "kb-platform" : "kb-manager";
        const fileId = randomUUID(), logId = randomUUID(), runId = randomUUID();
        logIds[organizationId] = logId;
        await seedCoreGraph(db, { organization: { id: organizationId }, projects: [{ id: `${organizationId}-project` }] });
        await db.query(`insert into log_file_objects(id,organization_id,storage_key,file_name,content_type,file_size_bytes,checksum_sha256,uploaded_by_user_id)
          values($1,$2,$1,'scope.log','text/plain',12,'scope-checksum',$3)`, [fileId, organizationId, userId]);
        await db.query(`insert into log_records(id,organization_id,file_object_id,file_name,source,status,analysis_question,submitted_by_user_id)
          values($1,$2,$3,'scope.log','upload','complete','Scoped evidence',$4)`, [logId, organizationId, fileId, userId]);
        await db.query(`insert into log_analysis_runs(id,organization_id,log_record_id,status,current_stage,progress)
          values($1,$2,$3,'succeeded','report',100)`, [runId, organizationId, logId]);
        await db.query("update log_records set current_run_id=$2 where id=$1", [logId, runId]);
        await db.query(`insert into log_analysis_reports(id,organization_id,log_record_id,run_id,confidence,conclusion,impact,severity,suggested_actions,raw_lines)
          values($1,$2,$3,$4,90,'Scoped evidence','Scoped impact','Info','[]','[]')`, [randomUUID(), organizationId, logId, runId]);
        await db.query(`insert into dts_reload_runs(id,organization_id,project_id,status,created_by_user_id)
          values($1,$2,$3,'failed',$4)`, [`${organizationId}-reload`, organizationId, `${organizationId}-project`, userId]);
      }
      const fromLog = await request<{ item: KnowledgeEntryDto }>("/api/v1/knowledge/distill-from-log?organizationId=kb-target", "POST", { logId: logIds["kb-target"] });
      expect(fromLog.status, fromLog.bodyText).toBe(201);
      expect(fromLog.body.item).toMatchObject({ organizationId: "kb-target", sourceLogId: logIds["kb-target"], createdByUserId: "kb-platform" });
      const fromReload = await request<{ item: KnowledgeEntryDto }>("/api/v1/knowledge/distill-from-reload-run?organizationId=kb-target", "POST", { runId: "kb-target-reload" });
      expect(fromReload.status, fromReload.bodyText).toBe(201);
      expect(fromReload.body.item).toMatchObject({ organizationId: "kb-target", sourceReloadRunId: "kb-target-reload", createdByUserId: "kb-platform" });
      for (const [path, body] of [["distill-from-log", { logId: logIds["kb-home"] }], ["distill-from-reload-run", { runId: "kb-home-reload" }]] as const) {
        expect((await request(`/api/v1/knowledge/${path}?organizationId=kb-target`, "POST", body)).status).toBe(404);
      }
      expect((await request("/api/v1/knowledge/distill-from-log?organizationId=kb-target", "POST", { logId: logIds["kb-target"] }, token("kb-member"))).status).toBe(403);
    } finally { await db.rollback(); }
  });
});
