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

  const isSensitiveRulesQuery = (text: string) => text.includes("from dts_sensitive_node_rules");
  const isLastReloadQuery = (text: string) => text.includes("select distinct on (t.binding_id)");
  const looksLikeSensitiveRuleRows = (rows: unknown[]) =>
    rows.length === 0 ||
    (typeof rows[0] === "object" &&
      rows[0] !== null &&
      ("risk_tier" in (rows[0] as object) || "match_type" in (rows[0] as object)));

  const runQuery = async <Row,>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> => {
    const call = { text, values };
    calls.push(call);

    // Sensitive-rule lookups must not steal fingerprint / insert queue entries from older tests.
    // Only consume an explicitly queued rule-row array; never consume function responders.
    if (isSensitiveRulesQuery(text)) {
      const next = results[0];
      if (Array.isArray(next) && looksLikeSensitiveRuleRows(next)) {
        results.shift();
        return { rows: next as Row[], rowCount: next.length };
      }
      return { rows: [] as Row[], rowCount: 0 };
    }

    if (isLastReloadQuery(text)) {
      const next = results[0];
      if (Array.isArray(next) && (next.length === 0 || (next[0] && typeof next[0] === "object" && "run_id" in (next[0] as object)))) {
        results.shift();
        return { rows: next as Row[], rowCount: next.length };
      }
      return { rows: [] as Row[], rowCount: 0 };
    }

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
    module_id: "mod-charger",
    module_name: "charger",
    node_path: "/amba/i2c@FDF5E000/sc8562@6E",
    compatible: "sc8562",
    config_revision_id: "rev-1",
    baseline_value: "<6000>",
    description: "Watchdog timeout for charger safety.",
    value_shape: { kind: "cells", bits: 32, cellsPerGroup: 1, groups: 1 },
    unit: "ms",
    constraints: { min: 0, max: 20000, cells: 1 },
    ...overrides
  };
}

function sensitiveRuleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "rule-1",
    organization_id: "org-1",
    project_id: null,
    match_type: "path",
    pattern: "/amba/i2c@FDF5E000/sc8562@6E",
    risk_tier: "high",
    required_capability: "parameter:edit-critical",
    enabled: true,
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
        purpose: call.values[5] ?? "ordinary",
        failure_code: call.values[6],
        steps: typeof call.values[7] === "string" ? JSON.parse(call.values[7] as string) : call.values[7],
        diagnostics:
          typeof call.values[8] === "string" ? JSON.parse(call.values[8] as string) : call.values[8],
        tool_versions:
          typeof call.values[9] === "string" ? JSON.parse(call.values[9] as string) : call.values[9],
        overlay_source_storage_key: call.values[10],
        overlay_source_sha256: call.values[11],
        overlay_artifact_storage_key: call.values[12],
        overlay_artifact_sha256: call.values[13],
        overlay_artifact_bytes: call.values[14],
        created_by_user_id: "user-1",
        created_at: "2026-08-10T00:00:00.000Z",
        completed_at: call.values[16],
        device_id: call.values[17] ?? null,
        restores_source_run_id: call.values[18] ?? null
      }
    ];
  };
}

beforeEach(() => {
  vi.mocked(createAuditEvent).mockClear();
});

