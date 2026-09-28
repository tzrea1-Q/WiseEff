import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { createPostgresDatabase, createSavepointDatabase, getRootPostgresPool, type Queryable } from "../../shared/database/client";
import { makeTestAuthContext } from "../../testing/authContext";
import { installDriverSourceFixture } from "../../testing/parameterCatalog/driverSource";
import { insertDtsObservationSourceFixture, loadDtsObservationSourceFixture } from "../../testing/parameterCatalog/dtsObservationSource";
import { captureConfigurationSourceState } from "../../testing/parameterCatalog/configurationSource";
import { createLocalObjectStore } from "../logs/objectStore";
import { listCatalogBindingRowsForProject } from "../parameter-bindings/catalogProjectValueSync";
import { ingestConfigRevision } from "./ingestService";
import { readCurrentDtsCompatibleSource, type CurrentDtsCompatibleSourceInput } from "./currentDtsCompatibleSource";
import type { ConfigRevisionManifest } from "./types";

const ORG = "org-d897-source-read", PROJECT = "project-d897-source-read", USER = "user-d897-source-read";
const auth = makeTestAuthContext({ userId: USER, organizationId: ORG,
  permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
  roles: [{ roleId: "admin", projectId: null }] });
const viewer = makeTestAuthContext({ userId: "viewer-d897", organizationId: ORG,
  permissions: ["parameter:view"], roles: [{ roleId: "software-user", projectId: PROJECT }] });
const FOREIGN = makeTestAuthContext({ userId: "foreign-d897", organizationId: "org-foreign-d897",
  permissions: ["parameter:view"], roles: [{ roleId: "admin", projectId: null }] });
const NO_VIEW = makeTestAuthContext({ userId: "no-view-d897", organizationId: ORG,
  permissions: [], roles: [{ roleId: "software-user", projectId: PROJECT }] });
const base = (includeName: string) => `/dts-v1/;\n/include/ "${includeName}";\n`;
const source = (limit: number, compatibles: string | null) =>
  `/ { device@0 { ${compatibles === null ? "" : `compatible = ${compatibles}; `}limit = <${limit}>; }; };\n`;

