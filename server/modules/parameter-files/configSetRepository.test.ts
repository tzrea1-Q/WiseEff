import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import { insertProjectParameterFile } from "./repository";
import {
  clearFileConfigSetMembership,
  getConfigSetById,
  getConfigSetByProjectAndName,
  getFileConfigSetMembership,
  insertConfigSet,
  listConfigSetsByProject,
  setFileConfigSetMembership,
  updateConfigSetRow
} from "./configSetRepository";

const databaseAvailable = await isTestDatabaseAvailable();

describe.skipIf(!databaseAvailable)("configSet repository", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedCoreGraph(db, {
      organization: { id: "org-1", name: "ChargeLab" },
      users: [{ id: "user-1", name: "Riley Chen", email: "riley@example.com" }],
      projects: [
        { id: "project-1", name: "Aurora", code: "AUR" },
        { id: "project-2", name: "Borealis", code: "BOR" }
      ]
    });
  });

  afterEach(async () => {
    await db?.rollback();
  });

  it("insertConfigSet inserts and maps a config set row", async () => {
    const configSet = await insertConfigSet(db, {
      id: "dcs-1",
      organizationId: "org-1",
      projectId: "project-1",
      name: "board-a"
    });

    expect(configSet).toMatchObject({
      id: "dcs-1",
      organizationId: "org-1",
      projectId: "project-1",
      name: "board-a"
    });
    expect(configSet.description).toBeUndefined();
    expect(configSet.derivedFromId).toBeUndefined();
    expect(configSet.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(configSet.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const reloaded = await getConfigSetById(db, { organizationId: "org-1", configSetId: "dcs-1" });
    expect(reloaded).toMatchObject({ id: "dcs-1", name: "board-a", projectId: "project-1" });
  });

  it("insertConfigSet persists derivedFromId and description", async () => {
    await insertConfigSet(db, {
      id: "dcs-1",
      organizationId: "org-1",
      projectId: "project-1",
      name: "board-a"
    });

    const configSet = await insertConfigSet(db, {
      id: "dcs-2",
      organizationId: "org-1",
      projectId: "project-1",
      name: "board-b",
      description: "variant of board-a",
      derivedFromId: "dcs-1"
    });

    expect(configSet.derivedFromId).toBe("dcs-1");
    expect(configSet.description).toBe("variant of board-a");

    const reloaded = await getConfigSetById(db, { organizationId: "org-1", configSetId: "dcs-2" });
    expect(reloaded?.derivedFromId).toBe("dcs-1");
    expect(reloaded?.description).toBe("variant of board-a");
  });

  it("listConfigSetsByProject scopes to organization and project", async () => {
    await insertConfigSet(db, {
      id: "dcs-1",
      organizationId: "org-1",
      projectId: "project-1",
      name: "board-a"
    });
    await insertConfigSet(db, {
      id: "dcs-other-project",
      organizationId: "org-1",
      projectId: "project-2",
      name: "board-x"
    });

    const items = await listConfigSetsByProject(db, { organizationId: "org-1", projectId: "project-1" });
    const foreignOrg = await listConfigSetsByProject(db, { organizationId: "org-other", projectId: "project-1" });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "dcs-1",
      organizationId: "org-1",
      projectId: "project-1",
      name: "board-a"
    });
    expect(foreignOrg).toEqual([]);
  });

  it("getConfigSetById returns null when no row matches", async () => {
    await insertConfigSet(db, {
      id: "dcs-1",
      organizationId: "org-1",
      projectId: "project-1",
      name: "board-a"
    });

    const missing = await getConfigSetById(db, { organizationId: "org-1", configSetId: "missing" });
    const foreignOrg = await getConfigSetById(db, { organizationId: "org-other", configSetId: "dcs-1" });

    expect(missing).toBeNull();
    expect(foreignOrg).toBeNull();
  });

  it("getConfigSetByProjectAndName finds a set by project and name", async () => {
    await insertConfigSet(db, {
      id: "dcs-1",
      organizationId: "org-1",
      projectId: "project-1",
      name: "default"
    });
    await insertConfigSet(db, {
      id: "dcs-2",
      organizationId: "org-1",
      projectId: "project-1",
      name: "board-a"
    });

    const configSet = await getConfigSetByProjectAndName(db, {
      organizationId: "org-1",
      projectId: "project-1",
      name: "default"
    });
    const wrongProject = await getConfigSetByProjectAndName(db, {
      organizationId: "org-1",
      projectId: "project-2",
      name: "default"
    });

    expect(configSet?.id).toBe("dcs-1");
    expect(configSet?.name).toBe("default");
    expect(wrongProject).toBeNull();
  });

  it("updateConfigSetRow updates name/description/derivedFromId and reads back derivedFromId", async () => {
    await insertConfigSet(db, {
      id: "dcs-0",
      organizationId: "org-1",
      projectId: "project-1",
      name: "board-base"
    });
    await insertConfigSet(db, {
      id: "dcs-1",
      organizationId: "org-1",
      projectId: "project-1",
      name: "board-a"
    });

    const configSet = await updateConfigSetRow(db, {
      id: "dcs-1",
      name: "board-a-renamed",
      description: "updated desc",
      derivedFromId: "dcs-0"
    });

    expect(configSet.name).toBe("board-a-renamed");
    expect(configSet.description).toBe("updated desc");
    expect(configSet.derivedFromId).toBe("dcs-0");

    const reloaded = await getConfigSetById(db, { organizationId: "org-1", configSetId: "dcs-1" });
    expect(reloaded).toMatchObject({
      name: "board-a-renamed",
      description: "updated desc",
      derivedFromId: "dcs-0"
    });
  });

  it("setFileConfigSetMembership updates file membership columns", async () => {
    await insertConfigSet(db, {
      id: "dcs-1",
      organizationId: "org-1",
      projectId: "project-1",
      name: "board-a"
    });
    await insertProjectParameterFile(db, {
      id: "file-1",
      organizationId: "org-1",
      projectId: "project-1",
      fileName: "board-a.dts",
      format: "dts"
    });

    await setFileConfigSetMembership(db, {
      fileId: "file-1",
      configSetId: "dcs-1",
      role: "base",
      sortOrder: 2
    });

    const membership = await getFileConfigSetMembership(db, { organizationId: "org-1", fileId: "file-1" });
    expect(membership).toEqual({
      fileId: "file-1",
      organizationId: "org-1",
      projectId: "project-1",
      configSetId: "dcs-1",
      configSetRole: "base",
      configSetSortOrder: 2
    });
  });

  it("clearFileConfigSetMembership nulls out membership columns", async () => {
    await insertConfigSet(db, {
      id: "dcs-1",
      organizationId: "org-1",
      projectId: "project-1",
      name: "board-a"
    });
    await insertProjectParameterFile(db, {
      id: "file-1",
      organizationId: "org-1",
      projectId: "project-1",
      fileName: "board-a.dts",
      format: "dts"
    });
    await setFileConfigSetMembership(db, {
      fileId: "file-1",
      configSetId: "dcs-1",
      role: "base",
      sortOrder: 2
    });

    await clearFileConfigSetMembership(db, { fileId: "file-1" });

    const membership = await getFileConfigSetMembership(db, { organizationId: "org-1", fileId: "file-1" });
    expect(membership).toEqual({
      fileId: "file-1",
      organizationId: "org-1",
      projectId: "project-1",
      configSetId: undefined,
      configSetRole: undefined,
      configSetSortOrder: 0
    });
  });

  it("getFileConfigSetMembership maps a file row's membership fields", async () => {
    await insertConfigSet(db, {
      id: "dcs-1",
      organizationId: "org-1",
      projectId: "project-1",
      name: "board-a"
    });
    await insertProjectParameterFile(db, {
      id: "file-1",
      organizationId: "org-1",
      projectId: "project-1",
      fileName: "board-a.dts",
      format: "dts"
    });
    await setFileConfigSetMembership(db, {
      fileId: "file-1",
      configSetId: "dcs-1",
      role: "base",
      sortOrder: 3
    });

    const membership = await getFileConfigSetMembership(db, { organizationId: "org-1", fileId: "file-1" });

    expect(membership).toEqual({
      fileId: "file-1",
      organizationId: "org-1",
      projectId: "project-1",
      configSetId: "dcs-1",
      configSetRole: "base",
      configSetSortOrder: 3
    });

    const foreignOrg = await getFileConfigSetMembership(db, { organizationId: "org-other", fileId: "file-1" });
    expect(foreignOrg).toBeNull();
  });

  it("getFileConfigSetMembership returns null when file does not exist", async () => {
    const membership = await getFileConfigSetMembership(db, { organizationId: "org-1", fileId: "missing" });

    expect(membership).toBeNull();
  });
});
