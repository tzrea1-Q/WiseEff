import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyCheckpoint } from "@langchain/langgraph-checkpoint";
import { createEphemeralTestDatabase } from "../../../testing/testDatabase";
import { createPostgresDatabase, type RootDatabase } from "../../../shared/database/client";
import { seedCoreGraph } from "../../../testing/fixtures";
import { getAuthContext } from "../../auth/repository";
import { resolveOperatingContext } from "../../auth/operatingContext";
import { createUserInvocation } from "../../auth/trustedInvocation";
import { withAgentInvocation, type AgentAccessContext } from "../scope";
import { createAgentOrchestrator } from "../orchestrator";
import { createAgentToolRegistry } from "../toolRegistry";
import { previewOrganizationDeletion } from "../../users/organizationDeletion";
import { createXiaozeAgentFactory } from "./agUiEndpoint";
import { createPostgresCheckpointerSaver } from "./durableCheckpointer";
import { createXiaozeCheckpointer, type XiaozeCheckpointer } from "./checkpointer";
import { fakeModelSequence } from "./testing/fakeModel";
import { resolveXiaozeLlmConfig } from "../../../config/xiaozeLlmConfig";
import { provisionPublicationRuntimeLogins, dropLabRuntimeLogins } from "../../../testing/labRuntimeLogins";
import { randomBytes } from "node:crypto";
import { applyMigrations, migrationsDir, withTempDatabase } from "../../../testing/tempDatabase";

