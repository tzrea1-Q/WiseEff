import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/types";
import type { ObjectStore, StoredObject } from "../logs/objectStore";
import type { Database, QueryResult, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";

vi.mock("../audit/repository", () => ({
  createAuditEvent: vi.fn(async () => undefined)
}));

import { createAuditEvent } from "../audit/repository";
import { getReloadRun, listReloadCandidates, startReloadRun } from "./service";

type QueryCall = { text: string; values: unknown[] };
type QueuedResult = unknown[] | ((call: QueryCall) => unknown[]);

function createFakeDb(results: QueuedResult[] = []) {
  const calls: QueryCall[] = [];

  const runQuery = async <Row,>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> => {
    const call = { text, values };
    calls.push(call);
    const next = results.length > 0 ? results.shift()! : fingerprintResponder();
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
      name: "Riley Chen",
      email: "riley@example.com",
      title: "Hardware Committer",
      isActive: true
    },
    organization: { id: "org-1", name: "ChargeLab" },
    roles: [{ projectId: "project-1", roleId: "hardware-committer" }],
    permissions: ["debugging:dts-reload"],
    ...overrides
  };
}

function candidateRow(overrides: Record<string, unknown> = {}) {
  return {
    binding_id: "binding-1",
    project_id: "project-1",
    property_key: "watchdog_time",
    display_name: "Watchdog",
    module_name: "charger",
    node_path: "/amba/i2c@FDF5E000/sc8562@6E",
    config_revision_id: "rev-1",
    baseline_value: "<6000>",
    value_shape: { kind: "cells", bits: 32, cellsPerGroup: 1, groups: 1 },
    unit: "ms",
    constraints: { min: 0, max: 20000, cells: 1 },
    ...overrides
  };
}

function fingerprintParts(): QueuedResult[] {
  const revisions: QueuedResult = (call) =>
    call.text.includes("project_parameter_binding_revisions") ? [{ count: "3", checksum: "abc" }] : [];
  const drafts: QueuedResult = (call) => (call.text.includes("parameter_drafts") ? [{ count: "0" }] : []);
  const baselines: QueuedResult = (call) =>
    call.text.includes("dts_release_baseline") ? [{ count: "1" }] : [];
  const working: QueuedResult = (call) =>
    call.text.includes("project_parameter_files") && call.text.includes("string_agg")
      ? [{ tip: "v1" }]
      : [];
  return [revisions, drafts, baselines, working];
}

/** Stable fingerprint replies that ignore queue drift between identical before/after snapshots. */
function fingerprintResponder(): QueuedResult {
  return (call) => {
    if (call.text.includes("project_parameter_binding_revisions") && call.text.includes("md5")) {
      return [{ count: "3", checksum: "abc" }];
    }
    if (call.text.includes("from parameter_drafts")) {
      return [{ count: "0" }];
    }
    if (call.text.includes("dts_release_baseline")) {
      return [{ count: "1" }];
    }
    if (call.text.includes("project_parameter_files") && call.text.includes("string_agg")) {
      return [{ tip: "v1" }];
    }
    return [];
  };
}

function makeObjectStore(files: Record<string, Buffer> = {}) {
  const put = vi.fn(async (input: Parameters<ObjectStore["put"]>[0]): Promise<StoredObject> => {
    const storageKey = `${input.organizationId}/${input.fileName}`;
    files[storageKey] = input.bytes;
    return {
      storageKey,
      fileName: input.fileName,
      contentType: input.contentType,
      fileSizeBytes: input.bytes.byteLength,
      checksumSha256: `sha-${input.fileName}`
    };
  });
  const get = vi.fn(async (storageKey: string) => {
    const found = files[storageKey];
    if (!found) throw new Error(`missing ${storageKey}`);
    return found;
  });
  return { objectStore: { put, get } as ObjectStore, put, get, files };
}

const BASE_DTS = `/dts-v1/;

/ {
\tamba {
\t\ti2c@FDF5E000 {
\t\t\tsc8562@6E {
\t\t\t\twatchdog_time = <6000>;
\t\t\t};
\t\t};
\t};
};
`;

