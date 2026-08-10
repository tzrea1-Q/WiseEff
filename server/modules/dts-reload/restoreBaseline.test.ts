import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/types";
import type { ObjectStore, StoredObject } from "../logs/objectStore";
import type { Database, QueryResult, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";

vi.mock("../audit/repository", () => ({
  createAuditEvent: vi.fn(async () => undefined)
}));

vi.mock("./preflight", () => ({
  runDebugOverlayPreflight: vi.fn(async () => ({
    ok: true,
    steps: [
      { step: "compile-base", outcome: "passed" },
      { step: "compile-overlay", outcome: "passed" },
      { step: "dry-run-merge", outcome: "passed" },
      { step: "assert-effect", outcome: "passed" }
    ],
    diagnostics: [],
    toolVersions: { dtc: "1.7.0", fdtoverlay: "1.7.0" },
    overlayBlob: Buffer.from("dtbo")
  }))
}));

vi.mock("./baseSource", () => ({
  buildReloadBaseSource: vi.fn(async () => "/dts-v1/;\n/ {\n};\n")
}));

vi.mock("./sensitiveGate", () => ({
  assertSensitiveReloadBatchAllowed: vi.fn(async () => []),
  matchReloadCandidatesSensitive: vi.fn(async () => [])
}));

import { createAuditEvent } from "../audit/repository";
import { getReloadResidue, startRestoreBaselineRun } from "./service";

type QueryCall = { text: string; values: unknown[] };

function auth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    user: {
      id: "user-1",
      organizationId: "org-1",
      name: "Riley",
      email: "r@example.com",
      title: "HW",
      isActive: true
    },
    organization: { id: "org-1", name: "Org" },
    roles: [{ projectId: "project-1", roleId: "hardware-committer" }],
    permissions: ["debugging:dts-reload"],
    ...overrides
  };
}

function candidateRow() {
  return {
    binding_id: "binding-1",
    project_id: "project-1",
    property_key: "watchdog_time",
    display_name: "Watchdog",
    module_name: "charger",
    node_path: "/amba/i2c@1/dev@6E",
    compatible: "sc8562",
    config_revision_id: "rev-1",
    baseline_value: "<6000>",
    value_shape: { kind: "cells", bits: 32, cellsPerGroup: 1, groups: 1 },
    unit: "ms",
    constraints: { min: 0, max: 20000, cells: 1 }
  };
}

function createRestoreDb(options: { residue: Record<string, unknown> | null }) {
  const calls: QueryCall[] = [];
  const inserts: Array<{ purpose: unknown; status: unknown }> = [];

  const runQuery = async <Row,>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> => {
    calls.push({ text, values });
    const normalized = text.replace(/\s+/g, " ").toLowerCase();

    if (normalized.includes("from dts_reload_device_residue")) {
      return {
        rows: (options.residue ? [options.residue] : []) as Row[],
        rowCount: options.residue ? 1 : 0
      };
    }

    if (normalized.includes("from project_parameter_bindings") || normalized.includes("as binding_id")) {
      return { rows: [candidateRow()] as Row[], rowCount: 1 };
    }

    if (normalized.includes("md5(string_agg") || normalized.includes("from parameter_drafts") || normalized.includes("from dts_release_baseline") || normalized.includes("from project_parameter_files")) {
      return {
        rows: [{ count: "0", checksum: "", tip: "" }] as Row[],
        rowCount: 1
      };
    }

    if (normalized.includes("from dts_config_set")) {
      return { rows: [{ id: "config-set-1" }] as Row[], rowCount: 1 };
    }

    if (normalized.includes("from project_parameter_files ppf")) {
      return {
        rows: [
          {
            file_name: "board.dts",
            role: "board",
            sort_order: 0,
            storage_key: "key-board",
            format: "dts"
          }
        ] as Row[],
        rowCount: 1
      };
    }

    if (normalized.includes("insert into dts_reload_runs")) {
      inserts.push({ purpose: values[5], status: values[4] });
      return {
        rows: [
          {
            id: values[0],
            organization_id: values[1],
            project_id: values[2],
            config_revision_id: values[3],
            status: values[4],
            purpose: values[5],
            failure_code: values[6],
            steps: JSON.parse(String(values[7])),
            diagnostics: JSON.parse(String(values[8])),
            tool_versions: JSON.parse(String(values[9])),
            overlay_source_storage_key: values[10],
            overlay_source_sha256: values[11],
            overlay_artifact_storage_key: values[12],
            overlay_artifact_sha256: values[13],
            overlay_artifact_bytes: values[14],
            created_by_user_id: values[15],
            created_at: "2026-08-10T00:00:00.000Z",
            completed_at: values[16],
            device_id: values[17] ?? null,
            restores_source_run_id: values[18] ?? null
          }
        ] as Row[],
        rowCount: 1
      };
    }

    if (normalized.includes("insert into dts_reload_run_targets")) {
      return { rows: [] as Row[], rowCount: 1 };
    }

    if (normalized.includes("from dts_reload_run_targets")) {
      return {
        rows: [
          {
            binding_id: "binding-1",
            node_path: "/amba/i2c@1/dev@6E",
            property_key: "watchdog_time",
            baseline_value: "<6000>",
            debug_value: "<6000>",
            sort_order: 0
          }
        ] as Row[],
        rowCount: 1
      };
    }

    return { rows: [] as Row[], rowCount: 0 };
  };

  const db: Database = {
    query: (text, values = []) => runQuery(text, values),
    transaction: async <T,>(fn: (queryable: Queryable) => Promise<T>) =>
      fn({ query: (text, values = []) => runQuery(text, values) })
  };

  return { db, calls, inserts };
}

