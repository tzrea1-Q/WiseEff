import { createHmac, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { WebSocket } from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWiseEffServer } from "../../app";
import { requestJson } from "../../test/testClient";
import { createEphemeralTestDatabase, withTestClusterRoleCatalogLock } from "../../testing/testDatabase";
import { createPostgresDatabase, type RootDatabase } from "../../shared/database/client";
import { seedCoreGraph } from "../../testing/fixtures";
import { seedBaselineAuthCatalog } from "../auth/baselineCatalog";
import { getAuthContext } from "../auth/repository";
import { createXiaozeCheckpointer, type XiaozeCheckpointer } from "./xiaoze/checkpointer";
import { registerAgentCheckpointNamespace } from "./xiaoze/checkpointOwnership";
import { createMemoryObjectStore } from "../../testing/objectStore";
import { createBridgeConnectionPool } from "../deviceBridge/connectionPool";
import { processNextNotificationOutboxEntry } from "../notifications/outboxWorker";
import { createProductFeedback } from "../product-feedback/service";
import { createLocalObjectStore, type ObjectStore } from "../logs/objectStore";
import { createPostgresCheckpointerSaver } from "./xiaoze/durableCheckpointer";
import { createTokenVerifier } from "../auth/tokenVerifier";
import { createXiaozeTurnPersister } from "./xiaoze/threadPersistence";
import { createUserInvocation } from "../auth/trustedInvocation";
import { createPlanningAgent } from "./xiaoze/planningGraph";
import { createBridgeRpcClient } from "../deviceBridge/rpc";
import { provisionPublicationRuntimeLogins, dropLabRuntimeLogins } from "../../testing/labRuntimeLogins";

