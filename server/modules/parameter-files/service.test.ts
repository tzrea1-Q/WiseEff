import { describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/types";
import type { ObjectStore, StoredObject } from "../logs/objectStore";
import type { Database, QueryResult, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { MAX_FILE_BYTES, uploadProjectParameterFile } from "./service";
import { syncFileVersion } from "./syncService";

vi.mock("./syncService", () => ({
  syncFileVersion: vi.fn(async () => ({ draftsCreated: 0, unchanged: 0, unmatched: 0, skipped: false }))
}));

type QueryCall = {
  text: string;
  values: unknown[];
};

type QueuedResult = unknown[] | ((call: QueryCall) => unknown[]);

function createFakeDb(results: QueuedResult[] = []) {
  const txCalls: QueryCall[] = [];

  const runQuery = async <Row,>(target: QueryCall[], text: string, values: unknown[] = []): Promise<QueryResult<Row>> => {
    const call = { text, values };
    target.push(call);
    const next = results.shift() ?? [];
    const rows = typeof next === "function" ? next(call) : next;
    return { rows: rows as Row[], rowCount: rows.length };
  };

  const tx: Queryable = {
    query: (text, values = []) => runQuery(txCalls, text, values)
  };
  const db: Database = {
    query: (text, values = []) => runQuery([], text, values),
    transaction: async <T,>(fn: (queryable: Queryable) => Promise<T>) => fn(tx)
  };

  return { db, txCalls };
}

function adminAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    user: {
      id: "user-1",
      organizationId: "org-1",
      name: "Riley Chen",
      email: "riley@example.com",
      title: "Admin",
      isActive: true
    },
    organization: { id: "org-1", name: "ChargeLab" },
    roles: [{ projectId: null, roleId: "admin" }],
    permissions: ["admin:access"],
    ...overrides
  };
}

function makeObjectStore() {
  const put = vi.fn(async (input: Parameters<ObjectStore["put"]>[0]): Promise<StoredObject> => {
    return {
      storageKey: `${input.organizationId}/stored-${input.fileName}`,
      fileName: input.fileName,
      contentType: input.contentType,
      fileSizeBytes: input.bytes.byteLength,
      checksumSha256: `checksum-${input.fileName}`
    };
  });
  const get = vi.fn(async () => Buffer.from("stored-file"));

  return { objectStore: { put, get } as ObjectStore, put };
}

function fileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "file-1",
    organization_id: "org-1",
    project_id: "project-1",
    file_name: "config.json",
    format: "json",
    module_hint: null,
    current_version_id: null,
    enabled: true,
    created_at: "2026-07-11T09:00:00.000Z",
    updated_at: "2026-07-11T09:00:00.000Z",
    current_version_number: null,
    ...overrides
  };
}

function versionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "ver-1",
    file_id: "file-1",
    version_number: 1,
    storage_key: "org-1/stored-config.json",
    checksum: "checksum-config.json",
    size_bytes: 26,
    parsed_index: { "battery/temp_max": { value: "85" } },
    origin: "upload",
    created_by_user_id: "user-1",
    created_at: "2026-07-11T09:01:00.000Z",
    ...overrides
  };
}

