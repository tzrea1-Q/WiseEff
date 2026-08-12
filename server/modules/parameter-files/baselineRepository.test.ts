import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import { insertConfigSet, setFileConfigSetMembership } from "./configSetRepository";
import { insertFileVersion, insertProjectParameterFile, setCurrentVersion } from "./repository";
import {
  getReleaseBaselineByConfigSetAndName,
  getReleaseBaselineById,
  insertReleaseBaseline,
  insertReleaseBaselineMember,
  listConfigSetMemberFiles,
  listReleaseBaselineMembers,
  listReleaseBaselinesByConfigSet
} from "./baselineRepository";

const databaseAvailable = await isTestDatabaseAvailable();

describe.skipIf(!databaseAvailable)("baseline repository", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedCoreGraph(db, {
      organization: { id: "org-1", name: "ChargeLab" },
      users: [{ id: "user-1", name: "Riley Chen", email: "riley@example.com" }],
      projects: [{ id: "project-1", name: "Aurora", code: "AUR" }]
    });
    await insertConfigSet(db, {
      id: "dcs-1",
      organizationId: "org-1",
      projectId: "project-1",
      name: "board-a"
    });
  });

  afterEach(async () => {
    await db?.rollback();
  });

  /** Creates a file plus `versionCount` uploaded versions; the newest version takes `currentVersionId`. */
  async function seedFileWithCurrentVersion(input: {
    fileId: string;
    fileName: string;
    currentVersionId: string;
    versionCount?: number;
  }) {
    await insertProjectParameterFile(db, {
      id: input.fileId,
      organizationId: "org-1",
      projectId: "project-1",
      fileName: input.fileName,
      format: "dts"
    });
    const versionCount = input.versionCount ?? 1;
    for (let index = 1; index <= versionCount; index += 1) {
      const versionId = index === versionCount ? input.currentVersionId : `${input.fileId}-v${index}`;
      await insertFileVersion(db, {
        id: versionId,
        fileId: input.fileId,
        versionNumber: index,
        storageKey: `org-1/files/${input.fileName}-v${index}`,
        checksum: `checksum-${input.fileId}-${index}`,
        sizeBytes: 100 + index,
        parsedIndex: {},
        origin: "upload",
        createdByUserId: "user-1"
      });
    }
    await setCurrentVersion(db, { fileId: input.fileId, versionId: input.currentVersionId });
  }

  it("insertReleaseBaseline inserts and maps a baseline row", async () => {
    const baseline = await insertReleaseBaseline(db, {
      id: "baseline-1",
      organizationId: "org-1",
      configSetId: "dcs-1",
      name: "release-1.0",
      createdByUserId: "user-1"
    });

    expect(baseline).toMatchObject({
      id: "baseline-1",
      organizationId: "org-1",
      configSetId: "dcs-1",
      name: "release-1.0",
      status: "draft",
      createdBy: "user-1"
    });
    expect(baseline.notes).toBeUndefined();
    expect(baseline.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const reloaded = await getReleaseBaselineById(db, { organizationId: "org-1", baselineId: "baseline-1" });
    expect(reloaded).toMatchObject({ id: "baseline-1", name: "release-1.0", status: "draft" });
  });

  it("insertReleaseBaseline persists notes", async () => {
    const baseline = await insertReleaseBaseline(db, {
      id: "baseline-1",
      organizationId: "org-1",
      configSetId: "dcs-1",
      name: "release-1.0",
      notes: "pre-release snapshot"
    });

    expect(baseline.notes).toBe("pre-release snapshot");
    expect(baseline.createdBy).toBeUndefined();

    const reloaded = await getReleaseBaselineById(db, { organizationId: "org-1", baselineId: "baseline-1" });
    expect(reloaded?.notes).toBe("pre-release snapshot");
  });

  it("getReleaseBaselineByConfigSetAndName returns null when no row matches", async () => {
    const baseline = await getReleaseBaselineByConfigSetAndName(db, { configSetId: "dcs-1", name: "missing" });

    expect(baseline).toBeNull();
  });

  it("getReleaseBaselineByConfigSetAndName finds an existing baseline by name", async () => {
    await insertReleaseBaseline(db, {
      id: "baseline-1",
      organizationId: "org-1",
      configSetId: "dcs-1",
      name: "release-1.0"
    });

    const baseline = await getReleaseBaselineByConfigSetAndName(db, { configSetId: "dcs-1", name: "release-1.0" });

    expect(baseline?.id).toBe("baseline-1");
    expect(baseline?.name).toBe("release-1.0");
  });

  it("getReleaseBaselineById scopes lookup to organization", async () => {
    await insertReleaseBaseline(db, {
      id: "baseline-1",
      organizationId: "org-1",
      configSetId: "dcs-1",
      name: "release-1.0"
    });

    const owned = await getReleaseBaselineById(db, { organizationId: "org-1", baselineId: "baseline-1" });
    const foreign = await getReleaseBaselineById(db, { organizationId: "org-other", baselineId: "baseline-1" });

    expect(owned?.id).toBe("baseline-1");
    expect(foreign).toBeNull();
  });

  it("getReleaseBaselineById returns null when missing", async () => {
    const baseline = await getReleaseBaselineById(db, { organizationId: "org-1", baselineId: "missing" });

    expect(baseline).toBeNull();
  });

  it("listReleaseBaselinesByConfigSet scopes to the config set", async () => {
    await insertConfigSet(db, {
      id: "dcs-2",
      organizationId: "org-1",
      projectId: "project-1",
      name: "board-b"
    });
    await insertReleaseBaseline(db, {
      id: "baseline-1",
      organizationId: "org-1",
      configSetId: "dcs-1",
      name: "release-1.0"
    });
    await insertReleaseBaseline(db, {
      id: "baseline-2",
      organizationId: "org-1",
      configSetId: "dcs-1",
      name: "release-1.1"
    });
    await insertReleaseBaseline(db, {
      id: "baseline-other",
      organizationId: "org-1",
      configSetId: "dcs-2",
      name: "release-x"
    });

    const baselines = await listReleaseBaselinesByConfigSet(db, { configSetId: "dcs-1" });

    expect(baselines).toHaveLength(2);
    // created_at is frozen inside the rollback transaction, so assert membership, not order.
    expect(baselines.map((baseline) => baseline.name).sort()).toEqual(["release-1.0", "release-1.1"]);
    expect(baselines.every((baseline) => baseline.configSetId === "dcs-1")).toBe(true);
  });

  it("insertReleaseBaselineMember inserts and maps a member row", async () => {
    await seedFileWithCurrentVersion({ fileId: "file-1", fileName: "board-a.dts", currentVersionId: "fv-1", versionCount: 3 });
    await insertReleaseBaseline(db, {
      id: "baseline-1",
      organizationId: "org-1",
      configSetId: "dcs-1",
      name: "release-1.0"
    });

    const member = await insertReleaseBaselineMember(db, {
      id: "bm-1",
      baselineId: "baseline-1",
      fileId: "file-1",
      fileVersionId: "fv-1",
      versionNumber: 3
    });

    expect(member).toEqual({
      baselineId: "baseline-1",
      fileId: "file-1",
      fileVersionId: "fv-1",
      versionNumber: 3
    });

    const reloaded = await listReleaseBaselineMembers(db, { baselineId: "baseline-1" });
    expect(reloaded).toEqual([member]);
  });

  it("listReleaseBaselineMembers lists all members pinned to a baseline", async () => {
    await seedFileWithCurrentVersion({ fileId: "file-1", fileName: "board-a.dts", currentVersionId: "fv-1", versionCount: 3 });
    await seedFileWithCurrentVersion({ fileId: "file-2", fileName: "board-a.overlay.dts", currentVersionId: "fv-2" });
    await insertReleaseBaseline(db, {
      id: "baseline-1",
      organizationId: "org-1",
      configSetId: "dcs-1",
      name: "release-1.0"
    });
    await insertReleaseBaselineMember(db, {
      id: "bm-1",
      baselineId: "baseline-1",
      fileId: "file-1",
      fileVersionId: "fv-1",
      versionNumber: 3
    });
    await insertReleaseBaselineMember(db, {
      id: "bm-2",
      baselineId: "baseline-1",
      fileId: "file-2",
      fileVersionId: "fv-2",
      versionNumber: 1
    });

    const members = await listReleaseBaselineMembers(db, { baselineId: "baseline-1" });

    expect(members).toHaveLength(2);
    expect(members[1]).toEqual({
      baselineId: "baseline-1",
      fileId: "file-2",
      fileVersionId: "fv-2",
      versionNumber: 1
    });
  });

  it("listConfigSetMemberFiles joins current version info for each member file", async () => {
    await seedFileWithCurrentVersion({ fileId: "file-1", fileName: "board-a.dts", currentVersionId: "fv-1", versionCount: 3 });
    await seedFileWithCurrentVersion({ fileId: "file-2", fileName: "board-a.overlay.dts", currentVersionId: "fv-9" });
    await setFileConfigSetMembership(db, { fileId: "file-1", configSetId: "dcs-1", role: "base", sortOrder: 0 });
    await setFileConfigSetMembership(db, { fileId: "file-2", configSetId: "dcs-1", role: "overlay", sortOrder: 1 });

    const members = await listConfigSetMemberFiles(db, "dcs-1");

    expect(members).toEqual([
      { configSetId: "dcs-1", fileId: "file-1", fileName: "board-a.dts", format: "dts", role: "base", sortOrder: 0, currentVersionId: "fv-1", currentVersionNumber: 3 },
      { configSetId: "dcs-1", fileId: "file-2", fileName: "board-a.overlay.dts", format: "dts", role: "overlay", sortOrder: 1, currentVersionId: "fv-9", currentVersionNumber: 1 }
    ]);
  });

  it("listConfigSetMemberFiles reports members with no current version as undefined", async () => {
    await insertProjectParameterFile(db, {
      id: "file-1",
      organizationId: "org-1",
      projectId: "project-1",
      fileName: "board-a.dts",
      format: "dts"
    });
    await setFileConfigSetMembership(db, { fileId: "file-1", configSetId: "dcs-1", role: "base", sortOrder: 0 });

    const members = await listConfigSetMemberFiles(db, "dcs-1");

    expect(members).toEqual([
      { configSetId: "dcs-1", fileId: "file-1", fileName: "board-a.dts", format: "dts", role: "base", sortOrder: 0, currentVersionId: undefined, currentVersionNumber: undefined }
    ]);
  });

  it("normalizes legacy members with no stored role to misc", async () => {
    await seedFileWithCurrentVersion({ fileId: "file-legacy", fileName: "legacy.dts", currentVersionId: "fv-1" });
    // Migration 0043 backfill attached files to the default set before the role column
    // existed; the repository interface cannot produce a null role, so recreate it directly.
    await db.query(
      `update project_parameter_files
       set config_set_id = 'dcs-1', config_set_role = null, config_set_sort_order = 0
       where id = 'file-legacy'`
    );

    await expect(listConfigSetMemberFiles(db, "dcs-1")).resolves.toEqual([
      expect.objectContaining({ fileId: "file-legacy", role: "misc" })
    ]);
  });
});
