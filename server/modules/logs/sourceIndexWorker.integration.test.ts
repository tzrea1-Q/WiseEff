import JSZip from "jszip";
import { gzipSync } from "node:zlib";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPostgresDatabase } from "../../shared/database/client";
import { createEphemeralTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import { createMemoryObjectStore } from "../../testing/objectStore";
import { insertLogDomain } from "./domainsRepository";
import { insertSkillRevision } from "./skillsRepository";
import { defaultSourceSnapshotLimits } from "./sourceArchive";
import { processNextSourceIndexJob } from "./sourceIndexWorker";
import { createObjectStoreFromEnv } from "../../objectStoreFactory";

const available = await isTestDatabaseAvailable();
describe.skipIf(!available)("source indexing over PostgreSQL", () => {
  it("indexes a tgz through the local runtime object-store factory", async () => {
    const ephemeral = await createEphemeralTestDatabase("srcfactory");
    const db = createPostgresDatabase(ephemeral.url);
    const root = await mkdtemp(join(tmpdir(), "wiseeff-source-factory-"));
    try {
      await seedCoreGraph(db, { organization: { id: "source-org" }, users: [{ id: "source-admin" }] });
      await db.transaction(async (tx) => {
        await insertLogDomain(tx, { id: "factory-skill", organizationId: "source-org", name: "factory-source" });
        await insertSkillRevision(tx, { skillId: "factory-skill", organizationId: "source-org", userId: "source-admin", spec: { schemaVersion: "skill/v1" }, published: true });
      });
      const payload = Buffer.from("int runtime_factory_source = 1;\n");
      const header = Buffer.alloc(512);
      header.write("src/runtime.c"); header.write("0000644\0", 100);
      header.write(`${payload.length.toString(8).padStart(11, "0")}\0`, 124);
      header.fill(32, 148, 156); header.write("0", 156); header.write("ustar\0", 257);
      header.write(`${header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0")}\0 `, 148);
      const bytes = gzipSync(Buffer.concat([header, payload, Buffer.alloc((512 - payload.length % 512) % 512 + 1024)]));
      // Separate factory instances mirror API upload and standalone worker startup.
      const env = { OBJECT_STORE_MODE: "local" as const, OBJECT_STORE_ROOT: root };
      const stored = await createObjectStoreFromEnv(env).put({ organizationId: "source-org", fileName: "source.tgz", contentType: "application/gzip", bytes });
      await db.query(`insert into log_source_snapshots(id,organization_id,skill_id,version_label,storage_key,file_name)
        values('factory-snapshot','source-org','factory-skill','v1',$1,'source.tgz')`, [stored.storageKey]);
      expect(await processNextSourceIndexJob({ db, objectStore: createObjectStoreFromEnv(env) })).toBe("processed");
      expect((await db.query(`select status,error,file_count from log_source_snapshots where id='factory-snapshot'`)).rows)
        .toEqual([{ status: "ready", error: null, file_count: 1 }]);
      expect((await db.query(`select path from log_source_files where snapshot_id='factory-snapshot'`)).rows).toEqual([{ path: "src/runtime.c" }]);
      expect((await db.query(`select content from log_source_chunks where snapshot_id='factory-snapshot'`)).rows).toEqual([{ content: payload.toString() }]);
    } finally { await db.close(); await ephemeral.drop(); await rm(root, { recursive: true, force: true }); }
  }, 120_000);
  it("streams allowed files, records skips, searches full-text/trigrams and rejects cross-org file/chunk references", async () => {
    const ephemeral = await createEphemeralTestDatabase("srcindex");
    const db = createPostgresDatabase(ephemeral.url), objectStore = createMemoryObjectStore();
    try {
      for (const organizationId of ["source-org", "other-org"]) {
        await seedCoreGraph(db, { organization: { id: organizationId }, users: [{ id: `${organizationId}-admin` }] });
        await db.transaction(async (tx) => {
          await insertLogDomain(tx, { id: `${organizationId}-skill`, organizationId, name: "source-index" });
          await insertSkillRevision(tx, { skillId: `${organizationId}-skill`, organizationId, userId: `${organizationId}-admin`, spec: { schemaVersion: "skill/v1" }, published: true });
        });
      }
      const zip = new JSZip();
      zip.file("src/main.c", "int thermal_shutdown(void) {\n return battery_overheat;\n}\n");
      zip.file("third_party/codec.c", "vendor code");
      zip.file("src/binary.c", Buffer.from([0, 1, 2]));
      zip.file("src/oversize.c", "x".repeat(101));
      zip.file("._source", Buffer.from([0, 5, 22, 7]));
      zip.file("src/._main.c", Buffer.from([0, 5, 22, 7]));
      zip.file("__MACOSX/ghost.c", "int metadata;");
      zip.file("src/.DS_Store", Buffer.from([0, 1, 2]));
      const stored = await objectStore.put({ organizationId: "source-org", fileName: "source.zip", contentType: "application/zip", bytes: await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }) });
      await db.query(`insert into log_source_snapshots(id,organization_id,skill_id,version_label,storage_key,file_name)
        values('snapshot','source-org','source-org-skill','v1',$1,'source.zip')`, [stored.storageKey]);
      const limits = { ...defaultSourceSnapshotLimits, maxFileBytes: 100 };
      expect(await processNextSourceIndexJob({ db, objectStore, limits })).toBe("processed");
      const snapshot = (await db.query(`select status,files_processed,files_total,file_count,skipped_count,skipped_files from log_source_snapshots where id='snapshot'`)).rows[0];
      expect(snapshot).toMatchObject({ status: "ready", files_processed: 4, files_total: 4, file_count: 1, skipped_count: 3,
        skipped_files: [{ path: "third_party/codec.c", reason: "第三方或忽略目录" }, { path: "src/binary.c", reason: "二进制或非 UTF-8 文件" }, { path: "src/oversize.c", reason: "超过单文件大小上限" }] });
      const files = (await db.query<{ id: string; path: string; line_count: number }>("select id,path,line_count from log_source_files where organization_id='source-org' and snapshot_id='snapshot'")).rows;
      expect(files).toEqual([{ id: expect.any(String), path: "src/main.c", line_count: 4 }]);
      expect((await db.query("select id from log_source_files where organization_id='other-org' and snapshot_id='snapshot'")).rows).toEqual([]);
      expect((await db.query("select id from log_source_chunks where organization_id='other-org' and snapshot_id='snapshot'")).rows).toEqual([]);
      expect((await db.query(`select content from log_source_chunks where organization_id='source-org' and snapshot_id='snapshot'
        and search_vector @@ plainto_tsquery('simple','battery_overheat')`)).rows).toHaveLength(1);
      expect((await db.query(`select content from log_source_chunks where organization_id='source-org' and snapshot_id='snapshot' and content ilike '%thermal_shutdown%'`)).rows).toHaveLength(1);
      const index = await db.query<{ indexdef: string }>("select indexdef from pg_indexes where indexname='log_source_chunks_trgm_idx'");
      expect(index.rows[0].indexdef).toContain("gin_trgm_ops");
      await expect(db.query(`insert into log_source_files(id,organization_id,snapshot_id,path,size_bytes,sha256,line_count,language)
        values('wrong-file','other-org','snapshot','bad.c',1,'hash',1,'c')`)).rejects.toMatchObject({ code: "23503" });
      await expect(db.query(`insert into log_source_chunks(id,organization_id,snapshot_id,file_id,start_line,end_line,content)
        values('wrong-chunk','other-org','snapshot',$1,1,1,'bad')`, [files[0].id])).rejects.toMatchObject({ code: "23503" });
      expect(await processNextSourceIndexJob({ db, objectStore })).toBe("idle");

      // Reclaim a crashed attempt and replace partial index rows once, rather than duplicate them.
      await db.query("update log_source_snapshots set status='indexing',index_attempt_id='crashed',updated_at=now()-interval '6 minutes' where id='snapshot'");
      expect(await processNextSourceIndexJob({ db, objectStore, limits })).toBe("processed");
      expect((await db.query("select id from log_source_files where snapshot_id='snapshot'")).rows).toHaveLength(1);
      expect((await db.query("select status from log_source_snapshots where id='snapshot'")).rows).toEqual([{ status: "ready" }]);

      // An archive write during object retrieval wins over the already-claimed worker.
      await db.query("update log_source_snapshots set status='queued' where id='snapshot'");
      const stream = objectStore.getStream!;
      objectStore.getStream = async (key) => {
        await db.query("update log_source_snapshots set status='archived' where id='snapshot'");
        return stream(key);
      };
      expect(await processNextSourceIndexJob({ db, objectStore, limits })).toBe("processed");
      expect((await db.query("select status from log_source_snapshots where id='snapshot'")).rows).toEqual([{ status: "archived" }]);
      expect((await db.query("select id from log_source_files where snapshot_id='snapshot'")).rows).toEqual([]);
    } finally { await db.close(); await ephemeral.drop(); }
  }, 120_000);

  it("marks corrupt archive jobs failed with a reason and removes any partial index", async () => {
    const ephemeral = await createEphemeralTestDatabase("srcfail");
    const db = createPostgresDatabase(ephemeral.url), objectStore = createMemoryObjectStore();
    try {
      await seedCoreGraph(db, { organization: { id: "source-org" }, users: [{ id: "source-admin" }] });
      await db.transaction(async (tx) => {
        await insertLogDomain(tx, { id: "source-skill", organizationId: "source-org", name: "source-failure" });
        await insertSkillRevision(tx, { skillId: "source-skill", organizationId: "source-org", userId: "source-admin", spec: { schemaVersion: "skill/v1" }, published: true });
      });
      const zip = new JSZip(); zip.file("first.c", "int first = 1;\n"); zip.file("broken.c", "int second = 2;\n");
      const bytes = await zip.generateAsync({ type: "nodebuffer" });
      const lastHeader = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
      bytes.writeUInt32LE(0, lastHeader + 16); // Fail CRC after the first file was persisted.
      const stored = await objectStore.put({ organizationId: "source-org", fileName: "broken.zip", contentType: "application/zip", bytes });
      await db.query(`insert into log_source_snapshots(id,organization_id,skill_id,version_label,storage_key,file_name)
        values('snapshot','source-org','source-skill','v1',$1,'broken.zip')`, [stored.storageKey]);
      expect(await processNextSourceIndexJob({ db, objectStore })).toBe("processed");
      expect((await db.query("select status,error,file_count from log_source_snapshots where id='snapshot'")).rows[0]).toEqual({ status: "failed", error: expect.stringContaining("zip"), file_count: 0 });
      expect((await db.query("select id from log_source_files where snapshot_id='snapshot'")).rows).toEqual([]);
    } finally { await db.close(); await ephemeral.drop(); }
  }, 120_000);
});
