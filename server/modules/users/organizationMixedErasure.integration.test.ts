import { createHmac, randomUUID } from "node:crypto";
import { cp, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWiseEffServer } from "../../app";
import { requestJson } from "../../test/testClient";
import { createEphemeralTestDatabase, withTestClusterRoleCatalogLock } from "../../testing/testDatabase";
import { createPostgresDatabase, type RootDatabase } from "../../shared/database/client";
import { seedCoreGraph } from "../../testing/fixtures";
import { seedBaselineAuthCatalog } from "../auth/baselineCatalog";
import { createLocalObjectStore, type ObjectStore } from "../logs/objectStore";
import { createXiaozeCheckpointer } from "../agent/xiaoze/checkpointer";
import { createTokenVerifier } from "../auth/tokenVerifier";
import { getAuthContext } from "../auth/repository";
import { createUserInvocation } from "../auth/trustedInvocation";
import { captureOrganizationErasureState, replayOrganizationErasureState } from "./organizationErasureRecovery";
import { createPostgresCheckpointerSaver } from "../agent/xiaoze/durableCheckpointer";
import { registerAgentCheckpointNamespace } from "../agent/xiaoze/checkpointOwnership";
import { createBridgeConnectionPool } from "../deviceBridge/connectionPool";
import { installConfigurationSourceFixture } from "../../testing/parameterCatalog/configurationSource";
import { uploadProjectParameterFile } from "../parameter-files/service";
import { provisionPublicationRuntimeLogins, dropLabRuntimeLogins } from "../../testing/labRuntimeLogins";

async function postgresTool(tool: string, url: string, args: string[], input?: Buffer) {
  const target = new URL(url), container = process.env.WISEEFF_RESTORE_TEST_CONTAINER;
  const command = container ? "docker" : tool;
  const commandArgs = container ? ["exec", "-i", container, tool, "-U", decodeURIComponent(target.username), "-d", target.pathname.slice(1), ...args] : args;
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(command, commandArgs, { env: { ...process.env, PGHOST: target.hostname, PGPORT: target.port, PGDATABASE: target.pathname.slice(1), PGUSER: decodeURIComponent(target.username), PGPASSWORD: decodeURIComponent(target.password) }, stdio: "pipe" });
    const chunks: Buffer[] = []; let error = "";
    child.stdout.on("data", bytes => chunks.push(bytes)); child.stderr.on("data", bytes => { error += bytes.toString(); });
    child.on("error", reject); child.on("close", code => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`${tool} failed: ${error.slice(0, 500)}`)));
    child.stdin.on("error", () => undefined); child.stdin.end(input);
  });
}

