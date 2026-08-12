import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AuthContext } from "../auth/types";
import { makeTestAuthContext } from "../../testing/authContext";
import { createMemoryObjectStore, type MemoryObjectStore } from "../../testing/objectStore";
import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import { addConfigSetFile, createConfigSet } from "./configSetService";
import { createStubDtcValidator } from "./dtcValidator";
import { uploadProjectParameterFile } from "./service";
import { runValidationGate } from "./validationGate";

const databaseAvailable = await isTestDatabaseAvailable();

const boardSource = "/dts-v1/;\n/ {\n\tboard_id = <0>;\n};\n";

function adminAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    ...makeTestAuthContext({
      userId: "user-1",
      organizationId: "org-1",
      name: "Riley Chen",
      email: "riley@example.com",
      organizationName: "ChargeLab",
      roles: [{ projectId: null, roleId: "admin" }],
      permissions: ["admin:access"]
    }),
    ...overrides
  };
}

describe.skipIf(!databaseAvailable)("runValidationGate", () => {
  let db: InMemoryTestDatabase;
  let objectStore: MemoryObjectStore;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    objectStore = createMemoryObjectStore();
    await seedCoreGraph(db, {
      organization: { id: "org-1", name: "ChargeLab" },
      users: [{ id: "user-1", name: "Riley Chen", email: "riley@example.com" }],
      projects: [{ id: "project-1", name: "Aurora", code: "AUR" }]
    });
  });

  afterEach(async () => {
    await db?.rollback();
  });

  /** Uploads board-a.dts and wires it into a fresh config set as the base member. */
  async function seedConfigSetWithBoard() {
    const upload = await uploadProjectParameterFile(db, objectStore, adminAuth(), {
      projectId: "project-1",
      fileName: "board-a.dts",
      bytes: Buffer.from(boardSource, "utf8")
    });
    const configSet = await createConfigSet(db, adminAuth(), { projectId: "project-1", name: "board-a" });
    await addConfigSetFile(db, adminAuth(), {
      configSetId: configSet.id,
      fileId: upload.file.id,
      role: "base",
      sortOrder: 0
    });
    return { configSet, upload };
  }

  async function validationGateAudits() {
    const result = await db.query<{
      target_type: string | null;
      target_id: string | null;
      project_id: string | null;
      metadata: Record<string, unknown>;
    }>(
      `select target_type, target_id, project_id, metadata
       from audit_events
       where organization_id = $1 and kind = 'validation.gate' and action = 'run'`,
      ["org-1"]
    );
    return result.rows;
  }

  it("throws 409 CONFLICT with dts-validation-failed when block mode validation fails and writes audit first", async () => {
    const diagnostics = [{ file: "board-a.dts", line: 3, severity: "error" as const, message: "syntax error" }];
    const validator = createStubDtcValidator(() => ({
      ok: false,
      mode: "block",
      compiler: "dtc",
      diagnostics
    }));
    const { configSet } = await seedConfigSetWithBoard();

    await expect(
      runValidationGate(
        db,
        adminAuth(),
        { configSetId: configSet.id, mode: "block" },
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

    // The audit row survives the throw: it was written before the gate rejected.
    const audits = await validationGateAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      target_type: "dts-config-set",
      target_id: configSet.id,
      project_id: "project-1"
    });
    expect(audits[0].metadata).toMatchObject({
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
    const { configSet } = await seedConfigSetWithBoard();

    const result = await runValidationGate(
      db,
      adminAuth(),
      { configSetId: configSet.id, mode: "warn" },
      { objectStore, validator }
    );

    expect(result).toEqual({
      ok: true,
      mode: "warn",
      requiresConfirmation: true,
      diagnostics: [{ file: "board-a.dts", severity: "error", message: "warn-only error" }],
      compiler: "dtc"
    });

    const audits = await validationGateAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0].metadata).toMatchObject({ ok: true, requiresConfirmation: true });
  });

  it("returns requiresConfirmation false when block mode passes", async () => {
    const validator = createStubDtcValidator(() => ({
      ok: true,
      mode: "block",
      compiler: "dtc",
      diagnostics: []
    }));
    const { configSet } = await seedConfigSetWithBoard();

    const result = await runValidationGate(
      db,
      adminAuth(),
      { configSetId: configSet.id, mode: "block" },
      { objectStore, validator }
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
    const { configSet } = await seedConfigSetWithBoard();

    const result = await runValidationGate(
      db,
      adminAuth(),
      { configSetId: configSet.id, mode: "off" },
      { objectStore, validator }
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
    const { configSet } = await seedConfigSetWithBoard();

    const result = await runValidationGate(
      db,
      adminAuth(),
      { configSetId: configSet.id, mode: "warn" },
      { objectStore, validator }
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
    const { configSet } = await seedConfigSetWithBoard();
    const jsonUpload = await uploadProjectParameterFile(db, objectStore, adminAuth(), {
      projectId: "project-1",
      fileName: "params.json",
      bytes: Buffer.from('{"foo": 1}', "utf8")
    });
    await addConfigSetFile(db, adminAuth(), {
      configSetId: configSet.id,
      fileId: jsonUpload.file.id,
      role: "misc",
      sortOrder: 1
    });

    await runValidationGate(
      db,
      adminAuth(),
      { configSetId: configSet.id, mode: "block" },
      { objectStore, validator }
    );

    expect(validatedFiles).toEqual(["board-a.dts"]);
  });

  it("returns 404 when the config set does not exist", async () => {
    await expect(
      runValidationGate(
        db,
        adminAuth(),
        { configSetId: "missing", mode: "block" },
        {
          objectStore,
          validator: createStubDtcValidator(() => ({ ok: true, mode: "block", compiler: "dtc", diagnostics: [] }))
        }
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("rejects empty config sets on the release/baseline path", async () => {
    const configSet = await createConfigSet(db, adminAuth(), { projectId: "project-1", name: "board-a" });

    await expect(
      runValidationGate(
        db,
        adminAuth(),
        { configSetId: configSet.id, mode: "block", forRelease: true },
        {
          objectStore,
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

    const audits = await validationGateAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0].metadata).toMatchObject({ ok: false });
  });

  it("compiles functional-role members (charging/thermal/misc) as overlays so their DTS cannot bypass the release gate", async () => {
    const { configSet } = await seedConfigSetWithBoard();
    const chargingUpload = await uploadProjectParameterFile(db, objectStore, adminAuth(), {
      projectId: "project-1",
      fileName: "charging.dts",
      bytes: Buffer.from("/dts-v1/;\n/ {\n\tcharging = <1>;\n};\n", "utf8")
    });
    await addConfigSetFile(db, adminAuth(), {
      configSetId: configSet.id,
      fileId: chargingUpload.file.id,
      role: "charging",
      sortOrder: 1
    });

    let captured: { entryFile: string; overlayOrder: string[] } | undefined;
    const toolchain = {
      async validate(input: { entryFile: string; overlayOrder: string[]; files: Map<string, { content: string }> }) {
        captured = { entryFile: input.entryFile, overlayOrder: [...input.overlayOrder] };
        return {
          ok: true,
          mode: "release" as const,
          compiler: { dtc: "1.8.1", fdtoverlay: "1.8.1", dtschema: "2026.6" },
          diagnostics: [],
          artifacts: {}
        };
      },
      async probe() {
        return {
          dtc: { path: "/usr/bin/dtc", version: "1.8.1" },
          fdtoverlay: { path: "/usr/bin/fdtoverlay", version: "1.8.1" },
          dtschema: { path: "/usr/bin/dt-validate", version: "2026.6" }
        };
      }
    };

    await runValidationGate(
      db,
      adminAuth(),
      { configSetId: configSet.id, mode: "block", forRelease: true },
      { objectStore, toolchain }
    );

    // The functional-role file must be applied as an overlay just like the real
    // config-revision assembly (OVERLAY_ROLES); otherwise its DTS is never dtc-compiled.
    expect(captured?.entryFile).toBe("board-a.dts");
    expect(captured?.overlayOrder).toContain("charging.dts");
  });
});
