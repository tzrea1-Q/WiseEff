/**
 * Mock DebuggingGateway adapter — restores ADR-0002 for `/node-debugging`: mock mode
 * serves the same node-debugging port instead of the retired raw `/api/hdc/*` fetch
 * fallback (`src/hdcClient.ts`), which needed a real local device to show anything.
 *
 * Like `mockDtsReloadRepository`, the mock owns one seeded device story: a paired
 * "Mock Bridge" exposes a single multi-protocol Aurora device, and the device-side
 * node values start from the debug-parameter catalog with a few plausible drifts
 * (a previous debug session already applied some targets, one live reading drifted).
 * It is stateful and honest about the operation lifecycle: reads serve the device
 * value, writes persist it and read back for verification, successful RW writes
 * capture a rollback snapshot, and `rollbackSnapshot` restores the pre-write values.
 * It also enforces the same tokens the server enforces (`confirm-high-risk-write`
 * for High-risk writes, `confirm-rollback` for snapshot rollback).
 */

import type {
  DebugDeviceSnapshot,
  DebuggingGateway,
  DebugSessionSnapshot,
  DebugSnapshotSummary,
  DetectTargetsInput,
  DeviceTarget,
  NodeOperationSnapshot,
  NodeReadResult,
  NodeWriteResult,
  ReadNodeInput,
  RollbackSnapshotInput,
  WriteNodeInput
} from "@/application/ports/DebuggingGateway";
import type { LocalBridgeProbeResult } from "@/infrastructure/http/bridgeConnectLauncher";
import type { DeviceBridgePairingCode, DeviceBridgeRecord } from "@/infrastructure/http/deviceBridgeClient";
import { buildValuePreview } from "@/debugValueKind";
import type { DebugConnectionProtocol, DebugParameter } from "@/domain/debugging/types";
import { bundledPowerManagementConfig, flattenDebugParameters } from "@/powerManagementConfig";
import { mockApiError } from "./mockApiError";

export const MOCK_DEBUG_BRIDGE_ID = "mock-bridge";
export const MOCK_DEBUG_BRIDGE_MACHINE_LABEL = "Mock Bridge";
export const MOCK_DEBUG_DEVICE_ID = "mock-debug-device-aurora";
export const MOCK_DEBUG_TARGET_REF = "MOCK-AURORA-001";
export const MOCK_DEBUG_DEVICE_NAME = "Aurora Simulator (Mock)";

/** Deterministic clock base; operations count forward so history ordering is stable. */
const MOCK_CLOCK_BASE_MS = Date.parse("2026-08-13T09:00:00.000Z");

/**
 * Device-side values that intentionally differ from the library catalog: the story is
 * that an earlier debug session already applied some target values to the device and
 * one live reading drifted, so reads visibly replace the seeded catalog values.
 */
const DEVICE_VALUE_DRIFTS: Record<string, string> = {
  "dbg-charge-input-current": "3651",
  "dbg-cell-temp-limit": "41",
  "dbg-thermal-foldback": "80",
  "dbg-pmic-boost-voltage": "5100"
};

function pseudoDigest(seedText: string): string {
  let hash = 0;
  for (const char of seedText) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return `mock${hash.toString(16).padStart(8, "0")}`.padEnd(16, "0");
}

/**
 * Demo/test seams for the `LocalDeviceBridgePanel` on `/node-debugging` in mock mode:
 * a paired, connected bridge with both debug tools available, so the bridge readiness
 * strip is walkable (and silent — no HTTP probes) without local hardware.
 */
