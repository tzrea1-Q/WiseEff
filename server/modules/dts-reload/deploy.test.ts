import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/types";
import type { ObjectStore } from "../logs/objectStore";
import { DTS_RELOAD_BRIDGE_RPC_METHODS } from "@wiseeff/device-command-core/bridgeRpcMethods";

vi.mock("../audit/repository", () => ({
  createAuditEvent: vi.fn(async () => undefined)
}));

vi.mock("../deviceBridge/repository", () => ({
  listBridgesForUser: vi.fn()
}));

vi.mock("../debugging/repository", () => ({
  acquireDebugDeviceLease: vi.fn(),
  releaseDebugDeviceLease: vi.fn(),
  ensureBridgeDebugDevice: vi.fn(async () => undefined),
  ensureDtsReloadLeaseSession: vi.fn(async () => undefined)
}));

vi.mock("./behaviouralVerify", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./behaviouralVerify")>();
  return {
    ...actual,
    verifyReloadTargetsBehaviourally: vi.fn(actual.verifyReloadTargetsBehaviourally)
  };
});

import { createAuditEvent } from "../audit/repository";
import { listBridgesForUser } from "../deviceBridge/repository";
import {
  acquireDebugDeviceLease,
  ensureBridgeDebugDevice,
  ensureDtsReloadLeaseSession,
  releaseDebugDeviceLease
} from "../debugging/repository";
import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import { verifyReloadTargetsBehaviourally } from "./behaviouralVerify";
import { insertReloadRun, insertReloadRunTarget } from "./repository";
import { deployReloadRun, getReloadResidue, getReloadRun } from "./service";
import { bridgeCanonicalDeviceId, computeReloadLeaseTtlMs } from "./deploy";
import {
  DTS_RELOAD_CONFIRMATION_TOKEN,
  RELOAD_ARTIFACT_RETENTION_DAYS,
  TRIGGER_RELOAD_UNCONFIRMED_FAILURE_CODE,
  type ReloadRunPurpose,
  type ReloadRunStatus
} from "./types";

const databaseAvailable = await isTestDatabaseAvailable();

const ARTIFACT = Buffer.from("dtbo");
const ARTIFACT_SHA = createHash("sha256").update(ARTIFACT).digest("hex");
const SOURCE_DTS = Buffer.from("/dts-v1/;\n/plugin/;\n");
const CANONICAL_DEVICE_ID = "bridge:br-1";

describe("reload deploy helpers", () => {
  it("derives the canonical device id from the bridge id", () => {
    expect(bridgeCanonicalDeviceId("br-1")).toBe("bridge:br-1");
  });

  it("scales the device lease ttl with target count and never drops below five minutes", () => {
    const timeouts = {
      mountTimeoutMs: 15_000,
      pushFileTimeoutMs: 30_000,
      triggerTimeoutMs: 10_000,
      kernelLogTimeoutMs: 10_000,
      readNodeTimeoutMs: 10_000
    };
    expect(computeReloadLeaseTtlMs({ targetCount: 1, ...timeouts })).toBe(5 * 60 * 1000);
    // 50 targets → 15+30+10+10 + 50*10 + 60s buffer = 625s, above the 5-minute floor.
    const many = computeReloadLeaseTtlMs({ targetCount: 50, ...timeouts });
    expect(many).toBe(15_000 + 30_000 + 10_000 + 10_000 + 50 * 10_000 + 60_000);
    expect(many).toBeGreaterThan(5 * 60 * 1000);
  });
});

