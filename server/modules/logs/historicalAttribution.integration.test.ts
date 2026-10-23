import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEphemeralTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { createPostgresDatabase, type RootDatabase } from "../../shared/database/client";
import { seedCoreGraph } from "../../testing/fixtures";
import { makeTestAuthContext } from "../../testing/authContext";
import { createMemoryObjectStore } from "../../testing/objectStore";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { requestJson } from "../../test/testClient";
import { registerLogRoutes } from "./routes";
import type { LogRecordDto } from "./types";
import type { LogSkillRevisionDto } from "./skillsRepository";
import { resolveIntegrationCredential } from "../auth/integrationCredentialResolver";

const available = await isTestDatabaseAvailable();
const author = makeTestAuthContext({ organizationId: "log-history", userId: "log-author", name: "Original uploader" });
const manager = makeTestAuthContext({ organizationId: author.organization.id, userId: "log-manager" });

describe.skipIf(!available)("log and analysis-skill historical attribution over HTTP and PostgreSQL", () => {
  let fixture: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: RootDatabase;
  const store = createMemoryObjectStore();
  beforeAll(async () => {
    fixture = await createEphemeralTestDatabase("loghistory1386");
    db = createPostgresDatabase(fixture.url);
    await seedCoreGraph(db, { organization: { id: author.organization.id, name: "Original log organization" },
      users: [{ id: author.user.id, name: author.user.name }, { id: manager.user.id }] });
    await seedCoreGraph(db, { organization: { id: "log-destination" } });
  });
  afterAll(async () => { await db?.close(); await fixture?.drop(); });

  async function request<T>(path: string, method = "GET", body?: unknown, identity = author, token?: string) {
    const router = createRouter();
    registerLogRoutes(router, { db, objectStore: store, getCurrentAuthContext: () => identity,
      getIntegrationPrincipal: (request) => resolveIntegrationCredential(db, request.headers.authorization) });
    return requestJson<T>(createHttpServer(router), `/api/v1/${path}`,
      { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}) });
  }

  it("does not replace uploader or publisher signatures when an account is renamed, moved or deleted", async () => {
    const skill = await request<{ item: { id: string; currentRevision: LogSkillRevisionDto } }>("log-skills", "POST", { name: "Attribution skill" });
    expect(skill.status, skill.bodyText).toBe(201);
    const uploaded = await request<{ log: LogRecordDto }>("log-files", "POST", { fileName: "history.log", contentType: "text/plain",
      skillSelection: "generic", contentBase64: Buffer.from("INFO historical log\n").toString("base64") });
    expect(uploaded.status, uploaded.bodyText).toBe(201);
    expect(uploaded.body.log.submittedBy).toBe("Original uploader");
    const read = () => request<{ item: LogRecordDto }>(`logs/${uploaded.body.log.id}`, "GET", undefined, manager);
    await db.query("delete from user_oidc_identities where user_id=$1", [author.user.id]);
    await db.query("update users set name='Renamed uploader',organization_id='log-destination' where id=$1", [author.user.id]);
    await db.query("update organizations set name='Renamed organization' where id=$1", [author.organization.id]);
    expect((await read()).body.item.submittedBy).toBe("Original uploader");
    await db.query("delete from users where id=$1", [author.user.id]);
    expect((await read()).body.item.submittedBy).toBe("Original uploader");
    const revisions = await request<{ items: LogSkillRevisionDto[] }>(`log-skills/${skill.body.item.id}/revisions`, "GET", undefined, manager);
    expect(revisions.status, revisions.bodyText).toBe(200);
    expect(revisions.body.items[0]).toMatchObject({ publishedByUserId: null, publishedByDisplayName: "Original uploader" });
    expect((await request(`logs/${uploaded.body.log.id}`, "GET", undefined,
      makeTestAuthContext({ organizationId: "log-destination", userId: "foreign" }))).status).toBe(404);
  });

  it("retains the uploading machine credential's signature without assigning a human author", async () => {
    const issued = await request<{ item: { id: string }; token: string }>("log-integration-credentials", "POST",
      { name: "Original build pipeline", skillId: null }, manager);
    expect(issued.status, "integration credential creation").toBe(201);
    const upload = await request<{ log: LogRecordDto }>("log-files", "POST", { fileName: "machine.log", contentType: "text/plain",
      skillSelection: "generic", contentBase64: Buffer.from("INFO historical machine log\n").toString("base64") }, manager, issued.body.token);
    expect(upload.status, upload.bodyText).toBe(201);
    expect(upload.body.log.createdByCredentialName).toBe("Original build pipeline");
    await db.query("update log_integration_credentials set name='Renamed pipeline' where id=$1", [issued.body.item.id]);
    const retained = await request<{ item: LogRecordDto }>(`logs/${upload.body.log.id}`, "GET", undefined, manager, issued.body.token);
    expect(retained.status, retained.bodyText).toBe(200);
    expect(retained.body.item.submittedBy).toBe("集成凭据 Original build pipeline");
    expect(retained.body.item).toMatchObject({ createdByCredentialId: issued.body.item.id, createdByCredentialName: "Original build pipeline",
      historicalAttribution: { actors: {
        submitted_by_user_id: { id: null, name: null, source: "unknown" },
        created_by_credential_id: { id: issued.body.item.id, name: "Original build pipeline", source: "recorded" }
      } } });
  });
});