describe("#897 source-owned DTS compatible currentness without Binding pins", () => {
  let lane: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>;
  let directory: string;
  let storage: ReturnType<typeof createLocalObjectStore>;
  let releaseId: string;
  let first: Awaited<ReturnType<typeof createSet>>;
  let second: Awaited<ReturnType<typeof createSet>>;
  let absent: Awaited<ReturnType<typeof createSet>>;
  let candidate: Awaited<ReturnType<typeof observe>>;
  let nextVersionId: string;

  async function version(fileId: string, versionNumber: number, name: string, content: string) {
    const object = await storage.put({ organizationId: ORG, fileName: name,
      contentType: "text/plain", bytes: Buffer.from(content) });
    const id = `${fileId}-v${versionNumber}`;
    await db.query(`insert into project_parameter_file_versions
      (id,file_id,version_number,storage_key,checksum,size_bytes,parsed_index,origin,created_by_user_id)
      values ($1,$2,$3,$4,$5,$6,'{}'::jsonb,'upload',$7)`,
      [id,fileId,versionNumber,object.storageKey,object.checksumSha256,object.fileSizeBytes,USER]);
    await db.query("update project_parameter_files set current_version_id=$2 where id=$1", [fileId,id]);
    return { id, content, storageKey: object.storageKey };
  }

  async function observe(manifest: ConfigRevisionManifest) {
    const revision = await ingestConfigRevision(db, manifest, auth, { legacyProjection: "skip" });
    expect(revision.status).toBe("resolved");
    const rows = (await db.query<{ logicalNodeId: string; nodeOccurrenceId: string;
      propertyOccurrenceId: string; fileVersionId: string }>(
      `select logical.logical_node_id as "logicalNodeId",effect.node_occurrence_id as "nodeOccurrenceId",
        effect.property_occurrence_id as "propertyOccurrenceId",property.file_version_id as "fileVersionId"
       from dts_occurrence_effects effect
       join dts_logical_node_revisions logical on logical.id=effect.logical_node_revision_id
       join dts_property_occurrences property on property.id=effect.property_occurrence_id
       where effect.config_revision_id=$1 and logical.node_locator='/device@0' and effect.property_name='limit'
       order by effect.source_order desc limit 1`, [revision.id])).rows;
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    const include = manifest.members.find((member) => member.fileVersionId === row.fileVersionId)!;
    const occurrenceId = `${manifest.configSetId}-occ-${row.logicalNodeId}`;
    const locator = { kind: "dts-property" as const, fileVersionId: row.fileVersionId,
      nodeOccurrenceId: row.nodeOccurrenceId, propertyOccurrenceId: row.propertyOccurrenceId,
      propertyName: "limit" };
    const observationId = `${manifest.configSetId}-observation-${revision.revisionNumber}`;
    await insertDtsObservationSourceFixture(db,{ organizationId: ORG,projectId: PROJECT,
      configSetId: manifest.configSetId,fileId: include.fileId,logicalNodeId: row.logicalNodeId,
      configRevisionId: revision.id,occurrenceId,observationId,catalogReleaseId: releaseId,locator });
    const input: CurrentDtsCompatibleSourceInput = await loadDtsObservationSourceFixture(db,{
      organizationId: ORG,projectId: PROJECT,observationId });
    expect(input).toMatchObject({ catalogReleaseId: releaseId,matcherRevision: "matcher-d897",
      configSetId: manifest.configSetId,fileId: include.fileId,
      configRevisionId: revision.id,logicalNodeId: row.logicalNodeId,locator });
    return { input, revision, manifest };
  }

  async function createSet(label: string, compatibles: string | null) {
    const configSetId = `set-d897-${label}`;
    const baseId = `file-d897-${label}-base`, includeId = `file-d897-${label}-include`;
    const baseName = `board-${label}.dts`, includeName = `device-${label}.dtsi`;
    const baseContent = base(includeName);
    await db.query("insert into dts_config_set(id,organization_id,project_id,name) values ($1,$2,$3,$4)",
      [configSetId,ORG,PROJECT,label]);
    for (const [fileId,name,role,order] of [[baseId,baseName,"base",0],
      [includeId,includeName,"misc",1]] as const) {
      await db.query(`insert into project_parameter_files
        (id,organization_id,project_id,file_name,format,config_set_id,config_set_role,config_set_sort_order)
        values ($1,$2,$3,$4,'dts',$5,$6,$7)`, [fileId,ORG,PROJECT,name,configSetId,role,order]);
    }
    const baseVersion = await version(baseId,1,baseName,baseContent);
    const includeVersion = await version(includeId,1,includeName,source(10,compatibles));
    const manifest: ConfigRevisionManifest = { organizationId: ORG, projectId: PROJECT,
      configSetId, entryFile: baseName, includeSearchPaths: ["."], overlayOrder: [],
      members: [
        { fileId: baseId,fileVersionId: baseVersion.id,fileName: baseName,sourceName: baseName,
          content: baseContent,role: "base",sortOrder: 0 },
        { fileId: includeId,fileVersionId: includeVersion.id,fileName: includeName,sourceName: includeName,
          content: includeVersion.content,role: "include",sortOrder: 1 },
      ] };
    const observed = await observe(manifest);
    return { ...observed, configSetId, baseId, includeId, baseVersion, includeVersion, includeName };
  }

  async function probe(mutate: (tx: Queryable) => Promise<unknown>, input = first.input) {
    const rollback = new Error("rollback D897 probe");
    await expect(db.transaction(async (tx) => {
      await mutate(tx);
      const result = await readCurrentDtsCompatibleSource(createSavepointDatabase(tx), storage, viewer, input);
      throw Object.assign(rollback, { result });
    })).rejects.toBe(rollback);
    return (rollback as Error & { result: Awaited<ReturnType<typeof readCurrentDtsCompatibleSource>> }).result;
  }

  async function objectBytes() {
    const names = (await readdir(directory,{ recursive: true })).sort();
    return Promise.all(names.map(async (name) => {
      const path = join(directory,name);
      return [name,(await stat(path)).isFile() ? (await readFile(path)).toString("base64") : null];
    }));
  }

  beforeAll(async () => {
    lane = await createEphemeralTestDatabase("d897source");
    db = createPostgresDatabase(lane.url);
    directory = await mkdtemp(join(tmpdir(),"wiseeff-d897-source-"));
    storage = createLocalObjectStore(directory);
    await db.query("insert into organizations(id,name) values ($1,'D897 source read')", [ORG]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'source owner','Admin',true)", [USER,ORG]);
    await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,'D897 source read','D897','initialized')", [PROJECT,ORG]);
    releaseId = (await installDriverSourceFixture(db,auth,{ subjectId: "csub_acme_power",
      compatible: "acme,power",businessName: "D897 business",driverName: "D897 driver",
      idempotencyKey: "d897-source-release",reason: "D897 source read fixture" })).release.id;
    first = await createSet("first",'"vendor,device", "acme,backup"');
    second = await createSet("second",'"vendor,other"');
    absent = await createSet("absent",null);
    const next = await version(first.includeId,2,first.includeName,source(20,'"vendor,device", "acme,backup"'));
    nextVersionId = next.id;
    const manifest = structuredClone(first.manifest);
    manifest.members[1] = { ...manifest.members[1]!,fileVersionId: next.id,content: next.content };
    candidate = await observe(manifest);
    await db.query("update project_parameter_files set current_version_id=$2 where id=$1",
      [first.includeId,first.includeVersion.id]);
    expect(await listCatalogBindingRowsForProject(db,auth,{ projectId: PROJECT })).toEqual([]);
    expect(getRootPostgresPool(db)).not.toBeNull();
  }, 120_000);

  afterAll(async () => {
    await db?.close(); await lane?.drop();
    if (directory) await rm(directory,{ recursive: true,force: true });
  });

  it("proves exact full selectors and both current config sets without creating source or business rows", async () => {
    const before = await captureConfigurationSourceState(db,{ organizationId: ORG, projectId: PROJECT });
    const objectsBefore = await objectBytes();
    const firstRead = await readCurrentDtsCompatibleSource(db,storage,viewer,first.input);
    expect(firstRead).toMatchObject({ status: "current",configSetId: first.configSetId,
      catalogReleaseId: releaseId,matcherRevision: "matcher-d897",
      configRevisionId: first.input.configRevisionId, compatibles: ["vendor,device","acme,backup"] });
    if (firstRead.status !== "current") throw new Error("First source was not current");
    expect(firstRead.members.map((member) => [member.fileId,member.fileVersionId,member.role,member.sortOrder]))
      .toEqual([[first.baseId,first.baseVersion.id,"base",0],[first.includeId,first.includeVersion.id,"include",1]]);
    expect(firstRead.compatibleProof.value).toMatchObject({ kind: "strings",
      values: ["vendor,device","acme,backup"] });
    expect(await readCurrentDtsCompatibleSource(db,storage,viewer,second.input))
      .toMatchObject({ status: "current",configSetId: second.configSetId,compatibles: ["vendor,other"] });
    expect(await captureConfigurationSourceState(db,{ organizationId: ORG,projectId: PROJECT })).toEqual(before);
    expect(await objectBytes()).toEqual(objectsBefore);
  });

  it("uses each current file version after rollback while the latest UI revision remains the candidate", async () => {
    expect(await readCurrentDtsCompatibleSource(db,storage,viewer,candidate.input))
      .toMatchObject({ status: "historical",currentConfigRevisionId: first.revision.id });
    const outcome = await probe(async (tx) => {
      await tx.query("update project_parameter_files set current_version_id=$2 where id=$1",
        [first.includeId,nextVersionId]);
      const latest = await tx.query<{ id: string }>(
        "select id from dts_config_revisions where config_set_id=$1 order by revision_number desc limit 1",
        [first.configSetId]);
      expect(latest.rows[0]?.id).toBe(candidate.revision.id);
      expect(await readCurrentDtsCompatibleSource(createSavepointDatabase(tx),storage,viewer,first.input))
        .toMatchObject({ status: "historical",currentConfigRevisionId: candidate.revision.id });
    },candidate.input);
    expect(outcome).toMatchObject({ status: "current",currentConfigRevisionId: candidate.revision.id });
    const stored = (await db.query<{ storage_key: string }>(
      "select storage_key from project_parameter_file_versions where id=$1",[nextVersionId])).rows[0]!;
    const path = join(directory,stored.storage_key);
    const original = await readFile(path);
    try {
      await writeFile(path,Buffer.from("changed candidate bytes"));
      expect(await probe((tx) => tx.query(
        "update project_parameter_files set current_version_id=$2 where id=$1",
        [first.includeId,nextVersionId])))
        .toMatchObject({ status: "unavailable",reason: "source-proof-invalid" });
    } finally { await writeFile(path,original); }
  });

  it("returns unavailable for missing members, member-role drift and ambiguous current revisions", async () => {
    expect(await readCurrentDtsCompatibleSource(db,storage,viewer,absent.input))
      .toMatchObject({ status: "unavailable",reason: "compatible-absent" });
    expect(await probe((tx) => tx.query("delete from dts_config_revision_members where config_revision_id=$1 and file_id=$2",
      [first.revision.id,first.baseId]))).toMatchObject({ status: "unavailable",reason: "source-proof-invalid" });
    expect(await probe((tx) => tx.query("update project_parameter_files set config_set_role='overlay' where id=$1",
      [first.includeId]))).toMatchObject({ status: "unavailable",reason: "source-membership-drift" });
    const rollback = new Error("rollback ambiguity");
    await expect(db.transaction(async (tx) => {
      const duplicate = await ingestConfigRevision(createSavepointDatabase(tx),first.manifest,auth,{ legacyProjection: "skip" });
      expect(duplicate.id).not.toBe(first.revision.id);
      expect(await readCurrentDtsCompatibleSource(createSavepointDatabase(tx),storage,viewer,first.input))
        .toMatchObject({ status: "unavailable",reason: "ambiguous-current-revision" });
      throw rollback;
    })).rejects.toBe(rollback);
  });

  it("rejects a wrong locator, changed object bytes and a foreign organization without writes", async () => {
    const before = await captureConfigurationSourceState(db,{ organizationId: ORG,projectId: PROJECT });
    expect(await readCurrentDtsCompatibleSource(db,storage,viewer,{ ...first.input,
      locator: { ...first.input.locator,propertyOccurrenceId: "wrong-occurrence" } }))
      .toMatchObject({ status: "unavailable",reason: "source-proof-invalid" });
    const stored = (await db.query<{ storage_key: string }>(
      "select storage_key from project_parameter_file_versions where id=$1",[first.includeVersion.id])).rows[0]!;
    const path = join(directory,stored.storage_key);
    const original = await readFile(path);
    try {
      await writeFile(path,Buffer.from("changed source bytes"));
      expect(await readCurrentDtsCompatibleSource(db,storage,viewer,first.input))
        .toMatchObject({ status: "unavailable",reason: "source-proof-invalid" });
    } finally { await writeFile(path,original); }
    await expect(readCurrentDtsCompatibleSource(db,storage,FOREIGN,first.input))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(readCurrentDtsCompatibleSource(db,storage,NO_VIEW,first.input))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await captureConfigurationSourceState(db,{ organizationId: ORG,projectId: PROJECT })).toEqual(before);
  });
});
