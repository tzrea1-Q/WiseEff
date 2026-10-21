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
import { createRuleBasedLogAnalyzer, genericSignalRuleSet } from "./analyzer";
import { dropLabRuntimeLogins, provisionPublicationRuntimeLogins } from "../../testing/labRuntimeLogins";

type Skill = Awaited<ReturnType<typeof getLogSkill>>;
describe("unpublished experiment skill deletion HTTP", () => {
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
  const preview = async (id: string) => {
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
  it("rejects stale confirmations, published history, cross-tenant and nonadministrator requests", async () => {
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
    const blocked = await preview(published.id); expect(blocked.canDelete).toBe(false);
    expect(blocked.blockers).toContainEqual(expect.objectContaining({ code: "published", count: 1 }));
    expect(blocked.blockers).toContainEqual(expect.objectContaining({ code: "logs", count: 1 }));
    expect(blocked.blockers).toContainEqual(expect.objectContaining({ code: "runs", count: 1 }));
    expect((await purge(published.id, blocked.version)).status).toBe(409);
    expect((await request(`/api/v1/log-skills/${published.id}`)).status).toBe(200);
    expect((await db.query("select id from log_analysis_runs where log_record_id=$1", [historical.body.log.id])).rows).toHaveLength(1);
    const bound = await create("Externally bound experiment");
    await db.query(`insert into log_integration_credentials(id,organization_id,name,skill_id,secret_hash,status,revoked_at)
      values($1,$2,'Historical credential',$3,$4,'revoked',now())`, [randomUUID(), auth.organization.id, bound.id, "a".repeat(64)]);
    const external = await preview(bound.id); expect(external.canDelete).toBe(false);
    expect(external.blockers).toContainEqual(expect.objectContaining({ code: "credentials", count: 1 }));
    expect((await purge(bound.id, external.version)).status).toBe(409);
  });
  it("serializes concurrent publication and deletion without half-published identities", async () => {
    for (let i = 0; i < 3; i++) {
      const skill = await create(`Publication race ${i}`); const before = await preview(skill.id);
      const [removed, published] = await Promise.all([purge(skill.id, before.version), request(`/api/v1/log-skills/${skill.id}/publish`, "POST", { draftRevisionId: skill.currentRevision.id })]);
      expect([200, 409]).toContain(removed.status); expect([200, 404, 409]).toContain(published.status);
      if (removed.status === 200) { expect(published.status).not.toBe(200); expect((await db.query("select id from log_skill_revisions where skill_id=$1", [skill.id])).rows).toHaveLength(0); }
      else { expect(published.status).toBe(200); expect((await preview(skill.id)).canDelete).toBe(false); }
    }
  });
  it("allows deletion while indexing and a real dry-run worker are in flight without resurrecting children", async () => {
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
      expect(removed.status, removed.bodyText).toBe(200);
    } finally { release(); releaseIndex(); }
    await worker;
    await vi.waitFor(() => expect(activeDryRunWork.has(run.run.id)).toBe(false));
    expect((await db.query("select id from log_skill_dry_runs where id=$1", [run.run.id])).rows).toHaveLength(0);
    expect((await db.query("select id from log_source_snapshots where id=$1", [snapshotId])).rows).toHaveLength(0);
    expect((await db.query("select id from log_source_files where snapshot_id=$1", [snapshotId])).rows).toHaveLength(0);
  });
  it("deletes private analysis cases while an admitted test worker is running and prevents late results", async () => {
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
      expect((await purge(skill.id, before.version)).status).toBe(200);
    } finally { release(); }
    await vi.waitFor(() => expect(activeDryRunWork.has(run.run.id)).toBe(false));
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
