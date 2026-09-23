import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createWiseEffServer } from "../../app";
import { createPostgresDatabase, type RootDatabase } from "../../shared/database/client";
import { createManagedInstanceTestDatabase, type EphemeralTestDatabase } from "../../testing/testDatabase";
import { createLocalObjectStore } from "../logs/objectStore";
import { createLocalAuthService } from "../auth/localAuth";
import { parseDtsValue } from "../dts";
import { seedCanonicalParameterFixture } from "../dts-reload/testing/canonicalReloadFixture";
import { createControlledReloadBridge } from "../dts-reload/testing/controlledReloadBridge";
import { createDebugDeviceGatewayRegistry } from "./gatewayRegistry";
import { acquireDebugDeviceLease, releaseDebugDeviceLease } from "./repository";

// Real HTTP/auth, DB, node/snapshot/lease/audit owners; only device RPC responses
// are controlled. The fixture has no legacy semantic parameter/binding rows.
describe("canonical-only node debugging HTTP acceptance (#898)", () => {
  let database: EphemeralTestDatabase;
  let db: RootDatabase;
  let api: Server;
  let url: string;
  let storageRoot: string;
  let token: string;
  let adminToken: string;
  let foreignToken: string;
  let sameOrgOtherProjectToken: string;
  let bridge: Awaited<ReturnType<typeof createControlledReloadBridge>>;
  let fixture: Awaited<ReturnType<typeof seedCanonicalParameterFixture>>;
  let linkedNodeId: string;
  let sessionId: string;
  let pin: Record<string, unknown>;
  const nodePath = "/sys/devices/issue898/iin_max";

  async function json(method: string, path: string, body?: unknown, bearer = token) {
    const response = await fetch(`${url}${path}`, { method,
      headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }
  beforeAll(async () => {
    database = await createManagedInstanceTestDatabase("898node");
    db = createPostgresDatabase(database.url);
    storageRoot = await mkdtemp(join(tmpdir(), "wiseeff-898-node-"));
    const objectStore = createLocalObjectStore(storageRoot);
    fixture = await seedCanonicalParameterFixture(db, objectStore);
    // A separate real administrator configures catalog nodes. The editor keeps
    // only its existing project-scoped hardware-committer role.
    await db.query(`insert into user_role_bindings(id,user_id,organization_id,project_id,role_id)
      values ('urb-898-node-admin',$1,$2,null,'admin')`, [fixture.reviewerAuth.user.id, fixture.organizationId]);
    await db.query(`insert into user_role_bindings(id,user_id,organization_id,project_id,role_id)
      values ('urb-898-node-foreign-project',$1,$2,$3,'hardware-user')`,
      [fixture.guestAuth.user.id, fixture.organizationId, fixture.otherProjectId]);
    bridge = await createControlledReloadBridge(db, { organizationId: fixture.organizationId,
      userId: fixture.editorAuth.user.id, nodePath });
    api = createWiseEffServer({ db, objectStore, auth: { mode: "production" }, localAuthService: createLocalAuthService(db),
      debugGatewayRegistry: createDebugDeviceGatewayRegistry({ hdc: {
        detectTargets: async () => ({ ok: true, targets: [] }),
        readNode: async () => { throw new Error("This fixture must read through the controlled bridge RPC."); },
        writeNode: async () => { throw new Error("This fixture must write through the controlled bridge RPC."); }
      } }),
      deviceBridge: { connectionPool: bridge.connectionPool, rpcClient: bridge.rpcClient, artifactRoot: storageRoot } });
    await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
    for (const [username, assign] of [
      [fixture.editorUsername, (value: string) => { token = value; }],
      [fixture.reviewerUsername, (value: string) => { adminToken = value; }],
      [fixture.otherUsername, (value: string) => { foreignToken = value; }],
      [fixture.guestUsername, (value: string) => { sameOrgOtherProjectToken = value; }]
    ] as const) {
      const loggedIn = await json("POST", "/api/v1/auth/login", { username, password: fixture.password });
      expect(loggedIn.status).toBe(200);
      assign(loggedIn.body.token);
    }
  }, 120_000);
  afterAll(async () => {
    if (api?.listening) {
      api.closeAllConnections();
      await new Promise<void>((resolve, reject) => api.close((error) => error ? reject(error) : resolve()));
    }
    bridge?.close();
    await db?.close();
    await database?.drop();
    if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
  });

  it("creates and reads an exact canonical node association without inventing a legacy row", async () => {
    const created = await json("POST", "/api/v1/debugging/admin/nodes", {
      name: "Canonical iin_max", module: "Issue 898", valueFormat: "raw",
      canonicalBinding: { projectId: fixture.projectId, bindingId: fixture.bindingId,
        expectedEffectiveRevisionId: fixture.definitionRevisionId, expectedCurrentValueId: fixture.currentValueId },
      bindings: [{ protocol: "hdc", nodePath, accessMode: "RW", enabled: true }]
    }, adminToken);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    linkedNodeId = created.body.item.id;
    await expect(db.query("update debug_nodes set canonical_project_id=$1 where id=$2", [fixture.otherProjectId, linkedNodeId]))
      .rejects.toMatchObject({ code: "23503", constraint: "debug_nodes_canonical_binding_project_fk" });
    const listed = await json("GET", "/api/v1/debugging/nodes?protocol=hdc");
    expect(listed.status).toBe(200);
    const node = listed.body.items.find((item: { id: string }) => item.id === linkedNodeId);
    expect(node).toMatchObject({ bindingId: fixture.bindingId, currentValueId: fixture.currentValueId,
      effectiveRevisionId: fixture.definitionRevisionId, protectedReferenceKind: "canonical-pin" });
    const legacy = (await db.query<{ count: string }>("select count(*)::text as count from public.project_parameter_bindings where organization_id=$1", [fixture.organizationId])).rows[0];
    expect(legacy!.count).toBe("0");
    const detected = await json("POST", "/api/v1/debugging/targets/detect", {
      bridgeId: bridge.bridgeId, protocol: "hdc"
    });
    expect(detected.status, JSON.stringify(detected.body)).toBe(200);
    const session = await json("POST", "/api/v1/debugging/sessions", {
      bridgeId: bridge.bridgeId, deviceId: bridge.deviceId, targetId: detected.body.items[0].id, protocol: "hdc"
    });
    expect(session.status, JSON.stringify(session.body)).toBe(201);
    sessionId = session.body.item.id;
    const rival = await json("POST", "/api/v1/debugging/sessions", {
      bridgeId: bridge.bridgeId, deviceId: bridge.deviceId, targetId: detected.body.items[0].id, protocol: "hdc"
    });
    expect(rival.status).toBe(201);
    expect(await acquireDebugDeviceLease(db, { organizationId: fixture.organizationId, deviceId: bridge.deviceId,
      sessionId: rival.body.item.id, actorUserId: fixture.editorAuth.user.id, leaseTtlMs: 60_000 })).not.toBeNull();
    const callCount = bridge.calls.length;
    const leased = await json("POST", "/api/v1/debugging/nodes/write", { sessionId, nodeId: linkedNodeId, value: "9" });
    expect(leased.status, JSON.stringify(leased.body)).toBe(409);
    expect(bridge.calls).toHaveLength(callCount);
    await releaseDebugDeviceLease(db, { organizationId: fixture.organizationId, deviceId: bridge.deviceId, sessionId: rival.body.item.id });
    const read = await json("POST", "/api/v1/debugging/nodes/read", { sessionId, nodeId: linkedNodeId });
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    expect(read.body.operation).toMatchObject({ bindingId: fixture.bindingId, currentValueId: fixture.currentValueId,
      effectiveRevisionId: fixture.definitionRevisionId, protectedReferenceKind: "canonical-pin" });
  });

  it("persists operation-time pins in snapshots and rollback while formal value stays unchanged", async () => {
    const written = await json("POST", "/api/v1/debugging/nodes/write", { sessionId, nodeId: linkedNodeId, value: "6" });
    expect(written.status, JSON.stringify(written.body)).toBe(200);
    expect(written.body.operation).toMatchObject({ status: "succeeded", bindingId: fixture.bindingId,
      currentValueId: fixture.currentValueId, protectedReferenceKind: "canonical-pin" });
    expect(bridge.values.get(nodePath)).toBe("6");
    const operation = (await db.query<{ canonical_pin: Record<string, unknown>; project_parameter_binding_id: string | null }>(
      "select canonical_pin,project_parameter_binding_id from node_operations where id=$1", [written.body.operation.id])).rows[0]!;
    expect(operation.project_parameter_binding_id).toBeNull();
    pin = operation.canonical_pin;
    await expect(db.query("update node_operations set canonical_project_id=$1 where id=$2", [fixture.otherProjectId, written.body.operation.id]))
      .rejects.toMatchObject({ code: "23503", constraint: "node_operations_canonical_binding_project_fk" });
    expect(pin).toMatchObject({ bindingId: fixture.bindingId, projectId: fixture.projectId,
      effectiveRevisionId: fixture.definitionRevisionId, currentValueId: fixture.currentValueId });
    const { sourcePin: internalSourcePin, ...publicPin } = pin;
    expect(internalSourcePin).toBeDefined();
    expect(written.body.snapshot.entries[0].canonicalPin).toEqual(publicPin);
    expect(JSON.stringify(written.body)).not.toContain('"sourcePin":');
    // Advance the formal tip through the product workflow while the device
    // still holds the trial value. Rollback must retain the old snapshot pin.
    const draft = await json("POST", `/api/v2/projects/${fixture.projectId}/parameter-bindings/${fixture.bindingId}/drafts`, {
      baseRevisionId: fixture.configRevisionId, targetValue: parseDtsValue("iin_max", "<8>").value,
      action: "set", reason: "Product update independent of device rollback"
    });
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    const submitted = await json("POST", `/api/v2/projects/${fixture.projectId}/parameter-value-drafts/${draft.body.item.draftId}/submit`, {});
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
    const reviewed = await json("POST", `/api/v2/projects/${fixture.projectId}/parameter-value-change-requests/${submitted.body.item.id}/review`, {
      decision: "approve", note: "Independent product reviewer"
    }, adminToken);
    expect(reviewed.status, JSON.stringify(reviewed.body)).toBe(200);
    const reviewedValueId = (await db.query<{ current_value_id: string }>("select current_value_id from parameter_catalog.project_parameter_bindings where id=$1", [fixture.bindingId])).rows[0]!.current_value_id;
    expect(reviewedValueId).not.toBe(fixture.currentValueId);
    const rolledBack = await json("POST", `/api/v1/debugging/snapshots/${written.body.snapshot.id}/rollback`, { confirmationToken: "confirm-rollback" });
    expect(rolledBack.status, JSON.stringify(rolledBack.body)).toBe(200);
    expect(bridge.values.get(nodePath)).toBe("5");
    const rollback = (await db.query<{ canonical_pin: unknown }>("select canonical_pin from node_operations where id=$1", [rolledBack.body.operations[0].id])).rows[0]!;
    expect(rollback.canonical_pin).toEqual(pin);
    const current = (await db.query<{ current_value_id: string }>("select current_value_id from parameter_catalog.project_parameter_bindings where id=$1", [fixture.bindingId])).rows[0]!;
    expect(current.current_value_id).toBe(reviewedValueId);
    const calls = bridge.calls.length;
    const repeat = await json("POST", `/api/v1/debugging/snapshots/${written.body.snapshot.id}/rollback`, { confirmationToken: "confirm-rollback" });
    expect(repeat.status, JSON.stringify(repeat.body)).toBe(400);
    expect(repeat.body).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
    expect(bridge.calls).toHaveLength(calls);
  });

  it("keeps unassociated nodes writable and rejects invalid/foreign/stale associations before device I/O", async () => {
    const standalone = await json("POST", "/api/v1/debugging/admin/nodes", { name: "Standalone 898", module: "Issue 898",
      bindings: [{ protocol: "hdc", nodePath: "/sys/devices/issue898/standalone", accessMode: "RW", enabled: true }]
    }, adminToken);
    expect(standalone.status, JSON.stringify(standalone.body)).toBe(201);
    const result = await json("POST", "/api/v1/debugging/nodes/write", { sessionId, nodeId: standalone.body.item.id, value: "7" });
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.operation.protectedReferenceKind).not.toBe("canonical-pin");
    const calls = bridge.calls.length;
    for (const association of [
      { projectId: fixture.projectId, bindingId: "legacy-nonempty-id" },
      { projectId: fixture.otherProjectId, bindingId: fixture.bindingId },
      { projectId: fixture.projectId, bindingId: fixture.bindingId, expectedCurrentValueId: "stale-value" }
    ]) {
      const patched = await json("PATCH", `/api/v1/debugging/admin/nodes/${linkedNodeId}`, { canonicalBinding: association }, adminToken);
      expect([400, 403, 404, 409], JSON.stringify(patched.body)).toContain(patched.status);
    }
    const forbidden = await json("POST", "/api/v1/debugging/nodes/write", { sessionId, nodeId: linkedNodeId, value: "8" }, foreignToken);
    expect([403, 404], JSON.stringify(forbidden.body)).toContain(forbidden.status);
    expect(bridge.calls).toHaveLength(calls);
    const current = await json("GET", "/api/v1/debugging/nodes?protocol=hdc");
    expect(current.body.items.find((item: { id: string }) => item.id === linkedNodeId)).toMatchObject({ bindingId: fixture.bindingId, protectedReferenceKind: "canonical-pin" });
    const foreignNodes = await json("GET", "/api/v1/debugging/nodes?protocol=hdc", undefined, sameOrgOtherProjectToken);
    expect(foreignNodes.status).toBe(200);
    expect(foreignNodes.body.items.find((item: { id: string }) => item.id === linkedNodeId))
      .toMatchObject({ protectedReferenceKind: "typed-block", protectedReferenceReason: "project-scope" });
    expect(JSON.stringify(foreignNodes.body)).not.toContain(fixture.bindingId);
    expect(JSON.stringify(foreignNodes.body)).not.toContain(fixture.currentValueId);
    const foreignEvents = await json("GET", `/api/v1/debugging/sessions/${sessionId}/events`, undefined, sameOrgOtherProjectToken);
    expect(foreignEvents.status).toBe(200);
    expect(foreignEvents.body.items.map((item: { id: string }) => item.id)).toEqual([result.body.operation.id]);
    expect(JSON.stringify(foreignEvents.body)).not.toContain(fixture.bindingId);
  });
});
