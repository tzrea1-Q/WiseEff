import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWiseEffServer } from "../../app";
import { createPostgresDatabase, type RootDatabase } from "../../shared/database/client";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import { createMemoryObjectStore } from "../../testing/objectStore";
import { requestJson } from "../../test/testClient";
import { seedBaselineAuthCatalog } from "../auth/baselineCatalog";
import type { AuthContext } from "../auth/types";
import type { KnowledgeEntryDto } from "./types";

type Handover = { kind: "entry" | "import"; id: string; title: string; responsibleUserId: string | null; pending: boolean };
type HandoverList = { items: Handover[]; candidates: Array<{ id: string; name: string }> };
describe("knowledge handover through real HTTP and PostgreSQL", () => {
  let db: RootDatabase, ephemeral: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  const store = createMemoryObjectStore();
  beforeEach(async () => {
    ephemeral = await createEphemeralTestDatabase("knowledge_handover"); db = createPostgresDatabase(ephemeral.url);
    await seedCoreGraph(db, { organization: { id: "handover-home" }, users: [{ id: "handover-platform" }] });
    await seedCoreGraph(db, { organization: { id: "handover-org" }, users: [{ id: "handover-admin" }, { id: "handover-departing", name: "Original author" }, { id: "handover-editor" }, { id: "handover-viewer" }] });
    await seedBaselineAuthCatalog(db);
    for (const [id, role, org] of [["platform", "platform-admin", "home"], ["admin", "admin", "org"], ["departing", "software-user", "org"], ["editor", "software-user", "org"], ["viewer", "guest", "org"]]) {
      await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values($1,$2,$3,$4)", [`handover-${id}-role`, `handover-${id}`, `handover-${org}`, role]);
    }
  });
  afterEach(async () => { await db?.close(); await ephemeral?.drop(); });
  function request<T = unknown>(path: string, method = "GET", body?: unknown, actor = "platform", scope = "handover-org") {
    const org = actor === "platform" ? "handover-home" : "handover-org";
    const auth: AuthContext = { user: { id: `handover-${actor}`, organizationId: org, name: actor, title: "", isActive: true }, organization: { id: org, name: org }, roles: [], permissions: [] };
    return requestJson<T>(createWiseEffServer({ db, objectStore: store, env: { AUTH_PROVIDER: "hmac" }, auth: { mode: "production", verifier: { verify: async () => auth } } }),
      `/api/v1/${path}${path.includes("?") ? "&" : "?"}organizationId=${scope}`, { method, headers: { Authorization: "Bearer fixture" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  async function draft() {
    const result = await request<{ item: KnowledgeEntryDto }>("knowledge/entries", "POST", { title: "Departing draft", contentForm: "markdown", tags: [], contentMarkdown: "Original unfinished work" }, "departing");
    expect(result.status, result.bodyText).toBe(201); return result.body.item;
  }
  it("retains an offboarded and deleted author's draft, transfers current responsibility, and continues work without rewriting history", async () => {
    const entry = await draft();
    expect((await request("users/handover-departing/activation", "PATCH", { isActive: false })).status).toBe(200);
    const pending = await request<HandoverList>("knowledge/handovers");
    expect(pending.status, pending.bodyText).toBe(200);
    expect(pending.body.items).toContainEqual(expect.objectContaining({ kind: "entry", id: entry.id, pending: true, responsibleUserId: "handover-departing" }));
    expect((await request("users/handover-departing", "DELETE")).status).toBe(204);
    const deleted = await request<HandoverList>("knowledge/handovers");
    expect(deleted.body.items).toContainEqual(expect.objectContaining({ id: entry.id, responsibleUserId: null, pending: true }));
    const assigned = await request(`knowledge/handovers/entry/${entry.id}`, "PATCH", { responsibleUserId: "handover-editor", expectedResponsibleUserId: null });
    expect(assigned.status, assigned.bodyText).toBe(200);
    const listed = await request<{ items: KnowledgeEntryDto[] }>("knowledge/entries?status=draft", "GET", undefined, "editor");
    expect(listed.body.items.map(item => item.id)).toContain(entry.id);
    const updated = await request<{ item: KnowledgeEntryDto }>(`knowledge/entries/${entry.id}`, "PATCH", { contentMarkdown: "Successor completed work", expectedHeadRevisionNumber: 1 }, "editor");
    expect(updated.status, updated.bodyText).toBe(200);
    expect(updated.body.item).toMatchObject({ organizationId: "handover-org", createdByUserId: null, historicalAttribution: entry.historicalAttribution });
    expect((await request(`knowledge/entries/${entry.id}/publish`, "POST", {}, "editor")).status).toBe(200);
    const revisions = await request<{ items: Array<{ authorUserId: string | null; historicalAttribution: unknown }> }>(`knowledge/entries/${entry.id}/revisions`);
    expect(revisions.body.items[0].authorUserId).toBe("handover-editor");
    expect(revisions.body.items[1].historicalAttribution).toMatchObject({ actors: { author_user_id: { id: "handover-departing", name: "Original author" } } });
    expect((await db.query("select actor_user_id,organization_id from audit_events where kind='knowledge-handover' and target_id=$1", [entry.id])).rows)
      .toEqual([{ actor_user_id: "handover-platform", organization_id: "handover-org" }]);
  });
  it("keeps unfinished feedback private until explicitly submitted by its successor, preserving its original author after account deletion", async () => {
    const created = await request<{ item: { id: string } }>("product-feedback/drafts", "POST", { description: "Unsubmitted organization feedback", pagePath: "/knowledge", pageTitle: "Knowledge" }, "departing");
    expect(created.status, created.bodyText).toBe(201);
    const id = created.body.item.id;
    await request("users/handover-departing/activation", "PATCH", { isActive: false });
    const pending = await request<{ items: Array<{ id: string; pending: boolean }> }>("product-feedback/handovers");
    expect(pending.status, pending.bodyText).toBe(200);
    expect(pending.body.items).toContainEqual(expect.objectContaining({ id, pending: true }));
    await request("users/handover-departing", "DELETE");
    expect((await request("product-feedback/handovers/" + id, "PATCH", { responsibleUserId: "handover-editor", expectedResponsibleUserId: null })).status).toBe(200);
    const saved = await request<{ item: { description: string; submittedAt: string | null } }>(`product-feedback/drafts/${id}`, "PATCH", { description: "Successor edited draft" }, "editor");
    expect(saved.status, saved.bodyText).toBe(200);
    expect(saved.body.item).toMatchObject({ description: "Successor edited draft", submittedAt: null });
    const formal = await request<{ items: Array<{ id: string }> }>("product-feedback");
    expect(formal.body.items.map(item => item.id)).not.toContain(id);
    expect((await request(`product-feedback/drafts/${id}/submit`, "POST", {}, "editor")).status).toBe(200);
    expect((await request(`product-feedback/mine/${id}/replies`, "POST", { message: "Successor followed up after submission" }, "editor")).status).toBe(200);
    const result = await request<{ item: { submitter: { name: string }; historicalAttribution: unknown } }>(`product-feedback/${id}`);
    expect(result.status, result.bodyText).toBe(200);
    expect(result.body.item.submitter.name).toBe("Original author");
    expect(result.body.item.historicalAttribution).toMatchObject({ actors: { submitter_user_id: { id: "handover-departing", name: "Original author" } } });
  });
  it("keeps an incomplete import available to administrators without a successor and resumes it with a qualified editor", async () => {
    const opened = await request<{ item: { id: string } }>("knowledge/imports", "POST", { tags: ["retained"] }, "departing");
    expect(opened.status).toBe(201); const id = opened.body.item.id;
    await request("users/handover-departing", "DELETE");
    expect((await request("knowledge/imports/" + id)).status).toBe(200);
    const pending = await request<HandoverList>("knowledge/handovers");
    expect(pending.body.items).toContainEqual(expect.objectContaining({ id, kind: "import", pending: true }));
    expect((await request(`knowledge/handovers/import/${id}`, "PATCH", { expectedResponsibleUserId: null, responsibleUserId: "handover-editor" })).status).toBe(200);
    const imported = await request<{ item: { entryId: string } }>(`knowledge/imports/${id}/documents`, "POST", { relativePath: "continued.md", file: { fileName: "continued.md", contentType: "text/markdown", contentBase64: Buffer.from("Resumed original organization batch").toString("base64") } }, "editor");
    expect(imported.status, imported.bodyText).toBe(200);
    const completed = await request<{ item: { completed: boolean; documentCount: number } }>(`knowledge/imports/${id}/complete`, "POST", {}, "editor");
    expect(completed.status, completed.bodyText).toBe(200);
    expect(completed.body.item).toMatchObject({ completed: true, documentCount: 1 });
    expect((await db.query<{ historical_attribution: unknown }>("select historical_attribution from knowledge_import_batches where id=$1", [id])).rows[0].historical_attribution)
      .toMatchObject({ organization: { id: "handover-org" }, actors: { created_by_user_id: { id: "handover-departing", name: "Original author" } } });
  });
  it("rejects foreign, inactive and unqualified successors and stale assignments without losing pending work", async () => {
    const entry = await draft(), assign = (responsibleUserId: string | null, expectedResponsibleUserId: string | null = "handover-departing", actor = "platform", scope = "handover-org") => request(`knowledge/handovers/entry/${entry.id}`, "PATCH", { responsibleUserId, expectedResponsibleUserId }, actor, scope);
    for (const successor of ["handover-platform", "handover-viewer", "missing-member"]) expect((await assign(successor)).status).toBe(400);
    await request("users/handover-editor/activation", "PATCH", { isActive: false });
    expect((await assign("handover-editor")).status).toBe(400);
    expect((await assign(null, null)).status).toBe(409);
    expect((await assign(null, "handover-departing", "editor")).status).toBe(403);
    expect((await request("knowledge/handovers", "GET", undefined, "viewer")).status).toBe(403);
    expect((await request("knowledge/handovers", "GET", undefined, "admin", "handover-home")).status).toBe(403);
    expect((await assign(null, "handover-departing", "platform", "handover-home")).status).toBe(404);
    expect((await assign(null)).status).toBe(200);
    const retained = await request<{ item: KnowledgeEntryDto }>(`knowledge/entries/${entry.id}`);
    expect(retained.body.item).toMatchObject({ contentMarkdown: "Original unfinished work", responsibleUserId: null });
    expect((await request(`knowledge/entries/${entry.id}`, "GET", undefined, "departing")).status).toBe(404);
    expect((await request(`knowledge/entries/${entry.id}`, "PATCH", { contentMarkdown: "Manager continued pending work", expectedHeadRevisionNumber: 1 })).status).toBe(200);
  });
  it("serializes competing assignments and rolls back responsibility if its audit cannot commit", async () => {
    const entry = await draft(), path = `knowledge/handovers/entry/${entry.id}`;
    const responses = await Promise.all(["handover-editor", "handover-admin"].map(responsibleUserId => request(path, "PATCH", { responsibleUserId, expectedResponsibleUserId: "handover-departing" })));
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    const current = (await request<{ item: KnowledgeEntryDto }>(`knowledge/entries/${entry.id}`)).body.item;
    await db.query("create function reject_handover_audit() returns trigger language plpgsql as $$ begin if new.kind='knowledge-handover' then raise exception 'controlled audit rejection'; end if; return new; end $$");
    await db.query("create trigger reject_handover_audit before insert on audit_events for each row execute function reject_handover_audit()");
    expect((await request(path, "PATCH", { responsibleUserId: null, expectedResponsibleUserId: current.responsibleUserId })).status).toBe(500);
    expect((await request<{ item: KnowledgeEntryDto }>(`knowledge/entries/${entry.id}`)).body.item.responsibleUserId).toBe(current.responsibleUserId);
    expect((await db.query("select id from audit_events where kind='knowledge-handover' and target_id=$1", [entry.id])).rowCount).toBe(1);
  });
  it("hands off feedback triage only to administrators and preserves machine credentials and private conversations", async () => {
    const created = await request<{ item: { id: string } }>("product-feedback", "POST", { description: "Needs a new handler", pagePath: "/knowledge", pageTitle: "Knowledge", feedbackType: "experience" }, "departing");
    expect(created.status).toBe(201); const id = created.body.item.id;
    const assign = (responsibleUserId: string | null, expectedResponsibleUserId: string | null = null) => request(`product-feedback/handovers/${id}`, "PATCH", { responsibleUserId, expectedResponsibleUserId });
    expect((await assign("handover-editor")).status).toBe(400);
    expect((await assign("handover-admin")).status).toBe(200);
    expect((await assign(null)).status).toBe(409);
    const credential = await request<{ item: { id: string } }>("log-integration-credentials", "POST", { name: "Retained organization pipeline", skillId: null });
    expect(credential.status).toBe(201);
    await db.query("update log_integration_credentials set created_by='handover-departing' where id=$1", [credential.body.item.id]);
    await request("users/handover-departing", "DELETE");
    expect((await db.query("select status,created_by from log_integration_credentials where id=$1", [credential.body.item.id])).rows).toEqual([{ status: "active", created_by: null }]);
    expect((await request<{ items: Array<{ id: string }> }>("product-feedback/handovers")).body.items).toContainEqual(expect.objectContaining({ id }));
    expect((await request(`product-feedback/${id}`, "PATCH", { priority: "high" }, "admin")).status).toBe(200);
    expect((await db.query("select id from agent_sessions where actor_user_id='handover-admin'")).rowCount).toBe(0);
  });
});
