import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AuthContext } from "../auth/types";
import type { ObjectStore } from "../logs/objectStore";
import { ApiError } from "../../shared/http/errors";
import { makeTestAuthContext } from "../../testing/authContext";
import { createMemoryObjectStore } from "../../testing/objectStore";
import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import { MAX_FILE_BYTES, rollbackProjectParameterFileVersion, uploadProjectParameterFile } from "./service";

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

/** Memory-backed store that also records `put` inputs so content-type wiring stays observable. */
function makeObjectStore() {
  const store = createMemoryObjectStore();
  const putCalls: Array<Parameters<ObjectStore["put"]>[0]> = [];
  const objectStore: ObjectStore = {
    put: async (input) => {
      putCalls.push(input);
      return store.put(input);
    },
    get: (storageKey) => store.get(storageKey)
  };
  return { objectStore, putCalls, entries: store.entries };
}

describe.skipIf(!databaseAvailable)("project parameter file upload service", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedCoreGraph(db, {
      organization: { id: "org-1", name: "ChargeLab" },
      users: [{ id: "user-1", name: "Riley Chen", email: "riley@example.com" }],
      projects: [{ id: "project-1", name: "Aurora", code: "AUR" }]
    });
  });

  afterEach(async () => {
    await db?.rollback();
  });

  /** Legacy flat parameter row bound to a source file/node so the real file sync can match it. */
  async function seedTrackedParameter(input: {
    ppvId: string;
    pdId: string;
    name: string;
    sourceFileName: string;
    sourceNodePath: string;
    currentValue: string;
  }) {
    await db.query(
      `insert into parameter_definitions (
         id, organization_id, name, description, explanation, config_format,
         module, default_range, unit, risk
       ) values ($1, 'org-1', $2, 'desc', 'explanation', 'ENV', 'battery', '0-120', 'C', 'High')`,
      [input.pdId, input.name]
    );
    await db.query(
      `insert into project_parameter_values (
         id, organization_id, project_id, parameter_definition_id,
         current_value, recommended_value, value_version, updated_by_user_id,
         source_file_name, source_node_path
       ) values ($1, 'org-1', 'project-1', $2, $3, $3, 1, 'user-1', $4, $5)`,
      [input.ppvId, input.pdId, input.currentValue, input.sourceFileName, input.sourceNodePath]
    );
  }

  async function fileSyncDrafts(ppvId: string) {
    const result = await db.query<{
      target_value: string;
      origin: string;
      origin_file_version_id: string | null;
      reason: string;
    }>(
      `select target_value, origin, origin_file_version_id, reason
       from parameter_drafts
       where organization_id = 'org-1' and project_parameter_value_id = $1`,
      [ppvId]
    );
    return result.rows;
  }

  async function structuralNodeCount(versionId: string) {
    const result = await db.query<{ count: string }>(
      "select count(*)::text as count from dts_nodes where file_version_id = $1",
      [versionId]
    );
    return Number(result.rows[0].count);
  }

  async function fileRowCount() {
    const result = await db.query<{ count: string }>(
      "select count(*)::text as count from project_parameter_files where organization_id = 'org-1'"
    );
    return Number(result.rows[0].count);
  }

  it("upload wires syncFileVersion for upload-origin versions", async () => {
    await seedTrackedParameter({
      ppvId: "ppv-1",
      pdId: "pd-1",
      name: "temp_max",
      sourceFileName: "config.json",
      sourceNodePath: "battery/temp_max",
      currentValue: "80"
    });
    const { objectStore } = makeObjectStore();

    const result = await uploadProjectParameterFile(db, objectStore, adminAuth(), {
      projectId: "project-1",
      fileName: "config.json",
      bytes: Buffer.from('{"battery":{"temp_max":85}}', "utf8")
    });

    // The real sync ran against the freshly frozen version: it left a file_sync
    // draft that points at exactly this version id.
    const drafts = await fileSyncDrafts("ppv-1");
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      target_value: "85",
      origin: "file_sync",
      origin_file_version_id: result.version.id
    });
    expect(drafts[0].reason).toContain("Synced from config.json:battery/temp_max");
  });

  it("upload new json file creates file + v1 with parsed_index", async () => {
    const { objectStore, putCalls, entries } = makeObjectStore();
    const bytes = Buffer.from('{"battery":{"temp_max":85}}', "utf8");

    const result = await uploadProjectParameterFile(db, objectStore, adminAuth(), {
      projectId: "project-1",
      fileName: "config.json",
      bytes
    });

    expect(putCalls).toEqual([
      {
        organizationId: "org-1",
        fileName: "config.json",
        contentType: "application/json",
        bytes
      }
    ]);
    expect(result.file.currentVersionNumber).toBe(1);
    expect(result.version.versionNumber).toBe(1);
    expect(result.version.parsedIndex).toEqual({ "battery/temp_max": { value: "85" } });
    expect(entries.get(result.version.storageKey)?.toString("utf8")).toBe('{"battery":{"temp_max":85}}');

    const stored = await db.query<{ file_name: string; parsed_index: Record<string, unknown>; origin: string }>(
      `select f.file_name, v.parsed_index, v.origin
       from project_parameter_file_versions v
       join project_parameter_files f on f.id = v.file_id
       where v.id = $1`,
      [result.version.id]
    );
    expect(stored.rows[0]).toEqual({
      file_name: "config.json",
      parsed_index: { "battery/temp_max": { value: "85" } },
      origin: "upload"
    });

    const audits = await db.query<{ action: string; target_id: string }>(
      "select action, target_id from audit_events where organization_id = 'org-1' and kind = 'parameter-file-upload'"
    );
    expect(audits.rows).toEqual([{ action: "upload", target_id: result.file.id }]);
  });

  it("upload second version increments version_number", async () => {
    const { objectStore } = makeObjectStore();
    await uploadProjectParameterFile(db, objectStore, adminAuth(), {
      projectId: "project-1",
      fileName: "config.json",
      bytes: Buffer.from('{"battery":{"temp_max":85}}', "utf8")
    });

    const result = await uploadProjectParameterFile(db, objectStore, adminAuth(), {
      projectId: "project-1",
      fileName: "config.json",
      bytes: Buffer.from('{"battery":{"temp_max":90}}', "utf8")
    });

    expect(result.version.versionNumber).toBe(2);
    expect(result.file.currentVersionNumber).toBe(2);
    expect(result.file.currentVersionId).toBe(result.version.id);
    // The second upload reuses the existing file row instead of creating a sibling.
    expect(await fileRowCount()).toBe(1);
  });

  it("rejects >2MB", async () => {
    const { objectStore, putCalls } = makeObjectStore();

    await expect(
      uploadProjectParameterFile(db, objectStore, adminAuth(), {
        projectId: "project-1",
        fileName: "config.json",
        bytes: Buffer.alloc(MAX_FILE_BYTES + 1, 1)
      })
    ).rejects.toMatchObject(new ApiError("VALIDATION_FAILED", "Project parameter file exceeds the 2MB limit."));
    expect(putCalls).toHaveLength(0);
    expect(await fileRowCount()).toBe(0);
  });

  it("rejects unknown extension", async () => {
    const { objectStore, putCalls } = makeObjectStore();

    await expect(
      uploadProjectParameterFile(db, objectStore, adminAuth(), {
        projectId: "project-1",
        fileName: "config.txt",
        bytes: Buffer.from("x", "utf8")
      })
    ).rejects.toMatchObject(new ApiError("VALIDATION_FAILED", "Unsupported parameter file extension."));
    expect(putCalls).toHaveLength(0);
    expect(await fileRowCount()).toBe(0);
  });

  it("allows DTS with /include/ (config-set resolver owns include diagnostics)", async () => {
    await seedTrackedParameter({
      ppvId: "ppv-include",
      pdId: "pd-include",
      name: "board_id",
      sourceFileName: "board.dts",
      sourceNodePath: "board_id",
      currentValue: "<1>"
    });
    const { objectStore, putCalls } = makeObjectStore();
    const bytes = Buffer.from('/include/ "pin.dtsi"\n/ { board_id = <0>; };\n', "utf8");

    const result = await uploadProjectParameterFile(db, objectStore, adminAuth(), {
      projectId: "project-1",
      fileName: "board.dts",
      bytes
    });

    expect(result.file.currentVersionNumber).toBe(1);
    expect(putCalls).toHaveLength(1);
    expect(await fileRowCount()).toBe(1);
    // Sync still ran for the include-bearing upload: the tracked parameter got a draft.
    const drafts = await fileSyncDrafts("ppv-include");
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ origin: "file_sync", origin_file_version_id: result.version.id });
  });

  it("uploads DTS with @address/&label overlays and syncs (supported by structural parse)", async () => {
    await seedTrackedParameter({
      ppvId: "ppv-overlay",
      pdId: "pd-overlay",
      name: "reg",
      sourceFileName: "overlay.dts",
      sourceNodePath: "demo/chip@6E/reg",
      currentValue: "<1>"
    });
    const { objectStore, putCalls } = makeObjectStore();
    const bytes = Buffer.from("&demo {\n\tchip@6E {\n\t\treg = <0x6e>;\n\t};\n};\n", "utf8");

    const result = await uploadProjectParameterFile(db, objectStore, adminAuth(), {
      projectId: "project-1",
      fileName: "overlay.dts",
      bytes
    });

    expect(putCalls).toHaveLength(1);
    expect(result.file.currentVersionNumber).toBe(1);
    // Structural parse handled the &label/@address overlay: node rows exist for the version.
    const nodePaths = await db.query<{ node_path: string }>(
      "select node_path from dts_nodes where file_version_id = $1 order by node_path",
      [result.version.id]
    );
    expect(nodePaths.rows.map((row) => row.node_path)).toContain("demo/chip@6E");
    // And the sync matched the overlay-scoped node path.
    const drafts = await fileSyncDrafts("ppv-overlay");
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ origin: "file_sync", origin_file_version_id: result.version.id });
  });

  it("uploads clean simple DTS and still syncs", async () => {
    await seedTrackedParameter({
      ppvId: "ppv-simple",
      pdId: "pd-simple",
      name: "board_id",
      sourceFileName: "simple.dts",
      sourceNodePath: "board_id",
      currentValue: "<1>"
    });
    const { objectStore } = makeObjectStore();
    const bytes = Buffer.from("/ {\n\tboard_id = <0>;\n};\n", "utf8");

    const result = await uploadProjectParameterFile(db, objectStore, adminAuth(), {
      projectId: "project-1",
      fileName: "simple.dts",
      bytes
    });

    // Structural ingest persisted the node model for the frozen version.
    expect(await structuralNodeCount(result.version.id)).toBeGreaterThan(0);
    // Sync produced the file_sync draft for the tracked parameter.
    const drafts = await fileSyncDrafts("ppv-simple");
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ origin: "file_sync", origin_file_version_id: result.version.id });
  });

  it("skips structural ingest when DTS_STRUCTURAL_INGEST is disabled", async () => {
    const prev = process.env.DTS_STRUCTURAL_INGEST;
    process.env.DTS_STRUCTURAL_INGEST = "0";
    try {
      const { objectStore } = makeObjectStore();

      const result = await uploadProjectParameterFile(db, objectStore, adminAuth(), {
        projectId: "project-1",
        fileName: "simple.dts",
        bytes: Buffer.from("/ {\n\tboard_id = <0>;\n};\n", "utf8")
      });

      // The upload itself succeeds, but no structural rows are written for the version.
      expect(result.version.versionNumber).toBe(1);
      expect(await structuralNodeCount(result.version.id)).toBe(0);
    } finally {
      if (prev === undefined) delete process.env.DTS_STRUCTURAL_INGEST;
      else process.env.DTS_STRUCTURAL_INGEST = prev;
    }
  });

  it("rollback inserts a new origin=rollback pointer version without rewinding history", async () => {
    const { objectStore, putCalls } = makeObjectStore();
    const first = await uploadProjectParameterFile(db, objectStore, adminAuth(), {
      projectId: "project-1",
      fileName: "config.json",
      bytes: Buffer.from('{"battery":{"temp_max":80}}', "utf8")
    });
    const second = await uploadProjectParameterFile(db, objectStore, adminAuth(), {
      projectId: "project-1",
      fileName: "config.json",
      bytes: Buffer.from('{"battery":{"temp_max":90}}', "utf8")
    });
    const putsBeforeRollback = putCalls.length;

    const restored = await rollbackProjectParameterFileVersion(
      db,
      objectStore,
      adminAuth(),
      {
        projectId: "project-1",
        fileId: first.file.id,
        versionId: first.version.id
      },
      { requestId: "req-rollback-1" }
    );

    expect(putCalls.length).toBe(putsBeforeRollback);
    expect(restored.version.origin).toBe("rollback");
    expect(restored.version.versionNumber).toBe(3);
    expect(restored.version.id).not.toBe(first.version.id);
    expect(restored.version.storageKey).toBe(first.version.storageKey);
    expect(restored.version.checksum).toBe(first.version.checksum);
    expect(restored.version.createdByUserId).toBe("user-1");
    expect(restored.version.createdByDisplayName).toBe("Riley Chen");
    expect(restored.file.currentVersionId).toBe(restored.version.id);
    expect(restored.file.currentVersionNumber).toBe(3);

    const listed = await db.query<{ id: string; origin: string; version_number: number }>(
      `select id, origin, version_number from project_parameter_file_versions where file_id = $1 order by version_number`,
      [first.file.id]
    );
    expect(listed.rows).toHaveLength(3);
    expect(listed.rows.map((row) => row.origin)).toEqual(["upload", "upload", "rollback"]);
    expect(listed.rows.some((row) => row.id === second.version.id)).toBe(true);

    const audit = await db.query<{ action: string; target_id: string }>(
      "select action, target_id from audit_events where organization_id = 'org-1' and kind = 'parameter-file-rollback'"
    );
    expect(audit.rows[0]).toEqual({ action: "rollback", target_id: first.file.id });
  });

  it("rollback refuses when the chosen version is already current", async () => {
    const { objectStore } = makeObjectStore();
    const uploaded = await uploadProjectParameterFile(db, objectStore, adminAuth(), {
      projectId: "project-1",
      fileName: "config.json",
      bytes: Buffer.from('{"battery":{"temp_max":80}}', "utf8")
    });

    await expect(
      rollbackProjectParameterFileVersion(db, objectStore, adminAuth(), {
        projectId: "project-1",
        fileId: uploaded.file.id,
        versionId: uploaded.version.id
      })
    ).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409
    });
  });
});