function blockedOrValidatedInsert(status: "blocked" | "validated"): QueuedResult {
  return (call) => {
    if (!call.text.includes("insert into dts_reload_runs")) return [];
    return [
      {
        id: call.values[0],
        organization_id: "org-1",
        project_id: "project-1",
        config_revision_id: call.values[3],
        status,
        failure_code: call.values[5],
        steps: typeof call.values[6] === "string" ? JSON.parse(call.values[6] as string) : call.values[6],
        diagnostics:
          typeof call.values[7] === "string" ? JSON.parse(call.values[7] as string) : call.values[7],
        tool_versions:
          typeof call.values[8] === "string" ? JSON.parse(call.values[8] as string) : call.values[8],
        overlay_source_storage_key: call.values[9],
        overlay_source_sha256: call.values[10],
        overlay_artifact_storage_key: call.values[11],
        overlay_artifact_sha256: call.values[12],
        overlay_artifact_bytes: call.values[13],
        created_by_user_id: "user-1",
        created_at: "2026-08-10T00:00:00.000Z",
        completed_at: call.values[15]
      }
    ];
  };
}

beforeEach(() => {
  vi.mocked(createAuditEvent).mockClear();
});

describe("dts-reload policy gate", () => {
  it("refuses callers lacking debugging:dts-reload", async () => {
    const { db } = createFakeDb();
    await expect(listReloadCandidates(db, auth({ permissions: [] }), "project-1")).rejects.toMatchObject({
      code: "FORBIDDEN",
      details: { permission: "debugging:dts-reload" }
    });
  });
});

describe("listReloadCandidates", () => {
  it("returns library baseline values and constraints with debuggable classification", async () => {
    const { db } = createFakeDb([
      [
        candidateRow(),
        candidateRow({
          binding_id: "binding-2",
          node_path: "/amba",
          property_key: "status"
        })
      ]
    ]);

    const result = await listReloadCandidates(db, auth(), "project-1");
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      bindingId: "binding-1",
      baselineValue: "<6000>",
      constraints: { min: 0, max: 20000, cells: 1 },
      debuggable: true
    });
    expect(result.items[1]).toMatchObject({
      bindingId: "binding-2",
      debuggable: false,
      blockReason: "synthesised-anchor"
    });
  });
});

