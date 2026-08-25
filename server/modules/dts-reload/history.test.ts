import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/types";
import { createUserInvocation } from "../auth/trustedInvocation";
import type { ObjectStore, StoredObject } from "../logs/objectStore";
import { ApiError } from "../../shared/http/errors";
import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import { insertReloadRun, insertReloadRunTarget } from "./repository";
import {
  RELOAD_ARTIFACT_RETENTION_DAYS,
  getReloadRun,
  getReloadRunArtifact,
  listReloadCandidates,
  listReloadRuns,
  reclaimStaleDeployingReloadRuns,
  startReloadRun,
  sweepExpiredReloadArtifacts
} from "./service";
import type { ReloadRunPurpose, ReloadRunStatus } from "./types";

vi.mock("../audit/repository", () => ({
  createAuditEvent: vi.fn(async () => undefined)
}));

const databaseAvailable = await isTestDatabaseAvailable();

function auth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    user: {
      id: "user-1",
      organizationId: "org-1",
      name: "Viewer",
      email: "viewer@example.com",
      title: "Hardware User",
      isActive: true
    },
    organization: { id: "org-1", name: "ChargeLab" },
    roles: [{ projectId: "project-1", roleId: "hardware-user" }],
    permissions: ["debugging:view"],
    ...overrides
  };
}

function makeObjectStore(bytes = Buffer.from("dtbo")) {
  const get = vi.fn(async () => bytes);
  const put = vi.fn(async () => undefined);
  const objectStore: ObjectStore = {
    put: put as ObjectStore["put"],
    get: get as ObjectStore["get"],
    delete: vi.fn(async () => undefined),
    head: vi.fn(async (): Promise<StoredObject | null> => null)
  };
  return { objectStore, get, put };
}