describe("Organization runtime erasure through HTTP and PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof createEphemeralTestDatabase>>, db: RootDatabase;
  let checkpointer: XiaozeCheckpointer, store: ObjectStore, pool: ReturnType<typeof createBridgeConnectionPool>, objectRoot: string | undefined;
  const saverResources: Array<{ end(): Promise<void> }> = [];
  const checkpointDatabases: Array<Awaited<ReturnType<typeof createEphemeralTestDatabase>>> = [];
  beforeEach(async () => {
    database = await createEphemeralTestDatabase("runtimeerasure"); db = createPostgresDatabase(database.url);
    await withTestClusterRoleCatalogLock(async () => {
      await seedCoreGraph(db, { organization: { id: "runtime-home" }, users: [{ id: "runtime-platform" }] });
      await seedCoreGraph(db, { organization: { id: "runtime-target" }, users: [{ id: "runtime-member" }] });
      await seedBaselineAuthCatalog(db);
    });
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('runtime-platform-role','runtime-platform','runtime-home','platform-admin'),('runtime-member-role','runtime-member','runtime-target','admin')");
    checkpointer = createXiaozeCheckpointer(); store = createMemoryObjectStore(); pool = createBridgeConnectionPool();
  });
  afterEach(async () => {
    await Promise.all(saverResources.splice(0).map(resource => resource.end()));
    await db?.close(); await database?.drop();
    for (const checkpointDatabase of checkpointDatabases.splice(0)) await checkpointDatabase.drop();
    if (objectRoot) await rm(objectRoot, { recursive: true, force: true }); objectRoot = undefined;
  });
  function request<T>(path: string, method = "GET", body?: unknown, user = "runtime-platform") {
    const issuer = "org1398-runtime", secret = "isolated-runtime-erasure-test-secret";
    const payload = Buffer.from(JSON.stringify({ iss: issuer, sub: user, org: user === "runtime-member" ? "runtime-target" : "runtime-home", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
    const token = `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
    return requestJson<T>(createWiseEffServer({ db, agentCheckpointer: checkpointer, objectStore: store, auth: { mode: "production", verifier: createTokenVerifier({ issuer, secret }) }, env: { AUTH_PROVIDER: "hmac" }, deviceBridge: { connectionPool: pool } }), path,
      { method, headers: { Authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  async function start() {
    const path = "/api/v1/platform/organizations/runtime-target";
    const preview = await request<{ item: { stateDigest: string } }>(`${path}/deletion-preview`);
    expect(preview.status, preview.bodyText).toBe(200);
    return request<{ item: { id: string; status: string } }>(`${path}/deletions`, "POST", { stateDigest: preview.body.item.stateDigest, confirmationOrganizationId: "runtime-target" });
  }
  async function checkpoint(thread = "no-session") {
    const key = `runtime-target:runtime-member:${thread}`;
    await checkpointer.withNamespaceLease(key, async () => {
      await registerAgentCheckpointNamespace(db, checkpointer, await getAuthContext(db, "runtime-member"), thread, key);
      await checkpointer.put(key, { private: "erase auxiliary" });
      await checkpointer.saver.put({ configurable: { thread_id: key, checkpoint_ns: "" } },
        { v: 1, id: randomUUID(), ts: new Date().toISOString(), channel_values: { private: "erase checkpoint" }, channel_versions: {}, versions_seen: {} },
        { source: "input", step: 0, parents: {} }, {});
    });
    return key;
  }
  it("erases pre-session checkpoints and B feedback projected into A Home while retaining A accounts and notifications", async () => {
    const key = await checkpoint(), feedback = randomUUID(), progress = randomUUID(), erasedNotification = randomUUID(), retainedNotification = randomUUID();
    await db.query("insert into product_feedback(id,organization_id,submitter_user_id,page_path,page_title,feedback_type,description,submitted_at) values($1,'runtime-target','runtime-platform','/','B page','experience','B content',now())", [feedback]);
    await db.query("insert into product_feedback_progress_events(id,organization_id,feedback_id,kind,public_message) values($1,'runtime-target',$2,'progress','B public message')", [progress, feedback]);
    await db.query("insert into user_notifications(id,organization_id,recipient_user_id,category,title,body,source_kind,source_id,metadata) values($1,'runtime-home','runtime-platform','product-feedback.progress','B title','B content','product-feedback-progress',$2,$3),($4,'runtime-home','runtime-platform','unrelated','A title','A content',null,null,'{}')", [erasedNotification, progress, { feedbackOrganizationId: "runtime-target", feedbackId: feedback }, retainedNotification]);
    const result = await start(); expect(result.status, result.bodyText).toBe(202); expect(result.body.item.status).toBe("deleted");
    expect((await checkpointer.inspectStore(key)).entries).toEqual([]); expect(await checkpointer.get(key)).toBeUndefined();
    expect((await db.query("select id from users where id='runtime-platform'")).rowCount).toBe(1);
    expect((await db.query("select id from user_notifications order by id")).rows).toEqual([{ id: retainedNotification }]);
    expect((await db.query("select id from product_feedback where id=$1", [feedback])).rowCount).toBe(0);
  });
  it("clears archived Agent state, nested debug modules and operation/snapshot cycles", async () => {
    await db.query(`insert into agent_sessions(id,organization_id,actor_user_id,page_key,context,status,title) values('archived-run','runtime-target','runtime-platform','xiaoze','{}','archived','Archived B content');
      insert into debug_node_modules(id,organization_id,name) values('parent-module','runtime-target','Parent');
      insert into debug_node_modules(id,organization_id,name,parent_id) values('child-module','runtime-target','Child','parent-module');
      insert into debug_nodes(id,organization_id,name,debug_node_module_id) values('debug-node','runtime-target','Node','child-module');
      insert into debug_node_bindings(id,organization_id,node_id,protocol,node_path,access_mode) values('debug-binding','runtime-target','debug-node','adb','/node','RW');
      insert into debugging_devices(id,organization_id,name,transport,status,firmware) values('device','runtime-target','Device','adb','online','firmware');
      insert into debugging_targets(id,organization_id,device_id,target_ref,label,status) values('target','runtime-target','device','target','Target','online');
      insert into debugging_sessions(id,organization_id,device_id,target_id,actor_user_id,status) values('debug-session','runtime-target','device','target','runtime-member','active');
      insert into debug_device_leases(organization_id,device_id,session_id,lease_owner_user_id,expires_at) values('runtime-target','device','debug-session','runtime-member',now()+interval '1 minute');
      insert into node_operations(id,organization_id,session_id,node_id,node_path,operation_type,status,actor_user_id) values('operation','runtime-target','debug-session','debug-node','/node','write','failed','runtime-member');
      insert into debugging_snapshots(id,organization_id,session_id,operation_id,status,risk,entries,created_by_user_id) values('snapshot','runtime-target','debug-session','operation','valid','Low','[]','runtime-member');
      update node_operations set snapshot_id='snapshot' where id='operation';
      insert into debugging_events(id,organization_id,session_id,operation_id,kind,severity,message) values('event','runtime-target','debug-session','operation','write','Low','Unconfirmed device outcome');`);
    const result = await start(); expect(result.status, result.bodyText).toBe(202); expect(result.body.item.status).toBe("deleted");
    for (const table of ["agent_sessions", "debug_nodes", "debug_node_modules", "debug_node_bindings", "debugging_devices", "debugging_targets", "debugging_sessions", "debug_device_leases", "node_operations", "debugging_snapshots", "debugging_events"]) {
      expect((await db.query(`select organization_id from ${table} where organization_id='runtime-target'`)).rowCount, table).toBe(0);
    }
  });
  it("does not recreate B content from a notification worker's claimed in-memory payload after deletion", async () => {
    const outbox = randomUUID();
    await db.query("insert into notification_outbox(id,organization_id,idempotency_key,payload) values($1::uuid,'runtime-home',$1::text,$2)", [outbox,
      { organizationId: "runtime-home", recipientUserId: "runtime-platform", category: "product-feedback.progress", title: "B title", body: "B private content", metadata: { feedbackOrganizationId: "runtime-target", feedbackId: randomUUID() } }]);
    let release!: () => void, entered!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
    const delivery = processNextNotificationOutboxEntry({ db, tracing: { async withSpan(_name, _attributes, work) { entered(); await held; return work({}); } } });
    await started;
    try { expect((await start()).body.item.status).toBe("deleted"); }
    finally { release(); }
    await delivery;
    expect((await db.query("select id from user_notifications where id=$1", [outbox])).rowCount).toBe(0);
    expect((await db.query("select id from notification_outbox where id=$1", [outbox])).rowCount).toBe(0);
  });
  it("refuses an unplannable feedback object store before physical IO", async () => {
    let puts = 0;
    const unknown = { get: store.get, delete: store.delete, put: async (input: Parameters<typeof store.put>[0]) => { puts++; return store.put(input); } };
    await expect(createProductFeedback(db, unknown, await getAuthContext(db, "runtime-member"), { pagePath: "/", pageTitle: "Page", feedbackType: "experience", description: "Feedback",
      attachments: [{ fileName: "screen.png", contentType: "image/png", contentBase64: Buffer.from("image").toString("base64") }] })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(puts).toBe(0);
    expect((await db.query("select id from product_feedback")).rowCount).toBe(0);
  });
  it("rejects a late foreign-Home enqueue containing erased feedback content", async () => {
    expect((await start()).body.item.status).toBe("deleted");
    await expect(db.query("insert into notification_outbox(id,organization_id,idempotency_key,payload) values($1,'runtime-home','late-source',$2)", [randomUUID(),
      { organizationId: "runtime-home", recipientUserId: "runtime-platform", category: "product-feedback.progress", title: "B title", body: "B content", metadata: { feedbackOrganizationId: "runtime-target" } }])).rejects.toMatchObject({ code: "55000" });
  });
  it("waits for the actual separate Postgres namespace writer and rejects late turn persistence", async () => {
    const checkpointDatabase = await createEphemeralTestDatabase("checkpoints"); checkpointDatabases.push(checkpointDatabase);
    const handle = createPostgresCheckpointerSaver({ connectionString: checkpointDatabase.url }); saverResources.push(handle.saver);
    await handle.ensureSetup();
    checkpointer = createXiaozeCheckpointer({ mode: "postgres", saver: handle.saver, withNamespaceLease: handle.withNamespaceLease, ensureReady: handle.ensureSetup });
    const key = "runtime-target:runtime-member:separate-store", original = await getAuthContext(db, "runtime-member");
    let release!: () => void, entered!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
    const graph = createPlanningAgent({ checkpointer, listTools: () => [], runTool: async () => { throw new Error("No tool expected"); },
      admitNamespace: (input, namespace) => registerAgentCheckpointNamespace(db, checkpointer, original, input.threadId, namespace),
      model: { async invoke() { entered(); await held; return { content: "Private model answer" }; } } });
    const writer = graph.run({ message: "Question", context: {}, threadId: "separate-store", requestContext: { auth: original, requestId: "held-graph", sessionId: "separate-store" } }); await started;
    const deletion = start();
    try {
      await expect.poll(async () => (await db.query<{ status: string }>("select status from organizations where id='runtime-target'")).rows[0]?.status).toBe("deleting");
      expect((await db.query("select id from users where id='runtime-member'")).rowCount).toBe(1);
      await expect(createXiaozeTurnPersister({ db })({ auth: original, invocation: createUserInvocation(original), requestId: "late-turn", threadId: "late-session", runId: "late-run", pageContext: {}, assistantMessage: { id: "late-message", content: "Must never return" } })).rejects.toBeDefined();
    } finally { release(); await writer; }
    expect((await deletion).body.item.status).toBe("deleted");
    expect((await checkpointer.inspectStore(key)).entries).toEqual([]);
    expect((await db.query("select id from agent_sessions where id='late-session'")).rowCount).toBe(0);
  });
  it("retains exact physical keys across failure and restart after the uploading account is gone", async () => {
    objectRoot = await mkdtemp(path.join(tmpdir(), "org1398-feedback-")); store = createLocalObjectStore(objectRoot);
    const created = await createProductFeedback(db, store, await getAuthContext(db, "runtime-member"), { pagePath: "/", pageTitle: "Page", feedbackType: "experience", description: "Feedback",
      attachments: [{ fileName: "screen.png", contentType: "image/png", contentBase64: Buffer.from("physical image").toString("base64") }] });
    const key = created.attachments[0]!.storageKey;
    await db.query("delete from users where id='runtime-member'");
    const remove = store.delete!; store.delete = async () => { throw new Error("isolated object failure"); };
    const result = await start(); expect(result.status, result.bodyText).toBe(202); expect(result.body.item.status).toBe("failed");
    expect(await store.get(key)).toEqual(Buffer.from("physical image"));
    expect((await db.query("select object_key from organization_runtime_erasure_objects where erasure_id=$1", [result.body.item.id])).rows).toEqual([{ object_key: key }]);
    await db.close(); db = createPostgresDatabase(database.url); checkpointer = createXiaozeCheckpointer(); store.delete = remove;
    const retry = await request<{ item: { status: string } }>(`/api/v1/platform/organization-deletions/${result.body.item.id}/retry`, "POST");
    expect(retry.body.item.status).toBe("deleted"); await expect(store.get(key)).rejects.toBeDefined();
    expect((await db.query("select object_key from organization_runtime_erasure_objects")).rowCount).toBe(0);
  });
  it("waits for a feedback put before adopting its planned key and prevents the late content commit", async () => {
    objectRoot = await mkdtemp(path.join(tmpdir(), "org1398-held-put-")); store = createLocalObjectStore(objectRoot);
    const put = store.put; let release!: () => void, entered!: () => void, key!: string;
    const held = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
    store.put = async input => { key = store.planKey!(input); const written = await put(input); entered(); await held; return written; };
    const upload = createProductFeedback(db, store, await getAuthContext(db, "runtime-member"), { pagePath: "/", pageTitle: "Page", feedbackType: "experience", description: "Late feedback",
      attachments: [{ fileName: "screen.png", contentType: "image/png", contentBase64: Buffer.from("held image").toString("base64") }] }).then(value => ({ value }), error => ({ error }));
    await started; const deletion = start();
    try {
      await expect.poll(async () => (await db.query<{ status: string }>("select status from organizations where id='runtime-target'")).rows[0]?.status).toBe("deleting");
      expect(await store.get(key)).toEqual(Buffer.from("held image"));
      expect((await db.query("select id from users where id='runtime-member'")).rowCount).toBe(1);
    } finally { release(); }
    expect(await upload).toHaveProperty("error");
    expect((await deletion).body.item.status).toBe("deleted"); await expect(store.get(key)).rejects.toBeDefined();
  });
  it("retains a shared foreign feedback object while deleting all B references", async () => {
    const object = await store.put({ organizationId: "runtime-home", fileName: "shared.png", contentType: "image/png", bytes: Buffer.from("shared bytes") });
    const feedbackA = randomUUID(), feedbackB = randomUUID();
    await db.query("insert into product_feedback(id,organization_id,submitter_user_id,page_path,page_title,feedback_type,description) values($1,'runtime-home','runtime-platform','/','A','experience','Retain A'),($2,'runtime-target','runtime-member','/','B','experience','Erase B')", [feedbackA, feedbackB]);
    for (const [id, org, feedback] of [[randomUUID(), "runtime-home", feedbackA], [randomUUID(), "runtime-target", feedbackB]]) await db.query("insert into product_feedback_attachments(id,organization_id,feedback_id,storage_key,file_name,content_type,size_bytes,checksum,sort_order) values($1,$2,$3,$4,'shared.png','image/png',12,'shared',0)", [id, org, feedback, object.storageKey]);
    expect((await start()).body.item.status).toBe("deleted"); expect(await store.get(object.storageKey)).toEqual(Buffer.from("shared bytes"));
    expect((await db.query("select id from product_feedback where id=$1", [feedbackA])).rowCount).toBe(1);
  });
  it("disconnects a real paired WebSocket, settles pending and queued RPCs and denies reconnect", async () => {
    const issued = await request<{ code: string }>("/api/v1/device-bridges/pairing-codes", "POST", {}, "runtime-member"); expect(issued.status, issued.bodyText).toBe(201);
    const paired = await request<{ bridgeId: string; bridgeToken: string }>("/api/v1/device-bridges/pair", "POST", { code: issued.body.code, machineLabel: "B PC", platform: "linux", arch: "amd64" }); expect(paired.status, paired.bodyText).toBe(201);
    const server = createWiseEffServer({ db, agentCheckpointer: checkpointer, objectStore: store, deviceBridge: { connectionPool: pool, artifactRoot: path.join(tmpdir(), "org1398-controlled-artifacts") } });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("No WS port");
    const connect = () => new WebSocket(`ws://127.0.0.1:${address.port}/api/v1/device-bridges/ws`, { headers: { Authorization: `Bridge ${paired.body.bridgeToken}` } });
    const socket = connect();
    try {
      await once(socket, "message");
      const rpc = createBridgeRpcClient({ pool }), first = rpc.call(paired.body.bridgeId, "debug.writeNode", { value: "already sent" }).catch(error => (error as Error).message);
      await once(socket, "message");
      const queued = rpc.call(paired.body.bridgeId, "debug.readNode").catch(error => (error as Error).message), closed = once(socket, "close");
      expect((await start()).body.item.status).toBe("deleted");
      expect((await closed)[0]).toBe(4401); expect(await first).toBe("Bridge disconnected."); expect(await queued).toMatch(/not connected/);
      const stale = connect(); expect((await once(stale, "close"))[0]).toBe(4401); stale.terminate();
      expect((await db.query("select id from device_bridges where organization_id='runtime-target'")).rowCount).toBe(0);
    } finally { socket.terminate(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
  it("erases through a non-superuser API login while worker custody and private mutation stay denied", async () => {
    const token = `runtime${randomUUID().replaceAll("-", "").slice(0, 10)}`, logins = await provisionPublicationRuntimeLogins(database.url, { mode: "lab", runToken: token });
    const admin = db, worker = createPostgresDatabase(logins.workerUrl); db = createPostgresDatabase(logins.apiUrl);
    try {
      expect((await db.query("select rolsuper from pg_roles where rolname=current_user")).rows).toEqual([{ rolsuper: false }]);
      await checkpoint(); expect((await start()).body.item.status).toBe("deleted");
      await expect(worker.query("select * from organization_runtime_erasure_objects")).rejects.toMatchObject({ code: "42501" });
      await expect(db.query("update parameter_catalog.parameter_definitions set id=id where false")).rejects.toMatchObject({ code: "42501" });
    } finally { await db.close(); db = admin; await worker.close(); await dropLabRuntimeLogins(database.url, token); }
  });
});
