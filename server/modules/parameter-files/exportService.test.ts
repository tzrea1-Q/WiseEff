import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseDts, serializeDts } from "../dts";
import type { AuthContext } from "../auth/types";
import type { ObjectStore } from "../logs/objectStore";
import type { Database, QueryResult, Queryable } from "../../shared/database/client";
import { createStubDtcValidator } from "./dtcValidator";
import { exportConfigSet, exportFile } from "./exportService";

const teachingFixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "__fixtures__/dts-teaching-sample.dts"
);
const teachingFixture = readFileSync(teachingFixturePath, "utf8");

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
    query: (text, values = []) => runQuery(txCalls, text, values),
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

function viewerAuth(): AuthContext {
  return adminAuth({ roles: [{ projectId: null, roleId: "hardware-user" }], permissions: ["parameter:view"] });
}

function configSetRow(overrides: Record<string, unknown> = {}) {
  const timestamp = "2026-07-14T09:00:00.000Z";
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

function memberFileRow(overrides: Record<string, unknown> = {}) {
  return {
    file_id: "file-1",
    file_name: "board-a.dts",
    current_version_id: "fv-1",
    version_number: 3,
    ...overrides
  };
}

function fileRow(overrides: Record<string, unknown> = {}) {
  const timestamp = "2026-07-14T09:00:00.000Z";
  return {
    id: "file-1",
    organization_id: "org-1",
    project_id: "project-1",
    file_name: "board-a.dts",
    format: "dts",
    module_hint: null,
    current_version_id: "fv-1",
    enabled: true,
    created_at: timestamp,
    updated_at: timestamp,
    current_version_number: 3,
    ...overrides
  };
}

function fileVersionRow(overrides: Record<string, unknown> = {}) {
  const timestamp = "2026-07-14T09:00:00.000Z";
  return {
    id: "fv-1",
    file_id: "file-1",
    version_number: 3,
    storage_key: "sk-1",
    checksum: "checksum-1",
    size_bytes: teachingFixture.length,
    parsed_index: {},
    origin: "upload",
    created_by_user_id: null,
    created_at: timestamp,
    ...overrides
  };
}

function membershipRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "file-1",
    organization_id: "org-1",
    project_id: "project-1",
    config_set_id: "dcs-1",
    config_set_role: "base",
    config_set_sort_order: 0,
    ...overrides
  };
}

function fakeObjectStore(contents: Record<string, string>): ObjectStore {
  return {
    put: async () => {
      throw new Error("not used in these tests");
    },
    get: async (storageKey: string) => {
      const content = contents[storageKey];
      if (content === undefined) {
        throw new Error(`no fake content for storage key ${storageKey}`);
      }
      return Buffer.from(content, "utf8");
    }
  };
}

describe("export service authorization", () => {
  it("exportFile rejects non-admin auth with 403", async () => {
    const { db } = createFakeDb();

    await expect(exportFile(db, viewerAuth(), "file-1", { objectStore: fakeObjectStore({}) })).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403
    });
  });

  it("exportConfigSet rejects non-admin auth with 403", async () => {
    const { db } = createFakeDb();

    await expect(
      exportConfigSet(db, viewerAuth(), "dcs-1", { objectStore: fakeObjectStore({}) })
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });
});

