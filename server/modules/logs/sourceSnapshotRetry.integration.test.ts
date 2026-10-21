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
import { searchSource } from "./sourceSearchRepository";
import { dropLabRuntimeLogins, provisionPublicationRuntimeLogins } from "../../testing/labRuntimeLogins";
import type { SourceSnapshotDto } from "./sourceSnapshots";
import type { getLogSkill } from "./skillsService";
type Skill = Awaited<ReturnType<typeof getLogSkill>>;

describe("manual source snapshot indexing retry over HTTP and PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>;
  let root: string;
  let store: ReturnType<typeof createLocalObjectStore>;
  let bytes: Buffer;
  const pattern = "\\bCUSTOM_LOG\\s*\\(";
  beforeAll(async () => {
    database = await createEphemeralTestDatabase("source-retry"); db = createPostgresDatabase(database.url);
    root = await mkdtemp(join(tmpdir(), "wiseeff-source-retry-")); store = createLocalObjectStore(root);
    for (const organizationId of ["source-retry", "source-retry-other"]) {
      await seedCoreGraph(db, { organization: { id: organizationId }, users: [{ id: `${organizationId}-admin` }] });
      await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values($1,$2,$3,'admin')", [organizationId, `${organizationId}-admin`, organizationId]);
    }
    await db.query("insert into users(id,organization_id,name,title,is_active) values('source-retry-member','source-retry','Member','Member',true)");
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('member-role','source-retry-member','source-retry','software-user')");
    const zip = new JSZip(); zip.file("src/retry.c", 'CUSTOM_LOG("retry code=%d\\n", code);\n'); bytes = await zip.generateAsync({ type: "nodebuffer" });
  });
  afterEach(async () => { await db.query("update log_source_snapshots set status='archived' where status in ('queued','indexing')"); });
  afterAll(async () => { await db?.close(); await database?.drop(); if (root) await rm(root, { recursive: true, force: true }); });
  const request = <T = unknown>(path: string, method = "GET", body?: unknown, user = "source-retry-admin") =>
    requestJson<T>(createWiseEffServer({ db, objectStore: store }), path, { method, headers: { "X-WiseEff-User": user }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  async function fixture(name: string) {
    const created = await request<{ item: Skill }>("/api/v1/log-skills", "POST", { name, status: "draft" }); expect(created.status, created.bodyText).toBe(201);
    const skill = created.body.item;
    const draft = await request<{ item: { id: string } }>(`/api/v1/log-skills/${skill.id}/draft`, "PUT", {
      spec: { ...skill.currentRevision.spec, source: { statementPatterns: [pattern] } }, baseDraftRevisionId: skill.draft!.id, basePublishedRevisionId: skill.currentRevision.id
    }); expect(draft.status, draft.bodyText).toBe(200);
    const form = new FormData(); form.append("versionLabel", "original-build"); form.append("file", new Blob([new Uint8Array(bytes)]), "source.zip");
    const encoded = new Request("http://fixture", { method: "POST", body: form });
    const uploaded = await requestJson<{ item: SourceSnapshotDto }>(createWiseEffServer({ db, objectStore: store }), `/api/v1/log-skills/${skill.id}/source-snapshots`, {
      method: "POST", headers: { "X-WiseEff-User": "source-retry-admin", "Content-Type": encoded.headers.get("content-type")! }, body: await encoded.arrayBuffer()
    }); expect(uploaded.status, uploaded.bodyText).toBe(201);
    const snapshot = uploaded.body.item; const base = `/api/v1/log-skills/${skill.id}/source-snapshots/${snapshot.id}`;
    const metadata = (await db.query<{ storage_key: string; statement_patterns: string[]; created_at: Date }>("select storage_key,statement_patterns,created_at from log_source_snapshots where id=$1", [snapshot.id])).rows[0]!;
    return { skill, snapshot, base, metadata };
  }
  const read = async (skillId: string, id: string) => (await request<{ items: SourceSnapshotDto[] }>(`/api/v1/log-skills/${skillId}/source-snapshots`)).body.items.find(item => item.id === id)!;
  const fail = () => processNextSourceIndexJob({ db, objectStore: { ...store, getStream: async () => { throw new Error("temporary storage unavailable"); } } });

  it("recovers the original snapshot after a storage fault and keeps its published reference, original bytes and upload-time index inputs", async () => {
    const h = await fixture("Retry original source");
    const selected = await request<{ item: Skill }>(`${h.base}/default`, "POST"); expect(selected.status).toBe(200);
    const published = await request<{ item: Skill }>(`/api/v1/log-skills/${h.skill.id}/publish`, "POST", { draftRevisionId: selected.body.item.draft!.id }); expect(published.status).toBe(200);
    const prior = published.body.item;
    expect((await request(`/api/v1/log-skills/${prior.id}/draft`, "PUT", { spec: { ...prior.currentRevision.spec, source: { statementPatterns: ["\\bOTHER_LOG\\s*\\("] } },
      baseDraftRevisionId: null, basePublishedRevisionId: prior.currentRevision.id })).status).toBe(200);
    await processNextSourceIndexJob({ db, objectStore: { ...store, getStream: async () => { throw new Error("temporary storage unavailable"); } } });
    expect((await read(h.skill.id, h.snapshot.id)).status).toBe("failed");
    const queued = await request<{ item: SourceSnapshotDto }>(`${h.base}/retry`, "POST");
    expect(queued.status, queued.bodyText).toBe(202); expect(queued.body.item).toMatchObject({ id: h.snapshot.id, status: "queued", error: null });
    expect((await request(`${h.base}/retry`, "POST")).status).toBe(409);
    expect(await processNextSourceIndexJob({ db, objectStore: store })).toBe("processed");
    expect(await read(h.skill.id, h.snapshot.id)).toMatchObject({ id: h.snapshot.id, status: "ready", fileCount: 1, error: null });
    expect((await db.query("select storage_key,statement_patterns,created_at from log_source_snapshots where id=$1", [h.snapshot.id])).rows[0]).toEqual(h.metadata);
    expect(await store.get(h.metadata.storage_key)).toEqual(bytes);
    const current = await request<{ item: Skill }>(`/api/v1/log-skills/${h.skill.id}`);
    expect(current.body.item.currentRevision.id).toBe(prior.currentRevision.id);
    expect(current.body.item.currentRevision.spec.defaultSourceSnapshotId).toBe(h.snapshot.id);
    const located = await request<{ items: Array<{ snapshotId: string; path: string }> }>(`${h.base}/locate`, "POST", { line: "retry code=7" });
    expect(located.status, located.bodyText).toBe(200); expect(located.body.items).toContainEqual(expect.objectContaining({ snapshotId: h.snapshot.id, path: "src/retry.c" }));
    expect((await db.query("select kind from audit_events where target_id=$1 and kind='log-source-snapshot-retry'", [h.snapshot.id])).rows).toHaveLength(1);
  });
  it("keeps missing raw objects failed with an actionable explanation and exposes no partial index", async () => {
    const h = await fixture("Missing original source"); await store.delete!(h.metadata.storage_key);
    await processNextSourceIndexJob({ db, objectStore: store });
    expect(await read(h.skill.id, h.snapshot.id)).toMatchObject({ status: "failed", fileCount: 0, error: expect.stringContaining("原始文件") });
    const queued = await request<{ item: SourceSnapshotDto }>(`${h.base}/retry`, "POST"); expect(queued.status).toBe(202); expect(queued.body.item.status).toBe("queued");
    await processNextSourceIndexJob({ db, objectStore: store });
    expect(await read(h.skill.id, h.snapshot.id)).toMatchObject({ status: "failed", fileCount: 0, error: expect.stringContaining("对象存储") });
    expect((await request(`${h.base}/locate`, "POST", { line: "retry code=7" })).status).toBe(409);
    expect(await searchSource(db, { organizationId: "source-retry", snapshotId: h.snapshot.id, pathGlob: "**/*", query: "CUSTOM_LOG", mode: "literal", limit: 5 })).toEqual({ items: [], truncated: false });
    expect((await db.query("select id from log_source_files where snapshot_id=$1", [h.snapshot.id])).rows).toHaveLength(0);
  });
  it("checks current permissions, tenant and skill ownership, and refuses queued, indexing, ready or archived states", async () => {
    const h = await fixture("Source retry access"); await fail();
    expect((await request(`${h.base}/retry`, "POST", {}, "source-retry-member")).status).toBe(403);
    expect((await request(`${h.base}/retry`, "POST", {}, "source-retry-other-admin")).status).toBe(404);
    expect((await request(`${h.base.replace(h.skill.id, "missing-skill")}/retry`, "POST")).status).toBe(404);
    expect((await request(`${h.base}/retry`, "POST", { indexAttemptId: "client-controlled" })).status).toBe(400);
    for (const state of ["queued", "indexing", "ready", "archived"]) {
      await db.query("update log_source_snapshots set status=$2 where id=$1", [h.snapshot.id, state]);
      expect((await request(`${h.base}/retry`, "POST")).status).toBe(409);
    }
    expect((await db.query("select kind from audit_events where target_id=$1 and kind='log-source-snapshot-retry'", [h.snapshot.id])).rows).toHaveLength(0);
  });
  it("serializes duplicate clicks and retry/archive races without reviving archived snapshots", async () => {
    const h = await fixture("Source duplicate retry"); await fail();
    const clicks = await Promise.all([request(`${h.base}/retry`, "POST"), request(`${h.base}/retry`, "POST")]);
    expect(clicks.map(response => response.status).sort()).toEqual([202, 409]);
    expect((await db.query("select kind from audit_events where target_id=$1 and kind='log-source-snapshot-retry'", [h.snapshot.id])).rows).toHaveLength(1);
    await processNextSourceIndexJob({ db, objectStore: store });
    const raced = await fixture("Source archive race"); await fail();
    const [retry, archive] = await Promise.all([request(`${raced.base}/retry`, "POST"), request(`${raced.base}/archive`, "POST")]);
    expect([202, 409]).toContain(retry.status); expect(archive.status, archive.bodyText).toBe(200);
    expect((await read(raced.skill.id, raced.snapshot.id)).status).toBe("archived");
    expect((await request(`${raced.base}/retry`, "POST")).status).toBe(409);
    expect(await processNextSourceIndexJob({ db, objectStore: store })).toBe("idle");
  });
  it("preserves automatic stale-claim recovery and fences the old worker after a reclaimed failure and manual retry", async () => {
    const h = await fixture("Source stale worker retry");
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; }); const held = new Promise<void>(resolve => { release = resolve; });
    const staleZip = new JSZip(); staleZip.file("stale.c", 'CUSTOM_LOG("stale code=%d\\n", code);\n'); const staleBytes = await staleZip.generateAsync({ type: "nodebuffer" });
    const old = processNextSourceIndexJob({ db, objectStore: { ...store, getStream: async () => { entered(); await held; return Readable.from(staleBytes); } } });
    await started;
    try {
      const oldAttempt = (await db.query<{ index_attempt_id: string }>("select index_attempt_id from log_source_snapshots where id=$1", [h.snapshot.id])).rows[0]!.index_attempt_id;
      expect((await request(`${h.base}/retry`, "POST")).status).toBe(409);
      await db.query("update log_source_snapshots set updated_at=now()-interval '6 minutes' where id=$1", [h.snapshot.id]);
      expect(await fail()).toBe("processed");
      expect((await read(h.skill.id, h.snapshot.id)).status).toBe("failed");
      expect((await request(`${h.base}/retry`, "POST")).status).toBe(202);
      await processNextSourceIndexJob({ db, objectStore: store });
      const currentAttempt = (await db.query<{ index_attempt_id: string }>("select index_attempt_id from log_source_snapshots where id=$1", [h.snapshot.id])).rows[0]!.index_attempt_id;
      expect(currentAttempt).not.toBe(oldAttempt);
      release(); await old;
      expect((await read(h.skill.id, h.snapshot.id)).status).toBe("ready");
      expect((await db.query("select path from log_source_files where snapshot_id=$1", [h.snapshot.id])).rows).toEqual([{ path: "src/retry.c" }]);
      expect((await db.query("select index_attempt_id from log_source_snapshots where id=$1", [h.snapshot.id])).rows[0]).toEqual({ index_attempt_id: currentAttempt });
    } finally { release(); await old; }
  });
  it("rolls back queue admission if the atomic audit write fails", async () => {
    const h = await fixture("Source retry audit rollback"); await fail();
    await db.query(`create function reject_source_retry_audit() returns trigger language plpgsql as $$ begin raise exception 'audit unavailable'; end $$`);
    await db.query("create trigger reject_source_retry_audit before insert on audit_events for each row when(new.kind='log-source-snapshot-retry') execute function reject_source_retry_audit()");
    try {
      expect((await request(`${h.base}/retry`, "POST")).status).toBe(500);
      expect((await read(h.skill.id, h.snapshot.id)).status).toBe("failed");
    } finally { await db.query("drop trigger reject_source_retry_audit on audit_events; drop function reject_source_retry_audit()"); }
    expect((await request(`${h.base}/retry`, "POST")).status).toBe(202);
  });
  it("admits through the actual NOINHERIT API LOGIN and indexes through the worker LOGIN", async () => {
    const h = await fixture("Runtime source retry"); await fail();
    const token = `retry${randomBytes(5).toString("hex")}`; let api: ReturnType<typeof createPostgresDatabase> | undefined, worker: ReturnType<typeof createPostgresDatabase> | undefined;
    try {
      const runtime = await provisionPublicationRuntimeLogins(database.url, { mode: "lab", runToken: token });
      api = createPostgresDatabase(runtime.apiUrl); worker = createPostgresDatabase(runtime.workerUrl);
      expect((await api.query("select rolsuper,rolinherit from pg_roles where rolname=current_user")).rows[0]).toEqual({ rolsuper: false, rolinherit: false });
      const queued = await requestJson<{ item: SourceSnapshotDto }>(createWiseEffServer({ db: api, objectStore: store }), `${h.base}/retry`, { method: "POST", headers: { "X-WiseEff-User": "source-retry-admin" } });
      expect(queued.status, queued.bodyText).toBe(202);
      expect(await processNextSourceIndexJob({ db: worker, objectStore: store })).toBe("processed");
      expect((await read(h.skill.id, h.snapshot.id)).status).toBe("ready");
      await expect(api.query("delete from parameter_catalog.log_erasures")).rejects.toMatchObject({ code: "42501" });
    } finally { await api?.close(); await worker?.close(); await dropLabRuntimeLogins(database.url, token); }
  });
});
