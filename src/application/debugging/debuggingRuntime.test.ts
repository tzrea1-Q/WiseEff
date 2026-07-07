import { describe, expect, it, vi } from "vitest";

import type {
  DebugDeviceSnapshot,
  DebuggingGateway,
  DebugSessionSnapshot,
  DeviceTarget,
  NodeOperationSnapshot
} from "@/application/ports/DebuggingGateway";
import { initialState } from "@/mockData";
import { createDebuggingRuntimeActions, debuggingRuntimeFailureNotification, formatDebuggingRuntimeError } from "./debuggingRuntime";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";

const apiDevice: DebugDeviceSnapshot = {
  id: "api-device-1",
  name: "Api Device",
  transport: "hdc",
  firmware: "v1.0.0",
  status: "online",
  lastSeenAt: "2026-05-25T08:00:00.000Z"
};

const apiParameter = {
  ...initialState.debugParameters[0],
  id: "api-debug-param-1",
  name: "api_debug_parameter",
  nodePath: "/sys/api/debug/param",
  currentValue: "12",
  targetValue: "15",
  risk: "High" as const
};

const apiTarget: DeviceTarget = {
  id: "target-1",
  deviceId: apiDevice.id,
  protocol: "hdc",
  label: "Api Target",
  targetRef: "ssh://api-device",
  status: "detected"
};

const apiSession: DebugSessionSnapshot = {
  id: "session-1",
  deviceId: apiDevice.id,
  targetId: apiTarget.id,
  protocol: "hdc",
  status: "active",
  startedAt: "2026-05-25T08:01:00.000Z",
  endedAt: null
};

const readOperation: NodeOperationSnapshot = {
  id: "op-read-1",
  sessionId: apiSession.id,
  parameterId: apiParameter.id,
  nodePath: apiParameter.nodePath,
  operationType: "read",
  status: "succeeded",
  readValue: "12",
  verified: true,
  durationMs: 11,
  createdAt: "2026-05-25T08:02:00.000Z"
};

const writeOperation: NodeOperationSnapshot = {
  id: "op-write-1",
  sessionId: apiSession.id,
  parameterId: apiParameter.id,
  nodePath: apiParameter.nodePath,
  operationType: "write",
  status: "succeeded",
  requestedValue: "15",
  previousValue: "12",
  readbackValue: "15",
  verified: true,
  durationMs: 18,
  snapshotId: "snapshot-1",
  createdAt: "2026-05-25T08:03:00.000Z"
};

const rollbackOperation: NodeOperationSnapshot = {
  ...writeOperation,
  id: "op-rollback-1",
  operationType: "rollback",
  createdAt: "2026-05-25T08:04:00.000Z"
};

const apiSnapshot = {
  id: "snapshot-1",
  sessionId: apiSession.id,
  status: "valid" as const,
  risk: "High" as const,
  createdAt: "2026-05-25T08:03:00.000Z"
};

function createGateway(overrides: Partial<DebuggingGateway> = {}): DebuggingGateway {
  return {
    listDevices: vi.fn().mockResolvedValue([apiDevice]),
    listRuntimeNodes: vi.fn().mockResolvedValue([apiParameter]),
    listParameters: vi.fn().mockResolvedValue([apiParameter]),
    detectTargets: vi.fn().mockResolvedValue([apiTarget]),
    createSession: vi.fn().mockResolvedValue(apiSession),
    listSessionEvents: vi.fn().mockResolvedValue([readOperation]),
    readNode: vi.fn().mockResolvedValue({ ok: true, value: "12", durationMs: 11, operation: readOperation }),
    writeNode: vi.fn().mockResolvedValue({ ok: true, value: "15", verified: true, operation: writeOperation, snapshot: apiSnapshot }),
    rollbackSnapshot: vi.fn().mockResolvedValue({ snapshot: apiSnapshot, operations: [rollbackOperation] }),
    ...overrides
  };
}

