import type { Server } from "node:http";
import { randomBytes } from "node:crypto";
import { WebSocket } from "ws";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createWiseEffServer } from "../../app";
import { createPostgresDatabase } from "../../shared/database/client";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import { createBridgeConnectionPool } from "./connectionPool";
import { createBridgeRpcClient } from "./rpc";
import { createDeviceBridgeRepository } from "./repository";
import { createDeviceBridgeWsHandler } from "./wsHandler";
import { createSimulatorDebugDeviceGateway } from "../debugging/simulator";
import { dropLabRuntimeLogins, provisionPublicationRuntimeLogins } from "../../testing/labRuntimeLogins";
import { requestJson } from "../../test/testClient";

type Bridge = { id: string; ownerUserId: string; ownerName: string; machineLabel: string; online: boolean; revokedAt: string | null };
let database: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
let db: ReturnType<typeof createPostgresDatabase>, server: Server, origin: string;
const pool = createBridgeConnectionPool();
const sockets: WebSocket[] = [];
beforeAll(async () => {
  database = await createEphemeralTestDatabase("bridge-admin"); db = createPostgresDatabase(database.url);
  for (const org of ["bridge-admin", "bridge-other"]) {
    await seedCoreGraph(db, { organization: { id: org }, users: [{ id: `${org}-admin`, name: "Organization admin" }, { id: `${org}-member`, name: "Bridge member" }] });
    for (const role of ["admin", "member"]) await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values($1,$2,$3,$4)", [`${org}-${role}`, `${org}-${role}`, org, role === "admin" ? "admin" : "software-user"]);
  }
  await db.query("insert into users(id,organization_id,name,title) values('bridge-scope-platform','bridge-admin','Platform operator','Admin')");
  await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('bridge-scope-platform-role','bridge-scope-platform','bridge-admin','platform-admin')");
  server = createWiseEffServer({ db, debugGateway: createSimulatorDebugDeviceGateway({ targets: [] }), deviceBridge: { connectionPool: pool, rpcClient: createBridgeRpcClient({ pool }), artifactRoot: "/tmp/wiseeff-1320-controlled-artifacts" } });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No HTTP port"); origin = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  for (const socket of sockets) socket.terminate();
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  await db?.close(); await database?.drop();
});
async function request<T = unknown>(path: string, method = "GET", body?: unknown, user = "bridge-admin-admin") {
  const response = await fetch(`${origin}${path}`, { method, headers: { "Content-Type": "application/json", "X-WiseEff-User": user }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json() as T };
}
async function pair(label: string, user = "bridge-admin-member") {
  const issued = await request<{ code: string }>("/api/v1/device-bridges/pairing-codes", "POST", {}, user); expect(issued.status).toBe(201);
  const paired = await request<{ bridgeId: string; bridgeToken: string }>("/api/v1/device-bridges/pair", "POST", { code: issued.body.code, machineLabel: label, platform: "linux", arch: "amd64", clientVersion: "0.1.1" }, user); expect(paired.status).toBe(201);
  return paired.body;
}
function connect(token: string) {
  const socket = new WebSocket(origin.replace("http:", "ws:") + "/api/v1/device-bridges/ws", { headers: { authorization: `Bridge ${token}` } }); sockets.push(socket); return socket;
}
const closed = (socket: WebSocket) => new Promise<number>((resolve, reject) => { socket.once("close", resolve); socket.once("error", reject); });
const hello = (socket: WebSocket) => new Promise<void>((resolve, reject) => { socket.once("message", raw => { expect(JSON.parse(raw.toString())).toMatchObject({ type: "bridge.hello" }); resolve(); }); socket.once("error", reject); });

it("governs an explicit target's live pairing under the real platform identity while personal pairing and execution stay with the owner", async () => {
  const platform = "bridge-scope-platform", scope = "?organizationId=bridge-other";
  const paired = await pair("TARGET-OWNER-PC", "bridge-other-member"), socket = connect(paired.bridgeToken); await hello(socket);
  socket.on("message", raw => {
    const message = JSON.parse(raw.toString()) as { type: string; id: string; method: string };
    if (message.type === "rpc.request" && message.method === "debug.detectTargets") socket.send(JSON.stringify({ type: "rpc.response", id: message.id, ok: true, result: { targets: [{ targetRef: "scope-target", label: "Target device", online: true }] } }));
  });
  const listed = await request<{ items: Bridge[] }>(`/api/v1/device-bridges/organization${scope}`, "GET", undefined, platform);
  expect(listed.status).toBe(200);
  expect(listed.body.items).toContainEqual(expect.objectContaining({ id: paired.bridgeId, ownerUserId: "bridge-other-member", online: true }));
  expect(JSON.stringify(listed.body)).not.toMatch(/capabilities|tokenHash|token_hash|bridgeToken|pairingCode/);
  const path = `/api/v1/device-bridges/organization/${paired.bridgeId}`;
  expect((await request<{ item: Bridge }>(`${path}${scope}`, "GET", undefined, platform)).body.item.id).toBe(paired.bridgeId);
  expect((await request(path, "GET", undefined, platform)).status).toBe(404);
  for (const [route, method, body] of [[`/api/v1/device-bridges/organization${scope}`, "GET"], [`${path}${scope}`, "GET"], [`${path}/revoke${scope}`, "POST", { reason: "Forbidden" }]] as const) {
    expect((await request(route, method, body)).status).toBe(403);
    expect((await request(route, method, body, "bridge-admin-member")).status).toBe(403);
  }
  const personal = await request<{ code: string }>(`/api/v1/device-bridges/pairing-codes${scope}`, "POST", {}, platform);
  const homePair = await request<{ bridgeId: string }>("/api/v1/device-bridges/pair", "POST", { code: personal.body.code, machineLabel: "PLATFORM-HOME-PC", platform: "linux", arch: "amd64" }, platform);
  expect(homePair.status).toBe(201);
  expect((await request<{ items: Bridge[] }>(`/api/v1/device-bridges/mine${scope}`, "GET", undefined, platform)).body.items.map(item => item.id)).toEqual([homePair.body.bridgeId]);
  const detected = await request<{ items: Array<{ id: string; deviceId: string }> }>("/api/v1/debugging/targets/detect", "POST", { protocol: "hdc", bridgeId: paired.bridgeId }, "bridge-other-member");
  expect(detected.status).toBe(200);
  const target = detected.body.items.find(item => item.id.includes(paired.bridgeId))!;
  expect((await request(`/api/v1/debugging/sessions${scope}`, "POST", { deviceId: target.deviceId, targetId: target.id, bridgeId: paired.bridgeId, protocol: "hdc" }, platform)).status).toBe(404);
  expect((await request(`/api/v1/device-bridges/${paired.bridgeId}/revoke${scope}`, "POST", {}, platform)).status).toBe(404);
  const disconnected = closed(socket);
  const revoked = await request<{ item: Bridge }>(`${path}/revoke${scope}`, "POST", { reason: "Target organization governance" }, platform);
  expect(revoked.status).toBe(200); expect(revoked.body.item.revokedAt).toEqual(expect.any(String));
  expect(await disconnected).toBe(4401); expect(await closed(connect(paired.bridgeToken))).toBe(4401);
  expect((await db.query("select actor_user_id,organization_id,metadata from audit_events where kind='device-bridge-admin-revoke' and target_id=$1", [paired.bridgeId])).rows)
    .toEqual([{ actor_user_id: platform, organization_id: "bridge-other", metadata: expect.objectContaining({ actorHomeOrganizationId: "bridge-admin", operatingOrganizationId: "bridge-other", ownerUserId: "bridge-other-member" }) }]);
});

it("lets an organization administrator inventory and revoke a member's actual connection without transferring ownership", async () => {
  const paired = await pair("MEMBER-PC"); const socket = connect(paired.bridgeToken); await hello(socket);
  const listed = await request<{ items: Bridge[] }>("/api/v1/device-bridges/organization");
  expect(listed.status).toBe(200);
  expect(listed.body.items).toContainEqual(expect.objectContaining({ id: paired.bridgeId, ownerUserId: "bridge-admin-member", ownerName: "Bridge member", machineLabel: "MEMBER-PC", online: true, revokedAt: null }));
  expect(JSON.stringify(listed.body)).not.toContain(paired.bridgeToken); expect(JSON.stringify(listed.body)).not.toMatch(/tokenHash|token_hash|capabilities|pairingCode/);
  expect((await request<{ items: Bridge[] }>("/api/v1/device-bridges/mine")).body.items).toEqual([]);
  const disconnected = closed(socket);
  const path = `/api/v1/device-bridges/organization/${paired.bridgeId}`;
  const revoked = await request<{ item: Bridge }>(`${path}/revoke`, "POST", { reason: "成员离职" });
  expect(revoked.status).toBe(200); expect(revoked.body.item).toMatchObject({ id: paired.bridgeId, ownerUserId: "bridge-admin-member", online: false, revokedAt: expect.any(String), lastSeenAt: expect.any(String) });
  expect(await disconnected).toBe(4401); expect(await closed(connect(paired.bridgeToken))).toBe(4401);
  const repeated = await request<{ item: Bridge }>(`${path}/revoke`, "POST", { reason: "重复确认" }); expect(repeated.status).toBe(200); expect(repeated.body.item.revokedAt).toBe(revoked.body.item.revokedAt);
  expect((await request<{ item: Bridge }>(path)).body.item).toMatchObject({ id: paired.bridgeId, online: false });
  expect((await db.query("select actor_user_id,metadata from audit_events where target_id=$1 and kind='device-bridge-admin-revoke'", [paired.bridgeId])).rows)
    .toEqual([{ actor_user_id: "bridge-admin-admin", metadata: expect.objectContaining({ reason: "成员离职", ownerUserId: "bridge-admin-member" }) }]);
});

it("keeps member management private, rejects foreign organization details and permits only home organization administrators", async () => {
  const own = await pair("PRIVATE-PC"), other = await pair("OTHER-ORG-PC", "bridge-other-member");
  const base = `/api/v1/device-bridges/organization/${own.bridgeId}`;
  for (const [path, method, body] of [["/api/v1/device-bridges/organization", "GET"], [base, "GET"], [`${base}/revoke`, "POST", { reason: "no authority" }]] as const) {
    expect((await request(path, method, body, "bridge-admin-member")).status).toBe(403);
  }
  expect((await request("/api/v1/device-bridges/organization?organizationId=bridge-other")).status).toBe(403);
  expect((await request(`/api/v1/device-bridges/organization/${other.bridgeId}`)).status).toBe(404);
  expect((await request(`/api/v1/device-bridges/organization/${other.bridgeId}/revoke`, "POST", { reason: "wrong organization" })).status).toBe(404);
  expect((await request(`/api/v1/device-bridges/${own.bridgeId}/revoke`, "POST", {})).status).toBe(404);
  expect((await request<{ items: Bridge[] }>("/api/v1/device-bridges/mine", "GET", undefined, "bridge-admin-member")).body.items.map(item => item.id)).toContain(own.bridgeId);
  const items = (await request<{ items: Bridge[] }>("/api/v1/device-bridges/organization")).body.items;
  expect(items.map(item => item.id)).toContain(own.bridgeId); expect(items.map(item => item.id)).not.toContain(other.bridgeId);
  await db.query("insert into users(id,organization_id,name,title) values('bridge-platform','bridge-admin','Platform admin','Admin')");
  await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('bridge-platform','bridge-platform','bridge-admin','platform-admin')");
  expect((await request("/api/v1/device-bridges/organization", "GET", undefined, "bridge-platform")).status).toBe(200);
  for (const body of [{ reason: " " }, { reason: "x".repeat(501) }, { reason: "ok", ownerUserId: "bridge-admin-admin" }]) expect((await request(`${base}/revoke`, "POST", body)).status).toBe(400);
});

it("keeps device execution restricted to its owner after an administrator has inventoried the bridge", async () => {
  const paired = await pair("EXECUTION-OWNER-PC"), socket = connect(paired.bridgeToken); await hello(socket);
  socket.on("message", raw => {
    const message = JSON.parse(raw.toString()) as { type: string; id: string; method: string };
    if (message.type === "rpc.request" && message.method === "debug.detectTargets") socket.send(JSON.stringify({ type: "rpc.response", id: message.id, ok: true, result: { targets: [{ targetRef: "controlled-target", label: "Controlled target", online: true }] } }));
  });
  expect((await request("/api/v1/device-bridges/organization")).status).toBe(200);
  const detected = await request<{ items: Array<{ id: string; deviceId: string }> }>("/api/v1/debugging/targets/detect", "POST", { protocol: "hdc", bridgeId: paired.bridgeId }, "bridge-admin-member");
  expect(detected.status).toBe(200); const target = detected.body.items.find(item => item.id.includes(paired.bridgeId))!; expect(target).toBeDefined();
  const body = { deviceId: target.deviceId, targetId: target.id, bridgeId: paired.bridgeId, protocol: "hdc" };
  const denied = await request<{ error: { message: string } }>("/api/v1/debugging/sessions", "POST", body);
  expect(denied.status).toBe(404); expect(denied.body.error.message).toBe("Device bridge was not found.");
  expect((await request("/api/v1/debugging/sessions", "POST", body, "bridge-admin-member")).status).toBe(201);
  socket.close();
});

it("rolls back administrator and owner revocation with audit failure and serializes competing administrator requests", async () => {
  for (const ownerAction of [false, true]) {
    const paired = await pair(`AUDIT-PC-${ownerAction}`), socket = connect(paired.bridgeToken); await hello(socket);
    await db.query("create function reject_bridge_revoke() returns trigger language plpgsql as $$ begin raise exception 'audit unavailable'; end $$");
    await db.query("create trigger reject_bridge_revoke before insert on audit_events for each row when(new.kind in ('device-bridge-admin-revoke','device-bridge-revoke')) execute function reject_bridge_revoke()");
    try {
      const path = ownerAction ? `/api/v1/device-bridges/${paired.bridgeId}/revoke` : `/api/v1/device-bridges/organization/${paired.bridgeId}/revoke`;
      expect((await request(path, "POST", { reason: "rollback" }, ownerAction ? "bridge-admin-member" : "bridge-admin-admin")).status).toBe(500);
      expect((await request<{ item: Bridge }>(`/api/v1/device-bridges/organization/${paired.bridgeId}`)).body.item).toMatchObject({ revokedAt: null, online: true });
      const pong = new Promise<void>(resolve => socket.once("message", raw => { expect(JSON.parse(raw.toString()).type).toBe("bridge.pong"); resolve(); }));
      socket.send(JSON.stringify({ type: "bridge.ping" })); await pong;
    } finally { await db.query("drop trigger reject_bridge_revoke on audit_events; drop function reject_bridge_revoke()"); }
    const disconnected = closed(socket);
    const raced = await Promise.all(["First reason", "Second reason"].map(reason => request<{ item: Bridge }>(`/api/v1/device-bridges/organization/${paired.bridgeId}/revoke`, "POST", { reason })));
    expect(raced.map(response => response.status)).toEqual([200, 200]); expect(raced[0]!.body.item.revokedAt).toBe(raced[1]!.body.item.revokedAt); expect(await disconnected).toBe(4401);
    expect((await db.query("select id from audit_events where target_id=$1 and kind='device-bridge-admin-revoke'", [paired.bridgeId])).rows).toHaveLength(1);
  }
});

it.each([1, 2])("fences an actual WebSocket handshake revoked during authorization read %s", async heldRead => {
  const paired = await pair(`HANDSHAKE-PC-${heldRead}`), repo = createDeviceBridgeRepository(db);
  let entered!: () => void, release!: () => void, reads = 0;
  const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  const wsHandler = createDeviceBridgeWsHandler({ pool, repo: { ...repo, validateBridgeToken: async input => {
    const result = await repo.validateBridgeToken(input);
    if (++reads === heldRead) { entered(); await held; }
    return result;
  } } });
  const raceServer = createWiseEffServer({ db, deviceBridge: { connectionPool: pool, wsHandler, wsPath: "/api/v1/device-bridges/ws" } });
  await new Promise<void>(resolve => raceServer.listen(0, "127.0.0.1", resolve)); const address = raceServer.address();
  if (!address || typeof address === "string") throw new Error("No race port");
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/v1/device-bridges/ws`, { headers: { authorization: `Bridge ${paired.bridgeToken}` } }); sockets.push(socket);
  const messages: string[] = []; socket.on("message", raw => messages.push(raw.toString())); const disconnected = closed(socket);
  try {
    await started;
    expect((await request(`/api/v1/device-bridges/organization/${paired.bridgeId}/revoke`, "POST", { reason: "handshake race" })).status).toBe(200);
    release(); expect(await disconnected).toBe(4401); expect(pool.isConnected(paired.bridgeId)).toBe(false); expect(messages).toEqual([]);
  } finally { release(); socket.terminate(); await new Promise<void>(resolve => raceServer.close(() => resolve())); }
});

it("closes an established connection when another API runtime revokes its token", async () => {
  const paired = await pair("OTHER-RUNTIME-PC"), remotePool = createBridgeConnectionPool();
  const remote = createWiseEffServer({ db, deviceBridge: { connectionPool: remotePool, wsPath: "/api/v1/device-bridges/ws",
    wsHandler: createDeviceBridgeWsHandler({ pool: remotePool, repo: createDeviceBridgeRepository(db), heartbeatIntervalMs: 20 }) } });
  await new Promise<void>(resolve => remote.listen(0, "127.0.0.1", resolve)); const address = remote.address(); if (!address || typeof address === "string") throw new Error("No remote port");
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/v1/device-bridges/ws`, { headers: { authorization: `Bridge ${paired.bridgeToken}` } }); sockets.push(socket);
  try {
    await hello(socket); const disconnected = closed(socket);
    expect((await request(`/api/v1/device-bridges/organization/${paired.bridgeId}/revoke`, "POST", { reason: "other API runtime" })).status).toBe(200);
    expect(await disconnected).toBe(4401); expect(remotePool.isConnected(paired.bridgeId)).toBe(false);
  } finally { socket.terminate(); await new Promise<void>(resolve => remote.close(() => resolve())); }
});

