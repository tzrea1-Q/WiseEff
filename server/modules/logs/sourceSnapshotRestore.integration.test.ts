import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import JSZip from "jszip";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createWiseEffServer } from "../../app";
import { createPostgresDatabase } from "../../shared/database/client";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import { requestJson } from "../../test/testClient";
import { createLocalObjectStore } from "./objectStore";
import { processNextSourceIndexJob } from "./sourceIndexWorker";
import { processLogAnalysisJobById } from "./worker";
import { createRuleBasedLogAnalyzer, genericSignalRuleSet } from "./analyzer";
import { createAgentLoopLogAnalyzer } from "./analyzer/agentLoop";
import { createDeterministicLogAnalysisLoopModel } from "./analyzer/deterministicModel";
import { createWorkerLogAnalysisToolBackends } from "./analyzer/tools/workerToolBackends";
import { dropLabRuntimeLogins, provisionPublicationRuntimeLogins } from "../../testing/labRuntimeLogins";
import type { SourceSnapshotDto } from "./sourceSnapshots";
import type { getLogSkill } from "./skillsService";
type Skill = Awaited<ReturnType<typeof getLogSkill>>;

describe("archived source snapshot restoration over HTTP and PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>;
  let directory: string;
  let store: ReturnType<typeof createLocalObjectStore>;
  let bytes: Buffer;
  beforeAll(async () => {
    database = await createEphemeralTestDatabase("source-restore"); db = createPostgresDatabase(database.url);
    directory = await mkdtemp(join(tmpdir(), "wiseeff-source-restore-")); store = createLocalObjectStore(directory);
    for (const org of ["source-restore", "source-restore-other"]) {
      await seedCoreGraph(db, { organization: { id: org }, users: [{ id: `${org}-admin` }] });
      await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values($1,$2,$3,'admin')", [org, `${org}-admin`, org]);
    }
    await db.query("insert into users(id,organization_id,name,title,is_active) values('source-restore-member','source-restore','Member','Member',true)");
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('member-role','source-restore-member','source-restore','software-user')");
    const zip = new JSZip(); zip.file("src/restore.c", 'pr_warn("restore code=%d\\n", code);\n'); bytes = await zip.generateAsync({ type: "nodebuffer" });
  });
  afterEach(async () => { await db.query("update log_source_snapshots set status='archived' where status in ('queued','indexing')"); });
  afterAll(async () => { await db?.close(); await database?.drop(); if (directory) await rm(directory, { recursive: true, force: true }); });
  const request = <T = unknown>(path: string, method = "GET", body?: unknown, user = "source-restore-admin") =>
    requestJson<T>(createWiseEffServer({ db, objectStore: store }), path, { method, headers: { "X-WiseEff-User": user }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  async function upload(skillId: string, label = "stable-build") {
    const form = new FormData(); form.append("versionLabel", label); form.append("file", new Blob([new Uint8Array(bytes)]), "source.zip");
    const encoded = new Request("http://fixture", { method: "POST", body: form });
    const result = await requestJson<{ item: SourceSnapshotDto }>(createWiseEffServer({ db, objectStore: store }), `/api/v1/log-skills/${skillId}/source-snapshots`, {
      method: "POST", headers: { "X-WiseEff-User": "source-restore-admin", "Content-Type": encoded.headers.get("content-type")! }, body: await encoded.arrayBuffer()
    }); expect(result.status, result.bodyText).toBe(201); return result.body.item;
  }
  async function fixture(name: string) {
    const created = await request<{ item: Skill }>("/api/v1/log-skills", "POST", { name }); expect(created.status).toBe(201);
    const skill = created.body.item; const snapshot = await upload(skill.id);
    const base = `/api/v1/log-skills/${skill.id}/source-snapshots/${snapshot.id}`;
    const metadata = (await db.query<{ storage_key: string; statement_patterns: string[]; created_at: Date; version_label: string }>(
      "select storage_key,statement_patterns,created_at,version_label from log_source_snapshots where id=$1", [snapshot.id])).rows[0]!;
    return { skill, snapshot, base, metadata };
  }
  const read = async (skillId: string, id: string) => (await request<{ items: SourceSnapshotDto[] }>(`/api/v1/log-skills/${skillId}/source-snapshots`)).body.items.find(item => item.id === id)!;

  it("preserves an existing report citation through archive, restore, failed indexing and retry", async () => {
    const h = await fixture("Restore cited source"); await processNextSourceIndexJob({ db, objectStore: store });
    const selected = await request<{ item: Skill }>(`${h.base}/default`, "POST");
    expect((await request(`/api/v1/log-skills/${h.skill.id}/publish`, "POST", { draftRevisionId: selected.body.item.draft!.id })).status).toBe(200);
    const uploaded = await request<{ log: { id: string }; job: { id: string } }>("/api/v1/log-files", "POST", {
      fileName: "restore-citation.log", contentType: "text/plain", skillId: h.skill.id,
      contentBase64: Buffer.from("WARN restore code=7\n").toString("base64")
    });
    expect(uploaded.status, uploaded.bodyText).toBe(201);
    expect((await processLogAnalysisJobById({ db, objectStore: store, jobId: uploaded.body.job.id,
      analyzer: createAgentLoopLogAnalyzer({ model: createDeterministicLogAnalysisLoopModel(), modelLabel: "restore-citation", maxSteps: 4, tokenBudget: 100_000,
        bindToolBackends: (input) => createWorkerLogAnalysisToolBackends({ db, organizationId: "source-restore", sourceSnapshot: input.sourceSnapshot }) })
    })).status).toBe("processed");
    const reportPath = `/api/v1/logs/${uploaded.body.log.id}`;
    const report = await request<{ item: { evidence: Array<{ id: string; sourceLocation?: unknown }> } }>(reportPath);
    const citation = report.body.item.evidence.find(item => item.sourceLocation)!;
    expect(citation.sourceLocation).toEqual({ snapshotId: h.snapshot.id, path: "src/restore.c", line: 1 });
    const excerptPath = `${reportPath}/evidence/${citation.id}/source`;
    const original = await request(excerptPath, "GET", undefined, "source-restore-member");
    expect(original.status).toBe(200);
    expect((await request(`${h.base}/archive`, "POST")).status).toBe(200);
    expect((await request(excerptPath, "GET", undefined, "source-restore-member")).body).toEqual(original.body);
    const restored = await request<{ item: SourceSnapshotDto }>(`${h.base}/restore`, "POST");
    expect(restored.status, restored.bodyText).toBe(202);
    expect((await request(excerptPath, "GET", undefined, "source-restore-member")).body).toEqual(original.body);
    await processNextSourceIndexJob({ db, objectStore: { ...store, getStream: async () => { throw new Error("synthetic indexing storage outage"); } } });
    expect((await read(h.skill.id, h.snapshot.id)).status).toBe("failed");
    expect((await request(excerptPath, "GET", undefined, "source-restore-member")).body).toEqual(original.body);
    expect((await request(`${h.base}/retry`, "POST")).status).toBe(202);
    await processNextSourceIndexJob({ db, objectStore: store });
    expect((await read(h.skill.id, h.snapshot.id)).status).toBe("ready");
    expect((await request(excerptPath, "GET", undefined, "source-restore-member")).body).toEqual(original.body);
    expect((await request(reportPath)).body).toEqual(report.body);
    for (const path of ["src/restore.c", "replacement.c"]) {
      const changed = new JSZip(); changed.file(path, 'pr_warn("replacement code=%d\\n", code);\n');
      const changedBytes = await changed.generateAsync({ type: "nodebuffer" });
      expect((await request(`${h.base}/archive`, "POST")).status).toBe(200);
      expect((await request(`${h.base}/restore`, "POST")).status).toBe(202);
      await processNextSourceIndexJob({ db, objectStore: { ...store, getStream: async () => Readable.from(changedBytes) } });
      expect((await read(h.skill.id, h.snapshot.id)).status).toBe("failed");
      expect((await request(excerptPath, "GET", undefined, "source-restore-member")).body).toEqual(original.body);
      expect((await request(`${h.base}/retry`, "POST")).status).toBe(202);
      await processNextSourceIndexJob({ db, objectStore: store });
      expect((await read(h.skill.id, h.snapshot.id)).status).toBe("ready");
    }
  });

  it("restores the original identity and upload, rebuilds before ready and preserves published defaults", async () => {
    const h = await fixture("Restore original source"); await processNextSourceIndexJob({ db, objectStore: store });
    const selected = await request<{ item: Skill }>(`${h.base}/default`, "POST"); expect(selected.status).toBe(200);
    const published = await request<{ item: Skill }>(`/api/v1/log-skills/${h.skill.id}/publish`, "POST", { draftRevisionId: selected.body.item.draft!.id }); expect(published.status).toBe(200);
    const prior = published.body.item;
    expect((await request(`${h.base}/archive`, "POST")).status).toBe(200);
    expect((await request<{ items: string[] }>(`/api/v1/log-skills/${h.skill.id}/source-versions`)).body.items).toEqual([]);
    const restored = await request<{ item: SourceSnapshotDto }>(`${h.base}/restore`, "POST");
    expect(restored.status, restored.bodyText).toBe(202); expect(restored.body.item).toMatchObject({ id: h.snapshot.id, status: "queued", fileCount: 0 });
    expect((await request(`${h.base}/restore`, "POST")).status).toBe(409);
    await processNextSourceIndexJob({ db, objectStore: store });
    expect(await read(h.skill.id, h.snapshot.id)).toMatchObject({ id: h.snapshot.id, status: "ready", fileCount: 1 });
    expect((await db.query("select storage_key,statement_patterns,created_at,version_label from log_source_snapshots where id=$1", [h.snapshot.id])).rows[0]).toEqual(h.metadata);
    expect(await store.get(h.metadata.storage_key)).toEqual(bytes);
    const current = await request<{ item: Skill }>(`/api/v1/log-skills/${h.skill.id}`);
    expect(current.body.item.currentRevision.id).toBe(prior.currentRevision.id); expect(current.body.item.draft).toBeNull();
    expect(current.body.item.currentRevision.spec.defaultSourceSnapshotId).toBe(h.snapshot.id);
    expect((await request<{ items: string[] }>(`/api/v1/log-skills/${h.skill.id}/source-versions`)).body.items).toEqual(["stable-build"]);
    const located = await request<{ items: Array<{ snapshotId: string }> }>(`${h.base}/locate`, "POST", { line: "restore code=7" });
    expect(located.status).toBe(200); expect(located.body.items).toContainEqual(expect.objectContaining({ snapshotId: h.snapshot.id }));
    expect((await db.query("select kind from audit_events where target_id=$1 and kind='log-source-snapshot-restore'", [h.snapshot.id])).rows).toHaveLength(1);
  });
  it("identifies a label occupant, restores only after it is archived and leaves defaults and historical run selection unchanged", async () => {
    const h = await fixture("Source label conflict"); await processNextSourceIndexJob({ db, objectStore: store });
    const setDefault = async (base: string) => {
      const draft = await request<{ item: Skill }>(`${base}/default`, "POST"); expect(draft.status).toBe(200);
      const published = await request<{ item: Skill }>(`/api/v1/log-skills/${h.skill.id}/publish`, "POST", { draftRevisionId: draft.body.item.draft!.id }); expect(published.status).toBe(200); return published.body.item;
    };
    const analyze = async (name: string) => {
      const uploaded = await request<{ log: { id: string }; job: { id: string } }>("/api/v1/log-files", "POST", { fileName: `${name}.log`, contentType: "text/plain", skillId: h.skill.id,
        sourceVersion: "stable-build", contentBase64: Buffer.from("WARN restore code=7\n").toString("base64") }); expect(uploaded.status, uploaded.bodyText).toBe(201);
      expect((await processLogAnalysisJobById({ db, objectStore: store, jobId: uploaded.body.job.id, analyzer: createRuleBasedLogAnalyzer(genericSignalRuleSet) })).status).toBe("processed");
      return (await db.query<{ id: string; source_snapshot_id: string; skill_revision_id: string }>("select id,source_snapshot_id,skill_revision_id from log_analysis_runs where log_record_id=$1", [uploaded.body.log.id])).rows[0]!;
    };
    const originalPublished = await setDefault(h.base); const first = await analyze("original-pin"); expect(first.source_snapshot_id).toBe(h.snapshot.id);
    await request(`${h.base}/archive`, "POST"); const occupant = await upload(h.skill.id); await processNextSourceIndexJob({ db, objectStore: store });
    const occupantBase = `/api/v1/log-skills/${h.skill.id}/source-snapshots/${occupant.id}`;
    const currentPublished = await setDefault(occupantBase); const second = await analyze("occupant-pin"); expect(second.source_snapshot_id).toBe(occupant.id);
    const blocked = await request<{ error: { details: { conflictingSnapshot: unknown } } }>(`${h.base}/restore`, "POST");
    expect(blocked.status).toBe(409); expect(blocked.body.error.details.conflictingSnapshot).toMatchObject({ id: occupant.id, versionLabel: "stable-build", status: "ready" });
    expect((await read(h.skill.id, h.snapshot.id)).status).toBe("archived");
    expect((await request(`${occupantBase}/archive`, "POST")).status).toBe(200);
    expect((await request(`${h.base}/restore`, "POST")).status).toBe(202); await processNextSourceIndexJob({ db, objectStore: store });
    const current = (await request<{ item: Skill }>(`/api/v1/log-skills/${h.skill.id}`)).body.item;
    expect(current.currentRevision).toMatchObject({ id: currentPublished.currentRevision.id, spec: { defaultSourceSnapshotId: occupant.id } });
    expect((await db.query("select id,source_snapshot_id,skill_revision_id from log_analysis_runs where id=any($1::text[]) order by id", [[first.id, second.id]])).rows)
      .toEqual([first, second].sort((a, b) => a.id.localeCompare(b.id)));
    expect(first.skill_revision_id).toBe(originalPublished.currentRevision.id);
    expect((await analyze("restored-version-match")).source_snapshot_id).toBe(h.snapshot.id);
  });
  it("keeps an unreadable original archived, and does not claim ready if indexing later fails", async () => {
    const h = await fixture("Source missing object"); await processNextSourceIndexJob({ db, objectStore: store }); await request(`${h.base}/archive`, "POST");
    await store.delete!(h.metadata.storage_key);
    const missing = await request<{ error: { message: string; details: { reason: string } } }>(`${h.base}/restore`, "POST");
    expect(missing.status).toBe(409); expect(missing.body.error).toMatchObject({ message: expect.stringContaining("原始源码文件"), details: { reason: "source-snapshot-object-unavailable" } });
    expect((await read(h.skill.id, h.snapshot.id)).status).toBe("archived");
    expect((await db.query("select id from log_source_files where snapshot_id=$1", [h.snapshot.id])).rows).toHaveLength(1);
    expect((await db.query("select id from audit_events where target_id=$1 and kind='log-source-snapshot-restore'", [h.snapshot.id])).rows).toHaveLength(0);
    expect((await store.put({ organizationId: "source-restore", fileName: `${h.snapshot.id}-source.zip`, contentType: "application/octet-stream", bytes })).storageKey).toBe(h.metadata.storage_key);
    expect((await request(`${h.base}/restore`, "POST")).status).toBe(202);
    await processNextSourceIndexJob({ db, objectStore: { ...store, getStream: async () => { throw new Error("storage lost after admission"); } } });
    expect((await read(h.skill.id, h.snapshot.id)).status).toBe("failed");
    expect((await request(`${h.base}/retry`, "POST")).status).toBe(202); await processNextSourceIndexJob({ db, objectStore: store });
    expect((await read(h.skill.id, h.snapshot.id)).status).toBe("ready");
  });
  it("enforces permissions and tenant ownership, accepts no label override and serializes duplicate and archive requests", async () => {
    const h = await fixture("Source restore access"); await request(`${h.base}/archive`, "POST");
    expect((await request(`${h.base}/restore`, "POST", {}, "source-restore-member")).status).toBe(403);
    expect((await request(`${h.base}/restore`, "POST", {}, "source-restore-other-admin")).status).toBe(404);
    expect((await request(`${h.base.replace(h.skill.id, "missing-skill")}/restore`, "POST")).status).toBe(404);
    expect((await request(`${h.base}/restore`, "POST", { versionLabel: "renamed" })).status).toBe(400);
    const duplicates = await Promise.all([request(`${h.base}/restore`, "POST"), request(`${h.base}/restore`, "POST")]);
    expect(duplicates.map(response => response.status).sort()).toEqual([202, 409]);
    expect((await db.query("select id from audit_events where target_id=$1 and kind='log-source-snapshot-restore'", [h.snapshot.id])).rows).toHaveLength(1);
    await request(`${h.base}/archive`, "POST");
    const [restored, archived] = await Promise.all([request(`${h.base}/restore`, "POST"), request(`${h.base}/archive`, "POST")]);
    expect(restored.status).toBe(202); expect(archived.status).toBe(200);
    expect(["archived", "queued"]).toContain((await read(h.skill.id, h.snapshot.id)).status);
    expect((await db.query("select id from log_source_snapshots where organization_id='source-restore' and skill_id=$1 and version_label='stable-build' and status<>'archived'", [h.skill.id])).rows.length).toBeLessThanOrEqual(1);
  });
  it("fences a pre-archive worker across restoration and a later archive without losing retained historical index data", async () => {
    const h = await fixture("Source restore old worker"); let release!: () => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; }); const held = new Promise<void>(resolve => { release = resolve; });
    const stale = new JSZip(); stale.file("stale.c", "int stale = 1;\n"); const staleBytes = await stale.generateAsync({ type: "nodebuffer" });
    const old = processNextSourceIndexJob({ db, objectStore: { ...store, getStream: async () => { entered(); await held; return Readable.from(staleBytes); } } });
    await started;
    try {
      expect((await request(`${h.base}/archive`, "POST")).status).toBe(200);
      expect((await request(`${h.base}/restore`, "POST")).status).toBe(202); await processNextSourceIndexJob({ db, objectStore: store });
      expect((await read(h.skill.id, h.snapshot.id)).status).toBe("ready");
      const attempt = (await db.query("select index_attempt_id from log_source_snapshots where id=$1", [h.snapshot.id])).rows[0];
      expect((await request(`${h.base}/archive`, "POST")).status).toBe(200); release(); await old;
      expect((await read(h.skill.id, h.snapshot.id)).status).toBe("archived");
      expect((await db.query("select path from log_source_files where snapshot_id=$1", [h.snapshot.id])).rows).toEqual([{ path: "src/restore.c" }]);
      expect((await db.query("select index_attempt_id from log_source_snapshots where id=$1", [h.snapshot.id])).rows[0]).toEqual(attempt);
    } finally { release(); await old; }
  });
  it("rolls back a failed audit and restores through the actual API LOGIN before a worker LOGIN builds the index", async () => {
    const h = await fixture("Source restore runtime"); await request(`${h.base}/archive`, "POST");
    await db.query("create function reject_source_restore_audit() returns trigger language plpgsql as $$ begin raise exception 'audit unavailable'; end $$");
    await db.query("create trigger reject_source_restore_audit before insert on audit_events for each row when(new.kind='log-source-snapshot-restore') execute function reject_source_restore_audit()");
    try { expect((await request(`${h.base}/restore`, "POST")).status).toBe(500); expect((await read(h.skill.id, h.snapshot.id)).status).toBe("archived"); }
    finally { await db.query("drop trigger reject_source_restore_audit on audit_events; drop function reject_source_restore_audit()"); }
    const token = `restore${randomBytes(5).toString("hex")}`; let api: ReturnType<typeof createPostgresDatabase> | undefined, worker: ReturnType<typeof createPostgresDatabase> | undefined;
    try {
      const runtime = await provisionPublicationRuntimeLogins(database.url, { mode: "lab", runToken: token }); api = createPostgresDatabase(runtime.apiUrl); worker = createPostgresDatabase(runtime.workerUrl);
      expect((await api.query("select rolsuper,rolinherit from pg_roles where rolname=current_user")).rows[0]).toEqual({ rolsuper: false, rolinherit: false });
      const restored = await requestJson<{ item: SourceSnapshotDto }>(createWiseEffServer({ db: api, objectStore: store }), `${h.base}/restore`, { method: "POST", headers: { "X-WiseEff-User": "source-restore-admin" } });
      expect(restored.status, restored.bodyText).toBe(202); await processNextSourceIndexJob({ db: worker, objectStore: store });
      expect((await read(h.skill.id, h.snapshot.id)).status).toBe("ready");
      await expect(api.query("delete from parameter_catalog.log_erasures")).rejects.toMatchObject({ code: "42501" });
    } finally { await api?.close(); await worker?.close(); await dropLabRuntimeLogins(database.url, token); }
  });
});