describe("createDebuggingRuntimeActions", () => {
  it("dispatches existing reducer actions in mock mode", async () => {
    const dispatch = vi.fn();
    const actions = createDebuggingRuntimeActions({
      mode: "mock",
      dispatch,
      getState: () => initialState
    });

    await actions.connectDevice(initialState.devices[0].id);
    await actions.pushValues([initialState.debugParameters[0].id]);
    await actions.rollbackLastSnapshot();

    expect(dispatch).toHaveBeenNthCalledWith(1, { type: "CONNECT_DEVICE", deviceId: initialState.devices[0].id });
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: "PUSH_DEBUG_VALUES", parameterIds: [initialState.debugParameters[0].id] });
    expect(dispatch).toHaveBeenNthCalledWith(3, { type: "ROLLBACK_LAST_SNAPSHOT" });
  });

  it("refreshes API devices and parameters into debugging runtime state", async () => {
    const dispatch = vi.fn();
    const gateway = createGateway();
    const actions = createDebuggingRuntimeActions({ mode: "api", gateway, dispatch, getState: () => initialState });

    await actions.refresh({ protocol: "hdc" });

    expect(gateway.listDevices).toHaveBeenCalledTimes(1);
    expect(gateway.listRuntimeNodes).toHaveBeenCalledWith({ protocol: "hdc" });
    expect(dispatch).toHaveBeenCalledWith({
      type: "HYDRATE_DEBUG_RUNTIME",
      devices: [
        {
          id: apiDevice.id,
          name: apiDevice.name,
          transport: apiDevice.transport,
          firmware: apiDevice.firmware,
          status: initialState.devices[1].status,
          lastSeen: apiDevice.lastSeenAt ?? "unknown"
        }
      ],
      debugParameters: [apiParameter]
    });
  });

  it("refreshes shared debug parameters at organization scope", async () => {
    const gateway = {
      listDevices: vi.fn(async () => []),
      listRuntimeNodes: vi.fn(async () => [
        {
          id: "shared-param-1",
          name: "ADB smoke readable",
          key: "adb_smoke_readable",
          description: "Shared smoke parameter.",
          module: "Diagnostics",
          currentValue: "",
          targetValue: "",
          unit: "",
          range: "",
          risk: "Low" as const,
          status: "已同步" as const,
          nodePath: "/sys/adb/smoke",
          accessMode: "RO" as const,
          selectedProtocol: "adb" as const,
          bindingStatus: "configured" as const
        }
      ]),
      detectTargets: vi.fn(),
      readNode: vi.fn(),
      writeNode: vi.fn()
    } satisfies DebuggingGateway;
    const dispatch = vi.fn();
    const actions = createDebuggingRuntimeActions({
      mode: "api",
      gateway,
      dispatch,
      getState: () => ({ ...initialState, activeProjectId: "aurora" })
    });

    await actions.refresh({ protocol: "adb" });

    expect(gateway.listRuntimeNodes).toHaveBeenCalledWith({ protocol: "adb" });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "HYDRATE_DEBUG_RUNTIME",
        debugParameters: [expect.objectContaining({ selectedProtocol: "adb" })]
      })
    );
  });

  it("detects targets, creates a session, and stores active API session state", async () => {
    const dispatch = vi.fn();
    const gateway = createGateway();
    const actions = createDebuggingRuntimeActions({ mode: "api", gateway, dispatch, getState: () => initialState });

    const result = await actions.detectAndStartSession();

    expect(gateway.detectTargets).toHaveBeenCalledWith({
      protocol: "hdc"
    });
    expect(gateway.createSession).toHaveBeenCalledWith({
      deviceId: apiDevice.id,
      targetId: apiTarget.id,
      protocol: "hdc",
      sessionKind: "node"
    });
    expect(result).toEqual({ session: apiSession, target: apiTarget });
    expect(dispatch).toHaveBeenCalledWith({ type: "SET_DEBUG_ACTIVE_SESSION", session: apiSession, target: apiTarget });
  });

  it("passes bridgeId through target detection when provided", async () => {
    const dispatch = vi.fn();
    const gateway = createGateway();
    const actions = createDebuggingRuntimeActions({ mode: "api", gateway, dispatch, getState: () => initialState });

    await actions.detectAndStartSession({ protocol: "hdc", bridgeId: "br-local" });

    expect(gateway.detectTargets).toHaveBeenCalledWith({
      protocol: "hdc",
      bridgeId: "br-local"
    });
  });

  it("passes the selected protocol through target detection and session creation", async () => {
    const dispatch = vi.fn();
    const adbDevice = { ...apiDevice, id: "adb-device-aurora", transport: "adb" as const };
    const adbTarget = { ...apiTarget, id: "adb:device-1", deviceId: adbDevice.id, protocol: "adb" as const, targetRef: "device-1" };
    const adbSession = { ...apiSession, deviceId: adbDevice.id, targetId: adbTarget.id, protocol: "adb" as const };
    const gateway = createGateway({
      listDevices: vi.fn().mockResolvedValue([apiDevice, adbDevice]),
      detectTargets: vi.fn().mockResolvedValue([adbTarget]),
      createSession: vi.fn().mockResolvedValue(adbSession)
    });
    const actions = createDebuggingRuntimeActions({ mode: "api", gateway, dispatch, getState: () => initialState });

    const result = await actions.detectAndStartSession({ protocol: "adb" });

    expect(gateway.detectTargets).toHaveBeenCalledWith({
      protocol: "adb"
    });
    expect(gateway.createSession).toHaveBeenCalledWith({
      deviceId: adbDevice.id,
      targetId: adbTarget.id,
      protocol: "adb",
      sessionKind: "node"
    });
    expect(result).toEqual({ session: adbSession, target: adbTarget });
  });

  it("selects the device matching the requested debug protocol", async () => {
    const dispatch = vi.fn();
    const hdcDevice = { ...apiDevice, id: "hdc-device-lab-aurora", transport: "hdc" as const };
    const gateway = createGateway({
      detectTargets: vi.fn().mockResolvedValue([{ ...apiTarget, deviceId: hdcDevice.id }]),
      createSession: vi.fn().mockResolvedValue({ ...apiSession, deviceId: hdcDevice.id })
    });
    const actions = createDebuggingRuntimeActions({
      mode: "api",
      gateway,
      dispatch,
      getState: () => ({
        ...initialState,
        devices: [
          { ...initialState.devices[0], id: "sim-device-aurora", transport: "simulator" as const },
          { ...initialState.devices[1], id: "adb-device-aurora", transport: "adb" as const },
          {
            id: hdcDevice.id,
            name: hdcDevice.name,
            firmware: hdcDevice.firmware,
            status: "已连接" as const,
            lastSeen: hdcDevice.lastSeenAt ?? "-",
            transport: "hdc" as const
          }
        ]
      })
    });

    await actions.detectAndStartSession({ protocol: "hdc" });

    expect(gateway.detectTargets).toHaveBeenCalledWith({
      protocol: "hdc"
    });
    expect(gateway.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: hdcDevice.id,
        protocol: "hdc",
        sessionKind: "node"
      })
    );
  });

  it("reloads API devices before detecting when local state has not hydrated a protocol device yet", async () => {
    const dispatch = vi.fn();
    const hdcDevice = { ...apiDevice, id: "hdc-device-lab-aurora", transport: "hdc" as const };
    const gateway = createGateway({
      listDevices: vi.fn().mockResolvedValue([hdcDevice]),
      detectTargets: vi.fn().mockResolvedValue([{ ...apiTarget, deviceId: hdcDevice.id }]),
      createSession: vi.fn().mockResolvedValue({ ...apiSession, deviceId: hdcDevice.id })
    });
    const actions = createDebuggingRuntimeActions({
      mode: "api",
      gateway,
      dispatch,
      getState: () => initialState
    });

    await actions.detectAndStartSession({ protocol: "hdc" });

    expect(gateway.listDevices).toHaveBeenCalledTimes(1);
    expect(gateway.detectTargets).toHaveBeenCalledWith({
      protocol: "hdc"
    });
  });

  it("prefers bridge-backed targets over simulator targets during detection", async () => {
    const dispatch = vi.fn();
    const bridgeTarget = {
      ...apiTarget,
      id: "bridge:br-1:hdc:serial-1",
      deviceId: "bridge:br-1",
      bridgeId: "br-1",
      targetRef: "serial-1",
      label: "Lab Phone"
    };
    const simulatorTarget = {
      ...apiTarget,
      id: "sim-target-aurora-1",
      targetRef: "simulator://aurora-1",
      label: "Aurora Simulator 1"
    };
    const gateway = createGateway({
      detectTargets: vi.fn().mockResolvedValue([simulatorTarget, bridgeTarget]),
      createSession: vi.fn().mockResolvedValue({ ...apiSession, targetId: bridgeTarget.id, deviceId: bridgeTarget.deviceId })
    });
    const actions = createDebuggingRuntimeActions({ mode: "api", gateway, dispatch, getState: () => initialState });

    const result = await actions.detectAndStartSession({ protocol: "hdc" });

    expect(gateway.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: bridgeTarget.id,
        deviceId: bridgeTarget.deviceId,
        bridgeId: "br-1",
        protocol: "hdc",
        sessionKind: "node"
      })
    );
    expect("candidates" in result).toBe(false);
    if ("target" in result) {
      expect(result.target).toEqual(bridgeTarget);
    }
  });

  it("falls back to simulator targets when no bridge or real device is available", async () => {
    const dispatch = vi.fn();
    const simulatorTarget = {
      ...apiTarget,
      id: "sim-target-aurora-1",
      targetRef: "simulator://aurora-1",
      label: "Aurora Simulator 1"
    };
    const gateway = createGateway({
      detectTargets: vi.fn().mockResolvedValue([simulatorTarget]),
      createSession: vi.fn().mockResolvedValue({ ...apiSession, targetId: simulatorTarget.id })
    });
    const actions = createDebuggingRuntimeActions({ mode: "api", gateway, dispatch, getState: () => initialState });

    const result = await actions.detectAndStartSession({ protocol: "hdc" });

    expect(gateway.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: simulatorTarget.id,
        protocol: "hdc",
        sessionKind: "node"
      })
    );
    if ("target" in result) {
      expect(result.target).toEqual(simulatorTarget);
    }
  });

  it("reads an API node, returns the read result, and dispatches the operation event", async () => {
    const dispatch = vi.fn();
    const gateway = createGateway();
    const actions = createDebuggingRuntimeActions({ mode: "api", gateway, dispatch, getState: () => initialState });
    const input = { sessionId: apiSession.id, parameterId: apiParameter.id, nodePath: apiParameter.nodePath };

    const result = await actions.readNode(input);

    expect(gateway.readNode).toHaveBeenCalledWith(input);
    expect(result).toEqual({ ok: true, value: "12", durationMs: 11, operation: readOperation });
    expect(dispatch).toHaveBeenCalledWith({ type: "UPSERT_DEBUG_NODE_OPERATION", operation: readOperation });
  });

  it("writes high-risk API nodes with confirmation and dispatches operation and snapshot results", async () => {
    const dispatch = vi.fn();
    const gateway = createGateway();
    const actions = createDebuggingRuntimeActions({ mode: "api", gateway, dispatch, getState: () => initialState });
    const input = {
      sessionId: apiSession.id,
      parameterId: apiParameter.id,
      nodePath: apiParameter.nodePath,
      value: "15",
      readBack: true,
      risk: "High" as const
    };

    const result = await actions.writeNode(input);

    expect(gateway.writeNode).toHaveBeenCalledWith({
      sessionId: apiSession.id,
      parameterId: apiParameter.id,
      nodePath: apiParameter.nodePath,
      value: "15",
      readBack: true,
      confirmationToken: "confirm-high-risk-write"
    });
    expect(result).toEqual({ ok: true, value: "15", verified: true, operation: writeOperation, snapshot: apiSnapshot });
    expect(dispatch).toHaveBeenCalledWith({ type: "UPSERT_DEBUG_NODE_OPERATION", operation: writeOperation });
    expect(dispatch).toHaveBeenCalledWith({ type: "UPSERT_DEBUG_SNAPSHOT", snapshot: apiSnapshot });
  });

  it("keeps caller approval ids when writing high-risk API nodes", async () => {
    const dispatch = vi.fn();
    const gateway = createGateway();
    const actions = createDebuggingRuntimeActions({ mode: "api", gateway, dispatch, getState: () => initialState });

    await actions.writeNode({
      sessionId: apiSession.id,
      parameterId: apiParameter.id,
      nodePath: apiParameter.nodePath,
      value: "15",
      readBack: true,
      risk: "High",
      approvalId: "approval-1"
    });

    expect(gateway.writeNode).toHaveBeenCalledWith(
      expect.not.objectContaining({ confirmationToken: "confirm-high-risk-write" })
    );
    expect(gateway.writeNode).toHaveBeenCalledWith(expect.objectContaining({ approvalId: "approval-1" }));
  });

  it("pushes selected API parameters sequentially so row failures stay deterministic", async () => {
    const dispatch = vi.fn();
    const callOrder: string[] = [];
    const firstParameter = { ...apiParameter, id: "api-debug-param-1", targetValue: "15", status: "待下发" as const };
    const secondParameter = { ...apiParameter, id: "api-debug-param-2", targetValue: "22", status: "待下发" as const };
    const gateway = createGateway({
      writeNode: vi.fn(async (input) => {
        callOrder.push(input.nodeId ?? "");
        return { ok: true, value: input.value, verified: true, operation: { ...writeOperation, id: `op-${input.nodeId}`, parameterId: input.nodeId } };
      })
    });
    const actions = createDebuggingRuntimeActions({
      mode: "api",
      gateway,
      dispatch,
      getState: () => ({
        ...initialState,
        debuggingSessionStartedAt: apiSession.startedAt,
        debuggingActiveSessionId: apiSession.id,
        debugParameters: [firstParameter, secondParameter]
      })
    });

    await actions.pushValues([secondParameter.id, firstParameter.id]);

    expect(callOrder).toEqual([secondParameter.id, firstParameter.id]);
    expect(gateway.writeNode).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        sessionId: apiSession.id,
        nodeId: secondParameter.id,
        value: secondParameter.targetValue
      })
    );
    expect(gateway.writeNode).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        sessionId: apiSession.id,
        nodeId: firstParameter.id,
        value: firstParameter.targetValue
      })
    );
  });

  it("skips non-writable and already-synced API parameters while preserving writable pending order", async () => {
    const dispatch = vi.fn();
    const callOrder: string[] = [];
    const pendingStatus = "待下发" as const;
    const syncedStatus = "已同步" as const;
    const readOnlyParameter = { ...apiParameter, id: "api-debug-readonly", accessMode: "RO" as const, status: pendingStatus, targetValue: "99" };
    const syncedParameter = { ...apiParameter, id: "api-debug-synced", accessMode: "RW" as const, status: syncedStatus, targetValue: "11" };
    const writableFirst = { ...apiParameter, id: "api-debug-writable-1", accessMode: "RW" as const, status: pendingStatus, targetValue: "15" };
    const writableSecond = { ...apiParameter, id: "api-debug-writable-2", accessMode: "WO" as const, status: pendingStatus, targetValue: "22" };
    const gateway = createGateway({
      writeNode: vi.fn(async (input) => {
        callOrder.push(input.nodeId ?? "");
        return {
          ok: true,
          value: input.value,
          verified: true,
          operation: { ...writeOperation, id: `op-${input.nodeId}`, parameterId: input.nodeId }
        };
      })
    });
    const actions = createDebuggingRuntimeActions({
      mode: "api",
      gateway,
      dispatch,
      getState: () => ({
        ...initialState,
        debuggingSessionStartedAt: apiSession.startedAt,
        debuggingActiveSessionId: apiSession.id,
        debugParameters: [readOnlyParameter, writableFirst, syncedParameter, writableSecond]
      })
    });

    await actions.pushValues([readOnlyParameter.id, syncedParameter.id, writableSecond.id, writableFirst.id]);

    expect(callOrder).toEqual([writableSecond.id, writableFirst.id]);
    expect(gateway.writeNode).toHaveBeenCalledTimes(2);
    expect(gateway.writeNode).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ sessionId: apiSession.id, nodeId: writableSecond.id })
    );
    expect(gateway.writeNode).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ sessionId: apiSession.id, nodeId: writableFirst.id })
    );
    expect(dispatch).not.toHaveBeenCalledWith({ type: "PUSH_DEBUG_VALUES", parameterIds: expect.any(Array) });
  });

  it("does not push API parameters without an active debug session id", async () => {
    const dispatch = vi.fn();
    const pendingParameter = { ...apiParameter, accessMode: "RW" as const, targetValue: "15" };
    const gateway = createGateway({
      writeNode: vi.fn(async (input) => ({
        ok: true,
        value: input.value,
        verified: true,
        operation: { ...writeOperation, id: `op-${input.nodeId}`, parameterId: input.nodeId }
      }))
    });
    const actions = createDebuggingRuntimeActions({
      mode: "api",
      gateway,
      dispatch,
      getState: () => ({
        ...initialState,
        debuggingSessionStartedAt: apiSession.startedAt,
        debuggingActiveSessionId: null,
        debugParameters: [pendingParameter]
      })
    });

    await actions.pushValues([pendingParameter.id]);

    expect(gateway.writeNode).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalledWith({ type: "PUSH_DEBUG_VALUES", parameterIds: expect.any(Array) });
  });

  it("rolls back an API snapshot and refreshes operations", async () => {
    const dispatch = vi.fn();
    const gateway = createGateway();
    const actions = createDebuggingRuntimeActions({ mode: "api", gateway, dispatch, getState: () => initialState });
    const input = { snapshotId: apiSnapshot.id, confirmationToken: "confirm-rollback" };

    await actions.rollbackSnapshot(input);

    expect(gateway.rollbackSnapshot).toHaveBeenCalledWith(input);
    expect(gateway.listSessionEvents).toHaveBeenCalledWith(apiSnapshot.sessionId);
    expect(dispatch).toHaveBeenCalledWith({ type: "UPSERT_DEBUG_SNAPSHOT", snapshot: apiSnapshot });
    expect(dispatch).toHaveBeenCalledWith({ type: "UPSERT_DEBUG_NODE_OPERATION", operation: rollbackOperation });
    expect(dispatch).toHaveBeenCalledWith({ type: "UPSERT_DEBUG_NODE_OPERATION", operation: readOperation });
  });

  it("notifies on failed gateway calls without optimistic success dispatches", async () => {
    const dispatch = vi.fn();
    const gateway = createGateway();
    const actions = createDebuggingRuntimeActions({ mode: "api", gateway, dispatch, getState: () => initialState });
    const cause = new Error("gateway unavailable");
    vi.mocked(gateway.writeNode).mockRejectedValueOnce(cause);

    let failure: unknown;
    try {
      await actions.writeNode({
        sessionId: apiSession.id,
        parameterId: apiParameter.id,
        nodePath: apiParameter.nodePath,
        value: "15",
        readBack: true,
        risk: "High"
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect(failure).toMatchObject({ alreadyNotified: true, cause });
    expect(failure).toHaveProperty("message", "gateway unavailable");

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: "ADD_NOTIFICATION", message: "gateway unavailable" });
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "UPSERT_DEBUG_NODE_OPERATION" }));
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "UPSERT_DEBUG_SNAPSHOT" }));
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "PUSH_DEBUG_VALUES" }));
  });

  it("formats WiseEff API failures with the server message", () => {
    expect(
      formatDebuggingRuntimeError(new WiseEffApiError("NOT_FOUND", "Debug protocol binding was not found.", {}, "req-1"))
    ).toBe("Debug protocol binding was not found.");
  });

  it("falls back to the generic debugging notification for unknown failures", () => {
    expect(formatDebuggingRuntimeError({})).toBe(debuggingRuntimeFailureNotification);
  });
});
