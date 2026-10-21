import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEphemeralTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { createPostgresDatabase, type RootDatabase } from "../../shared/database/client";
import { seedCoreGraph } from "../../testing/fixtures";
import { makeTestAuthContext } from "../../testing/authContext";
import { createMemoryObjectStore } from "../../testing/objectStore";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { requestJson } from "../../test/testClient";
import { registerKnowledgeRoutes } from "./routes";
import type { KnowledgeEntryDto } from "./types";
import { processNextKnowledgeIndexJob } from "./indexing/worker";

const available = await isTestDatabaseAvailable();
const owner = makeTestAuthContext({ organizationId: "k1331-org", userId: "k1331-owner", permissions: ["knowledge:view", "knowledge:edit"] });
const other = makeTestAuthContext({ organizationId: owner.organization.id, userId: "k1331-other", permissions: owner.permissions });
const foreign = makeTestAuthContext({ organizationId: "k1331-foreign", userId: "k1331-foreign-user", permissions: owner.permissions });
const manager = { ...owner, permissions: ["knowledge:view", "knowledge:manage"] as typeof owner.permissions };

describe.skipIf(!available)("knowledge batches over HTTP and PostgreSQL", () => {
  let fixture: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: RootDatabase;
  const store = createMemoryObjectStore();
  beforeAll(async () => {
    fixture = await createEphemeralTestDatabase("k1331batch");
    db = createPostgresDatabase(fixture.url);
    await seedCoreGraph(db, { organization: { id: owner.organization.id }, users: [{ id: owner.user.id }, { id: other.user.id }] });
    await seedCoreGraph(db, { organization: { id: foreign.organization.id }, users: [{ id: foreign.user.id }] });
  });
  afterAll(async () => { await db?.close(); await fixture?.drop(); });

  async function request(path: string, body: unknown = {}, auth = owner, method = "POST") {
    const router = createRouter();
    registerKnowledgeRoutes(router, { db, objectStore: store, getCurrentAuthContext: () => auth });
    return requestJson<{
      item: KnowledgeEntryDto;
      items: { entryId: string }[];
      summaryError: string | null;
      results: { entryId: string; title: string | null; status: string; entry: KnowledgeEntryDto | null; error: { code: string; message: string; reason?: string } | null }[];
    }>(createHttpServer(router), `/api/v1/knowledge/${path}`, { method, ...(method === "GET" ? {} : { body: JSON.stringify(body) }) });
  }
  async function create(title: string, auth = owner, tags = ["k1331"]) {
    const result = await request("entries", { contentForm: "markdown", title, tags, contentMarkdown: "k1331 batch retrieval" }, auth);
    expect(result.status).toBe(201);
    return result.body.item;
  }
  it("returns stable reasons for illegal transitions and archived edits", async () => {
    const draft = await create("reason codes");
    const illegal = await request("entries/batch", { action: "archive", entryIds: [draft.id] });
    expect(illegal.body.results[0].error).toMatchObject({ code: "VALIDATION_FAILED", reason: "knowledge-illegal-status-transition" });
    await request(`entries/${draft.id}/publish`);
    await request(`entries/${draft.id}/archive`);
    const archived = await request("entries/batch", { action: "add_tags", entryIds: [draft.id], tags: ["new"] });
    expect(archived.body.results[0].error).toMatchObject({ code: "VALIDATION_FAILED", reason: "knowledge-entry-archived" });
    expect((await request(`entries/${draft.id}`, {}, owner, "GET")).body.item).toMatchObject({ status: "archived", tags: ["k1331"] });
  });

  async function drainIndex() {
    for (let round = 0; round < 50; round++) {
      if (await processNextKnowledgeIndexJob({ db }) === "idle") return;
    }
    throw new Error("Knowledge index did not drain.");
  }

  it("reports mixed ownership, invisible entries and invalid transitions without losing successful writes", async () => {
    const first = await create("first");
    const refused = await create("other published", other);
    await request(`entries/${refused.id}/publish`, {}, other);
    const hidden = await create("private title", other);
    const isolated = await create("foreign title", foreign);
    const last = await create("last");
    const missing = randomUUID();
    const result = await request("entries/batch", { action: "publish", entryIds: [first.id, refused.id, hidden.id, isolated.id, missing, last.id] });
    expect(result.status).toBe(200);
    expect(result.body.results.map(({ entryId, status, error }) => [entryId, status, error?.code ?? null])).toEqual([
      [first.id, "succeeded", null], [refused.id, "refused", "FORBIDDEN"], [hidden.id, "refused", "NOT_FOUND"],
      [isolated.id, "refused", "NOT_FOUND"], [missing, "refused", "NOT_FOUND"], [last.id, "succeeded", null]
    ]);
    expect(result.body.results[1].title).toBe("other published");
    expect(result.body.results[2].title).toBeNull();
    expect(JSON.stringify(result.body)).not.toMatch(/private title|foreign title/);
    expect(result.body.summaryError).toBeNull();
    await drainIndex();
    expect((await request("search?q=k1331", {}, owner, "GET")).body.items.map((entry) => entry.entryId)).toEqual(expect.arrayContaining([first.id, last.id, refused.id]));
    const archive = await request("entries/batch", { action: "archive", entryIds: [first.id, hidden.id, isolated.id, last.id] }, manager);
    expect(archive.body.results.map((row) => [row.status, row.error?.code ?? null])).toEqual([
      ["succeeded", null], ["failed", "VALIDATION_FAILED"], ["refused", "NOT_FOUND"], ["succeeded", null]
    ]);
    expect((await request(`entries/${first.id}`, {}, owner, "GET")).body.item.status).toBe("archived");
    expect((await request(`entries/${last.id}`, {}, owner, "GET")).body.item.status).toBe("archived");
    const audits = await db.query<{ target_id: string; kind: string }>(
      "select target_id, kind from audit_events where target_id = any($1::text[]) and kind in ('knowledge-entry-publish', 'knowledge-entry-archive') order by target_id, kind",
      [[first.id, last.id, hidden.id]]);
    expect(audits.rows).toHaveLength(4);
    // Archive excludes stale chunks immediately, and the worker removes their projection.
    expect((await request("search?q=k1331", {}, owner, "GET")).body.items.map((entry) => entry.entryId)).not.toContain(first.id);
    await drainIndex();
    expect((await request("search?q=k1331", {}, owner, "GET")).body.items.map((entry) => entry.entryId)).not.toContain(last.id);
    const summaries = await db.query<{ metadata: { results: unknown[] } }>(
      "select metadata from audit_events where kind = 'knowledge-batch' and action = 'publish' and organization_id = $1", [owner.organization.id]);
    expect(summaries.rows[0].metadata.results).toHaveLength(6);
  });

  it("adds/removes tags through revisions, permits manage without edit and refuses unauthorized owners", async () => {
    const own = await create("tag own", owner, ["keep", "remove"]);
    const published = await create("tag other", other, ["keep"]);
    await request(`entries/${published.id}/publish`, {}, other);
    const full = await create("full tags", owner, Array.from({ length: 20 }, (_, index) => `tag${index}`));
    const last = await create("after full");
    const result = await request("entries/batch", { action: "add_tags", entryIds: [own.id, published.id, full.id, last.id], tags: ["new", "new"] });
    expect(result.body.results.map((row) => [row.status, row.error?.code ?? null])).toEqual([
      ["succeeded", null], ["refused", "FORBIDDEN"], ["failed", "VALIDATION_FAILED"], ["succeeded", null]
    ]);
    expect(result.body.results[0].entry).toMatchObject({ tags: ["keep", "remove", "new"], headRevisionNumber: 2, contentMarkdown: "k1331 batch retrieval" });
    expect((await request(`entries/${full.id}`, {}, owner, "GET")).body.item.headRevisionNumber).toBe(1);
    const removed = await request("entries/batch", { action: "remove_tags", entryIds: [own.id, published.id], tags: ["remove", "keep"] }, manager);
    expect(removed.body.results.map((row) => row.status)).toEqual(["succeeded", "succeeded"]);
    expect(removed.body.results[0].entry).toMatchObject({ tags: ["new"], headRevisionNumber: 3 });
    expect(removed.body.results[1].entry).toMatchObject({ tags: [], status: "published", headRevisionNumber: 2 });
    const reader = { ...owner, permissions: ["knowledge:view"] as typeof owner.permissions };
    expect((await request("entries/batch", { action: "add_tags", entryIds: [own.id], tags: ["no"] }, reader)).body.results[0]).toMatchObject({ status: "refused", error: { code: "FORBIDDEN" } });
    const privateEntry = await create("manager publish", other);
    expect((await request("entries/batch", { action: "publish", entryIds: [privateEntry.id] }, manager)).body.results[0].status).toBe("succeeded");
    const audits = await db.query<{ count: number }>("select count(*)::int as count from audit_events where target_id = $1 and kind = 'knowledge-entry-update'", [own.id]);
    expect(audits.rows[0].count).toBe(2);
  });

  it("rolls back only the entry whose audit fails and sanitizes unexpected database errors", async () => {
    const first = await create("before failure");
    const broken = await create("audit failure");
    const last = await create("after failure");
    await db.query("create table k1331_fail_audit_targets (id text primary key)");
    await db.query("insert into k1331_fail_audit_targets (id) values ($1)", [broken.id]);
    await db.query(`create function k1331_fail_audit() returns trigger language plpgsql as $$
      begin if new.kind = 'knowledge-entry-publish' and exists (select 1 from k1331_fail_audit_targets where id = new.target_id) then
        raise exception 'k1331 secret database details'; end if; return new; end $$`);
    await db.query("create trigger k1331_fail_audit before insert on audit_events for each row execute function k1331_fail_audit()");
    try {
      const result = await request("entries/batch", { action: "publish", entryIds: [first.id, broken.id, last.id] });
      expect(result.status).toBe(200);
      expect(result.body.results.map((row) => row.status)).toEqual(["succeeded", "failed", "succeeded"]);
      expect(result.body.results[1].error).toEqual({ code: "INTERNAL_ERROR", message: "Internal server error." });
      expect((await request(`entries/${broken.id}`, {}, owner, "GET")).body.item.status).toBe("draft");
      expect((await request(`entries/${first.id}`, {}, owner, "GET")).body.item.status).toBe("published");
      expect((await request(`entries/${last.id}`, {}, owner, "GET")).body.item.status).toBe("published");
    } finally {
      await db.query("drop trigger k1331_fail_audit on audit_events");
      await db.query("drop function k1331_fail_audit()");
      await db.query("drop table k1331_fail_audit_targets");
    }
  });

  it("returns committed outcomes even if the extra summary audit fails", async () => {
    const entry = await create("summary failure");
    await db.query(`create function k1331_fail_summary() returns trigger language plpgsql as $$
      begin if new.kind = 'knowledge-batch' then raise exception 'summary unavailable'; end if; return new; end $$`);
    await db.query("create trigger k1331_fail_summary before insert on audit_events for each row execute function k1331_fail_summary()");
    try {
      const result = await request("entries/batch", { action: "publish", entryIds: [entry.id] });
      expect(result.status).toBe(200);
      expect(result.body.results[0]).toMatchObject({ status: "succeeded", entry: { status: "published" } });
      expect(result.body.summaryError).toContain("批次汇总审计写入失败");
    } finally {
      await db.query("drop trigger k1331_fail_summary on audit_events");
      await db.query("drop function k1331_fail_summary()");
    }
  });

  it("validates batch bounds and action-specific payloads before writing", async () => {
    const entry = await create("validation");
    for (const body of [
      { action: "publish", entryIds: [] }, { action: "publish", entryIds: [entry.id, entry.id] },
      { action: "publish", entryIds: Array.from({ length: 201 }, () => randomUUID()) },
      { action: "publish", entryIds: [entry.id], tags: ["unexpected"] },
      { action: "add_tags", entryIds: [entry.id], tags: [] },
      { action: "add_tags", entryIds: [entry.id], tags: ["x".repeat(61)] },
      { action: "remove_tags", entryIds: [entry.id] }, { action: "delete", entryIds: [entry.id] }
    ]) expect((await request("entries/batch", body)).status).toBe(400);
    expect((await request(`entries/${entry.id}`, {}, owner, "GET")).body.item).toMatchObject({ headRevisionNumber: 1, status: "draft" });
  });
});
