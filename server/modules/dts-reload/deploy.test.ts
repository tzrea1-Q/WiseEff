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

    const updates: Array<Record<string, unknown>> = [];
    const { db } = createFakeDb([
      // getReloadRun
      () => [runRow],
      () => targetRows,
      // artifact key lookup
      () => [runRow],
      // persistProgress updates
      (call) => {
        updates.push({ text: call.text, values: call.values });
        return [{ ...runRow, status: call.values[2], steps: JSON.parse(String(call.values[4])), reload_snapshot: JSON.parse(String(call.values[11])), integrity_check: call.values[10], completed_at: call.values[12], device_id: call.values[5], bridge_id: call.values[6], bridge_machine_label: call.values[7], target_ref: call.values[8], protocol: call.values[9], failure_code: call.values[3] }];
      },
      (call) => {
        updates.push({ text: call.text, values: call.values });
        return [{ ...runRow, status: call.values[2], steps: JSON.parse(String(call.values[4])), reload_snapshot: JSON.parse(String(call.values[11])), integrity_check: call.values[10], completed_at: call.values[12], device_id: call.values[5], bridge_id: call.values[6], bridge_machine_label: call.values[7], target_ref: call.values[8], protocol: call.values[9], failure_code: call.values[3] }];
      },
      (call) => {
        updates.push({ text: call.text, values: call.values });
        return [{ ...runRow, status: call.values[2], steps: JSON.parse(String(call.values[4])), reload_snapshot: JSON.parse(String(call.values[11])), integrity_check: call.values[10], completed_at: call.values[12], device_id: call.values[5], bridge_id: call.values[6], bridge_machine_label: call.values[7], target_ref: call.values[8], protocol: call.values[9], failure_code: call.values[3] }];
      },
      (call) => {
        updates.push({ text: call.text, values: call.values });
        return [{ ...runRow, status: call.values[2], steps: JSON.parse(String(call.values[4])), reload_snapshot: JSON.parse(String(call.values[11])), integrity_check: call.values[10], completed_at: call.values[12], device_id: call.values[5], bridge_id: call.values[6], bridge_machine_label: call.values[7], target_ref: call.values[8], protocol: call.values[9], failure_code: call.values[3] }];
      },
      (call) => {
        updates.push({ text: call.text, values: call.values });
        return [{ ...runRow, status: call.values[2], steps: JSON.parse(String(call.values[4])), reload_snapshot: JSON.parse(String(call.values[11])), integrity_check: call.values[10], completed_at: call.values[12], device_id: call.values[5], bridge_id: call.values[6], bridge_machine_label: call.values[7], target_ref: call.values[8], protocol: call.values[9], failure_code: call.values[3] }];
      }
    ]);

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
    expect(result.reloadSnapshot?.kernelSignal).toBeNull();
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
});
