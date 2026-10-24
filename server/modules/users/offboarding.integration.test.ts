import type { Server } from "node:http";
import { once } from "node:events";
import { createHmac, generateKeyPairSync, sign } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import pg from "pg";
import { createWiseEffServer } from "../../app";
import { createPostgresDatabase, type RootDatabase } from "../../shared/database/client";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import { createMemoryObjectStore } from "../../testing/objectStore";
import { hashLocalAccountPassword } from "../auth/localAccountCredentials";
import { createLocalAuthService } from "../auth/localAuth";
import { createBridgeConnectionPool } from "../deviceBridge/connectionPool";
import { createBridgeRpcClient } from "../deviceBridge/rpc";
import { createTokenVerifier } from "../auth/tokenVerifier";
import { createOidcVerifier } from "../auth/oidcVerifier";
import { requestJson } from "../../test/testClient";

type Session = { token: string };
type Pair = { bridgeId: string; bridgeToken: string };
const password = "Offboarding-test-password";
describe("member offboarding through real authentication, HTTP and PostgreSQL", () => {
  let db: RootDatabase, ephemeral: Awaited<ReturnType<typeof createEphemeralTestDatabase>>, server: Server, origin: string;
  let pool: ReturnType<typeof createBridgeConnectionPool>;
  const sockets: WebSocket[] = [];
  beforeEach(async () => {
    ephemeral = await createEphemeralTestDatabase("offboarding"); db = createPostgresDatabase(ephemeral.url);
    await seedCoreGraph(db, { organization: { id: "offboard-home" }, users: [{ id: "offboard-admin" }, { id: "offboard-member" }] });
    await db.query(`insert into user_role_bindings(id,user_id,organization_id,role_id) values
      ('offboard-admin-role','offboard-admin','offboard-home','admin'),
      ('offboard-member-role','offboard-member','offboard-home','software-user')`);
    const hash = await hashLocalAccountPassword(password);
    for (const userId of ["offboard-admin", "offboard-member"]) await db.query("insert into user_password_credentials(user_id,username,password_hash) values($1,$1,$2)", [userId, hash]);
    pool = createBridgeConnectionPool();
    server = createWiseEffServer({ db, objectStore: createMemoryObjectStore(), auth: { mode: "production" }, env: { AUTH_PROVIDER: "local" }, localAuthService: createLocalAuthService(db), deviceBridge: { connectionPool: pool, artifactRoot: "/tmp/wiseeff-offboard-controlled-artifacts" } });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("No HTTP port"); origin = `http://127.0.0.1:${address.port}`;
  });
  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.terminate();
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    await db?.close(); await ephemeral?.drop();
  });
  async function request<T = unknown>(path: string, method = "GET", body?: unknown, token?: string) {
    const response = await fetch(`${origin}/api/v1/${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: response.status === 204 ? null as T : await response.json() as T };
  }
  async function login(username: string) {
    const response = await request<Session>("auth/login", "POST", { username, password }); expect(response.status).toBe(200); return response.body.token;
  }
  async function pair(token: string) {
    const issued = await request<{ code: string }>("device-bridges/pairing-codes", "POST", {}, token); expect(issued.status).toBe(201);
    const paired = await request<Pair>("device-bridges/pair", "POST", { code: issued.body.code, machineLabel: "Departing PC", platform: "linux", arch: "amd64" }); expect(paired.status).toBe(201); return paired.body;
  }
  function connect(token: string) {
    const socket = new WebSocket(origin.replace("http:", "ws:") + "/api/v1/device-bridges/ws", { headers: { Authorization: `Bridge ${token}` } }); sockets.push(socket); return socket;
  }
  it("revokes every existing local session permanently before handover and preserves organization machine credentials", async () => {
    const admin = await login("offboard-admin"), member = await login("offboard-member"), second = await login("offboard-member");
    const machine = await request<{ item: { id: string }; token: string }>("log-integration-credentials", "POST", { name: "Organization pipeline", skillId: null }, admin); expect(machine.status).toBe(201);
    await db.query("update log_integration_credentials set created_by='offboard-member' where id=$1", [machine.body.item.id]);
    expect((await request("users/offboard-member/activation", "PATCH", { isActive: false }, admin)).status).toBe(200);
    expect((await request("me", "GET", undefined, member)).status).toBe(401);
    expect((await request("users/offboard-member/activation", "PATCH", { isActive: true }, admin)).status).toBe(200);
    expect((await request("me", "GET", undefined, member)).status).toBe(401);
    expect((await request("me", "GET", undefined, second)).status).toBe(401);
    expect((await request("me", "GET", undefined, await login("offboard-member"))).status).toBe(200);
    const machineResponse = await request("log-files", "POST", { fileName: "device.log", contentType: "text/plain", contentBase64: Buffer.from("INFO boot\n").toString("base64") }, machine.body.token);
    expect(machineResponse.status).toBe(201);
  });
  it("disconnects a real paired WebSocket and invalidates its token and unconsumed pairing code through disable and re-enable", async () => {
    const admin = await login("offboard-admin"), member = await login("offboard-member"), paired = await pair(member);
    const unused = await request<{ code: string }>("device-bridges/pairing-codes", "POST", {}, member);
    const socket = connect(paired.bridgeToken); await once(socket, "message");
    const pending = createBridgeRpcClient({ pool }).call(paired.bridgeId, "debug.detectTargets").then(() => "unexpected success", error => (error as Error).message);
    expect(JSON.parse(String((await once(socket, "message"))[0]))).toMatchObject({ type: "rpc.request", method: "debug.detectTargets" });
    const disconnected = once(socket, "close");
    expect((await request("users/offboard-member/activation", "PATCH", { isActive: false }, admin)).status).toBe(200);
    expect((await disconnected)[0]).toBe(4401);
    expect(await pending).toBe("Bridge disconnected.");
    expect((await request("users/offboard-member/activation", "PATCH", { isActive: true }, admin)).status).toBe(200);
    expect((await once(connect(paired.bridgeToken), "close"))[0]).toBe(4401);
    expect((await request("device-bridges/pair", "POST", { code: unused.body.code, machineLabel: "Late PC", platform: "linux", arch: "amd64" })).status).toBe(400);
  });
  it("serializes an in-flight pairing with offboarding so neither its token nor its pairing code can return after reactivation", async () => {
    const admin = await login("offboard-admin"), member = await login("offboard-member");
    const issued = await request<{ code: string }>("device-bridges/pairing-codes", "POST", {}, member);
    const blocker = new pg.Client({ connectionString: ephemeral.url }); await blocker.connect();
    await blocker.query("select pg_advisory_lock(13871387)");
    let pairing: Promise<Awaited<ReturnType<typeof request<Pair>>>> | undefined, disabling: Promise<Awaited<ReturnType<typeof request>>> | undefined;
    try {
      await db.query("create function pause_offboard_pair() returns trigger language plpgsql as $$ begin if new.kind='device-bridge-pair' then perform pg_advisory_xact_lock(13871387); end if; return new; end $$");
      await db.query("create trigger pause_offboard_pair before insert on audit_events for each row execute function pause_offboard_pair()");
      pairing = request<Pair>("device-bridges/pair", "POST", { code: issued.body.code, machineLabel: "Concurrent PC", platform: "linux", arch: "amd64" });
      const blocked = async () => Number((await db.query<{ count: string }>("select count(*)::text from pg_stat_activity where datname=current_database() and cardinality(pg_blocking_pids(pid))>0")).rows[0].count);
      await expect.poll(blocked).toBe(1);
      disabling = request("users/offboard-member/activation", "PATCH", { isActive: false }, admin);
      await expect.poll(blocked).toBe(2);
    } finally {
      await blocker.query("select pg_advisory_unlock(13871387)"); await blocker.end();
    }
    expect((await disabling!).status).toBe(200);
    const paired = await pairing!; expect(paired.status).toBe(201);
    expect((await request("users/offboard-member/activation", "PATCH", { isActive: true }, admin)).status).toBe(200);
    expect((await once(connect(paired.body.bridgeToken), "close"))[0]).toBe(4401);
    expect((await request("device-bridges/pair", "POST", { code: issued.body.code, machineLabel: "Cannot return", platform: "linux", arch: "amd64" })).status).toBe(400);
  });
  it("rolls back disabling, session and pairing revocation together when the audit cannot commit", async () => {
    const admin = await login("offboard-admin"), member = await login("offboard-member"), paired = await pair(member);
    const socket = connect(paired.bridgeToken); await once(socket, "message");
    await db.query("create function reject_offboard_audit() returns trigger language plpgsql as $$ begin if new.kind='user-activation' then raise exception 'audit unavailable'; end if; return new; end $$");
    await db.query("create trigger reject_offboard_audit before insert on audit_events for each row execute function reject_offboard_audit()");
    expect((await request("users/offboard-member/activation", "PATCH", { isActive: false }, admin)).status).toBe(500);
    expect((await request("me", "GET", undefined, member)).status).toBe(200);
    const inventory = await request<{ items: Array<{ id: string; online: boolean; revokedAt: string | null }> }>("device-bridges/organization", "GET", undefined, admin);
    expect(inventory.body.items).toContainEqual(expect.objectContaining({ id: paired.bridgeId, online: true, revokedAt: null }));
    socket.send(JSON.stringify({ type: "bridge.ping" })); expect(JSON.parse(String((await once(socket, "message"))[0]))).toMatchObject({ type: "bridge.pong" });
    await db.query("drop trigger reject_offboard_audit on audit_events");
    expect((await request("users/offboard-member/activation", "PATCH", { isActive: false }, admin)).status).toBe(200);
    expect((await request("me", "GET", undefined, member)).status).toBe(401);
  });
  it("revokes live access through account deletion while its organization machine credential keeps authenticating", async () => {
    const admin = await login("offboard-admin"), member = await login("offboard-member"), paired = await pair(member);
    const team = await request<{ item: { id: string } }>("organization/teams", "POST", { name: "Remaining team" }, admin); expect(team.status).toBe(201);
    expect((await request(`organization/teams/${team.body.item.id}/members`, "PUT", { userIds: ["offboard-member", "offboard-admin"] }, admin)).status).toBe(200);
    expect((await request("parameters/admin/projects", "POST", { id: "offboard-retained-project", name: "Remaining project", code: "RETAINED" }, admin)).status).toBe(201);
    await db.query(`insert into project_members(organization_id,project_id,user_id,roles) values
      ('offboard-home','offboard-retained-project','offboard-member',array['software-user']),
      ('offboard-home','offboard-retained-project','offboard-admin',array['software-user'])`);
    const machine = await request<{ item: { id: string }; token: string }>("log-integration-credentials", "POST", { name: "Remaining pipeline", skillId: null }, admin);
    await db.query("update log_integration_credentials set created_by='offboard-member' where id=$1", [machine.body.item.id]);
    const socket = connect(paired.bridgeToken); await once(socket, "message"); const disconnected = once(socket, "close");
    expect((await request("users/offboard-member", "DELETE", undefined, admin)).status).toBe(204);
    expect((await disconnected)[0]).toBe(4401);
    expect((await request("me", "GET", undefined, member)).status).toBe(401);
    const pipeline = await request("log-files", "POST", { fileName: "device.log", contentType: "text/plain", contentBase64: Buffer.from("INFO retained machine\n").toString("base64") }, machine.body.token);
    expect(pipeline.status).toBe(201);
    expect((await db.query("select status,created_by from log_integration_credentials where id=$1", [machine.body.item.id])).rows).toEqual([{ status: "active", created_by: null }]);
    expect((await db.query("select user_id from organization_team_members where team_id=$1", [team.body.item.id])).rows).toEqual([{ user_id: "offboard-admin" }]);
    expect((await db.query("select name from organization_teams where id=$1", [team.body.item.id])).rows).toEqual([{ name: "Remaining team" }]);
    expect((await db.query("select user_id from project_members where project_id='offboard-retained-project'")).rows).toEqual([{ user_id: "offboard-admin" }]);
    expect((await request("parameters/admin/projects/offboard-retained-project", "GET", undefined, admin)).status).toBe(200);
  });
  it("applies the same revocation to explicit platform emergency disabling and does not revive sessions on administrator recovery", async () => {
    await seedCoreGraph(db, { organization: { id: "offboard-platform-home" }, users: [{ id: "offboard-platform" }] });
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('offboard-platform-role','offboard-platform','offboard-platform-home','platform-admin')");
    await db.query("insert into user_password_credentials(user_id,username,password_hash) values('offboard-platform','offboard-platform',$1)", [await hashLocalAccountPassword(password)]);
    const platform = await login("offboard-platform"), admin = await login("offboard-admin"), paired = await pair(admin);
    const socket = connect(paired.bridgeToken); await once(socket, "message"); const disconnected = once(socket, "close");
    const base = "platform/organizations/offboard-home";
    expect((await request(`${base}/administrators/offboard-admin/emergency-disable`, "POST", { reason: "Immediate offboarding" }, platform)).status).toBe(200);
    expect((await disconnected)[0]).toBe(4401);
    expect((await request(`${base}/administrator-recovery`, "POST", { userId: "offboard-admin" }, platform)).status).toBe(200);
    expect((await request("me", "GET", undefined, admin)).status).toBe(401);
    expect((await request("me", "GET", undefined, await login("offboard-admin"))).status).toBe(200);
    const audit = await db.query("select actor_user_id,organization_id from audit_events where kind='organization-administrator-emergency-disable'");
    expect(audit.rows).toEqual([{ actor_user_id: "offboard-platform", organization_id: "offboard-home" }]);
  });
  it.each(["hmac", "oidc"] as const)("keeps old, missing-iat and same-second %s tokens revoked after reactivation and accepts a freshly issued token", async provider => {
    const admin = await login("offboard-admin"), issuer = "https://offboarding-identity.example", secret = "isolated-hmac-offboarding-secret";
    const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
    if (provider === "oidc") await db.query("update user_oidc_identities set issuer=$1,subject='external-offboard-member' where user_id='offboard-member'", [issuer]);
    const token = (iat?: number, organizationId = "offboard-home") => {
      const claims = { iss: issuer, aud: "offboarding", sub: provider === "oidc" ? "external-offboard-member" : "offboard-member", org: organizationId, organization_id: organizationId,
        exp: Math.floor(Date.now() / 1000) + 3600, ...(iat === undefined ? {} : { iat }) };
      const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
      if (provider === "hmac") return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
      const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "offboard-key" })).toString("base64url");
      return `${header}.${payload}.${sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), keys.privateKey).toString("base64url")}`;
    };
    const verifier = provider === "hmac" ? createTokenVerifier({ issuer, secret }) : createOidcVerifier({ issuer, audience: "offboarding", jwks: { keys: [{ ...keys.publicKey.export({ format: "jwk" }), kid: "offboard-key", alg: "RS256", use: "sig" }] } });
    const authenticated = createWiseEffServer({ db, auth: { mode: "production", verifier }, env: { AUTH_PROVIDER: provider, ...(provider === "oidc" ? { AUTH_OIDC_ISSUER: issuer } : {}) } });
    const me = (value: string) => requestJson<{ error: { message: string } }>(authenticated, "/api/v1/me", { headers: { Authorization: `Bearer ${value}` } });
    const old = token(Math.floor(Date.now() / 1000) - 10), legacy = token();
    expect((await me(old)).status).toBe(200); expect((await me(legacy)).status).toBe(200);
    expect((await request("users/offboard-member/activation", "PATCH", { isActive: false }, admin)).status).toBe(200);
    expect((await me(old)).status).toBe(403);
    expect((await request("users/offboard-member/activation", "PATCH", { isActive: true }, admin)).status).toBe(200);
    const cutoff = (await db.query<{ cutoff: string }>("select extract(epoch from external_tokens_revoked_at)::text as cutoff from users where id='offboard-member'")).rows[0].cutoff;
    const revokedSecond = Math.floor(Number(cutoff));
    expect((await me(old)).status).toBe(401); expect((await me(legacy)).body.error.message).toContain("newly issued token");
    expect((await me(token(revokedSecond))).status).toBe(401);
    await new Promise(resolve => setTimeout(resolve, Math.max(0, (revokedSecond + 1) * 1000 - Date.now()) + 1));
    expect((await me(token(Math.floor(Date.now() / 1000)))).status).toBe(200);
    expect((await me(token(Math.floor(Date.now() / 1000), "wrong-organization"))).status).toBe(401);
    expect((await me(token(Math.floor(Date.now() / 1000) + 600))).status).toBe(401);
  });
});