describe("startReloadRun", () => {
  it("refuses a debug value outside declared constraints before involving the toolchain", async () => {
    const { db, calls } = createFakeDb([[candidateRow()]]);
    const { objectStore, put } = makeObjectStore();

    await expect(
      startReloadRun(db, objectStore, auth(), {
        projectId: "project-1",
        targets: [{ bindingId: "binding-1", debugValue: "<99999>" }]
      })
    ).rejects.toBeInstanceOf(ApiError);

    expect(put).not.toHaveBeenCalled();
    expect(calls.some((call) => call.text.includes("insert into dts_reload_runs"))).toBe(false);
  });

  it("refuses a not-debuggable parameter through the API", async () => {
    const { db } = createFakeDb([
      [candidateRow({ binding_id: "binding-bad", node_path: "/amba" })]
    ]);
    const { objectStore, put } = makeObjectStore();

    await expect(
      startReloadRun(db, objectStore, auth(), {
        projectId: "project-1",
        targets: [{ bindingId: "binding-bad", debugValue: "<7000>" }]
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      details: { blockReason: "synthesised-anchor" }
    });
    expect(put).not.toHaveBeenCalled();
  });

  it("blocks the whole batch when one target violates constraints", async () => {
    const { db, calls } = createFakeDb([
      [candidateRow()],
      [
        candidateRow({
          binding_id: "binding-2",
          property_key: "vout_ovp_mv",
          constraints: { min: 0, max: 10000, cells: 1 }
        })
      ]
    ]);
    const { objectStore, put } = makeObjectStore();

    await expect(
      startReloadRun(db, objectStore, auth(), {
        projectId: "project-1",
        targets: [
          { bindingId: "binding-1", debugValue: "<7000>" },
          { bindingId: "binding-2", debugValue: "<99999>" }
        ]
      })
    ).rejects.toBeInstanceOf(ApiError);

    expect(put).not.toHaveBeenCalled();
    expect(calls.some((call) => call.text.includes("insert into dts_reload_runs"))).toBe(false);
  });

  it("persists a validated multi-node batch with one fragment per node", async () => {
    const baseKey = "org-1/board.dts";
    const multiBase = `/dts-v1/;

/ {
\tamba {
\t\ti2c@FDF5E000 {
\t\t\tsc8562@6E {
\t\t\t\twatchdog_time = <6000>;
\t\t\t\tvout_ovp_mv = <5000>;
\t\t\t};
\t\t};
\t\tuart@FDF02000 {
\t\t\tcurrent-speed = <9600>;
\t\t};
\t};
};
`;
    const { objectStore, files } = makeObjectStore({ [baseKey]: Buffer.from(multiBase, "utf8") });

    const { db } = createFakeDb([
      [candidateRow()],
      [
        candidateRow({
          binding_id: "binding-2",
          property_key: "vout_ovp_mv",
          baseline_value: "<5000>",
          constraints: { min: 0, max: 20000, cells: 1 }
        })
      ],
      [
        candidateRow({
          binding_id: "binding-3",
          property_key: "current-speed",
          node_path: "/amba/uart@FDF02000",
          baseline_value: "<9600>",
          constraints: { min: 0, max: 4000000, cells: 1 }
        })
      ],
      ...fingerprintParts(),
      [{ id: "cs-1" }],
      [{ file_name: "board.dts", role: "base", sort_order: 0, storage_key: baseKey, format: "dts" }],
      ...fingerprintParts(),
      blockedOrValidatedInsert("validated"),
      [],
      [],
      [],
      [
        {
          binding_id: "binding-1",
          node_path: "/amba/i2c@FDF5E000/sc8562@6E",
          property_key: "watchdog_time",
          baseline_value: "<6000>",
          debug_value: "<7000>",
          sort_order: 0
        },
        {
          binding_id: "binding-2",
          node_path: "/amba/i2c@FDF5E000/sc8562@6E",
          property_key: "vout_ovp_mv",
          baseline_value: "<5000>",
          debug_value: "<0x1770>",
          sort_order: 1
        },
        {
          binding_id: "binding-3",
          node_path: "/amba/uart@FDF02000",
          property_key: "current-speed",
          baseline_value: "<9600>",
          debug_value: "<115200>",
          sort_order: 2
        }
      ]
    ]);

    const result = await startReloadRun(db, objectStore, auth(), {
      projectId: "project-1",
      targets: [
        { bindingId: "binding-1", debugValue: "<7000>" },
        { bindingId: "binding-2", debugValue: "<0x1770>" },
        { bindingId: "binding-3", debugValue: "<115200>" }
      ]
    });

    expect(result.status).toBe("validated");
    expect(result.overlaySource).toContain("fragment@0");
    expect(result.overlaySource).toContain("fragment@1");
    expect(result.overlaySource).toContain("watchdog_time = <7000>");
    expect(result.overlaySource).toContain("vout_ovp_mv = <0x1770>");
    expect(result.overlaySource).toContain("current-speed = <115200>");
    expect(result.overlaySource).not.toMatch(/^&/m);
    expect(result.artifact?.sha256).toMatch(/^sha-/);
    expect(Object.keys(files).some((key) => key.endsWith(".dtbo"))).toBe(true);
  }, 60_000);

  it("persists a validated run with overlay source and artifact, and leaves the library fingerprint unchanged", async () => {
    const baseKey = "org-1/board.dts";
    const { objectStore, files } = makeObjectStore({ [baseKey]: Buffer.from(BASE_DTS, "utf8") });

    const { db } = createFakeDb([
      [candidateRow()],
      ...fingerprintParts(),
      [{ id: "cs-1" }],
      [{ file_name: "board.dts", role: "base", sort_order: 0, storage_key: baseKey, format: "dts" }],
      ...fingerprintParts(),
      blockedOrValidatedInsert("validated"),
      [],
      [
        {
          binding_id: "binding-1",
          node_path: "/amba/i2c@FDF5E000/sc8562@6E",
          property_key: "watchdog_time",
          baseline_value: "<6000>",
          debug_value: "<7000>",
          sort_order: 0
        }
      ]
    ]);

    const result = await startReloadRun(db, objectStore, auth(), {
      projectId: "project-1",
      targets: [{ bindingId: "binding-1", debugValue: "<7000>" }]
    });

    expect(result.status).toBe("validated");
    expect(result.configRevisionId).toBe("rev-1");
    expect(result.overlaySource).toContain('target-path = "/amba/i2c@FDF5E000/sc8562@6E"');
    expect(result.overlaySource).not.toMatch(/^&/m);
    expect(result.overlaySource).toContain("watchdog_time = <7000>");
    expect(result.artifact?.sha256).toMatch(/^sha-/);
    expect(Object.keys(files).some((key) => key.endsWith(".dtbo"))).toBe(true);
    expect(vi.mocked(createAuditEvent).mock.calls.map((call) => call[1].kind)).toEqual([
      "dts-reload-run-start",
      "dts-reload-run-validated"
    ]);
  }, 60_000);

  it("blocks a wrong node path as a blocked run rather than completing", async () => {
    const baseKey = "org-1/board.dts";
    const { objectStore } = makeObjectStore({ [baseKey]: Buffer.from(BASE_DTS, "utf8") });

    const { db } = createFakeDb([
      [candidateRow({ node_path: "/amba/i2c@WRONG/sc8562@6E" })],
      ...fingerprintParts(),
      [{ id: "cs-1" }],
      [{ file_name: "board.dts", role: "base", sort_order: 0, storage_key: baseKey, format: "dts" }],
      ...fingerprintParts(),
      blockedOrValidatedInsert("blocked"),
      [],
      [
        {
          binding_id: "binding-1",
          node_path: "/amba/i2c@WRONG/sc8562@6E",
          property_key: "watchdog_time",
          baseline_value: "<6000>",
          debug_value: "<7000>",
          sort_order: 0
        }
      ]
    ]);

    const result = await startReloadRun(db, objectStore, auth(), {
      projectId: "project-1",
      targets: [{ bindingId: "binding-1", debugValue: "<7000>" }]
    });

    expect(result.status).toBe("blocked");
    expect(result.artifact).toBeNull();
    expect(
      result.diagnostics.some((d) => d.nodePath?.includes("WRONG") || /WRONG|does not exist/i.test(d.message))
    ).toBe(true);
    expect(vi.mocked(createAuditEvent).mock.calls.map((call) => call[1].kind)).toEqual([
      "dts-reload-run-start",
      "dts-reload-run-blocked"
    ]);
  }, 60_000);

  it("blocks a misspelled property name via the property-existence assertion", async () => {
    const baseKey = "org-1/board.dts";
    const { objectStore } = makeObjectStore({ [baseKey]: Buffer.from(BASE_DTS, "utf8") });

    const { db } = createFakeDb([
      [candidateRow({ property_key: "watchdog_tyme" })],
      ...fingerprintParts(),
      [{ id: "cs-1" }],
      [{ file_name: "board.dts", role: "base", sort_order: 0, storage_key: baseKey, format: "dts" }],
      ...fingerprintParts(),
      blockedOrValidatedInsert("blocked"),
      [],
      [
        {
          binding_id: "binding-1",
          node_path: "/amba/i2c@FDF5E000/sc8562@6E",
          property_key: "watchdog_tyme",
          baseline_value: "<6000>",
          debug_value: "<7000>",
          sort_order: 0
        }
      ]
    ]);

    const result = await startReloadRun(db, objectStore, auth(), {
      projectId: "project-1",
      targets: [{ bindingId: "binding-1", debugValue: "<7000>" }]
    });

    expect(result.status).toBe("blocked");
    expect(result.failureCode).toBe("property-absent-in-base");
    expect(result.diagnostics.some((d) => d.code === "property-absent-in-base")).toBe(true);
  }, 60_000);
});

describe("getReloadRun", () => {
  it("reads overlay source back from the object store after refresh", async () => {
    const overlay = '/dts-v1/;\n/plugin/;\n';
    const { objectStore } = makeObjectStore({
      "org-1/overlay.dts": Buffer.from(overlay, "utf8")
    });
    const { db } = createFakeDb([
      [
        {
          id: "run-1",
          organization_id: "org-1",
          project_id: "project-1",
          config_revision_id: null,
          status: "validated",
          failure_code: null,
          steps: [],
          diagnostics: [],
          tool_versions: {},
          overlay_source_storage_key: "org-1/overlay.dts",
          overlay_source_sha256: "sha",
          overlay_artifact_storage_key: "org-1/overlay.dtbo",
          overlay_artifact_sha256: "sha-art",
          overlay_artifact_bytes: 8,
          created_by_user_id: "user-1",
          created_at: "2026-08-10T00:00:00.000Z",
          completed_at: "2026-08-10T00:00:01.000Z"
        }
      ],
      [
        {
          binding_id: "binding-1",
          node_path: "/amba/i2c@1/dev@6E",
          property_key: "watchdog_time",
          baseline_value: "<6000>",
          debug_value: "<7000>",
          sort_order: 0
        }
      ]
    ]);

    const result = await getReloadRun(db, objectStore, auth(), "run-1");
    expect(result.overlaySource).toBe(overlay);
    expect(result.artifact?.sha256).toBe("sha-art");
  });
});
