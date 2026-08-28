import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import {
  getFileVersionById,
  getProjectParameterFileById,
  getProjectParameterFileByName,
  insertFileVersion,
  insertProjectParameterFile,
  listFileVersions,
  listProjectParameterFiles,
  setCurrentVersion
} from "./repository";

const databaseAvailable = await isTestDatabaseAvailable();

describe.skipIf(!databaseAvailable)("parameter-files repository", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedCoreGraph(db, {
      organization: { id: "org-1", name: "ChargeLab" },
      users: [{ id: "user-1", name: "Riley Chen", email: "riley@example.com" }],
      projects: [
        { id: "proj-1", name: "Aurora", code: "AUR" },
        { id: "proj-2", name: "Borealis", code: "BOR" }
      ]
    });
    // module_hint carries an FK to parameter_modules.
    await db.query(
      `insert into parameter_modules (id, organization_id, name, path)
       values ('mod-battery', 'org-1', 'battery', 'battery')`
    );
  });

  afterEach(async () => {
    await db?.rollback();
  });

  it("insertProjectParameterFile inserts and maps a file row", async () => {
    const file = await insertProjectParameterFile(db, {
      id: "file-1",
      organizationId: "org-1",
      projectId: "proj-1",
      fileName: "battery.dtsi",
      format: "dts"
    });

    expect(file).toMatchObject({
      id: "file-1",
      projectId: "proj-1",
      fileName: "battery.dtsi",
      format: "dts",
      enabled: true
    });
    expect(file.moduleHint).toBeUndefined();
    expect(file.currentVersionId).toBeUndefined();
    expect(file.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const reloaded = await getProjectParameterFileById(db, { organizationId: "org-1", fileId: "file-1" });
    expect(reloaded).toMatchObject({ id: "file-1", fileName: "battery.dtsi", format: "dts", enabled: true });
  });

  it("listProjectParameterFiles scopes to organization and project", async () => {
    await insertProjectParameterFile(db, {
      id: "file-1",
      organizationId: "org-1",
      projectId: "proj-1",
      fileName: "battery.dtsi",
      format: "dts",
      moduleHint: "mod-battery"
    });
    await insertFileVersion(db, {
      id: "ver-1",
      fileId: "file-1",
      versionNumber: 1,
      storageKey: "org-1/files/battery-v1.dtsi",
      checksum: "abc122",
      sizeBytes: 512,
      parsedIndex: {},
      origin: "upload",
      createdByUserId: "user-1"
    });
    const second = await insertFileVersion(db, {
      id: "ver-2",
      fileId: "file-1",
      versionNumber: 2,
      storageKey: "org-1/files/battery-v2.dtsi",
      checksum: "abc123",
      sizeBytes: 1024,
      parsedIndex: {},
      origin: "upload",
      createdByUserId: "user-1"
    });
    await setCurrentVersion(db, { fileId: "file-1", versionId: second.id });
    // A file in another project must not leak into the proj-1 listing.
    await insertProjectParameterFile(db, {
      id: "file-other-project",
      organizationId: "org-1",
      projectId: "proj-2",
      fileName: "other.dtsi",
      format: "dts"
    });

    const items = await listProjectParameterFiles(db, { organizationId: "org-1", projectId: "proj-1" });
    const foreignOrg = await listProjectParameterFiles(db, { organizationId: "org-other", projectId: "proj-1" });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "file-1",
      projectId: "proj-1",
      fileName: "battery.dtsi",
      format: "dts",
      moduleHint: "mod-battery",
      enabled: true,
      currentVersionId: "ver-2",
      currentVersionNumber: 2
    });
    expect(foreignOrg).toEqual([]);
  });

  it("getProjectParameterFileByName finds a file by project and name", async () => {
    await insertProjectParameterFile(db, {
      id: "file-1",
      organizationId: "org-1",
      projectId: "proj-1",
      fileName: "config.json",
      format: "json"
    });
    await insertProjectParameterFile(db, {
      id: "file-2",
      organizationId: "org-1",
      projectId: "proj-1",
      fileName: "battery.dtsi",
      format: "dts"
    });

    const file = await getProjectParameterFileByName(db, {
      organizationId: "org-1",
      projectId: "proj-1",
      fileName: "config.json"
    });
    const wrongProject = await getProjectParameterFileByName(db, {
      organizationId: "org-1",
      projectId: "proj-2",
      fileName: "config.json"
    });
    const wrongOrg = await getProjectParameterFileByName(db, {
      organizationId: "org-other",
      projectId: "proj-1",
      fileName: "config.json"
    });

    expect(file).toMatchObject({
      id: "file-1",
      projectId: "proj-1",
      fileName: "config.json",
      format: "json",
      enabled: true
    });
    expect(wrongProject).toBeNull();
    expect(wrongOrg).toBeNull();
  });

  it("insertFileVersion inserts and maps a version row", async () => {
    await insertProjectParameterFile(db, {
      id: "file-1",
      organizationId: "org-1",
      projectId: "proj-1",
      fileName: "battery.dtsi",
      format: "dts"
    });

    const version = await insertFileVersion(db, {
      id: "ver-1",
      fileId: "file-1",
      versionNumber: 1,
      storageKey: "org-1/files/battery.dtsi",
      checksum: "abc123",
      sizeBytes: 1024,
      parsedIndex: { "battery/temp_max": { value: "85" } },
      origin: "upload",
      createdByUserId: "user-1"
    });

    expect(version).toMatchObject({
      id: "ver-1",
      fileId: "file-1",
      versionNumber: 1,
      storageKey: "org-1/files/battery.dtsi",
      checksum: "abc123",
      sizeBytes: 1024,
      parsedIndex: { "battery/temp_max": { value: "85" } },
      origin: "upload",
      createdByUserId: "user-1"
    });
    expect(version.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const reloaded = await getFileVersionById(db, { versionId: "ver-1" });
    expect(reloaded?.parsedIndex).toEqual({ "battery/temp_max": { value: "85" } });

    // The version counter is derived from existing rows: the next insert gets number 2.
    const next = await insertFileVersion(db, {
      id: "ver-2",
      fileId: "file-1",
      versionNumber: 1,
      storageKey: "org-1/files/battery-v2.dtsi",
      checksum: "def456",
      sizeBytes: 2048,
      parsedIndex: {},
      origin: "upload",
      createdByUserId: "user-1"
    });
    expect(next.versionNumber).toBe(2);
    expect((await listFileVersions(db, { fileId: "file-1" })).map((row) => row.versionNumber)).toEqual([2, 1]);
    expect((await listFileVersions(db, { fileId: "file-1" }))[0]).toMatchObject({
      createdByUserId: "user-1",
      createdByDisplayName: "Riley Chen"
    });

    const unattributed = await insertFileVersion(db, {
      id: "ver-3",
      fileId: "file-1",
      versionNumber: 3,
      storageKey: "org-1/files/battery-v3.dtsi",
      checksum: "ghi789",
      sizeBytes: 3072,
      parsedIndex: {},
      origin: "upload"
    });
    expect(unattributed).toMatchObject({
      createdByUserId: null,
      createdByDisplayName: null
    });
  });
});
