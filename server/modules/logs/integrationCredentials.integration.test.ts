import { randomUUID } from "node:crypto";
import { format } from "node:util";
import type { Server } from "node:http";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildWiseEffRouter, createWiseEffServer } from "../../app";
import { createPostgresDatabase, createSavepointDatabase, getRootPostgresPool, type Database, type RootDatabase } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { createTracingBoundary } from "../../observability/tracing";
import { makeTestAuthContext } from "../../testing/authContext";
import { seedCoreGraph } from "../../testing/fixtures";
import { createMemoryObjectStore } from "../../testing/objectStore";
import { applyMigrations, migrationsDir, resolveTestDatabaseUrl } from "../../testing/tempDatabase";
import { createSerializedTestQueryable } from "../../testing/testDatabase";
import type { LogRecordDto } from "./types";
import { processLogAnalysisJobById } from "./worker";

type Credential = { id: string; name: string; skillId: string | null; status: "active" | "revoked" };
type Issued = { item: Credential; token: string };
type Skill = { id: string; skillKey: string };
type Upload = { log: LogRecordDto; fileObject: { id: string }; job: { id: string } };

describe.skipIf(!process.env.DATABASE_URL && !process.env.TEST_DATABASE_URL)("integration credential HTTP acceptance over PostgreSQL (#1248)", () => {
  let root: RootDatabase;
  let client: PoolClient;
  let db: Database;
  let server: Server;
  let baseUrl: string;
  const objectStore = createMemoryObjectStore();
  const suffix = randomUUID();
  const organizations = [`credential-a-${suffix}`, `credential-b-${suffix}`];
  const users = organizations.map((organizationId) => makeTestAuthContext({ organizationId, userId: `${organizationId}-admin` }));
  const plaintext: string[] = [];
  const logged: string[] = [];
  const traces: unknown[] = [];
  const sql: Array<{ text: string; values: unknown[] }> = [];
  const verifier = vi.fn(async (authorization: string | string[] | undefined) => {
    const auth = users.find((_, index) => authorization === `Bearer user-${index}`);
    if (!auth) throw new ApiError("UNAUTHENTICATED", "Unknown test user.");
    return { ...auth, user: { ...auth.user, emailVerified: true } };
  });
  const options = () => ({ db, objectStore, auth: { mode: "production" as const, verifier: { verify: verifier } },
    tracing: createTracingBoundary({ enabled: true, serviceName: "credential-acceptance", exporter: (span) => { traces.push(span); } }) });

  async function request<T = unknown>(method: string, path: string, body?: unknown, token = "user-0") {
    const response = await fetch(`${baseUrl}${path}`, { method,
      headers: { ...(body instanceof FormData ? {} : { "content-type": "application/json" }), authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }) });
    const text = await response.text();
    return { status: response.status, body: (text ? JSON.parse(text) : null) as T };
  }

  async function issue(name: string, skillId: string | null = null, token = "user-0") {
    const issued = await request<Issued>("POST", "/api/v1/log-integration-credentials", { name, skillId }, token);
    expect(issued.status).toBe(201);
    rememberSecret(issued.body.token);
    return issued.body;
  }

  function rememberSecret(token: string) {
    expect(token).toMatch(/^wie_[0-9a-f-]{36}_[A-Za-z0-9_-]{43,}$/);
    const secret = token.match(/^wie_[^_]+_(.+)$/)![1];
    expect(Buffer.from(secret, "base64url").byteLength).toBeGreaterThanOrEqual(32);
    plaintext.push(token, secret);
  }

  const uploadBody = (skill?: Skill) => ({ fileName: "device.log", contentType: "text/plain",
    contentBase64: Buffer.from("INFO boot\nERROR controller timeout\n").toString("base64"), ...(skill ? { skillKey: skill.skillKey } : {}) });
  const upload = (token: string, skill?: Skill) => request<Upload>("POST", "/api/v1/log-files", uploadBody(skill), token);
  const ownPath = (logId: string) => `/api/v1/logs/${logId}`;
  const linesPath = (logId: string) => `${ownPath(logId)}/lines?file=device.log&startLine=1&endLine=2`;

  beforeAll(async () => {
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args) => { logged.push(format(...args)); });
    }
    root = createPostgresDatabase(resolveTestDatabaseUrl());
    await applyMigrations(root, migrationsDir);
    client = await getRootPostgresPool(root)!.connect();
    await client.query("begin");
    db = createSavepointDatabase(createSerializedTestQueryable(async (text, values = []) => {
      sql.push({ text, values });
      const result = await client.query(text, values);
      return { rows: result.rows, rowCount: result.rowCount };
    }));
    for (const auth of users) {
      await seedCoreGraph(db, { organization: { id: auth.organization.id }, users: [{ id: auth.user.id }] });
      await db.query(`insert into user_role_bindings (id, user_id, organization_id, project_id, role_id)
        values ($1, $2, $3, null, 'admin')`, [randomUUID(), auth.user.id, auth.organization.id]);
    }
    server = createWiseEffServer(options());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Acceptance server did not bind.");
    baseUrl = `http://127.0.0.1:${address.port}`;
  }, 120_000);

  afterAll(async () => {
    if (server?.listening) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
    if (client) { await client.query("rollback"); client.release(); }
    await root?.close();
    vi.restoreAllMocks();
  });

  it("uploads through both endpoints, reads its own report/files, preserves provenance, isolates owners and rotates/revokes immediately", async () => {
    const primary = await issue("Build pipeline");
    const sibling = await issue("Other pipeline");
    const foreign = await issue("Foreign pipeline", null, "user-1");
    verifier.mockClear();
    const uploaded = await upload(primary.token);
    expect(uploaded.status).toBe(201);
    expect(verifier).not.toHaveBeenCalled();
    expect(await processLogAnalysisJobById({ db, objectStore, jobId: uploaded.body.job.id })).toMatchObject({ status: "processed" });
    const own = await request<{ item: LogRecordDto }>("GET", ownPath(uploaded.body.log.id), undefined, primary.token);
    expect(own.status).toBe(200);
    expect(own.body.item).toMatchObject({ id: uploaded.body.log.id, status: "complete", reportId: expect.any(String), conclusion: expect.any(String) });
    const lines = await request<{ item: { lines: Array<{ content: string }> } }>("GET", linesPath(uploaded.body.log.id), undefined, primary.token);
    expect(lines.status).toBe(200);
    expect(lines.body.item.lines.map((line) => line.content)).toEqual(["INFO boot", "ERROR controller timeout"]);
    const fromFile = await request<Upload>("POST", "/api/v1/logs", { fileObjectId: uploaded.body.fileObject.id, fileName: "device.log" }, primary.token);
    expect(fromFile.status).toBe(201);
    expect((await request("GET", ownPath(fromFile.body.log.id), undefined, primary.token)).status).toBe(200);
    const persisted = await db.query<{ submitted_by_user_id: string | null; created_by_credential_id: string }>(
      "select submitted_by_user_id, created_by_credential_id from log_records where id=$1", [uploaded.body.log.id]);
    expect(persisted.rows).toEqual([{ submitted_by_user_id: null, created_by_credential_id: primary.item.id }]);
    const humanView = await request<{ item: LogRecordDto }>("GET", ownPath(uploaded.body.log.id));
    expect(humanView.status).toBe(200);
    expect(JSON.stringify(humanView.body.item)).toContain(primary.item.name);
    const audits = await db.query<{ actor_type: string; actor_user_id: string | null; credential_id: string | null }>(
      "select actor_type, actor_user_id, metadata->>'credentialId' as credential_id from audit_events where target_id=$1", [uploaded.body.log.id]);
    expect(audits.rows).toContainEqual({ actor_type: "integration", actor_user_id: null, credential_id: primary.item.id });
    const human = await upload("user-0");
    const other = await upload(sibling.token);
    const orgB = await upload(foreign.token);
    expect([human.status, other.status, orgB.status]).toEqual([201, 201, 201]);
    for (const log of [human.body.log, other.body.log, orgB.body.log]) {
      for (const path of [ownPath(log.id), linesPath(log.id)]) {
        expect([403, 404]).toContain((await request("GET", path, undefined, primary.token)).status);
      }
    }
    for (const path of [ownPath(uploaded.body.log.id), linesPath(uploaded.body.log.id)]) {
      expect([403, 404]).toContain((await request("GET", path, undefined, foreign.token)).status);
    }
    const rotated = await request<Issued>("POST", `/api/v1/log-integration-credentials/${primary.item.id}/rotate`, {});
    expect(rotated.status).toBe(200);
    rememberSecret(rotated.body.token);
    expect(rotated.body.token).not.toBe(primary.token);
    expect((await request("GET", ownPath(uploaded.body.log.id), undefined, primary.token)).status).toBe(401);
    expect((await upload(primary.token)).status).toBe(401);
    expect((await request("GET", ownPath(uploaded.body.log.id), undefined, rotated.body.token)).status).toBe(200);
    expect((await upload(rotated.body.token)).status).toBe(201);
    expect((await request("POST", `/api/v1/log-integration-credentials/${primary.item.id}/revoke`, {})).status).toBe(200);
    expect((await request("GET", ownPath(uploaded.body.log.id), undefined, rotated.body.token)).status).toBe(401);
    expect((await upload(rotated.body.token)).status).toBe(401);
    const listed = await request<{ items: Credential[] }>("GET", "/api/v1/log-integration-credentials");
    expect(listed.body.items.find((item) => item.id === primary.item.id)?.status).toBe("revoked");
    expect(JSON.stringify(listed.body)).not.toContain("secret");
  }, 120_000);

  it("requires a bound skill selector on both uploads and revokes credentials when that skill is archived", async () => {
    const skills: Skill[] = [];
    for (const name of ["Bound skill", "Other skill"]) {
      const created = await request<{ item: Skill }>("POST", "/api/v1/log-skills", { name });
      expect(created.status).toBe(201);
      skills.push(created.body.item);
    }
    const bound = await issue("Bound pipeline", skills[0].id);
    const own = await upload(bound.token, skills[0]);
    expect(own.status).toBe(201);
    for (const selection of [{}, { skillKey: skills[1].skillKey }, { skillId: skills[1].id }, { logDomainId: skills[1].id },
      { skillId: skills[0].id, skillKey: skills[1].skillKey }]) {
      expect((await request("POST", "/api/v1/log-files", { ...uploadBody(), ...selection }, bound.token)).status).toBe(403);
      expect((await request("POST", "/api/v1/logs", { fileObjectId: own.body.fileObject.id, fileName: "device.log", ...selection }, bound.token)).status).toBe(403);
    }
    for (const selection of [{ skillKey: skills[0].skillKey }, { skillId: skills[0].id }, { logDomainId: skills[0].id }]) {
      expect((await request("POST", "/api/v1/logs", { fileObjectId: own.body.fileObject.id, fileName: "device.log", ...selection }, bound.token)).status).toBe(201);
    }
    expect((await request("POST", `/api/v1/log-domains/${skills[0].id}/archive`, {})).status).toBe(200);
    expect((await upload(bound.token, skills[0])).status).toBe(401);
  }, 120_000);

  it("rejects credentials before every non-allowlisted route handler or domain query, including public and future routes", async () => {
    const credential = await issue("Boundary probe");
    const routes = buildWiseEffRouter(options()).router.listRoutes();
    const forbidden = routes.filter(({ method, pattern }) => !(
      method === "POST" && ["/api/v1/log-files", "/api/v1/logs"].includes(pattern)
      || method === "GET" && ["/api/v1/logs/:logId", "/api/v1/logs/:logId/lines"].includes(pattern)
    ));
    expect(forbidden.length).toBeGreaterThan(20);
    for (const { method, pattern } of forbidden) {
      const path = pattern.replace(/:[^/]+/g, "boundary-probe");
      const before = sql.length;
      verifier.mockClear();
      const body = method === "GET" || method === "DELETE" ? undefined
        : pattern.endsWith("/source-snapshots") && method === "POST" ? new FormData() : {};
      if (body instanceof FormData) body.set("versionLabel", "boundary-probe");
      const response = await request(method, path, body, credential.token);
      expect([401, 403], `${method} ${pattern}`).toContain(response.status);
      expect(sql.slice(before), `${method} ${pattern} reached the database`).toEqual([]);
      expect(verifier, `${method} ${pattern} reached a user resolver`).not.toHaveBeenCalled();
    }
  }, 120_000);

  it("stores no issued or rotated plaintext in any credential column, audits, records, query parameters or server logs", async () => {
    const rows = await db.query<{ row: unknown }>(`select to_jsonb(c) as row from log_integration_credentials c where organization_id=any($1::text[])
      union all select to_jsonb(a) from audit_events a where organization_id=any($1::text[])
      union all select to_jsonb(r) from log_records r where organization_id=any($1::text[])`, [organizations]);
    expect(rows.rows.length).toBeGreaterThan(0);
    expect(plaintext.length).toBeGreaterThanOrEqual(4);
    const persisted = JSON.stringify(rows.rows);
    const emitted = JSON.stringify({ logged, traces, parameters: sql.map((query) => query.values) });
    for (const secret of plaintext) {
      expect(persisted.includes(secret), "Persisted plaintext secret").toBe(false);
      expect(emitted.includes(secret), "Logged plaintext secret").toBe(false);
    }
  });
});
