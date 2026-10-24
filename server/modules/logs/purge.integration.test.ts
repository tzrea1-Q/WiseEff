import { describe, expect, it } from "vitest";
import { createEphemeralTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { createPostgresDatabase } from "../../shared/database/client";
import { seedCoreGraph } from "../../testing/fixtures";
import { makeTestAuthContext } from "../../testing/authContext";
import { createMemoryObjectStore } from "../../testing/objectStore";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { requestJson } from "../../test/testClient";
import { registerLogRoutes } from "./routes";
import type { LogDeletionPreview } from "../../../src/domain/logs/deletionPreview";
import type { LogRecordDto } from "./types";
import { registerKnowledgeRoutes } from "../knowledge/routes";
import { processLogAnalysisJobById } from "./worker";
import { createRuleBasedLogAnalyzer } from "./analyzer";
import { notifyLogAnalysisCompleted } from "../notifications/producers";
import { randomBytes } from "node:crypto";
import { provisionPublicationRuntimeLogins, dropLabRuntimeLogins } from "../catalog-publication/runtime/provisionRuntimeLogins";
import { createLogWebhookDeliverer } from "./webhookDelivery";
import { createUserInvocation } from "../auth/trustedInvocation";
import { createLogSkill, saveLogSkillDraft, publishLogSkill } from "./skillsService";

const available = await isTestDatabaseAvailable();
const admin = makeTestAuthContext({ organizationId: "log-erasure-org", userId: "log-erasure-admin", roles: [{ roleId: "admin", projectId: null }],
  permissions: ["logs:view", "logs:upload", "logs:analyze", "logs:feedback", "logs:admin-domains", "knowledge:view", "knowledge:edit", "knowledge:manage"] });

async function fixture(runtime = false) {
  const ephemeral = await createEphemeralTestDatabase("logpurge"), db = createPostgresDatabase(ephemeral.url);
  await seedCoreGraph(db, { organization: { id: admin.organization.id }, users: [{ id: admin.user.id }] });
  await db.query("insert into user_role_bindings(id,organization_id,user_id,role_id) values('purge-admin-binding',$1,$2,'admin')", [admin.organization.id, admin.user.id]);
  const store = createMemoryObjectStore(), router = createRouter();
  const runtimeToken = runtime ? `purge1314${randomBytes(4).toString("hex")}` : null;
  const api = runtimeToken ? createPostgresDatabase((await provisionPublicationRuntimeLogins(ephemeral.url, { mode: "lab", runToken: runtimeToken })).apiUrl) : db;
  let auth = admin;
  registerLogRoutes(router, { db: api, objectStore: store, getCurrentAuthContext: () => auth });
  registerKnowledgeRoutes(router, { db: api, objectStore: store, getCurrentAuthContext: () => auth });
  const request = <T,>(path: string, method = "GET", body?: unknown) => requestJson<T>(createHttpServer(router), path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
  const upload = async (fileName = "owned.log", skillId?: string) => {
    const result = await request<{ log: LogRecordDto; fileObject: { id: string; storageKey: string }; job: { id: string; runId: string } }>("/api/v1/log-files", "POST", {
      fileName, contentType: "text/plain", ...(skillId ? { skillId } : { skillSelection: "generic" }), contentBase64: Buffer.from("INFO private-source-1314\nERROR failure\n").toString("base64") });
    expect(result.status).toBe(201); return result.body;
  };
  return { db, api, store, request, upload, setAuth: (value: typeof admin) => { auth = value; },
    close: async () => { if (runtimeToken) { await api.close(); await dropLabRuntimeLogins(ephemeral.url, runtimeToken); } await db.close(); await ephemeral.drop(); } };
}

describe.skipIf(!available)("permanent log deletion over real HTTP and PostgreSQL", () => {
  it.each([
    { artifact: "decoded-events.jsonl.gz", responseLost: false },
    { artifact: "decoded-events.jsonl.gz", responseLost: true },
    { artifact: "line-offsets", responseLost: false },
    { artifact: "line-offsets", responseLost: true },
  ])("keeps a lost worker's $artifact upload fenced after cancellation (response lost: $responseLost)", async ({ artifact, responseLost }) => {
    const h = await fixture(); let release: () => void = () => undefined; let worker: ReturnType<typeof processLogAnalysisJobById> | undefined;
    try {
      const invocation = createUserInvocation(admin), context = { requestId: "purge-old-attempt" };
      const skill = await createLogSkill(h.db, admin, { name: "Decoded cancellation" }, invocation, context);
      const draft = await saveLogSkillDraft(h.db, admin, skill.id, { schemaVersion: "skill/v1", parsing: { schemaVersion: "parsing/v1",
        extractors: artifact === "line-offsets" ? [] : [{ id: "value", pattern: "(?P<value>.+)", fields: { value: { type: "string" } } }] } }, null, skill.currentRevision.id, invocation, context);
      await publishLogSkill(h.db, admin, skill.id, draft.id, invocation, context);
      const selected = await h.upload("owned.log", skill.id), path = `/api/v1/logs/${selected.log.id}`;
      if (artifact === "line-offsets") await h.db.query("update log_files set line_index_key=null where record_id=$1", [selected.log.id]);
      let entered!: () => void;
      const writing = new Promise<void>((resolve) => { entered = resolve; }), held = new Promise<void>((resolve) => { release = resolve; });
      const put = h.store.put;
      h.store.put = async (input) => {
        const delayed = input.fileName.includes(artifact);
        if (delayed) { entered(); await held; }
        const stored = await put(input);
        if (delayed && responseLost) throw new Error("upload response lost after lease cancellation");
        return stored;
      };
      worker = processLogAnalysisJobById({ db: h.db, objectStore: h.store, jobId: selected.job.id, leaseTtlMs: 900, maxJobMs: 15_000,
        analyzer: { async analyze(input) {
          if (artifact === "line-offsets") {
            const reader = input.files?.[0].reader;
            if (!reader) throw new Error("Worker must expose its real indexed reader");
            await reader.readRange(1, 2);
          }
          return createRuleBasedLogAnalyzer().analyze(input);
        } } });
      await Promise.race([writing, worker.then(() => { throw new Error("Worker completed without starting the expected artifact upload"); })]);
      await h.db.query("update jobs set lease_owner='replacement-worker',lease_expires_at=now()+interval '1 minute' where id=$1", [selected.job.id]);
      expect(await worker).toEqual({ status: "idle" });
      const before = await h.request<{ item: LogDeletionPreview }>(`${path}/deletion-preview`);
      expect((await h.request(path, "DELETE", { version: before.body.item.version })).status).toBe(409);
      release();
      // Wait on the real record lock, not on the cancelled worker promise.
      await h.db.query("update log_records set id=id where id=$1", [selected.log.id]);
      const current = await h.request<{ item: LogDeletionPreview }>(`${path}/deletion-preview`);
      expect(current.body.item.inventory.find((item) => item.key === "artifacts")?.count).toBe(1);
      expect((await h.request(path, "DELETE", { version: current.body.item.version })).status).toBe(200);
      expect(h.store.entries.size).toBe(0);
      expect((await h.db.query("select id from log_analysis_reports where log_record_id=$1", [selected.log.id])).rows).toHaveLength(0);
    } finally { release(); await worker?.catch(() => undefined); await h.close(); }
  }, 120_000);

  it("executes through an actual non-superuser API LOGIN without general Catalog delete authority", async () => {
    const h = await fixture(true);
    try {
      expect((await h.api.query("select rolsuper from pg_roles where rolname=current_user")).rows[0]).toEqual({ rolsuper: false });
      await expect(h.api.query("delete from parameter_catalog.log_erasures")).rejects.toMatchObject({ code: "42501" });
      const selected = await h.upload(), path = `/api/v1/logs/${selected.log.id}`;
      const preview = await h.request<{ item: LogDeletionPreview }>(`${path}/deletion-preview`);
      expect(preview.status).toBe(200);
      await h.api.query("select parameter_catalog.lock_log_erasure($1,$2,$3)", [admin.organization.id, selected.log.id, admin.user.id]);
      expect((await h.request(path, "DELETE", { version: preview.body.item.version })).status).toBe(200);
      expect((await h.request(`${path}/deletion-status`)).status).toBe(200);
    } finally { await h.close(); }
  }, 120_000);

  it("retains an uncertain artifact upload for subsequent erasure even when the storage response is lost", async () => {
    const h = await fixture();
    try {
      const selected = await h.upload(), path = `/api/v1/logs/${selected.log.id}`, put = h.store.put;
      h.store.put = async (input) => { const stored = await put(input); if (input.fileName.startsWith("line-offsets")) throw new Error("upload response lost"); return stored; };
      expect((await h.request(`${path}/lines?file=owned.log&startLine=1&endLine=2`)).status).toBe(500);
      expect(h.store.entries.size).toBe(2);
      const preview = await h.request<{ item: LogDeletionPreview }>(`${path}/deletion-preview`);
      expect(preview.body.item.inventory.find((item) => item.key === "artifacts")?.count).toBe(1);
      expect((await h.request(path, "DELETE", { version: preview.body.item.version })).status).toBe(200);
      expect(h.store.entries.size).toBe(0);
    } finally { await h.close(); }
  }, 120_000);

  it("rechecks newly retained object references during retry and preserves case/source/skill history", async () => {
    const h = await fixture();
    try {
      const skill = await h.request<{ item: { id: string } }>("/api/v1/log-skills", "POST", { name: "Retained skill" });
      expect(skill.status).toBe(201);
      const selected = await h.upload("owned.log", skill.body.item.id), path = `/api/v1/logs/${selected.log.id}`;
      expect(await processLogAnalysisJobById({ db: h.db, objectStore: h.store, jobId: selected.job.id })).toEqual({ status: "processed" });
      const source = await h.store.put({ organizationId: admin.organization.id, fileName: "source.zip", bytes: Buffer.from("shared source"), contentType: "application/zip" });
      await h.db.query("insert into log_source_snapshots(id,organization_id,skill_id,version_label,storage_key,file_name,status) values('purge-source',$1,$2,'v1',$3,'source.zip','ready')", [admin.organization.id, skill.body.item.id, source.storageKey]);
      await h.db.query("update log_analysis_runs set source_snapshot_id='purge-source',source_snapshot_status='ready' where id=$1", [selected.job.runId]);
      const saved = await h.request<{ item: { id: string } }>(`/api/v1/log-skills/${skill.body.item.id}/analysis-cases`, "POST", { name: "Independent case", sourceRecordId: selected.log.id,
        expectations: { domain: "generic", summary: "failure", realLog: false, rootCauseCategory: "software-fault", rootCausePoints: ["failure"], keyEvidenceLines: [1], expectedActions: ["Inspect"], expectRefusal: false } });
      expect(saved.status, JSON.stringify(saved.body)).toBe(201);
      const revisions = (await h.db.query("select id,spec from log_skill_revisions where skill_id=$1 order by id", [skill.body.item.id])).rows;
      // Initially clear the case's copy. After the failed cleanup it acquires a
      // retained reference to exactly the old raw key, which retry must respect.
      await h.db.query("update log_skill_analysis_cases set uploads='[]' where id=$1", [saved.body.item.id]);
      const preview = await h.request<{ item: LogDeletionPreview }>(`${path}/deletion-preview`), remove = h.store.delete!;
      h.store.delete = async () => { throw new Error("offline"); };
      expect((await h.request(path, "DELETE", { version: preview.body.item.version })).status).toBe(200);
      await h.db.query("update log_skill_analysis_cases set uploads=$2 where id=$1", [saved.body.item.id, JSON.stringify([{ fileName: "owned.log", objectKey: selected.fileObject.storageKey, sizeBytes: 38 }])]);
      h.store.delete = remove;
      const retried = await h.request<{ item: { objects: string } }>(path, "DELETE", { version: preview.body.item.version });
      expect(retried.body.item.objects).toBe("complete");
      expect(await h.store.get(selected.fileObject.storageKey)).toBeDefined();
      expect(await h.store.get(source.storageKey)).toEqual(Buffer.from("shared source"));
      expect((await h.request(`/api/v1/log-skills/${skill.body.item.id}/analysis-cases`)).body).toMatchObject({ items: [expect.objectContaining({ id: saved.body.item.id })] });
      expect((await h.db.query("select id,spec from log_skill_revisions where skill_id=$1 order by id", [skill.body.item.id])).rows).toEqual(revisions);
    } finally { await h.close(); }
  }, 120_000);

  it("waits for an already sending webhook, then removes its deliveries and blocks subsequent work", async () => {
    const h = await fixture(); let release: () => void = () => undefined; let delivery: Promise<unknown> | undefined;
    try {
      const selected = await h.upload(), path = `/api/v1/logs/${selected.log.id}`;
      const skill = await h.request<{ item: { id: string } }>("/api/v1/log-skills", "POST", { name: "Webhook skill" });
      await h.db.query("update log_domains set webhook_enabled=true,webhook_url='http://127.0.0.1:9999/hook',webhook_secret='test-only-secret' where id=$1", [skill.body.item.id]);
      await h.db.query("insert into log_webhook_outbox(id,organization_id,log_domain_id,log_record_id,run_id,payload) values('purge-webhook',$1,$2,$3,$4,'{}')", [admin.organization.id, skill.body.item.id, selected.log.id, selected.job.runId]);
      let entered!: () => void;
      const sending = new Promise<void>((resolve) => { entered = resolve; }), held = new Promise<void>((resolve) => { release = resolve; });
      const deliverer = createLogWebhookDeliverer({ db: h.db, env: { timeoutMs: 10_000, maxAttempts: 2, retryBaseDelayMs: 1, allowInsecureLocal: true }, transport: async () => { entered(); await held; return { ok: true, httpStatus: 200 }; } });
      delivery = deliverer.processNext(); await sending;
      const preview = await h.request<{ item: LogDeletionPreview }>(`${path}/deletion-preview`);
      expect((await h.request(path, "DELETE", { version: preview.body.item.version })).status).toBe(409);
      release(); await delivery;
      const current = await h.request<{ item: LogDeletionPreview }>(`${path}/deletion-preview`);
      expect((await h.request(path, "DELETE", { version: current.body.item.version })).status).toBe(200);
      expect(await deliverer.processNext()).toBeNull();
      expect((await h.db.query("select id from log_webhook_deliveries where log_record_id=$1", [selected.log.id])).rows).toHaveLength(0);
      await expect(notifyLogAnalysisCompleted(h.db, { organizationId: admin.organization.id, logId: selected.log.id, runId: selected.job.runId, fileName: "private-source-1314", recipientUserId: admin.user.id, conclusion: "raw-private" })).rejects.toMatchObject({ code: "55000" });
    } finally { release(); await delivery?.catch(() => undefined); await h.close(); }
  }, 120_000);

  it("rechecks preview, current DB role and organization, then serializes concurrent confirmation", async () => {
    const h = await fixture();
    try {
      const selected = await h.upload(), path = `/api/v1/logs/${selected.log.id}`;
      const before = await h.request<{ item: LogDeletionPreview }>(`${path}/deletion-preview`);
      await h.db.query("update jobs set progress=13 where id=$1", [selected.job.id]);
      expect((await h.request(path, "DELETE", { version: before.body.item.version })).status).toBe(409);
      const current = await h.request<{ item: LogDeletionPreview }>(`${path}/deletion-preview`);
      await h.db.query("delete from user_role_bindings where id='purge-admin-binding'");
      expect((await h.request(path, "DELETE", { version: current.body.item.version })).status).toBe(403);
      await h.db.query("insert into user_role_bindings(id,organization_id,user_id,role_id) values('purge-admin-binding',$1,$2,'admin')", [admin.organization.id, admin.user.id]);
      await h.db.query("update users set is_active=false where id=$1", [admin.user.id]);
      expect((await h.request(path, "DELETE", { version: current.body.item.version })).status).toBe(403);
      await h.db.query("update users set is_active=true where id=$1", [admin.user.id]);
      h.setAuth(makeTestAuthContext({ organizationId: "other-org", userId: "other-admin", permissions: ["logs:admin-domains"] }));
      expect((await h.request(path, "DELETE", { version: current.body.item.version })).status).toBe(403);
      h.setAuth(admin);
      const results = await Promise.all([h.request(path, "DELETE", { version: current.body.item.version }), h.request(path, "DELETE", { version: current.body.item.version })]);
      expect(results.map((item) => item.status)).toEqual([200, 200]);
      expect((await h.db.query("select id from audit_events where kind='log-purged' and target_id=$1", [selected.log.id])).rows).toHaveLength(1);
      expect((await h.request(path, "DELETE", { version: "b".repeat(64) })).status).toBe(409);
    } finally { await h.close(); }
  }, 120_000);

  it.each([false, true])("persists object cleanup failure and safely retries a lost delete response=%s", async (lostResponse) => {
    const h = await fixture();
    try {
      const selected = await h.upload(), path = `/api/v1/logs/${selected.log.id}`;
      const preview = await h.request<{ item: LogDeletionPreview }>(`${path}/deletion-preview`);
      const remove = h.store.delete!;
      h.store.delete = async (key) => { if (lostResponse) await remove(key); throw new Error("object storage unavailable"); };
      const failed = await h.request<{ item: { objects: string; pendingObjects: number } }>(path, "DELETE", { version: preview.body.item.version });
      expect(failed.status).toBe(200); expect(failed.body.item.objects).toBe("pending"); expect(failed.body.item.pendingObjects).toBeGreaterThan(0);
      expect((await h.request(path)).status).toBe(404);
      expect((await h.request<{ items: unknown[] }>("/api/v1/logs/deletions")).body.items).toHaveLength(1);
      h.store.delete = remove;
      const retried = await h.request<{ item: { objects: string } }>(path, "DELETE", { version: preview.body.item.version });
      expect(retried.status).toBe(200); expect(retried.body.item.objects).toBe("complete");
      expect((await h.request<{ items: unknown[] }>("/api/v1/logs/deletions")).body.items).toHaveLength(0);
      expect(h.store.entries.size).toBe(0);
      expect((await h.db.query("select id from audit_events where kind='log-purged' and target_id=$1", [selected.log.id])).rows).toHaveLength(1);
    } finally { await h.close(); }
  }, 120_000);

  it("preserves shared raw files, independent knowledge content/revisions and retained skill/source metadata", async () => {
    const h = await fixture();
    try {
      const selected = await h.upload(), path = `/api/v1/logs/${selected.log.id}`;
      expect(await processLogAnalysisJobById({ db: h.db, objectStore: h.store, jobId: selected.job.id })).toEqual({ status: "processed" });
      const distilled = await h.request<{ item: { id: string; sourceLogDeleted?: boolean; sourceLogId: string | null; contentMarkdown: string } }>("/api/v1/knowledge/distill-from-log", "POST", { logId: selected.log.id });
      expect(distilled.status).toBe(201);
      const knowledgePath = `/api/v1/knowledge/entries/${distilled.body.item.id}`;
      const history = await h.request(`${knowledgePath}/revisions`);
      const shared = await h.request<{ log: LogRecordDto }>("/api/v1/logs", "POST", { fileObjectId: selected.fileObject.id, fileName: "owned.log", skillSelection: "generic" });
      expect(shared.status).toBe(201);
      const preview = await h.request<{ item: LogDeletionPreview }>(`${path}/deletion-preview`);
      expect(preview.body.item.objects.shared).toBeGreaterThan(0);
      expect((await h.request(path, "DELETE", { version: preview.body.item.version })).status).toBe(200);
      const retained = await h.request<typeof distilled.body>(knowledgePath);
      expect(retained.body.item).toMatchObject({ sourceLogId: null, sourceLogDeleted: true, contentMarkdown: distilled.body.item.contentMarkdown });
      expect((await h.request(`${knowledgePath}/revisions`)).body).toEqual(history.body);
      expect((await h.request(`/api/v1/logs/${shared.body.log.id}`)).status).toBe(200);
      expect(await h.store.get(selected.fileObject.storageKey)).toEqual(Buffer.from("INFO private-source-1314\nERROR failure\n"));
    } finally { await h.close(); }
  }, 120_000);

  it("atomically rolls back the database when audit persistence fails, without deleting bytes", async () => {
    const h = await fixture();
    try {
      const selected = await h.upload(), path = `/api/v1/logs/${selected.log.id}`;
      const preview = await h.request<{ item: LogDeletionPreview }>(`${path}/deletion-preview`);
      const auditBefore = (await h.db.query("select id,metadata from audit_events where target_id=$1 order by id", [selected.log.id])).rows;
      await h.db.query("create function reject_purge_audit() returns trigger language plpgsql as $$ begin if new.kind='log-purged' then raise exception 'audit unavailable'; end if; return new; end $$");
      await h.db.query("create trigger reject_purge_audit before insert on audit_events for each row execute function reject_purge_audit()");
      expect((await h.request(path, "DELETE", { version: preview.body.item.version })).status).toBe(500);
      expect((await h.request(path)).status).toBe(200);
      expect((await h.request(`${path}/deletion-status`)).status).toBe(404);
      expect(await h.store.get(selected.fileObject.storageKey)).toBeDefined();
      expect((await h.db.query("select id,metadata from audit_events where target_id=$1 order by id", [selected.log.id])).rows).toEqual(auditBefore);
      expect((await h.db.query("select id from jobs where id=$1", [selected.job.id])).rows).toHaveLength(1);
    } finally { await h.close(); }
  }, 120_000);

  it("isolates an in-flight analyzer and rejects recreation of its durable job, trace and notifications", async () => {
    const h = await fixture(); let release: () => void = () => undefined; let worker: ReturnType<typeof processLogAnalysisJobById> | undefined;
    try {
      const selected = await h.upload(), path = `/api/v1/logs/${selected.log.id}`;
      let entered!: () => void;
      const analyzing = new Promise<void>((resolve) => { entered = resolve; }), held = new Promise<void>((resolve) => { release = resolve; });
      worker = processLogAnalysisJobById({ db: h.db, objectStore: h.store, jobId: selected.job.id,
        analyzer: { analyze: async (input) => { entered(); await held; return createRuleBasedLogAnalyzer().analyze(input); } } });
      await analyzing;
      const preview = await h.request<{ item: LogDeletionPreview }>(`${path}/deletion-preview`);
      expect((await h.request(path, "DELETE", { version: preview.body.item.version })).status).toBe(200);
      release(); expect(await worker).toEqual({ status: "idle" });
      expect(await processLogAnalysisJobById({ db: h.db, objectStore: h.store, jobId: selected.job.id })).toEqual({ status: "idle" });
      expect((await h.db.query("select id from log_analysis_reports where log_record_id=$1", [selected.log.id])).rows).toHaveLength(0);
      expect((await h.db.query("select public.is_erased_log_job($1,$2,$3) erased", [admin.organization.id, selected.log.id, selected.job.id])).rows[0]).toEqual({ erased: true });
      expect((await h.db.query("select public.is_erased_log_job($1,$2,$3) erased", ["other-org", selected.log.id, selected.job.id])).rows[0]).toEqual({ erased: false });
      await expect(h.db.query("insert into jobs(id,organization_id,kind,target_id,status) values($1,$2,'log-analysis',$3,'queued')", [selected.job.id, admin.organization.id, selected.job.runId])).rejects.toMatchObject({ code: "55000" });
      expect(h.store.entries.size).toBe(0);
    } finally { release(); await worker?.catch(() => undefined); await h.close(); }
  }, 120_000);

  it("deletes a confirmed log, disables all old access and returns a durable idempotent receipt", async () => {
    const h = await fixture();
    try {
      const selected = await h.upload(), other = await h.upload("keep.log");
      const path = `/api/v1/logs/${selected.log.id}`;
      expect((await h.request(`${path}/feedback`, "POST", { rating: "helpful", note: "private-source-1314 raw copied into feedback" })).status).toBe(200);
      const preview = await h.request<{ item: LogDeletionPreview }>(`${path}/deletion-preview`);
      expect(preview.status).toBe(200);
      const result = await h.request<{ item: { logId: string; version: string; database: string; objects: string; pendingObjects: number } }>(path, "DELETE", { version: preview.body.item.version });
      expect(result.status).toBe(200);
      expect(result.body.item).toEqual({ logId: selected.log.id, version: preview.body.item.version, database: "deleted", objects: "complete", pendingObjects: 0 });
      for (const suffix of ["", "/runs", "/trace", "/lines?file=owned.log&startLine=1&endLine=1", "/deletion-preview"]) {
        expect((await h.request(`${path}${suffix}`)).status).toBe(404);
      }
      expect((await h.request(path, "DELETE", { version: preview.body.item.version })).body).toEqual(result.body);
      expect((await h.request(`${path}/deletion-status`)).body).toEqual(result.body);
      expect((await h.request(`/api/v1/logs/${other.log.id}`)).status).toBe(200);
      await expect(h.store.get(selected.fileObject.storageKey)).rejects.toThrow();
      expect(await h.store.get(other.fileObject.storageKey)).toEqual(Buffer.from("INFO private-source-1314\nERROR failure\n"));
      const audit = await h.db.query<{ metadata: unknown }>("select metadata from audit_events where kind='log-purged' and target_id=$1", [selected.log.id]);
      expect(audit.rows).toHaveLength(1);
      expect(JSON.stringify(audit.rows)).not.toContain("private-source-1314");
      const retainedAudit = await h.db.query("select kind,metadata from audit_events where target_type='log-record' and target_id=$1", [selected.log.id]);
      expect(retainedAudit.rows.length).toBeGreaterThan(1);
      expect(JSON.stringify(retainedAudit.rows)).not.toContain("private-source-1314");
    } finally { await h.close(); }
  }, 120_000);

  it("fences an in-flight index upload so deletion cannot leave a late orphan or a broken retained reference", async () => {
    const h = await fixture();
    let release: () => void = () => undefined;
    let request: Promise<unknown> | undefined;
    try {
      const selected = await h.upload(), path = `/api/v1/logs/${selected.log.id}`;
      let entered!: () => void;
      const writing = new Promise<void>((resolve) => { entered = resolve; });
      const held = new Promise<void>((resolve) => { release = resolve; });
      const originalPut = h.store.put;
      h.store.put = async (input) => { if (input.fileName.startsWith("line-offsets")) { entered(); await held; } return originalPut(input); };
      request = h.request(`${path}/lines?file=owned.log&startLine=1&endLine=2`);
      await writing;
      const preview = await h.request<{ item: LogDeletionPreview }>(`${path}/deletion-preview`);
      const busy = await h.request(path, "DELETE", { version: preview.body.item.version });
      expect(busy.status).toBe(409);
      release();
      expect((await request as { status: number }).status).toBe(200);
      const current = await h.request<{ item: LogDeletionPreview }>(`${path}/deletion-preview`);
      expect(current.body.item.inventory.find((item) => item.key === "artifacts")?.count).toBe(1);
      expect((await h.request(path, "DELETE", { version: current.body.item.version })).status).toBe(200);
      expect(h.store.entries.size).toBe(0);
    } finally { release(); await request?.catch(() => undefined); await h.close(); }
  }, 120_000);
});