it("serves inventory and revocation through the actual NOINHERIT API LOGIN without granting private Catalog access", async () => {
  const paired = await pair("API-LOGIN-PC"), token = `bridge${randomBytes(5).toString("hex")}`;
  let api: ReturnType<typeof createPostgresDatabase> | undefined;
  try {
    const runtime = await provisionPublicationRuntimeLogins(database.url, { mode: "lab", runToken: token }); api = createPostgresDatabase(runtime.apiUrl);
    expect((await api.query("select rolsuper,rolinherit from pg_roles where rolname=current_user")).rows[0]).toEqual({ rolsuper: false, rolinherit: false });
    const apiServer = () => createWiseEffServer({ db: api, deviceBridge: { connectionPool: pool } });
    expect((await requestJson(apiServer(), "/api/v1/device-bridges/organization", { headers: { "X-WiseEff-User": "bridge-admin-admin" } })).status).toBe(200);
    const revoked = await requestJson(apiServer(), `/api/v1/device-bridges/organization/${paired.bridgeId}/revoke`, { method: "POST", headers: { "X-WiseEff-User": "bridge-admin-admin" }, body: JSON.stringify({ reason: "API LOGIN governance" }) }); expect(revoked.status, revoked.bodyText).toBe(200);
    expect(await closed(connect(paired.bridgeToken))).toBe(4401);
    await expect(api.query("delete from parameter_catalog.log_erasures")).rejects.toMatchObject({ code: "42501" });
  } finally { await api?.close(); await dropLabRuntimeLogins(database.url, token); }
});
