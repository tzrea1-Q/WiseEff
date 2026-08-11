import { describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/types";
import type { ObjectStore, StoredObject } from "../logs/objectStore";
import type { Database, QueryResult, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import {
  RELOAD_ARTIFACT_RETENTION_DAYS,
  getReloadRun,
  getReloadRunArtifact,
  listReloadCandidates,
  listReloadRuns,
  startReloadRun
} from "./service";

vi.mock("../audit/repository", () => ({
  createAuditEvent: vi.fn(async () => undefined)
}));

type QueryCall = { text: string; values: unknown[] };
type QueuedResult = unknown[] | ((call: QueryCall) => unknown[]);

function createFakeDb(results: QueuedResult[] = []) {
  const calls: QueryCall[] = [];

  const runQuery = async <Row,>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> => {
    const call = { text, values };
    calls.push(call);
    const next = results.length > 0 ? results.shift()! : [];
    const rows = typeof next === "function" ? next(call) : next;
    return { rows: rows as Row[], rowCount: rows.length };
  };

  const db: Database = {
    query: (text, values = []) => runQuery(text, values),
    transaction: async <T,>(fn: (queryable: Queryable) => Promise<T>) =>
      fn({
        query: (text, values = []) => runQuery(text, values)
      })
  };

  return { calls, db };
}

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

function runRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    organization_id: "org-1",
    project_id: "project-1",
    config_revision_id: null,
    status: "verified",
    purpose: "ordinary",
    restores_source_run_id: null,
    failure_code: null,
    steps: [],
    diagnostics: [],
    tool_versions: { dtc: "1.7.0", fdtoverlay: "1.7.0" },
    overlay_source_storage_key: "overlay.dts",
    overlay_source_sha256: "src-sha",
    overlay_artifact_storage_key: "overlay.dtbo",
    overlay_artifact_sha256: "art-sha",
    overlay_artifact_bytes: 32,
    created_by_user_id: "user-1",
    created_at: "2026-08-10T00:00:00.000Z",
    completed_at: "2026-08-10T00:00:01.000Z",
    device_id: "bridge:lab-1",
    bridge_id: "bridge-1",
    bridge_machine_label: "Lab",
    target_ref: "device-1",
    protocol: "hdc",
    integrity_check: "sha256",
    reload_snapshot: {
      libraryBaselines: [],
      artifactDigest: { sha256: "art-sha", onDeviceDigest: "art-sha", integrityCheck: "sha256" },
      kernelSignal: null,
      behaviouralVerification: null
    },
    ...overrides
  };
}

function listSummaryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    project_id: "project-1",
    status: "failed",
    purpose: "ordinary",
    failure_code: "transfer-failed",
    device_id: "bridge:lab-1",
    created_at: "2026-08-10T12:00:00.000Z",
    completed_at: "2026-08-10T12:00:05.000Z",
    overlay_artifact_sha256: "art-sha",
    overlay_artifact_bytes: 32,
    integrity_check: "md5",
    target_count: "2",
    property_keys: ["watchdog_time", "charge_current"],
    ...overrides
  };
}

describe("dts-reload history authz", () => {
  it("lets debugging:view read a run detail without debugging:dts-reload", async () => {
    const { db } = createFakeDb([
      [runRow()],
      [
        {
          binding_id: "binding-1",
          node_path: "/node",
          property_key: "watchdog_time",
          baseline_value: "<6000>",
          debug_value: "<7000>",
          sort_order: 0
        }
      ]
    ]);
    const { objectStore } = makeObjectStore(Buffer.from("/dts-v1/;"));

    const item = await getReloadRun(db, objectStore, auth(), "run-1");
    expect(item.id).toBe("run-1");
    expect(item.status).toBe("verified");
    expect(item.targets).toHaveLength(1);
  });

  it("refuses startReloadRun when the caller only has debugging:view", async () => {
    const { db } = createFakeDb();
    const { objectStore } = makeObjectStore();

    await expect(
      startReloadRun(db, objectStore, auth(), {
        projectId: "project-1",
        targets: [{ bindingId: "binding-1", debugValue: "<7000>" }]
      })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      details: { permission: "debugging:dts-reload" }
    });
  });
});

