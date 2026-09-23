import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { PoolClient } from "pg";
import { createWiseEffServer } from "../../app";
import { createPostgresDatabase, getRootPostgresPool, type RootDatabase } from "../../shared/database/client";
import { createManagedInstanceTestDatabase, type EphemeralTestDatabase } from "../../testing/testDatabase";
import { createLocalObjectStore } from "../logs/objectStore";
import { createLocalAuthService } from "../auth/localAuth";
import { createDebugDeviceGatewayRegistry } from "../debugging/gatewayRegistry";
import { seedCanonicalParameterFixture } from "./testing/canonicalReloadFixture";
import { createControlledReloadBridge } from "./testing/controlledReloadBridge";
import type { ReloadCandidateDto, ReloadRunDto } from "./types";
import type { PromoteReloadRunToDraftsResult } from "./promote";

// Real HTTP/auth, Catalog, source graph and canonical writers. Device adaptation
// is introduced explicitly by individual tests, never by replacing a writer.
describe("canonical-only DTS reload HTTP acceptance (#898)", () => {
  let database: EphemeralTestDatabase;
  let db: RootDatabase;
  let lease: PoolClient;
  let api: Server;
  let url: string;
  let storageRoot: string;
  let token: string;
  let reviewerToken: string;
  let guestToken: string;
  let foreignToken: string;
  let bridge: Awaited<ReturnType<typeof createControlledReloadBridge>>;
  let promotedRunId: string;
  let staleRunId: string;
  let originalTarget: Record<string, unknown>;
  let fixture: Awaited<ReturnType<typeof seedCanonicalParameterFixture>>;

  async function json<T>(method: string, path: string, body?: unknown, bearer = token) {
    const response = await fetch(`${url}${path}`, {
      method, headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, body: await response.json() as T };
  }

  async function currentValueId() {
    return (await db.query<{ current_value_id: string }>(
      "select current_value_id from parameter_catalog.project_parameter_bindings where id=$1", [fixture.bindingId]
    )).rows[0]!.current_value_id;
  }

  beforeAll(async () => {
    database = await createManagedInstanceTestDatabase("898rel");
    db = createPostgresDatabase(database.url);
    lease = await getRootPostgresPool(db)!.connect();
    storageRoot = await mkdtemp(join(tmpdir(), "wiseeff-898-reload-"));
    const objectStore = createLocalObjectStore(storageRoot);
    fixture = await seedCanonicalParameterFixture(db, objectStore);
    bridge = await createControlledReloadBridge(db, {
      organizationId: fixture.organizationId, userId: fixture.editorAuth.user.id,
      nodePath: "/sys/devices/issue898/iin_max"
    });
    api = createWiseEffServer({
      db, objectStore, auth: { mode: "production" }, localAuthService: createLocalAuthService(db),
      debugGatewayRegistry: createDebugDeviceGatewayRegistry({}),
      deviceBridge: { connectionPool: bridge.connectionPool, rpcClient: bridge.rpcClient, artifactRoot: storageRoot }
    });
    await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
    const response = await fetch(`${url}/api/v1/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: fixture.editorUsername, password: fixture.password })
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { token: string };
    token = body.token;
    expect(token).toBeTruthy();
    for (const [username, assign] of [
      [fixture.reviewerUsername, (value: string) => { reviewerToken = value; }],
      [fixture.guestUsername, (value: string) => { guestToken = value; }],
      [fixture.otherUsername, (value: string) => { foreignToken = value; }]
    ] as const) {
      const loggedIn = await json<{ token: string }>("POST", "/api/v1/auth/login", { username, password: fixture.password });
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
    lease?.release();
    await db?.close();
    await database?.drop();
    if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
  });

  it("returns an actual canonical Binding and exact source pin without semantic parameter rows", async () => {
    const response = await fetch(`${url}/api/v1/dts-reload/projects/${fixture.projectId}/candidates`, {
      headers: { authorization: `Bearer ${token}` }
    });
    const body = await response.json() as { items: Array<Record<string, unknown>> };
    expect(response.status, JSON.stringify(body)).toBe(200);
    const candidate = body.items.find((item) => item.bindingId === fixture.bindingId);
    expect(candidate).toMatchObject({
      bindingId: fixture.bindingId, projectId: fixture.projectId, propertyKey: "iin_max",
      baselineValue: "<5>", debuggable: true,
      protectedReferencePin: {
        kind: "canonical-pin", bindingId: fixture.bindingId,
        definitionRevisionId: fixture.definitionRevisionId,
        currentValueId: fixture.currentValueId, configRevisionId: fixture.configRevisionId
      }
    });
    expect(candidate?.writebackSourcePin).not.toMatchObject({ sourceRef: `reload-binding:${fixture.bindingId}` });
    const legacy = await db.query<{ bindings: string; drafts: string }>(
      `select (select count(*) from public.project_parameter_bindings where organization_id=$1)::text as bindings,
              (select count(*) from public.parameter_drafts where organization_id=$1)::text as drafts`,
      [fixture.organizationId]
    );
    expect(legacy.rows[0]).toEqual({ bindings: "0", drafts: "0" });
  });

  it("runs real preflight and controlled deploy, promotes idempotently, and changes formal value only after User review", async () => {
    // A different configuration sorts first but cannot supply this Binding's source.
    await db.query(`insert into dts_config_set(id,organization_id,project_id,name)
      values ('898-decoy-config',$1,$2,'000 unrelated source')`, [fixture.organizationId, fixture.projectId]);
    const candidates = await json<{ items: ReloadCandidateDto[] }>("GET", `/api/v1/dts-reload/projects/${fixture.projectId}/candidates`);
    expect(candidates.status).toBe(200);
    const candidate = candidates.body.items.find((item) => item.bindingId === fixture.bindingId)!;
    expect(candidate).toBeDefined();
    originalTarget = { ...candidate.protectedReferencePin, ...candidate.writebackSourcePin,
      bindingId: fixture.bindingId, debugValue: "<6>" };
    for (const mismatch of [{ sourcePinId: "stale-source-pin" }, { sourceRef: "different-source" }, { definitionRevisionId: "stale-definition-revision" }]) {
      const rejected = await json("POST", `/api/v1/dts-reload/projects/${fixture.projectId}/runs`, { targets: [{ ...originalTarget, ...mismatch }] });
      expect(rejected.status, JSON.stringify(rejected.body)).toBe(409);
    }
    const start = await json<{ item: ReloadRunDto }>("POST", `/api/v1/dts-reload/projects/${fixture.projectId}/runs`, {
      targets: [originalTarget]
    });
    expect(start.status, JSON.stringify(start.body)).toBe(201);
    expect(start.body.item.status, JSON.stringify(start.body.item.diagnostics)).toBe("validated");
    promotedRunId = start.body.item.id;
    const preReview = await json<{ item: ReloadRunDto }>("POST", `/api/v1/dts-reload/projects/${fixture.projectId}/runs`, { targets: [originalTarget] });
    expect(preReview.status).toBe(201);
    expect(preReview.body.item.status).toBe("validated");
    staleRunId = preReview.body.item.id;
    expect(start.body.item.targets[0]).toMatchObject({ bindingId: fixture.bindingId, baselineValue: "<5>", debugValue: "<6>" });
    expect(await currentValueId()).toBe(fixture.currentValueId);
    const deployed = await json<{ item: ReloadRunDto }>("POST", `/api/v1/dts-reload/runs/${promotedRunId}/deploy`, {
      deviceId: bridge.deviceId, bridgeId: bridge.bridgeId, targetRef: bridge.targetRef,
      protocol: "hdc", confirmationTokens: ["confirm-dts-reload"]
    });
    expect(deployed.status, JSON.stringify(deployed.body)).toBe(200);
    // No linked debug node yet: controlled transport success cannot claim behavioural verification.
    expect(deployed.body.item.status).toBe("unverifiable");
    expect(bridge.calls.map((call) => call.method)).toEqual(expect.arrayContaining(["debug.mountTarget", "debug.pushFile", "debug.writeNode"]));
    const promotionPath = `/api/v1/dts-reload/runs/${promotedRunId}/promote-to-drafts`;
    const selection = { bindingIds: [fixture.bindingId], unverifiableAcknowledged: true };
    const promoted = await json<{ item: PromoteReloadRunToDraftsResult }>("POST", promotionPath, selection);
    expect(promoted.status, JSON.stringify(promoted.body)).toBe(201);
    const draftId = promoted.body.item.drafts[0]!.draftId;
    expect(await currentValueId()).toBe(fixture.currentValueId);
    const repeated = await json<{ item: PromoteReloadRunToDraftsResult }>("POST", promotionPath, selection);
    expect(repeated.status, JSON.stringify(repeated.body)).toBe(201);
    expect(repeated.body.item.drafts).toEqual([{ bindingId: fixture.bindingId, draftId, outcome: "unchanged" }]);
    const drafts = await db.query<{ count: string }>("select count(*)::text as count from project_parameter_value_drafts where binding_id=$1", [fixture.bindingId]);
    expect(drafts.rows[0]!.count).toBe("1");
    const submitted = await json<{ item: { id: string; status: string } }>("POST", `/api/v2/projects/${fixture.projectId}/parameter-value-drafts/${draftId}/submit`, {});
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
    expect(submitted.body.item.status).toBe("pending");
    expect(await currentValueId()).toBe(fixture.currentValueId);
    const reviewed = await json<{ item: { status: string } }>("POST", `/api/v2/projects/${fixture.projectId}/parameter-value-change-requests/${submitted.body.item.id}/review`, {
      decision: "approve", note: "Issue 898 independent product review"
    }, reviewerToken);
    expect(reviewed.status, JSON.stringify(reviewed.body)).toBe(200);
    expect(await currentValueId()).not.toBe(fixture.currentValueId);
    const history = await json<{ item: ReloadRunDto }>("GET", `/api/v1/dts-reload/runs/${promotedRunId}`);
    expect(history.status).toBe(200);
    expect(history.body.item.targets[0]).toMatchObject({ bindingId: fixture.bindingId, baselineValue: "<5>", debugValue: "<6>" });
    const refreshed = await json<{ items: ReloadCandidateDto[] }>("GET", `/api/v1/dts-reload/projects/${fixture.projectId}/candidates`);
    expect(refreshed.body.items[0]).toMatchObject({ bindingId: fixture.bindingId, baselineValue: "<6>" });
    expect(refreshed.body.items[0]!.protectedReferencePin?.configRevisionId).not.toBe(fixture.configRevisionId);
  });

  it("rejects stale pins, unavailable IDs and unauthorized project/tenant access before device I/O", async () => {
    const count = bridge.calls.length;
    const staleDeploy = await json("POST", `/api/v1/dts-reload/runs/${staleRunId}/deploy`, {
      deviceId: bridge.deviceId, bridgeId: bridge.bridgeId, targetRef: bridge.targetRef,
      protocol: "hdc", confirmationTokens: ["confirm-dts-reload"]
    });
    expect(staleDeploy.status, JSON.stringify(staleDeploy.body)).toBe(409);
    for (const target of [originalTarget, { ...originalTarget, bindingId: "legacy-binding-898" }]) {
      const result = await json<Record<string, unknown>>("POST", `/api/v1/dts-reload/projects/${fixture.projectId}/runs`, { targets: [target] });
      expect([400, 404, 409], JSON.stringify(result.body)).toContain(result.status);
    }
    for (const bearer of [guestToken, foreignToken]) {
      const result = await json<Record<string, unknown>>("POST", `/api/v1/dts-reload/projects/${fixture.projectId}/runs`, { targets: [originalTarget] }, bearer);
      expect([403, 404], JSON.stringify(result.body)).toContain(result.status);
    }
    const wrongProject = await json<Record<string, unknown>>("GET", `/api/v1/dts-reload/projects/${fixture.otherProjectId}/candidates`);
    expect([403, 404], JSON.stringify(wrongProject.body)).toContain(wrongProject.status);
    // Permissions are aggregated across roles; a role in another project must
    // not turn this project's guest membership into canonical read access.
    await db.query(`insert into user_role_bindings(id,user_id,organization_id,project_id,role_id)
      values ('urb-898-reload-other-project',$1,$2,$3,'hardware-user')`,
      [fixture.guestAuth.user.id, fixture.organizationId, fixture.otherProjectId]);
    const mixed = await json<{ token: string }>("POST", "/api/v1/auth/login", { username: fixture.guestUsername, password: fixture.password });
    const denied = await json("GET", `/api/v1/dts-reload/projects/${fixture.projectId}/candidates`, undefined, mixed.body.token);
    expect(denied.status, JSON.stringify(denied.body)).toBe(403);
    await db.query("update user_role_bindings set role_id='hardware-user' where id='urb-898-guest'");
    await db.query("update user_role_bindings set role_id='hardware-committer' where id='urb-898-reload-other-project'");
    const mixedWriter = await json<{ token: string }>("POST", "/api/v1/auth/login", { username: fixture.guestUsername, password: fixture.password });
    expect((await json("GET", `/api/v1/dts-reload/projects/${fixture.projectId}/candidates`, undefined, mixedWriter.body.token)).status).toBe(200);
    for (const [path, body] of [
      [`projects/${fixture.projectId}/runs`, { targets: [originalTarget] }],
      [`projects/${fixture.projectId}/restore-baseline`, { deviceId: bridge.deviceId }],
      [`runs/${staleRunId}/deploy`, { deviceId: bridge.deviceId, bridgeId: bridge.bridgeId, targetRef: bridge.targetRef, protocol: "hdc", confirmationTokens: ["confirm-dts-reload"] }],
      [`runs/${promotedRunId}/promote-to-drafts`, { bindingIds: [fixture.bindingId], unverifiableAcknowledged: true }]
    ] as const) {
      const rejected = await json("POST", `/api/v1/dts-reload/${path}`, body, mixedWriter.body.token);
      expect(rejected.status, JSON.stringify(rejected.body)).toBe(403);
    }
    expect(bridge.calls).toHaveLength(count);
  });

  it("removes newly uploaded overlay objects when the real run transaction fails", async () => {
    const candidates = await json<{ items: ReloadCandidateDto[] }>("GET", `/api/v1/dts-reload/projects/${fixture.projectId}/candidates`);
    const candidate = candidates.body.items.find((item) => item.bindingId === fixture.bindingId)!;
    const filesBefore = (await readdir(storageRoot, { recursive: true })).sort();
    const runsBefore = (await db.query("select id from dts_reload_runs order by id")).rows;
    await db.query(`create function public.issue898_reject_run() returns trigger language plpgsql as $$
      begin raise exception 'issue898 controlled run failure'; end $$`);
    await db.query(`create trigger issue898_reject_run before insert on dts_reload_runs
      for each row execute function public.issue898_reject_run()`);
    try {
      const failed = await json("POST", `/api/v1/dts-reload/projects/${fixture.projectId}/runs`, {
        targets: [{ ...candidate.protectedReferencePin, ...candidate.writebackSourcePin, bindingId: fixture.bindingId, debugValue: "<7>" }]
      });
      expect(failed.status).toBe(500);
      expect((await db.query("select id from dts_reload_runs order by id")).rows).toEqual(runsBefore);
      expect((await readdir(storageRoot, { recursive: true })).sort()).toEqual(filesBefore);
    } finally {
      await db.query("drop trigger issue898_reject_run on dts_reload_runs");
      await db.query("drop function public.issue898_reject_run()");
    }
  });

  it("verifies an explicitly linked canonical node and restores the reviewed baseline with exact history pins", async () => {
    await db.query(`insert into user_role_bindings(id,user_id,organization_id,project_id,role_id)
      values ('urb-898-reload-node-admin',$1,$2,null,'admin')`, [fixture.reviewerAuth.user.id, fixture.organizationId]);
    const login = await json<{ token: string }>("POST", "/api/v1/auth/login", { username: fixture.reviewerUsername, password: fixture.password });
    expect(login.status).toBe(200);
    const node = await json("POST", "/api/v1/debugging/admin/nodes", {
      name: "Explicit canonical reload readback", module: "Issue 898",
      canonicalBinding: { projectId: fixture.projectId, bindingId: fixture.bindingId },
      bindings: [{ protocol: "hdc", nodePath: "/sys/devices/issue898/iin_max", accessMode: "RW", enabled: true }]
    }, login.body.token);
    expect(node.status, JSON.stringify(node.body)).toBe(201);
    const current = await currentValueId();
    const candidates = await json<{ items: ReloadCandidateDto[] }>("GET", `/api/v1/dts-reload/projects/${fixture.projectId}/candidates`);
    const candidate = candidates.body.items.find((item) => item.bindingId === fixture.bindingId)!;
    expect(candidate.baselineValue).toBe("<6>");
    const started = await json<{ item: ReloadRunDto }>("POST", `/api/v1/dts-reload/projects/${fixture.projectId}/runs`, {
      targets: [{ ...candidate.protectedReferencePin, ...candidate.writebackSourcePin, bindingId: fixture.bindingId, debugValue: "<7>" }]
    });
    expect(started.status, JSON.stringify(started.body)).toBe(201);
    expect(started.body.item.status).toBe("validated");
    bridge.setNextOverlayValue("7");
    const deployment = { deviceId: bridge.deviceId, bridgeId: bridge.bridgeId, targetRef: bridge.targetRef,
      protocol: "hdc", confirmationTokens: ["confirm-dts-reload"] };
    const deployed = await json<{ item: ReloadRunDto }>("POST", `/api/v1/dts-reload/runs/${started.body.item.id}/deploy`, deployment);
    expect(deployed.status, JSON.stringify(deployed.body)).toBe(200);
    expect(deployed.body.item.status, JSON.stringify(deployed.body.item.reloadSnapshot)).toBe("verified");
    expect(deployed.body.item.reloadSnapshot?.behaviouralVerification?.outcomes).toEqual([
      expect.objectContaining({ bindingId: fixture.bindingId, outcome: "verified" })
    ]);
    expect(await currentValueId()).toBe(current);
    const restore = await json<{ item: ReloadRunDto }>("POST", `/api/v1/dts-reload/projects/${fixture.projectId}/restore-baseline`, { deviceId: bridge.deviceId });
    expect(restore.status, JSON.stringify(restore.body)).toBe(201);
    expect(restore.body.item).toMatchObject({ status: "validated", purpose: "restore-baseline" });
    expect(restore.body.item.targets[0]).toMatchObject({ canonicalBindingId: fixture.bindingId, canonicalCurrentValueId: current, debugValue: "<6>" });
    bridge.setNextOverlayValue("6");
    const restored = await json<{ item: ReloadRunDto }>("POST", `/api/v1/dts-reload/runs/${restore.body.item.id}/deploy`, deployment);
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);
    expect(restored.body.item.status, JSON.stringify(restored.body.item.reloadSnapshot)).toBe("verified");
    expect(await currentValueId()).toBe(current);
    const residue = await json("GET", `/api/v1/dts-reload/residue?deviceId=${encodeURIComponent(bridge.deviceId)}`);
    expect(residue.status).toBe(200);
    expect(residue.body).toMatchObject({ item: null });
    const historical = await json<{ item: ReloadRunDto }>("GET", `/api/v1/dts-reload/runs/${started.body.item.id}`);
    expect(historical.body.item.targets[0]).toMatchObject({ canonicalBindingId: fixture.bindingId, canonicalCurrentValueId: current, baselineValue: "<6>", debugValue: "<7>" });
  });
});