describe("Mixed Organization erasure and minimal receipts through real HMAC HTTP", () => {
  let database: Awaited<ReturnType<typeof createEphemeralTestDatabase>>, db: RootDatabase;
  let directory: string, store: ObjectStore;
  let apiDb: RootDatabase | undefined, roleToken: string | undefined;
  let bridgeConnectionPool = createBridgeConnectionPool();
  let agentCheckpointer = createXiaozeCheckpointer();
  const savers: Array<{ end(): Promise<void> }> = [];
  const extraDatabases: Array<Awaited<ReturnType<typeof createEphemeralTestDatabase>>> = [];
  beforeEach(async () => {
    database = await createEphemeralTestDatabase("org1399"); db = createPostgresDatabase(database.url);
    agentCheckpointer = createXiaozeCheckpointer();
    bridgeConnectionPool = createBridgeConnectionPool();
    directory = await mkdtemp(path.join(tmpdir(), "org1399-objects-")); store = createLocalObjectStore(directory);
    await withTestClusterRoleCatalogLock(async () => {
      await seedCoreGraph(db, { organization: { id: "mixed-home" }, users: [{ id: "mixed-platform" }] });
      await seedCoreGraph(db, { organization: { id: "mixed-target" }, users: [{ id: "mixed-member" }] });
      await seedBaselineAuthCatalog(db);
    });
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('mixed-platform-role','mixed-platform','mixed-home','platform-admin'),('mixed-member-role','mixed-member','mixed-target','admin')");
  });
  afterEach(async () => { await apiDb?.close(); apiDb = undefined; if (roleToken) await dropLabRuntimeLogins(database.url, roleToken); roleToken = undefined; await Promise.all(savers.splice(0).map(saver => saver.end())); await db?.close(); await database?.drop(); for (const extra of extraDatabases.splice(0)) await extra.drop(); if (directory) await rm(directory, { recursive: true, force: true }); });
  function request<T>(url: string, method = "GET", body?: unknown, user = "mixed-platform") {
    const issuer = "org1399-hmac", secret = "org1399-isolated-test-hmac-secret";
    const claims = Buffer.from(JSON.stringify({ iss: issuer, sub: user, org: user === "mixed-member" ? "mixed-target" : "mixed-home", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
    const token = `${claims}.${createHmac("sha256", secret).update(claims).digest("base64url")}`;
    return requestJson<T>(createWiseEffServer({ db: apiDb ?? db, objectStore: store, agentCheckpointer, deviceBridge: { connectionPool: bridgeConnectionPool }, auth: { mode: "production", verifier: createTokenVerifier({ issuer, secret }) } }), url,
      { method, headers: { Authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  async function start() {
    const target = "/api/v1/platform/organizations/mixed-target";
    const preview = await request<{ item: { stateDigest: string } }>(`${target}/deletion-preview`);
    expect(preview.status, preview.bodyText).toBe(200);
    return request<{ item: { id: string; status: string; domains: Record<string, unknown>; attempts: number } }>(`${target}/deletions`, "POST",
      { stateDigest: preview.body.item.stateDigest, confirmationOrganizationId: "mixed-target" });
  }
  it("converges retained global audit proofs to content-free facts and a minimal final receipt", async () => {
    await db.query(`insert into audit_events(id,organization_id,actor_user_id,actor_type,app,kind,action,severity,target_type,target_id,trace_id,metadata)
      values('mixed-global-proof','mixed-target','mixed-member','user','parameters','governance','definition-erased','High','parameter-definition','retained-definition','private-trace','{"private":"B business sentinel"}'),
      ('mixed-global-scope',null,'mixed-platform','user','user-governance','organization-operating-scope','resolve-operating-scope','Medium','organization','mixed-target','scope-trace','{"operatingOrganizationId":"mixed-target","actorUserId":"B business sentinel","private":"B business sentinel"}'),
      ('mixed-retain-audit','mixed-home','mixed-platform','user','user-governance','unrelated','retain','Low','organization','mixed-home','retain-trace','{"private":"Retain A sentinel"}');
      insert into parameter_catalog.definition_erasures(definition_id,organization_id,erased_by,audit_event_id,counts)
      values('retained-definition','mixed-home','mixed-member','mixed-global-proof','{"definitions":1}');`);
    const erased = await start(); expect(erased.status, erased.bodyText).toBe(202); expect(erased.body.item.status).toBe("deleted");
    expect(erased.body.item.domains).toEqual({}); expect(erased.body.item.attempts).toBe(0);
    const proofs = (await db.query<{ id: string; organization_id: string | null; metadata: { actorUserId: string }; historical_attribution: unknown; trace_id: string }>(
      "select id,organization_id,metadata,historical_attribution,trace_id from audit_events where id in ('mixed-global-proof','mixed-global-scope') order by id")).rows;
    expect(proofs).toHaveLength(2); expect(JSON.stringify(proofs)).not.toContain("B business sentinel"); expect(JSON.stringify(proofs)).not.toContain("private-trace");
    expect(proofs.every(row => row.organization_id === null)).toBe(true);
    expect(proofs.map(row => row.historical_attribution)).toEqual([{}, {}]);
    expect(proofs.map(row => row.metadata.actorUserId)).toEqual(["mixed-member", "mixed-platform"]);
    expect((await db.query("select metadata->>'private' content from audit_events where id='mixed-retain-audit'")).rows).toEqual([{ content: "Retain A sentinel" }]);
    expect((await db.query("select audit_event_id from parameter_catalog.definition_erasures where definition_id='retained-definition'")).rows).toEqual([{ audit_event_id: "mixed-global-proof" }]);
    expect((await request(`/api/v1/platform/organization-deletions/${erased.body.item.id}/retry`, "POST")).status).toBe(200);
    const journal = await mkdtemp(path.join(tmpdir(), "org1399-protected-recovery-")), file = path.join(journal, "organization-erasures.json");
    const cliEnv = { ...process.env, NODE_ENV: "test", DATABASE_URL: database.url, OBJECT_STORE_MODE: "local", OBJECT_STORE_ROOT: directory, XIAOZE_CHECKPOINTER: "memory" };
    try {
      const captured = await promisify(execFile)(process.execPath, ["--import", "tsx", "scripts/organization-erasure-recovery.ts", "capture", "--file", file], { env: cliEnv });
      expect(JSON.parse(captured.stdout)).toMatchObject({ captured: 1 }); expect((await stat(file)).mode & 0o777).toBe(0o600);
      expect(await readFile(file, "utf8")).not.toContain("B business sentinel");
      const replayed = await promisify(execFile)(process.execPath, ["--import", "tsx", "scripts/organization-erasure-recovery.ts", "replay", "--file", file, "--actor", "mixed-platform"], { env: cliEnv });
      expect(JSON.parse(replayed.stdout)).toMatchObject({ replayed: 0, applicable: 1 });
    } finally { await rm(journal, { recursive: true, force: true }); }
  });
  it("denies a new foreign platform file GET while deleting, without promising recall of an admitted download", async () => {
    const created = await request<{ item: { id: string } }>("/api/v1/knowledge/entries?organizationId=mixed-target", "POST", {
      title: "B download", contentForm: "file", tags: [], file: { fileName: "private.pdf", contentType: "application/pdf",
        contentBase64: (await readFile(new URL("../knowledge/testing/fixtures/sample.pdf", import.meta.url))).toString("base64") }
    });
    expect(created.status, created.bodyText).toBe(201);
    const content = `/api/v1/knowledge/entries/${created.body.item.id}/file/content?organizationId=mixed-target`;
    expect((await request(content)).status).toBe(200);
    const object = await store.put({ organizationId: "mixed-target", fileName: "feedback.png", contentType: "image/png", bytes: Buffer.from("B private image") });
    const feedback = randomUUID();
    await db.query("insert into product_feedback(id,organization_id,submitter_user_id,page_path,page_title,feedback_type,description) values($1,'mixed-target','mixed-member','/','B','experience','B')", [feedback]);
    await db.query("insert into product_feedback_attachments(id,organization_id,feedback_id,storage_key,file_name,content_type,size_bytes,checksum,sort_order) values($1,'mixed-target',$2,$3,'feedback.png','image/png',15,'checksum',0)", [randomUUID(), feedback, object.storageKey]);
    const remove = store.delete!; let release!: () => void, entered!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
    store.delete = async key => { if (key === object.storageKey) { entered(); await held; } await remove(key); };
    const deletion = start(); await started;
    try { expect((await request(content)).status).toBe(403); }
    finally { release(); await deletion; }
  });
  it("replays latest deletion against real older PostgreSQL/object/checkpoint backups before reopening", async () => {
    const checkpointDb = await createEphemeralTestDatabase("org1399_checkpoints"); extraDatabases.push(checkpointDb);
    const saver = createPostgresCheckpointerSaver({ connectionString: checkpointDb.url }); await saver.ensureSetup();
    agentCheckpointer = createXiaozeCheckpointer({ mode: "postgres", saver: saver.saver, ensureReady: saver.ensureSetup, withNamespaceLease: saver.withNamespaceLease });
    const key = "mixed-target:mixed-member:restore:session:with:colons";
    await agentCheckpointer.withNamespaceLease(key, async () => {
      await registerAgentCheckpointNamespace(db, agentCheckpointer, await getAuthContext(db, "mixed-member"), "restore:session:with:colons", key);
      await agentCheckpointer.saver.put({ configurable: { thread_id: key, checkpoint_ns: "" } },
        { v: 1, id: randomUUID(), ts: new Date().toISOString(), channel_values: { private: "B restore sentinel" }, channel_versions: {}, versions_seen: {} },
        { source: "input", step: 0, parents: {} }, {});
    });
    const feedback = await request<{ item: { attachments: Array<{ storageKey: string }> } }>("/api/v1/product-feedback?organizationId=mixed-target", "POST", {
      pagePath: "/", pageTitle: "B", feedbackType: "experience", description: "B restore sentinel", attachments: [{ fileName: "private.png", contentType: "image/png", contentBase64: Buffer.from("B image bytes").toString("base64") }]
    });
    expect(feedback.status, feedback.bodyText).toBe(201);
    const objectKey = feedback.body.item.attachments[0]!.storageKey;
    const retained = await store.put({ organizationId: "mixed-home", fileName: "retained.txt", contentType: "text/plain", bytes: Buffer.from("Retain A bytes") });
    const backupRoot = `${directory}-backup`; await cp(directory, backupRoot, { recursive: true });
    const oldData = await postgresTool("pg_dump", database.url, ["-Fc"]), oldCheckpoints = await postgresTool("pg_dump", checkpointDb.url, ["-Fc"]);
    const erased = await start(); expect(erased.body.item.status, erased.bodyText).toBe("deleted");
    const state = await captureOrganizationErasureState(db, { agentCheckpointer });
    await saver.saver.end();
    const restored = await createEphemeralTestDatabase("org1399_restored"); extraDatabases.push(restored);
    await postgresTool("pg_restore", restored.url, ["--clean", "--if-exists", "--no-owner", "--no-privileges"], oldData);
    await postgresTool("pg_restore", checkpointDb.url, ["--clean", "--if-exists", "--no-owner", "--no-privileges"], oldCheckpoints);
    await cp(backupRoot, directory, { recursive: true }); await rm(backupRoot, { recursive: true });
    await db.close(); db = createPostgresDatabase(restored.url);
    const restoredSaver = createPostgresCheckpointerSaver({ connectionString: checkpointDb.url, initialization: "runtime" }); savers.push(restoredSaver.saver);
    agentCheckpointer = createXiaozeCheckpointer({ mode: "postgres", saver: restoredSaver.saver, ensureReady: restoredSaver.ensureSetup, withNamespaceLease: restoredSaver.withNamespaceLease });
    expect((await agentCheckpointer.inspectStore(key)).entries.length).toBeGreaterThan(0); expect((await store.get(objectKey)).length).toBeGreaterThan(0);
    const caller = createUserInvocation(await getAuthContext(db, "mixed-platform"));
    await expect(replayOrganizationErasureState(db, caller, { ...state, checkpointStore: { kind: "postgres", id: "wrong-store" } }, { agentCheckpointer, objectStore: store })).rejects.toThrow(/physical store identity/);
    const remove = store.delete!; store.delete = async () => { throw new Error("Restore storage unavailable"); };
    await expect(replayOrganizationErasureState(db, caller, state, { agentCheckpointer, objectStore: store })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await db.query("select status from organizations where id='mixed-target'")).rows).toEqual([{ status: "deleting" }]);
    store.delete = remove;
    expect(await replayOrganizationErasureState(db, caller, state, { agentCheckpointer, objectStore: store })).toMatchObject({ replayed: 1 });
    expect((await agentCheckpointer.inspectStore(key)).entries).toEqual([]); await expect(store.get(objectKey)).rejects.toBeDefined();
    expect((await store.get(retained.storageKey)).toString()).toBe("Retain A bytes");
    expect((await db.query("select id from users where id='mixed-platform'")).rowCount).toBe(1);
    expect((await request(`/api/v1/platform/organization-deletions/${erased.body.item.id}`)).body).toMatchObject({ item: { status: "deleted", domains: {}, attempts: 0 } });
    expect(await replayOrganizationErasureState(db, caller, state, { agentCheckpointer, objectStore: store })).toMatchObject({ replayed: 0 });
  }, 30_000);
  it("completes all four domains through API LOGIN after storage, process lease and final-receipt faults while preserving shared custody", async () => {
    await db.query("insert into audit_events(id,organization_id,actor_user_id,actor_type,app,kind,action,severity,target_type,target_id,trace_id,metadata) values('mixed-progress-proof',null,'mixed-platform','user','user-governance','organization-operating-scope','resolve-operating-scope','High','organization','mixed-target','scope-trace','{\"operatingOrganizationId\":\"mixed-target\",\"private\":\"B mixed sentinel\"}')");
    const targetAuth = await getAuthContext(db, "mixed-member");
    await withTestClusterRoleCatalogLock(() => installConfigurationSourceFixture(db, targetAuth, { subjectId: "mixed-subject", schemaId: "mixed.configuration" }));
    // The fixture installs shared Catalog; actual producers below use DB-backed principals.
    await db.query("insert into projects(id,organization_id,name,code) values('mixed-project','mixed-target','B project','MIXED')");
    const parameter = await uploadProjectParameterFile(db, store, await getAuthContext(db, "mixed-member"), { projectId: "mixed-project", fileName: "settings.json", bytes: Buffer.from('{"limit":42}') });
    const knowledge = await request<{ item: { id: string; file: { storageKey: string } } }>("/api/v1/knowledge/entries?organizationId=mixed-target", "POST", {
      title: "B mixed knowledge", contentForm: "file", tags: [], file: { fileName: "private.pdf", contentType: "application/pdf", contentBase64: (await readFile(new URL("../knowledge/testing/fixtures/sample.pdf", import.meta.url))).toString("base64") }
    }); expect(knowledge.status, knowledge.bodyText).toBe(201);
    await db.query("insert into parameter_specs(id,organization_id,source_kind,specification_key,definition_lifecycle) values('mixed-legacy-spec','mixed-target','manual','mixed-spec','active')");
    await db.query("insert into knowledge_parameter_references(id,organization_id,entry_id,parameter_spec_id,created_by_user_id) values($1,'mixed-target',$2,'mixed-legacy-spec','mixed-member')", [randomUUID(), knowledge.body.item.id]);
    const log = await request<{ log: { id: string }; fileObject: { storageKey: string }; job: { id: string } }>("/api/v1/log-files?organizationId=mixed-target", "POST", { fileName: "device.log", contentType: "text/plain", skillSelection: "generic", contentBase64: Buffer.from("INFO boot\nERROR B mixed sentinel").toString("base64") });
    expect(log.status, log.bodyText).toBe(201);
    const feedback = await request<{ item: { id: string; attachments: Array<{ storageKey: string }> } }>("/api/v1/product-feedback?organizationId=mixed-target", "POST", { pagePath: "/", pageTitle: "B", feedbackType: "experience", description: "B mixed sentinel", attachments: [{ fileName: "private.png", contentType: "image/png", contentBase64: Buffer.from("shared B bytes").toString("base64") }] });
    expect(feedback.status, feedback.bodyText).toBe(201);
    const sharedKey = feedback.body.item.attachments[0]!.storageKey, foreignPending = randomUUID();
    await db.query("insert into knowledge_attachment_writes(id,organization_id,storage_key) values($1,'mixed-home',$2)", [foreignPending, sharedKey]);
    await db.query("insert into parameter_catalog.definition_erasures(definition_id,organization_id,erased_by,audit_event_id,pending_object_refs) values('mixed-global-pending','mixed-target','mixed-member','mixed-pending-proof',array[$1])", [`plane::${sharedKey}`]);
    const pairing = await request<{ code: string }>("/api/v1/device-bridges/pairing-codes", "POST", {}, "mixed-member"); expect(pairing.status, pairing.bodyText).toBe(201);
    expect((await request("/api/v1/device-bridges/pair", "POST", { code: pairing.body.code, machineLabel: "B machine", platform: "linux", arch: "amd64" })).status).toBe(201);
    const namespace = "mixed-target:mixed-member:mixed-turn";
    await agentCheckpointer.withNamespaceLease(namespace, async () => {
      await registerAgentCheckpointNamespace(db, agentCheckpointer, await getAuthContext(db, "mixed-member"), "mixed-turn", namespace);
      await agentCheckpointer.put(namespace, { private: "B mixed sentinel" });
    });
    roleToken = `org1399${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    const logins = await provisionPublicationRuntimeLogins(database.url, { mode: "lab", runToken: roleToken }); apiDb = createPostgresDatabase(logins.apiUrl);
    expect((await apiDb.query("select rolsuper from pg_roles where rolname=current_user")).rows).toEqual([{ rolsuper: false }]);
    const remove = store.delete!; store.delete = async key => { if (key === log.body.fileObject.storageKey) throw new Error("B log object offline"); await remove(key); };
    const failed = await start(); expect(failed.body.item.status, failed.bodyText).toBe("failed");
    expect(failed.body.item.domains).toMatchObject({ "agent-devices-feedback": { status: "complete" }, knowledge: { status: "complete" }, "projects-parameters": { status: "complete" }, logs: { status: "failed" } });
    expect((await db.query("select is_active from users where id='mixed-member'")).rows).toEqual([{ is_active: false }]);
    expect((await agentCheckpointer.inspectStore(namespace)).entries).toEqual([]); expect(await agentCheckpointer.get(namespace)).toBeUndefined();
    expect((await store.get(sharedKey)).toString()).toBe("shared B bytes");
    await expect(store.get(parameter.version.storageKey)).rejects.toBeDefined(); await expect(store.get(knowledge.body.item.file.storageKey)).rejects.toBeDefined();
    await db.query("update organization_erasures set status='running',lease_owner='terminated-process',lease_expires_at=clock_timestamp()-interval '1 second' where id=$1", [failed.body.item.id]);
    await db.query(`create function mixed_final_receipt_fault() returns trigger language plpgsql as $$ begin if new.target_organization_id='mixed-target' and new.status='deleted' then raise exception 'Actual final receipt fault'; end if; return new; end $$;
      create trigger mixed_final_receipt_fault before update on organization_erasures for each row execute function mixed_final_receipt_fault()`);
    await apiDb.close(); apiDb = createPostgresDatabase(logins.apiUrl); store.delete = remove;
    const finalFault = await request<{ item: { status: string; stage: string } }>(`/api/v1/platform/organization-deletions/${failed.body.item.id}/retry`, "POST");
    expect(finalFault.body.item).toMatchObject({ status: "failed", stage: "finalize" });
    expect((await db.query("select metadata->>'result' result from audit_events where id='mixed-progress-proof'")).rows).toEqual([{ result: "processing" }]);
    expect((await db.query("select id from organizations where id='mixed-target'")).rowCount).toBe(0); expect((await db.query("select id from users where id='mixed-member'")).rowCount).toBe(0);
    const repeatedFinalFault = await request<{ item: { status: string; stage: string } }>(`/api/v1/platform/organization-deletions/${failed.body.item.id}/retry`, "POST");
    expect(repeatedFinalFault.body.item).toMatchObject({ status: "failed", stage: "finalize" });
    expect((await db.query("select metadata->>'result' result from audit_events where id='mixed-progress-proof'")).rows).toEqual([{ result: "processing" }]);
    await db.query("drop trigger mixed_final_receipt_fault on organization_erasures");
    const complete = await request<{ item: { status: string; domains: Record<string, unknown>; attempts: number } }>(`/api/v1/platform/organization-deletions/${failed.body.item.id}/retry`, "POST");
    expect(complete.body.item).toMatchObject({ status: "deleted", domains: {}, attempts: 0 });
    expect((await db.query("select metadata->>'result' result from audit_events where id='mixed-progress-proof'")).rows).toEqual([{ result: "deleted" }]);
    expect(JSON.stringify(complete.body)).not.toContain("B mixed sentinel");
    expect((await db.query("select id from knowledge_attachment_writes where id=$1", [foreignPending])).rowCount).toBe(1);
    expect((await request("/api/v2/catalog/definition-erasures")).body).toMatchObject({ items: [expect.objectContaining({ definitionId: "mixed-global-pending", pendingObjectCount: 1 })] });
    expect((await request("/api/v2/catalog/definition-erasures/mixed-global-pending/retry-cleanup", "POST")).status).toBe(409);
    await db.query("delete from knowledge_attachment_writes where id=$1", [foreignPending]);
    expect((await request("/api/v2/catalog/definition-erasures/mixed-global-pending/retry-cleanup", "POST")).status).toBe(200); await expect(store.get(sharedKey)).rejects.toBeDefined();
    expect((await db.query("select id from parameter_catalog.parameter_definitions where id='pdef_acme_power_iin_max'")).rowCount).toBe(1);
  });
  it("does not treat an unknown global physical store as empty after the target rows are gone", async () => {
    expect((await start()).body.item.status).toBe("deleted");
    const state = await captureOrganizationErasureState(db, { agentCheckpointer });
    await db.query("insert into parameter_catalog.definition_erasures(definition_id,organization_id,erased_by,audit_event_id,pending_object_refs) values('unresolved-restore-store',null,'mixed-platform','unresolved-proof',array['untyped-physical-reference'])");
    await expect(replayOrganizationErasureState(db, createUserInvocation(await getAuthContext(db, "mixed-platform")), state, { agentCheckpointer, objectStore: store })).rejects.toThrow(/orphaned ownership/);
  });
  it("requires a durable pool root rather than allowing recovery inside an outer transaction", async () => {
    expect((await start()).body.item.status).toBe("deleted");
    const state = await captureOrganizationErasureState(db, { agentCheckpointer }), caller = createUserInvocation(await getAuthContext(db, "mixed-platform"));
    await db.transaction(async tx => {
      await expect(replayOrganizationErasureState(tx, caller, state, { agentCheckpointer, objectStore: store })).rejects.toThrow(/durable pool root/);
    });
  });
});