describe.skipIf(!databaseAvailable)("deployReloadRun", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
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
      deviceId: CANONICAL_DEVICE_ID,
      sessionId: "dts-reload:run-1",
      leaseOwnerUserId: "user-1",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      acquiredAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    vi.mocked(releaseDebugDeviceLease).mockResolvedValue(null);
    db = await createInMemoryTestDatabase();
    await seedCoreGraph(db, {
      organization: { id: "org-1", name: "ChargeLab" },
      users: [{ id: "user-1", name: "Riley", email: "r@example.com" }],
      projects: [{ id: "project-1" }]
    });
  });

  afterEach(async () => {
    await db?.rollback();
  });

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
      organization: { id: "org-1", name: "ChargeLab" },
      roles: [{ projectId: "project-1", roleId: "hardware-committer" }],
      permissions: ["debugging:dts-reload"],
      ...overrides
    };
  }

  function makeObjectStore() {
    const files = new Map<string, Buffer>([
      ["src-key", SOURCE_DTS],
      ["art-key", ARTIFACT]
    ]);
    const objectStore: ObjectStore = {
      put: vi.fn(async () => {
        throw new Error("deploy must not write overlay blobs");
      }),
      get: vi.fn(async (key) => {
        const bytes = files.get(key);
        if (!bytes) throw new Error(`missing ${key}`);
        return bytes;
      }),
      delete: vi.fn()
    };
    return objectStore;
  }

  /**
   * Seed the parameter-library graph behind one reload candidate binding
   * (module → spec → spec version → dts property spec → logical node → binding → revision).
   */
  async function seedCandidate(input: {
    bindingId: string;
    propertyKey?: string;
    nodePath?: string | null;
    compatible?: string | null;
    baselineValue?: string | null;
  }) {
    const propertyKey = input.propertyKey ?? "watchdog_time";
    const nodePath = input.nodePath === undefined ? "/amba/i2c@1/node" : input.nodePath;

    await db.query(
      `insert into parameter_modules (id, organization_id, name, path)
       values ('mod-charger', 'org-1', 'charger', '/charger')
       on conflict (id) do nothing`
    );
    await db.query(
      `insert into dts_config_set (id, organization_id, project_id, name)
       values ('cs-1', 'org-1', 'project-1', 'primary') on conflict (id) do nothing`
    );
    await db.query(
      `insert into dts_config_revisions (id, organization_id, project_id, config_set_id, revision_number, status)
       select 'rev-1', 'org-1', 'project-1', 'cs-1',
              coalesce((select max(revision_number) from dts_config_revisions where config_set_id = 'cs-1'), 0) + 1,
              'compiled'
       where not exists (select 1 from dts_config_revisions where id = 'rev-1')`
    );
    await db.query(
      `insert into parameter_specs (id, organization_id, source_kind, specification_key)
       values ($1, 'org-1', 'dts', $2)`,
      [`spec-${input.bindingId}`, `reload/${input.bindingId}/${propertyKey}`]
    );
    await db.query(
      `insert into parameter_spec_versions (
         id, parameter_spec_id, version, display_name, description, documentation, value_shape, units, lifecycle
       ) values ($1, $2, 1, 'Watchdog', '', 'Watchdog timeout for charger safety.', $3::jsonb, 'ms', 'active')`,
      [
        `psv-${input.bindingId}`,
        `spec-${input.bindingId}`,
        JSON.stringify({ kind: "cells", bits: 32, cellsPerGroup: 1, groups: 1 })
      ]
    );
    await db.query(
      `insert into dts_property_specs (id, parameter_spec_id, property_key, schema_namespace, constraints)
       values ($1, $2, $3, 'reload-test', $4::jsonb)`,
      [
        `dps-${input.bindingId}`,
        `spec-${input.bindingId}`,
        propertyKey,
        JSON.stringify({ min: 0, max: 20000, cells: 1 })
      ]
    );
    if (nodePath !== null) {
      await db.query(
        `insert into dts_logical_nodes (id, organization_id, project_id, config_set_id)
         values ($1, 'org-1', 'project-1', 'cs-1')`,
        [`node-${input.bindingId}`]
      );
      await db.query(
        `insert into dts_logical_node_revisions (id, logical_node_id, config_revision_id, node_locator, name, compatible)
         values ($1, $2, 'rev-1', $3, $4, $5)`,
        [
          `lnr-${input.bindingId}`,
          `node-${input.bindingId}`,
          nodePath,
          nodePath.split("/").filter(Boolean).at(-1) ?? "node",
          input.compatible === undefined ? "sc8562" : input.compatible
        ]
      );
    }
    await db.query(
      `insert into project_parameter_bindings (id, organization_id, project_id, logical_node_id, parameter_spec_id, module_id)
       values ($1, 'org-1', 'project-1', $2, $3, 'mod-charger')`,
      [input.bindingId, nodePath === null ? null : `node-${input.bindingId}`, `spec-${input.bindingId}`]
    );
    await db.query(
      `insert into project_parameter_binding_revisions (
         id, binding_id, config_revision_id, parameter_spec_version_id, typed_value, raw_value
       ) values ($1, $2, 'rev-1', $3, '{}'::jsonb, $4)`,
      [
        `bpr-${input.bindingId}`,
        input.bindingId,
        `psv-${input.bindingId}`,
        input.baselineValue === undefined ? "<6000>" : input.baselineValue
      ]
    );
  }

  async function seedValidatedRun(input: {
    id?: string;
    bindingId?: string;
    nodePath?: string;
    purpose?: ReloadRunPurpose;
    deviceId?: string | null;
    restoresSourceRunId?: string | null;
    status?: ReloadRunStatus;
    completedAt?: string | null;
  } = {}) {
    const id = input.id ?? "run-1";
    const bindingId = input.bindingId ?? "binding-1";
    const nodePath = input.nodePath ?? "/amba/i2c@1/node";
    await seedCandidate({ bindingId, nodePath });
    await insertReloadRun(db, {
      id,
      organizationId: "org-1",
      projectId: "project-1",
      configRevisionId: "rev-1",
      status: input.status ?? "validated",
      purpose: input.purpose ?? "ordinary",
      deviceId: input.deviceId ?? null,
      restoresSourceRunId: input.restoresSourceRunId ?? null,
      failureCode: null,
      steps: [
        { step: "compile-base", outcome: "passed" },
        { step: "compile-overlay", outcome: "passed" },
        { step: "dry-run-merge", outcome: "passed" },
        { step: "assert-effect", outcome: "passed" }
      ],
      diagnostics: [],
      toolVersions: { dtc: "1.0", fdtoverlay: "1.0" },
      overlaySourceStorageKey: "src-key",
      overlaySourceSha256: "src-sha",
      overlayArtifactStorageKey: "art-key",
      overlayArtifactSha256: ARTIFACT_SHA,
      overlayArtifactBytes: ARTIFACT.length,
      createdByUserId: "user-1",
      completedAt: input.completedAt === undefined ? new Date().toISOString() : input.completedAt
    });
    await insertReloadRunTarget(db, {
      id: `target-${id}`,
      reloadRunId: id,
      bindingId,
      nodePath,
      propertyKey: "watchdog_time",
      baselineValue: "<6000>",
      debugValue: "<7000>",
      sortOrder: 0
    });
  }

  function deployInput(
    overrides: Partial<{
      runId: string;
      deviceId: string;
      bridgeId: string;
      targetRef: string;
      protocol: "hdc" | "adb";
      confirmationTokens: string[];
    }> = {}
  ) {
    return {
      runId: "run-1",
      deviceId: "client-supplied-device",
      bridgeId: "br-1",
      targetRef: "AURORA-001",
      protocol: "hdc" as const,
      confirmationTokens: [DTS_RELOAD_CONFIRMATION_TOKEN],
      ...overrides
    };
  }

  function rpcCall(
    handlers: Record<string, () => unknown | Promise<unknown>> = {}
  ): { call: ReturnType<typeof vi.fn> } {
    return {
      call: vi.fn(async (_bridgeId: string, method: string) => {
        if (handlers[method]) return handlers[method]();
        if (method === "bridge.getCapabilities") {
          return {
            methods: [...DTS_RELOAD_BRIDGE_RPC_METHODS, "bridge.getCapabilities", "debug.readNode"]
          };
        }
        if (method === "debug.mountTarget") return { ok: true };
        if (method === "debug.pushFile") {
          return {
            ok: true,
            localDigest: ARTIFACT_SHA,
            remoteDigest: ARTIFACT_SHA,
            integrityCheck: "sha256"
          };
        }
        if (method === "debug.writeNode") return { ok: true, verified: true };
        if (method === "debug.readKernelLog") {
          return {
            ok: true,
            text: "kernel: watchdog_time applied\nkernel: overlay reload ok\n",
            truncated: false
          };
        }
        throw new Error(`unexpected ${method}`);
      })
    };
  }

  async function deploy(
    bridgeRpcClient: { call: ReturnType<typeof vi.fn> },
    input = deployInput()
  ) {
    return deployReloadRun(db, makeObjectStore(), auth(), input, {
      bridgeRpcClient,
      bridgeConnectionPool: { isConnected: () => true }
    });
  }

  describe("refusals before a device write", () => {
    it("refuses an agent actor for deploy and audits the refusal", async () => {
      await seedValidatedRun();
      const bridgeRpcClient = rpcCall();

      await expect(
        deployReloadRun(db, makeObjectStore(), auth(), deployInput(), {
          bridgeRpcClient,
          bridgeConnectionPool: { isConnected: () => true }
        }, { actorType: "agent" })
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        details: {
          code: "dts-reload-agent-refused",
          reason: "agent-refused",
          requireHuman: true,
          action: "deploy"
        }
      });
      expect(bridgeRpcClient.call).not.toHaveBeenCalled();
      expect(createAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          actorType: "agent",
          kind: "dts-reload-agent-refused",
          action: "deny"
        })
      );
      const stored = await getReloadRun(db, makeObjectStore(), auth(), "run-1");
      expect(stored.status).toBe("validated");
    });

    it("refuses deploy when confirm-dts-reload is missing and never invents the token", async () => {
      await seedValidatedRun();
      const bridgeRpcClient = rpcCall();

      await expect(
        deploy(bridgeRpcClient, deployInput({ confirmationTokens: ["confirm-sensitive-reload"] }))
      ).rejects.toMatchObject({
        details: { code: "missing-dts-reload-confirmation" }
      });
      expect(bridgeRpcClient.call).not.toHaveBeenCalled();
      expect(
        vi.mocked(createAuditEvent).mock.calls.some((call) => {
          const metadata = call[1].metadata as Record<string, unknown>;
          return (
            metadata?.confirmationToken === DTS_RELOAD_CONFIRMATION_TOKEN &&
            call[1].kind === "dts-reload-run-deploy-started"
          );
        })
      ).toBe(false);
    });

    it("refuses deploy of an overlay artifact past its retention window before touching the bridge", async () => {
      const expiredAt = new Date(
        Date.now() - (RELOAD_ARTIFACT_RETENTION_DAYS + 10) * 24 * 60 * 60 * 1000
      ).toISOString();
      await seedValidatedRun({ completedAt: expiredAt });
      await db.query("update dts_reload_runs set created_at = $2 where id = $1", ["run-1", expiredAt]);
      const bridgeRpcClient = rpcCall();

      await expect(deploy(bridgeRpcClient)).rejects.toMatchObject({
        details: { code: "reload-artifact-expired" }
      });
      expect(bridgeRpcClient.call).not.toHaveBeenCalled();
    });

    it("refuses restore-baseline deploy when the request device differs from the pinned start device", async () => {
      await seedValidatedRun({
        id: "run-residue",
        status: "verified",
        deviceId: "bridge:lab-1"
      });
      await insertReloadRun(db, {
        id: "run-1",
        organizationId: "org-1",
        projectId: "project-1",
        configRevisionId: "rev-1",
        status: "validated",
        purpose: "restore-baseline",
        deviceId: "bridge:lab-1",
        restoresSourceRunId: "run-residue",
        failureCode: null,
        steps: [
          { step: "compile-base", outcome: "passed" },
          { step: "compile-overlay", outcome: "passed" },
          { step: "dry-run-merge", outcome: "passed" },
          { step: "assert-effect", outcome: "passed" }
        ],
        diagnostics: [],
        toolVersions: { dtc: "1.0", fdtoverlay: "1.0" },
        overlaySourceStorageKey: "src-key",
        overlaySourceSha256: "src-sha",
        overlayArtifactStorageKey: "art-key",
        overlayArtifactSha256: ARTIFACT_SHA,
        overlayArtifactBytes: ARTIFACT.length,
        createdByUserId: "user-1",
        completedAt: new Date().toISOString()
      });
      await insertReloadRunTarget(db, {
        id: "target-run-1",
        reloadRunId: "run-1",
        bindingId: "binding-1",
        nodePath: "/amba/i2c@1/node",
        propertyKey: "watchdog_time",
        baselineValue: "<6000>",
        debugValue: "<6000>",
        sortOrder: 0
      });
      const bridgeRpcClient = rpcCall();

      await expect(deploy(bridgeRpcClient)).rejects.toMatchObject({
        details: { code: "restore-device-mismatch", pinnedDeviceId: "bridge:lab-1" }
      });
      expect(bridgeRpcClient.call).not.toHaveBeenCalled();
    });

    it("re-runs the sensitive-node gate at deploy so a deployer lacking capability is refused", async () => {
      await seedValidatedRun({ nodePath: "/soc/fuel-gauge@0" });
      await db.query(
        `insert into dts_sensitive_node_rules (
           id, organization_id, project_id, match_type, pattern, risk_tier, required_capability, enabled
         ) values ('rule-1', 'org-1', null, 'path', '/soc/fuel-gauge@0', 'high', 'parameter:edit-critical', true)`
      );
      const bridgeRpcClient = rpcCall();

      await expect(deploy(bridgeRpcClient)).rejects.toMatchObject({
        details: { code: "sensitive-node-reload-denied", reason: "missing-capability" }
      });
      expect(bridgeRpcClient.call).not.toHaveBeenCalled();
    });

    it("refuses when the bridge lacks deploy RPC methods and points at releases", async () => {
      await seedValidatedRun();
      const bridgeRpcClient = {
        call: vi.fn(async () => ({ methods: ["bridge.getCapabilities", "debug.writeNode"] }))
      };

      await expect(deploy(bridgeRpcClient)).rejects.toMatchObject({
        details: {
          code: "bridge-upgrade-required",
          releasesPath: "/api/v1/device-bridges/releases"
        }
      });
      const stored = await getReloadRun(db, makeObjectStore(), auth(), "run-1");
      expect(stored.status).toBe("validated");
    });
  });

  describe("claim, lease, and canonical device identity", () => {
    it("atomically refuses a second deploy claim on the same run and never acquires a second lease", async () => {
      await seedValidatedRun();
      let waiting = 0;
      let releaseBarrier: (() => void) | undefined;
      const bothAtCapabilities = new Promise<void>((resolve) => {
        releaseBarrier = resolve;
      });
      const bridgeRpcClient = rpcCall({
        "bridge.getCapabilities": async () => {
          waiting += 1;
          if (waiting >= 2) releaseBarrier?.();
          await bothAtCapabilities;
          return {
            methods: [...DTS_RELOAD_BRIDGE_RPC_METHODS, "bridge.getCapabilities"]
          };
        },
        "debug.mountTarget": () => ({ ok: false, error: "mount denied" })
      });

      const results = await Promise.allSettled([deploy(bridgeRpcClient), deploy(bridgeRpcClient)]);
      const fulfilled = results.filter((entry) => entry.status === "fulfilled");
      const rejected = results.filter((entry) => entry.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      if (fulfilled[0]?.status !== "fulfilled" || rejected[0]?.status !== "rejected") {
        throw new Error("expected one winner and one claim conflict");
      }
      expect(fulfilled[0].value.failureCode).toBe("mount-target-failed");
      expect(rejected[0].reason).toMatchObject({
        details: { code: "reload-deploy-already-in-progress" }
      });
      expect(acquireDebugDeviceLease).toHaveBeenCalledTimes(1);
      const stored = await getReloadRun(db, makeObjectStore(), auth(), "run-1");
      expect(stored.status).toBe("failed");
      expect(stored.failureCode).toBe("mount-target-failed");
    });

    it("drives the run to a terminal state when device/lease setup throws after claim", async () => {
      await seedValidatedRun();
      vi.mocked(ensureDtsReloadLeaseSession).mockRejectedValueOnce(
        new Error("debugging_targets FK violation")
      );
      const bridgeRpcClient = rpcCall();

      const result = await deploy(bridgeRpcClient);
      expect(result.status).toBe("failed");
      expect(result.failureCode).toBe("deploy-aborted");
      expect(acquireDebugDeviceLease).not.toHaveBeenCalled();
      expect(releaseDebugDeviceLease).not.toHaveBeenCalled();
      expect(bridgeRpcClient.call.mock.calls.some((call) => call[1] === "debug.mountTarget")).toBe(
        false
      );
      const stored = await getReloadRun(db, makeObjectStore(), auth(), "run-1");
      expect(stored.status).toBe("failed");
      expect(stored.failureCode).toBe("deploy-aborted");
    });
  });

  describe("device steps", () => {
    it("mounts, transfers, triggers, and finishes as unverifiable with a persisted reload snapshot", async () => {
      await seedValidatedRun();
      const bridgeRpcClient = rpcCall();

      const result = await deploy(bridgeRpcClient);

      expect(result.status).toBe("unverifiable");
      expect(result.failureCode).toBeNull();
      expect(result.deviceId).toBe(CANONICAL_DEVICE_ID);
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
            bindingId: "binding-1",
            lines: ["kernel: watchdog_time applied"]
          }
        ]
      });
      expect(result.reloadSnapshot?.behaviouralVerification?.outcomes).toEqual([
        expect.objectContaining({
          bindingId: "binding-1",
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
          contentSha256: ARTIFACT_SHA
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
      const kernelCall = bridgeRpcClient.call.mock.calls.find((call) => call[1] === "debug.readKernelLog");
      expect(kernelCall?.[2]).toEqual({
        protocol: "hdc",
        targetRef: "AURORA-001",
        command: "dmesg"
      });
      expect(JSON.stringify(kernelCall?.[2])).not.toContain("watchdog_time");
      expect(JSON.stringify(kernelCall?.[2])).not.toContain("binding-1");
      expect(bridgeRpcClient.call.mock.calls.some((call) => call[1] === "debug.readNode")).toBe(false);
      expect(ensureBridgeDebugDevice).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ deviceId: CANONICAL_DEVICE_ID, protocol: "hdc" })
      );
      expect(acquireDebugDeviceLease).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ deviceId: CANONICAL_DEVICE_ID, sessionId: "dts-reload:run-1" })
      );
      expect(releaseDebugDeviceLease).toHaveBeenCalled();

      const stored = await getReloadRun(db, makeObjectStore(), auth(), "run-1");
      expect(stored.status).toBe("unverifiable");
      expect(stored.deviceId).toBe(CANONICAL_DEVICE_ID);
      expect(stored.reloadSnapshot?.kernelSignal?.captureStatus).toBe("obtained");
    });

    it("reports mount failure distinctly from transfer failure and persists it", async () => {
      await seedValidatedRun();
      const result = await deploy(
        rpcCall({
          "debug.mountTarget": () => ({ ok: false, error: "mount denied" })
        })
      );

      expect(result.status).toBe("failed");
      expect(result.failureCode).toBe("mount-target-failed");
      expect(result.steps.find((step) => step.step === "mount-target")?.outcome).toBe("failed");
      const stored = await getReloadRun(db, makeObjectStore(), auth(), "run-1");
      expect(stored.status).toBe("failed");
      expect(stored.failureCode).toBe("mount-target-failed");
    });

    it("marks the run failed when bridge RPC throws after claim so it is not stuck deploying", async () => {
      await seedValidatedRun();
      const result = await deploy(
        rpcCall({
          "debug.mountTarget": () => {
            throw new Error("bridge RPC timed out");
          }
        })
      );

      expect(result.status).toBe("failed");
      expect(result.failureCode).toBe("deploy-aborted");
      expect(result.steps.find((step) => step.step === "mount-target")).toMatchObject({
        outcome: "failed",
        error: "bridge RPC timed out"
      });
      expect(releaseDebugDeviceLease).toHaveBeenCalled();
      const stored = await getReloadRun(db, makeObjectStore(), auth(), "run-1");
      expect(stored.status).toBe("failed");
      expect(stored.failureCode).toBe("deploy-aborted");
    });

    it("does not derive run outcome from kernel log text that mentions errors", async () => {
      await seedValidatedRun();
      const result = await deploy(
        rpcCall({
          "debug.readKernelLog": () => ({
            ok: true,
            text: "kernel: FATAL error failed overlay apply\n",
            truncated: false
          })
        })
      );

      expect(result.status).toBe("unverifiable");
      expect(result.failureCode).toBeNull();
      expect(result.reloadSnapshot?.kernelSignal?.captureStatus).toBe("obtained");
      expect(result.reloadSnapshot?.kernelSignal?.rawText).toContain("FATAL error");
    });

    it("keeps kernel-log capture failure as not-obtained without failing the run", async () => {
      await seedValidatedRun();
      const failed = await deploy(
        rpcCall({
          "debug.readKernelLog": () => ({
            ok: false,
            error: "HDC exited with 1.",
            text: "",
            truncated: false
          })
        })
      );
      expect(failed.status).toBe("unverifiable");
      expect(failed.reloadSnapshot?.kernelSignal).toMatchObject({
        captureStatus: "not-obtained",
        rawText: null,
        captureError: "HDC exited with 1."
      });
    });

    it("keeps obtained kernel log with no matching lines distinct from capture failure", async () => {
      await seedValidatedRun();
      const noMatch = await deploy(
        rpcCall({
          "debug.readKernelLog": () => ({
            ok: true,
            text: "kernel: boot complete without parameter names\n",
            truncated: false
          })
        })
      );
      expect(noMatch.status).toBe("unverifiable");
      expect(noMatch.reloadSnapshot?.kernelSignal).toMatchObject({
        captureStatus: "obtained",
        rawText: "kernel: boot complete without parameter names\n",
        captureError: null
      });
      expect(
        noMatch.reloadSnapshot?.kernelSignal?.matchedByParameter.every((group) => group.lines.length === 0)
      ).toBe(true);
    });

    it("keeps verbatim kernel log text when the bridge reports ok:false with non-empty text", async () => {
      await seedValidatedRun();
      const logText = "[Fail] overlay reported\n[E123456] probe failed\nwatchdog_time applied\n";
      const result = await deploy(
        rpcCall({
          "debug.readKernelLog": () => ({
            ok: false,
            error: "looked like a diagnostic",
            text: logText,
            truncated: false
          })
        })
      );

      expect(result.status).toBe("unverifiable");
      expect(result.reloadSnapshot?.kernelSignal).toMatchObject({
        captureStatus: "obtained",
        rawText: logText,
        captureError: null
      });
    });

    it("captures kernel log evidence even when the trigger write fails", async () => {
      await seedValidatedRun();
      const bridgeRpcClient = rpcCall({
        "debug.writeNode": () => ({ ok: false, error: "sh: permission denied" }),
        "debug.readKernelLog": () => ({
          ok: true,
          text: "kernel: dts_overlay trigger write rejected\n",
          truncated: false
        })
      });

      const result = await deploy(bridgeRpcClient);
      expect(result.status).toBe("failed");
      expect(result.failureCode).toBe("trigger-reload-failed");
      expect(result.reloadSnapshot?.kernelSignal).toMatchObject({
        command: "dmesg",
        captureStatus: "obtained",
        rawText: "kernel: dts_overlay trigger write rejected\n"
      });
      expect(bridgeRpcClient.call.mock.calls.some((call) => call[1] === "debug.readKernelLog")).toBe(true);
      expect(bridgeRpcClient.call.mock.calls.some((call) => call[1] === "debug.readNode")).toBe(false);
    });

    it("records residue and captures the kernel log when the trigger write does not confirm", async () => {
      await seedValidatedRun();
      const bridgeRpcClient = rpcCall({
        "debug.writeNode": () => {
          throw new Error("bridge socket closed mid-write");
        },
        "debug.readKernelLog": () => ({
          ok: true,
          text: "kernel: overlay trigger unacked\n",
          truncated: false
        })
      });

      const result = await deploy(bridgeRpcClient);
      expect(result.status).toBe("failed");
      expect(result.failureCode).toBe(TRIGGER_RELOAD_UNCONFIRMED_FAILURE_CODE);
      expect(result.reloadSnapshot?.kernelSignal).toMatchObject({ captureStatus: "obtained" });
      expect(result.reloadSnapshot?.kernelSignal?.rawText).toContain("overlay trigger unacked");
      expect(bridgeRpcClient.call.mock.calls.some((call) => call[1] === "debug.readNode")).toBe(false);

      const residue = await getReloadResidue(db, auth(), CANONICAL_DEVICE_ID);
      expect(residue).toMatchObject({
        deviceId: CANONICAL_DEVICE_ID,
        projectId: "project-1",
        sourceRunId: "run-1"
      });
      expect(residue?.parameters).toEqual([
        expect.objectContaining({
          bindingId: "binding-1",
          propertyKey: "watchdog_time",
          debugValue: "<7000>"
        })
      ]);
    });
  });

  describe("behavioural verification mapping", () => {
    it("maps a verified behavioural result onto the run and audit", async () => {
      await seedValidatedRun();
      vi.mocked(verifyReloadTargetsBehaviourally).mockResolvedValueOnce({
        status: "verified",
        behaviouralVerification: {
          outcomes: [
            {
              bindingId: "binding-1",
              propertyKey: "watchdog_time",
              outcome: "verified",
              debugNodeId: "dbg-node-1",
              nodePath: "/sys/class/power_supply/battery/watchdog_time",
              expectedValue: "<7000>",
              readValue: "7000\n",
              reason: null
            }
          ]
        }
      });

      const result = await deploy(rpcCall());
      expect(result.status).toBe("verified");
      expect(result.reloadSnapshot?.behaviouralVerification?.outcomes[0]).toMatchObject({
        outcome: "verified",
        readValue: "7000\n"
      });
      expect(createAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          kind: "dts-reload-run-verified",
          action: "verified"
        })
      );
      const stored = await getReloadRun(db, makeObjectStore(), auth(), "run-1");
      expect(stored.status).toBe("verified");
    });

    it("reports contradicted when behavioural verification disagrees with the debug value", async () => {
      await seedValidatedRun();
      vi.mocked(verifyReloadTargetsBehaviourally).mockResolvedValueOnce({
        status: "contradicted",
        behaviouralVerification: {
          outcomes: [
            {
              bindingId: "binding-1",
              propertyKey: "watchdog_time",
              outcome: "contradicted",
              debugNodeId: "dbg-node-1",
              nodePath: "/sys/class/power_supply/battery/watchdog_time",
              expectedValue: "<7000>",
              readValue: "6000",
              reason: null
            }
          ]
        }
      });

      const result = await deploy(rpcCall());
      expect(result.status).toBe("contradicted");
      expect(result.reloadSnapshot?.behaviouralVerification?.outcomes[0]).toMatchObject({
        outcome: "contradicted",
        readValue: "6000"
      });
    });

    it("degrades a bound parameter to read-failed without failing the whole run", async () => {
      await seedValidatedRun();
      vi.mocked(verifyReloadTargetsBehaviourally).mockResolvedValueOnce({
        status: "unverifiable",
        behaviouralVerification: {
          outcomes: [
            {
              bindingId: "binding-1",
              propertyKey: "watchdog_time",
              outcome: "read-failed",
              debugNodeId: "dbg-node-1",
              nodePath: "/sys/class/power_supply/battery/watchdog_time",
              expectedValue: "<7000>",
              readValue: null,
              reason: "permission denied"
            }
          ]
        }
      });

      const result = await deploy(rpcCall());
      expect(result.status).toBe("unverifiable");
      expect(result.failureCode).toBeNull();
      expect(result.reloadSnapshot?.behaviouralVerification?.outcomes[0]).toMatchObject({
        outcome: "read-failed",
        reason: "permission denied"
      });
    });

    it("keeps the run unverifiable when behavioural verification throws after a successful trigger", async () => {
      await seedValidatedRun();
      vi.mocked(verifyReloadTargetsBehaviourally).mockRejectedValueOnce(new Error("resolver exploded"));

      const result = await deploy(rpcCall());
      expect(result.status).toBe("unverifiable");
      expect(result.failureCode).toBeNull();
      expect(result.reloadSnapshot?.behaviouralVerification?.outcomes[0]).toMatchObject({
        outcome: "read-failed",
        reason: "resolver exploded"
      });
    });
  });
});
