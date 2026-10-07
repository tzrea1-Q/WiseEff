import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createInMemoryTestDatabase, type InMemoryTestDatabase } from "../../testing/testDatabase";
import { normalizePersistedManifest } from "./configRevisionManifest";
import { getConfigRevisionById, listConfigRevisionMembers } from "./repository";
import type { ConfigRevisionManifestMember } from "./types";

describe("native revision member source aliases (PostgreSQL reader and manifest)", () => {
  let db: InMemoryTestDatabase;
  const revisionId = "alias-revision";

  beforeEach(async () => {
    // Connection failure is a failure, never skipped PostgreSQL evidence.
    db = await createInMemoryTestDatabase();
    await db.query("insert into organizations(id,name) values ('alias-org','Alias reader')");
    await db.query(`insert into projects(id,organization_id,name,code,status)
      values ('alias-project','alias-org','Alias reader','ALIAS','initialized')`);
    await db.query(`insert into dts_config_set(id,organization_id,project_id,name)
      values ('alias-set','alias-org','alias-project','Alias reader')`);
    await db.query(`insert into dts_config_revisions
      (id,organization_id,project_id,config_set_id,revision_number,status,entry_file,include_search_paths,overlay_order)
      values ($1,'alias-org','alias-project','alias-set',1,'draft','cfg/base.dts','["cfg","."]','["cfg/z.dtso","cfg/a.dtso"]')`,
    [revisionId]);
  });

  afterEach(async () => { await db?.rollback(); });

  async function addMember(id: string, display: string, alias: string | null,
    role: ConfigRevisionManifestMember["role"], sortOrder: number) {
    const row = { fileId: id, fileVersionId: `${id}-v1`, role, sortOrder,
      fileName: alias ?? display, checksum: `checksum-${id}`, storageKey: `alias-storage/${id}`,
      parsedIndex: { marker: id, nested: [sortOrder] } };
    await db.query(`insert into project_parameter_files
      (id,organization_id,project_id,file_name,format,config_set_id,config_set_role,config_set_sort_order)
      values ($1,'alias-org','alias-project',$2,'dts','alias-set',$3,$4)`, [id,display,role,sortOrder]);
    await db.query(`insert into project_parameter_file_versions
      (id,file_id,version_number,storage_key,checksum,size_bytes,parsed_index,origin)
      values ($1,$2,1,$3,$4,12,$5::jsonb,'upload')`,
    [row.fileVersionId,id,row.storageKey,row.checksum,JSON.stringify(row.parsedIndex)]);
    await db.query("update project_parameter_files set current_version_id=$2 where id=$1", [id,row.fileVersionId]);
    await db.query(`insert into dts_config_revision_members
      (id,config_revision_id,file_id,file_version_id,role,sort_order,source_name)
      values ($1,$2,$3,$4,$5,$6,$7)`, [`${id}-member`,revisionId,id,row.fileVersionId,role,sortOrder,alias]);
    return row;
  }

  async function manifestInput() {
    const revision = await getConfigRevisionById(db, { organizationId: "alias-org", revisionId });
    if (!revision) throw new Error("Missing fixture revision");
    const rows = await listConfigRevisionMembers(db, revisionId);
    return { entryFile: revision.entryFile ?? "", includeSearchPaths: revision.includeSearchPaths ?? [],
      overlayOrder: revision.overlayOrder ?? [],
      members: rows.map((row): ConfigRevisionManifestMember => ({ ...row,
        role: row.role as ConfigRevisionManifestMember["role"], content: "" })) };
  }

  it("reloads immutable entry/include/overlay aliases, full geometry and actual Map namespace", async () => {
    const base = await addMember("base", "display-base.dts", "cfg/base.dts", "base", 0);
    const include = await addMember("include", "display-inc.dtsi", "cfg/inc.dtsi", "include", 1);
    const z = await addMember("z", "a-display.dtso", "cfg/z.dtso", "overlay", 2);
    const a = await addMember("a", "z-display.dtso", "cfg/a.dtso", "overlay", 2);
    const rows = await listConfigRevisionMembers(db, revisionId);
    const files = new Map(rows.map((row) => [row.fileName, row.fileVersionId]));
    expect([...files]).toEqual([["cfg/base.dts","base-v1"],["cfg/inc.dtsi","include-v1"],
      ["cfg/z.dtso","z-v1"],["cfg/a.dtso","a-v1"]]);
    expect(files.get("cfg/base.dts")).toBe(base.fileVersionId);
    expect(files.get("cfg/inc.dtsi")).toBe(include.fileVersionId);
    expect(files.has("display-base.dts")).toBe(false);
    expect(rows).toEqual([base,include,z,a]); // SQL tie order still uses mutable display names.
    expect(normalizePersistedManifest(await manifestInput())).toEqual({ ok: true,
      manifest: { entryFile: "cfg/base.dts", includeSearchPaths: ["cfg","."],
        overlayOrder: ["cfg/z.dtso","cfg/a.dtso"] } });

    // The service's existing comparator, using actual rows; this does not execute the service.
    await db.query("update dts_config_revisions set overlay_order='[]'::jsonb where id=$1", [revisionId]);
    const empty = await manifestInput();
    expect(empty.overlayOrder).toEqual([]);
    empty.overlayOrder = rows.filter((row) => row.role === "overlay")
      .sort((a,b) => a.sortOrder - b.sortOrder || a.fileName.localeCompare(b.fileName))
      .map((row) => row.fileName);
    expect(empty.overlayOrder).toEqual(["cfg/a.dtso","cfg/z.dtso"]);
    expect(normalizePersistedManifest(empty)).toMatchObject({ ok: true,
      manifest: { overlayOrder: ["cfg/a.dtso","cfg/z.dtso"] } });
    expect(await listConfigRevisionMembers(db, "absent-revision")).toEqual([]);
  });

  it("keeps non-NULL frozen aliases across a legal display rename", async () => {
    const base = await addMember("base", "display-base.dts", "cfg/base.dts", "base", 0);
    const include = await addMember("include", "display-inc.dtsi", "cfg/inc.dtsi", "include", 1);
    await db.query("update project_parameter_files set file_name='renamed-base.dts' where id='base'");
    await db.query("update project_parameter_files set file_name='renamed-inc.dtsi' where id='include'");
    expect(await listConfigRevisionMembers(db, revisionId)).toEqual([base,include]);
    expect(normalizePersistedManifest(await manifestInput())).toMatchObject({ ok: true });
  });

  it("retains distinct legacy NULL aliases as display-name fallback", async () => {
    const base = await addMember("base", "cfg/base.dts", null, "base", 0);
    const include = await addMember("include", "cfg/inc.dtsi", null, "include", 1);
    expect(await listConfigRevisionMembers(db, revisionId)).toEqual([base,include]);
    expect(normalizePersistedManifest(await manifestInput())).toMatchObject({ ok: true });
  });

  it("refuses a same-revision mixed NULL/non-NULL logical alias collision", async () => {
    await addMember("base", "cfg/base.dts", null, "base", 0);
    await addMember("include", "display-inc.dtsi", "cfg/base.dts", "include", 1);
    const input = await manifestInput();
    expect(input.members.map((row) => row.fileName)).toEqual(["cfg/base.dts","cfg/base.dts"]);
    expect(normalizePersistedManifest(input)).toEqual({ ok: false, failure: {
      code: "duplicate-member-path", message: "Ambiguous logical member path in config revision manifest: cfg/base.dts" } });
  });

  it("refuses a collision caused by a legal NULL-fallback display rename", async () => {
    await addMember("base", "cfg/base.dts", "cfg/base.dts", "base", 0);
    await addMember("include", "legacy-inc.dtsi", null, "include", 1);
    await addMember("overlay", "display-overlay.dtso", "cfg/next.dtso", "overlay", 2);
    expect(normalizePersistedManifest(await manifestInput())).toMatchObject({ ok: true });
    await db.query("update project_parameter_files set file_name='cfg/next.dtso' where id='include'");
    expect(normalizePersistedManifest(await manifestInput())).toMatchObject({ ok: false,
      failure: { code: "duplicate-member-path", message: expect.stringContaining("cfg/next.dtso") } });
  });

  it("refuses normalized duplicate paths from actual mixed reader rows", async () => {
    await addMember("base", "cfg/base.dts", "cfg/base.dts", "base", 0);
    await addMember("include", "cfg/./inc.dtsi", null, "include", 1);
    await addMember("second", "display-inc.dtsi", "cfg/inc.dtsi", "include", 2);
    expect(normalizePersistedManifest(await manifestInput())).toMatchObject({ ok: false,
      failure: { code: "duplicate-member-path", message: expect.stringContaining("cfg/inc.dtsi") } });
  });

  it("normalizes sourceName before fileName in the shared helper", async () => {
    await addMember("base", "cfg/base.dts", null, "base", 0);
    await addMember("include", "display-inc.dtsi", null, "include", 1);
    const input = await manifestInput();
    input.members[1]!.sourceName = "cfg/./base.dts";
    expect(normalizePersistedManifest(input)).toMatchObject({ ok: false,
      failure: { code: "duplicate-member-path", message: expect.stringContaining("cfg/base.dts") } });
  });

  it.each(["missing-entry-file","missing-base","include-escape","overlay-escape"] as const)
    ("preserves %s priority before a duplicate", async (kind) => {
      await addMember("base", "cfg/base.dts", null, "base", 0);
      await addMember("include", "display-inc.dtsi", "cfg/base.dts", "include", 1);
      const input = await manifestInput();
      if (kind === "missing-entry-file") input.entryFile = "missing.dts";
      if (kind === "missing-base") input.members[0]!.role = "include";
      if (kind === "include-escape") input.includeSearchPaths = ["../escape"];
      if (kind === "overlay-escape") input.overlayOrder = ["../escape"];
      const result = normalizePersistedManifest(input);
      expect(result).toMatchObject({ ok: false, failure: {
        code: kind.endsWith("escape") ? "path-escape" : kind } });
      if (kind === "include-escape") expect(result).toMatchObject({ failure: {
        message: expect.stringContaining("Include search path") } });
      if (kind === "overlay-escape") expect(result).toMatchObject({ failure: {
        message: expect.stringContaining("Overlay path") } });
    });

  it("keeps multiple invalid nonentry normalized NULL paths outside duplicate policy", async () => {
    await addMember("base", "cfg/base.dts", null, "base", 0);
    await addMember("include", "../inc.dtsi", null, "include", 1);
    await addMember("second", "/abs.dtsi", null, "include", 2);
    expect(normalizePersistedManifest(await manifestInput())).toMatchObject({ ok: true });
  });
});
