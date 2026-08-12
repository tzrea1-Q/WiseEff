import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseDts, serializeDts } from "../dts";
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
import { exportConfigSet, exportFile } from "./exportService";
import { uploadProjectParameterFile } from "./service";

const teachingFixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "__fixtures__/dts-teaching-sample.dts"
);
const teachingFixture = readFileSync(teachingFixturePath, "utf8");

const databaseAvailable = await isTestDatabaseAvailable();

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

function viewerAuth(): AuthContext {
  return adminAuth({
    roles: [{ projectId: null, roleId: "hardware-user" }],
    permissions: ["parameter:view"]
  });
}

describe.skipIf(!databaseAvailable)("export service", () => {
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

  async function uploadFile(fileName: string, content: string) {
    return uploadProjectParameterFile(db, objectStore, adminAuth(), {
      projectId: "project-1",
      fileName,
      bytes: Buffer.from(content, "utf8")
    });
  }

  async function exportAudits(action: "file" | "config-set") {
    const result = await db.query<{
      action: string;
      target_type: string | null;
      target_id: string | null;
      project_id: string | null;
      metadata: Record<string, unknown>;
    }>(
      `select action, target_type, target_id, project_id, metadata
       from audit_events
       where organization_id = $1 and kind = 'export' and action = $2`,
      ["org-1", action]
    );
    return result.rows;
  }

  describe("export service authorization", () => {
    it("exportFile rejects non-admin auth with 403", async () => {
      await expect(exportFile(db, viewerAuth(), "file-1", { objectStore })).rejects.toMatchObject({
        code: "FORBIDDEN",
        status: 403
      });
    });

    it("exportConfigSet rejects non-admin auth with 403", async () => {
      await expect(
        exportConfigSet(db, viewerAuth(), "dcs-1", { objectStore })
      ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    });
  });

  describe("exportFile", () => {
    it("exports dts content via serializeDts(parseDts(source)) and matches the teaching fixture byte-for-byte", async () => {
      // v1 carries different content so the export provably reads the *current* version.
      await uploadFile("board-a.dts", teachingFixture.replace("single_value = <42>;", "single_value = <99>;"));
      const upload = await uploadFile("board-a.dts", teachingFixture);
      expect(upload.version.versionNumber).toBe(2);

      const result = await exportFile(db, adminAuth(), upload.file.id, { objectStore }, { requestId: "req-1" });

      expect(result).toEqual({
        fileId: upload.file.id,
        fileName: "board-a.dts",
        format: "dts",
        versionNumber: 2,
        content: teachingFixture
      });
      expect(result.content).toBe(serializeDts(parseDts(teachingFixture)));

      const audits = await exportAudits("file");
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        target_type: "project-parameter-file",
        target_id: upload.file.id,
        project_id: "project-1"
      });
      expect(audits[0].metadata).toMatchObject({ fileName: "board-a.dts", format: "dts", versionNumber: 2 });
    });

    it("exports json content as the original UTF-8 text without transformation", async () => {
      const jsonSource = '{"enabled":true,"threshold":42}\n';
      const upload = await uploadFile("config.json", jsonSource);

      const result = await exportFile(db, adminAuth(), upload.file.id, { objectStore });

      expect(result.format).toBe("json");
      expect(result.content).toBe(jsonSource);
      expect(result.versionNumber).toBe(1);
    });

    it("returns 404 when the file does not exist", async () => {
      await expect(
        exportFile(db, adminAuth(), "missing", { objectStore })
      ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    });
  });

  describe("exportConfigSet", () => {
    it("returns manifest and member files ordered by sortOrder with roles and validation status", async () => {
      const jsonSource = '{"mode":"prod"}\n';
      const overlaySource = "&demo_integer {\n\tsingle_value = <1>;\n};\n";
      const validator = createStubDtcValidator(() => ({
        ok: true,
        mode: "block",
        compiler: "dtc",
        diagnostics: []
      }));

      const base = await uploadFile("board-a.dts", teachingFixture);
      const overlay = await uploadFile("board-a.overlay.dtsi", overlaySource);
      const json = await uploadFile("config.json", jsonSource);

      const configSet = await createConfigSet(db, adminAuth(), { projectId: "project-1", name: "board-a" });
      await addConfigSetFile(db, adminAuth(), { configSetId: configSet.id, fileId: base.file.id, role: "base", sortOrder: 0 });
      await addConfigSetFile(db, adminAuth(), { configSetId: configSet.id, fileId: overlay.file.id, role: "overlay", sortOrder: 1 });
      await addConfigSetFile(db, adminAuth(), { configSetId: configSet.id, fileId: json.file.id, role: "misc", sortOrder: 2 });

      const result = await exportConfigSet(
        db,
        adminAuth(),
        configSet.id,
        { objectStore, validator },
        { requestId: "req-1" }
      );

      expect(result.manifest.configSetId).toBe(configSet.id);
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
          fileId: base.file.id,
          fileName: "board-a.dts",
          role: "base",
          sortOrder: 0,
          versionNumber: 1,
          format: "dts"
        },
        {
          fileId: overlay.file.id,
          fileName: "board-a.overlay.dtsi",
          role: "overlay",
          sortOrder: 1,
          versionNumber: 1,
          format: "dts"
        },
        {
          fileId: json.file.id,
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

      const audits = await exportAudits("config-set");
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({ target_type: "dts-config-set", target_id: configSet.id });
      expect(audits[0].metadata).toMatchObject({ name: "board-a", memberCount: 3, validationOk: true });
    });

    it("succeeds even when validation reports errors and records the status in the manifest", async () => {
      const validator = createStubDtcValidator(() => ({
        ok: false,
        mode: "block",
        compiler: "dtc",
        diagnostics: [{ file: "board-a.dts", severity: "error", message: "syntax error" }]
      }));

      const upload = await uploadFile("board-a.dts", teachingFixture);
      const configSet = await createConfigSet(db, adminAuth(), { projectId: "project-1", name: "board-a" });
      await addConfigSetFile(db, adminAuth(), { configSetId: configSet.id, fileId: upload.file.id, role: "base", sortOrder: 0 });

      const result = await exportConfigSet(db, adminAuth(), configSet.id, { objectStore, validator });

      expect(result.manifest.validation?.ok).toBe(false);
      expect(result.files).toHaveLength(1);
      expect(result.files[0].content).toBe(teachingFixture);
    });

    it("returns 404 when the config set does not exist", async () => {
      await expect(
        exportConfigSet(db, adminAuth(), "missing", { objectStore })
      ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    });
  });
});