describe("listReloadRuns", () => {
  it("lists runs filtered by project, most recent first, including blocked and failed", async () => {
    const { calls, db } = createFakeDb([
      [
        listSummaryRow({ id: "run-new", status: "blocked", created_at: "2026-08-10T13:00:00.000Z" }),
        listSummaryRow({ id: "run-old", status: "failed", created_at: "2026-08-10T11:00:00.000Z" })
      ]
    ]);

    const result = await listReloadRuns(db, auth(), { projectId: "project-1", limit: 20 });
    expect(result.items.map((item) => item.id)).toEqual(["run-new", "run-old"]);
    expect(result.items[0]?.status).toBe("blocked");
    expect(result.items[1]?.status).toBe("failed");
    expect(result.nextCursor).toBeNull();

    const sql = calls[0]?.text ?? "";
    expect(sql).toMatch(/project_id/i);
    expect(sql).toMatch(/order by r\.created_at desc/i);
  });

  it("filters by deviceId and surfaces restore-baseline purpose", async () => {
    const { calls, db } = createFakeDb([
      [
        listSummaryRow({
          id: "run-restore",
          purpose: "restore-baseline",
          status: "verified",
          device_id: "bridge:lab-1"
        })
      ]
    ]);

    const result = await listReloadRuns(db, auth(), { deviceId: "bridge:lab-1" });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.purpose).toBe("restore-baseline");
    expect(calls[0]?.values).toContain("bridge:lab-1");
  });

  it("paginates with a cursor and does not return more than the limit", async () => {
    const page = Array.from({ length: 3 }, (_, index) =>
      listSummaryRow({
        id: `run-${index}`,
        created_at: `2026-08-10T1${index}:00:00.000Z`
      })
    );
    const { db } = createFakeDb([page]);

    const result = await listReloadRuns(db, auth(), { projectId: "project-1", limit: 2 });
    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).toEqual({
      createdAt: result.items[1]!.createdAt,
      id: result.items[1]!.id
    });
  });

  it("requires projectId or deviceId", async () => {
    const { db } = createFakeDb();
    await expect(listReloadRuns(db, auth(), {})).rejects.toBeInstanceOf(ApiError);
  });
});

describe("reload artifact retention", () => {
  it("returns GONE with reload-artifact-expired when the retention window has passed", async () => {
    const expiredCompletedAt = new Date(
      Date.now() - (RELOAD_ARTIFACT_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000
    ).toISOString();
    const { db } = createFakeDb([[runRow({ completed_at: expiredCompletedAt, created_at: expiredCompletedAt })]]);
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
    const { db } = createFakeDb([
      [runRow({ completed_at: expiredCompletedAt, created_at: expiredCompletedAt })],
      [
        {
          binding_id: "binding-1",
          node_path: "/node",
          property_key: "watchdog_time",
          baseline_value: "<6000>",
          debug_value: "<7000>",
          sort_order: 0
        }
      ]
    ]);
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
});

describe("last reload projection on candidates", () => {
  it("enriches candidates with each parameter's last reload value, when, and outcome", async () => {
    const { db } = createFakeDb([
      [
        {
          binding_id: "binding-1",
          project_id: "project-1",
          property_key: "watchdog_time",
          display_name: "Watchdog",
          module_id: "mod-charger",
          module_name: "charger",
          node_path: "/node",
          compatible: "sc8562",
          config_revision_id: "rev-1",
          baseline_value: "<6000>",
          value_shape: { kind: "cells", bits: 32, cellsPerGroup: 1, groups: 1 },
          unit: "ms",
          constraints: { min: 0, max: 20000, cells: 1 }
        }
      ],
      [], // sensitive rules
      [
        {
          binding_id: "binding-1",
          run_id: "run-9",
          debug_value: "<7000>",
          status: "contradicted",
          purpose: "ordinary",
          attempted_at: "2026-08-09T10:00:00.000Z"
        }
      ]
    ]);

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
