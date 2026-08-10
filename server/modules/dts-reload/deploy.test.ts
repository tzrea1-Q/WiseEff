import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/types";
import type { ObjectStore, StoredObject } from "../logs/objectStore";
import type { Database, QueryResult, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { DTS_RELOAD_BRIDGE_RPC_METHODS } from "@wiseeff/device-command-core/bridgeRpcMethods";

vi.mock("../audit/repository", () => ({
  createAuditEvent: vi.fn(async () => undefined)
}));

vi.mock("../deviceBridge/repository", () => ({
  listBridgesForUser: vi.fn()
}));

vi.mock("../debugging/repository", () => ({
  acquireDebugDeviceLease: vi.fn(),
  releaseDebugDeviceLease: vi.fn()
}));

vi.mock("./resolveConfiguration", () => ({
  resolveReloadConfiguration: vi.fn()
}));

import { createAuditEvent } from "../audit/repository";
import { listBridgesForUser } from "../deviceBridge/repository";
import { acquireDebugDeviceLease, releaseDebugDeviceLease } from "../debugging/repository";
import { resolveReloadConfiguration } from "./resolveConfiguration";
import { deployReloadRun } from "./service";
import { DTS_RELOAD_CONFIRMATION_TOKEN } from "./types";

type QueryCall = { text: string; values: unknown[] };

type DeployDbOptions = {
  runRow: Record<string, unknown>;
  targetRows?: unknown[];
  /** Rows returned for debug-node binding resolution, keyed by binding id (values[1]). */
  debugBindingsByBindingId?: Record<string, unknown[]>;
};

function createDeployDb(options: DeployDbOptions) {
  const calls: QueryCall[] = [];
  const updates: Array<Record<string, unknown>> = [];
  const runQuery = async <Row,>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> => {
    const call = { text, values };
    calls.push(call);

    if (text.includes("from dts_reload_run_targets")) {
      return { rows: (options.targetRows ?? []) as Row[], rowCount: (options.targetRows ?? []).length };
    }

    if (text.includes("from debugging_parameters") || text.includes("join debugging_parameters")) {
      const bindingId = String(values[1] ?? "");
      const rows = options.debugBindingsByBindingId?.[bindingId] ?? [];
      return { rows: rows as Row[], rowCount: rows.length };
    }

    if (text.includes("update dts_reload_runs")) {
      const next = {
        ...options.runRow,
        status: values[2],
        failure_code: values[3],
        steps: JSON.parse(String(values[4])),
        reload_snapshot: JSON.parse(String(values[11])),
        integrity_check: values[10],
        completed_at: values[12],
        device_id: values[5],
        bridge_id: values[6],
        bridge_machine_label: values[7],
        target_ref: values[8],
        protocol: values[9]
      };
      updates.push(next);
      return { rows: [next] as Row[], rowCount: 1 };
    }

    // getReloadRun / artifact key lookup
    if (text.includes("from dts_reload_runs") || text.includes("overlay_artifact_storage_key")) {
      return { rows: [options.runRow] as Row[], rowCount: 1 };
    }

    return { rows: [] as Row[], rowCount: 0 };
  };

  const db: Database = {
    query: (text, values = []) => runQuery(text, values),
    transaction: async <T,>(fn: (queryable: Queryable) => Promise<T>) =>
      fn({ query: (text, values = []) => runQuery(text, values) })
  };
  return { db, calls, updates };
}

/** Legacy queue-based helper for early-refusal tests that never reach behavioural verify. */
function createFakeDb(handlers: Array<(call: QueryCall) => unknown[]> = []) {
  const calls: QueryCall[] = [];
  const runQuery = async <Row,>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> => {
    const call = { text, values };
    calls.push(call);
    const handler = handlers.shift();
    const rows = handler ? handler(call) : [];
    return { rows: rows as Row[], rowCount: rows.length };
  };
  const db: Database = {
    query: (text, values = []) => runQuery(text, values),
    transaction: async <T,>(fn: (queryable: Queryable) => Promise<T>) =>
      fn({ query: (text, values = []) => runQuery(text, values) })
  };
  return { db, calls };
}

function auth(): AuthContext {
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
    permissions: ["debugging:dts-reload"]
  };
}

function validatedRunRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    organization_id: "org-1",
    project_id: "project-1",
    config_revision_id: "rev-1",
    status: "validated",
    failure_code: null,
    steps: [
      { step: "compile-base", outcome: "passed" },
      { step: "compile-overlay", outcome: "passed" },
      { step: "dry-run-merge", outcome: "passed" },
      { step: "assert-effect", outcome: "passed" }
    ],
    diagnostics: [],
    tool_versions: { dtc: "1.0", fdtoverlay: "1.0" },
    overlay_source_storage_key: "src-key",
    overlay_source_sha256: "src-sha",
    overlay_artifact_storage_key: "art-key",
    overlay_artifact_sha256: createHash("sha256").update("dtbo").digest("hex"),
    overlay_artifact_bytes: 4,
    created_by_user_id: "user-1",
    created_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    device_id: null,
    bridge_id: null,
    bridge_machine_label: null,
    target_ref: null,
    protocol: null,
    integrity_check: null,
    reload_snapshot: {},
    ...overrides
  };
}

describe("deployReloadRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listBridgesForUser).mockResolvedValue([
      {
        id: "br-1",
        organizationId: "org-1",
        userId: "user-1",
        machineLabel: "LAB-PC",
        platform: "darwin",
        arch: "arm64",
        clientVersion: "0.1.0",
        capabilities: {},
        createdAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        revokedAt: null
      }
    ]);
    vi.mocked(acquireDebugDeviceLease).mockResolvedValue({
      organizationId: "org-1",
      deviceId: "dev-1",
      sessionId: "dts-reload:run-1",
      leaseOwnerUserId: "user-1",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      acquiredAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    vi.mocked(releaseDebugDeviceLease).mockResolvedValue(null);
    vi.mocked(resolveReloadConfiguration).mockResolvedValue({
      organizationId: "org-1",
      deviceId: "dev-1",
      source: "seeded-default",
      destinationDirectory: "/vendor/firmware/",
      destinationFilename: "power_dts_overlay.dtbo",
      triggerNodePath: "/sys/kernel/debug/power_debug/dts_overlay/trigger",
      triggerPayload: "1",
      kernelLogCommand: "dmesg"
    });
  });

  it("refuses deploy when confirm-dts-reload is missing and never invents the token", async () => {
    const artifactSha = createHash("sha256").update("dtbo").digest("hex");
    const { db } = createFakeDb([
      () => [validatedRunRow({ overlay_artifact_sha256: artifactSha })],
      () => [
        {
          binding_id: "b1",
          node_path: "/n",
          property_key: "p",
          baseline_value: "<1>",
          debug_value: "<2>",
          sort_order: 0
        }
      ],
      () => [validatedRunRow({ overlay_artifact_sha256: artifactSha })]
    ]);
    const objectStore: ObjectStore = {
      put: vi.fn(),
      get: vi.fn(async () => Buffer.from("/dts-v1/;")),
      delete: vi.fn()
    };
    const bridgeRpcClient = { call: vi.fn() };

    await expect(
      deployReloadRun(
        db,
        objectStore,
        auth(),
        {
          runId: "run-1",
          deviceId: "dev-1",
          bridgeId: "br-1",
          targetRef: "AURORA-001",
          protocol: "hdc",
          confirmationTokens: ["confirm-sensitive-reload"]
        },
        {
          bridgeRpcClient,
          bridgeConnectionPool: { isConnected: () => true }
        }
      )
    ).rejects.toMatchObject({
      details: { code: "missing-dts-reload-confirmation" }
    });
    expect(bridgeRpcClient.call).not.toHaveBeenCalled();
    expect(vi.mocked(createAuditEvent).mock.calls.some((call) => {
      const metadata = call[1].metadata as Record<string, unknown>;
      return metadata?.confirmationToken === DTS_RELOAD_CONFIRMATION_TOKEN && call[1].kind === "dts-reload-run-deploy-started";
    })).toBe(false);
  });

  it("mounts, transfers, triggers, and finishes as unverifiable with a reload snapshot", async () => {
    const artifactBytes = Buffer.from("dtbo");
    const artifactSha = createHash("sha256").update(artifactBytes).digest("hex");
    const runRow = validatedRunRow({ overlay_artifact_sha256: artifactSha, overlay_artifact_bytes: artifactBytes.length });
    const targetRows = [
      {
        binding_id: "b1",
        node_path: "/amba/i2c@1/node",
        property_key: "watchdog_time",
        baseline_value: "<6000>",
        debug_value: "<7000>",
        sort_order: 0
      }
    ];

    const { db } = createDeployDb({ runRow, targetRows });

    const files = new Map<string, Buffer>([
      ["src-key", Buffer.from("/dts-v1/;\n/plugin/;\n")],
      ["art-key", artifactBytes]
    ]);
    const objectStore: ObjectStore = {
      put: vi.fn(async (input) => {
        const stored: StoredObject = {
          storageKey: `key-${input.fileName}`,
          checksumSha256: createHash("sha256").update(input.bytes).digest("hex"),
          fileSizeBytes: input.bytes.length,
          contentType: input.contentType
        };
        files.set(stored.storageKey, input.bytes);
        return stored;
      }),
      get: vi.fn(async (key) => {
        const bytes = files.get(key);
        if (!bytes) throw new Error(`missing ${key}`);
        return bytes;
      }),
      delete: vi.fn()
    };

    const bridgeRpcClient = {
      call: vi.fn(async (_bridgeId: string, method: string) => {
        if (method === "bridge.getCapabilities") {
          return { methods: [...DTS_RELOAD_BRIDGE_RPC_METHODS, "bridge.getCapabilities", "debug.detectTargets", "debug.readNode"] };
        }
        if (method === "debug.mountTarget") {
          return { ok: true, durationMs: 1 };
        }
        if (method === "debug.pushFile") {
          return {
            ok: true,
            localDigest: artifactSha,
            remoteDigest: artifactSha,
            integrityCheck: "sha256",
            durationMs: 2
          };
        }
        if (method === "debug.writeNode") {
          return { ok: true, verified: true, writeResult: { ok: true } };
        }
        if (method === "debug.readKernelLog") {
          return {
            ok: true,
            text: "kernel: watchdog_time applied\nkernel: overlay reload ok\n",
            truncated: false,
            byteLength: 58,
            maxBytes: 256 * 1024
          };
        }
        throw new Error(`unexpected ${method}`);
      })
    };

    const result = await deployReloadRun(
      db,
      objectStore,
      auth(),
      {
        runId: "run-1",
        deviceId: "dev-1",
        bridgeId: "br-1",
        targetRef: "AURORA-001",
        protocol: "hdc",
        confirmationTokens: [DTS_RELOAD_CONFIRMATION_TOKEN]
      },
      {
        bridgeRpcClient,
        bridgeConnectionPool: { isConnected: () => true }
      }
    );

    expect(result.status).toBe("unverifiable");
    expect(result.failureCode).toBeNull();
    expect(result.integrityCheck).toBe("sha256");
    expect(result.reloadSnapshot?.libraryBaselines[0]?.baselineValue).toBe("<6000>");
    expect(result.reloadSnapshot?.artifactDigest?.integrityCheck).toBe("sha256");
    expect(result.reloadSnapshot?.kernelSignal).toMatchObject({
      command: "dmesg",
      captureStatus: "obtained",
      rawText: "kernel: watchdog_time applied\nkernel: overlay reload ok\n",
      matchedByParameter: [
        {
          parameterName: "watchdog_time",
          bindingId: "b1",
          lines: ["kernel: watchdog_time applied"]
        }
      ]
    });
    expect(result.reloadSnapshot?.behaviouralVerification?.outcomes).toEqual([
      expect.objectContaining({
        bindingId: "b1",
        propertyKey: "watchdog_time",
        outcome: "unbound",
        reason: expect.stringContaining("No readable debug-node binding")
      })
    ]);
    expect(result.steps.map((step) => [step.step, step.outcome])).toEqual([
      ["compile-base", "passed"],
      ["compile-overlay", "passed"],
      ["dry-run-merge", "passed"],
      ["assert-effect", "passed"],
      ["mount-target", "passed"],
      ["transfer-artifact", "passed"],
      ["trigger-reload", "passed"]
    ]);

    expect(bridgeRpcClient.call).toHaveBeenNthCalledWith(
      2,
      "br-1",
      "debug.mountTarget",
      { protocol: "hdc", targetRef: "AURORA-001" },
      { timeoutMs: 15_000 }
    );
    expect(bridgeRpcClient.call).toHaveBeenNthCalledWith(
      3,
      "br-1",
      "debug.pushFile",
      expect.objectContaining({
        destinationDirectory: "/vendor/firmware/",
        destinationFilename: "power_dts_overlay.dtbo",
        contentSha256: artifactSha
      }),
      { timeoutMs: 30_000 }
    );
    expect(bridgeRpcClient.call).toHaveBeenNthCalledWith(
      4,
      "br-1",
      "debug.writeNode",
      expect.objectContaining({
        nodePath: "/sys/kernel/debug/power_debug/dts_overlay/trigger",
        value: "1",
        readBack: false
      }),
      { timeoutMs: 10_000 }
    );
    expect(bridgeRpcClient.call).toHaveBeenNthCalledWith(
      5,
      "br-1",
      "debug.readKernelLog",
      { protocol: "hdc", targetRef: "AURORA-001", command: "dmesg" },
      { timeoutMs: 10_000 }
    );
    expect(bridgeRpcClient.call.mock.calls.some((call) => call[1] === "debug.readNode")).toBe(false);
    expect(acquireDebugDeviceLease).toHaveBeenCalled();
    expect(releaseDebugDeviceLease).toHaveBeenCalled();
    expect(resolveReloadConfiguration).toHaveBeenCalledWith(db, {
      organizationId: "org-1",
      deviceId: "dev-1"
    });
  });

  it("reports mount failure distinctly from transfer failure", async () => {
    const artifactBytes = Buffer.from("dtbo");
    const artifactSha = createHash("sha256").update(artifactBytes).digest("hex");
    const runRow = validatedRunRow({ overlay_artifact_sha256: artifactSha });
    const { db } = createFakeDb([
      () => [runRow],
      () => [
        {
          binding_id: "b1",
          node_path: "/n",
          property_key: "p",
          baseline_value: "<1>",
          debug_value: "<2>",
          sort_order: 0
        }
      ],
      () => [runRow],
      (call) => [{ ...runRow, status: call.values[2], failure_code: call.values[3], steps: JSON.parse(String(call.values[4])), reload_snapshot: {}, integrity_check: null, completed_at: call.values[12], device_id: call.values[5], bridge_id: call.values[6], bridge_machine_label: call.values[7], target_ref: call.values[8], protocol: call.values[9] }],
      (call) => [{ ...runRow, status: call.values[2], failure_code: call.values[3], steps: JSON.parse(String(call.values[4])), reload_snapshot: {}, integrity_check: null, completed_at: call.values[12], device_id: call.values[5], bridge_id: call.values[6], bridge_machine_label: call.values[7], target_ref: call.values[8], protocol: call.values[9] }],
      (call) => [{ ...runRow, status: call.values[2], failure_code: call.values[3], steps: JSON.parse(String(call.values[4])), reload_snapshot: {}, integrity_check: null, completed_at: call.values[12], device_id: call.values[5], bridge_id: call.values[6], bridge_machine_label: call.values[7], target_ref: call.values[8], protocol: call.values[9] }]
    ]);
    const objectStore: ObjectStore = {
      put: vi.fn(),
      get: vi.fn(async (key) => (key === "art-key" ? artifactBytes : Buffer.from("src"))),
      delete: vi.fn()
    };
    const bridgeRpcClient = {
      call: vi.fn(async (_id: string, method: string) => {
        if (method === "bridge.getCapabilities") {
          return { methods: [...DTS_RELOAD_BRIDGE_RPC_METHODS, "bridge.getCapabilities"] };
        }
        if (method === "debug.mountTarget") {
          return { ok: false, error: "mount denied" };
        }
        throw new Error(`unexpected ${method}`);
      })
    };

    const result = await deployReloadRun(
      db,
      objectStore,
      auth(),
      {
        runId: "run-1",
        deviceId: "dev-1",
        bridgeId: "br-1",
        targetRef: "AURORA-001",
        protocol: "hdc",
        confirmationTokens: [DTS_RELOAD_CONFIRMATION_TOKEN]
      },
      {
        bridgeRpcClient,
        bridgeConnectionPool: { isConnected: () => true }
      }
    );

    expect(result.status).toBe("failed");
    expect(result.failureCode).toBe("mount-target-failed");
    expect(result.steps.find((step) => step.step === "mount-target")?.outcome).toBe("failed");
  });

  it("refuses when the bridge lacks deploy RPC methods and points at releases", async () => {
    const artifactBytes = Buffer.from("dtbo");
    const artifactSha = createHash("sha256").update(artifactBytes).digest("hex");
    const runRow = validatedRunRow({ overlay_artifact_sha256: artifactSha });
    const { db } = createFakeDb([
      () => [runRow],
      () => [
        {
          binding_id: "b1",
          node_path: "/n",
          property_key: "p",
          baseline_value: "<1>",
          debug_value: "<2>",
          sort_order: 0
        }
      ],
      () => [runRow]
    ]);
    const objectStore: ObjectStore = {
      put: vi.fn(),
      get: vi.fn(async (key) => (key === "art-key" ? artifactBytes : Buffer.from("src"))),
      delete: vi.fn()
    };
    const bridgeRpcClient = {
      call: vi.fn(async () => ({ methods: ["bridge.getCapabilities", "debug.writeNode"] }))
    };

    await expect(
      deployReloadRun(
        db,
        objectStore,
        auth(),
        {
          runId: "run-1",
          deviceId: "dev-1",
          bridgeId: "br-1",
          targetRef: "AURORA-001",
          protocol: "hdc",
          confirmationTokens: [DTS_RELOAD_CONFIRMATION_TOKEN]
        },
        {
          bridgeRpcClient,
          bridgeConnectionPool: { isConnected: () => true }
        }
      )
    ).rejects.toMatchObject({
      details: {
        code: "bridge-upgrade-required",
        releasesPath: "/api/v1/device-bridge/releases"
      }
    });
  });

  it("atomically refuses a second deploy claim on the same run and never acquires a lease", async () => {
    const artifactBytes = Buffer.from("dtbo");
    const artifactSha = createHash("sha256").update(artifactBytes).digest("hex");
    const runRow = validatedRunRow({ overlay_artifact_sha256: artifactSha });
    const { db, calls } = createFakeDb([
      () => [runRow],
      () => [
        {
          binding_id: "b1",
          node_path: "/n",
          property_key: "p",
          baseline_value: "<1>",
          debug_value: "<2>",
          sort_order: 0
        }
      ],
      () => [runRow],
      // claimReloadRunForDeploy lost the race
      () => []
    ]);
    const objectStore: ObjectStore = {
      put: vi.fn(),
      get: vi.fn(async (key) => (key === "art-key" ? artifactBytes : Buffer.from("src"))),
      delete: vi.fn()
    };
    const bridgeRpcClient = {
      call: vi.fn(async () => ({ methods: [...DTS_RELOAD_BRIDGE_RPC_METHODS, "bridge.getCapabilities"] }))
    };

    await expect(
      deployReloadRun(
        db,
        objectStore,
        auth(),
        {
          runId: "run-1",
          deviceId: "dev-1",
          bridgeId: "br-1",
          targetRef: "AURORA-001",
          protocol: "hdc",
          confirmationTokens: [DTS_RELOAD_CONFIRMATION_TOKEN]
        },
        {
          bridgeRpcClient,
          bridgeConnectionPool: { isConnected: () => true }
        }
      )
    ).rejects.toMatchObject({
      details: { code: "reload-deploy-already-in-progress" }
    });

    expect(acquireDebugDeviceLease).not.toHaveBeenCalled();
    expect(releaseDebugDeviceLease).not.toHaveBeenCalled();
    expect(bridgeRpcClient.call).toHaveBeenCalledTimes(1);
    expect(calls.some((call) => /status = any\(\$14::text\[\]\)/.test(call.text))).toBe(true);
  });

  it("marks the run failed when bridge RPC throws after claim so it is not stuck deploying", async () => {
    const artifactBytes = Buffer.from("dtbo");
    const artifactSha = createHash("sha256").update(artifactBytes).digest("hex");
    const runRow = validatedRunRow({ overlay_artifact_sha256: artifactSha });
    const statuses: unknown[] = [];
    const persist = (call: QueryCall) => {
      statuses.push(call.values[2]);
      return [
        {
          ...runRow,
          status: call.values[2],
          failure_code: call.values[3],
          steps: JSON.parse(String(call.values[4])),
          reload_snapshot: JSON.parse(String(call.values[11] ?? "{}")),
          integrity_check: call.values[10],
          completed_at: call.values[12],
          device_id: call.values[5],
          bridge_id: call.values[6],
          bridge_machine_label: call.values[7],
          target_ref: call.values[8],
          protocol: call.values[9]
        }
      ];
    };
    const { db } = createFakeDb([
      () => [runRow],
      () => [
        {
          binding_id: "b1",
          node_path: "/n",
          property_key: "p",
          baseline_value: "<1>",
          debug_value: "<2>",
          sort_order: 0
        }
      ],
      () => [runRow],
      persist, // claim → deploying
      persist, // mount running
      persist // abort → failed
    ]);
    const objectStore: ObjectStore = {
      put: vi.fn(),
      get: vi.fn(async (key) => (key === "art-key" ? artifactBytes : Buffer.from("src"))),
      delete: vi.fn()
    };
    const bridgeRpcClient = {
      call: vi.fn(async (_id: string, method: string) => {
        if (method === "bridge.getCapabilities") {
          return { methods: [...DTS_RELOAD_BRIDGE_RPC_METHODS, "bridge.getCapabilities"] };
        }
        if (method === "debug.mountTarget") {
          throw new Error("bridge RPC timed out");
        }
        throw new Error(`unexpected ${method}`);
      })
    };

    const result = await deployReloadRun(
      db,
      objectStore,
      auth(),
      {
        runId: "run-1",
        deviceId: "dev-1",
        bridgeId: "br-1",
        targetRef: "AURORA-001",
        protocol: "hdc",
        confirmationTokens: [DTS_RELOAD_CONFIRMATION_TOKEN]
      },
      {
        bridgeRpcClient,
        bridgeConnectionPool: { isConnected: () => true }
      }
    );

    expect(result.status).toBe("failed");
    expect(result.failureCode).toBe("deploy-aborted");
    expect(result.steps.find((step) => step.step === "mount-target")).toMatchObject({
      outcome: "failed",
      error: "bridge RPC timed out"
    });
    expect(statuses).toEqual(["deploying", "deploying", "failed"]);
    expect(releaseDebugDeviceLease).toHaveBeenCalled();
  });

  async function runSuccessfulDeployThroughTrigger(
    bridgeRpcClient: { call: ReturnType<typeof vi.fn> },
    options: { debugBindingsByBindingId?: Record<string, unknown[]> } = {}
  ) {
    const artifactBytes = Buffer.from("dtbo");
    const artifactSha = createHash("sha256").update(artifactBytes).digest("hex");
    const runRow = validatedRunRow({ overlay_artifact_sha256: artifactSha, overlay_artifact_bytes: artifactBytes.length });
    const targetRows = [
      {
        binding_id: "b1",
        node_path: "/amba/i2c@1/node",
        property_key: "watchdog_time",
        baseline_value: "<6000>",
        debug_value: "<7000>",
        sort_order: 0
      }
    ];
    const { db } = createDeployDb({
      runRow,
      targetRows,
      debugBindingsByBindingId: options.debugBindingsByBindingId
    });
    const objectStore: ObjectStore = {
      put: vi.fn(),
      get: vi.fn(async (key) => (key === "art-key" ? artifactBytes : Buffer.from("src"))),
      delete: vi.fn()
    };
    return deployReloadRun(
      db,
      objectStore,
      auth(),
      {
        runId: "run-1",
        deviceId: "dev-1",
        bridgeId: "br-1",
        targetRef: "AURORA-001",
        protocol: "hdc",
        confirmationTokens: [DTS_RELOAD_CONFIRMATION_TOKEN]
      },
      {
        bridgeRpcClient,
        bridgeConnectionPool: { isConnected: () => true }
      }
    );
  }

  function debugBindingRow(overrides: Record<string, unknown> = {}) {
    return {
      debug_node_id: "dbg-node-1",
      node_path: "/sys/class/power_supply/battery/watchdog_time",
      access_mode: "RW",
      value_kind: "scalar",
      value_format: "raw",
      normalization_mode: "trim",
      max_value_bytes: null,
      value_shape: { kind: "cells", bits: 32, cellsPerGroup: 1, groups: 1 },
      ...overrides
    };
  }

  function successfulDeployRpcHandlers(
    readKernelLog: () => Record<string, unknown> | Promise<Record<string, unknown>>,
    readNode?: () => Record<string, unknown> | Promise<Record<string, unknown>>
  ) {
    const artifactSha = createHash("sha256").update("dtbo").digest("hex");
    return vi.fn(async (_bridgeId: string, method: string) => {
      if (method === "bridge.getCapabilities") {
        return {
          methods: [...DTS_RELOAD_BRIDGE_RPC_METHODS, "bridge.getCapabilities", "debug.readNode"]
        };
      }
      if (method === "debug.mountTarget") return { ok: true };
      if (method === "debug.pushFile") {
        return { ok: true, localDigest: artifactSha, remoteDigest: artifactSha, integrityCheck: "sha256" };
      }
      if (method === "debug.writeNode") return { ok: true, verified: true };
      if (method === "debug.readKernelLog") return readKernelLog();
      if (method === "debug.readNode") {
        if (!readNode) throw new Error("unexpected debug.readNode");
        return readNode();
      }
      throw new Error(`unexpected ${method}`);
    });
  }

  it("never interpolates parameter names into the kernel log bridge RPC params", async () => {
    const bridgeRpcClient = {
      call: successfulDeployRpcHandlers(() => ({
        ok: true,
        text: "kernel: watchdog_time applied\n",
        truncated: false
      }))
    };

    await runSuccessfulDeployThroughTrigger(bridgeRpcClient);

    const kernelCall = bridgeRpcClient.call.mock.calls.find((call) => call[1] === "debug.readKernelLog");
    expect(kernelCall).toBeDefined();
    const params = kernelCall![2] as Record<string, unknown>;
    expect(params).toEqual({
      protocol: "hdc",
      targetRef: "AURORA-001",
      command: "dmesg"
    });
    expect(JSON.stringify(params)).not.toContain("watchdog_time");
    expect(JSON.stringify(params)).not.toContain("b1");
  });

  it("does not derive run outcome from kernel log text that mentions errors", async () => {
    const bridgeRpcClient = {
      call: successfulDeployRpcHandlers(() => ({
        ok: true,
        text: "kernel: FATAL error failed overlay apply\n",
        truncated: false
      }))
    };

    const result = await runSuccessfulDeployThroughTrigger(bridgeRpcClient);

    expect(result.status).toBe("unverifiable");
    expect(result.failureCode).toBeNull();
    expect(result.reloadSnapshot?.kernelSignal?.captureStatus).toBe("obtained");
    expect(result.reloadSnapshot?.kernelSignal?.rawText).toContain("FATAL error");
  });

  it("keeps capture failure distinct from obtained-with-no-matching-lines and does not fail the run", async () => {
    const failedClient = {
      call: successfulDeployRpcHandlers(() => ({
        ok: false,
        error: "HDC exited with 1.",
        text: "",
        truncated: false
      }))
    };
    const noMatchClient = {
      call: successfulDeployRpcHandlers(() => ({
        ok: true,
        text: "kernel: boot complete without parameter names\n",
        truncated: false
      }))
    };

    const failed = await runSuccessfulDeployThroughTrigger(failedClient);
    const noMatch = await runSuccessfulDeployThroughTrigger(noMatchClient);

    expect(failed.status).toBe("unverifiable");
    expect(failed.reloadSnapshot?.kernelSignal).toMatchObject({
      captureStatus: "not-obtained",
      rawText: null,
      captureError: "HDC exited with 1."
    });

    expect(noMatch.status).toBe("unverifiable");
    expect(noMatch.reloadSnapshot?.kernelSignal).toMatchObject({
      captureStatus: "obtained",
      rawText: "kernel: boot complete without parameter names\n",
      captureError: null
    });
    expect(noMatch.reloadSnapshot?.kernelSignal?.matchedByParameter.every((group) => group.lines.length === 0)).toBe(
      true
    );
  });

  it("keeps verbatim kernel log text when the bridge reports ok:false with non-empty text", async () => {
    const logText = "[Fail] overlay reported\n[E123456] probe failed\nwatchdog_time applied\n";
    const bridgeRpcClient = {
      call: successfulDeployRpcHandlers(() => ({
        ok: false,
        error: "looked like a diagnostic",
        text: logText,
        truncated: false
      }))
    };

    const result = await runSuccessfulDeployThroughTrigger(bridgeRpcClient);

    expect(result.status).toBe("unverifiable");
    expect(result.reloadSnapshot?.kernelSignal).toMatchObject({
      captureStatus: "obtained",
      rawText: logText,
      captureError: null
    });
  });

  it("reads bound parameters through debug.readNode and reports behaviourally verified", async () => {
    const bridgeRpcClient = {
      call: successfulDeployRpcHandlers(
        () => ({ ok: true, text: "kernel: unrelated\n", truncated: false }),
        () => ({ ok: true, value: "7000\n" })
      )
    };

    const result = await runSuccessfulDeployThroughTrigger(bridgeRpcClient, {
      debugBindingsByBindingId: { b1: [debugBindingRow()] }
    });

    expect(result.status).toBe("verified");
    expect(result.reloadSnapshot?.behaviouralVerification?.outcomes).toEqual([
      expect.objectContaining({
        bindingId: "b1",
        outcome: "verified",
        readValue: "7000\n",
        nodePath: "/sys/class/power_supply/battery/watchdog_time"
      })
    ]);
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        kind: "dts-reload-run-verified",
        action: "verified",
        metadata: expect.objectContaining({
          behaviouralVerification: expect.objectContaining({
            outcomes: expect.arrayContaining([
              expect.objectContaining({ bindingId: "b1", outcome: "verified" })
            ])
          })
        })
      })
    );
    const readCall = bridgeRpcClient.call.mock.calls.find((call) => call[1] === "debug.readNode");
    expect(readCall).toEqual([
      "br-1",
      "debug.readNode",
      {
        protocol: "hdc",
        targetRef: "AURORA-001",
        nodePath: "/sys/class/power_supply/battery/watchdog_time",
        preserveExactRead: false
      },
      { timeoutMs: 10_000 }
    ]);
    expect(bridgeRpcClient.call.mock.calls.map((call) => call[1])).not.toContain("debug.verifyReload");
  });

  it("reports contradicted when the driver surface disagrees with the debug value", async () => {
    const bridgeRpcClient = {
      call: successfulDeployRpcHandlers(
        () => ({ ok: true, text: "", truncated: false }),
        () => ({ ok: true, value: "6000" })
      )
    };

    const result = await runSuccessfulDeployThroughTrigger(bridgeRpcClient, {
      debugBindingsByBindingId: { b1: [debugBindingRow()] }
    });

    expect(result.status).toBe("contradicted");
    expect(result.reloadSnapshot?.behaviouralVerification?.outcomes[0]).toMatchObject({
      outcome: "contradicted",
      readValue: "6000"
    });
  });

  it("degrades a bound parameter to read-failed without failing the whole run", async () => {
    const bridgeRpcClient = {
      call: successfulDeployRpcHandlers(
        () => ({ ok: true, text: "", truncated: false }),
        () => ({ ok: false, error: "permission denied" })
      )
    };

    const result = await runSuccessfulDeployThroughTrigger(bridgeRpcClient, {
      debugBindingsByBindingId: { b1: [debugBindingRow()] }
    });

    expect(result.status).toBe("unverifiable");
    expect(result.failureCode).toBeNull();
    expect(result.reloadSnapshot?.behaviouralVerification?.outcomes[0]).toMatchObject({
      outcome: "read-failed",
      reason: "permission denied"
    });
  });
});
