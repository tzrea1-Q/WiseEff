import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/types";
import type { ObjectStore } from "../logs/objectStore";
import type { Database, QueryResult, Queryable } from "../../shared/database/client";
import { makeTestAuthContext } from "../../testing/authContext";
import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import { insertConfigSet, setFileConfigSetMembership } from "./configSetRepository";
import { createStubDtcValidator } from "./dtcValidator";
import {
  getFileVersionById,
  getProjectParameterFileById,
  insertFileVersion,
  insertProjectParameterFile,
  setCurrentVersion
} from "./repository";
import {
  compareBaseline,
  createBaseline,
  getBaseline,
  listBaselines,
  previewRestoreBaseline,
  releaseBaseline,
  rollbackToBaseline
} from "./baselineService";

// Release readiness stays a mocked service seam (it is not the database); the real
// readiness gate is exercised end-to-end in configSetBaseline.integration.test.ts.
vi.mock("./releaseReadinessService", () => ({
  assertReleaseGateAllows: vi.fn(async (_db, _auth, input: { configSetId: string }) => ({
    available: true,
    level: "ready",
    blockers: [],
    warnings: [],
    gateToken: "test-gate-token",
    evaluatedAt: "2026-08-07T00:00:00.000Z",
    configSetId: input.configSetId,
    projectId: "project-1",
    canCreateBaseline: true,
    canRelease: true
  })),
  evaluateReleaseReadiness: vi.fn()
}));

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

/** ObjectStore stub keyed by deliberate storage keys ("sk-1", ...) used by seeded versions. */
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

function passingValidator() {
  return createStubDtcValidator(() => ({
    ok: true,
    mode: "block",
    compiler: "dtc",
    diagnostics: []
  }));
}