describe.skipIf(!databaseAvailable)("dts-reload history", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedCoreGraph(db, {
      organization: { id: "org-1", name: "ChargeLab" },
      users: [{ id: "user-1", name: "Viewer", email: "viewer@example.com" }],
      projects: [{ id: "project-1" }, { id: "project-2" }]
    });
  });

  afterEach(async () => {
    await db?.rollback();
  });

  /**
   * Seed the parameter-library graph behind one reload candidate binding
   * (module → spec → spec version → dts property spec → logical node → binding → revision).
   */
  async function seedCandidate(input: {
    bindingId: string;
    projectId?: string;
    propertyKey?: string;
    displayName?: string;
    nodePath?: string | null;
    compatible?: string | null;
    configRevisionId?: string;
    baselineValue?: string | null;
    description?: string | null;
    valueShape?: Record<string, unknown>;
    unit?: string | null;
    constraints?: Record<string, unknown>;
  }) {
    const projectId = input.projectId ?? "project-1";
    const propertyKey = input.propertyKey ?? "watchdog_time";
    const nodePath = input.nodePath === undefined ? "/node" : input.nodePath;
    const configRevisionId = input.configRevisionId ?? "rev-1";

    await db.query(
      `insert into parameter_modules (id, organization_id, name, path)
       values ('mod-charger', 'org-1', 'charger', '/charger')
       on conflict (id) do nothing`
    );
    await db.query(
      `insert into dts_config_set (id, organization_id, project_id, name)
       values ('cs-1', 'org-1', $1, 'primary') on conflict (id) do nothing`,
      [projectId]
    );
    await db.query(
      `insert into dts_config_revisions (id, organization_id, project_id, config_set_id, revision_number, status)
       select $1, 'org-1', $2, 'cs-1',
              coalesce((select max(revision_number) from dts_config_revisions where config_set_id = 'cs-1'), 0) + 1,
              'compiled'
       where not exists (select 1 from dts_config_revisions where id = $1)`,
      [configRevisionId, projectId]
    );
    await db.query(
      `insert into parameter_specs (id, organization_id, source_kind, specification_key)
       values ($1, 'org-1', 'dts', $2)`,
      [`spec-${input.bindingId}`, `reload/${input.bindingId}/${propertyKey}`]
    );
    await db.query(
      `insert into parameter_spec_versions (
         id, parameter_spec_id, version, display_name, description, documentation, value_shape, units, lifecycle
       ) values ($1, $2, 1, $3, '', $4, $5::jsonb, $6, 'active')`,
      [
        `psv-${input.bindingId}`,
        `spec-${input.bindingId}`,
        input.displayName ?? "Watchdog",
        input.description === undefined ? "Watchdog timeout for charger safety." : input.description,
        JSON.stringify(input.valueShape ?? { kind: "cells", bits: 32, cellsPerGroup: 1, groups: 1 }),
        input.unit === undefined ? "ms" : input.unit
      ]
    );
    await db.query(
      `insert into dts_property_specs (id, parameter_spec_id, property_key, schema_namespace, constraints)
       values ($1, $2, $3, 'reload-test', $4::jsonb)`,
      [
        `dps-${input.bindingId}`,
        `spec-${input.bindingId}`,
        propertyKey,
        JSON.stringify(input.constraints ?? { min: 0, max: 20000, cells: 1 })
      ]
    );
    if (nodePath !== null) {
      await db.query(
        `insert into dts_logical_nodes (id, organization_id, project_id, config_set_id)
         values ($1, 'org-1', $2, 'cs-1')`,
        [`node-${input.bindingId}`, projectId]
      );
      await db.query(
        `insert into dts_logical_node_revisions (id, logical_node_id, config_revision_id, node_locator, name, compatible)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          `lnr-${input.bindingId}`,
          `node-${input.bindingId}`,
          configRevisionId,
          nodePath,
          nodePath.split("/").filter(Boolean).at(-1) ?? "node",
          input.compatible === undefined ? "sc8562" : input.compatible
        ]
      );
    }
    await db.query(
      `insert into project_parameter_bindings (id, organization_id, project_id, logical_node_id, parameter_spec_id, module_id)
       values ($1, 'org-1', $2, $3, $4, 'mod-charger')`,
      [input.bindingId, projectId, nodePath === null ? null : `node-${input.bindingId}`, `spec-${input.bindingId}`]
    );
    await db.query(
      `insert into project_parameter_binding_revisions (
         id, binding_id, config_revision_id, parameter_spec_version_id, typed_value, raw_value
       ) values ($1, $2, $3, $4, '{}'::jsonb, $5)`,
      [
        `bpr-${input.bindingId}`,
        input.bindingId,
        configRevisionId,
        `psv-${input.bindingId}`,
        input.baselineValue === undefined ? "<6000>" : input.baselineValue
      ]
    );
  }

  type SeedRunTarget = {
    bindingId: string;
    nodePath?: string;
    propertyKey?: string;
    baselineValue?: string | null;
    debugValue?: string;
  };

  async function seedRun(input: {
    id: string;
    projectId?: string;
    status?: ReloadRunStatus;
    purpose?: ReloadRunPurpose;
    deviceId?: string | null;
    failureCode?: string | null;
    withArtifact?: boolean;
    completedAt?: string | null;
    /** now() is frozen inside the test transaction; recency tests pin explicit created_at. */
    createdAt?: string;
    targets?: SeedRunTarget[];
  }) {
    await insertReloadRun(db, {
      id: input.id,
      organizationId: "org-1",
      projectId: input.projectId ?? "project-1",
      configRevisionId: null,
      status: input.status ?? "verified",
      purpose: input.purpose ?? "ordinary",
      deviceId: input.deviceId ?? null,
      restoresSourceRunId: null,
      failureCode: input.failureCode ?? null,
      steps: [],
      diagnostics: [],
      toolVersions: { dtc: "1.7.0", fdtoverlay: "1.7.0" },
      overlaySourceStorageKey: "overlay.dts",
      overlaySourceSha256: "src-sha",
      overlayArtifactStorageKey: input.withArtifact === false ? null : "overlay.dtbo",
      overlayArtifactSha256: input.withArtifact === false ? null : "art-sha",
      overlayArtifactBytes: input.withArtifact === false ? null : 32,
      createdByUserId: "user-1",
      completedAt: input.completedAt === undefined ? new Date().toISOString() : input.completedAt
    });
    for (const [index, target] of (input.targets ?? []).entries()) {
      await insertReloadRunTarget(db, {
        id: `target-${input.id}-${index}`,
        reloadRunId: input.id,
        bindingId: target.bindingId,
        nodePath: target.nodePath ?? "/node",
        propertyKey: target.propertyKey ?? "watchdog_time",
        baselineValue: target.baselineValue === undefined ? "<6000>" : target.baselineValue,
        debugValue: target.debugValue ?? "<7000>",
        sortOrder: index
      });
    }
    if (input.createdAt) {
      await db.query("update dts_reload_runs set created_at = $2 where id = $1", [input.id, input.createdAt]);
    }
  }

  describe("dts-reload history authz", () => {
    it("lets debugging:view read a run detail without debugging:dts-reload", async () => {
      await seedCandidate({ bindingId: "binding-1" });
      await seedRun({
        id: "run-1",
        status: "verified",
        targets: [{ bindingId: "binding-1" }]
      });
      const { objectStore } = makeObjectStore(Buffer.from("/dts-v1/;"));

      const item = await getReloadRun(db, objectStore, auth(), "run-1");
      expect(item.id).toBe("run-1");
      expect(item.status).toBe("verified");
      expect(item.targets).toHaveLength(1);
    });

    it("refuses startReloadRun when the caller only has debugging:view", async () => {
      const { objectStore } = makeObjectStore();

      await expect(
        startReloadRun(db, objectStore, auth(), {
          projectId: "project-1",
          targets: [{ bindingId: "binding-1", debugValue: "<7000>" }]
        }, {
          invocation: createUserInvocation(auth()),
          requestId: "req-history-authz",
          refusalDb: db
        })
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        details: { permission: "debugging:dts-reload" }
      });
    });
  });

  describe("listReloadRuns", () => {
    it("lists runs filtered by project, most recent first, including blocked and failed", async () => {
      await seedRun({
        id: "run-new",
        status: "blocked",
        withArtifact: false,
        createdAt: "2026-08-10T13:00:00.000Z"
      });
      await seedRun({
        id: "run-old",
        status: "failed",
        failureCode: "transfer-failed",
        createdAt: "2026-08-10T11:00:00.000Z"
      });
      await seedRun({
        id: "run-foreign-project",
        projectId: "project-2",
        status: "verified",
        createdAt: "2026-08-10T12:00:00.000Z"
      });

      const result = await listReloadRuns(db, auth(), { projectId: "project-1", limit: 20 });
      expect(result.items.map((item) => item.id)).toEqual(["run-new", "run-old"]);
      expect(result.items[0]?.status).toBe("blocked");
      expect(result.items[1]?.status).toBe("failed");
      expect(result.items[1]?.failureCode).toBe("transfer-failed");
      expect(result.nextCursor).toBeNull();
    });

    it("filters by deviceId and surfaces restore-baseline purpose", async () => {
      await seedRun({
        id: "run-restore",
        purpose: "restore-baseline",
        status: "verified",
        deviceId: "bridge:lab-1"
      });
      await seedRun({ id: "run-elsewhere", status: "verified", deviceId: null });

      const result = await listReloadRuns(db, auth(), { deviceId: "bridge:lab-1" });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.id).toBe("run-restore");
      expect(result.items[0]?.purpose).toBe("restore-baseline");
      expect(result.items[0]?.deviceId).toBe("bridge:lab-1");
    });

    it("paginates with a cursor and does not return more than the limit", async () => {
      for (let index = 0; index < 3; index += 1) {
        await seedRun({
          id: `run-${index}`,
          status: "failed",
          failureCode: "transfer-failed",
          createdAt: `2026-08-10T1${index}:00:00.000Z`
        });
      }

      const result = await listReloadRuns(db, auth(), { projectId: "project-1", limit: 2 });
      expect(result.items).toHaveLength(2);
      expect(result.items.map((item) => item.id)).toEqual(["run-2", "run-1"]);
      expect(result.nextCursor).toEqual({
        createdAt: result.items[1]!.createdAt,
        id: result.items[1]!.id
      });

      const nextPage = await listReloadRuns(db, auth(), {
        projectId: "project-1",
        limit: 2,
        cursor: result.nextCursor!
      });
      expect(nextPage.items.map((item) => item.id)).toEqual(["run-0"]);
      expect(nextPage.nextCursor).toBeNull();
    });

    it("requires projectId or deviceId", async () => {
      await expect(listReloadRuns(db, auth(), {})).rejects.toBeInstanceOf(ApiError);
    });
  });

  describe("reload artifact retention", () => {
    it("returns GONE with reload-artifact-expired when the retention window has passed", async () => {
      const expiredCompletedAt = new Date(
        Date.now() - (RELOAD_ARTIFACT_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000
      ).toISOString();
      await seedRun({ id: "run-1", completedAt: expiredCompletedAt });
      const { objectStore, get } = makeObjectStore();

      await expect(getReloadRunArtifact(db, objectStore, auth(), "run-1")).rejects.toMatchObject({
        code: "GONE",
        status: 410,
        details: { code: "reload-artifact-expired" }
      });
      expect(get).not.toHaveBeenCalled();
    });

    it("still returns run metadata and digests after retention without reading expired overlay bytes", async () => {
      const expiredCompletedAt = new Date(
        Date.now() - (RELOAD_ARTIFACT_RETENTION_DAYS + 5) * 24 * 60 * 60 * 1000
      ).toISOString();
      await seedCandidate({ bindingId: "binding-1" });
      await seedRun({
        id: "run-1",
        completedAt: expiredCompletedAt,
        targets: [{ bindingId: "binding-1" }]
      });
      const { objectStore, get } = makeObjectStore();

      const item = await getReloadRun(db, objectStore, auth(), "run-1");
      expect(item.artifact).toEqual({
        fileName: "debug-overlay-run-1.dtbo",
        sha256: "art-sha",
        sizeBytes: 32
      });
      expect(item.overlaySourceSha256).toBe("src-sha");
      expect(item.overlaySource).toBeNull();
      expect(item.artifactRetentionExpired).toBe(true);
      expect(get).not.toHaveBeenCalled();
    });

    it("still reports reload-artifact-expired (not a 409) after the blob was swept and the key nulled", async () => {
      const expiredAt = new Date(
        Date.now() - (RELOAD_ARTIFACT_RETENTION_DAYS + 3) * 24 * 60 * 60 * 1000
      ).toISOString();
      await seedRun({ id: "run-1", completedAt: expiredAt, createdAt: expiredAt });
      await db.query(
        "update dts_reload_runs set overlay_artifact_storage_key = null, overlay_source_storage_key = null where id = $1",
        ["run-1"]
      );
      const { objectStore, get } = makeObjectStore();

      await expect(getReloadRunArtifact(db, objectStore, auth(), "run-1")).rejects.toMatchObject({
        code: "GONE",
        status: 410,
        details: { code: "reload-artifact-expired" }
      });
      expect(get).not.toHaveBeenCalled();
    });
  });

  describe("sweepExpiredReloadArtifacts", () => {
    async function readStorageKeys(runId: string) {
      const result = await db.query<{
        overlay_artifact_storage_key: string | null;
        overlay_source_storage_key: string | null;
      }>(
        "select overlay_artifact_storage_key, overlay_source_storage_key from dts_reload_runs where id = $1",
        [runId]
      );
      return result.rows[0];
    }

    it("deletes expired blobs, nulls the storage keys, and reports counts", async () => {
      const expiredAt = new Date(
        Date.now() - (RELOAD_ARTIFACT_RETENTION_DAYS + 3) * 24 * 60 * 60 * 1000
      ).toISOString();
      await seedRun({ id: "run-1", completedAt: expiredAt, createdAt: expiredAt });
      await db.query(
        "update dts_reload_runs set overlay_artifact_storage_key = 'org-1/a.dtbo', overlay_source_storage_key = 'org-1/a.dts' where id = $1",
        ["run-1"]
      );
      await seedRun({ id: "run-2", completedAt: expiredAt, createdAt: expiredAt });
      await db.query(
        "update dts_reload_runs set overlay_artifact_storage_key = 'org-1/b.dtbo', overlay_source_storage_key = null where id = $1",
        ["run-2"]
      );
      // Fresh run stays untouched: its window has not passed.
      await seedRun({ id: "run-fresh" });

      const deletedKeys: string[] = [];
      const { objectStore } = makeObjectStore();
      const deletingStore: ObjectStore = {
        ...objectStore,
        delete: async (key: string) => {
          deletedKeys.push(key);
        }
      };

      const result = await sweepExpiredReloadArtifacts(db, deletingStore, { batchLimit: 50 });

      expect(result).toEqual({ scannedRuns: 2, reclaimedRuns: 2, deletedBlobs: 3 });
      expect(deletedKeys.sort()).toEqual(["org-1/a.dtbo", "org-1/a.dts", "org-1/b.dtbo"].sort());
      expect(await readStorageKeys("run-1")).toEqual({
        overlay_artifact_storage_key: null,
        overlay_source_storage_key: null
      });
      expect(await readStorageKeys("run-2")).toEqual({
        overlay_artifact_storage_key: null,
        overlay_source_storage_key: null
      });
      expect(await readStorageKeys("run-fresh")).toEqual({
        overlay_artifact_storage_key: "overlay.dtbo",
        overlay_source_storage_key: "overlay.dts"
      });
    });

    it("is a safe no-op when the object store cannot delete", async () => {
      const expiredAt = new Date(
        Date.now() - (RELOAD_ARTIFACT_RETENTION_DAYS + 3) * 24 * 60 * 60 * 1000
      ).toISOString();
      await seedRun({ id: "run-1", completedAt: expiredAt, createdAt: expiredAt });
      const { objectStore } = makeObjectStore();
      // A store without a delete capability must leave rows and blobs untouched.
      const readOnlyStore: ObjectStore = { put: objectStore.put, get: objectStore.get };

      const result = await sweepExpiredReloadArtifacts(db, readOnlyStore);

      expect(result).toEqual({ scannedRuns: 0, reclaimedRuns: 0, deletedBlobs: 0 });
      expect(await readStorageKeys("run-1")).toEqual({
        overlay_artifact_storage_key: "overlay.dtbo",
        overlay_source_storage_key: "overlay.dts"
      });
    });
  });

  describe("reclaimStaleDeployingReloadRuns", () => {
    it("resets stale deploying runs to failed via a time-gated, bounded update", async () => {
      const staleCreatedAt = new Date(Date.now() - 40 * 60 * 1000).toISOString();
      await seedRun({ id: "run-stale", status: "deploying", createdAt: staleCreatedAt, completedAt: null });
      await seedRun({ id: "run-fresh", status: "deploying", completedAt: null });

      const result = await reclaimStaleDeployingReloadRuns(db, {
        staleAfterMs: 30 * 60 * 1000,
        batchLimit: 100
      });

      expect(result).toEqual({ reclaimedRuns: 1, runIds: ["run-stale"] });
      const rows = await db.query<{ id: string; status: string; failure_code: string | null }>(
        "select id, status, failure_code from dts_reload_runs where id in ('run-stale', 'run-fresh') order by id"
      );
      expect(rows.rows).toEqual([
        { id: "run-fresh", status: "deploying", failure_code: null },
        { id: "run-stale", status: "failed", failure_code: "deploy-reclaimed" }
      ]);
    });

    it("reports zero when nothing is stale", async () => {
      await seedRun({ id: "run-fresh", status: "deploying", completedAt: null });

      const result = await reclaimStaleDeployingReloadRuns(db);

      expect(result).toEqual({ reclaimedRuns: 0, runIds: [] });
    });
  });

  describe("last reload projection on candidates", () => {
    it("enriches candidates with each parameter's last reload value, when, and outcome", async () => {
      await seedCandidate({ bindingId: "binding-1", description: null });
      await seedRun({
        id: "run-9",
        status: "contradicted",
        completedAt: "2026-08-09T10:00:00.000Z",
        targets: [{ bindingId: "binding-1", debugValue: "<7000>" }]
      });

      const result = await listReloadCandidates(db, auth(), "project-1");
      expect(result.items[0]?.lastReload).toEqual({
        runId: "run-9",
        debugValue: "<7000>",
        attemptedAt: "2026-08-09T10:00:00.000Z",
        outcome: "contradicted",
        purpose: "ordinary"
      });
    });
  });
});
