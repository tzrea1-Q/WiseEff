import { describe, expect, it } from "vitest";

import type { AuthContext } from "../auth/types";
import type { ObjectStore } from "../logs/objectStore";
import type { Database, QueryResult, Queryable } from "../../shared/database/client";
import { createStubDtcValidator } from "./dtcValidator";
import { runValidationGate } from "./validationGate";

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
    size_bytes: 100,
    parsed_index: {},
    origin: "upload",
    created_by_user_id: null,
    created_at: timestamp,
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

function findValidationGateAudit(calls: QueryCall[]) {
  return calls.find(
    (call) =>
      call.text.includes("insert into audit_events") &&
      call.values[6] === "validation.gate" &&
      call.values[7] === "run"
  );
}

describe("runValidationGate", () => {
  it("throws 409 CONFLICT with dts-validation-failed when block mode validation fails and writes audit first", async () => {
    const diagnostics = [{ file: "board-a.dts", line: 3, severity: "error" as const, message: "syntax error" }];
    const validator = createStubDtcValidator(() => ({
      ok: false,
      mode: "block",
      compiler: "dtc",
      diagnostics
    }));

    const { db, txCalls } = createFakeDb([
      [configSetRow()],
      [memberFileRow()],
      [fileRow()],
      [fileVersionRow()],
      []
    ]);

    const objectStore = fakeObjectStore({ "sk-1": "/dts-v1/; / { };" });

    await expect(
      runValidationGate(
        db,
        adminAuth(),
        { configSetId: "dcs-1", mode: "block" },
        { objectStore, validator }
      )
    ).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
      details: {
        code: "dts-validation-failed",
        diagnostics,
        mode: "block",
        compiler: "dtc"
      }
    });

    const auditCall = findValidationGateAudit(txCalls);
    expect(auditCall).toBeTruthy();
    expect(auditCall?.values[9]).toBe("dts-config-set");
    expect(auditCall?.values[10]).toBe("dcs-1");
    const metadata = JSON.parse(auditCall?.values[11] as string);
    expect(metadata).toMatchObject({
      ok: false,
      mode: "block",
      compiler: "dtc",
      diagnosticCount: 1,
      errorCount: 1,
      requiresConfirmation: false
    });
  });

  it("returns requiresConfirmation true in warn mode even when validation reports errors", async () => {
    const validator = createStubDtcValidator(() => ({
      ok: true,
      mode: "warn",
      compiler: "dtc",
      diagnostics: [{ file: "board-a.dts", severity: "error", message: "warn-only error" }]
    }));

    const { db, txCalls } = createFakeDb([
      [configSetRow()],
      [memberFileRow()],
      [fileRow()],
      [fileVersionRow()],
      []
    ]);

    const result = await runValidationGate(
      db,
      adminAuth(),
      { configSetId: "dcs-1", mode: "warn" },
      { objectStore: fakeObjectStore({ "sk-1": "/dts-v1/; / { };" }), validator }
    );

    expect(result).toEqual({
      ok: true,
      mode: "warn",
      requiresConfirmation: true,
      diagnostics: [{ file: "board-a.dts", severity: "error", message: "warn-only error" }],
      compiler: "dtc"
    });

    const auditCall = findValidationGateAudit(txCalls);
    expect(auditCall).toBeTruthy();
    const metadata = JSON.parse(auditCall?.values[11] as string);
    expect(metadata.requiresConfirmation).toBe(true);
    expect(metadata.ok).toBe(true);
  });

  it("returns requiresConfirmation false when block mode passes", async () => {
    const validator = createStubDtcValidator(() => ({
      ok: true,
      mode: "block",
      compiler: "dtc",
      diagnostics: []
    }));

    const { db } = createFakeDb([
      [configSetRow()],
      [memberFileRow()],
      [fileRow()],
      [fileVersionRow()],
      []
    ]);

    const result = await runValidationGate(
      db,
      adminAuth(),
      { configSetId: "dcs-1", mode: "block" },
      { objectStore: fakeObjectStore({ "sk-1": "/dts-v1/; / { };" }), validator }
    );

    expect(result).toEqual({
      ok: true,
      mode: "block",
      requiresConfirmation: false,
      diagnostics: [],
      compiler: "dtc"
    });
  });

  it("returns requiresConfirmation false in off mode", async () => {
    const validator = createStubDtcValidator(() => ({
      ok: true,
      mode: "off",
      compiler: "unavailable",
      diagnostics: [{ file: "<validation>", severity: "warning", message: "skipped" }]
    }));

    const { db } = createFakeDb([
      [configSetRow()],
      [memberFileRow()],
      [fileRow()],
      [fileVersionRow()],
      []
    ]);

    const result = await runValidationGate(
      db,
      adminAuth(),
      { configSetId: "dcs-1", mode: "off" },
      { objectStore: fakeObjectStore({ "sk-1": "/dts-v1/; / { };" }), validator }
    );

    expect(result.ok).toBe(true);
    expect(result.mode).toBe("off");
    expect(result.requiresConfirmation).toBe(false);
  });

  it("returns requiresConfirmation true when compiler is unavailable but validation is allowed", async () => {
    const validator = createStubDtcValidator(() => ({
      ok: true,
      mode: "warn",
      compiler: "unavailable",
      diagnostics: [{ file: "<validation>", severity: "warning", message: "dtc unavailable" }]
    }));

    const { db } = createFakeDb([
      [configSetRow()],
      [memberFileRow()],
      [fileRow()],
      [fileVersionRow()],
      []
    ]);

    const result = await runValidationGate(
      db,
      adminAuth(),
      { configSetId: "dcs-1", mode: "warn" },
      { objectStore: fakeObjectStore({ "sk-1": "/dts-v1/; / { };" }), validator }
    );

    expect(result.requiresConfirmation).toBe(true);
    expect(result.compiler).toBe("unavailable");
  });

  it("skips non-dts members when calling the validator", async () => {
    let validatedFiles: string[] = [];
    const validator = createStubDtcValidator((files) => {
      validatedFiles = files.map((file) => file.name);
      return { ok: true, mode: "block", compiler: "dtc", diagnostics: [] };
    });

    const { db } = createFakeDb([
      [configSetRow()],
      [
        memberFileRow(),
        memberFileRow({
          file_id: "file-2",
          file_name: "params.json",
          current_version_id: "fv-2",
          version_number: 1
        })
      ],
      [fileRow()],
      [fileVersionRow()],
      [fileRow({ id: "file-2", file_name: "params.json", format: "json", current_version_id: "fv-2", current_version_number: 1 })],
      [fileVersionRow({ id: "fv-2", file_id: "file-2", storage_key: "sk-2" })],
      []
    ]);

    await runValidationGate(
      db,
      adminAuth(),
      { configSetId: "dcs-1", mode: "block" },
      {
        objectStore: fakeObjectStore({
          "sk-1": "/dts-v1/; / { };",
          "sk-2": '{"foo": 1}'
        }),
        validator
      }
    );

    expect(validatedFiles).toEqual(["board-a.dts"]);
  });

  it("returns 404 when the config set does not exist", async () => {
    const { db } = createFakeDb([[]]);

    await expect(
      runValidationGate(
        db,
        adminAuth(),
        { configSetId: "missing", mode: "block" },
        { objectStore: fakeObjectStore({}), validator: createStubDtcValidator(() => ({ ok: true, mode: "block", compiler: "dtc", diagnostics: [] })) }
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("rejects empty config sets on the release/baseline path", async () => {
    const { db, txCalls } = createFakeDb([
      [configSetRow()],
      [], // no members
      []
    ]);

    await expect(
      runValidationGate(
        db,
        adminAuth(),
        { configSetId: "dcs-1", mode: "block", forRelease: true },
        {
          objectStore: fakeObjectStore({}),
          toolchain: {
            async validate() {
              throw new Error("toolchain must not run for an empty config set");
            },
            async probe() {
              return {
                dtc: { path: null, version: null },
                fdtoverlay: { path: null, version: null },
                dtschema: { path: null, version: null }
              };
            }
          }
        }
      )
    ).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
      details: { code: "dts-empty-config-set" }
    });

    const auditCall = findValidationGateAudit(txCalls);
    expect(auditCall).toBeTruthy();
    const metadata = JSON.parse(auditCall?.values[11] as string);
    expect(metadata.ok).toBe(false);
  });
});
