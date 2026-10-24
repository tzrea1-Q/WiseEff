import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createWiseEffServer } from "../../app";
import { requestJson } from "../../test/testClient";
import { createPostgresDatabase, type RootDatabase } from "../../shared/database/client";
import { seedCoreGraph } from "../../testing/fixtures";
import { createEphemeralTestDatabase, withTestClusterRoleCatalogLock } from "../../testing/testDatabase";
import { provisionPublicationRuntimeLogins, dropLabRuntimeLogins } from "../../testing/labRuntimeLogins";
import { seedBaselineAuthCatalog } from "../auth/baselineCatalog";
import { hashLocalAccountPassword } from "../auth/localAccountCredentials";
import { createLocalObjectStore } from "../logs/objectStore";
import { createRuleBasedLogAnalyzer } from "../logs/analyzer";
import { processLogAnalysisJobById } from "../logs/worker";
import { enqueueLogWebhook } from "../logs/webhookOutbox";
import { createLogWebhookDeliverer } from "../logs/webhookDelivery";
import { createXiaozeCheckpointer } from "../agent/xiaoze/checkpointer";

let database: Awaited<ReturnType<typeof createEphemeralTestDatabase>>, db: RootDatabase, api: RootDatabase, worker: RootDatabase;
let directory: string, apiUrl: string, store: ReturnType<typeof createLocalObjectStore>;
const password = "operational-lifecycle-test-password", roleToken = `org1401${randomUUID().replaceAll("-", "").slice(0, 10)}`;
const checkpointer = createXiaozeCheckpointer();
beforeAll(async () => {
  database = await createEphemeralTestDatabase("org1401"); db = createPostgresDatabase(database.url);
  directory = await mkdtemp(path.join(tmpdir(), "org1401-operational-")); store = createLocalObjectStore(directory);
  await withTestClusterRoleCatalogLock(async () => {
    await seedCoreGraph(db, { organization: { id: "operational-home" }, users: [{ id: "operational-platform" }] });
    await seedBaselineAuthCatalog(db);
  });
  await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('operational-platform-role','operational-platform','operational-home','platform-admin')");
  await db.query("insert into user_password_credentials(user_id,username,password_hash) values('operational-platform','operational-platform',$1)", [await hashLocalAccountPassword(password)]);
  const runtime = await provisionPublicationRuntimeLogins(database.url, { mode: "lab", runToken: roleToken });
  apiUrl = runtime.apiUrl; api = createPostgresDatabase(apiUrl); worker = createPostgresDatabase(runtime.workerUrl);
  for (const [connection, actor] of [[api, runtime.apiRole], [worker, runtime.workerRole]] as const) {
    expect((await connection.query("select current_user as actor,rolsuper,rolinherit from pg_roles where rolname=current_user")).rows).toEqual([{ actor, rolsuper: false, rolinherit: false }]);
  }
});
afterAll(async () => {
  await api?.close(); await worker?.close();
  if (database) expect((await dropLabRuntimeLogins(database.url, roleToken)).failed).toEqual([]);
  await db?.close(); await database?.drop(); if (directory) await rm(directory, { recursive: true, force: true });
});