describe("exportFile", () => {
  it("exports dts content via serializeDts(parseDts(source)) and matches the teaching fixture byte-for-byte", async () => {
    const objectStore = fakeObjectStore({ "sk-1": teachingFixture });
    const { db, txCalls } = createFakeDb([[fileRow()], [fileVersionRow()], []]);

    const result = await exportFile(db, adminAuth(), "file-1", { objectStore }, { requestId: "req-1" });

    expect(result).toEqual({
      fileId: "file-1",
      fileName: "board-a.dts",
      format: "dts",
      versionNumber: 3,
      content: teachingFixture
    });
    expect(result.content).toBe(serializeDts(parseDts(teachingFixture)));

    const auditCall = txCalls.find((call) => call.text.includes("insert into audit_events"));
    expect(auditCall).toBeTruthy();
    expect(auditCall?.values[6]).toBe("export");
    expect(auditCall?.values[7]).toBe("file");
    expect(auditCall?.values[10]).toBe("file-1");
  });

  it("exports json content as the original UTF-8 text without transformation", async () => {
    const jsonSource = '{"enabled":true,"threshold":42}\n';
    const objectStore = fakeObjectStore({ "sk-json": jsonSource });
    const { db } = createFakeDb([
      [fileRow({ id: "file-json", file_name: "config.json", format: "json", current_version_id: "fv-json", current_version_number: 1 })],
      [fileVersionRow({ id: "fv-json", file_id: "file-json", version_number: 1, storage_key: "sk-json", size_bytes: jsonSource.length })],
      []
    ]);

    const result = await exportFile(db, adminAuth(), "file-json", { objectStore });

    expect(result.format).toBe("json");
    expect(result.content).toBe(jsonSource);
  });

  it("returns 404 when the file does not exist", async () => {
    const { db } = createFakeDb([[]]);

    await expect(
      exportFile(db, adminAuth(), "missing", { objectStore: fakeObjectStore({}) })
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });
});

describe("exportConfigSet", () => {
  it("returns manifest and member files ordered by sortOrder with roles and validation status", async () => {
    const jsonSource = '{"mode":"prod"}\n';
    const validator = createStubDtcValidator(() => ({
      ok: true,
      mode: "block",
      compiler: "dtc",
      diagnostics: []
    }));

    const objectStore = fakeObjectStore({
      "sk-base": teachingFixture,
      "sk-overlay": "&demo_integer {\n\tsingle_value = <1>;\n};\n",
      "sk-json": jsonSource
    });

    const { db, txCalls } = createFakeDb([
      [configSetRow()],
      [
        memberFileRow({ file_id: "file-base", file_name: "board-a.dts", current_version_id: "fv-base", version_number: 2 }),
        memberFileRow({
          file_id: "file-overlay",
          file_name: "board-a.overlay.dtsi",
          current_version_id: "fv-overlay",
          version_number: 1
        }),
        memberFileRow({
          file_id: "file-json",
          file_name: "config.json",
          current_version_id: "fv-json",
          version_number: 1
        })
      ],
      [fileRow({ id: "file-base", file_name: "board-a.dts", current_version_id: "fv-base", current_version_number: 2 })],
      [membershipRow({ id: "file-base", config_set_role: "base", config_set_sort_order: 0 })],
      [fileVersionRow({ id: "fv-base", file_id: "file-base", version_number: 2, storage_key: "sk-base" })],
      [
        fileRow({
          id: "file-overlay",
          file_name: "board-a.overlay.dtsi",
          current_version_id: "fv-overlay",
          current_version_number: 1
        })
      ],
      [membershipRow({ id: "file-overlay", config_set_role: "overlay", config_set_sort_order: 1 })],
      [
        fileVersionRow({
          id: "fv-overlay",
          file_id: "file-overlay",
          version_number: 1,
          storage_key: "sk-overlay",
          size_bytes: 42
        })
      ],
      [
        fileRow({
          id: "file-json",
          file_name: "config.json",
          format: "json",
          current_version_id: "fv-json",
          current_version_number: 1
        })
      ],
      [membershipRow({ id: "file-json", config_set_role: "misc", config_set_sort_order: 2 })],
      [
        fileVersionRow({
          id: "fv-json",
          file_id: "file-json",
          version_number: 1,
          storage_key: "sk-json",
          size_bytes: jsonSource.length
        })
      ],
      []
    ]);

    const result = await exportConfigSet(
      db,
      adminAuth(),
      "dcs-1",
      { objectStore, validator },
      { requestId: "req-1" }
    );

    expect(result.manifest.configSetId).toBe("dcs-1");
    expect(result.manifest.name).toBe("board-a");
    expect(result.manifest.projectId).toBe("project-1");
    expect(result.manifest.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.manifest.validation).toEqual({
      ok: true,
      mode: "block",
      compiler: "dtc",
      requiresConfirmation: false
    });
    expect(result.manifest.members).toEqual([
      {
        fileId: "file-base",
        fileName: "board-a.dts",
        role: "base",
        sortOrder: 0,
        versionNumber: 2,
        format: "dts"
      },
      {
        fileId: "file-overlay",
        fileName: "board-a.overlay.dtsi",
        role: "overlay",
        sortOrder: 1,
        versionNumber: 1,
        format: "dts"
      },
      {
        fileId: "file-json",
        fileName: "config.json",
        role: "misc",
        sortOrder: 2,
        versionNumber: 1,
        format: "json"
      }
    ]);

    expect(result.files).toHaveLength(3);
    expect(result.files[0]).toEqual({
      name: "board-a.dts",
      format: "dts",
      content: teachingFixture
    });
    expect(result.files[1].name).toBe("board-a.overlay.dtsi");
    expect(result.files[1].format).toBe("dts");
    expect(result.files[1].content).toBe(serializeDts(parseDts(result.files[1].content)));
    expect(result.files[2]).toEqual({
      name: "config.json",
      format: "json",
      content: jsonSource
    });

    const auditCall = txCalls.find((call) => call.text.includes("insert into audit_events"));
    expect(auditCall).toBeTruthy();
    expect(auditCall?.values[6]).toBe("export");
    expect(auditCall?.values[7]).toBe("config-set");
    expect(auditCall?.values[10]).toBe("dcs-1");
  });

  it("succeeds even when validation reports errors and records the status in the manifest", async () => {
    const validator = createStubDtcValidator(() => ({
      ok: false,
      mode: "block",
      compiler: "dtc",
      diagnostics: [{ file: "board-a.dts", severity: "error", message: "syntax error" }]
    }));

    const objectStore = fakeObjectStore({ "sk-1": teachingFixture });
    const { db } = createFakeDb([
      [configSetRow()],
      [memberFileRow()],
      [fileRow()],
      [membershipRow()],
      [fileVersionRow()],
      []
    ]);

    const result = await exportConfigSet(db, adminAuth(), "dcs-1", { objectStore, validator });

    expect(result.manifest.validation?.ok).toBe(false);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].content).toBe(teachingFixture);
  });

  it("returns 404 when the config set does not exist", async () => {
    const { db } = createFakeDb([[]]);

    await expect(
      exportConfigSet(db, adminAuth(), "missing", { objectStore: fakeObjectStore({}) })
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });
});
