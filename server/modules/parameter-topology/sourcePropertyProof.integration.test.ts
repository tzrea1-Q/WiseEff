import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import type { Queryable } from "../../shared/database/client";
import { makeTestAuthContext } from "../../testing/authContext";
import { createLocalObjectStore } from "../logs/objectStore";
import { loadExactSourceRevisionForProof, lockExactSourceRevisionsForProof } from "../parameter-files/sourceVersion";
import { ingestConfigRevision } from "./ingestService";
import { proveExactDtsProperty, type ExactDtsSourceIdentity } from "./sourcePropertyProof";
import type { ConfigRevisionManifest } from "./types";

describe("exact DTS source value proof before pin creation", () => {
  let database: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>;
  let directory: string;
  let storage: ReturnType<typeof createLocalObjectStore>;
  let identity: ExactDtsSourceIdentity;
  const organizationId = "org-source-proof", projectId = "project-source-proof", configSetId = "set-source-proof", userId = "user-source-proof";
  const overlay = "/* 🧪 */\n&other { limit = <7>; };\n&charger { /delete-property/ limit; limit = <7>; };\n";

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("exactsourceproof");
    db = createPostgresDatabase(database.url);
    directory = await mkdtemp(join(tmpdir(), "wiseeff-exact-source-proof-"));
    storage = createLocalObjectStore(directory);
    await db.query(`insert into organizations(id,name) values ($1,'Source proof')`, [organizationId]);
    await db.query(`insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Source author','Admin',true)`, [userId,organizationId]);
    await db.query(`insert into projects(id,organization_id,name,code,status) values ($1,$2,'Source proof','SP','initialized')`, [projectId,organizationId]);
    await db.query(`insert into dts_config_set(id,organization_id,project_id,name) values ($1,$2,$3,'Source proof')`, [configSetId,organizationId,projectId]);
    const manifest: ConfigRevisionManifest = { organizationId,projectId,configSetId,entryFile: "board.dts",includeSearchPaths: [],overlayOrder: ["change.dtso"],members: [] };
    for (const [index, file] of [
      { name: "board.dts",content: '/dts-v1/;\n/include/ "base.dtsi";\n/include/ "extra.dtsi";\n/include/ "extra.dtsi";\n',role: "base" as const },
      { name: "base.dtsi",content: "/ { charger: device@0 { limit = <5>; }; other: other { limit = <5>; }; };\n",role: "include" as const },
      { name: "change.dtso",content: overlay,role: "overlay" as const },
      { name: "extra.dtsi",content: '/ { plain { limit = <1 2>; }; };\n',role: "include" as const },
    ].entries()) {
      const fileId = `file-proof-${index}`, fileVersionId = `version-proof-${index}`;
      const object = await storage.put({ organizationId,fileName: file.name,contentType: "text/plain",bytes: Buffer.from(file.content) });
      await db.query(`insert into project_parameter_files(id,organization_id,project_id,file_name,format,config_set_id,config_set_role,config_set_sort_order)
        values ($1,$2,$3,$4,'dts',$5,$6,$7)`, [fileId,organizationId,projectId,file.name,configSetId,file.role,index]);
      await db.query(`insert into project_parameter_file_versions(id,file_id,version_number,storage_key,checksum,size_bytes,parsed_index,origin,created_by_user_id)
        values ($1,$2,1,$3,$4,$5,'{}'::jsonb,'upload',$6)`, [fileVersionId,fileId,object.storageKey,object.checksumSha256,object.fileSizeBytes,userId]);
      await db.query(`update project_parameter_files set current_version_id=$2 where id=$1`, [fileId,fileVersionId]);
      manifest.members.push({ fileId,fileVersionId,fileName: file.name,sourceName: file.name,content: file.content,role: file.role,sortOrder: index });
    }
    const auth = makeTestAuthContext({ userId,organizationId,permissions: ["parameter:view","parameter:edit","parameter:review","admin:access"] });
    const revision = await ingestConfigRevision(db,manifest,auth);
    expect(revision.status).toBe("resolved");
    const rows = (await db.query<{ logicalNodeId: string; nodeOccurrenceId: string; propertyOccurrenceId: string }>(
      `select logical.logical_node_id as "logicalNodeId",effect.node_occurrence_id as "nodeOccurrenceId",effect.property_occurrence_id as "propertyOccurrenceId"
       from dts_occurrence_effects effect join dts_logical_node_revisions logical on logical.id=effect.logical_node_revision_id
       where effect.config_revision_id=$1 and logical.node_locator='/device@0' and effect.property_name='limit'
       order by effect.source_order desc`, [revision.id],
    )).rows;
    identity = { organizationId,projectId,configSetId,configRevisionId: revision.id,fileId: "file-proof-2",fileVersionId: "version-proof-2",propertyName: "limit",...rows[0]! };
    await db.query(`insert into project_parameter_files(id,organization_id,project_id,file_name,format,config_set_id,config_set_role,config_set_sort_order)
      values ('file-proof-unused',$1,$2,'unused.dtsi','dts',$3,'include',4)`, [organizationId,projectId,configSetId]);
    await db.query(`insert into project_parameter_file_versions(id,file_id,version_number,storage_key,checksum,size_bytes,parsed_index,origin,created_by_user_id)
      select 'version-proof-unused','file-proof-unused',1,storage_key,checksum,size_bytes,parsed_index,origin,created_by_user_id
      from project_parameter_file_versions where id='version-proof-3'`);
  }, 60_000);

  afterAll(async () => {
    await db?.close(); await database?.drop();
    if (directory) await rm(directory,{ recursive: true,force: true });
  });

  it("proves the full delete and alias overlay chain without confusing a same-valued sibling or requiring a pin", async () => {
    const proof = await db.transaction(async (tx) => {
      await lockExactSourceRevisionsForProof(tx,[identity]);
      return proveExactDtsProperty(tx,storage,identity);
    });
    expect(proof).toMatchObject({ sourceName: "change.dtso",nodeLocator: "/device@0",fileVersionId: "version-proof-2",sourceSpan: { start: overlay.lastIndexOf("<7>"),end: overlay.lastIndexOf("<7>") + 3 },
      value: { kind: "cells",bits: 32,groups: [[{ kind: "integer",raw: "7",value: "7" }]] } });
  });

  it("refuses an unpinned property row whose value differs from the immutable object", async () => {
    await expect(db.transaction(async (tx) => {
      await lockExactSourceRevisionsForProof(tx,[identity]);
      await tx.query(`update dts_property_occurrences set raw_text='<9>' where id=$1`, [identity.propertyOccurrenceId]);
      return proveExactDtsProperty(tx,storage,identity);
    })).rejects.toMatchObject({ code: "CONFLICT",details: { reason: "source-proof-invalid" } });
    const proof = await db.transaction(async (tx) => {
      await lockExactSourceRevisionsForProof(tx,[identity]);
      return proveExactDtsProperty(tx,storage,identity);
    });
    expect(proof.value).toMatchObject({ kind: "cells",groups: [[{ value: "7" }]] });
  });

  it("reuses one original occurrence for repeated includes and preserves non-scalar cells", async () => {
    const rows = (await db.query<{ logicalNodeId: string; nodeOccurrenceId: string; propertyOccurrenceId: string }>(
      `select logical.logical_node_id as "logicalNodeId",effect.node_occurrence_id as "nodeOccurrenceId",effect.property_occurrence_id as "propertyOccurrenceId"
       from dts_occurrence_effects effect join dts_logical_node_revisions logical on logical.id=effect.logical_node_revision_id
       where effect.config_revision_id=$1 and logical.node_locator='/plain' and effect.property_name='limit' order by effect.source_order`, [identity.configRevisionId],
    )).rows;
    expect(rows).toHaveLength(2);
    expect(rows[0]!.propertyOccurrenceId).toBe(rows[1]!.propertyOccurrenceId);
    const repeated = { ...identity,...rows[1]!,fileId: "file-proof-3",fileVersionId: "version-proof-3" };
    const proof = await db.transaction(async (tx) => {
      await lockExactSourceRevisionsForProof(tx,[repeated]);
      return proveExactDtsProperty(tx,storage,repeated);
    });
    expect(proof.value).toMatchObject({ kind: "cells",groups: [[{ value: "1" },{ value: "2" }]] });
  });

  it.each([
    ["missing object", (tx: Queryable) => tx.query(`update project_parameter_file_versions set storage_key='missing-proof-object' where id=$1`,[identity.fileVersionId])],
    ["changed checksum", (tx: Queryable) => tx.query(`update project_parameter_file_versions set checksum=repeat('a',64) where id=$1`,[identity.fileVersionId])],
    ["changed length", (tx: Queryable) => tx.query(`update project_parameter_file_versions set size_bytes=size_bytes+1 where id=$1`,[identity.fileVersionId])],
    ["changed original span", (tx: Queryable) => tx.query(`update dts_property_occurrences set start_offset=start_offset+1 where id=$1`,[identity.propertyOccurrenceId])],
    ["missing delete effect", (tx: Queryable) => tx.query(`update dts_occurrence_effects set property_name='different-property' where config_revision_id=$1 and effect_kind='delete'`,[identity.configRevisionId])],
    ["tied effect order", (tx: Queryable) => tx.query(`update dts_occurrence_effects set source_order=0 where config_revision_id=$1`,[identity.configRevisionId])],
    ["invalid include path metadata", (tx: Queryable) => tx.query(`update dts_config_revisions set include_search_paths='[42]'::jsonb where id=$1`,[identity.configRevisionId])],
    ["invalid overlay path metadata", (tx: Queryable) => tx.query(`update dts_config_revisions set overlay_order='[42]'::jsonb where id=$1`,[identity.configRevisionId])],
  ] as const)("refuses %s and rolls back all attempted changes", async (_label,mutate) => {
    await expect(db.transaction(async (tx) => {
      await lockExactSourceRevisionsForProof(tx,[identity]);
      const mutation = await mutate(tx);
      expect(mutation.rowCount).toBeGreaterThan(0);
      return proveExactDtsProperty(tx,storage,identity);
    })).rejects.toMatchObject({ code: "CONFLICT",details: { reason: "source-proof-invalid" } });
  });

  it("rejects an invalid persisted manifest before reading any source object", async () => {
    const boundedRead = vi.spyOn(storage, "getBounded");
    try {
      await expect(db.transaction(async (tx) => {
        await lockExactSourceRevisionsForProof(tx,[identity]);
        await tx.query(`update dts_config_revisions set overlay_order='[42]'::jsonb where id=$1`, [identity.configRevisionId]);
        return proveExactDtsProperty(tx,storage,identity);
      })).rejects.toMatchObject({ code: "CONFLICT",details: { reason: "source-proof-invalid" } });
      expect(boundedRead).not.toHaveBeenCalled();
    } finally {
      boundedRead.mockRestore();
    }
  });

  it("refuses a foreign project even when every occurrence ID is real", async () => {
    await expect(db.transaction(async (tx) => {
      await lockExactSourceRevisionsForProof(tx,[identity]);
      return proveExactDtsProperty(tx,storage,{ ...identity,projectId: "foreign-project" });
    })).rejects.toMatchObject({ code: "CONFLICT",details: { reason: "source-proof-invalid" } });
  });

  it("rejects control characters in include roots at the shared pre-pin reader", async () => {
    const boundedRead = vi.spyOn(storage, "getBounded");
    try {
      await expect(db.transaction(async (tx) => {
        await tx.query(`update dts_config_revisions set include_search_paths=$2::jsonb where id=$1`,
          [identity.configRevisionId,JSON.stringify([".\u0001"])]);
        return loadExactSourceRevisionForProof(tx,storage,identity);
      })).rejects.toMatchObject({ code: "CONFLICT",details: { reason: "source-proof-invalid" } });
      expect(boundedRead).not.toHaveBeenCalled();
    } finally { boundedRead.mockRestore(); }
  });

  it.each(["validated", "compiled", "pending_approval"])("proves exact source after the legitimate %s transition", async (status) => {
    const rollback = new Error("rollback proof probe");
    await expect(db.transaction(async (tx) => {
      await lockExactSourceRevisionsForProof(tx,[identity]);
      await tx.query(`update dts_config_revisions set status=$2 where id=$1`, [identity.configRevisionId,status]);
      expect((await proveExactDtsProperty(tx,storage,identity)).value).toMatchObject({ kind: "cells",groups: [[{ value: "7" }]] });
      throw rollback;
    })).rejects.toBe(rollback);
  });

  it.each(["draft", "resolving", "needs_mapping", "invalid", "validation_failed"])("refuses pre-pin proof in %s state", async (status) => {
    await expect(db.transaction(async (tx) => {
      await lockExactSourceRevisionsForProof(tx,[identity]);
      await tx.query(`update dts_config_revisions set status=$2 where id=$1`, [identity.configRevisionId,status]);
      return proveExactDtsProperty(tx,storage,identity);
    })).rejects.toMatchObject({ code: "CONFLICT",details: { reason: "source-proof-invalid" } });
  });

  it("allows a real unpinned delete and then refuses its incomplete source chain", async () => {
    await expect(db.transaction(async (tx) => {
      await lockExactSourceRevisionsForProof(tx,[identity]);
      const removed = await tx.query(`delete from dts_occurrence_effects where config_revision_id=$1 and effect_kind='delete' returning id`, [identity.configRevisionId]);
      expect(removed.rowCount).toBe(1);
      return proveExactDtsProperty(tx,storage,identity);
    })).rejects.toMatchObject({ code: "CONFLICT",details: { reason: "source-proof-invalid" } });
  });

  it("refuses a malformed non-target member even when resolution never visits that member", async () => {
    const object = await storage.put({ organizationId,fileName: "unused.dtsi",contentType: "text/plain",bytes: Buffer.from("/ { broken {") });
    await expect(db.transaction(async (tx) => {
      await tx.query(`update project_parameter_file_versions set storage_key=$1,checksum=$2,size_bytes=$3 where id='version-proof-unused'`,
        [object.storageKey,object.checksumSha256,object.fileSizeBytes]);
      await tx.query(`insert into dts_config_revision_members(id,config_revision_id,file_id,file_version_id,role,sort_order,source_name)
        values ('invalid-non-target-proof-member',$1,'file-proof-unused','version-proof-unused','include',4,'unused.dtsi')`, [identity.configRevisionId]);
      await lockExactSourceRevisionsForProof(tx,[identity]);
      return proveExactDtsProperty(tx,storage,identity);
    })).rejects.toMatchObject({ code: "CONFLICT",details: { reason: "source-proof-invalid" } });
  });

  it.each([
    ["missing entry", "entry_file", "missing.dts"],
    ["non-base entry", "entry_file", "base.dtsi"],
    ["missing overlay", "overlay_order", ["missing.dtso"]],
    ["non-overlay member", "overlay_order", ["board.dts"]],
    ["duplicate overlay", "overlay_order", ["change.dtso","change.dtso"]],
    ["escaping include", "include_search_paths", ["../outside"]],
    ["malformed includes", "include_search_paths", [42]],
  ] as const)("rejects %s in the shared reader before object access", async (_label,column,value) => {
    const boundedRead = vi.spyOn(storage,"getBounded");
    try {
      await expect(db.transaction(async (tx) => {
        if (column === "entry_file") {
          await tx.query("update dts_config_revisions set entry_file=$2 where id=$1",[identity.configRevisionId,value]);
        } else if (column === "overlay_order") {
          await tx.query("update dts_config_revisions set overlay_order=$2::jsonb where id=$1",[identity.configRevisionId,JSON.stringify(value)]);
        } else {
          await tx.query("update dts_config_revisions set include_search_paths=$2::jsonb where id=$1",[identity.configRevisionId,JSON.stringify(value)]);
        }
        return loadExactSourceRevisionForProof(tx,storage,identity);
      })).rejects.toMatchObject({ code: "CONFLICT",details: { reason: "source-proof-invalid" } });
      expect(boundedRead).not.toHaveBeenCalled();
    } finally { boundedRead.mockRestore(); }
  });

  it.each([[],["."]])("preserves the stored include roots %j while resolving the same historical source", async (...paths) => {
    const includeSearchPaths = paths as string[];
    const rollback = new Error("rollback include compatibility probe");
    await expect(db.transaction(async (tx) => {
      await tx.query(`update dts_config_revisions set include_search_paths=$2::jsonb where id=$1`,
        [identity.configRevisionId,JSON.stringify(includeSearchPaths)]);
      const source = await loadExactSourceRevisionForProof(tx,storage,identity);
      expect(source.revision.includeSearchPaths).toEqual(includeSearchPaths);
      expect(source.members.find((member) => member.fileVersionId === identity.fileVersionId)?.content).toBe(overlay);
      expect((await proveExactDtsProperty(tx,storage,identity)).value).toMatchObject({ kind: "cells",groups: [[{ value: "7" }]] });
      expect((await tx.query(`select include_search_paths from dts_config_revisions where id=$1`,[identity.configRevisionId])).rows[0]?.include_search_paths).toEqual(includeSearchPaths);
      throw rollback;
    })).rejects.toBe(rollback);
  });

  it("reports the explicit proof limit when repeated includes exceed the syntax visit budget", async () => {
    // Duplicate overlays are now refused as malformed manifests. Repeated includes
    // remain legal, so exercise the unchanged resolver budget with a valid manifest.
    const object = await storage.put({ organizationId,fileName: "large-board.dts",contentType: "text/plain",
      bytes: Buffer.from('/dts-v1/;\n' + '/include/ "extra.dtsi";\n'.repeat(100)) });
    // Two shallow include levels keep parsing small while retaining 35,000
    // repeated expansions; this tests the visit budget, not parser throughput.
    const includes = await storage.put({ organizationId,fileName: "many-includes.dtsi",contentType: "text/plain",
      bytes: Buffer.from('/include/ "base.dtsi";\n'.repeat(350)) });
    await expect(db.transaction(async (tx) => {
      await lockExactSourceRevisionsForProof(tx,[identity]);
      await tx.query(`update project_parameter_file_versions set storage_key=$1,checksum=$2,size_bytes=$3 where id='version-proof-0'`,
        [object.storageKey,object.checksumSha256,object.fileSizeBytes]);
      await tx.query(`update project_parameter_file_versions set storage_key=$1,checksum=$2,size_bytes=$3 where id='version-proof-3'`,
        [includes.storageKey,includes.checksumSha256,includes.fileSizeBytes]);
      return proveExactDtsProperty(tx,storage,identity);
    })).rejects.toMatchObject({ code: "CONFLICT",details: { reason: "source-proof-limit" } });
  });

  it("bounds manifest locator metadata before normalization", async () => {
    await expect(db.transaction(async (tx) => {
      await lockExactSourceRevisionsForProof(tx,[identity]);
      await tx.query(`update dts_config_revisions set include_search_paths=jsonb_build_array(repeat('x',8*1024*1024)) where id=$1`, [identity.configRevisionId]);
      return proveExactDtsProperty(tx,storage,identity);
    })).rejects.toMatchObject({ code: "CONFLICT",details: { reason: "source-proof-limit" } });
  });

  it("fences unpinned version metadata, member aliases and inserted effects through real PostgreSQL locks", async () => {
    const other = await getRootPostgresPool(db)!.connect();
    try {
      await db.transaction(async (tx) => {
        await lockExactSourceRevisionsForProof(tx,[identity]);
        for (const mutate of [
          () => other.query(`update project_parameter_file_versions set checksum=repeat('a',64) where id=$1`, [identity.fileVersionId]),
          () => other.query(`update dts_config_revision_members set source_name='other.dtso' where config_revision_id=$1 and file_id=$2`, [identity.configRevisionId,identity.fileId]),
          () => other.query(`insert into dts_config_revision_members(id,config_revision_id,file_id,file_version_id,role,sort_order,source_name)
              values ('competing-proof-member',$1,'file-proof-unused','version-proof-unused','include',4,'unused.dtsi')`, [identity.configRevisionId]),
          () => other.query(`insert into dts_occurrence_effects(id,config_revision_id,logical_node_revision_id,property_name,effect_kind,node_occurrence_id,property_occurrence_id,source_order)
              select 'competing-proof-effect',config_revision_id,logical_node_revision_id,property_name,effect_kind,node_occurrence_id,property_occurrence_id,source_order+100
              from dts_occurrence_effects where property_occurrence_id=$1`, [identity.propertyOccurrenceId]),
        ]) {
          await other.query("begin");
          try {
            await other.query("set local lock_timeout='100ms'");
            await expect(mutate()).rejects.toMatchObject({ code: "55P03" });
          } finally { await other.query("rollback"); }
        }
        expect((await proveExactDtsProperty(tx,storage,identity)).value).toMatchObject({ kind: "cells",groups: [[{ value: "7" }]] });
      });
      await other.query("begin");
      try {
        await other.query(`update project_parameter_file_versions set size_bytes=size_bytes where id=$1`, [identity.fileVersionId]);
        await expect(db.transaction((tx) => lockExactSourceRevisionsForProof(tx,[identity])))
          .rejects.toMatchObject({ code: "CONFLICT",details: { reason: "source-proof-busy" } });
      } finally { await other.query("rollback"); }
      await other.query("begin");
      try {
        await other.query(`insert into dts_config_revision_members(id,config_revision_id,file_id,file_version_id,role,sort_order,source_name)
          values ('inflight-proof-member',$1,'file-proof-unused','version-proof-unused','include',4,'unused.dtsi')`, [identity.configRevisionId]);
        await expect(db.transaction((tx) => lockExactSourceRevisionsForProof(tx,[identity])))
          .rejects.toMatchObject({ code: "CONFLICT",details: { reason: "source-proof-busy" } });
      } finally { await other.query("rollback"); }
    } finally { other.release(); }
  });
});