it("retains offboarded work through suspension, real worker/callback completion and an uncertain physical deletion retry", async () => {
  const request = <T = unknown>(route: string, method = "GET", body?: unknown, token = "") => requestJson<T>(createWiseEffServer({ db: api, objectStore: store, agentCheckpointer: checkpointer,
    env: { AUTH_PROVIDER: "local", AUTH_LOCAL_SELF_REGISTER: false }, auth: { mode: "production" } }), route,
  { method, headers: { Authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const login = async (username: string) => {
    const response = await request<{ token: string; auth: { user: { id: string } } }>("/api/v1/auth/login", "POST", { username, password });
    expect(response.status, response.bodyText).toBe(200); return response.body;
  };
  const platform = await login("operational-platform");
  const created = await request<{ item: { id: string } }>("/api/v1/platform/organizations", "POST", { name: "Operational target",
    initialAdministrator: { name: "Retained administrator", username: "operational-admin", password } }, platform.token);
  expect(created.status, created.bodyText).toBe(201); const org = created.body.item.id, admin = await login("operational-admin");
  const scope = (route: string) => `${route}${route.includes("?") ? "&" : "?"}organizationId=${org}`;
  const author = await request<{ item: { id: string } }>(scope("/api/v1/users"), "POST", { name: "Departing author", username: "operational-author", password, roles: [{ roleId: "admin" }] }, admin.token);
  expect(author.status, author.bodyText).toBe(201); const departing = await login("operational-author");
  const draft = await request<{ item: { id: string; historicalAttribution: unknown } }>("/api/v1/knowledge/entries", "POST", { title: "Retained draft", contentForm: "markdown", tags: [], contentMarkdown: "Unfinished operational work" }, departing.token);
  expect(draft.status, draft.bodyText).toBe(201);
  const machine = await request<{ token: string }>("/api/v1/log-integration-credentials", "POST", { name: "Independent organization pipeline", skillId: null }, departing.token);
  expect(machine.status, machine.bodyText).toBe(201);
  const upload = async () => {
    const result = await request<{ job: { id: string }; log: { id: string }; fileObject: { storageKey: string } }>("/api/v1/log-files", "POST", {
      fileName: "operational.log", contentType: "text/plain", skillSelection: "generic", contentBase64: Buffer.from("INFO lifecycle\nERROR actual worker result\n").toString("base64") }, machine.body.token);
    return result;
  };
  expect((await request(scope(`/api/v1/users/${departing.auth.user.id}/activation`), "PATCH", { isActive: false }, platform.token)).status).toBe(200);
  expect((await request("/api/v1/me", "GET", undefined, departing.token)).status).toBe(401);
  const handover = await request(scope(`/api/v1/knowledge/handovers/entry/${draft.body.item.id}`), "PATCH", { responsibleUserId: admin.auth.user.id, expectedResponsibleUserId: departing.auth.user.id }, platform.token);
  expect(handover.status, handover.bodyText).toBe(200);
  const updated = await request<{ item: { historicalAttribution: unknown; createdByUserId: string } }>(`/api/v1/knowledge/entries/${draft.body.item.id}`, "PATCH", { contentMarkdown: "Same draft continued by successor", expectedHeadRevisionNumber: 1 }, admin.token);
  expect(updated.status, updated.bodyText).toBe(200); expect(updated.body.item.createdByUserId).toBe(departing.auth.user.id);
  expect(updated.body.item.historicalAttribution).toEqual(draft.body.item.historicalAttribution);
  const running = await upload(), queued = await upload(); expect(running.status, running.bodyText).toBe(201); expect(queued.status, queued.bodyText).toBe(201);
  const skill = await request<{ item: { id: string } }>(scope("/api/v1/log-domains"), "POST", { name: "Operational loopback callback" }, platform.token);
  expect(skill.status, skill.bodyText).toBe(201);
  let deliveries = 0, responseStatus = 503;
  const receiver = createServer(async (incoming, response) => { for await (const _chunk of incoming) { /* consume real HTTP body */ } deliveries++; response.writeHead(responseStatus); response.end("observed"); });
  await new Promise<void>(resolve => receiver.listen(0, "127.0.0.1", resolve));
  const address = receiver.address(); if (!address || typeof address === "string") throw new Error("Loopback callback did not bind");
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }), analyzing = new Promise<void>(resolve => { entered = resolve; });
  const processing = processLogAnalysisJobById({ db: worker, objectStore: store, jobId: running.body.job.id, analyzer: { async analyze(input) { entered(); await held; return createRuleBasedLogAnalyzer().analyze(input); } } });
  await analyzing;
  const lifecycle = `/api/v1/platform/organizations/${org}/lifecycle`;
  try {
    await db.query("update log_domains set webhook_enabled=true,webhook_url=$2,webhook_secret='isolated-operational-callback' where id=$1", [skill.body.item.id, `http://127.0.0.1:${address.port}/hook`]);
    await enqueueLogWebhook(db, { organizationId: org, logDomainId: skill.body.item.id, logId: running.body.log.id, runId: "operational-webhook", fileName: "operational.log", status: "complete", occurredAt: new Date().toISOString() });
    const deliverer = createLogWebhookDeliverer({ db: worker, env: { timeoutMs: 1000, maxAttempts: 3, retryBaseDelayMs: 1, allowInsecureLocal: true } });
    expect((await deliverer.processNext())?.status).toBe("retrying"); expect(deliveries).toBe(1);
    expect((await request(lifecycle, "PATCH", { status: "suspended", expectedStatus: "active" }, platform.token)).status).toBe(200);
    expect((await upload()).status).toBe(403); expect(await deliverer.processNext()).toBeNull(); expect(deliveries).toBe(1);
    expect(await processLogAnalysisJobById({ db: worker, objectStore: store, jobId: queued.body.job.id })).toEqual({ status: "idle" });
    release(); expect(await processing).toEqual({ status: "processed" });
    expect((await request(`/api/v1/knowledge/entries/${draft.body.item.id}`, "GET", undefined, admin.token)).status).toBe(200);
    expect((await request(lifecycle, "PATCH", { status: "active", expectedStatus: "suspended" }, platform.token)).status).toBe(200);
    responseStatus = 200; expect((await deliverer.processNext())?.status).toBe("delivered"); expect(deliveries).toBe(2);
    expect(await processLogAnalysisJobById({ db: worker, objectStore: store, jobId: queued.body.job.id })).toEqual({ status: "processed" });
    expect((await request("/api/v1/me", "GET", undefined, departing.token)).status).toBe(401);
    const retained = await store.put({ organizationId: "operational-home", fileName: "retained.txt", contentType: "text/plain", bytes: Buffer.from("A retained operational bytes") });
    const remove = store.delete!.bind(store); let uncertain = true;
    store.delete = async key => { await remove(key); if (uncertain && key === running.body.fileObject.storageKey) { uncertain = false; throw new Error("Lost physical delete response"); } };
    const preview = await request<{ item: { stateDigest: string } }>(`/api/v1/platform/organizations/${org}/deletion-preview`, "GET", undefined, platform.token);
    expect(preview.status, preview.bodyText).toBe(200);
    const erased = await request<{ item: { id: string; status: string; domains: Record<string, { status: string }> } }>(`/api/v1/platform/organizations/${org}/deletions`, "POST", { stateDigest: preview.body.item.stateDigest, confirmationOrganizationId: org }, platform.token);
    expect(erased.status, erased.bodyText).toBe(202); expect(erased.body.item.status).toBe("failed");
    expect(erased.body.item.domains).toMatchObject({ "agent-devices-feedback": { status: "complete" }, knowledge: { status: "complete" }, "projects-parameters": { status: "complete" }, logs: { status: "failed" } });
    await expect(store.get(running.body.fileObject.storageKey)).rejects.toMatchObject({ code: "ENOENT" });
    await api.close(); api = createPostgresDatabase(apiUrl); store.delete = remove;
    const retried = await request<{ item: { status: string; domains: object; attempts: number } }>(`/api/v1/platform/organization-deletions/${erased.body.item.id}/retry`, "POST", undefined, platform.token);
    expect(retried.status, retried.bodyText).toBe(200); expect(retried.body.item).toMatchObject({ status: "deleted", domains: {}, attempts: 0 });
    expect((await db.query("select id from organizations where id=$1", [org])).rowCount).toBe(0);
    expect((await db.query("select id from knowledge_entries where id=$1", [draft.body.item.id])).rowCount).toBe(0);
    expect((await db.query("select id from jobs where organization_id=$1", [org])).rowCount).toBe(0);
    expect(await deliverer.processNext()).toBeNull(); expect(deliveries).toBe(2);
    expect((await store.get(retained.storageKey)).toString()).toBe("A retained operational bytes");
    expect((await request("/api/v1/me", "GET", undefined, platform.token)).status).toBe(200);
    expect((await request("/api/v1/me", "GET", undefined, admin.token)).status).toBe(401);
  } finally { release(); await processing; receiver.closeAllConnections(); await new Promise<void>(resolve => receiver.close(() => resolve())); }
}, 30_000);