export function createMockDebuggingBridgeSeams(): {
  bridges: DeviceBridgeRecord[];
  probeBridgeHealth: () => Promise<LocalBridgeProbeResult>;
  createPairingCode: () => Promise<DeviceBridgePairingCode>;
} {
  return {
    bridges: [
      {
        id: MOCK_DEBUG_BRIDGE_ID,
        machineLabel: MOCK_DEBUG_BRIDGE_MACHINE_LABEL,
        platform: "darwin",
        arch: "arm64",
        clientVersion: null,
        capabilities: {},
        createdAt: "2026-08-01T00:00:00.000Z",
        lastSeenAt: new Date().toISOString(),
        revokedAt: null
      }
    ],
    probeBridgeHealth: async () => ({
      health: {
        ok: true,
        paired: true,
        connected: true,
        bridgeId: MOCK_DEBUG_BRIDGE_ID,
        updatedAt: new Date().toISOString(),
        tools: {
          adb: { available: true },
          hdc: { available: true }
        }
      },
      reachability: "ok"
    }),
    // The bridge panel prefetches a pairing code in some states; mock mode must
    // satisfy that without HTTP.
    createPairingCode: async () => ({
      code: "000000",
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString()
    })
  };
}

type MockDebuggingGatewayDeps = {
  /**
   * Live debug-parameter catalog accessor. The app shell passes the prototype-state
   * accessor so admin edits in mock demos stay readable; standalone consumers (tests)
   * default to the bundled power-management catalog.
   */
  getDebugParameters?: () => DebugParameter[];
};

type SnapshotEntry = {
  parameterId: string;
  nodePath: string;
  previousValue: string;
  nextValue: string;
};

