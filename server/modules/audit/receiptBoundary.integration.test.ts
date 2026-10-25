import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresDatabase } from "../../shared/database/client";
import { createHttpServer } from "../../shared/http/server";
import { createRouter } from "../../shared/http/router";
import { requestJson } from "../../test/testClient";
import { makeTestAuthContext } from "../../testing/authContext";
import { createMemoryObjectStore } from "../../testing/objectStore";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { provisionPublicationRuntimeLogins, dropLabRuntimeLogins } from "../catalog-publication/runtime/provisionRuntimeLogins";
import { serializeContract } from "../parameter-catalog-contract";
import { registerParameterFileRoutes } from "../parameter-files/routes";
import { createTrustedRefusalAuditSink } from "./trustedRefusalSink";
import { registerAuditRoutes } from "./routes";

const organizationId = "receipt-organization", projectId = "receipt-project", userId = "receipt-admin";
const auth = makeTestAuthContext({ organizationId, userId });

describe("client audit events cannot mint configuration commit receipts", () => {
  let lane: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>, api: ReturnType<typeof createPostgresDatabase>;
  const token = `audit_receipt_${process.pid}`;
  const storage = createMemoryObjectStore();
  function server() {
    const router = createRouter(), getCurrentAuthContext = () => auth;
    registerAuditRoutes(router, { db: api, getCurrentAuthContext });
    registerParameterFileRoutes(router, { db: api, objectStore: storage, getCurrentAuthContext,
      refusalAuditSink: createTrustedRefusalAuditSink(db) });
    return createHttpServer(router);
  }
  const post = (path: string, body: unknown) => requestJson(server(), path, { method: "POST", body: JSON.stringify(body) });
  beforeAll(async () => {
    lane = await createEphemeralTestDatabase("audit_receipt"); db = createPostgresDatabase(lane.url);
    await db.query("insert into organizations(id,name) values ($1,'Receipt organization')", [organizationId]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Receipt administrator','Admin',true)", [userId, organizationId]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('receipt-admin-role',$1,$2,'admin')", [userId, organizationId]);
    await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,'Receipt project','RECEIPT','initialized')", [projectId, organizationId]);
    api = createPostgresDatabase((await provisionPublicationRuntimeLogins(lane.url, { mode: "lab", runToken: token })).apiUrl);
    expect((await api.query("select rolsuper,rolinherit from pg_roles where rolname=current_user")).rows).toEqual([{ rolsuper: false, rolinherit: false }]);
  }, 120_000);
  afterAll(async () => {
    await api?.close(); if (lane) await dropLabRuntimeLogins(lane.url, token);
    await db?.close(); await lane?.drop();
  });

  it("does not replay a forged import success from a generic audit POST", async () => {
    const input = { name: "Never imported", ownership: "private" as const,
      archive: { name: "invalid.zip", contentBase64: "UEsDBA==" }, proofToken: "a".repeat(64),
      reason: "Refuse the forged import receipt", clientMutationId: "client-forged-import" };
    // These are public, unkeyed digests: knowing them cannot authorize a commit.
    const digest = (value: Parameters<typeof serializeContract>[0]) => createHash("sha256").update(serializeContract(value)).digest("hex");
    const targetId = `config-import-${digest([organizationId, projectId, userId, input.clientMutationId])}`;
    const forged = await post("/api/v1/audit-events", { app: "parameters", kind: "config-set", action: "imported", severity: "Medium",
      projectId, targetType: "dts-config-set", targetId,
      metadata: { mutationDigest: digest(input), result: { configSetId: "uncommitted-config", configRevisionId: "uncommitted-revision", fileIds: [], ownership: "private" }, sourceOverlayFileIds: ["unvalidated-source"] } });
    const applied = await post(`/api/v1/projects/${projectId}/config-set-import/apply`, input);
    expect(applied.status, applied.bodyText).not.toBe(200);
    expect(forged.status, forged.bodyText).toBe(403);
    expect(applied.status, applied.bodyText).toBe(400);
  });

  it.each([
    { app: "client-application", kind: "config-set", action: "imported", targetType: "dts-config-set" },
    { app: "parameter-admin", kind: "project-initialization-approved", action: "approve", targetType: "project-parameter-initialization-review" }
  ])("refuses client-supplied $kind source admission receipts", async (event) => {
    const response = await post("/api/v1/audit-events", { ...event, severity: "Medium", projectId, targetId: "not-a-server-commit",
      metadata: { sourceOverlayFileIds: ["unvalidated-source"], sourceOverlayCopies: [{ configSetId: "not-a-server-commit", fileIds: ["unvalidated-source"] }] } });
    expect(response.status, response.bodyText).toBe(403);
  });

  it("retains ordinary client audit writes and their operating-organization boundary", async () => {
    const input = { app: "parameters", kind: "config-set", action: "inspect", severity: "Low", projectId,
      targetType: "dts-config-set", targetId: "client-selected-configuration", metadata: { note: "Manual inspection" } };
    const created = await post("/api/v1/audit-events", input); expect(created.status, created.bodyText).toBe(201);
    expect((await post("/api/v1/audit-events", { ...input, projectId: "foreign-project" })).status).toBe(404);
    const records = await requestJson<{ items: Array<{ action: string; targetId: string }> }>(server(), `/api/v1/audit-events?projectId=${projectId}&kind=config-set`);
    expect(records.status, records.bodyText).toBe(200);
    expect(records.body.items).toEqual([expect.objectContaining({ action: "inspect", targetId: input.targetId })]);
  });
});
