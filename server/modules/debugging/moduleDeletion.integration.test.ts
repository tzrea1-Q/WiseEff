import type { Server } from "node:http";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWiseEffServer } from "../../app";
import { createPostgresDatabase } from "../../shared/database/client";
import { createManagedInstanceTestDatabase } from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import { provisionPublicationRuntimeLogins, dropLabRuntimeLogins } from "../../testing/labRuntimeLogins";
import { createSimulatorDebugDeviceGateway } from "./simulator";
import type { DebugModuleDeletionInput } from "./schemas";

describe("#1319 debug module deletion through actual HTTP and API LOGIN", () => {
  let database: Awaited<ReturnType<typeof createManagedInstanceTestDatabase>>;
  let root: ReturnType<typeof createPostgresDatabase>, api: ReturnType<typeof createPostgresDatabase>, server: Server, origin: string;
  const token = `module1319${process.pid}`, org = "module-delete-org", administrator = "module-delete-admin";
  type Preview = { nodeCount: number; legacyNodeCount: number; previewDigest: string; canDelete: boolean;
    children: Array<{ id: string; name: string }>; ambiguousNodes: Array<{ id: string; name: string }> };
  async function request<T = unknown>(path: string, method = "GET", body?: unknown, actor = administrator) {
    const response = await fetch(`${origin}/api/v1/debugging/admin${path}`, { method,
      headers: { "Content-Type": "application/json", "X-WiseEff-User": actor },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: response.status === 204 ? null : await response.json() as T };
  }
  async function module(name: string, parentId?: string) {
    const result = await request<{ item: { id: string } }>("/modules", "POST", { name, parentId });
    expect(result.status, JSON.stringify(result.body)).toBe(201); return result.body!.item.id;
  }
  async function confirmation(moduleId: string, clientMutationId: string, targetModuleId: string | null = null): Promise<DebugModuleDeletionInput> {
    const preview = await request<{ item: Preview }>(`/modules/${moduleId}/deletion-preview${targetModuleId ? `?targetModuleId=${targetModuleId}` : ""}`);
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    return { targetModuleId, previewDigest: preview.body!.item.previewDigest, clientMutationId };
  }
  beforeAll(async () => {
    database = await createManagedInstanceTestDatabase("1319"); root = createPostgresDatabase(database.url);
    await seedCoreGraph(root, { organization: { id: org }, users: [{ id: administrator, name: "Module administrator" }] });
    await root.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('module-delete-admin',$1,$2,'admin')", [administrator, org]);
    const runtime = await provisionPublicationRuntimeLogins(database.url, { mode: "lab", runToken: token });
    api = createPostgresDatabase(runtime.apiUrl);
    server = createWiseEffServer({ db: api, debugGateway: createSimulatorDebugDeviceGateway({ targets: [] }) });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("No HTTP address");
    origin = `http://127.0.0.1:${address.port}`;
  }, 120_000);
  afterAll(async () => {
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    await api?.close();
    if (database) { await dropLabRuntimeLogins(database.url, token); await root?.close(); await database.drop(); }
  }, 120_000);

  it("moves explicit and legacy-name nodes to an existing target in one confirmed deletion and preserves bindings", async () => {
    const source = await request<{ item: { id: string } }>("/modules", "POST", { name: "Source leaf" });
    const target = await request<{ item: { id: string } }>("/modules", "POST", { name: "Target leaf" });
    expect(source.status).toBe(201); expect(target.status).toBe(201);
    const sourceId = source.body!.item.id, targetId = target.body!.item.id;
    const created = await request<{ item: { id: string } }>("/nodes", "POST", { name: "Explicit node", moduleId: sourceId,
      bindings: [{ protocol: "hdc", nodePath: "/sys/1319/value", accessMode: "RW" }] });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    await root.query("insert into debug_nodes(id,organization_id,name,module) values('module-delete-legacy',$1,'Legacy node',' Source leaf ')", [org]);
    const preview = await request<{ item: { nodeCount: number; legacyNodeCount: number; previewDigest: string; canDelete: boolean } }>(`/modules/${sourceId}/deletion-preview?targetModuleId=${targetId}`);
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body!.item).toMatchObject({ nodeCount: 2, legacyNodeCount: 1, canDelete: true });
    const confirmation = { targetModuleId: targetId, previewDigest: preview.body!.item.previewDigest, clientMutationId: "move-source-once" };
    expect((await request(`/modules/${sourceId}`, "DELETE", confirmation)).status).toBe(204);
    expect((await request(`/modules/${sourceId}`, "DELETE", confirmation)).status).toBe(204);
    const nodes = await request<{ items: Array<{ id: string; module: string; moduleId: string; bindings: unknown[] }> }>("/nodes?includeArchived=true");
    expect(nodes.body!.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: created.body!.item.id, module: "Target leaf", moduleId: targetId,
        bindings: [expect.objectContaining({ nodePath: "/sys/1319/value", accessMode: "RW" })] }),
      expect.objectContaining({ id: "module-delete-legacy", module: "Target leaf", moduleId: targetId })
    ]));
    expect((await request<{ items: Array<{ id: string }> }>("/modules")).body!.items.map(item => item.id)).not.toContain(sourceId);
    expect((await root.query("select id from audit_events where target_id=$1 and kind='debug-node-module-admin-delete'", [sourceId])).rowCount).toBe(1);
    expect((await request(`/modules/${sourceId}`, "DELETE", { ...confirmation, targetModuleId: null })).status).toBe(409);
  });

  it("moves disabled nodes to Unclassified, retains definitions, devices and history, and rolls back a late audit failure", async () => {
    const sourceId = await module("Unclassified rollback source");
    const node = await request<{ item: { id: string } }>("/nodes", "POST", { name: "History node", moduleId: sourceId,
      description: "Keep node definition", detailedDescription: "Keep details", enabled: false,
      bindings: [{ protocol: "adb", nodePath: "/sys/1319/history", accessMode: "RO" }] });
    expect(node.status, JSON.stringify(node.body)).toBe(201);
    const nodeId = node.body!.item.id;
    await root.query(`insert into debugging_devices(id,organization_id,name,transport,status,firmware)
      values('module-history-device',$1,'History device','simulator','online','test')`, [org]);
    await root.query(`insert into debugging_targets(id,organization_id,device_id,target_ref,label,status)
      values('module-history-target',$1,'module-history-device','simulator://1319','Target','detected')`, [org]);
    await root.query(`insert into debugging_sessions(id,organization_id,device_id,target_id,actor_user_id,status)
      values('module-history-session',$1,'module-history-device','module-history-target',$2,'active')`, [org, administrator]);
    await root.query(`insert into node_operations(id,organization_id,session_id,node_id,node_path,operation_type,status,actor_user_id)
      values('module-history-operation',$1,'module-history-session',$2,'/sys/1319/history','read','succeeded',$3)`, [org, nodeId, administrator]);
    await root.query(`insert into debugging_snapshots(id,organization_id,session_id,operation_id,status,risk,entries,created_by_user_id)
      values('module-history-snapshot',$1,'module-history-session','module-history-operation','valid','Medium','[]',$2)`, [org, administrator]);
    const retained = () => root.query(`select to_jsonb(node)-'module'-'debug_node_module_id'-'updated_at' as definition,
      (select to_jsonb(operation) from node_operations operation where id='module-history-operation') as operation,
      (select to_jsonb(snapshot) from debugging_snapshots snapshot where id='module-history-snapshot') as snapshot,
      (select to_jsonb(session) from debugging_sessions session where id='module-history-session') as session,
      (select to_jsonb(device) from debugging_devices device where id='module-history-device') as device
      from debug_nodes node where id=$1`, [nodeId]);
    const before = (await retained()).rows;
    const input = await confirmation(sourceId, "rollback-unclassified");
    await root.query(`create function public.fail_1319_delete_audit() returns trigger language plpgsql as $$ begin
      if new.kind='debug-node-module-admin-delete' and new.metadata->>'clientMutationId'='rollback-unclassified' then raise exception 'Synthetic late audit failure'; end if; return new; end $$`);
    await root.query("create trigger fail_1319_delete_audit before insert on public.audit_events for each row execute function public.fail_1319_delete_audit()");
    try {
      expect((await request(`/modules/${sourceId}`, "DELETE", input)).status).toBe(500);
      expect((await request<{ items: Array<{ id: string; moduleId: string }> }>("/nodes?includeArchived=true")).body!.items.find(item => item.id === nodeId)?.moduleId).toBe(sourceId);
      expect((await retained()).rows).toEqual(before);
    } finally {
      await root.query("drop trigger fail_1319_delete_audit on public.audit_events");
      await root.query("drop function public.fail_1319_delete_audit()");
    }
    expect((await request(`/modules/${sourceId}`, "DELETE", input)).status).toBe(204);
    const current = (await request<{ items: Array<{ id: string; module: string; moduleId?: string }> }>("/nodes?includeArchived=true")).body!.items.find(item => item.id === nodeId);
    expect(current).toMatchObject({ module: "", id: nodeId }); expect(current?.moduleId).toBeUndefined();
    expect((await retained()).rows).toEqual(before);
  });

  it("lists child blockers and ambiguous legacy nodes without stealing nodes from same-named modules", async () => {
    const parentId = await module("Blocked parent"), childId = await module("Same leaf", parentId);
    const otherParent = await module("Other parent"), otherLeaf = await module("Same leaf", otherParent);
    await root.query("insert into debug_nodes(id,organization_id,name,module) values('ambiguous-module-node',$1,'Ambiguous legacy','Same leaf')", [org]);
    const parent = await request<{ item: Preview }>(`/modules/${parentId}/deletion-preview`);
    expect(parent.body!.item).toMatchObject({ canDelete: false, children: [{ id: childId, name: "Same leaf" }] });
    const child = await request<{ item: Preview }>(`/modules/${childId}/deletion-preview`);
    expect(child.body!.item).toMatchObject({ canDelete: false, ambiguousNodes: [{ id: "ambiguous-module-node", name: "Ambiguous legacy" }] });
    const blocked = await confirmation(childId, "ambiguous-refusal");
    expect((await request(`/modules/${childId}`, "DELETE", blocked)).status).toBe(409);
    // The administrator resolves the actual node's ownership through its existing editor API.
    expect((await request("/nodes/ambiguous-module-node", "PATCH", { moduleId: otherLeaf })).status).toBe(200);
    const ready = await confirmation(childId, "resolved-legacy");
    expect((await request(`/modules/${childId}`, "DELETE", ready)).status).toBe(204);
    expect((await request<{ items: Array<{ id: string; moduleId?: string }> }>("/nodes")).body!.items.find(node => node.id === "ambiguous-module-node")?.moduleId).toBe(otherLeaf);
  });

  it.each(["membership", "target", "child", "import"] as const)("rejects stale %s facts rather than applying the old preview", async change => {
    const sourceId = await module(`Stale ${change}`), targetId = await module(`Target ${change}`);
    const node = await request<{ item: { id: string } }>("/nodes", "POST", { name: `Node ${change}`, moduleId: sourceId });
    const input = await confirmation(sourceId, `stale-${change}`, targetId);
    if (change === "membership") expect((await request(`/nodes/${node.body!.item.id}`, "PATCH", { moduleId: targetId })).status).toBe(200);
    if (change === "target") expect((await request(`/modules/${targetId}`, "PATCH", { name: "Renamed target" })).status).toBe(200);
    if (change === "child") await module("New child", sourceId);
    if (change === "import") {
      const document = { format: "wiseeff.debug-node-catalog.v2", source: {}, counts: { modules: 1, nodes: 1, bindings: 0 },
        modules: [{ name: `Stale ${change}`, parentNamePath: [] }],
        nodes: [{ name: "New imported node", moduleNamePath: [`Stale ${change}`] }] };
      const preview = await request<{ item: { previewDigest: string; canSubmit: boolean } }>("/catalog/import-preview", "POST", document);
      expect(preview.status, JSON.stringify(preview.body)).toBe(200); expect(preview.body!.item.canSubmit, JSON.stringify(preview.body)).toBe(true);
      expect((await request("/catalog/import", "POST", { document, previewDigest: preview.body!.item.previewDigest })).status).toBe(200);
    }
    const rejected = await request(`/modules/${sourceId}`, "DELETE", input);
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(409);
    expect(rejected.body).toMatchObject({ error: { details: { reason: "stale-preview" } } });
    expect((await request<{ items: Array<{ id: string }> }>("/modules")).body!.items.map(item => item.id)).toContain(sourceId);
    expect((await root.query("select id from audit_events where target_id=$1 and kind='debug-node-module-admin-delete'", [sourceId])).rowCount).toBe(0);
  });

  it("rejects unauthorized, cross-organization and self targets without exposing or moving foreign data", async () => {
    await seedCoreGraph(root, { organization: { id: "module-foreign-org" }, users: [{ id: "module-foreign-admin", name: "Foreign" }] });
    await root.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('module-foreign-admin','module-foreign-admin','module-foreign-org','admin')");
    await root.query("insert into users(id,organization_id,name,title) values('module-viewer',$1,'Viewer','User')", [org]);
    await root.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('module-viewer','module-viewer',$1,'software-user')", [org]);
    const sourceId = await module("Tenant source");
    const foreign = await request<{ item: { id: string } }>("/modules", "POST", { name: "Foreign private module" }, "module-foreign-admin");
    const foreignId = foreign.body!.item.id;
    expect((await request(`/modules/${sourceId}/deletion-preview?targetModuleId=${foreignId}`)).status).toBe(404);
    expect((await request(`/modules/${foreignId}/deletion-preview`)).status).toBe(404);
    expect((await request(`/modules/${sourceId}/deletion-preview?targetModuleId=${sourceId}`)).status).toBe(400);
    const input = await confirmation(sourceId, "tenant-confirm");
    expect((await request(`/modules/${sourceId}`, "DELETE", { ...input, targetModuleId: foreignId })).status).toBe(404);
    expect((await request(`/modules/${sourceId}/deletion-preview`, "GET", undefined, "module-viewer")).status).toBe(403);
    expect((await request(`/modules/${sourceId}`, "DELETE", input, "module-viewer")).status).toBe(403);
    expect((await request(`/modules/${sourceId}`, "DELETE", { ...input, previewDigest: "forged" })).status).toBe(400);
  });

  it("serializes a real node create behind deletion and revalidates the module after obtaining the common writer fence", async () => {
    const sourceId = await module("Concurrent delete source"), input = await confirmation(sourceId, "concurrent-delete");
    const barrier = new pg.Client({ connectionString: database.url }); await barrier.connect();
    const lock = "13190019";
    await barrier.query("begin"); await barrier.query("select pg_advisory_xact_lock($1::bigint)", [lock]);
    await root.query(`create function public.pause_1319_module_delete() returns trigger language plpgsql as $$ begin
      if old.name='Concurrent delete source' then perform pg_advisory_xact_lock(13190019::bigint); end if; return old; end $$`);
    await root.query("create trigger pause_1319_module_delete before delete on public.debug_node_modules for each row execute function public.pause_1319_module_delete()");
    let deleting: ReturnType<typeof request> | undefined, creating: ReturnType<typeof request> | undefined;
    const waitForBlocked = async (count: number) => {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const waiting = await root.query<{ n: string }>(`select count(*)::text as n from pg_stat_activity
          where datname=current_database() and state='active' and wait_event='advisory'`);
        if (Number(waiting.rows[0]?.n) >= count) return;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw new Error(`Expected ${count} actual blocked API transactions`);
    };
    try {
      deleting = request(`/modules/${sourceId}`, "DELETE", input);
      await waitForBlocked(1);
      creating = request("/nodes", "POST", { name: "Concurrent late node", moduleId: sourceId });
      await waitForBlocked(2);
      await barrier.query("commit");
      expect((await deleting).status).toBe(204);
      const rejected = await creating;
      expect(rejected.status, JSON.stringify(rejected.body)).toBe(404);
      expect((await request<{ items: Array<{ name: string }> }>("/nodes")).body!.items.map(node => node.name)).not.toContain("Concurrent late node");
    } finally {
      await barrier.query("rollback"); await barrier.end();
      await Promise.allSettled([deleting, creating]);
      await root.query("drop trigger pause_1319_module_delete on public.debug_node_modules");
      await root.query("drop function public.pause_1319_module_delete()");
    }
  });
});
