import { describe, expect, it } from "vitest";
import type { QueryResult, Queryable } from "../../shared/database/client";
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

type QueryCall = {
  text: string;
  values: unknown[];
};

type QueuedResult = Record<string, unknown> | unknown[] | ((call: QueryCall) => unknown[]);

function createFakeDb(rowsOrQueue: QueuedResult[] = []) {
  const calls: QueryCall[] = [];
  const queueMode = rowsOrQueue.some((item) => typeof item === "function" || Array.isArray(item));
  const db: Queryable = {
    query: async <Row,>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> => {
      const call = { text, values };
      calls.push(call);
      if (queueMode) {
        const next = rowsOrQueue.shift() ?? [];
        const rows = typeof next === "function" ? next(call) : Array.isArray(next) ? next : [next];
        return { rows: rows as Row[], rowCount: rows.length };
      }

      const rows = rowsOrQueue as unknown[];
      return { rows: rows as Row[], rowCount: rows.length };
    }
  };

  return { db, calls };
}

function configSetRow(overrides: Record<string, unknown> = {}) {
  const timestamp = new Date("2026-07-14T09:00:00.000Z");
  return {
    id: "dcs-1",
    organization_id: "org-1",
    project_id: "project-1",
    name: "board-a",
    description: null,
    derived_from_id: null,
    created_at: timestamp,
    updated_at: timestamp,
    ...overrides
  };
}

describe("configSet repository", () => {
  it("insertConfigSet inserts and maps a config set row", async () => {
    const { db, calls } = createFakeDb([configSetRow()]);

    const configSet = await insertConfigSet(db, {
      id: "dcs-1",
      organizationId: "org-1",
      projectId: "project-1",
      name: "board-a"
    });

    expect(calls[0].text).toContain("insert into dts_config_set");
    expect(calls[0].values).toEqual(["dcs-1", "org-1", "project-1", "board-a", null, null]);
    expect(configSet).toEqual({
      id: "dcs-1",
      organizationId: "org-1",
      projectId: "project-1",
      name: "board-a",
      createdAt: "2026-07-14T09:00:00.000Z",
      updatedAt: "2026-07-14T09:00:00.000Z"
    });
  });

  it("insertConfigSet persists derivedFromId and description", async () => {
    const { db, calls } = createFakeDb([
      configSetRow({ id: "dcs-2", name: "board-b", description: "variant of board-a", derived_from_id: "dcs-1" })
    ]);

    const configSet = await insertConfigSet(db, {
      id: "dcs-2",
      organizationId: "org-1",
      projectId: "project-1",
      name: "board-b",
      description: "variant of board-a",
      derivedFromId: "dcs-1"
    });

    expect(calls[0].values).toEqual(["dcs-2", "org-1", "project-1", "board-b", "variant of board-a", "dcs-1"]);
    expect(configSet.derivedFromId).toBe("dcs-1");
    expect(configSet.description).toBe("variant of board-a");
  });

  it("listConfigSetsByProject scopes to organization and project", async () => {
    const { db, calls } = createFakeDb([configSetRow()]);

    const items = await listConfigSetsByProject(db, { organizationId: "org-1", projectId: "project-1" });

    expect(calls[0].text).toContain("from dts_config_set");
    expect(calls[0].text).toContain("organization_id = $1");
    expect(calls[0].text).toContain("project_id = $2");
    expect(calls[0].values).toEqual(["org-1", "project-1"]);
    expect(items).toEqual([
      {
        id: "dcs-1",
        organizationId: "org-1",
        projectId: "project-1",
        name: "board-a",
        createdAt: "2026-07-14T09:00:00.000Z",
        updatedAt: "2026-07-14T09:00:00.000Z"
      }
    ]);
  });

  it("getConfigSetById returns null when no row matches", async () => {
    const { db, calls } = createFakeDb([[]]);

    const configSet = await getConfigSetById(db, { organizationId: "org-1", configSetId: "missing" });

    expect(calls[0].text).toContain("from dts_config_set");
    expect(calls[0].values).toEqual(["org-1", "missing"]);
    expect(configSet).toBeNull();
  });

  it("getConfigSetByProjectAndName finds a set by project and name", async () => {
    const { db, calls } = createFakeDb([[configSetRow({ name: "default" })]]);

    const configSet = await getConfigSetByProjectAndName(db, {
      organizationId: "org-1",
      projectId: "project-1",
      name: "default"
    });

    expect(calls[0].text).toContain("name = $3");
    expect(calls[0].values).toEqual(["org-1", "project-1", "default"]);
    expect(configSet?.name).toBe("default");
  });

  it("updateConfigSetRow updates name/description/derivedFromId and reads back derivedFromId", async () => {
    const { db, calls } = createFakeDb([
      configSetRow({ name: "board-a-renamed", description: "updated desc", derived_from_id: "dcs-0" })
    ]);

    const configSet = await updateConfigSetRow(db, {
      id: "dcs-1",
      name: "board-a-renamed",
      description: "updated desc",
      derivedFromId: "dcs-0"
    });

    expect(calls[0].text).toContain("update dts_config_set");
    expect(calls[0].values).toEqual(["dcs-1", "board-a-renamed", "updated desc", "dcs-0"]);
    expect(configSet.name).toBe("board-a-renamed");
    expect(configSet.description).toBe("updated desc");
    expect(configSet.derivedFromId).toBe("dcs-0");
  });

  it("setFileConfigSetMembership updates file membership columns", async () => {
    const { db, calls } = createFakeDb([[]]);

    await setFileConfigSetMembership(db, {
      fileId: "file-1",
      configSetId: "dcs-1",
      role: "base",
      sortOrder: 2
    });

    expect(calls[0].text).toContain("update project_parameter_files");
    expect(calls[0].text).toContain("config_set_id");
    expect(calls[0].text).toContain("config_set_role");
    expect(calls[0].text).toContain("config_set_sort_order");
    expect(calls[0].values).toEqual(["file-1", "dcs-1", "base", 2]);
  });

  it("clearFileConfigSetMembership nulls out membership columns", async () => {
    const { db, calls } = createFakeDb([[]]);

    await clearFileConfigSetMembership(db, { fileId: "file-1" });

    expect(calls[0].text).toContain("update project_parameter_files");
    expect(calls[0].text).toContain("config_set_id = null");
    expect(calls[0].values).toEqual(["file-1"]);
  });

  it("getFileConfigSetMembership maps a file row's membership fields", async () => {
    const { db, calls } = createFakeDb([
      [
        {
          id: "file-1",
          organization_id: "org-1",
          project_id: "project-1",
          config_set_id: "dcs-1",
          config_set_role: "base",
          config_set_sort_order: 3
        }
      ]
    ]);

    const membership = await getFileConfigSetMembership(db, { organizationId: "org-1", fileId: "file-1" });

    expect(calls[0].text).toContain("from project_parameter_files");
    expect(calls[0].values).toEqual(["org-1", "file-1"]);
    expect(membership).toEqual({
      fileId: "file-1",
      organizationId: "org-1",
      projectId: "project-1",
      configSetId: "dcs-1",
      configSetRole: "base",
      configSetSortOrder: 3
    });
  });

  it("getFileConfigSetMembership returns null when file does not exist", async () => {
    const { db } = createFakeDb([[]]);

    const membership = await getFileConfigSetMembership(db, { organizationId: "org-1", fileId: "missing" });

    expect(membership).toBeNull();
  });
});