export function createMockDebuggingGateway(deps: MockDebuggingGatewayDeps = {}): DebuggingGateway {
  const getDebugParameters =
    deps.getDebugParameters ?? (() => flattenDebugParameters(bundledPowerManagementConfig));

  const deviceValues = new Map<string, string>();
  const sessions = new Map<string, DebugSessionSnapshot>();
  const operationsBySession = new Map<string, NodeOperationSnapshot[]>();
  const snapshots = new Map<string, { summary: DebugSnapshotSummary; entries: SnapshotEntry[] }>();
  let sessionCounter = 0;
  let operationCounter = 0;
  let snapshotCounter = 0;
  let clockCounter = 0;

  function nextTimestamp(): string {
    clockCounter += 1;
    return new Date(MOCK_CLOCK_BASE_MS + clockCounter * 1000).toISOString();
  }

  function device(): DebugDeviceSnapshot {
    return {
      id: MOCK_DEBUG_DEVICE_ID,
      name: MOCK_DEBUG_DEVICE_NAME,
      transport: "multi",
      firmware: "v5.2.0-mock",
      status: "online",
      lastSeenAt: new Date(MOCK_CLOCK_BASE_MS).toISOString()
    };
  }

  function findParameter(input: { nodeId?: string; parameterId?: string; nodePath?: string }): DebugParameter | undefined {
    const parameters = getDebugParameters();
    const byId = input.nodeId ?? input.parameterId;
    if (byId) {
      const match = parameters.find((parameter) => parameter.id === byId);
      if (match) return match;
    }
    return input.nodePath ? parameters.find((parameter) => parameter.nodePath === input.nodePath) : undefined;
  }

  function deviceValueFor(parameter: DebugParameter): string {
    const existing = deviceValues.get(parameter.id);
    if (existing !== undefined) {
      return existing;
    }
    const seeded = DEVICE_VALUE_DRIFTS[parameter.id] ?? parameter.currentValue;
    deviceValues.set(parameter.id, seeded);
    return seeded;
  }

  function recordOperation(operation: NodeOperationSnapshot): NodeOperationSnapshot {
    const sessionOperations = operationsBySession.get(operation.sessionId);
    if (sessionOperations) {
      sessionOperations.push(operation);
    }
    return operation;
  }

  function complexValueMetadata(
    parameter: DebugParameter,
    value: string
  ): Pick<NodeOperationSnapshot, "valueKind" | "valueFormat" | "normalizationMode" | "valuePreview"> {
    if (parameter.valueKind !== "complex") {
      return {};
    }
    return {
      valueKind: parameter.valueKind,
      valueFormat: parameter.valueFormat,
      normalizationMode: parameter.normalizationMode,
      valuePreview: buildValuePreview(value)
    };
  }

  function sessionProtocol(sessionId: string | undefined): DebugConnectionProtocol | undefined {
    return sessionId ? sessions.get(sessionId)?.protocol : undefined;
  }

  return {
    async listDevices() {
      return [device()];
    },

    async listRuntimeNodes(_query?: { protocol?: DebugConnectionProtocol }) {
      // Every catalog node is bound for both protocols in the mock story.
      return getDebugParameters().map((parameter) => ({ ...parameter }));
    },

    async listParameters(_query?: { protocol?: DebugConnectionProtocol }) {
      return getDebugParameters().map((parameter) => ({ ...parameter }));
    },

    async detectTargets(input?: DetectTargetsInput): Promise<DeviceTarget[]> {
      const protocol = input?.protocol ?? "hdc";
      return [
        {
          id: `mock-target-${protocol}`,
          deviceId: MOCK_DEBUG_DEVICE_ID,
          bridgeId: MOCK_DEBUG_BRIDGE_ID,
          bridgeMachineLabel: MOCK_DEBUG_BRIDGE_MACHINE_LABEL,
          protocol,
          label: MOCK_DEBUG_DEVICE_NAME,
          targetRef: MOCK_DEBUG_TARGET_REF,
          status: "detected"
        }
      ];
    },

    async createSession(input) {
      sessionCounter += 1;
      const session: DebugSessionSnapshot = {
        id: `mock-debug-session-${sessionCounter}`,
        deviceId: input.deviceId,
        targetId: input.targetId,
        protocol: input.protocol ?? "hdc",
        status: "active",
        startedAt: nextTimestamp(),
        endedAt: null
      };
      sessions.set(session.id, session);
      operationsBySession.set(session.id, []);
      operationCounter += 1;
      recordOperation({
        id: `mock-debug-op-${operationCounter}`,
        sessionId: session.id,
        protocol: session.protocol,
        nodePath: MOCK_DEBUG_TARGET_REF,
        operationType: "detect",
        status: "succeeded",
        verified: true,
        durationMs: 45,
        createdAt: session.startedAt
      });
      return session;
    },

    async getSession(sessionId) {
      return sessions.get(sessionId) ?? null;
    },

    async listSessionEvents(sessionId) {
      return (operationsBySession.get(sessionId) ?? []).map((operation) => ({ ...operation }));
    },

    async readNode(input: ReadNodeInput): Promise<NodeReadResult & { operation?: NodeOperationSnapshot }> {
      const parameter = findParameter(input);
      if (!parameter) {
        throw mockApiError("NOT_FOUND", `未找到调试节点：${input.nodeId ?? input.parameterId ?? input.nodePath ?? "unknown"}`, { nodeId: input.nodeId, parameterId: input.parameterId, nodePath: input.nodePath });
      }
      if (parameter.accessMode === "WO") {
        throw mockApiError("INTERNAL_ERROR", "该节点仅支持写入，不可读取。");
      }
      const value = deviceValueFor(parameter);
      operationCounter += 1;
      const operation = recordOperation({
        id: `mock-debug-op-${operationCounter}`,
        sessionId: input.sessionId ?? "",
        nodeId: parameter.id,
        protocol: sessionProtocol(input.sessionId),
        nodePath: parameter.nodePath,
        operationType: "read",
        status: "succeeded",
        readValue: value,
        verified: true,
        durationMs: 12,
        createdAt: nextTimestamp(),
        ...complexValueMetadata(parameter, value)
      });
      return {
        ok: true,
        value,
        stdout: `${value}\n`,
        durationMs: operation.durationMs,
        operation
      };
    },

    async writeNode(
      input: WriteNodeInput
    ): Promise<NodeWriteResult & { operation?: NodeOperationSnapshot; snapshot?: DebugSnapshotSummary }> {
      const parameter = findParameter(input);
      if (!parameter) {
        throw mockApiError("NOT_FOUND", `未找到调试节点：${input.nodeId ?? input.parameterId ?? input.nodePath ?? "unknown"}`, { nodeId: input.nodeId, parameterId: input.parameterId, nodePath: input.nodePath });
      }
      if (parameter.accessMode === "RO") {
        throw mockApiError("INTERNAL_ERROR", "该节点为只读，不支持写入。");
      }
      // Same gate as the server: High-risk writes need the explicit confirmation token.
      if (parameter.risk === "High" && input.confirmationToken !== "confirm-high-risk-write" && !input.approvalId?.trim()) {
        throw mockApiError("VALIDATION_FAILED", "高风险节点写入需要确认令牌 confirm-high-risk-write。");
      }

      const readBack = input.readBack && parameter.accessMode === "RW";
      const previousValue = parameter.accessMode === "RW" ? deviceValueFor(parameter) : undefined;
      deviceValues.set(parameter.id, input.value);
      const readbackValue = readBack ? deviceValues.get(parameter.id) : undefined;
      const verified = readBack ? readbackValue === input.value : undefined;

      let snapshot: DebugSnapshotSummary | undefined;
      operationCounter += 1;
      const createdAt = nextTimestamp();
      if (previousValue !== undefined) {
        snapshotCounter += 1;
        snapshot = {
          id: `mock-debug-snapshot-${snapshotCounter}`,
          sessionId: input.sessionId ?? "",
          status: "valid",
          risk: parameter.risk,
          createdAt
        };
        snapshots.set(snapshot.id, {
          summary: snapshot,
          entries: [
            {
              parameterId: parameter.id,
              nodePath: parameter.nodePath,
              previousValue,
              nextValue: input.value
            }
          ]
        });
      }

      const digest = parameter.valueKind === "complex" ? pseudoDigest(input.value) : undefined;
      const operation = recordOperation({
        id: `mock-debug-op-${operationCounter}`,
        sessionId: input.sessionId ?? "",
        nodeId: parameter.id,
        protocol: sessionProtocol(input.sessionId),
        nodePath: parameter.nodePath,
        operationType: "write",
        status: "succeeded",
        requestedValue: input.value,
        previousValue,
        readbackValue,
        verified: verified ?? false,
        durationMs: 18,
        snapshotId: snapshot?.id,
        createdAt,
        ...complexValueMetadata(parameter, input.value),
        ...(digest ? { requestedValueDigest: digest, readbackValueDigest: readBack ? digest : undefined } : {})
      });

      return {
        ok: true,
        value: readbackValue,
        verified,
        writeResult: { ok: true, stdout: "write ok\n", durationMs: 9 },
        ...(readBack
          ? { readResult: { ok: true, value: readbackValue, stdout: `${readbackValue}\n`, durationMs: 9 } }
          : {}),
        operation,
        ...(snapshot ? { snapshot } : {})
      };
    },

    async rollbackSnapshot(input: RollbackSnapshotInput) {
      // Same gate as the server: rollback requires the explicit confirmation token.
      if (input.confirmationToken !== "confirm-rollback") {
        throw mockApiError("VALIDATION_FAILED", "回滚需要确认令牌 confirm-rollback。");
      }
      const stored = snapshots.get(input.snapshotId);
      if (!stored) {
        throw mockApiError("NOT_FOUND", `未找到调试快照：${input.snapshotId}`, { snapshotId: input.snapshotId });
      }
      if (stored.summary.status !== "valid") {
        throw mockApiError("CONFLICT", "该快照已被使用，无法再次回滚。");
      }

      const operations = stored.entries.map((entry) => {
        deviceValues.set(entry.parameterId, entry.previousValue);
        operationCounter += 1;
        return recordOperation({
          id: `mock-debug-op-${operationCounter}`,
          sessionId: stored.summary.sessionId,
          nodeId: entry.parameterId,
          protocol: sessionProtocol(stored.summary.sessionId),
          nodePath: entry.nodePath,
          operationType: "rollback",
          status: "succeeded",
          requestedValue: entry.previousValue,
          previousValue: entry.nextValue,
          readbackValue: entry.previousValue,
          verified: true,
          durationMs: 21,
          snapshotId: stored.summary.id,
          createdAt: nextTimestamp()
        });
      });

      const consumed: DebugSnapshotSummary = { ...stored.summary, status: "consumed" };
      snapshots.set(consumed.id, { summary: consumed, entries: stored.entries });
      return { snapshot: consumed, operations };
    }
  };
}