describe.skipIf(!databaseAvailable)("baseline service", () => {
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

  /**
   * Creates a dts file whose versions carry deliberate storage keys, pins the newest
   * as current, and (unless configSetId is null) wires it into the config set.
   */
  async function seedMemberFile(input: {
    fileId: string;
    fileName: string;
    versions: Array<{ id: string; storageKey: string }>;
    role?: "base" | "overlay" | "charging" | "thermal" | "misc";
    sortOrder?: number;
    configSetId?: string | null;
  }) {
    await insertProjectParameterFile(db, {
      id: input.fileId,
      organizationId: "org-1",
      projectId: "project-1",
      fileName: input.fileName,
      format: "dts"
    });
    let lastVersionId: string | undefined;
    for (const version of input.versions) {
      const inserted = await insertFileVersion(db, {
        id: version.id,
        fileId: input.fileId,
        versionNumber: 1,
        storageKey: version.storageKey,
        checksum: `checksum-${version.id}`,
        sizeBytes: 100,
        parsedIndex: {},
        origin: "upload",
        createdByUserId: "user-1"
      });
      lastVersionId = inserted.id;
    }
    if (lastVersionId) {
      await setCurrentVersion(db, { fileId: input.fileId, versionId: lastVersionId });
    }
    if (input.configSetId !== null) {
      await setFileConfigSetMembership(db, {
        fileId: input.fileId,
        configSetId: input.configSetId ?? "dcs-1",
        role: input.role ?? "base",
        sortOrder: input.sortOrder ?? 0
      });
    }
  }

  async function baselineAudits(action: string) {
    const result = await db.query<{
      target_type: string | null;
      target_id: string | null;
      project_id: string | null;
      metadata: Record<string, unknown>;
    }>(
      `select target_type, target_id, project_id, metadata
       from audit_events
       where organization_id = $1 and kind = 'baseline' and action = $2`,
      ["org-1", action]
    );
    return result.rows;
  }

  async function fileVersionCount(fileId: string) {
    const result = await db.query<{ count: string }>(
      "select count(*)::text as count from project_parameter_file_versions where file_id = $1",
      [fileId]
    );
    return Number(result.rows[0].count);
  }

  describe("baseline service authorization", () => {
    it("createBaseline rejects non-admin auth with 403", async () => {
      await expect(
        createBaseline(db, viewerAuth(), { configSetId: "dcs-1", name: "release-1.0" })
      ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    });

    it("listBaselines rejects non-admin auth with 403", async () => {
      await expect(listBaselines(db, viewerAuth(), "dcs-1")).rejects.toMatchObject({
        code: "FORBIDDEN",
        status: 403
      });
    });

    it("getBaseline rejects non-admin auth with 403", async () => {
      await expect(getBaseline(db, viewerAuth(), "baseline-1")).rejects.toMatchObject({
        code: "FORBIDDEN",
        status: 403
      });
    });
  });

  describe("createBaseline", () => {
    it("pins every member's current version into the baseline and writes an audit event", async () => {
      await seedMemberFile({
        fileId: "file-1",
        fileName: "board-a.dts",
        versions: [
          { id: "fv-1-v1", storageKey: "sk-1-v1" },
          { id: "fv-1-v2", storageKey: "sk-1-v2" },
          { id: "fv-1", storageKey: "sk-1" }
        ],
        role: "base",
        sortOrder: 0
      });
      await seedMemberFile({
        fileId: "file-2",
        fileName: "board-a.overlay.dts",
        versions: [{ id: "fv-2", storageKey: "sk-2" }],
        role: "overlay",
        sortOrder: 1
      });

      const baseline = await createBaseline(db, adminAuth(), {
        configSetId: "dcs-1",
        name: "release-1.0"
      });

      expect(baseline.status).toBe("draft");
      expect(baseline.name).toBe("release-1.0");

      const detail = await getBaseline(db, adminAuth(), baseline.id);
      expect(detail.members).toEqual([
        { baselineId: baseline.id, fileId: "file-1", fileVersionId: "fv-1", versionNumber: 3 },
        { baselineId: baseline.id, fileId: "file-2", fileVersionId: "fv-2", versionNumber: 1 }
      ]);

      const audits = await baselineAudits("created");
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        target_type: "dts-release-baseline",
        target_id: baseline.id,
        project_id: "project-1"
      });
      expect(audits[0].metadata).toMatchObject({ configSetId: "dcs-1", name: "release-1.0", memberCount: 2 });
    });

    it("allows creating an empty baseline when the config set has no members", async () => {
      const baseline = await createBaseline(db, adminAuth(), {
        configSetId: "dcs-1",
        name: "release-1.0"
      });

      expect(baseline.status).toBe("draft");
      const detail = await getBaseline(db, adminAuth(), baseline.id);
      expect(detail.members).toEqual([]);
    });

    it("rejects with 409 conflict when a member file has no current version", async () => {
      await seedMemberFile({
        fileId: "file-1",
        fileName: "board-a.dts",
        versions: [],
        role: "base",
        sortOrder: 0
      });

      await expect(
        createBaseline(db, adminAuth(), { configSetId: "dcs-1", name: "release-1.0" })
      ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

      expect(await listBaselines(db, adminAuth(), "dcs-1")).toEqual([]);
    });

    it("rejects a duplicate baseline name for the same config set with 409 conflict", async () => {
      await createBaseline(db, adminAuth(), { configSetId: "dcs-1", name: "release-1.0" });

      await expect(
        createBaseline(db, adminAuth(), { configSetId: "dcs-1", name: "release-1.0" })
      ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

      expect(await listBaselines(db, adminAuth(), "dcs-1")).toHaveLength(1);
    });

    it("returns 404 when the config set does not exist", async () => {
      await expect(
        createBaseline(db, adminAuth(), { configSetId: "missing", name: "release-1.0" })
      ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    });
  });

  describe("getBaseline", () => {
    it("returns a baseline with its pinned members", async () => {
      await seedMemberFile({
        fileId: "file-1",
        fileName: "board-a.dts",
        versions: [
          { id: "fv-1-v1", storageKey: "sk-1-v1" },
          { id: "fv-1-v2", storageKey: "sk-1-v2" },
          { id: "fv-1", storageKey: "sk-1" }
        ]
      });
      const baseline = await createBaseline(db, adminAuth(), { configSetId: "dcs-1", name: "release-1.0" });

      const result = await getBaseline(db, adminAuth(), baseline.id);

      expect(result.baseline.id).toBe(baseline.id);
      expect(result.members).toHaveLength(1);
      expect(result.members[0].versionNumber).toBe(3);
    });

    it("returns 404 when the baseline does not exist", async () => {
      await expect(getBaseline(db, adminAuth(), "missing")).rejects.toMatchObject({
        code: "NOT_FOUND",
        status: 404
      });
    });
  });

  describe("listBaselines", () => {
    it("lists baselines scoped to the config set", async () => {
      await insertConfigSet(db, {
        id: "dcs-2",
        organizationId: "org-1",
        projectId: "project-1",
        name: "board-b"
      });
      await createBaseline(db, adminAuth(), { configSetId: "dcs-1", name: "release-1.0" });
      await createBaseline(db, adminAuth(), { configSetId: "dcs-1", name: "release-1.1" });
      await createBaseline(db, adminAuth(), { configSetId: "dcs-2", name: "release-x" });

      const baselines = await listBaselines(db, adminAuth(), "dcs-1");

      expect(baselines).toHaveLength(2);
      // created_at is frozen inside the rollback transaction, so assert membership, not order.
      expect(baselines.map((baseline) => baseline.name).sort()).toEqual(["release-1.0", "release-1.1"]);
      expect(baselines.every((baseline) => baseline.configSetId === "dcs-1")).toBe(true);
    });
  });

  describe("compareBaseline", () => {
    it("rejects non-admin auth with 403", async () => {
      await expect(compareBaseline(db, viewerAuth(), "baseline-1")).rejects.toMatchObject({
        code: "FORBIDDEN",
        status: 403
      });
    });

    it("returns 404 when the baseline does not exist", async () => {
      await expect(compareBaseline(db, adminAuth(), "missing")).rejects.toMatchObject({
        code: "NOT_FOUND",
        status: 404
      });
    });

    it("classifies members as unchanged, file_removed, and file_added", async () => {
      await seedMemberFile({
        fileId: "file-1",
        fileName: "board-a.dts",
        versions: [{ id: "fv-1", storageKey: "sk-1" }],
        role: "base",
        sortOrder: 0
      });
      await seedMemberFile({
        fileId: "file-2",
        fileName: "board-a.overlay.dts",
        versions: [{ id: "fv-2", storageKey: "sk-2" }],
        role: "overlay",
        sortOrder: 1
      });
      const baseline = await createBaseline(db, adminAuth(), { configSetId: "dcs-1", name: "release-1.0" });

      // After the snapshot: file-2 leaves the set, file-3 joins it.
      await db.query(
        `update project_parameter_files
         set config_set_id = null, config_set_role = null, config_set_sort_order = 0
         where id = 'file-2'`
      );
      await seedMemberFile({
        fileId: "file-3",
        fileName: "board-a.charging.dts",
        versions: [{ id: "fv-3", storageKey: "sk-3" }],
        role: "charging",
        sortOrder: 2
      });

      const result = await compareBaseline(db, adminAuth(), baseline.id);

      expect(result.baselineId).toBe(baseline.id);
      expect(result.members).toEqual([
        {
          fileId: "file-1",
          fileName: "board-a.dts",
          status: "unchanged",
          baselineVersionId: "fv-1",
          currentVersionId: "fv-1"
        },
        {
          fileId: "file-2",
          status: "file_removed",
          baselineVersionId: "fv-2"
        },
        {
          fileId: "file-3",
          fileName: "board-a.charging.dts",
          status: "file_added",
          currentVersionId: "fv-3"
        }
      ]);
    });

    it("does not attempt a structural diff when no objectStore is injected", async () => {
      await seedMemberFile({
        fileId: "file-1",
        fileName: "board-a.dts",
        versions: [{ id: "fv-1", storageKey: "sk-1" }]
      });
      const baseline = await createBaseline(db, adminAuth(), { configSetId: "dcs-1", name: "release-1.0" });
      await insertFileVersion(db, {
        id: "fv-2",
        fileId: "file-1",
        versionNumber: 2,
        storageKey: "sk-2",
        checksum: "checksum-fv-2",
        sizeBytes: 100,
        parsedIndex: {},
        origin: "upload",
        createdByUserId: "user-1"
      });
      await setCurrentVersion(db, { fileId: "file-1", versionId: "fv-2" });

      const result = await compareBaseline(db, adminAuth(), baseline.id);

      expect(result.members).toEqual([
        {
          fileId: "file-1",
          fileName: "board-a.dts",
          status: "version_changed",
          baselineVersionId: "fv-1",
          currentVersionId: "fv-2"
        }
      ]);
    });

    it("computes a structural diff for a changed dts member using normalizedValue", async () => {
      const objectStore = fakeObjectStore({
        "sk-1": "&demo_integer {\n\tsingle_value = <42>;\n};\n",
        "sk-2": "&demo_integer {\n\tsingle_value = <43>;\n};\n"
      });
      await seedMemberFile({
        fileId: "file-1",
        fileName: "board-a.dts",
        versions: [{ id: "fv-1", storageKey: "sk-1" }]
      });
      const baseline = await createBaseline(db, adminAuth(), { configSetId: "dcs-1", name: "release-1.0" });
      await insertFileVersion(db, {
        id: "fv-2",
        fileId: "file-1",
        versionNumber: 2,
        storageKey: "sk-2",
        checksum: "checksum-fv-2",
        sizeBytes: 100,
        parsedIndex: {},
        origin: "upload",
        createdByUserId: "user-1"
      });
      await setCurrentVersion(db, { fileId: "file-1", versionId: "fv-2" });

      const result = await compareBaseline(db, adminAuth(), baseline.id, { objectStore });

      expect(result.members).toEqual([
        {
          fileId: "file-1",
          fileName: "board-a.dts",
          status: "version_changed",
          baselineVersionId: "fv-1",
          currentVersionId: "fv-2",
          structuralDiff: [
            { kind: "prop_changed", nodePath: "demo_integer", prop: "single_value", before: "<42>", after: "<43>" }
          ]
        }
      ]);
    });

    it("reports an empty structural diff when normalized content is equivalent despite a version bump", async () => {
      const objectStore = fakeObjectStore({
        "sk-1": "&demo_byte_array {\n\treg_config = /bits/ 8 <0x4B>;\n};\n",
        "sk-2": "&demo_byte_array {\n\treg_config = /bits/ 8 <0x4b>;\n};\n"
      });
      await seedMemberFile({
        fileId: "file-1",
        fileName: "board-a.dts",
        versions: [{ id: "fv-1", storageKey: "sk-1" }]
      });
      const baseline = await createBaseline(db, adminAuth(), { configSetId: "dcs-1", name: "release-1.0" });
      await insertFileVersion(db, {
        id: "fv-2",
        fileId: "file-1",
        versionNumber: 2,
        storageKey: "sk-2",
        checksum: "checksum-fv-2",
        sizeBytes: 100,
        parsedIndex: {},
        origin: "upload",
        createdByUserId: "user-1"
      });
      await setCurrentVersion(db, { fileId: "file-1", versionId: "fv-2" });

      const result = await compareBaseline(db, adminAuth(), baseline.id, { objectStore });

      expect(result.members[0].status).toBe("version_changed");
      expect(result.members[0].structuralDiff).toEqual([]);
    });

    it("treats a rollback pointer that reuses the baseline blob storageKey as unchanged", async () => {
      await seedMemberFile({
        fileId: "file-1",
        fileName: "board-a.dts",
        versions: [{ id: "fv-1", storageKey: "sk-pinned" }]
      });
      const baseline = await createBaseline(db, adminAuth(), { configSetId: "dcs-1", name: "release-1.0" });
      await insertFileVersion(db, {
        id: "fv-3-rollback",
        fileId: "file-1",
        versionNumber: 3,
        storageKey: "sk-pinned",
        checksum: "checksum-fv-1",
        sizeBytes: 100,
        parsedIndex: {},
        origin: "rollback",
        createdByUserId: "user-1"
      });
      await setCurrentVersion(db, { fileId: "file-1", versionId: "fv-3-rollback" });

      const result = await compareBaseline(db, adminAuth(), baseline.id);

      expect(result.members).toEqual([
        {
          fileId: "file-1",
          fileName: "board-a.dts",
          status: "unchanged",
          baselineVersionId: "fv-1",
          currentVersionId: "fv-3-rollback"
        }
      ]);
    });
  });

  describe("rollbackToBaseline", () => {
    it("rejects non-admin auth with 403", async () => {
      await expect(rollbackToBaseline(db, viewerAuth(), "baseline-1")).rejects.toMatchObject({
        code: "FORBIDDEN",
        status: 403
      });
    });

    it("returns 404 when the baseline does not exist", async () => {
      await expect(rollbackToBaseline(db, adminAuth(), "missing")).rejects.toMatchObject({
        code: "NOT_FOUND",
        status: 404
      });
    });

    it("skips members already pinned to the baseline version and restores drifted members atomically", async () => {
      await seedMemberFile({
        fileId: "file-1",
        fileName: "board-a.dts",
        versions: [{ id: "fv-1", storageKey: "sk-1" }],
        role: "base",
        sortOrder: 0
      });
      await seedMemberFile({
        fileId: "file-2",
        fileName: "board-a.overlay.dts",
        versions: [{ id: "fv-2", storageKey: "sk-2" }],
        role: "overlay",
        sortOrder: 1
      });
      const baseline = await createBaseline(db, adminAuth(), { configSetId: "dcs-1", name: "release-1.0" });
      // file-2 drifts after the snapshot; file-1 stays pinned.
      await insertFileVersion(db, {
        id: "fv-2-new",
        fileId: "file-2",
        versionNumber: 2,
        storageKey: "sk-2-new",
        checksum: "checksum-fv-2-new",
        sizeBytes: 100,
        parsedIndex: {},
        origin: "upload",
        createdByUserId: "user-1"
      });
      await setCurrentVersion(db, { fileId: "file-2", versionId: "fv-2-new" });

      const result = await rollbackToBaseline(db, adminAuth(), baseline.id);

      expect(result).toEqual({ baselineId: baseline.id, restored: 1 });

      // file-1 was untouched: no pointer version was minted for it.
      expect(await fileVersionCount("file-1")).toBe(1);
      const fileOne = await getProjectParameterFileById(db, { organizationId: "org-1", fileId: "file-1" });
      expect(fileOne?.currentVersionId).toBe("fv-1");

      // file-2 got a fresh origin='rollback' pointer version reusing the pinned blob.
      expect(await fileVersionCount("file-2")).toBe(3);
      const fileTwo = await getProjectParameterFileById(db, { organizationId: "org-1", fileId: "file-2" });
      expect(fileTwo?.currentVersionNumber).toBe(3);
      const pointer = await getFileVersionById(db, { versionId: fileTwo?.currentVersionId ?? "" });
      expect(pointer).toMatchObject({
        fileId: "file-2",
        versionNumber: 3,
        storageKey: "sk-2",
        checksum: "checksum-fv-2",
        origin: "rollback",
        createdByUserId: "user-1"
      });

      const audits = await baselineAudits("rolled_back");
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({ target_id: baseline.id });
      expect(audits[0].metadata).toMatchObject({ configSetId: "dcs-1", restored: 1, memberCount: 2 });
    });

    it("fails the whole rollback atomically when a pinned file no longer exists", async () => {
      // Schema note: deleting a project_parameter_files row cascades its baseline
      // member rows away (migration 0046), so "member row exists, file row gone"
      // cannot be produced on a real database. This one test keeps a minimal local
      // fake db to exercise the defensive NOT_FOUND + atomic-abort path.
      type QueryCall = { text: string; values: unknown[] };
      const txCalls: QueryCall[] = [];
      const results: unknown[][] = [
        [
          {
            id: "baseline-1",
            organization_id: "org-1",
            config_set_id: "dcs-1",
            name: "release-1.0",
            notes: null,
            status: "draft",
            created_by_user_id: "user-1",
            created_at: "2026-07-14T09:00:00.000Z"
          }
        ],
        [
          {
            id: "dcs-1",
            organization_id: "org-1",
            project_id: "project-1",
            name: "board-a",
            description: null,
            derived_from_id: null,
            created_at: "2026-07-14T09:00:00.000Z",
            updated_at: "2026-07-14T09:00:00.000Z"
          }
        ],
        [
          { id: "bm-1", baseline_id: "baseline-1", file_id: "file-1", file_version_id: "fv-1", version_number: 3 },
          { id: "bm-2", baseline_id: "baseline-1", file_id: "file-2", file_version_id: "fv-2", version_number: 1 }
        ],
        [] // getProjectParameterFileById for file-1: the file row is gone entirely
      ];
      const runQuery = async <Row,>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> => {
        txCalls.push({ text, values });
        const rows = results.shift() ?? [];
        return { rows: rows as Row[], rowCount: rows.length };
      };
      const tx: Queryable = { query: (text, values = []) => runQuery(text, values) };
      const fakeDb: Database = {
        query: (text, values = []) => runQuery(text, values),
        transaction: async <T,>(fn: (queryable: Queryable) => Promise<T>) => fn(tx)
      };

      await expect(rollbackToBaseline(fakeDb, adminAuth(), "baseline-1")).rejects.toMatchObject({
        code: "NOT_FOUND",
        status: 404
      });

      expect(txCalls.find((call) => call.text.includes("insert into project_parameter_file_versions"))).toBeFalsy();
      expect(txCalls.find((call) => call.text.includes("insert into audit_events"))).toBeFalsy();
    });
  });

  describe("releaseBaseline", () => {
    it("rejects non-admin auth with 403", async () => {
      await expect(
        releaseBaseline(db, viewerAuth(), "baseline-1", { objectStore: fakeObjectStore({}) })
      ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    });

    it("returns 404 when the baseline does not exist", async () => {
      await expect(
        releaseBaseline(db, adminAuth(), "missing", { objectStore: fakeObjectStore({}) })
      ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    });

    it("blocks release when validation gate fails in block mode", async () => {
      const validator = createStubDtcValidator(() => ({
        ok: false,
        mode: "block",
        compiler: "dtc",
        diagnostics: [{ file: "board-a.dts", severity: "error", message: "syntax error" }]
      }));
      await seedMemberFile({
        fileId: "file-1",
        fileName: "board-a.dts",
        versions: [{ id: "fv-1", storageKey: "sk-1" }],
        role: "base",
        sortOrder: 0
      });
      const baseline = await createBaseline(db, adminAuth(), { configSetId: "dcs-1", name: "release-1.0" });

      await expect(
        releaseBaseline(
          db,
          adminAuth(),
          baseline.id,
          { objectStore: fakeObjectStore({ "sk-1": "/dts-v1/; / { };" }), validator },
          { requestId: "req-1" },
          { gateToken: "test-gate-token" }
        )
      ).rejects.toMatchObject({
        code: "CONFLICT",
        status: 409,
        details: { code: "dts-validation-failed" }
      });

      // The baseline stays draft and no released audit was written.
      const detail = await getBaseline(db, adminAuth(), baseline.id);
      expect(detail.baseline.status).toBe("draft");
      expect(await baselineAudits("released")).toHaveLength(0);

      const gateAudits = await db.query<{ metadata: Record<string, unknown> }>(
        "select metadata from audit_events where organization_id = 'org-1' and kind = 'validation.gate'"
      );
      expect(gateAudits.rows).toHaveLength(1);
      expect(gateAudits.rows[0].metadata).toMatchObject({ ok: false, mode: "block" });
    });

    it("releases a draft baseline when validation passes and writes released audit", async () => {
      await seedMemberFile({
        fileId: "file-1",
        fileName: "board-a.dts",
        versions: [{ id: "fv-1", storageKey: "sk-1" }],
        role: "base",
        sortOrder: 0
      });
      const baseline = await createBaseline(db, adminAuth(), { configSetId: "dcs-1", name: "release-1.0" });

      const result = await releaseBaseline(
        db,
        adminAuth(),
        baseline.id,
        { objectStore: fakeObjectStore({ "sk-1": "/dts-v1/; / { };" }), validator: passingValidator() },
        { requestId: "req-1" },
        { gateToken: "test-gate-token" }
      );

      expect(result.baseline.status).toBe("released");
      expect(result.gate.ok).toBe(true);
      expect(result.gate.requiresConfirmation).toBe(false);

      const reloaded = await getBaseline(db, adminAuth(), baseline.id);
      expect(reloaded.baseline.status).toBe("released");

      const audits = await baselineAudits("released");
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({ target_id: baseline.id });
      expect(audits[0].metadata).toMatchObject({ configSetId: "dcs-1", validationOk: true });
    });

    it("demotes the previous released tip to historical when releasing a new tip", async () => {
      await seedMemberFile({
        fileId: "file-1",
        fileName: "board-a.dts",
        versions: [{ id: "fv-1", storageKey: "sk-1" }],
        role: "base",
        sortOrder: 0
      });
      const deps = {
        objectStore: fakeObjectStore({ "sk-1": "/dts-v1/; / { };" }),
        validator: passingValidator()
      };
      const first = await createBaseline(db, adminAuth(), { configSetId: "dcs-1", name: "release-1.0" });
      await releaseBaseline(db, adminAuth(), first.id, deps, { requestId: "req-1" }, { gateToken: "test-gate-token" });
      const second = await createBaseline(db, adminAuth(), { configSetId: "dcs-1", name: "next" });

      const result = await releaseBaseline(
        db,
        adminAuth(),
        second.id,
        deps,
        { requestId: "req-2" },
        { gateToken: "test-gate-token" }
      );

      expect(result.baseline.status).toBe("released");

      const baselines = await listBaselines(db, adminAuth(), "dcs-1");
      const statusByName = new Map(baselines.map((baseline) => [baseline.name, baseline.status]));
      expect(statusByName.get("release-1.0")).toBe("historical");
      expect(statusByName.get("next")).toBe("released");
    });
  });

  describe("previewRestoreBaseline", () => {
    it("returns drifted member blast radius without mutating files or released tip", async () => {
      await seedMemberFile({
        fileId: "file-1",
        fileName: "board-a.dts",
        versions: [{ id: "fv-1", storageKey: "sk-1" }],
        role: "base",
        sortOrder: 0
      });
      await seedMemberFile({
        fileId: "file-2",
        fileName: "board-a.overlay.dts",
        versions: [{ id: "fv-2", storageKey: "sk-2" }],
        role: "overlay",
        sortOrder: 1
      });
      const baseline = await createBaseline(db, adminAuth(), { configSetId: "dcs-1", name: "release-1.0" });
      await releaseBaseline(
        db,
        adminAuth(),
        baseline.id,
        {
          objectStore: fakeObjectStore({ "sk-1": "/dts-v1/; / { };", "sk-2": "/dts-v1/; / { };" }),
          validator: passingValidator()
        },
        { requestId: "req-1" },
        { gateToken: "test-gate-token" }
      );
      // file-2 drifts after release.
      await insertFileVersion(db, {
        id: "fv-2-new",
        fileId: "file-2",
        versionNumber: 2,
        storageKey: "sk-2-new",
        checksum: "checksum-fv-2-new",
        sizeBytes: 100,
        parsedIndex: {},
        origin: "upload",
        createdByUserId: "user-1"
      });
      await setCurrentVersion(db, { fileId: "file-2", versionId: "fv-2-new" });

      const result = await previewRestoreBaseline(db, adminAuth(), baseline.id);

      expect(result.releasedBaselineUnchanged).toBe(true);
      expect(result.releasedBaselineId).toBe(baseline.id);
      expect(result.driftedCount).toBe(1);
      expect(result.members).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            fileId: "file-1",
            action: "noop"
          }),
          expect.objectContaining({
            fileId: "file-2",
            action: "rollback-pointer",
            fromVersionId: "fv-2-new",
            toVersionId: "fv-2"
          })
        ])
      );

      // Preview mutated nothing: current pointers, version counts, and tip status are intact.
      const fileTwo = await getProjectParameterFileById(db, { organizationId: "org-1", fileId: "file-2" });
      expect(fileTwo?.currentVersionId).toBe("fv-2-new");
      expect(await fileVersionCount("file-2")).toBe(2);
      const reloaded = await getBaseline(db, adminAuth(), baseline.id);
      expect(reloaded.baseline.status).toBe("released");
    });
  });

  describe("compareBaseline against released", () => {
    it("compares a draft baseline to the current released tip members", async () => {
      await seedMemberFile({
        fileId: "file-1",
        fileName: "board-a.dts",
        versions: [{ id: "fv-1", storageKey: "sk-1" }],
        role: "base",
        sortOrder: 0
      });
      const released = await createBaseline(db, adminAuth(), { configSetId: "dcs-1", name: "release-1.0" });
      await releaseBaseline(
        db,
        adminAuth(),
        released.id,
        { objectStore: fakeObjectStore({ "sk-1": "/dts-v1/; / { };" }), validator: passingValidator() },
        { requestId: "req-1" },
        { gateToken: "test-gate-token" }
      );
      // The draft pins a newer version than the released tip.
      await insertFileVersion(db, {
        id: "fv-new",
        fileId: "file-1",
        versionNumber: 2,
        storageKey: "sk-new",
        checksum: "checksum-fv-new",
        sizeBytes: 100,
        parsedIndex: {},
        origin: "upload",
        createdByUserId: "user-1"
      });
      await setCurrentVersion(db, { fileId: "file-1", versionId: "fv-new" });
      const draft = await createBaseline(db, adminAuth(), { configSetId: "dcs-1", name: "release-1.1" });

      const result = await compareBaseline(db, adminAuth(), draft.id, {}, { against: "released" });

      expect(result.against).toBe("released");
      expect(result.againstBaselineId).toBe(released.id);
      expect(result.members[0]?.status).toBe("version_changed");
      expect(result.members[0]).toMatchObject({
        fileId: "file-1",
        baselineVersionId: "fv-new",
        currentVersionId: "fv-1"
      });
    });
  });
});
