import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWiseEffServer } from "../../app";
import { requestJson } from "../../test/testClient";
import { createPostgresDatabase, type RootDatabase } from "../../shared/database/client";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import { seedBaselineAuthCatalog } from "../auth/baselineCatalog";
import { createMemoryObjectStore } from "../../testing/objectStore";
import { processLogAnalysisJobById } from "../logs/worker";
import { createRuleBasedLogAnalyzer } from "../logs/analyzer";
import { getAuthContext } from "../auth/repository";
import { createUserInvocation } from "../auth/trustedInvocation";
import { changeOrganizationLifecycle } from "../auth/organizationLifecycle";
import { processNextKnowledgeIndexJob } from "../knowledge/indexing/worker";
import { createLogWebhookDeliverer } from "../logs/webhookDelivery";
import { enqueueLogWebhook } from "../logs/webhookOutbox";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createDebuggingService } from "../debugging/service";
import { createAgentToolRegistry } from "../agent/toolRegistry";
import { createAgentApproval, createAgentSession } from "../agent/repository";
import { assertApprovedDeviceWrite } from "../debugging/deviceWriteApproval";
import { deployReloadRun } from "../dts-reload/service";
import { createTrustedRefusalAuditSink } from "../audit/trustedRefusalSink";

describe("Organization lifecycle through real HTTP and PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof createEphemeralTestDatabase>>, db: RootDatabase;
  let objectStore: ReturnType<typeof createMemoryObjectStore>;
  beforeEach(async () => {
    database = await createEphemeralTestDatabase("lifecycle"); db = createPostgresDatabase(database.url);
    objectStore = createMemoryObjectStore();
    await seedCoreGraph(db, { organization: { id: "lifecycle-home", name: "Platform home" }, users: [{ id: "lifecycle-platform" }] });
    await seedCoreGraph(db, { organization: { id: "lifecycle-target", name: "Target organization" }, users: [{ id: "lifecycle-member" }] });
    await seedBaselineAuthCatalog(db);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('lifecycle-platform-role','lifecycle-platform','lifecycle-home','platform-admin'),('lifecycle-member-role','lifecycle-member','lifecycle-target','admin')");
  });
  afterEach(async () => { await db?.close(); await database?.drop(); });
  function request<T>(path: string, method = "GET", body?: unknown, user = "lifecycle-platform") {
    return requestJson<T>(createWiseEffServer({ db, objectStore, env: { AUTH_PROVIDER: "local" } }), path, { method, headers: { "x-wiseeff-user": user }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  const path = "/api/v1/platform/organizations/lifecycle-target/lifecycle";
  it("only lets the platform suspend and restore; members keep read access while business writes stop", async () => {
    expect((await request(path, "PATCH", { status: "suspended", expectedStatus: "active" }, "lifecycle-member")).status).toBe(403);
    const suspended = await request<{ item: { status: string } }>(path, "PATCH", { status: "suspended", expectedStatus: "active" });
    expect(suspended.status).toBe(200); expect(suspended.body.item.status).toBe("suspended");
    expect((await request("/api/v1/organization", "GET", undefined, "lifecycle-member")).status).toBe(200);
    const blocked = await request("/api/v1/organization", "PATCH", { name: "Changed" }, "lifecycle-member");
    expect(blocked.status).toBe(403);
    expect((await request(path, "PATCH", { status: "active", expectedStatus: "active" })).status).toBe(409);
    expect((await request(path, "PATCH", { status: "active", expectedStatus: "suspended" })).status).toBe(200);
    expect((await request("/api/v1/organization", "PATCH", { name: "Changed" }, "lifecycle-member")).status).toBe(200);
  });
  it("serializes a concurrent stop behind an admitted database write and blocks subsequent direct writes", async () => {
    let entered!: () => void, release!: () => void;
    const acquired = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
    const writer = db.transaction(async tx => {
      await tx.query("insert into organization_teams(id,organization_id,name) values('admitted-team','lifecycle-target','Admitted')");
      entered(); await held;
    });
    await acquired;
    const invocation = createUserInvocation(await getAuthContext(db, "lifecycle-platform"));
    let stopped = false;
    const stop = changeOrganizationLifecycle(db, invocation, "lifecycle-target", { status: "suspended", expectedStatus: "active" }, "race-stop").then(() => { stopped = true; });
    // A second connection can observe the still-active state while the write owns admission.
    expect((await db.query("select status from organizations where id='lifecycle-target'")).rows).toEqual([{ status: "active" }]);
    expect(stopped).toBe(false); release(); await writer; await stop;
    await expect(db.query("insert into organization_teams(id,organization_id,name) values('late-team','lifecycle-target','Late')")).rejects.toMatchObject({ code: "55000", message: "Organization is suspended" });
    expect((await request<{ items: Array<{ id: string }> }>("/api/v1/organization/teams", "GET", undefined, "lifecycle-member")).body.items.map(item => item.id)).toEqual(["admitted-team"]);
  });
  it("pauses both queue transports while allowing an already claimed analysis to persist its actual result", async () => {
    const upload = async () => {
      const response = await request<{ log: { id: string }; job: { id: string } }>("/api/v1/log-files?organizationId=lifecycle-target", "POST", {
        fileName: "lifecycle.log", contentType: "text/plain", skillSelection: "generic", contentBase64: Buffer.from("INFO boot\nERROR controller timeout\n").toString("base64")
      });
      expect(response.status, response.bodyText).toBe(201); return response.body;
    };
    const running = await upload(), queued = await upload();
    let entered!: () => void, release!: () => void;
    const analyzing = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
    const work = processLogAnalysisJobById({ db, objectStore, jobId: running.job.id, analyzer: { async analyze(input) {
      entered(); await held; return createRuleBasedLogAnalyzer().analyze(input);
    } } });
    await analyzing;
    expect((await request(path, "PATCH", { status: "suspended", expectedStatus: "active" })).status).toBe(200);
    expect(await processLogAnalysisJobById({ db, objectStore, jobId: queued.job.id })).toEqual({ status: "idle" });
    release(); expect(await work).toEqual({ status: "processed" });
    const read = await request<{ item: { status: string } }>(`/api/v1/logs/${running.log.id}`, "GET", undefined, "lifecycle-member");
    expect(read.status).toBe(200); expect(read.body.item.status).toBe("complete");
    expect((await request(path, "PATCH", { status: "active", expectedStatus: "suspended" })).status).toBe(200);
    expect(await processLogAnalysisJobById({ db, objectStore, jobId: queued.job.id })).toEqual({ status: "processed" });
  });
  it("allows an admitted knowledge index to finish and keeps queued indexes paused", async () => {
    const create = async (title: string) => {
      const entry = await request<{ item: { id: string } }>("/api/v1/knowledge/entries?organizationId=lifecycle-target", "POST", { title, contentForm: "markdown", tags: [], contentMarkdown: "suspendindexuniqueword" });
      expect(entry.status, entry.bodyText).toBe(201);
      expect((await request(`/api/v1/knowledge/entries/${entry.body.item.id}/publish?organizationId=lifecycle-target`, "POST", {})).status).toBe(200);
      return entry.body.item.id;
    };
    const running = await create("Running index"), queued = await create("Queued index");
    let entered!: () => void, release!: () => void;
    const indexing = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
    const work = processNextKnowledgeIndexJob({ db, embeddingClient: { model: "controlled-lifecycle", async embed(texts) { entered(); await held; return texts.map(() => Array.from({ length: 64 }, () => 0)); } } });
    await indexing;
    expect((await request(path, "PATCH", { status: "suspended", expectedStatus: "active" })).status).toBe(200);
    expect(await processNextKnowledgeIndexJob({ db })).toBe("idle");
    release(); expect(await work).toBe("processed");
    expect((await db.query("select entry_id::text,status from knowledge_index_status where entry_id=any($1::uuid[]) order by status", [[running, queued]])).rows).toEqual(expect.arrayContaining([{ entry_id: running, status: "succeeded" }, { entry_id: queued, status: "pending" }]));
    const search = await request<{ items: Array<{ entryId: string }> }>("/api/v1/knowledge/search?q=suspendindexuniqueword", "GET", undefined, "lifecycle-member");
    expect(search.body.items.map(item => item.entryId)).toContain(running);
    expect((await db.query("select status from knowledge_index_status where entry_id=$1", [queued])).rows).toEqual([{ status: "pending" }]);
  });
  it("pauses real webhook attempts and machine access, then restores only still-valid credentials", async () => {
    const issued = await request<{ item: { id: string }; token: string }>("/api/v1/log-integration-credentials?organizationId=lifecycle-target", "POST", { name: "Lifecycle integration", skillId: null });
    expect(issued.status, issued.bodyText).toBe(201);
    const credential = issued.body;
    const machineRequest = () => requestJson(createWiseEffServer({ db, objectStore }), "/api/v1/log-files", { method: "POST", headers: { Authorization: `Bearer ${credential.token}` }, body: JSON.stringify({ fileName: "machine.log", contentType: "text/plain", skillSelection: "generic", contentBase64: Buffer.from("INFO machine").toString("base64") }) });
    const machine = await machineRequest(); expect(machine.status, machine.bodyText).toBe(201);
    const skill = await request<{ item: { id: string } }>("/api/v1/log-domains?organizationId=lifecycle-target", "POST", { name: "Lifecycle callback" });
    const log = (machine.body as { log: { id: string } }).log;
    let deliveries = 0;
    const receiver = createServer((_request, response) => { deliveries++; response.statusCode = 503; response.end(); });
    await new Promise<void>(resolve => receiver.listen(0, "127.0.0.1", resolve));
    try {
      await db.query("update log_domains set webhook_enabled=true,webhook_url=$2,webhook_secret='lifecycle-callback-secret' where id=$1", [skill.body.item.id, `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/callback`]);
      await enqueueLogWebhook(db, { organizationId: "lifecycle-target", logDomainId: skill.body.item.id, logId: log.id, runId: "lifecycle-webhook-run", fileName: "machine.log", status: "complete", occurredAt: new Date().toISOString() });
      const deliverer = createLogWebhookDeliverer({ db, env: { timeoutMs: 1000, maxAttempts: 2, retryBaseDelayMs: 1, allowInsecureLocal: true } });
      expect((await deliverer.processNext())?.status).toBe("retrying"); expect(deliveries).toBe(1);
      expect((await request(path, "PATCH", { status: "suspended", expectedStatus: "active" })).status).toBe(200);
      expect((await machineRequest()).status).toBe(403);
      expect(await deliverer.processNext()).toBeNull(); expect(deliveries).toBe(1);
      expect((await request(path, "PATCH", { status: "active", expectedStatus: "suspended" })).status).toBe(200);
      expect((await deliverer.processNext())?.status).toBe("failed"); expect(deliveries).toBe(2);
      expect((await machineRequest()).status).toBe(201);
      const id = credential.item.id;
      expect((await request(`/api/v1/log-integration-credentials/${id}/revoke?organizationId=lifecycle-target`, "POST", {})).status).toBe(200);
      expect((await request(path, "PATCH", { status: "suspended", expectedStatus: "active" })).status).toBe(200);
      expect((await request(path, "PATCH", { status: "active", expectedStatus: "suspended" })).status).toBe(200);
      expect((await machineRequest()).status).toBe(401);
    } finally { receiver.closeAllConnections(); await new Promise<void>(resolve => receiver.close(() => resolve())); }
  });
  it("rejects invitation acceptance, public registration and direct Agent writes while keeping personal profile usable", async () => {
    const invite = await request<{ token: string }>("/api/v1/organization/invitations?organizationId=lifecycle-target", "POST", { label: "Lifecycle invite", roles: ["software-user"], expiresInDays: 7, teamIds: [], projects: [] });
    expect(invite.status, invite.bodyText).toBe(201);
    expect((await request("/api/v1/platform/experience-registration", "PATCH", { enabled: true, organizationId: "lifecycle-target" })).status).toBe(200);
    expect((await request(path, "PATCH", { status: "suspended", expectedStatus: "active" })).status).toBe(200);
    expect((await request("/api/v1/auth/invitations/accept", "POST", { token: invite.body.token, username: "lifecycle-invite", password: "lifecycle-password", name: "Invited member" })).status).toBe(403);
    expect((await request("/api/v1/auth/register", "POST", { username: "lifecycle-register", password: "lifecycle-password", name: "Public member", roleId: "software-user" })).status).toBe(403);
    const auth = await getAuthContext(db, "lifecycle-member"), registry = createAgentToolRegistry({ db, objectStore });
    await expect(registry.run("action.createKnowledgeDraft", { auth, requestId: "suspended-direct-tool", sessionId: "suspended-direct-session" }, { title: "Must not create", contentMarkdown: "Suspended" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await request("/api/v1/me/profile", "PATCH", { name: "Personal profile" }, "lifecycle-member")).status).toBe(200);
    expect((await request<{ organization: { status?: string } }>("/api/v1/me", "GET", undefined, "lifecycle-member")).body.organization.status).toBe("suspended");
    expect((await db.query("select id from users where id not in ('lifecycle-member','lifecycle-platform')")).rows).toEqual([]);
  });
  it("records a sent device command's actual result before suspension and refuses subsequent direct dispatch", async () => {
    const auth = await getAuthContext(db, "lifecycle-member");
    await db.query("insert into debugging_devices(id,organization_id,name,transport,status,firmware,last_seen_at) values('lifecycle-device','lifecycle-target','Controlled device','hdc','online','controlled',now())");
    await db.query("insert into debugging_targets(id,organization_id,device_id,protocol,target_ref,label,status) values('lifecycle-device-target','lifecycle-target','lifecycle-device','hdc','controlled://lifecycle','Controlled target','detected')");
    let entered!: () => void, release!: () => void, writes = 0;
    const sent = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
    const service = createDebuggingService({ db, gateway: {
      async detectTargets() { return { ok: true, targets: [] }; },
      async readNode() { return { ok: true, value: "1", durationMs: 1 }; },
      async writeNode() { writes++; entered(); await held; return { ok: true, value: "2", verified: true, writeResult: { ok: true, value: "2", durationMs: 1 }, readResult: { ok: true, value: "2", durationMs: 1 } }; }
    } });
    const node = await service.createAdminDebugNode(auth, { name: "Lifecycle node", module: "Lifecycle", bindings: [{ protocol: "hdc", nodePath: "/sys/lifecycle", accessMode: "RW", enabled: true }] }, { requestId: "lifecycle-node" });
    const session = await service.createSession(auth, { deviceId: "lifecycle-device", targetId: "lifecycle-device-target", protocol: "hdc" }, { requestId: "lifecycle-session" });
    const work = service.writeNode(auth, { sessionId: session.id, nodeId: node.id, value: "2", confirmationToken: "confirm-write" }, { requestId: "lifecycle-write" });
    await sent;
    const stop = request(path, "PATCH", { status: "suspended", expectedStatus: "active" });
    release(); const [result, stopped] = await Promise.all([work, stop]);
    expect(result.operation).toMatchObject({ writeOutcome: "executed", readbackOutcome: "observed", requestedValue: "2", readbackValue: "2", verified: null }); expect(stopped.status).toBe(200);
    await expect(service.writeNode(auth, { sessionId: session.id, nodeId: node.id, value: "2", confirmationToken: "confirm-write" }, { requestId: "lifecycle-late-write" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(writes).toBe(1);
    expect((await service.listSessionEvents(auth, { sessionId: session.id })).filter(operation => operation.operationType === "write")).toHaveLength(1);
  });
  it("restoration cannot revive a previously approved device write or pre-suspension reload intent", async () => {
    const auth = await getAuthContext(db, "lifecycle-member"), write = { sessionId: "lifecycle-debug-session", nodeId: "lifecycle-node", value: "2" };
    await createAgentSession(db, { id: "lifecycle-agent-session", organizationId: auth.organization.id, actorUserId: auth.user.id, pageKey: "node-debugging", context: { path: "/node-debugging", pageKey: "node-debugging" }, title: "Device write" });
    await db.query("insert into agent_tool_calls(id,session_id,organization_id,name,label,payload,requires_approval,status) values('lifecycle-device-tool','lifecycle-agent-session','lifecycle-target','action.writeDebugNode','Write device',$1::jsonb,true,'pending_approval')", [JSON.stringify(write)]);
    await createAgentApproval(db, { id: "lifecycle-device-approval", sessionId: "lifecycle-agent-session", toolCallId: "lifecycle-device-tool", organizationId: auth.organization.id, status: "approved", title: "Device write", message: "Approved", requestedByUserId: auth.user.id });
    await expect(assertApprovedDeviceWrite(db, auth, "lifecycle-device-approval", write)).resolves.toBeDefined();
    await db.query("insert into projects(id,organization_id,name,code,status) values('lifecycle-reload-project','lifecycle-target','Lifecycle reload','LIFE','initialized')");
    await db.query("insert into dts_reload_runs(id,organization_id,project_id,status,created_by_user_id) values('lifecycle-old-reload','lifecycle-target','lifecycle-reload-project','validated','lifecycle-member')");
    expect((await request(path, "PATCH", { status: "suspended", expectedStatus: "active" })).status).toBe(200);
    expect((await request(path, "PATCH", { status: "active", expectedStatus: "suspended" })).status).toBe(200);
    await expect(assertApprovedDeviceWrite(db, auth, "lifecycle-device-approval", write)).rejects.toMatchObject({ details: { reason: "organization-lifecycle-changed" } });
    let commands = 0;
    await expect(deployReloadRun(db, objectStore, auth, { runId: "lifecycle-old-reload", bridgeId: "lifecycle-unused-bridge", deviceId: "bridge:lifecycle-unused-bridge", targetRef: "controlled", protocol: "hdc", confirmationTokens: ["confirm-dts-reload"] }, {
      bridgeRpcClient: { async call() { commands++; return {}; } }, bridgeConnectionPool: { isConnected: () => true }
    }, { invocation: createUserInvocation(auth), requestId: "lifecycle-stale-deploy", refusalSink: createTrustedRefusalAuditSink(db) })).rejects.toMatchObject({ details: { reason: "organization-lifecycle-changed" } });
    expect(commands).toBe(0);
    await db.query("insert into users(id,organization_id,name,title,is_active) values('lifecycle-individually-disabled','lifecycle-target','Disabled','Engineer',false)");
    expect((await request(path, "PATCH", { status: "suspended", expectedStatus: "active" })).status).toBe(200);
    expect((await request(path, "PATCH", { status: "active", expectedStatus: "suspended" })).status).toBe(200);
    await expect(getAuthContext(db, "lifecycle-individually-disabled")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