describe("project parameter file upload service", () => {
  it("upload wires syncFileVersion for upload-origin versions", async () => {
    const { db } = createFakeDb([[], [fileRow()], [versionRow()], [], []]);
    const { objectStore } = makeObjectStore();
    const bytes = Buffer.from('{"battery":{"temp_max":85}}', "utf8");

    const result = await uploadProjectParameterFile(db, objectStore, adminAuth(), {
      projectId: "project-1",
      fileName: "config.json",
      bytes
    });

    expect(syncFileVersion).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      fileId: result.file.id,
      versionId: result.version.id
    });
  });

  it("upload new json file creates file + v1 with parsed_index", async () => {
    const { db, txCalls } = createFakeDb([[], [fileRow()], [versionRow()], [], []]);
    const { objectStore, put } = makeObjectStore();
    const bytes = Buffer.from('{"battery":{"temp_max":85}}', "utf8");

    const result = await uploadProjectParameterFile(db, objectStore, adminAuth(), {
      projectId: "project-1",
      fileName: "config.json",
      bytes
    });

    expect(put).toHaveBeenCalledWith({
      organizationId: "org-1",
      fileName: "config.json",
      contentType: "application/json",
      bytes
    });
    expect(txCalls.find((call) => call.text.includes("insert into project_parameter_files"))).toBeTruthy();
    const insertVersionCall = txCalls.find((call) => call.text.includes("insert into project_parameter_file_versions"));
    expect(insertVersionCall?.values[2]).toBe(1);
    expect(insertVersionCall?.values[6]).toBe(JSON.stringify({ "battery/temp_max": { value: "85" } }));
    expect(txCalls.find((call) => call.text.includes("insert into audit_events"))).toBeTruthy();
    expect(result.file.currentVersionNumber).toBe(1);
    expect(result.version.versionNumber).toBe(1);
  });

  it("upload second version increments version_number", async () => {
    const existingFile = fileRow({
      current_version_id: "ver-1",
      current_version_number: 1
    });
    const { db, txCalls } = createFakeDb([[existingFile], [versionRow({ id: "ver-2", version_number: 2 })], [], []]);
    const { objectStore } = makeObjectStore();

    const result = await uploadProjectParameterFile(db, objectStore, adminAuth(), {
      projectId: "project-1",
      fileName: "config.json",
      bytes: Buffer.from('{"battery":{"temp_max":90}}', "utf8")
    });

    expect(txCalls.find((call) => call.text.includes("insert into project_parameter_files"))).toBeFalsy();
    const insertVersionCall = txCalls.find((call) => call.text.includes("insert into project_parameter_file_versions"));
    expect(insertVersionCall?.values[2]).toBe(2);
    expect(result.version.versionNumber).toBe(2);
  });

  it("rejects >2MB", async () => {
    const { db } = createFakeDb();
    const { objectStore, put } = makeObjectStore();

    await expect(
      uploadProjectParameterFile(db, objectStore, adminAuth(), {
        projectId: "project-1",
        fileName: "config.json",
        bytes: Buffer.alloc(MAX_FILE_BYTES + 1, 1)
      })
    ).rejects.toMatchObject(new ApiError("VALIDATION_FAILED", "Project parameter file exceeds the 2MB limit.", 400));
    expect(put).not.toHaveBeenCalled();
  });

  it("rejects unknown extension", async () => {
    const { db } = createFakeDb();
    const { objectStore, put } = makeObjectStore();

    await expect(
      uploadProjectParameterFile(db, objectStore, adminAuth(), {
        projectId: "project-1",
        fileName: "config.txt",
        bytes: Buffer.from("x", "utf8")
      })
    ).rejects.toMatchObject(new ApiError("VALIDATION_FAILED", "Unsupported parameter file extension.", 400));
    expect(put).not.toHaveBeenCalled();
  });

  it("rejects DTS with /include/ before storage or version insert", async () => {
    const { db, txCalls } = createFakeDb();
    const { objectStore, put } = makeObjectStore();
    const bytes = Buffer.from('/include/ "pin.dtsi"\n/ { board_id = <0>; };\n', "utf8");

    await expect(
      uploadProjectParameterFile(db, objectStore, adminAuth(), {
        projectId: "project-1",
        fileName: "board.dts",
        bytes
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      details: { code: "dts-include-unsupported" }
    });
    expect(put).not.toHaveBeenCalled();
    expect(txCalls.find((call) => call.text.includes("insert into project_parameter_files"))).toBeFalsy();
  });

  it("uploads DTS with unsupported constructs but skips sync and returns warnings", async () => {
    const { db } = createFakeDb([
      [],
      [fileRow({ file_name: "overlay.dts", format: "dts" })],
      [versionRow({ id: "ver-dts-1", storage_key: "org-1/stored-overlay.dts", size_bytes: 64 })],
      [],
      []
    ]);
    const { objectStore, put } = makeObjectStore();
    const bytes = Buffer.from("&demo {\n\tchip@6E {\n\t\treg = <0x6e>;\n\t};\n};\n", "utf8");
    vi.mocked(syncFileVersion).mockClear();

    const result = await uploadProjectParameterFile(db, objectStore, adminAuth(), {
      projectId: "project-1",
      fileName: "overlay.dts",
      bytes
    });

    expect(put).toHaveBeenCalled();
    expect(result.file.currentVersionNumber).toBe(1);
    expect(result.unsupportedConstructs?.length).toBeGreaterThan(0);
    expect(result.unsupportedConstructs?.some((f) => f.code === "unit-address-node" || f.code === "overlay-ref")).toBe(
      true
    );
    expect(syncFileVersion).not.toHaveBeenCalled();
  });

  it("uploads clean simple DTS and still syncs", async () => {
    const { db } = createFakeDb([
      [],
      [fileRow({ file_name: "simple.dts", format: "dts" })],
      [versionRow({ id: "ver-dts-clean", storage_key: "org-1/stored-simple.dts", size_bytes: 32 })],
      [],
      []
    ]);
    const { objectStore } = makeObjectStore();
    const bytes = Buffer.from("/ {\n\tboard_id = <0>;\n};\n", "utf8");
    vi.mocked(syncFileVersion).mockClear();

    const result = await uploadProjectParameterFile(db, objectStore, adminAuth(), {
      projectId: "project-1",
      fileName: "simple.dts",
      bytes
    });

    expect(result.unsupportedConstructs).toBeUndefined();
    expect(syncFileVersion).toHaveBeenCalled();
  });
});
