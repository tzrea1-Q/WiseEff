import { describe, expect, it } from "vitest";
import type { QueryResult, Queryable } from "../../shared/database/client";
import {
  getProjectParameterFileByName,
  insertFileVersion,
  insertProjectParameterFile,
  listProjectParameterFiles
} from "./repository";

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

describe("parameter-files repository", () => {
  it("insertProjectParameterFile inserts and maps a file row", async () => {
    const updatedAt = new Date("2026-07-11T08:00:00.000Z");
    const { db, calls } = createFakeDb([
      {
        id: "file-1",
        organization_id: "org-1",
        project_id: "proj-1",
        file_name: "battery.dtsi",
        format: "dts",
        module_hint: null,
        current_version_id: null,
        enabled: true,
        created_at: updatedAt,
        updated_at: updatedAt
      }
    ]);

    const file = await insertProjectParameterFile(db, {
      id: "file-1",
      organizationId: "org-1",
      projectId: "proj-1",
      fileName: "battery.dtsi",
      format: "dts"
    });

    expect(calls[0].text).toContain("insert into project_parameter_files");
    expect(calls[0].values).toEqual(["file-1", "org-1", "proj-1", "battery.dtsi", "dts", null, true]);
    expect(file).toEqual({
      id: "file-1",
      projectId: "proj-1",
      fileName: "battery.dtsi",
      format: "dts",
      enabled: true,
      updatedAt: "2026-07-11T08:00:00.000Z"
    });
  });

  it("listProjectParameterFiles scopes to organization and project", async () => {
    const updatedAt = new Date("2026-07-11T08:00:00.000Z");
    const { db, calls } = createFakeDb([
      {
        id: "file-1",
        organization_id: "org-1",
        project_id: "proj-1",
        file_name: "battery.dtsi",
        format: "dts",
        module_hint: "mod-battery",
        current_version_id: "ver-1",
        enabled: true,
        created_at: updatedAt,
        updated_at: updatedAt,
        current_version_number: 2
      }
    ]);

    const items = await listProjectParameterFiles(db, { organizationId: "org-1", projectId: "proj-1" });

    expect(calls[0].text).toContain("from project_parameter_files");
    expect(calls[0].text).toContain("organization_id = $1");
    expect(calls[0].text).toContain("project_id = $2");
    expect(calls[0].values).toEqual(["org-1", "proj-1"]);
    expect(items).toEqual([
      {
        id: "file-1",
        projectId: "proj-1",
        fileName: "battery.dtsi",
        format: "dts",
        moduleHint: "mod-battery",
        enabled: true,
        currentVersionId: "ver-1",
        currentVersionNumber: 2,
        updatedAt: "2026-07-11T08:00:00.000Z"
      }
    ]);
  });

  it("getProjectParameterFileByName finds a file by project and name", async () => {
    const updatedAt = new Date("2026-07-11T08:00:00.000Z");
    const { db, calls } = createFakeDb([
      [
        {
          id: "file-1",
          organization_id: "org-1",
          project_id: "proj-1",
          file_name: "config.json",
          format: "json",
          module_hint: null,
          current_version_id: null,
          enabled: true,
          created_at: updatedAt,
          updated_at: updatedAt,
          current_version_number: null
        }
      ]
    ]);

    const file = await getProjectParameterFileByName(db, {
      organizationId: "org-1",
      projectId: "proj-1",
      fileName: "config.json"
    });

    expect(calls[0].text).toContain("from project_parameter_files");
    expect(calls[0].text).toContain("file_name = $3");
    expect(calls[0].values).toEqual(["org-1", "proj-1", "config.json"]);
    expect(file).toEqual({
      id: "file-1",
      projectId: "proj-1",
      fileName: "config.json",
      format: "json",
      enabled: true,
      updatedAt: "2026-07-11T08:00:00.000Z"
    });
  });

  it("insertFileVersion inserts and maps a version row", async () => {
    const createdAt = new Date("2026-07-11T09:00:00.000Z");
    const { db, calls } = createFakeDb([
      {
        id: "ver-1",
        file_id: "file-1",
        version_number: 1,
        storage_key: "org-1/files/battery.dtsi",
        checksum: "abc123",
        size_bytes: 1024,
        parsed_index: { "battery/temp_max": { value: "85" } },
        origin: "upload",
        created_by_user_id: "user-1",
        created_at: createdAt
      }
    ]);

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

    expect(calls[0].text).toContain("insert into project_parameter_file_versions");
    expect(calls[0].values).toEqual([
      "ver-1",
      "file-1",
      1,
      "org-1/files/battery.dtsi",
      "abc123",
      1024,
      JSON.stringify({ "battery/temp_max": { value: "85" } }),
      "upload",
      "user-1"
    ]);
    expect(version).toEqual({
      id: "ver-1",
      fileId: "file-1",
      versionNumber: 1,
      storageKey: "org-1/files/battery.dtsi",
      checksum: "abc123",
      sizeBytes: 1024,
      parsedIndex: { "battery/temp_max": { value: "85" } },
      origin: "upload",
      createdAt: "2026-07-11T09:00:00.000Z",
      createdByUserId: "user-1"
    });
  });
});
