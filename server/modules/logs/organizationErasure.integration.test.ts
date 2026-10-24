import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { createWiseEffServer } from "../../app";
import { requestJson } from "../../test/testClient";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { createPostgresDatabase, type RootDatabase } from "../../shared/database/client";
import { seedCoreGraph } from "../../testing/fixtures";
import { seedBaselineAuthCatalog } from "../auth/baselineCatalog";
import { createXiaozeCheckpointer } from "../agent/xiaoze/checkpointer";
import { createLocalObjectStore, type ObjectStore } from "./objectStore";
import { createLogWebhookDeliverer } from "./webhookDelivery";
import { processLogAnalysisJobById } from "./worker";
import { createRuleBasedLogAnalyzer } from "./analyzer";
import { randomBytes } from "node:crypto";
import { provisionPublicationRuntimeLogins, dropLabRuntimeLogins } from "../../testing/labRuntimeLogins";
import { notifyLogAnalysisCompleted } from "../notifications/producers";

describe("Organization log erasure through HTTP, PostgreSQL and real object storage", () => {
  let database: Awaited<ReturnType<typeof createEphemeralTestDatabase>>, db: RootDatabase;
  let directory: string, store: ObjectStore;
  const agentCheckpointer = createXiaozeCheckpointer();
  beforeEach(async () => {
    database = await createEphemeralTestDatabase("org_log_erasure");
    db = createPostgresDatabase(database.url);
    directory = await mkdtemp(join(tmpdir(), "wiseeff-org-log-erasure-"));
    store = createLocalObjectStore(directory);
    await seedCoreGraph(db, { organization: { id: "log-home" }, users: [{ id: "log-platform" }] });
    await seedCoreGraph(db, { organization: { id: "log-target" }, users: [{ id: "log-member" }] });
    await seedBaselineAuthCatalog(db);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('log-platform-role','log-platform','log-home','platform-admin'),('log-member-role','log-member','log-target','admin')");
  });
  afterEach(async () => { await db?.close(); await database?.drop(); await rm(directory, { recursive: true, force: true }); });
  async function request<T>(path: string, method = "GET", body?: unknown, user = "log-platform") {
    return requestJson<T>(createWiseEffServer({ db, objectStore: store, agentCheckpointer }), path,
      { method, headers: { "x-wiseeff-user": user }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  async function start() {
    const target = "/api/v1/platform/organizations/log-target";
    const preview = await request<{ item: { stateDigest: string } }>(`${target}/deletion-preview`);
    expect(preview.status, preview.bodyText).toBe(200);
    return request<{ item: { id: string; status: string } }>(`${target}/deletions`, "POST",
      { stateDigest: preview.body.item.stateDigest, confirmationOrganizationId: "log-target" });
  }
  async function upload() {
    const result = await request<{ log: { id: string }; fileObject: { storageKey: string }; job: { id: string; runId: string } }>("/api/v1/log-files", "POST",
      { fileName: "device.log", contentType: "text/plain", skillSelection: "generic", contentBase64: Buffer.from("INFO boot\nERROR device timed out").toString("base64") }, "log-member");
    expect(result.status, result.bodyText).toBe(201);
    return result.body;
  }
  it("erases uploaded logs, queued analysis and physical files while preserving another organization", async () => {
    const uploaded = await upload();
    const foreign = await store.put({ organizationId: "log-home", fileName: "keep.log", contentType: "text/plain", bytes: Buffer.from("foreign log") });
    await db.query("insert into log_file_objects(id,organization_id,storage_key,file_name,content_type,file_size_bytes,checksum_sha256) values('foreign-file','log-home',$1,'keep.log','text/plain',11,$2)", [foreign.storageKey, foreign.checksumSha256]);
    expect(await store.get(uploaded.fileObject.storageKey)).toBeInstanceOf(Buffer);
    const erased = await start();
    expect(erased.status, erased.bodyText).toBe(202);
    expect(erased.body.item.status).toBe("deleted");
    for (const table of ["log_records", "log_file_objects", "log_analysis_runs", "jobs"]) {
      expect((await db.query(`select count(*)::int n from ${table} where organization_id='log-target'`)).rows).toEqual([{ n: 0 }]);
    }
    await expect(store.get(uploaded.fileObject.storageKey)).rejects.toThrow();
    expect((await store.get(foreign.storageKey)).toString()).toBe("foreign log");
    expect((await readdir(directory)).length).toBeGreaterThan(0);
  });
  it("retains exact custody when an upload writes bytes but loses its response before metadata", async () => {
    const put = store.put;
    let key = "";
    store.put = async input => { const saved = await put(input); key = saved.storageKey; throw new Error("response lost after physical upload"); };
    const uploaded = await request("/api/v1/log-files", "POST", { fileName: "lost.log", contentType: "text/plain", skillSelection: "generic",
      contentBase64: Buffer.from("ERROR secret upload without metadata").toString("base64") }, "log-member");
    expect(uploaded.status).toBe(500);
    expect((await db.query("select count(*)::int n from log_records where organization_id='log-target'")).rows).toEqual([{ n: 0 }]);
    expect((await store.get(key)).length).toBeGreaterThan(0);
    const erased = await start();
    expect(erased.status, erased.bodyText).toBe(202); expect(erased.body.item.status).toBe("deleted");
    await expect(store.get(key)).rejects.toThrow();
  });
  it("keeps failed object cleanup visible and resumes with a fresh server and connection", async () => {
    const uploaded = await upload(), remove = store.delete!;
    store.delete = async () => { throw new Error("temporary storage failure"); };
    const failed = await start(); expect(failed.status, failed.bodyText).toBe(202); expect(failed.body.item.status).toBe("failed");
    expect((await db.query("select count(*)::int n from log_records where organization_id='log-target'")).rows).toEqual([{ n: 0 }]);
    expect((await store.get(uploaded.fileObject.storageKey)).length).toBeGreaterThan(0);
    await db.close(); db = createPostgresDatabase(database.url); store = createLocalObjectStore(directory);
    const retry = await request<{ item: { status: string; domains: { logs: { status: string; attempts: number } } } }>(`/api/v1/platform/organization-deletions/${failed.body.item.id}/retry`, "POST");
    expect(retry.status, retry.bodyText).toBe(200); expect(retry.body.item).toMatchObject({ status: "deleted", domains: { logs: { status: "complete", attempts: 2 } } });
    await expect(store.get(uploaded.fileObject.storageKey)).rejects.toThrow();
    expect(remove).toBeTypeOf("function");
  });
  it("retains objects referenced by another organization or pending global Definition erasure", async () => {
    const uploaded = await upload(), key = uploaded.fileObject.storageKey;
    await db.query("insert into log_file_objects(id,organization_id,storage_key,file_name,content_type,file_size_bytes,checksum_sha256) select 'shared-file','log-home',storage_key,file_name,content_type,file_size_bytes,checksum_sha256 from log_file_objects where organization_id='log-target'");
    const pending = await store.put({ organizationId: "log-target", fileName: "global-pending.bin", contentType: "application/octet-stream", bytes: Buffer.from("shared global custody") });
    await db.query("insert into log_object_writes(id,organization_id,object_key) values('00000000-0000-4000-8000-000000000097','log-target',$1)", [pending.storageKey]);
    await db.query("insert into audit_events(id,organization_id,actor_user_id,actor_type,app,kind,action,severity,target_type,target_id,trace_id) values('global-pending-audit','log-home','log-platform','user','parameter-admin','parameter-definition','delete','High','parameter-definition','global-pending-definition','global-pending-trace')");
    await db.query("insert into parameter_catalog.definition_erasures(definition_id,organization_id,erased_by,audit_event_id,pending_object_refs) values('global-pending-definition','log-home','log-platform','global-pending-audit',array[$1])", [`plane::${pending.storageKey}`]);
    const erased = await start(); expect(erased.status, erased.bodyText).toBe(202); expect(erased.body.item.status).toBe("deleted");
    expect((await store.get(key)).length).toBeGreaterThan(0);
    expect((await store.get(pending.storageKey)).toString()).toBe("shared global custody");
    expect((await db.query("select cardinality(pending_object_refs) n from parameter_catalog.definition_erasures where definition_id='global-pending-definition'")).rows).toEqual([{ n: 1 }]);
  });
  it("does not overtake a physical upload and rejects its late metadata before a retry removes the bytes", async () => {
    let release!: () => void, entered!: () => void, key = "";
    const held = new Promise<void>(resolve => { release = resolve; }), writing = new Promise<void>(resolve => { entered = resolve; });
    const put = store.put;
    store.put = async input => { entered(); await held; const saved = await put(input); key = saved.storageKey; return saved; };
    const uploading = request("/api/v1/log-files", "POST", { fileName: "held.log", contentType: "text/plain", skillSelection: "generic",
      contentBase64: Buffer.from("ERROR held physical upload").toString("base64") }, "log-member");
    try {
      await writing;
      const failed = await start(); expect(failed.status, failed.bodyText).toBe(202); expect(failed.body.item.status).toBe("failed");
      release(); expect((await uploading).status).not.toBe(201);
      expect((await db.query("select count(*)::int n from log_records where organization_id='log-target'")).rows).toEqual([{ n: 0 }]);
      expect((await store.get(key)).length).toBeGreaterThan(0);
      const retry = await request<{ item: { status: string } }>(`/api/v1/platform/organization-deletions/${failed.body.item.id}/retry`, "POST");
      expect(retry.status, retry.bodyText).toBe(200); expect(retry.body.item.status).toBe("deleted");
      await expect(store.get(key)).rejects.toThrow();
    } finally { release(); await uploading; }
  });
  it("fences a claimed analysis worker so its late result cannot resurrect a deleted organization", async () => {
    const uploaded = await upload();
    let release!: () => void, entered!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; }), analyzing = new Promise<void>(resolve => { entered = resolve; });
    const worker = processLogAnalysisJobById({ db, objectStore: store, jobId: uploaded.job.id,
      analyzer: { async analyze(input) { entered(); await held; return createRuleBasedLogAnalyzer().analyze(input); } } });
    try {
      await Promise.race([analyzing, worker.then(() => { throw new Error("Worker did not reach actual analysis"); })]);
      const erased = await start(); expect(erased.status, erased.bodyText).toBe(202); expect(erased.body.item.status).toBe("deleted");
      release(); expect(await worker).toEqual({ status: "idle" });
      for (const table of ["log_records", "log_analysis_reports", "log_analysis_trace_steps", "jobs", "log_webhook_outbox"]) {
        expect((await db.query(`select count(*)::int n from ${table} where organization_id='log-target'`)).rows).toEqual([{ n: 0 }]);
      }
      expect(await processLogAnalysisJobById({ db, objectStore: store, jobId: uploaded.job.id })).toEqual({ status: "idle" });
    } finally { release(); await worker; }
  });
  it.each([200, 503])("waits for an admitted real HTTP callback (%s), records its actual result and never sends it again", async status => {
    const uploaded = await upload();
    const skill = await request<{ item: { id: string } }>("/api/v1/log-skills", "POST", { name: "Callback erasure" }, "log-member");
    expect(skill.status, skill.bodyText).toBe(201);
    let release!: () => void, entered!: () => void, received = 0;
    const held = new Promise<void>(resolve => { release = resolve; }), sending = new Promise<void>(resolve => { entered = resolve; });
    const receiver = createServer(async (incoming, response) => {
      for await (const _chunk of incoming) { /* consume actual request */ }
      received++; entered(); await held; response.writeHead(status); response.end("received");
    });
    await new Promise<void>(resolve => receiver.listen(0, "127.0.0.1", resolve));
    const address = receiver.address(); if (!address || typeof address === "string") throw new Error("Local callback unavailable");
    let delivery: Promise<unknown> | undefined, deleting: ReturnType<typeof start> | undefined;
    try {
      await db.query("update log_domains set webhook_enabled=true,webhook_url=$2,webhook_secret='test-only-callback-secret' where id=$1", [skill.body.item.id, `http://127.0.0.1:${address.port}/hook`]);
      await db.query("insert into log_webhook_outbox(id,organization_id,log_domain_id,log_record_id,run_id,payload) values('org-erasure-webhook','log-target',$1,$2,$3,'{\"event\":\"log-analysis.completed\"}')", [skill.body.item.id, uploaded.log.id, uploaded.job.runId]);
      const deliverer = createLogWebhookDeliverer({ db, env: { timeoutMs: 10_000, maxAttempts: 2, retryBaseDelayMs: 1, allowInsecureLocal: true } });
      delivery = deliverer.processNext(); await sending;
      deleting = start();
      let blocked = false;
      for (let attempt = 0; attempt < 100 && !blocked; attempt++) {
        blocked = (await db.query("select pid from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%select id from organizations where id=$1 for update%'")).rowCount! > 0;
        if (!blocked) await delay(10);
      }
      expect(blocked).toBe(true); expect(received).toBe(1);
      release(); expect(await delivery).toMatchObject({ status: status === 200 ? "delivered" : "retrying", httpStatus: status });
      expect((await deleting).status).toBe(409); // Send bookkeeping invalidates the old preview.
      expect((await db.query("select status,http_status from log_webhook_deliveries where organization_id='log-target'")).rows).toEqual([{ status: status === 200 ? "delivered" : "retrying", http_status: status }]);
      const erased = await start(); expect(erased.status, erased.bodyText).toBe(202); expect(erased.body.item.status).toBe("deleted");
      expect(await deliverer.processNext()).toBeNull(); await deliverer.flush(); expect(received).toBe(1);
      expect((await db.query("select id from log_webhook_deliveries where organization_id='log-target'")).rows).toEqual([]);
    } finally { release(); await delivery; await deleting; await new Promise<void>(resolve => receiver.close(() => resolve())); }
  });
  it("erases published skills, samples, cases, standalone sources and old object-cleanup receipts", async () => {
    const skill = await request<{ item: { id: string } }>("/api/v1/log-skills", "POST", { name: "Whole organization skill" }, "log-member");
    expect(skill.status, skill.bodyText).toBe(201);
    const sample = await request(`/api/v1/log-skills/${skill.body.item.id}/sample`, "PUT", { fileName: "sample.log", contentBase64: Buffer.from("ERROR secret sample").toString("base64") }, "log-member");
    expect(sample.status, sample.bodyText).toBe(200);
    const selected = await request<{ log: { id: string }; job: { id: string } }>("/api/v1/log-files", "POST", { fileName: "case.log", contentType: "text/plain", skillId: skill.body.item.id,
      contentBase64: Buffer.from("ERROR secret case\n").toString("base64") }, "log-member");
    expect(selected.status, selected.bodyText).toBe(201);
    expect(await processLogAnalysisJobById({ db, objectStore: store, jobId: selected.body.job.id })).toEqual({ status: "processed" });
    const savedCase = await request(`/api/v1/log-skills/${skill.body.item.id}/analysis-cases`, "POST", { name: "Independent case", sourceRecordId: selected.body.log.id,
      expectations: { domain: "generic", summary: "Failure", realLog: false, rootCauseCategory: "software-fault", rootCausePoints: ["Failure"], keyEvidenceLines: [1], expectedActions: ["Inspect"], expectRefusal: false } }, "log-member");
    expect(savedCase.status, savedCase.bodyText).toBe(201);
    const archived = await store.put({ organizationId: "log-target", fileName: "standalone-source.zip", contentType: "application/zip", bytes: Buffer.from("unattached source") });
    await db.query("insert into log_source_snapshots(id,organization_id,skill_id,version_label,storage_key,file_name,status) values('standalone-source','log-target',null,'orphan-version',$1,'source.zip','ready')", [archived.storageKey]);
    const old = await store.put({ organizationId: "log-target", fileName: "old-pending.bin", contentType: "application/octet-stream", bytes: Buffer.from("old pending bytes") });
    await db.query("insert into parameter_catalog.log_erasures(organization_id,log_id,preview_version,erased_by,run_ids,job_ids,pending_object_refs) values('log-target','old-log','old-version','log-member','{}','{}',array[$1])", [old.storageKey]);
    const erased = await start(); expect(erased.status, erased.bodyText).toBe(202); expect(erased.body.item.status).toBe("deleted");
    for (const table of ["log_domains", "log_skill_revisions", "log_skill_samples", "log_skill_analysis_cases", "log_skill_analysis_case_runs", "log_skill_artifact_objects", "log_source_snapshots", "log_skill_deletions", "log_object_writes"]) {
      expect((await db.query(`select count(*)::int n from ${table} where organization_id='log-target'`)).rows).toEqual([{ n: 0 }]);
    }
    await expect(store.get(archived.storageKey)).rejects.toThrow(); await expect(store.get(old.storageKey)).rejects.toThrow();
  });
  it("executes as the actual NOINHERIT API LOGIN while denying worker cleanup and private receipt DML", async () => {
    const uploaded = await upload(), token = `org1397${randomBytes(4).toString("hex")}`;
    const admin = db;
    let api: RootDatabase | undefined, worker: RootDatabase | undefined;
    try {
      const logins = await provisionPublicationRuntimeLogins(database.url, { mode: "lab", runToken: token });
      api = createPostgresDatabase(logins.apiUrl); worker = createPostgresDatabase(logins.workerUrl); db = api;
      expect((await api.query("select rolsuper,rolinherit from pg_roles where rolname=current_user")).rows).toEqual([{ rolsuper: false, rolinherit: false }]);
      await expect(api.query("delete from parameter_catalog.organization_log_erasure_objects")).rejects.toMatchObject({ code: "42501" });
      await expect(worker.query("delete from log_object_writes")).rejects.toMatchObject({ code: "42501" });
      await expect(worker.query("select parameter_catalog.erase_organization_logs('untrusted','lease','log-platform')")).rejects.toMatchObject({ code: "42501" });
      const erased = await start(); expect(erased.status, erased.bodyText).toBe(202); expect(erased.body.item.status).toBe("deleted");
      await expect(store.get(uploaded.fileObject.storageKey)).rejects.toThrow();
    } finally { db = admin; await api?.close(); await worker?.close(); await dropLabRuntimeLogins(database.url, token); }
  });
  it("removes typed log projections in a suspended foreign Home and rejects their later recreation", async () => {
    const uploaded = await upload();
    await notifyLogAnalysisCompleted(db, { organizationId: "log-home", logId: uploaded.log.id, runId: uploaded.job.runId,
      fileName: "private-target.log", recipientUserId: "log-platform", conclusion: "Target log content in foreign Home" });
    expect((await db.query("select id from user_notifications where organization_id='log-home'")).rowCount).toBeGreaterThan(0);
    await db.query("update organizations set status='suspended' where id='log-home'");
    const erased = await start(); expect(erased.status, erased.bodyText).toBe(202); expect(erased.body.item.status).toBe("deleted");
    expect((await db.query("select id from user_notifications where metadata->>'logId'=$1", [uploaded.log.id])).rows).toEqual([]);
    await db.query("update organizations set status='active' where id='log-home'");
    await expect(notifyLogAnalysisCompleted(db, { organizationId: "log-home", logId: uploaded.log.id, runId: uploaded.job.runId,
      fileName: "private-target.log", recipientUserId: "log-platform", conclusion: "Late target content" })).rejects.toMatchObject({ code: "55000" });
  });
});