describe("exact Agent checkpoint ownership before session persistence", () => {
  let database: Awaited<ReturnType<typeof createEphemeralTestDatabase>>, db: RootDatabase;
  const handles: Array<ReturnType<typeof createPostgresCheckpointerSaver>> = [];
  const stores: Array<Awaited<ReturnType<typeof createEphemeralTestDatabase>>> = [];
  beforeEach(async () => {
    database = await createEphemeralTestDatabase("checkpointowner"); db = createPostgresDatabase(database.url);
    await seedCoreGraph(db, { organization: { id: "owner-home" }, users: [{ id: "owner-platform" }, { id: "owner-spare" }] });
    await seedCoreGraph(db, { organization: { id: "owner-target" }, users: [{ id: "owner-member" }] });
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('owner-platform-role','owner-platform','owner-home','platform-admin'),('owner-spare-role','owner-spare','owner-home','platform-admin')");
  });
  afterEach(async () => {
    await Promise.all(handles.splice(0).map(handle => handle.saver.end()));
    await db.close(); await database.drop();
    await Promise.all(stores.splice(0).map(store => store.drop()));
  });
  async function checkpointer(separate = false) {
    const store = separate ? await createEphemeralTestDatabase("checkpointstore") : database;
    if (separate) stores.push(store);
    const handle = createPostgresCheckpointerSaver({ connectionString: store.url }); handles.push(handle);
    await handle.ensureSetup();
    return createXiaozeCheckpointer({ mode: "postgres", saver: handle.saver, withNamespaceLease: handle.withNamespaceLease, ensureReady: handle.ensureSetup });
  }
  async function operatingAuth() {
    const principal = await getAuthContext(db, "owner-platform");
    return withAgentInvocation(principal, await resolveOperatingContext(db, createUserInvocation(principal), "owner-target"));
  }
  function run(cp: XiaozeCheckpointer, auth: AgentAccessContext, threadId: string, model = fakeModelSequence([{ content: "Completed" }]), connection = db) {
    const tools = createAgentToolRegistry({ db: connection });
    const factory = createXiaozeAgentFactory({ db: connection, checkpointer: cp, toolRegistry: tools,
      orchestrator: createAgentOrchestrator({ db: connection, toolRegistry: tools }), modelFactory: () => model,
      env: { DATABASE_URL: database.url, XIAOZE_CHECKPOINTER: "postgres", XIAOZE_REASONING_FALLBACK_HEURISTIC: false, XIAOZE_LLM_CONFIG: resolveXiaozeLlmConfig({}) } });
    return factory({ auth, requestId: `owner-${threadId}`, sessionId: threadId }).run({ message: "Hello", context: {}, threadId });
  }
  it.each([false, true])("records original cross-organization ownership before the first real saver write (separate store: %s)", async separate => {
    const cp = await checkpointer(separate), auth = await operatingAuth(), key = "owner-target:owner-platform:pre-session:thread";
    const put = cp.saver.put.bind(cp.saver); let checked = false;
    vi.spyOn(cp.saver, "put").mockImplementation(async (...args) => {
      if (!checked) {
        checked = true;
        expect((await db.query("select organization_id,actor_user_id,logical_thread_id,checkpoint_thread_id,store_kind from agent_checkpoint_namespaces")).rows)
          .toEqual([{ organization_id: "owner-target", actor_user_id: "owner-platform", logical_thread_id: "pre-session:thread", checkpoint_thread_id: key, store_kind: "postgres" }]);
        expect((await db.query("select id from agent_sessions")).rows).toEqual([]);
      }
      return put(...args);
    });
    expect((await run(cp, auth, "pre-session:thread")).text).toBe("Completed"); expect(checked).toBe(true);
    const caller = createUserInvocation(await getAuthContext(db, "owner-spare"));
    const preview = await previewOrganizationDeletion(db, caller, "owner-target", { agentCheckpointer: cp });
    expect(preview.inventory).toContainEqual({ key: "public.agent_checkpoint_namespaces", category: "agent", count: 1 });
    expect(preview.inventory.find(row => row.key === "public.checkpoints")?.count).toBeGreaterThan(0);
    expect(preview.blockers.map(row => row.code)).not.toContain("unclassified-ownership");
    await db.query("delete from users where id='owner-platform'");
    expect((await db.query("select actor_user_id from agent_checkpoint_namespaces")).rows).toEqual([{ actor_user_id: "owner-platform" }]);
    expect((await previewOrganizationDeletion(db, caller, "owner-target", { agentCheckpointer: cp })).inventory).toContainEqual({ key: "public.agent_checkpoint_namespaces", category: "agent", count: 1 });
  });
  it("rejects colliding colon tuples before the second model or checkpoint writer executes", async () => {
    await seedCoreGraph(db, { organization: { id: "a" }, users: [{ id: "b:c" }] });
    await seedCoreGraph(db, { organization: { id: "a:b" }, users: [{ id: "c" }] });
    const cp = await checkpointer();
    await run(cp, await getAuthContext(db, "b:c"), "d");
    const before = await cp.inspectStore(), model = fakeModelSequence([{ content: "Must not run" }]), stream = vi.spyOn(model, "stream");
    await expect(run(cp, await getAuthContext(db, "c"), "d", model)).rejects.toMatchObject({ code: "CONFLICT", details: { reason: "checkpoint-ownership-conflict" } });
    expect(stream).not.toHaveBeenCalled(); expect(await cp.inspectStore()).toEqual(before);
  });
  it("admits a full writer pool of concurrent namespaces without borrowing a second connection per run", async () => {
    const cp = await checkpointer(), auth = await operatingAuth(), inspect = cp.inspectStore.bind(cp);
    let arrived = 0, release!: () => void;
    const ready = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(cp, "inspectStore").mockImplementation(async threadId => {
      if (++arrived === 10) release();
      await ready;
      return inspect(threadId);
    });
    const results = await Promise.all(Array.from({ length: 10 }, (_, index) => run(cp, auth, `parallel-${index}`)));
    expect(results.map(result => result.text)).toEqual(Array(10).fill("Completed"));
    expect((await db.query("select count(*)::int n from agent_checkpoint_namespaces where organization_id='owner-target'")).rows).toEqual([{ n: 10 }]);
  });
  it("does not claim an orphan stored namespace and keeps it unclassified in readonly previews", async () => {
    const cp = await checkpointer(), key = "owner-target:owner-platform:orphan";
    await cp.withNamespaceLease(key, () => cp.saver.put({ configurable: { thread_id: key, checkpoint_ns: "" } }, emptyCheckpoint(), { source: "input", step: 0, parents: {} }, {}));
    const before = await cp.inspectStore();
    await expect(run(cp, await operatingAuth(), "orphan")).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await db.query("select * from agent_checkpoint_namespaces")).rows).toEqual([]);
    const preview = await previewOrganizationDeletion(db, createUserInvocation(await getAuthContext(db, "owner-platform")), "owner-target", { agentCheckpointer: cp });
    expect(preview.blockers.map(row => row.code)).toContain("unclassified-ownership"); expect(preview.admissionAvailable).toBe(false);
    expect(await cp.inspectStore()).toEqual(before);
  });
  it("adopts a verified historical namespace and preserves its frozen actor after account deletion", async () => {
    const cp = await checkpointer(), key = "owner-target:owner-platform:historical";
    await db.query("insert into agent_sessions(id,organization_id,actor_user_id,page_key,context,status,title) values('historical','owner-target','owner-platform','organization','{}','active','Historical')");
    await cp.withNamespaceLease(key, () => cp.saver.put({ configurable: { thread_id: key, checkpoint_ns: "" } }, emptyCheckpoint(), { source: "input", step: 0, parents: {} }, {}));
    const caller = createUserInvocation(await getAuthContext(db, "owner-spare"));
    expect((await previewOrganizationDeletion(db, caller, "owner-target", { agentCheckpointer: cp })).inventory)
      .toContainEqual({ key: "public.checkpoints", category: "agent", count: 1 });
    expect((await run(cp, await operatingAuth(), "historical")).text).toBe("Completed");
    expect((await db.query("select actor_user_id from agent_checkpoint_namespaces")).rows).toEqual([{ actor_user_id: "owner-platform" }]);
    // Legacy proof also survives removal without relying on the newly registered row.
    await db.query("delete from agent_checkpoint_namespaces");
    await db.query("update agent_sessions set actor_user_id='owner-spare' where id='historical'");
    expect((await previewOrganizationDeletion(db, caller, "owner-target", { agentCheckpointer: cp })).blockers.map(row => row.code))
      .not.toContain("unclassified-ownership");
    await db.query("delete from users where id='owner-platform'");
    const preview = await previewOrganizationDeletion(db, caller, "owner-target", { agentCheckpointer: cp });
    expect(preview.inventory.find(row => row.key === "public.checkpoints")?.count).toBeGreaterThan(0);
    expect(preview.blockers.map(row => row.code)).not.toContain("unclassified-ownership");
  });
  it("keeps ambiguous persisted legacy tuples unclassified and rejects adoption", async () => {
    await seedCoreGraph(db, { organization: { id: "a" }, users: [{ id: "b" }] });
    await seedCoreGraph(db, { organization: { id: "a:b" }, users: [{ id: "c" }] });
    await db.query("insert into agent_sessions(id,organization_id,actor_user_id,page_key,context,status,title) values('c:d','a','b','organization','{}','active','One'),('d','a:b','c','organization','{}','active','Two')");
    const cp = await checkpointer(), key = "a:b:c:d";
    await cp.withNamespaceLease(key, () => cp.saver.put({ configurable: { thread_id: key, checkpoint_ns: "" } }, emptyCheckpoint(), { source: "input", step: 0, parents: {} }, {}));
    const before = await cp.inspectStore();
    await expect(run(cp, await getAuthContext(db, "b"), "c:d")).rejects.toMatchObject({ code: "CONFLICT" });
    const preview = await previewOrganizationDeletion(db, createUserInvocation(await getAuthContext(db, "owner-spare")), "a", { agentCheckpointer: cp });
    expect(preview.blockers.map(row => row.code)).toContain("unclassified-ownership");
    expect((await db.query("select * from agent_checkpoint_namespaces")).rows).toEqual([]);
    expect(await cp.inspectStore()).toEqual(before);
  });
  it("registers through the real API LOGIN while denying direct registry mutations and worker execution", async () => {
    const cp = await checkpointer(), token = `cpowner${randomBytes(5).toString("hex")}`;
    const runtime = await provisionPublicationRuntimeLogins(database.url, { mode: "lab", runToken: token });
    const api = createPostgresDatabase(runtime.apiUrl), worker = createPostgresDatabase(runtime.workerUrl);
    try {
      expect((await run(cp, await operatingAuth(), "api-login", undefined, api)).text).toBe("Completed");
      const preview = await previewOrganizationDeletion(api, createUserInvocation(await getAuthContext(api, "owner-spare")), "owner-target", { agentCheckpointer: cp });
      expect(preview.inventory).toContainEqual({ key: "public.agent_checkpoint_namespaces", category: "agent", count: 1 });
      await expect(api.query("delete from agent_checkpoint_namespaces where false")).rejects.toMatchObject({ code: "42501" });
      await expect(api.query("update agent_checkpoint_namespaces set actor_user_id=actor_user_id where false")).rejects.toMatchObject({ code: "42501" });
      await expect(worker.query("select parameter_catalog.register_agent_checkpoint_namespace('owner-target','owner-platform','worker','store','postgres','owner-target:owner-platform:worker',false)"))
        .rejects.toMatchObject({ code: "42501" });
    } finally { await api.close(); await worker.close(); await dropLabRuntimeLogins(database.url, token); }
  });
  it("denies a new or resumed graph while suspended before writing any namespace or checkpoint", async () => {
    const cp = await checkpointer(), auth = await operatingAuth();
    await db.query("update organizations set status='suspended' where id='owner-target'");
    await expect(run(cp, auth, "paused")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await cp.inspectStore()).entries).toEqual([]);
    expect((await db.query("select * from agent_checkpoint_namespaces")).rows).toEqual([]);
  });
  it("reports unavailable or missing configured runtime access as unclassified", async () => {
    const cp = await checkpointer(), caller = createUserInvocation(await getAuthContext(db, "owner-platform"));
    vi.spyOn(cp, "inspectStore").mockRejectedValue(new Error("separate saver inaccessible"));
    for (const context of [{}, { agentCheckpointer: cp }]) {
      const preview = await previewOrganizationDeletion(db, caller, "owner-target", context);
      expect(preview.blockers.map(row => row.code)).toContain("unclassified-ownership"); expect(preview.admissionAvailable).toBe(false);
    }
  });
  it("upgrades populated legacy sessions, official checkpoints and prefixed global pending refs without rewriting them", async () => {
    await withTempDatabase({ prefix: "checkpointupgrade", migrate: false }, async ({ db: legacy, connectionString }) => {
      await applyMigrations(legacy, migrationsDir, { before: "0279_agent_checkpoint_ownership_and_typed_preview.sql" });
      await seedCoreGraph(legacy, { organization: { id: "upgrade-home" }, users: [{ id: "upgrade-platform" }] });
      await seedCoreGraph(legacy, { organization: { id: "upgrade-target" }, users: [{ id: "upgrade-member" }] });
      await legacy.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('upgrade-role','upgrade-platform','upgrade-home','platform-admin')");
      await legacy.query("insert into agent_sessions(id,organization_id,actor_user_id,page_key,context,status,title) values('upgrade-thread','upgrade-target','upgrade-platform','organization','{}','active','Owned'),('foreign-thread','upgrade-home','upgrade-platform','organization','{}','active','Foreign')");
      await legacy.query("insert into log_file_objects(id,organization_id,storage_key,file_name,content_type,file_size_bytes,checksum_sha256) values('upgrade-file','upgrade-target','upgrade-key','owned.log','text/plain',1,'a')");
      await legacy.query("insert into parameter_catalog.definition_erasures(definition_id,organization_id,erased_by,audit_event_id,pending_object_refs) values('upgrade-global','upgrade-home','upgrade-platform','upgrade-audit',array['plane::upgrade-key'])");
      const token = `cpup${randomBytes(5).toString("hex")}`;
      const runtime = await provisionPublicationRuntimeLogins(connectionString, { mode: "lab", runToken: token });
      const api = createPostgresDatabase(runtime.apiUrl), worker = createPostgresDatabase(runtime.workerUrl);
      const handle = createPostgresCheckpointerSaver({ connectionString });
      const cp = createXiaozeCheckpointer({ mode: "postgres", saver: handle.saver, withNamespaceLease: handle.withNamespaceLease, ensureReady: handle.ensureSetup });
      try {
        await handle.ensureSetup();
        for (const key of ["upgrade-target:upgrade-platform:upgrade-thread", "upgrade-home:upgrade-platform:foreign-thread"]) {
          await cp.withNamespaceLease(key, () => cp.saver.put({ configurable: { thread_id: key, checkpoint_ns: "" } }, emptyCheckpoint(), { source: "input", step: 0, parents: {} }, {}));
        }
        const before = await cp.inspectStore();
        expect(await applyMigrations(legacy, migrationsDir, { through: "0279_agent_checkpoint_ownership_and_typed_preview.sql" })).toEqual(["0279_agent_checkpoint_ownership_and_typed_preview.sql"]);
        const routine = (await legacy.query<{ id: number }>("select to_regprocedure('parameter_catalog.register_agent_checkpoint_namespace(text,text,text,text,text,text,boolean)')::oid id")).rows[0].id;
        expect((await api.query("select has_function_privilege(current_user,$1::oid,'EXECUTE') allowed", [routine])).rows).toEqual([{ allowed: true }]);
        expect((await worker.query("select has_function_privilege(current_user,$1::oid,'EXECUTE') allowed", [routine])).rows).toEqual([{ allowed: false }]);
        expect((await applyMigrations(legacy, migrationsDir, { through: "0284_organization_preview_runtime_grants.sql" })).at(-1)).toBe("0284_organization_preview_runtime_grants.sql");
        const previewRoutine = (await legacy.query<{ id: number }>("select to_regprocedure('parameter_catalog.preview_organization_deletion(text,text)')::oid id")).rows[0].id;
        expect((await api.query("select has_function_privilege(current_user,$1::oid,'EXECUTE') allowed,has_function_privilege('catalog_baseline_reader_role',$1::oid,'EXECUTE') reader_allowed", [previewRoutine])).rows)
          .toEqual([{ allowed: true, reader_allowed: true }]);
        expect((await worker.query("select has_function_privilege(current_user,$1::oid,'EXECUTE') allowed", [previewRoutine])).rows).toEqual([{ allowed: false }]);
        expect((await legacy.query("select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a where p.oid=$1::oid and a.grantee=0 and a.privilege_type='EXECUTE'", [previewRoutine])).rows).toEqual([]);
        await expect(api.query("select * from parameter_catalog.preview_organization_deletion_0276('upgrade-target','upgrade-platform')")).rejects.toMatchObject({ code: "42501" });
        await expect(api.query("select * from parameter_catalog.organization_deletion_object_references()")).rejects.toMatchObject({ code: "42501" });
        await expect(api.query("delete from public.agent_checkpoint_namespaces where false")).rejects.toMatchObject({ code: "42501" });
        const preview = await previewOrganizationDeletion(api, createUserInvocation(await getAuthContext(api, "upgrade-platform")), "upgrade-target", { agentCheckpointer: cp });
        expect(preview.inventory).toContainEqual({ key: "public.checkpoints", category: "agent", count: 1 });
        expect(preview.blockers.map(row => row.code)).not.toContain("unclassified-ownership");
        expect(preview.storage).toEqual({ exclusiveObjects: 0, sharedObjects: 1 });
        expect(await cp.inspectStore()).toEqual(before);
        expect((await legacy.query("select pending_object_refs from parameter_catalog.definition_erasures where definition_id='upgrade-global'")).rows)
          .toEqual([{ pending_object_refs: ["plane::upgrade-key"] }]);
        expect(await applyMigrations(legacy, migrationsDir, { through: "0284_organization_preview_runtime_grants.sql" })).toEqual([]);
      } finally { await handle.saver.end(); await api.close(); await worker.close(); await dropLabRuntimeLogins(connectionString, token); }
    });
  });
});
