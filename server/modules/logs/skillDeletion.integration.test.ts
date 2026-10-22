import { mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import JSZip from "jszip";
import { createWiseEffServer } from "../../app";
import { createPostgresDatabase } from "../../shared/database/client";
import { applyMigrations } from "../../shared/database/migrations";
import { requestJson } from "../../test/testClient";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import { createLocalObjectStore, type ObjectStore } from "./objectStore";
import type { getLogSkill } from "./skillsService";
import type { SkillDeletionPreview, SkillDeletionStatus } from "../contracts/dtoSchemas/skillDeletion";
import { makeTestAuthContext } from "../../testing/authContext";
import { createUserInvocation } from "../auth/trustedInvocation";
import { createDefaultKnowledgeTextExtractor } from "../knowledge/extraction";
import { createKnowledgeEntry, publishKnowledgeEntry } from "../knowledge/service";
import { exportLogSkillPackage } from "./skillPackages";
import { processNextSourceIndexJob } from "./sourceIndexWorker";
import { startSkillDryRun } from "./dryRuns";
import { createAnalysisCase, startAnalysisCaseRun } from "./analysisCases";
import { activeDryRunWork } from "./dryRunAdmission";
import { processLogAnalysisJobById } from "./worker";
import { getLogWorkerRunSnapshot } from "./repository";
import type { LogRecordDto } from "./types";
import { createRuleBasedLogAnalyzer, genericSignalRuleSet } from "./analyzer";
import { dropLabRuntimeLogins, provisionPublicationRuntimeLogins } from "../../testing/labRuntimeLogins";

type Skill = Awaited<ReturnType<typeof getLogSkill>>;
describe("archived skill deletion HTTP", () => {
  let database: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>;
  let directory: string;
  let store: ObjectStore;
  beforeAll(async () => {
    database = await createEphemeralTestDatabase("skill-deletion"); db = createPostgresDatabase(database.url);
    directory = await mkdtemp(join(tmpdir(), "wiseeff-skill-delete-")); store = createLocalObjectStore(directory);
    for (const organizationId of ["skill-delete", "skill-delete-other"]) {
      await seedCoreGraph(db, { organization: { id: organizationId }, users: [{ id: `${organizationId}-admin` }] });
      await db.query(`insert into user_role_bindings(id,user_id,organization_id,project_id,role_id)
        values($1,$2,$3,null,'admin')`, [`${organizationId}-role`, `${organizationId}-admin`, organizationId]);
    }
    await db.query("insert into users(id,organization_id,name,title,is_active) values('skill-delete-member','skill-delete','Member','Member',true)");
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('skill-delete-member-role','skill-delete-member','skill-delete','software-user')");
  });
  afterAll(async () => { await db?.close(); await database?.drop(); if (directory) await rm(directory, { recursive: true, force: true }); });
  const request = <T = unknown>(path: string, method = "GET", body?: unknown, userId = "skill-delete-admin", objectStore = store) =>
    requestJson<T>(createWiseEffServer({ db, objectStore }), path, { method, headers: { "X-WiseEff-User": userId },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const create = async (name: string, status: "draft" | "published" = "draft") => {
    const response = await request<{ item: Skill }>("/api/v1/log-skills", "POST", { name, status });
    expect(response.status, response.bodyText).toBe(201); return response.body.item;
  };
  const auth = makeTestAuthContext({ organizationId: "skill-delete", userId: "skill-delete-admin", roles: [{ roleId: "admin", projectId: null }],
    permissions: ["logs:view", "logs:admin-domains", "knowledge:view", "knowledge:edit"] });
  const archive = async (id: string) => {
    const result = await request(`/api/v1/log-domains/${id}/archive`, "POST");
    expect(result.status, result.bodyText).toBe(200);
  };
  const preview = async (id: string, archived = true) => {
    if (archived) await archive(id);
    const result = await request<{ item: SkillDeletionPreview }>(`/api/v1/log-skills/${id}/deletion-preview`);
    expect(result.status, result.bodyText).toBe(200); return result.body.item;
  };
  const purge = (id: string, version: string, objectStore = store) => request<{ item: SkillDeletionStatus }>(`/api/v1/log-skills/${id}/purge`, "POST", { version }, "skill-delete-admin", objectStore);
  const sample = async (id: string, text = "INFO sample\nERROR issue\n") => {
    const result = await request(`/api/v1/log-skills/${id}/sample`, "PUT", { fileName: "sample.log", contentBase64: Buffer.from(text).toString("base64") });
    expect(result.status, result.bodyText).toBe(200);
  };

  it("creates an explicit unpublished initial draft while preserving the legacy default", async () => {
    const draft = await create("Explicit initial experiment");
    expect(draft).toMatchObject({ currentRevision: { status: "draft", publishedAt: null }, draft: { id: draft.currentRevision.id } });
    const legacy = await request<{ item: Skill }>("/api/v1/log-skills", "POST", { name: "Legacy published create" });
    expect(legacy.status).toBe(201);
    expect(legacy.body.item.currentRevision.status).toBe("published");
  });
  it("previews and deletes a clean initial draft, frees its name/key and keeps an idempotent receipt", async () => {
    const skill = await create("Delete clean experiment");
    await archive(skill.id);
    const preview = await request<{ item: SkillDeletionPreview }>(`/api/v1/log-skills/${skill.id}/deletion-preview`);
    expect(preview.status, preview.bodyText).toBe(200);
    expect(preview.body.item.canDelete).toBe(true);
    const purge = () => request<{ item: SkillDeletionStatus }>(`/api/v1/log-skills/${skill.id}/purge`, "POST", { version: preview.body.item.version });
    const deleted = await purge();
    expect(deleted.status, deleted.bodyText).toBe(200);
    expect(deleted.body.item).toMatchObject({ database: "deleted", objects: "complete", pendingObjects: 0 });
    expect((await request(`/api/v1/log-skills/${skill.id}`)).status).toBe(404);
    expect((await purge()).body.item).toEqual(deleted.body.item);
    const recreated = await create(skill.name);
    expect(recreated.id).not.toBe(skill.id);
    expect(recreated.skillKey).toBe(skill.skillKey);
    expect((await db.query("select id from audit_events where target_id=$1 and kind='skill-experiment-purged'", [skill.id])).rows).toHaveLength(1);
    await expect(db.query("update log_domains set id=$1 where id=$2", [skill.id, recreated.id])).rejects.toThrow("Deleted experiment skill identity");
  });
  it("clears imported initial drafts, private tests, old samples and source indices while retaining shared knowledge and bytes", async () => {
    const original = await create("Portable experiment");
    const bytes = await exportLogSkillPackage(db, store, auth, original.id, "draft");
    const form = new FormData(); form.append("file", new Blob([new Uint8Array(bytes)]), "experiment.zip"); form.append("status", "draft"); form.append("name", "Imported experiment");
    const encoded = new Request("http://fixture", { method: "POST", body: form });
    const imported = await requestJson<{ item: Skill }>(createWiseEffServer({ db, objectStore: store }), "/api/v1/log-skills/import", {
      method: "POST", headers: { "X-WiseEff-User": auth.user.id, "Content-Type": encoded.headers.get("content-type")! }, body: await encoded.arrayBuffer() });
    expect(imported.status, imported.bodyText).toBe(201); const skill = imported.body.item;
    await sample(skill.id, "old private sample"); await sample(skill.id, "new shared sample");
    const keys = (await db.query<{ object_key: string }>("select object_key from log_skill_artifact_objects where skill_id=$1 order by created_at", [skill.id])).rows.map(r => r.object_key);
    expect(keys).toHaveLength(2);
    const other = await create("Shared byte keeper");
    await sample(other.id);
    await db.query("update log_skill_samples set object_key=$1 where skill_id=$2", [keys[1], other.id]);
    const entry = await createKnowledgeEntry(db, store, createDefaultKnowledgeTextExtractor(), auth, { contentForm: "markdown", title: "Shared experiment guidance", tags: [], contentMarkdown: "Retained knowledge." }, { requestId: "knowledge" });
    await publishKnowledgeEntry(db, auth, entry.id, { requestId: "knowledge-publish" });
    await db.query(`insert into log_domain_knowledge_links(id,organization_id,log_domain_id,knowledge_entry_id,created_by_user_id) values($1,$2,$3,$4,$5)`, [randomUUID(), auth.organization.id, skill.id, entry.id, auth.user.id]);
    const snapshotId = randomUUID(); const raw = await store.put({ organizationId: auth.organization.id, fileName: "source.zip", contentType: "application/zip", bytes: Buffer.from("private-source") });
    await db.query(`insert into log_source_snapshots(id,organization_id,skill_id,version_label,storage_key,file_name,status) values($1,$2,$3,'v1',$4,'source.zip','ready')`, [snapshotId, auth.organization.id, skill.id, raw.storageKey]);
    const fileId = randomUUID(); await db.query(`insert into log_source_files(id,organization_id,snapshot_id,path,size_bytes,sha256,line_count,language) values($1,$2,$3,'main.c',4,'hash',1,'c')`, [fileId, auth.organization.id, snapshotId]);
    await db.query(`insert into log_source_chunks(id,organization_id,snapshot_id,file_id,start_line,end_line,content) values($1,$2,$3,$4,1,1,'private source')`, [randomUUID(), auth.organization.id, snapshotId, fileId]);
    const before = await preview(skill.id); expect(before.objects).toEqual({ total: 3, shared: 1, exclusive: 2 });
    expect(before.inventory).toContainEqual(expect.objectContaining({ key: "knowledge", count: 1, disposition: "retain" }));
    expect((await purge(skill.id, before.version)).body.item).toMatchObject({ objects: "complete", retainedObjects: 1 });
    await expect(store.get(keys[0])).rejects.toThrow(); await expect(store.get(raw.storageKey)).rejects.toThrow();
    expect((await store.get(keys[1])).toString()).toBe("new shared sample");
    expect((await db.query("select id from knowledge_entries where id=$1", [entry.id])).rows).toHaveLength(1);
    expect((await db.query("select id from knowledge_revisions where entry_id=$1", [entry.id])).rows.length).toBeGreaterThan(0);
    expect((await db.query("select id from log_source_chunks where snapshot_id=$1", [snapshotId])).rows).toHaveLength(0);
  });
  it("commits a durable pending receipt on object failure, rechecks new shared references and safely resumes after reload", async () => {
    const skill = await create("Cleanup retry experiment"); await sample(skill.id);
    const key = (await db.query<{ object_key: string }>("select object_key from log_skill_samples where skill_id=$1", [skill.id])).rows[0]!.object_key;
    const before = await preview(skill.id); const failing = { ...store, delete: async () => { throw new Error("storage offline"); } };
    const first = await purge(skill.id, before.version, failing);
    expect(first.status, first.bodyText).toBe(200); expect(first.body.item).toMatchObject({ database: "deleted", objects: "pending", pendingObjects: 1 });
    expect((await request<{ item: SkillDeletionStatus }>(`/api/v1/log-skills/${skill.id}/deletion-status`)).body.item).toEqual(first.body.item);
    expect((await request<{ items: SkillDeletionStatus[] }>("/api/v1/log-skills/deletions")).body.items).toContainEqual(first.body.item);
    const other = await create("Retry shared byte keeper"); await sample(other.id);
    await db.query("update log_skill_samples set object_key=$1 where skill_id=$2", [key, other.id]);
    const deletion = vi.fn(store.delete!.bind(store));
    const retry = await purge(skill.id, before.version, { ...store, delete: deletion });
    expect(retry.body.item).toMatchObject({ objects: "complete", pendingObjects: 0, retainedObjects: 1 }); expect(deletion).not.toHaveBeenCalled();
    expect(await store.get(key)).toBeInstanceOf(Buffer);
    expect((await purge(skill.id, "a".repeat(64))).status).toBe(409);
  });
  it("rejects stale confirmations, active skills, cross-tenant and nonadministrator requests", async () => {
    const skill = await create("Restricted experiment"); const before = await preview(skill.id); await sample(skill.id);
    expect((await purge(skill.id, before.version)).status).toBe(409);
    for (const user of ["skill-delete-member", "skill-delete-other-admin"]) {
      const view = await request(`/api/v1/log-skills/${skill.id}/deletion-preview`, "GET", undefined, user);
      expect([403, 404]).toContain(view.status);
      expect([403, 404]).toContain((await request(`/api/v1/log-skills/${skill.id}/purge`, "POST", { version: before.version }, user)).status);
    }
    const published = await create("Published must archive", "published");
    const historical = await request<{ log: { id: string } }>("/api/v1/log-files", "POST", { fileName: "historical.log", contentType: "text/plain",
      contentBase64: Buffer.from("INFO historical analysis\n").toString("base64"), skillId: published.id });
    expect(historical.status, historical.bodyText).toBe(201);
    const blocked = await preview(published.id, false); expect(blocked.canDelete).toBe(false);
    expect(blocked.blockers).toContainEqual({ code: "active", count: 1, message: "请先归档技能，再彻底删除。" });
    expect((await purge(published.id, blocked.version)).status).toBe(409);
    expect((await request(`/api/v1/log-skills/${published.id}`)).status).toBe(200);
    expect((await db.query("select id from log_analysis_runs where log_record_id=$1", [historical.body.log.id])).rows).toHaveLength(1);
    const bound = await create("Externally bound experiment");
    await db.query(`insert into log_integration_credentials(id,organization_id,name,skill_id,secret_hash,status,revoked_at)
      values($1,$2,'Historical credential',$3,$4,'revoked',now())`, [randomUUID(), auth.organization.id, bound.id, "a".repeat(64)]);
    const external = await preview(bound.id); expect(external.canDelete).toBe(true);
    expect(external.inventory).toContainEqual(expect.objectContaining({ key: "credentials", count: 1, disposition: "delete" }));
    expect((await purge(bound.id, external.version)).status).toBe(200);
  });
  it("purges a published used archived skill, preserving readable reports and shared source snapshots", async () => {
    const skill = await create("Published historical skill", "published");
    const uploaded = await request<{ log: LogRecordDto; job: { id: string; runId: string } }>("/api/v1/log-files", "POST", {
      fileName: "historical.log", contentType: "text/plain", contentBase64: Buffer.from("INFO boot\nERROR issue\n").toString("base64"), skillId: skill.id
    });
    expect(uploaded.status, uploaded.bodyText).toBe(201);
    expect(await processLogAnalysisJobById({ db, objectStore: store, jobId: uploaded.body.job.id,
      analyzer: createRuleBasedLogAnalyzer(genericSignalRuleSet) })).toEqual({ status: "processed" });
    const logId = uploaded.body.log.id;
    const beforeReport = await request<{ item: LogRecordDto }>(`/api/v1/logs/${logId}`);
    expect(beforeReport.body.item).toMatchObject({ status: "complete", skillNameSnapshot: skill.name,
      skillRevisionNumberSnapshot: skill.currentRevision.number });
    // Exercise the purge backfill for records created before snapshot columns existed.
    await db.query("update log_records set skill_name_snapshot=null where id=$1", [logId]);
    await db.query("update log_analysis_runs set skill_name_snapshot=null,skill_revision_number_snapshot=null where log_record_id=$1", [logId]);
    const snapshots: Array<{ id: string; key: string }> = [];
    for (const label of ["exclusive", "shared"]) {
      const raw = await store.put({ organizationId: auth.organization.id, fileName: `${label}.zip`, contentType: "application/zip", bytes: Buffer.from(label) });
      const id = randomUUID(); snapshots.push({ id, key: raw.storageKey });
      await db.query(`insert into log_source_snapshots(id,organization_id,skill_id,version_label,storage_key,file_name,status)
        values($1,$2,$3,$4,$5,'source.zip','ready')`, [id, auth.organization.id, skill.id, label, raw.storageKey]);
      await db.query(`insert into log_source_files(id,organization_id,snapshot_id,path,size_bytes,sha256,line_count,language)
        values($1,$2,$3,'main.c',4,'hash',1,'c')`, [randomUUID(), auth.organization.id, id]);
    }
    const [exclusive, shared] = snapshots;
    const other = await create("Shared source consumer");
    await db.query(`update log_skill_revisions set spec=jsonb_set(spec,'{defaultSourceSnapshotId}',to_jsonb($1::text))
      where organization_id=$2 and skill_id=$3 and status='draft'`, [shared!.id, auth.organization.id, other.id]);
    await db.query("update log_analysis_runs set source_snapshot_id=$1,source_snapshot_status='ready' where log_record_id=$2", [exclusive!.id, logId]);
    await db.query("update log_evidence set source_snapshot_id=$1,source_path='main.c',source_line=1 where log_record_id=$2", [exclusive!.id, logId]);
    const credentialId = randomUUID();
    await db.query(`insert into log_integration_credentials(id,organization_id,name,skill_id,secret_hash)
      values($1,$2,'Bound credential',$3,$4)`, [credentialId, auth.organization.id, skill.id, "b".repeat(64)]);
    await db.query("update log_records set submitted_by_user_id=null,created_by_credential_id=$1 where id=$2", [credentialId, logId]);
    await db.query(`update log_file_objects set uploaded_by_user_id=null,created_by_credential_id=$1
      where id=(select file_object_id from log_records where id=$2)`, [credentialId, logId]);
    await db.query(`insert into log_webhook_deliveries(id,organization_id,log_domain_id,log_record_id,run_id,kind,attempt,status)
      values($1,$2,$3,$4,$5,'result',1,'delivered')`, [randomUUID(), auth.organization.id, skill.id, logId, uploaded.body.job.runId]);
    const confirmed = await preview(skill.id);
    expect(confirmed.canDelete).toBe(true);
    expect(confirmed.inventory).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "shared-snapshots", count: 1, disposition: "retain" }),
      expect.objectContaining({ key: "snapshots", count: 1, disposition: "delete" }),
      expect.objectContaining({ key: "logs", count: 1, disposition: "retain" }),
      expect.objectContaining({ key: "runs", count: 1, disposition: "retain" }),
      expect.objectContaining({ key: "deliveries", count: 1, disposition: "delete" })
    ]));
    expect(confirmed.objects).toEqual({ total: 2, exclusive: 1, shared: 1 });
    const removed = await purge(skill.id, confirmed.version);
    expect(removed.status, removed.bodyText).toBe(200);
    expect(removed.body.item).toMatchObject({ database: "deleted", objects: "complete", retainedObjects: 1 });
    const report = await request<{ item: LogRecordDto }>(`/api/v1/logs/${logId}`);
    expect(report.status, report.bodyText).toBe(200);
    expect(report.body.item).toMatchObject({ status: "complete", conclusion: beforeReport.body.item.conclusion,
      skillNameSnapshot: skill.name, skillRevisionNumberSnapshot: skill.currentRevision.number, skillRevision: null });
    expect(report.body.item.logDomainId).toBeUndefined();
    expect(report.body.item.evidence).toHaveLength(beforeReport.body.item.evidence.length);
    const runs = await request<{ items: Array<{ skillNameSnapshot: string; skillRevisionNumberSnapshot: number }> }>(`/api/v1/logs/${logId}/runs`);
    expect(runs.status, runs.bodyText).toBe(200);
    expect(runs.body.items).toContainEqual(expect.objectContaining({ skillNameSnapshot: skill.name, skillRevisionNumberSnapshot: skill.currentRevision.number }));
    expect((await db.query("select id from log_skill_revisions where skill_id=$1", [skill.id])).rows).toHaveLength(0);
    expect((await db.query("select id from log_integration_credentials where skill_id=$1", [skill.id])).rows).toHaveLength(0);
    expect((await db.query("select id from log_webhook_deliveries where log_domain_id=$1", [skill.id])).rows).toHaveLength(0);
    expect((await db.query("select skill_id from log_source_snapshots where id=$1", [shared!.id])).rows).toEqual([{ skill_id: null }]);
    expect((await db.query("select id from log_source_files where snapshot_id=$1", [shared!.id])).rows).toHaveLength(1);
    expect(await store.get(shared!.key)).toEqual(Buffer.from("shared"));
    await expect(store.get(exclusive!.key)).rejects.toThrow();
    const publishedConsumer = await request<{ item: Skill }>(`/api/v1/log-skills/${other.id}/publish`, "POST", { draftRevisionId: other.currentRevision.id });
    expect(publishedConsumer.status, publishedConsumer.bodyText).toBe(200);
    const consumerLog = await request<{ job: { id: string } }>("/api/v1/log-files", "POST", {
      fileName: "consumer.log", contentType: "text/plain", contentBase64: Buffer.from("ERROR consumer\n").toString("base64"), skillId: other.id
    });
    expect(consumerLog.status, consumerLog.bodyText).toBe(201);
    expect((await getLogWorkerRunSnapshot(db, consumerLog.body.job.id))?.sourceSnapshot).toMatchObject({ id: shared!.id, status: "ready" });
    const consumerRevision = publishedConsumer.body.item.currentRevision;
    expect((await request(`/api/v1/log-skills/${other.id}/draft`, "PUT", { spec: consumerRevision.spec,
      baseDraftRevisionId: null, basePublishedRevisionId: consumerRevision.id })).status).toBe(200);
    await sample(other.id);
    const analyze = vi.fn(createRuleBasedLogAnalyzer(genericSignalRuleSet).analyze);
    const consumerDryRun = await startSkillDryRun(db, store, { analyze }, auth, other.id);
    await vi.waitFor(() => expect(activeDryRunWork.has(consumerDryRun.run.id)).toBe(false));
    const dryRunSnapshot = analyze.mock.calls[0]?.[0].sourceSnapshot;
    analyze.mockClear();
    const consumerCase = await createAnalysisCase(db, store, auth, other.id, { name: "Shared source case", expectations: {
      domain: "generic", summary: "Issue", realLog: false, rootCauseCategory: "software-fault", rootCausePoints: ["Issue"],
      keyEvidenceLines: [2], expectedActions: ["Inspect issue"], expectRefusal: false },
      files: [{ fileName: "case.log", bytes: Buffer.from("INFO sample\nERROR issue\n") }] }, createUserInvocation(auth), { requestId: "shared-case" });
    const consumerCaseRun = await startAnalysisCaseRun(db, store, { analyze }, auth, other.id, [consumerCase.id], createUserInvocation(auth), { requestId: "shared-case-run" });
    await vi.waitFor(() => expect(activeDryRunWork.has(consumerCaseRun.run.id)).toBe(false));
    expect(analyze).toHaveBeenCalled();
    for (const [input] of analyze.mock.calls) expect(input.sourceSnapshot).toEqual({ id: shared!.id, status: "ready" });
    expect(dryRunSnapshot).toEqual({ id: shared!.id, status: "ready" });
    const audit = (await db.query<{ metadata: { inventory: unknown[] } }>("select metadata from audit_events where target_id=$1 and kind='skill-experiment-purged'", [skill.id])).rows[0]!;
    expect(audit.metadata.inventory).toEqual(confirmed.inventory);
    // A later generic rerun must not inherit the deleted skill's historical label.
    const rerun = await request<{ log: LogRecordDto }>(`/api/v1/logs/${logId}/rerun`, "POST", { revisionPolicy: "current" });
    expect(rerun.status, rerun.bodyText).toBe(200);
    expect(rerun.body.log.skillNameSnapshot).toBeUndefined();
    expect((await request<{ items: Array<{ skillNameSnapshot?: string }> }>(`/api/v1/logs/${logId}/runs`)).body.items)
      .toContainEqual(expect.objectContaining({ skillNameSnapshot: skill.name }));
  });
  it("keeps generic historical runs unattributed when a later skilled run is purged", async () => {
    const skill = await create("Later skill attribution", "published");
    const uploaded = await request<{ log: LogRecordDto; job: { id: string; runId: string } }>("/api/v1/log-files", "POST", {
      fileName: "generic.log", contentType: "text/plain", contentBase64: Buffer.from("INFO boot\nERROR issue\n").toString("base64"), skillSelection: "generic"
    });
    expect(uploaded.status, uploaded.bodyText).toBe(201);
    const analyzer = createRuleBasedLogAnalyzer(genericSignalRuleSet);
    await processLogAnalysisJobById({ db, objectStore: store, jobId: uploaded.body.job.id, analyzer });
    const rerun = await request<{ job: { id: string; runId: string } }>(`/api/v1/logs/${uploaded.body.log.id}/rerun`, "POST", { skillId: skill.id, revisionPolicy: "current" });
    expect(rerun.status, rerun.bodyText).toBe(200);
    await processLogAnalysisJobById({ db, objectStore: store, jobId: rerun.body.job.id, analyzer });
    await db.query("update log_analysis_runs set skill_name_snapshot=null,skill_revision_number_snapshot=null where log_record_id=$1", [uploaded.body.log.id]);
    const confirmed = await preview(skill.id);
    expect((await purge(skill.id, confirmed.version)).status).toBe(200);
    const history = await request<{ items: Array<{ id: string; skillNameSnapshot?: string; skillRevisionNumberSnapshot?: number }> }>(`/api/v1/logs/${uploaded.body.log.id}/runs`);
    expect(history.body.items.find(run => run.id === uploaded.body.job.runId)).toEqual(expect.objectContaining({ id: uploaded.body.job.runId }));
    expect(history.body.items.find(run => run.id === uploaded.body.job.runId)?.skillNameSnapshot).toBeUndefined();
    expect(history.body.items.find(run => run.id === uploaded.body.job.runId)?.skillRevisionNumberSnapshot).toBeUndefined();
    expect(history.body.items.find(run => run.id === rerun.body.job.runId)).toMatchObject({ skillNameSnapshot: skill.name, skillRevisionNumberSnapshot: skill.currentRevision.number });
  });
  it("blocks queued and running production analyses without detaching execution inputs", async () => {
    const skill = await create("Production deletion coordination");
    const snapshotId = randomUUID();
    const raw = await store.put({ organizationId: auth.organization.id, fileName: "running.zip", contentType: "application/zip", bytes: Buffer.from("source") });
    await db.query(`insert into log_source_snapshots(id,organization_id,skill_id,version_label,storage_key,file_name,status)
      values($1,$2,$3,'running',$4,'source.zip','ready')`, [snapshotId, auth.organization.id, skill.id, raw.storageKey]);
    await db.query(`update log_skill_revisions set spec=jsonb_set(spec,'{defaultSourceSnapshotId}',to_jsonb($1::text))
      where organization_id=$2 and skill_id=$3 and status='draft'`, [snapshotId, auth.organization.id, skill.id]);
    expect((await request(`/api/v1/log-skills/${skill.id}/publish`, "POST", { draftRevisionId: skill.currentRevision.id })).status).toBe(200);
    const uploads = [];
    for (let index = 0; index < 2; index++) {
      const upload = await request<{ log: LogRecordDto; job: { id: string; runId: string } }>("/api/v1/log-files", "POST", {
        fileName: `running-${index}.log`, contentType: "text/plain", contentBase64: Buffer.from("INFO boot\nERROR issue\n").toString("base64"), skillId: skill.id
      });
      expect(upload.status, upload.bodyText).toBe(201); uploads.push(upload.body);
    }
    const queued = await preview(skill.id);
    expect(queued.blockers).toContainEqual({ code: "analyses-in-progress", count: 2, message: "有 2 个分析仍在进行，完成后再删除。" });
    expect(queued.canDelete).toBe(false);
    const refused = await purge(skill.id, queued.version);
    expect(refused.status).toBe(409);
    expect(refused.bodyText).toContain("有 2 个分析仍在进行，完成后再删除。");
    expect((await db.query("select skill_revision_id from log_analysis_runs where id=$1", [uploads[0].job.runId])).rows[0])
      .toMatchObject({ skill_revision_id: skill.currentRevision.id });
    const rules = createRuleBasedLogAnalyzer(genericSignalRuleSet);
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; }); const held = new Promise<void>(resolve => { release = resolve; });
    const worker = processLogAnalysisJobById({ db, objectStore: store, jobId: uploads[0].job.id, analyzer: { analyze: async input => {
      expect(input.sourceSnapshot?.id).toBe(snapshotId); entered(); await held; return rules.analyze(input);
    } } });
    await started;
    try {
      const running = await preview(skill.id, false);
      expect(running.blockers).toContainEqual(expect.objectContaining({ code: "analyses-in-progress", count: 2 }));
      expect((await purge(skill.id, running.version)).status).toBe(409);
      expect((await getLogWorkerRunSnapshot(db, uploads[0].job.id))?.sourceSnapshot?.id).toBe(snapshotId);
    } finally { release(); }
    expect(await worker).toEqual({ status: "processed" });
    expect(await processLogAnalysisJobById({ db, objectStore: store, jobId: uploads[1].job.id, analyzer: rules })).toEqual({ status: "processed" });
    // Either side of an inconsistent job/run terminal transition must still block deletion.
    await db.query("update log_analysis_runs set status='queued' where id=$1", [uploads[0].job.runId]);
    expect((await preview(skill.id, false)).canDelete).toBe(false);
    await db.query("update log_analysis_runs set status='complete' where id=$1", [uploads[0].job.runId]);
    const idle = await preview(skill.id, false);
    expect(idle.canDelete).toBe(true);
    await db.query("update jobs set status='queued' where id=$1", [uploads[0].job.id]);
    expect((await preview(skill.id, false)).canDelete).toBe(false);
    expect((await purge(skill.id, idle.version)).status).toBe(409);
    await db.query("update jobs set status='complete' where id=$1", [uploads[0].job.id]);
    const finished = await preview(skill.id, false);
    expect(finished.canDelete).toBe(true);
    expect((await purge(skill.id, finished.version)).status).toBe(200);
  });
  it("serializes concurrent publication and deletion without half-published identities", async () => {
    for (let i = 0; i < 3; i++) {
      const skill = await create(`Publication race ${i}`); const before = await preview(skill.id, false);
      const [removed, published] = await Promise.all([purge(skill.id, before.version), request(`/api/v1/log-skills/${skill.id}/publish`, "POST", { draftRevisionId: skill.currentRevision.id })]);
      expect([200, 409]).toContain(removed.status); expect([200, 404, 409]).toContain(published.status);
      if (removed.status === 200) { expect(published.status).not.toBe(200); expect((await db.query("select id from log_skill_revisions where skill_id=$1", [skill.id])).rows).toHaveLength(0); }
      else { expect(published.status).toBe(200); expect((await preview(skill.id, false)).canDelete).toBe(false); }
    }
  });
  it("waits for a real dry run before deleting while source indexing is in flight", async () => {
    const skill = await create("Worker race experiment"); await sample(skill.id);
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; }); const held = new Promise<void>(resolve => { release = resolve; });
    const rules = createRuleBasedLogAnalyzer(genericSignalRuleSet);
    const run = await startSkillDryRun(db, store, { analyze: async input => { entered(); await held; return rules.analyze(input); } }, auth, skill.id);
    await started;
    const zip = new JSZip(); zip.file("main.c", "int main(void) { return 0; }\n"); const archive = await zip.generateAsync({ type: "nodebuffer" });
    const raw = await store.put({ organizationId: auth.organization.id, fileName: "worker.zip", contentType: "application/zip", bytes: archive }); const snapshotId = randomUUID();
    await db.query(`insert into log_source_snapshots(id,organization_id,skill_id,version_label,storage_key,file_name) values($1,$2,$3,'worker',$4,'worker.zip')`, [snapshotId, auth.organization.id, skill.id, raw.storageKey]);
    let releaseIndex!: () => void, enteredIndex!: () => void;
    const indexStarted = new Promise<void>(resolve => { enteredIndex = resolve; }); const heldIndex = new Promise<void>(resolve => { releaseIndex = resolve; });
    const worker = processNextSourceIndexJob({ db, objectStore: { ...store, getStream: async () => { enteredIndex(); await heldIndex; return Readable.from(archive); } } });
    await indexStarted;
    try {
      const before = await preview(skill.id); const removed = await purge(skill.id, before.version);
      expect(before.blockers).toContainEqual(expect.objectContaining({ code: "analyses-in-progress", count: 1 }));
      expect(removed.status, removed.bodyText).toBe(409);
    } finally { release(); }
    await vi.waitFor(() => expect(activeDryRunWork.has(run.run.id)).toBe(false));
    try {
      const finished = await preview(skill.id, false);
      expect((await purge(skill.id, finished.version)).status).toBe(200);
    } finally { releaseIndex(); }
    await worker;
    expect((await db.query("select id from log_skill_dry_runs where id=$1", [run.run.id])).rows).toHaveLength(0);
    expect((await db.query("select id from log_source_snapshots where id=$1", [snapshotId])).rows).toHaveLength(0);
    expect((await db.query("select id from log_source_files where snapshot_id=$1", [snapshotId])).rows).toHaveLength(0);
  });
  it("waits for admitted case workers before deleting their private data", async () => {
    const skill = await create("Case worker experiment");
    const created = await createAnalysisCase(db, store, auth, skill.id, { name: "Private case", expectations: { domain: "generic", summary: "Issue", realLog: false,
      rootCauseCategory: "software-fault", rootCausePoints: ["Issue"], keyEvidenceLines: [2], expectedActions: ["Inspect issue"], expectRefusal: false },
      files: [{ fileName: "case.log", bytes: Buffer.from("INFO sample\nERROR issue\n") }] }, createUserInvocation(auth), { requestId: "private-case" });
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; }); const held = new Promise<void>(resolve => { release = resolve; });
    const rules = createRuleBasedLogAnalyzer(genericSignalRuleSet);
    const run = await startAnalysisCaseRun(db, store, { analyze: async input => { entered(); await held; return rules.analyze(input); } }, auth, skill.id, [created.id], createUserInvocation(auth), { requestId: "case-run" });
    await started;
    try {
      const before = await preview(skill.id); expect(before.inventory).toContainEqual(expect.objectContaining({ key: "cases", count: 1 }));
      expect(before.blockers).toContainEqual(expect.objectContaining({ code: "analyses-in-progress", count: 1 }));
      expect((await purge(skill.id, before.version)).status).toBe(409);
    } finally { release(); }
    await vi.waitFor(() => expect(activeDryRunWork.has(run.run.id)).toBe(false));
    const finished = await preview(skill.id, false);
    expect((await purge(skill.id, finished.version)).status).toBe(200);
    expect((await db.query("select id from log_skill_analysis_case_runs where skill_id=$1", [skill.id])).rows).toHaveLength(0);
    expect((await db.query("select id from log_skill_analysis_cases where skill_id=$1", [skill.id])).rows).toHaveLength(0);
  });
  it("runs the entire deletion as the actual NOINHERIT API LOGIN without general Catalog delete authority", async () => {
    const token = `skill${randomBytes(5).toString("hex")}`; let api: ReturnType<typeof createPostgresDatabase> | undefined;
    try {
      const runtime = await provisionPublicationRuntimeLogins(database.url, { mode: "lab", runToken: token }); api = createPostgresDatabase(runtime.apiUrl);
      expect((await api.query("select rolsuper,rolinherit from pg_roles where rolname=current_user")).rows[0]).toEqual({ rolsuper: false, rolinherit: false });
      const actual = <T,>(path: string, method = "GET", body?: unknown) => requestJson<T>(createWiseEffServer({ db: api!, objectStore: store }), path,
        { method, headers: { "X-WiseEff-User": auth.user.id }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const created = await actual<{ item: Skill }>("/api/v1/log-skills", "POST", { name: "API LOGIN experiment", status: "draft" }); expect(created.status, created.bodyText).toBe(201);
      expect((await actual(`/api/v1/log-domains/${created.body.item.id}/archive`, "POST")).status).toBe(200);
      const before = await actual<{ item: SkillDeletionPreview }>(`/api/v1/log-skills/${created.body.item.id}/deletion-preview`); expect(before.status, before.bodyText).toBe(200);
      const removed = await actual<{ item: SkillDeletionStatus }>(`/api/v1/log-skills/${created.body.item.id}/purge`, "POST", { version: before.body.item.version }); expect(removed.status, removed.bodyText).toBe(200);
      await expect(api.query("delete from parameter_catalog.log_erasures")).rejects.toMatchObject({ code: "42501" });
    } finally { await api?.close(); await dropLabRuntimeLogins(database.url, token); }
  });
  it("backfills existing sample, source and case object ownership in a populated upgrade", async () => {
    const skill = await create("Populated upgrade experiment"); await sample(skill.id);
    const sampleKey = (await db.query<{ object_key: string }>("select object_key from log_skill_samples where skill_id=$1", [skill.id])).rows[0]!.object_key;
    const sourceId = randomUUID();
    await db.query(`insert into log_source_snapshots(id,organization_id,skill_id,version_label,storage_key,file_name) values($1,$2,$3,'upgrade','upgrade-source-key','source.zip')`, [sourceId, auth.organization.id, skill.id]);
    await db.query(`insert into log_skill_analysis_cases(id,organization_id,skill_id,name,expectations,uploads,files)
      values($1,$2,$3,'Existing case','{}',$4::jsonb,'[]')`, [randomUUID(), auth.organization.id, skill.id, JSON.stringify([{ objectKey: "upgrade-case-key" }])]);
    // Restore the pre-0230 shape only inside this disposable transaction; rollback keeps the harness migration ledger intact.
    await expect(db.transaction(async tx => {
      // Detached shared snapshots are a post-0251 state that did not exist in this historical upgrade.
      await tx.query("delete from log_source_snapshots where skill_id is null");
      await tx.query("drop trigger log_skill_deleted_identity on log_domains; drop function reject_deleted_log_skill_identity(); drop table log_skill_artifact_objects,log_skill_deletions");
      await tx.query("delete from schema_migrations where name='0230_unpublished_skill_deletion.sql'");
      expect(await applyMigrations(tx,fileURLToPath(new URL("../../migrations",import.meta.url)),{ through: "0230_unpublished_skill_deletion.sql" }))
        .toEqual(["0230_unpublished_skill_deletion.sql"]);
      expect((await tx.query<{ object_key: string }>("select object_key from log_skill_artifact_objects where skill_id=$1 order by object_key", [skill.id])).rows.map(row => row.object_key))
        .toEqual([sampleKey, "upgrade-case-key", "upgrade-source-key"].sort());
      throw new Error("rollback-upgrade-probe");
    })).rejects.toThrow("rollback-upgrade-probe");
  });
});
