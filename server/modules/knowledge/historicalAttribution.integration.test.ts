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
import type { KnowledgeEntryDto, KnowledgeRevisionDto } from "./types";
import type { HistoricalAttribution } from "../../../src/domain/identity/historicalAttribution";

const available = await isTestDatabaseAvailable();
const auth = makeTestAuthContext({ organizationId: "history-org", organizationName: "Original organization",
  userId: "history-author", name: "Original author" });
const manager = makeTestAuthContext({ organizationId: auth.organization.id, userId: "history-manager" });

describe.skipIf(!available)("historical knowledge attribution over HTTP and PostgreSQL", () => {
  let fixture: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: RootDatabase;
  const store = createMemoryObjectStore();
  beforeAll(async () => {
    fixture = await createEphemeralTestDatabase("history1386");
    db = createPostgresDatabase(fixture.url);
    await seedCoreGraph(db, { organization: { id: auth.organization.id, name: auth.organization.name },
      users: [{ id: auth.user.id, name: auth.user.name }, { id: manager.user.id }] });
    await seedCoreGraph(db, { organization: { id: "destination-org", name: "Destination" } });
  });
  afterAll(async () => { await db?.close(); await fixture?.drop(); });

  async function request<T>(path: string, method = "GET", body?: unknown, identity = auth) {
    const router = createRouter();
    registerKnowledgeRoutes(router, { db, objectStore: store, getCurrentAuthContext: () => identity });
    return requestJson<T>(createHttpServer(router), `/api/v1/knowledge/${path}`,
      { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }

  it("keeps creator and revision signatures in the original organization after rename, transfer and account deletion", async () => {
    const created = await request<{ item: KnowledgeEntryDto & { historicalAttribution: HistoricalAttribution } }>("entries", "POST",
      { title: "Retained engineering knowledge", contentForm: "markdown", tags: [], contentMarkdown: "historicalneedle" });
    expect(created.status, created.body).toBe(201);
    const id = created.body.item.id;
    const creator = { id: auth.user.id, name: "Original author", source: "recorded" };
    const organization = { id: auth.organization.id, name: "Original organization", source: "recorded" };
    expect(created.body.item.historicalAttribution).toEqual({ organization, actors: { created_by_user_id: creator } });
    expect((await request<{ items: unknown[] }>("search?q=historicalneedle")).body.items).toEqual([]);
    expect((await request(`entries/${id}/publish`, "POST")).status).toBe(200);

    // The transfer flow clears the old organization's authentication bindings.
    await db.query("delete from user_oidc_identities where user_id=$1", [auth.user.id]);
    await db.query("update users set name='Renamed author',organization_id='destination-org' where id=$1", [auth.user.id]);
    await db.query("update organizations set name='Renamed organization' where id=$1", [auth.organization.id]);
    const read = () => request<{ item: KnowledgeEntryDto & { historicalAttribution: HistoricalAttribution } }>(`entries/${id}`, "GET", undefined, manager);
    expect((await read()).body.item.historicalAttribution).toEqual({ organization, actors: { created_by_user_id: creator } });
    await db.query("delete from users where id=$1", [auth.user.id]);
    const retained = (await read()).body.item;
    expect(retained.createdByUserId).toBeNull();
    expect(retained.historicalAttribution).toEqual({ organization, actors: { created_by_user_id: creator } });
    const revisions = await request<{ items: Array<KnowledgeRevisionDto & { historicalAttribution: HistoricalAttribution }> }>(
      `entries/${id}/revisions`, "GET", undefined, manager);
    expect(revisions.status, revisions.body).toBe(200);
    expect(revisions.body.items[0]).toMatchObject({ authorUserId: null,
      historicalAttribution: { organization, actors: { author_user_id: creator } } });
    expect((await request<{ items: { entryId: string }[] }>("search?q=historicalneedle", "GET", undefined, manager)).body.items)
      .toEqual(expect.arrayContaining([expect.objectContaining({ entryId: id })]));
    const foreign = makeTestAuthContext({ organizationId: "destination-org", userId: "destination-user" });
    expect((await request(`entries/${id}`, "GET", undefined, foreign)).status).toBe(404);
  });
});
