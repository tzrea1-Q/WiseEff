import { createHmac, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWiseEffServer } from "../../app";
import { createPostgresDatabase, type RootDatabase } from "../../shared/database/client";
import { requestJson } from "../../test/testClient";
import { createEphemeralTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import { createMemoryObjectStore } from "../../testing/objectStore";
import { seedBaselineAuthCatalog } from "../auth/baselineCatalog";
import { createTokenVerifier } from "../auth/tokenVerifier";
import type { LogRecordDto } from "./types";
import { createRuleBasedLogAnalyzer } from "./analyzer";
import { processLogAnalysisJobById } from "./worker";
import { createLogWebhookDeliverer } from "./webhookDelivery";
import { provisionPublicationRuntimeLogins, dropLabRuntimeLogins } from "../../testing/labRuntimeLogins";
import type { LogDeletionPreview } from "../../../src/domain/logs/deletionPreview";

const available = await isTestDatabaseAvailable();
const home = "log-scope-home", target = "log-scope-target", secret = "log-scope-1374-test-only";
const uploadBody = { fileName: "scope.log", contentType: "text/plain", skillSelection: "generic",
  contentBase64: Buffer.from("INFO boot\nERROR target controller timeout\n").toString("base64") };
type Upload = { log: LogRecordDto; fileObject: { id: string; storageKey: string }; job: { id: string } };

function token(userId = "log-platform", organizationId = home) {
  const payload = Buffer.from(JSON.stringify({ iss: "log-scope", sub: userId, org: organizationId,
    exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

describe.skipIf(!available)("log operating organization over real HTTP and PostgreSQL (#1374)", () => {
  let fixture: Awaited<ReturnType<typeof createEphemeralTestDatabase>>, db: RootDatabase;
  const objectStore = createMemoryObjectStore();
  let server: ReturnType<typeof createWiseEffServer>;
  const request = <T,>(path: string, method = "GET", body?: unknown, bearer = token()) => requestJson<T>(server, path, {
    method, headers: { Authorization: `Bearer ${bearer}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  beforeAll(async () => {
    fixture = await createEphemeralTestDatabase("logscope1374"); db = createPostgresDatabase(fixture.url);
    await seedCoreGraph(db, { organization: { id: home }, users: [{ id: "log-platform" }, { id: "log-home-admin" }] });
    await seedCoreGraph(db, { organization: { id: target }, users: [{ id: "log-target-admin" }] });
    await seedBaselineAuthCatalog(db);
    await db.query(`insert into user_role_bindings(id,user_id,organization_id,role_id) values
      ('log-platform-role','log-platform',$1,'platform-admin'),('log-home-role','log-home-admin',$1,'admin'),
      ('log-target-role','log-target-admin',$2,'admin')`, [home, target]);
    server = createWiseEffServer({ db, objectStore, logAnalyzer: createRuleBasedLogAnalyzer(),
      logWebhooks: { allowInsecureLocal: true }, env: { AUTH_PROVIDER: "hmac" }, auth: { mode: "production",
      verifier: createTokenVerifier({ issuer: "log-scope", secret }) } });
  });
  afterAll(async () => { await db?.close(); await fixture?.drop(); });

  it("uploads and reads the explicit target while keeping the real Home actor and isolating mismatched objects", async () => {
    const own = await request<Upload>("/api/v1/log-files", "POST", uploadBody);
    expect(own.status, own.bodyText).toBe(201);
    const uploaded = await request<Upload>(`/api/v1/log-files?organizationId=${target}`, "POST", uploadBody);
    expect(uploaded.status, uploaded.bodyText).toBe(201);
    const rows = await db.query<{ organization_id: string; submitted_by_user_id: string; file_org: string; job_org: string }>(
      `select l.organization_id,l.submitted_by_user_id,f.organization_id file_org,j.organization_id job_org
       from log_records l join log_file_objects f on f.id=l.file_object_id
       join jobs j on j.target_id=l.current_run_id where l.id=$1`, [uploaded.body.log.id]);
    expect(rows.rows).toEqual([{ organization_id: target, submitted_by_user_id: "log-platform", file_org: target, job_org: target }]);
    expect(uploaded.body.fileObject.storageKey.startsWith(`${target}/`)).toBe(true);
    const listed = await request<{ items: LogRecordDto[] }>(`/api/v1/logs?organizationId=${target}`);
    expect(listed.status, listed.bodyText).toBe(200);
    expect(listed.body.items.map(item => item.id)).toEqual([uploaded.body.log.id]);
    expect((await request(`/api/v1/logs/${uploaded.body.log.id}?organizationId=${target}`)).status).toBe(200);
    expect((await request(`/api/v1/logs/${own.body.log.id}?organizationId=${target}`)).status).toBe(404);
    expect((await request(`/api/v1/logs/${uploaded.body.log.id}`)).status).toBe(404);
    expect((await request(`/api/v1/logs?organizationId=${target}`, "GET", undefined, token("log-home-admin"))).status).toBe(403);
    const audits = await db.query<{ organization_id: string; actor_user_id: string; actor_type: string }>(
      "select organization_id,actor_user_id,actor_type from audit_events where target_id=$1", [uploaded.body.log.id]);
    expect(audits.rows).toEqual([{ organization_id: target, actor_user_id: "log-platform", actor_type: "user" }]);
    expect((await db.query<{ organization_id: string }>("select organization_id from users where id='log-platform'")).rows[0].organization_id).toBe(home);
  });

  it("manages a target skill, its draft and sample without moving the actor or exposing another organization's skill", async () => {
    type Skill = { id: string; currentRevision: { id: string; spec: { schemaVersion: "skill/v1"; description?: string } } };
    const created = await request<{ item: Skill }>(`/api/v1/log-skills?organizationId=${target}`, "POST", { name: "Target skill" });
    expect(created.status, created.bodyText).toBe(201);
    const base = `/api/v1/log-skills/${created.body.item.id}`;
    const scoped = (suffix = "") => `${base}${suffix}?organizationId=${target}`;
    expect((await request(base)).status).toBe(404);
    const saved = await request<{ item: { id: string } }>(scoped("/draft"), "PUT", {
      spec: { ...created.body.item.currentRevision.spec, description: "Target revision" },
      baseDraftRevisionId: null, basePublishedRevisionId: created.body.item.currentRevision.id
    });
    expect(saved.status, saved.bodyText).toBe(200);
    const published = await request<{ item: Skill }>(scoped("/publish"), "POST", { draftRevisionId: saved.body.item.id });
    expect(published.status, published.bodyText).toBe(200);
    expect(published.body.item.currentRevision.spec.description).toBe("Target revision");
    const sample = await request(scoped("/sample"), "PUT", { fileName: "sample.log", contentBase64: uploadBody.contentBase64 });
    expect(sample.status, sample.bodyText).toBe(200);
    expect((await request<{ item: { content: string } }>(scoped("/sample"))).body.item.content).toContain("target controller");
    const listed = await request<{ items: Array<{ id: string }> }>(`/api/v1/log-skills?organizationId=${target}`);
    expect(listed.body.items.map(item => item.id)).toContain(created.body.item.id);
    expect((await request<{ items: Array<{ id: string }> }>("/api/v1/log-skills")).body.items.map(item => item.id)).not.toContain(created.body.item.id);
    expect((await request(scoped("/draft"), "PUT", { spec: { schemaVersion: "skill/v1" }, baseDraftRevisionId: null,
      basePublishedRevisionId: saved.body.item.id }, token("log-home-admin"))).status).toBe(403);
    const legacy = await request<{ item: { id: string } }>(`/api/v1/log-domains?organizationId=${target}`, "POST", { name: "Legacy target domain" });
    expect(legacy.status, legacy.bodyText).toBe(201);
    expect((await db.query<{ organization_id: string }>("select organization_id from log_domains where id=$1", [legacy.body.item.id])).rows[0].organization_id).toBe(target);
    const audits = await db.query<{ organization_id: string; actor_user_id: string }>(
      "select distinct organization_id,actor_user_id from audit_events where target_id=any($1::text[])", [ [created.body.item.id, legacy.body.item.id] ]);
    expect(audits.rows).toEqual([{ organization_id: target, actor_user_id: "log-platform" }]);
  });

  it("keeps source snapshots, analysis cases and trial runs in the skill's explicit organization", async () => {
    const skill = await request<{ item: { id: string } }>(`/api/v1/log-skills?organizationId=${target}`, "POST", { name: "Target trials", status: "draft" });
    const base = `/api/v1/log-skills/${skill.body.item.id}`;
    const scoped = (suffix: string) => `${base}${suffix}?organizationId=${target}`;
    const zip = new JSZip(); zip.file("main.c", "void boot(void) { printk(\"controller timeout\"); }\n");
    const bytes = await zip.generateAsync({ type: "nodebuffer" });
    const boundary = "log-scope-source-boundary";
    const multipart = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="versionLabel"\r\n\r\nv1374\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="source.zip"\r\nContent-Type: application/zip\r\n\r\n`), bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    const uploaded = await requestJson<{ item: { id: string; status: string } }>(server, scoped("/source-snapshots"), {
      method: "POST", headers: { Authorization: `Bearer ${token()}`, "Content-Type": `multipart/form-data; boundary=${boundary}` }, body: multipart
    });
    expect(uploaded.status, uploaded.bodyText).toBe(201);
    expect((await request<{ items: Array<{ id: string }> }>(scoped("/source-snapshots"))).body.items.map(item => item.id)).toEqual([uploaded.body.item.id]);
    expect((await request(`${base}/source-snapshots`)).status).toBe(404);
    const sample = await request(scoped("/sample"), "PUT", { fileName: "trial.log", contentBase64: uploadBody.contentBase64 });
    expect(sample.status, sample.bodyText).toBe(200);
    const created = await request<{ item: { id: string } }>(scoped("/analysis-cases"), "POST", { name: "Controller timeout",
      expectations: { domain: "generic", summary: "Controller timeout", realLog: false, rootCauseCategory: "communication-failure",
        rootCausePoints: ["Controller timeout"], keyEvidenceLines: [2], expectedActions: ["Inspect controller"], expectRefusal: false },
      files: [{ fileName: "trial.log", contentBase64: uploadBody.contentBase64 }] });
    expect(created.status, created.bodyText).toBe(201);
    expect((await request<{ items: Array<{ id: string }> }>(scoped("/analysis-cases"))).body.items.map(item => item.id)).toEqual([created.body.item.id]);
    expect((await request(`${base}/analysis-cases`)).status).toBe(404);
    const trial = await request<{ run: { id: string } }>(scoped("/dry-runs"), "POST", {});
    expect(trial.status, trial.bodyText).toBe(202);
    let state: { status: string } | undefined;
    for (let attempt = 0; attempt < 50; attempt++) {
      const response = await request<{ run: { status: string } }>(scoped(`/dry-runs/${trial.body.run.id}`));
      expect(response.status, response.bodyText).toBe(200); state = response.body.run;
      if (state.status !== "processing") break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(state?.status).toBe("complete");
    expect((await request(`${base}/dry-runs/${trial.body.run.id}`)).status).toBe(404);
    expect((await db.query("select distinct organization_id from log_source_snapshots where skill_id=$1", [skill.body.item.id])).rows).toEqual([{ organization_id: target }]);
    expect((await db.query("select distinct organization_id from log_skill_analysis_cases where skill_id=$1", [skill.body.item.id])).rows).toEqual([{ organization_id: target }]);
    expect((await db.query("select distinct organization_id from log_skill_dry_runs where skill_id=$1", [skill.body.item.id])).rows).toEqual([{ organization_id: target }]);
  });

  it("reads jobs and SSE in the fixed target and completes persisted work and callbacks after another Home request", async () => {
    const received: Array<{ recordId: string; productPath: string }> = [];
    const receiver = createServer((incoming, outgoing) => {
      let body = ""; incoming.on("data", chunk => { body += chunk.toString(); });
      incoming.on("end", () => { received.push(JSON.parse(body)); outgoing.writeHead(200); outgoing.end(); });
    });
    await new Promise<void>(resolve => receiver.listen(0, "127.0.0.1", resolve));
    const worker = createPostgresDatabase(fixture.url);
    try {
      const created = await request<{ item: { id: string } }>(`/api/v1/log-skills?organizationId=${target}`, "POST", { name: "Target callback" });
      const skillId = created.body.item.id;
      const config = await request(`/api/v1/log-domains/${skillId}/webhook?organizationId=${target}`, "PUT", {
        enabled: true, url: `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/callback`, secret: "log-scope-callback-secret-1374"
      });
      expect(config.status, config.bodyText).toBe(200);
      const uploaded = await request<Upload>(`/api/v1/log-files?organizationId=${target}`, "POST", {
        ...uploadBody, skillSelection: undefined, skillId
      });
      expect(uploaded.status, uploaded.bodyText).toBe(201);
      const id = uploaded.body.log.id, job = `/api/v1/jobs/${uploaded.body.job.id}`;
      expect((await request(`${job}?organizationId=${target}`)).status).toBe(200);
      expect((await request(job)).status).toBe(404);
      expect((await request(`${job}/events?organizationId=${home}`)).status).toBe(404);
      expect((await request(`${job}?organizationId=${target}`, "GET", undefined, token("log-home-admin"))).status).toBe(403);
      expect((await request("/api/v1/organization/operating-scope", "POST", { organizationId: home })).status).toBe(200);
      expect(await processLogAnalysisJobById({ db: worker, objectStore, jobId: uploaded.body.job.id })).toMatchObject({ status: "processed" });
      const callback = createLogWebhookDeliverer({ db: worker, env: { allowInsecureLocal: true, timeoutMs: 2000, maxAttempts: 2, retryBaseDelayMs: 1 } });
      expect(await callback.processNext()).toMatchObject({ status: "delivered" });
      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({ recordId: id });
      expect(new URL(received[0].productPath, "http://wiseeff.local").searchParams.get("organizationId")).toBe(target);
      expect((await worker.query<{ organization_id: string }>("select organization_id from log_webhook_outbox where log_record_id=$1", [id])).rows).toEqual([{ organization_id: target }]);
      expect((await worker.query<{ organization_id: string }>("select organization_id from log_webhook_deliveries where log_record_id=$1", [id])).rows).toEqual([{ organization_id: target }]);
      const events = await request(`${job}/events?organizationId=${target}`);
      expect(events.status, events.bodyText).toBe(200);
      expect(events.bodyText).toContain('"status":"complete"');
      const report = await request<{ item: LogRecordDto }>(`/api/v1/logs/${id}?organizationId=${target}`);
      expect(report.body.item).toMatchObject({ id, status: "complete", reportId: expect.any(String) });
      const lines = await request<{ item: { lines: Array<{ content: string }> } }>(`/api/v1/logs/${id}/lines?organizationId=${target}&file=scope.log&startLine=1&endLine=2`);
      expect(lines.status, lines.bodyText).toBe(200);
      expect(lines.body.item.lines.map(line => line.content)).toEqual(["INFO boot", "ERROR target controller timeout"]);
      for (const action of ["archive", "unarchive"]) expect((await request(`/api/v1/logs/${id}/${action}?organizationId=${target}`, "POST", {})).status).toBe(200);
      expect((await request(`/api/v1/logs/${id}/feedback?organizationId=${target}`, "POST", { rating: "helpful" })).status).toBe(200);
      expect((await request(`/api/v1/logs/${id}/rerun?organizationId=${target}`, "POST", {})).status).toBe(200);
      expect((await request<{ items: unknown[] }>(`/api/v1/logs/${id}/runs?organizationId=${target}`)).body.items).toHaveLength(2);
      expect((await request(`/api/v1/log-domains/${skillId}/webhook-deliveries?organizationId=${home}`)).status).toBe(404);
    } finally {
      await worker.close(); await new Promise<void>((resolve, reject) => receiver.close(error => error ? reject(error) : resolve()));
    }
  });

  it("keeps machine uploads fixed to the credential organization without borrowing human platform authority", async () => {
    const issued = await request<{ token: string }>("/api/v1/log-integration-credentials", "POST", { name: "Fixed Home machine", skillId: null });
    expect(issued.status, issued.bodyText).toBe(201);
    const foreign = await request(`/api/v1/log-files?organizationId=${target}`, "POST", uploadBody, issued.body.token);
    expect(foreign.status, foreign.bodyText).toBe(403);
    const own = await request<Upload>("/api/v1/log-files", "POST", uploadBody, issued.body.token);
    expect(own.status, own.bodyText).toBe(201);
    expect((await db.query<{ organization_id: string; submitted_by_user_id: string | null }>(
      "select organization_id,submitted_by_user_id from log_records where id=$1", [own.body.log.id])).rows).toEqual([{ organization_id: home, submitted_by_user_id: null }]);
    expect((await request(`/api/v1/logs/${own.body.log.id}?organizationId=${target}`, "GET", undefined, issued.body.token)).status).toBe(403);
    expect((await request(`/api/v1/jobs/${own.body.job.id}?organizationId=${target}`, "GET", undefined, issued.body.token)).status).toBe(403);
  });

  it("previews, erases and retries target logs and skills using an unprivileged API role and current stored platform authority", async () => {
    const runToken = `org1374${randomBytes(4).toString("hex")}`;
    let runtime: RootDatabase | undefined;
    try {
      runtime = createPostgresDatabase((await provisionPublicationRuntimeLogins(fixture.url, { mode: "lab", runToken })).apiUrl);
      expect((await runtime.query("select rolsuper from pg_roles where rolname=current_user")).rows[0]).toEqual({ rolsuper: false });
      const api = createWiseEffServer({ db: runtime, objectStore, env: { AUTH_PROVIDER: "hmac" },
        auth: { mode: "production", verifier: createTokenVerifier({ issuer: "log-scope", secret }) } });
      const call = <T,>(path: string, method = "GET", body?: unknown, bearer = token()) => requestJson<T>(api, path, {
        method, headers: { Authorization: `Bearer ${bearer}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      const upload = await call<Upload>(`/api/v1/log-files?organizationId=${target}`, "POST", uploadBody);
      expect(upload.status, upload.bodyText).toBe(201);
      const id = upload.body.log.id, path = `/api/v1/logs/${id}`;
      const preview = await call<{ item: LogDeletionPreview }>(`${path}/deletion-preview?organizationId=${target}`);
      expect(preview.status, preview.bodyText).toBe(200);
      expect(preview.body.item.organizationId).toBe(target);
      expect((await call(`${path}/deletion-preview?organizationId=${target}`, "GET", undefined, token("log-home-admin"))).status).toBe(403);
      await expect(runtime.query("select parameter_catalog.lock_log_erasure($1,$2,$3)", [target, id, "log-home-admin"])).rejects.toMatchObject({ code: "42501" });
      const erased = await call<{ item: { database: string; objects: string } }>(`${path}?organizationId=${target}`, "DELETE", { version: preview.body.item.version });
      expect(erased.status, erased.bodyText).toBe(200);
      expect(erased.body.item).toMatchObject({ database: "deleted", objects: "complete" });
      expect((await call(`${path}?organizationId=${target}`, "DELETE", { version: preview.body.item.version })).status).toBe(200);
      expect((await call(`${path}/deletion-status?organizationId=${target}`)).status).toBe(200);
      expect((await call(`${path}/deletion-status`)).status).toBe(404);
      const draft = await call<{ item: { id: string } }>(`/api/v1/log-skills?organizationId=${target}`, "POST", { name: "Target disposable draft", status: "draft" });
      expect(draft.status, draft.bodyText).toBe(201);
      const skillPath = `/api/v1/log-skills/${draft.body.item.id}`;
      const skillPreview = await call<{ item: { version: string; canDelete: boolean } }>(`${skillPath}/deletion-preview?organizationId=${target}`);
      expect(skillPreview.status, skillPreview.bodyText).toBe(200);
      expect(skillPreview.body.item.canDelete).toBe(true);
      const removed = await call(`${skillPath}/purge?organizationId=${target}`, "POST", { version: skillPreview.body.item.version });
      expect(removed.status, removed.bodyText).toBe(200);
      expect((await call(`${skillPath}/deletion-status?organizationId=${target}`)).status).toBe(200);
      expect((await call(`${skillPath}/purge?organizationId=${target}`, "POST", { version: skillPreview.body.item.version })).status).toBe(200);
      expect((await db.query("select id from log_records where id=$1", [id])).rows).toEqual([]);
      expect((await db.query<{ organization_id: string; actor_user_id: string }>(
        "select distinct organization_id,actor_user_id from audit_events where target_id=any($1::text[])", [[id, draft.body.item.id]])).rows)
        .toEqual([{ organization_id: target, actor_user_id: "log-platform" }]);
      await db.query("update user_role_bindings set role_id='admin' where id='log-platform-role'");
      expect((await call(`${path}/deletion-status?organizationId=${target}`)).status).toBe(403);
      await expect(runtime.query("select parameter_catalog.lock_log_erasure($1,$2,$3)", [target, id, "log-platform"])).rejects.toMatchObject({ code: "42501" });
    } finally {
      await db.query("update user_role_bindings set role_id='platform-admin' where id='log-platform-role'");
      await runtime?.close(); await dropLabRuntimeLogins(fixture.url, runToken);
    }
  }, 120_000);

  it("links and imports skill knowledge in the explicit target through the existing portable package workflow", async () => {
    const entry = await request<{ item: { id: string } }>("/api/v1/knowledge/entries", "POST", {
      title: "Target controller guidance", tags: [], contentForm: "markdown", contentMarkdown: "Inspect the target controller timeout."
    }, token("log-target-admin", target));
    expect(entry.status, entry.bodyText).toBe(201);
    expect((await request(`/api/v1/knowledge/entries/${entry.body.item.id}/publish`, "POST", {}, token("log-target-admin", target))).status).toBe(200);
    const skill = await request<{ item: { id: string } }>(`/api/v1/log-skills?organizationId=${target}`, "POST", { name: "Target portable skill" });
    const linked = await request(`/api/v1/log-domains/${skill.body.item.id}/knowledge-links?organizationId=${target}`, "PUT", { knowledgeEntryIds: [entry.body.item.id] });
    expect(linked.status, linked.bodyText).toBe(200);
    const links = await request<{ items: Array<{ knowledgeEntryId: string }> }>(`/api/v1/log-domains/${skill.body.item.id}/knowledge-links?organizationId=${target}`);
    expect(links.body.items.map(item => item.knowledgeEntryId)).toEqual([entry.body.item.id]);
    let bytes: Buffer;
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/log-skills/${skill.body.item.id}/package?organizationId=${target}`, {
        headers: { Authorization: `Bearer ${token()}` }
      });
      expect(response.status).toBe(200); bytes = Buffer.from(await response.arrayBuffer());
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
    const boundary = "log-scope-package-boundary";
    const multipart = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\nImported target portable skill\r\n--${boundary}\r\nContent-Disposition: form-data; name="status"\r\n\r\ndraft\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="skill.zip"\r\nContent-Type: application/zip\r\n\r\n`), bytes!, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    const imported = await requestJson<{ item: { id: string; currentRevision: { spec: { knowledgeEntryIds: string[] } } } }>(server,
      `/api/v1/log-skills/import?organizationId=${target}`, { method: "POST",
        headers: { Authorization: `Bearer ${token()}`, "Content-Type": `multipart/form-data; boundary=${boundary}` }, body: multipart });
    expect(imported.status, imported.bodyText).toBe(201);
    const importedId = imported.body.item.currentRevision.spec.knowledgeEntryIds[0];
    expect(importedId).not.toBe(entry.body.item.id);
    expect((await db.query<{ organization_id: string; created_by_user_id: string; status: string }>(
      "select organization_id,created_by_user_id,status from knowledge_entries where id=$1", [importedId])).rows)
      .toEqual([{ organization_id: target, created_by_user_id: "log-platform", status: "draft" }]);
    expect((await request(`/api/v1/log-skills/${imported.body.item.id}`)).status).toBe(404);
  });
});