function objectStore(): ObjectStore {
  return {
    put: vi.fn(async (input) => {
      const stored: StoredObject = {
        storageKey: `store/${input.fileName}`,
        checksumSha256: "sha",
        fileSizeBytes: input.bytes.length,
        contentType: input.contentType,
        organizationId: input.organizationId
      };
      return stored;
    }),
    get: vi.fn(async () => Buffer.from("dtbo")),
    delete: vi.fn(async () => undefined)
  };
}

describe("startRestoreBaselineRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuses when no residue is recorded for the device", async () => {
    const { db } = createRestoreDb({ residue: null });
    await expect(
      startRestoreBaselineRun(db, objectStore(), auth(), {
        projectId: "project-1",
        deviceId: "bridge:lab-1"
      })
    ).rejects.toMatchObject({
      details: { code: "reload-residue-missing" }
    });
  });

  it("starts a restore-purpose run with library baseline debug values and distinct audit", async () => {
    const { db, inserts } = createRestoreDb({
      residue: {
        organization_id: "org-1",
        device_id: "bridge:lab-1",
        project_id: "project-1",
        source_run_id: "run-residue",
        parameters: [
          {
            bindingId: "binding-1",
            propertyKey: "watchdog_time",
            nodePath: "/amba/i2c@1/dev@6E",
            baselineValue: "<6000>",
            debugValue: "<7000>"
          }
        ],
        recorded_at: "2026-08-10T00:00:00.000Z"
      }
    });

    const result = await startRestoreBaselineRun(db, objectStore(), auth(), {
      projectId: "project-1",
      deviceId: "bridge:lab-1"
    });

    expect(result.purpose).toBe("restore-baseline");
    expect(result.status).toBe("validated");
    expect(result.deviceId).toBe("bridge:lab-1");
    expect(result.restoresSourceRunId).toBe("run-residue");
    expect(result.targets[0]?.debugValue).toBe("<6000>");
    expect(inserts.some((row) => row.purpose === "restore-baseline")).toBe(true);

    const auditKinds = vi.mocked(createAuditEvent).mock.calls.map((call) => call[1].kind);
    expect(auditKinds).toContain("dts-reload-restore-started");
    expect(auditKinds).toContain("dts-reload-restore-validated");
    expect(auditKinds).not.toContain("dts-reload-run-start");
  });

  it("rejects residue from another project", async () => {
    const { db } = createRestoreDb({
      residue: {
        organization_id: "org-1",
        device_id: "bridge:lab-1",
        project_id: "other-project",
        source_run_id: "run-residue",
        parameters: [
          {
            bindingId: "binding-1",
            propertyKey: "watchdog_time",
            nodePath: "/amba/i2c@1/dev@6E",
            baselineValue: "<6000>",
            debugValue: "<7000>"
          }
        ],
        recorded_at: "2026-08-10T00:00:00.000Z"
      }
    });

    await expect(
      startRestoreBaselineRun(db, objectStore(), auth(), {
        projectId: "project-1",
        deviceId: "bridge:lab-1"
      })
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("refuses callers lacking debugging:dts-reload", async () => {
    const { db } = createRestoreDb({ residue: null });
    await expect(
      startRestoreBaselineRun(
        db,
        objectStore(),
        auth({ permissions: [] }),
        { projectId: "project-1", deviceId: "bridge:lab-1" }
      )
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      details: { permission: "debugging:dts-reload" }
    });
  });
});

describe("getReloadResidue authz", () => {
  it("refuses callers lacking debugging:view (and debugging:dts-reload)", async () => {
    const { db } = createRestoreDb({ residue: null });
    await expect(
      getReloadResidue(db, auth({ permissions: [] }), "bridge:lab-1")
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      details: { permission: "debugging:view" }
    });
  });

  it("allows callers with only debugging:view", async () => {
    const { db } = createRestoreDb({ residue: null });
    await expect(
      getReloadResidue(db, auth({ permissions: ["debugging:view"] }), "bridge:lab-1")
    ).resolves.toBeNull();
  });
});