describe("dts-reload policy gate", () => {
  it("refuses callers lacking debugging:view for candidate reads", async () => {
    const { db } = createFakeDb();
    await expect(listReloadCandidates(db, auth({ permissions: [] }), "project-1")).rejects.toMatchObject({
      code: "FORBIDDEN",
      details: { permission: "debugging:view" }
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
      description: "Watchdog timeout for charger safety.",
      constraints: { min: 0, max: 20000, cells: 1 },
      debuggable: true,
      sensitiveMatch: null
    });
    expect(result.items[1]).toMatchObject({
      bindingId: "binding-2",
      debuggable: false,
      blockReason: "synthesised-anchor",
      sensitiveMatch: null
    });
  });

  it("collapses duplicate overlay identities and prefers the debuggable row", async () => {
    const { db } = createFakeDb([
      [
        candidateRow({
          binding_id: "binding-stale",
          property_key: "active_perf_limit",
          display_name: "active_perf_limit",
          node_path: "/hisi_vbat_drop_protect_v2/middle_cpu",
          value_shape: { kind: "u32-array" },
          baseline_value: null,
          constraints: {},
          description: null
        }),
        candidateRow({
          binding_id: "binding-ok",
          property_key: "active_perf_limit",
          display_name: "active_perf_limit",
          node_path: "/hisi_vbat_drop_protect_v2/middle_cpu",
          value_shape: { kind: "u32-array" },
          baseline_value: "<16 100 100 6 15 100 0 5 100>",
          constraints: {},
          description: null
        }),
        candidateRow({
          binding_id: "binding-null-path",
          property_key: "active_perf_limit",
          display_name: "active_perf_limit",
          node_path: null,
          value_shape: { kind: "u32-array" },
          baseline_value: "<16 100 100 6 15 100 0 5 100>",
          constraints: {},
          description: null
        })
      ]
    ]);

    const result = await listReloadCandidates(db, auth(), "project-1");
    expect(result.items).toHaveLength(2);
    const withPath = result.items.find((item) => item.nodePath);
    expect(withPath).toMatchObject({
      bindingId: "binding-ok",
      debuggable: true,
      propertyKey: "active_perf_limit"
    });
    expect(result.items.find((item) => item.nodePath == null)?.bindingId).toBe("binding-null-path");
  });

  it("marks incomplete u32-array catalog shapes debuggable when baseline width is regular", async () => {
    const { db } = createFakeDb([
      [
        candidateRow({
          property_key: "active_perf_limit",
          value_shape: { kind: "u32-array" },
          baseline_value: "<16 100 100 6 15 100 0 5 100>",
          constraints: {}
        })
      ]
    ]);

    const result = await listReloadCandidates(db, auth(), "project-1");
    expect(result.items[0]).toMatchObject({
      debuggable: true,
      valueShapeKind: "u32-array"
    });
  });

  it("marks GPIO-style mixed gpio_int candidates as debuggable", async () => {
    const { db } = createFakeDb([
      [
        candidateRow({
          property_key: "gpio_int",
          display_name: "gpio_int",
          value_shape: { kind: "mixed" },
          baseline_value: "<&gpio13 29 0>",
          constraints: { cells: 3 },
          description: "SC8562 interrupt GPIO"
        })
      ]
    ]);

    const result = await listReloadCandidates(db, auth(), "project-1");
    expect(result.items[0]).toMatchObject({
      propertyKey: "gpio_int",
      valueShapeKind: "mixed",
      debuggable: true,
      baselineValue: "<&gpio13 29 0>"
    });
  });

  it("exposes server-computed sensitive matches so the UI can mark elevated requirements before start", async () => {
    const { db } = createFakeDb([
      [candidateRow()],
      [
        sensitiveRuleRow({
          risk_tier: "critical",
          pattern: "/amba/i2c@FDF5E000/sc8562@6E"
        })
      ]
    ]);

    const result = await listReloadCandidates(db, auth(), "project-1");
    expect(result.items[0]?.sensitiveMatch).toMatchObject({
      riskTier: "critical",
      requiredCapability: "parameter:edit-critical",
      ruleId: "rule-1",
      requiresElevatedCapability: true,
      requiresConfirmation: true
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

  it("refuses a debug value whose cell dimensions do not match the declared value shape", async () => {
    const { db, calls } = createFakeDb([
      [
        candidateRow({
          value_shape: { kind: "cells", bits: 32, cellsPerGroup: 3, groups: 1 },
          constraints: {}
        })
      ]
    ]);
    const { objectStore, put } = makeObjectStore();

    await expect(
      startReloadRun(db, objectStore, auth(), {
        projectId: "project-1",
        targets: [{ bindingId: "binding-1", debugValue: "<1 2>" }]
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      details: { expectedCellsPerGroup: 3 }
    });

    expect(put).not.toHaveBeenCalled();
    expect(calls.some((call) => call.text.includes("insert into dts_reload_runs"))).toBe(false);
  });

  it("infers cellsPerGroup from baseline for incomplete u32-array shapes during start", async () => {
    const { db, calls } = createFakeDb([
      [
        candidateRow({
          property_key: "active_perf_limit",
          value_shape: { kind: "u32-array" },
          baseline_value: "<16 100 100 6 15 100 0 5 100>",
          constraints: {}
        })
      ]
    ]);
    const { objectStore, put } = makeObjectStore();

    await expect(
      startReloadRun(db, objectStore, auth(), {
        projectId: "project-1",
        targets: [{ bindingId: "binding-1", debugValue: "<1 2 3>" }]
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      details: { expectedCellsPerGroup: 9 }
    });

    expect(put).not.toHaveBeenCalled();
    expect(calls.some((call) => call.text.includes("insert into dts_reload_runs"))).toBe(false);
  });

  it("refuses a GPIO phandle debug value whose cell width does not match the baseline shape", async () => {
    const { db, calls } = createFakeDb([
      [
        candidateRow({
          property_key: "gpio_int",
          value_shape: { kind: "mixed" },
          baseline_value: "<&gpio13 29 0>",
          constraints: { cells: 3 }
        })
      ]
    ]);
    const { objectStore, put } = makeObjectStore();

    await expect(
      startReloadRun(db, objectStore, auth(), {
        projectId: "project-1",
        targets: [{ bindingId: "binding-1", debugValue: "<&gpio13 29>" }]
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      details: { expectedCellsPerGroup: 3 }
    });

    expect(put).not.toHaveBeenCalled();
    expect(calls.some((call) => call.text.includes("insert into dts_reload_runs"))).toBe(false);
  });

  it("persists a validated gpio_int phandle-cells reload", async () => {
    const baseKey = "org-1/board.dts";
    const gpioBase =
      "/dts-v1/;\n\n/ {\n\tgpiol13: gpio13 {\n\t};\n\tamba {\n\t\ti2c@FDF5E000 {\n\t\t\tsc8562@6E {\n\t\t\t\tgpio_int = <&gpio13 29 0>;\n\t\t\t};\n\t\t};\n\t};\n};\n".replace(
        "gpiol13:",
        "gpio13:"
      );
    const { objectStore, files } = makeObjectStore({ [baseKey]: Buffer.from(gpioBase, "utf8") });

    const { db } = createFakeDb([
      [
        candidateRow({
          property_key: "gpio_int",
          display_name: "gpio_int",
          value_shape: { kind: "mixed" },
          baseline_value: "<&gpio13 29 0>",
          constraints: { cells: 3 },
          unit: null
        })
      ],
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
          property_key: "gpio_int",
          baseline_value: "<&gpio13 29 0>",
          debug_value: "<&gpio13 30 0>",
          sort_order: 0
        }
      ]
    ]);

    const result = await startReloadRun(db, objectStore, auth(), {
      projectId: "project-1",
      targets: [{ bindingId: "binding-1", debugValue: "<&gpio13 30 0>" }]
    });

    expect(result.status).toBe("validated");
    expect(result.overlaySource).toContain("gpio_int = <&gpio13 30 0>");
    expect(result.overlaySource).toContain('target-path = "/amba/i2c@FDF5E000/sc8562@6E"');
    expect(result.artifact?.sha256).toMatch(/^sha-/);
    expect(Object.keys(files).some((key) => key.endsWith(".dtbo"))).toBe(true);
  }, 60_000);

  it("refuses a batch that targets the same overlay path and property twice", async () => {
    const { db } = createFakeDb([
      [
        candidateRow({
          binding_id: "binding-a",
          property_key: "active_perf_limit",
          value_shape: { kind: "u32-array" },
          baseline_value: "<16 100 100 6 15 100 0 5 100>",
          constraints: {}
        })
      ],
      [
        candidateRow({
          binding_id: "binding-b",
          property_key: "active_perf_limit",
          value_shape: { kind: "u32-array" },
          baseline_value: "<16 100 100 6 15 100 0 5 100>",
          constraints: {}
        })
      ]
    ]);
    const { objectStore, put } = makeObjectStore();

    await expect(
      startReloadRun(db, objectStore, auth(), {
        projectId: "project-1",
        targets: [
          { bindingId: "binding-a", debugValue: "<16 100 100 6 15 100 0 5 100>" },
          { bindingId: "binding-b", debugValue: "<17 100 100 6 15 100 0 5 100>" }
        ]
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      details: { code: "reload-duplicate-overlay-target" }
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

describe("startReloadRun sensitive-node governance", () => {
  const elevatedAuth = () =>
    auth({ permissions: ["debugging:dts-reload", "parameter:edit-critical"] });

  it("refuses a high-tier match when the caller has only debugging:dts-reload", async () => {
    const { db, calls } = createFakeDb([[candidateRow()], [sensitiveRuleRow({ risk_tier: "high" })]]);
    const { objectStore, put } = makeObjectStore();

    await expect(
      startReloadRun(db, objectStore, auth(), {
        projectId: "project-1",
        targets: [{ bindingId: "binding-1", debugValue: "<7000>" }]
      })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
      details: {
        code: "sensitive-node-reload-denied",
        riskTier: "high",
        bindingId: "binding-1",
        requiredCapability: "parameter:edit-critical",
        reason: "missing-capability"
      }
    });

    expect(put).not.toHaveBeenCalled();
    expect(calls.some((call) => call.text.includes("insert into dts_reload_runs"))).toBe(false);
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        kind: "dts-reload-sensitive-node-denied",
        action: "deny",
        severity: "High",
        metadata: expect.objectContaining({
          reason: "missing-capability",
          riskTier: "high",
          bindingId: "binding-1"
        })
      })
    );
  });

  it("allows a high-tier match when the caller also has parameter:edit-critical", async () => {
    const baseKey = "org-1/board.dts";
    const { objectStore } = makeObjectStore({ [baseKey]: Buffer.from(BASE_DTS, "utf8") });
    const { db } = createFakeDb([
      [candidateRow()],
      [sensitiveRuleRow({ risk_tier: "high" })],
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

    const result = await startReloadRun(db, objectStore, elevatedAuth(), {
      projectId: "project-1",
      targets: [{ bindingId: "binding-1", debugValue: "<7000>" }]
    });
    expect(result.status).toBe("validated");
  }, 60_000);

  it("refuses a critical-tier match without confirmation even with elevated capability", async () => {
    const { db } = createFakeDb([[candidateRow()], [sensitiveRuleRow({ risk_tier: "critical" })]]);
    const { objectStore, put } = makeObjectStore();

    await expect(
      startReloadRun(db, objectStore, elevatedAuth(), {
        projectId: "project-1",
        targets: [{ bindingId: "binding-1", debugValue: "<7000>" }]
      })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      details: {
        code: "sensitive-node-reload-denied",
        riskTier: "critical",
        reason: "missing-confirmation",
        requireConfirmation: true,
        expectedConfirmationToken: "confirm-sensitive-reload"
      }
    });
    expect(put).not.toHaveBeenCalled();
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        kind: "dts-reload-sensitive-node-denied",
        metadata: expect.objectContaining({ reason: "missing-confirmation" })
      })
    );
  });

  it("allows a critical-tier match with elevated capability plus confirm-sensitive-reload and audits High", async () => {
    const baseKey = "org-1/board.dts";
    const { objectStore } = makeObjectStore({ [baseKey]: Buffer.from(BASE_DTS, "utf8") });
    const { db } = createFakeDb([
      [candidateRow()],
      [sensitiveRuleRow({ risk_tier: "critical" })],
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

    const result = await startReloadRun(
      db,
      objectStore,
      elevatedAuth(),
      {
        projectId: "project-1",
        targets: [{ bindingId: "binding-1", debugValue: "<7000>" }],
        confirmationToken: "confirm-sensitive-reload"
      }
    );
    expect(result.status).toBe("validated");
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        kind: "dts-reload-run-start",
        severity: "High",
        metadata: expect.objectContaining({
          sensitiveMatches: [
            expect.objectContaining({
              ruleId: "rule-1",
              riskTier: "critical",
              pattern: "/amba/i2c@FDF5E000/sc8562@6E"
            })
          ]
        })
      })
    );
  }, 60_000);

  it("refuses an agent actor for start even without a sensitive match and audits the refusal", async () => {
    const { db } = createFakeDb([[candidateRow()]]);
    const { objectStore, put } = makeObjectStore();

    await expect(
      startReloadRun(
        db,
        objectStore,
        auth(),
        {
          projectId: "project-1",
          targets: [{ bindingId: "binding-1", debugValue: "<7000>" }]
        },
        { actorType: "agent" }
      )
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      details: {
        code: "dts-reload-agent-refused",
        reason: "agent-refused",
        requireHuman: true,
        action: "start"
      }
    });
    expect(put).not.toHaveBeenCalled();
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorType: "agent",
        kind: "dts-reload-agent-refused",
        action: "deny",
        metadata: expect.objectContaining({
          reason: "agent-refused",
          requireHuman: true,
          action: "start"
        })
      })
    );
  });

  it("refuses an agent actor for any sensitive match and audits requireHuman", async () => {
    const { db } = createFakeDb([[candidateRow()], [sensitiveRuleRow({ risk_tier: "high" })]]);
    const { objectStore, put } = makeObjectStore();

    await expect(
      startReloadRun(
        db,
        objectStore,
        elevatedAuth(),
        {
          projectId: "project-1",
          targets: [{ bindingId: "binding-1", debugValue: "<7000>" }],
          confirmationToken: "confirm-sensitive-reload"
        },
        { actorType: "agent" }
      )
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      details: {
        code: "dts-reload-agent-refused",
        reason: "agent-refused",
        requireHuman: true
      }
    });
    expect(put).not.toHaveBeenCalled();
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorType: "agent",
        kind: "dts-reload-agent-refused",
        metadata: expect.objectContaining({
          reason: "agent-refused",
          requireHuman: true
        })
      })
    );
  });

  it("refuses a critical-tier match without elevated capability before asking for confirmation", async () => {
    const { db } = createFakeDb([[candidateRow()], [sensitiveRuleRow({ risk_tier: "critical" })]]);
    const { objectStore, put } = makeObjectStore();

    await expect(
      startReloadRun(db, objectStore, auth(), {
        projectId: "project-1",
        targets: [{ bindingId: "binding-1", debugValue: "<7000>" }],
        confirmationToken: "confirm-sensitive-reload"
      })
    ).rejects.toMatchObject({
      details: {
        code: "sensitive-node-reload-denied",
        riskTier: "critical",
        reason: "missing-capability"
      }
    });
    expect(put).not.toHaveBeenCalled();
  });

  it("refuses an agent actor for a critical-tier match even with elevated capability and confirmation", async () => {
    const { db } = createFakeDb([[candidateRow()], [sensitiveRuleRow({ risk_tier: "critical" })]]);
    const { objectStore } = makeObjectStore();

    await expect(
      startReloadRun(
        db,
        objectStore,
        elevatedAuth(),
        {
          projectId: "project-1",
          targets: [{ bindingId: "binding-1", debugValue: "<7000>" }],
          confirmationToken: "confirm-sensitive-reload"
        },
        { actorType: "agent" }
      )
    ).rejects.toMatchObject({
      details: {
        code: "dts-reload-agent-refused",
        reason: "agent-refused",
        requireHuman: true
      }
    });
  });

  it("matches compatible-kind rules for reload targets", async () => {
    const { db } = createFakeDb([
      [candidateRow({ compatible: "vendor,watchdog-v2" })],
      [
        sensitiveRuleRow({
          id: "rule-compat",
          match_type: "compatible",
          pattern: "vendor,watchdog*",
          risk_tier: "high"
        })
      ]
    ]);
    const { objectStore } = makeObjectStore();

    await expect(
      startReloadRun(db, objectStore, auth(), {
        projectId: "project-1",
        targets: [{ bindingId: "binding-1", debugValue: "<7000>" }]
      })
    ).rejects.toMatchObject({
      details: {
        code: "sensitive-node-reload-denied",
        matchType: "compatible",
        pattern: "vendor,watchdog*"
      }
    });
  });
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
