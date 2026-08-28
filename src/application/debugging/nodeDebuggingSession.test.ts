import { describe, expect, it, vi } from "vitest";

import type { DebugSessionSnapshot, DeviceTarget, NodeOperationSnapshot } from "@/application/ports/DebuggingGateway";
import type { DebugParameter } from "@/domain/prototype/types";
import type { LocalBridgeProbeResult } from "@/infrastructure/http/bridgeConnectLauncher";

import {
  createNodeDebuggingSession,
  NODE_DEBUGGING_HIGH_RISK_WRITE_TOKEN,
  type NodeDebuggingSessionActions
} from "./nodeDebuggingSession";

const sessionSnapshot: DebugSessionSnapshot = {
  id: "session-1",
  deviceId: "device-1",
  targetId: "target-1",
  protocol: "hdc",
  status: "active",
  startedAt: "2026-05-27T09:00:00.000Z",
  endedAt: null
};

const deviceTarget: DeviceTarget = {
  id: "target-1",
  deviceId: "device-1",
  protocol: "hdc",
  label: "Lab Target"
};

const offlineProbe: () => Promise<LocalBridgeProbeResult> = async () => ({
  health: null,
  reachability: "offline"
});

function parameter(overrides: Partial<DebugParameter> = {}): DebugParameter {
  return {
    id: "dbg-charge-input-current",
    name: "Charge input current",
    key: "charger.input_current_limit_ma",
    description: "",
    module: "charger",
    currentValue: "3600",
    targetValue: "3600",
    unit: "mA",
    range: "",
    risk: "Low",
    status: "已同步",
    nodePath: "/data/local/tmp/wiseeff_nodes/charger/input_current_limit_ma",
    accessMode: "RW",
    ...overrides
  };
}

function createActions(overrides: Partial<NodeDebuggingSessionActions> = {}): NodeDebuggingSessionActions {
  return {
    refresh: vi.fn().mockResolvedValue(undefined),
    detectAndStartSession: vi.fn().mockResolvedValue({ session: sessionSnapshot, target: deviceTarget }),
    readNode: vi.fn().mockResolvedValue({ ok: true, value: "3600" }),
    writeNode: vi.fn().mockResolvedValue({
      ok: true,
      verified: null,
      writeOutcome: "executed",
      readbackOutcome: "observed",
      value: "3700"
    }),
    rollbackSnapshot: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

function operation(overrides: Partial<NodeOperationSnapshot> = {}): NodeOperationSnapshot {
  return {
    id: "operation-write-1",
    sessionId: "session-1",
    nodeId: "dbg-charge-input-current",
    nodePath: "/data/local/tmp/wiseeff_nodes/charger/input_current_limit_ma",
    operationType: "write",
    status: "succeeded",
    verified: null,
    writeOutcome: "executed",
    readbackOutcome: "observed",
    durationMs: 10,
    createdAt: "2026-05-27T09:01:00.000Z",
    ...overrides
  };
}

describe("nodeDebuggingSession", () => {
  it("stores the detected session id and target and passes that session id on later writes", async () => {
    const actions = createActions();
    const session = createNodeDebuggingSession({
      initialParameters: [parameter()],
      readProtocol: () => "hdc",
      writeProtocol: () => undefined
    });

    await session.detect(actions, offlineProbe);

    const snapshot = session.getSnapshot();
    expect(snapshot.activeSessionId).toBe("session-1");
    expect(snapshot.activeTargetId).toBe("target-1");
    expect(snapshot.target).toBe("Lab Target");
    expect(snapshot.connected).toBe(true);

    session.setDraftValue("dbg-charge-input-current", "3700");
    await session.requestWrite("dbg-charge-input-current", actions);

    expect(actions.writeNode).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        target: "target-1",
        nodeId: "dbg-charge-input-current",
        value: "3700"
      })
    );
  });

  it("clears the active session on protocol switch so the next detect uses the new protocol", async () => {
    const actions = createActions();
    const session = createNodeDebuggingSession({
      initialParameters: [parameter()],
      readProtocol: () => "hdc",
      writeProtocol: () => undefined
    });

    await session.detect(actions, offlineProbe);
    expect(session.getSnapshot().activeSessionId).toBe("session-1");

    session.setProtocol("adb", actions);
    await Promise.resolve();

    expect(session.getSnapshot().activeSessionId).toBeUndefined();
    expect(session.getSnapshot().activeTargetId).toBeUndefined();
    expect(session.getSnapshot().target).toBeUndefined();
    expect(session.getSnapshot().protocol).toBe("adb");
    expect(actions.refresh).toHaveBeenCalledWith({ protocol: "adb" });
    expect(actions.detectAndStartSession).toHaveBeenCalledTimes(1);

    await session.detect(actions, offlineProbe);

    expect(actions.detectAndStartSession).toHaveBeenLastCalledWith({ protocol: "adb" });
    expect(actions.detectAndStartSession).toHaveBeenCalledTimes(2);
  });

  it("does not call gateway write when a high-risk write is cancelled", async () => {
    const actions = createActions();
    const session = createNodeDebuggingSession({
      initialParameters: [parameter({ risk: "High" })],
      readProtocol: () => "hdc",
      writeProtocol: () => undefined
    });

    await session.detect(actions, offlineProbe);
    await session.requestWrite("dbg-charge-input-current", actions);

    expect(session.getSnapshot().pendingHighRiskWrite?.id).toBe("dbg-charge-input-current");
    expect(actions.writeNode).not.toHaveBeenCalled();

    session.cancelWrite();

    expect(session.getSnapshot().pendingHighRiskWrite).toBeNull();
    expect(actions.writeNode).not.toHaveBeenCalled();
  });

  it("attaches the high-risk confirmation token only after confirmWrite", async () => {
    const actions = createActions();
    const session = createNodeDebuggingSession({
      initialParameters: [parameter({ risk: "High" })],
      readProtocol: () => "hdc",
      writeProtocol: () => undefined
    });

    await session.detect(actions, offlineProbe);
    await session.requestWrite("dbg-charge-input-current", actions);
    await session.confirmWrite(actions);

    expect(actions.writeNode).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        confirmationToken: NODE_DEBUGGING_HIGH_RISK_WRITE_TOKEN
      })
    );
  });

  it("treats 1 to 0x1 as an executed write with an observed value", async () => {
    const actions = createActions({
      writeNode: vi.fn().mockResolvedValue({
        ok: true,
        verified: null,
        writeOutcome: "executed",
        readbackOutcome: "observed",
        value: "0x1",
        operation: operation({ requestedValue: "1", readbackValue: "0x1" })
      })
    });
    const session = createNodeDebuggingSession({
      initialParameters: [parameter()],
      readProtocol: () => "hdc",
      writeProtocol: () => undefined
    });

    await session.detect(actions, offlineProbe);
    session.setDraftValue("dbg-charge-input-current", "1");
    await expect(session.requestWrite("dbg-charge-input-current", actions)).resolves.toBe(true);

    expect(session.getSnapshot().rows[0]).toMatchObject({
      runtimeStatus: "写入已执行",
      runtimeCurrentValue: "0x1",
      lastReadValue: "0x1",
      writeOutcome: "executed",
      readbackOutcome: "observed",
      currentValueStale: false,
      error: undefined
    });
    expect(session.getSnapshot().events.at(-1)?.status).toBe("已回读");
  });

  it("preserves the previous current value after readback failure and retries with a linked read only", async () => {
    const readNode = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: "3600" })
      .mockResolvedValueOnce({
        ok: true,
        value: "0x1",
        operation: operation({
          id: "operation-read-2",
          operationType: "read",
          readValue: "0x1",
          relatedOperationId: "operation-write-1",
          writeOutcome: undefined,
          readbackOutcome: undefined,
          verified: true
        })
      });
    const writeNode = vi.fn().mockResolvedValue({
      ok: true,
      verified: null,
      writeOutcome: "executed",
      readbackOutcome: "failed",
      error: "read timed out",
      operation: operation({ readbackOutcome: "failed", failureReason: "read timed out" })
    });
    const actions = createActions({ readNode, writeNode });
    const session = createNodeDebuggingSession({
      initialParameters: [parameter()],
      readProtocol: () => "hdc",
      writeProtocol: () => undefined
    });

    await session.detect(actions, offlineProbe);
    await vi.waitFor(() => expect(readNode).toHaveBeenCalledOnce());
    session.setDraftValue("dbg-charge-input-current", "1");
    await session.requestWrite("dbg-charge-input-current", actions);

    expect(session.getSnapshot().rows[0]).toMatchObject({
      runtimeStatus: "写入已执行",
      runtimeCurrentValue: "3600",
      lastReadValue: "3600",
      readbackOutcome: "failed",
      currentValueStale: true,
      lastWriteOperationId: "operation-write-1"
    });

    await session.retryRead("dbg-charge-input-current", actions);

    expect(readNode).toHaveBeenLastCalledWith(expect.objectContaining({ relatedOperationId: "operation-write-1" }));
    expect(writeNode).toHaveBeenCalledOnce();
    expect(session.getSnapshot().rows[0]).toMatchObject({
      runtimeCurrentValue: "0x1",
      currentValueStale: false,
      readbackOutcome: "observed"
    });
  });

  it("keeps unknown writes distinct from failures and marks the current value stale", async () => {
    const actions = createActions({
      writeNode: vi.fn().mockResolvedValue({
        ok: false,
        verified: null,
        writeOutcome: "unknown",
        readbackOutcome: "unknown",
        error: "Device Bridge result did not include outcome details; upgrade the Bridge and read the node again.",
        operation: operation({
          status: "unknown",
          writeOutcome: "unknown",
          readbackOutcome: "unknown",
          failureReason: "Device Bridge result did not include outcome details; upgrade the Bridge and read the node again."
        })
      })
    });
    const session = createNodeDebuggingSession({
      initialParameters: [parameter()],
      readProtocol: () => "hdc",
      writeProtocol: () => undefined
    });

    await session.detect(actions, offlineProbe);
    await session.requestWrite("dbg-charge-input-current", actions);

    expect(session.getSnapshot().rows[0]).toMatchObject({
      runtimeStatus: "写入结果未知",
      writeOutcome: "unknown",
      readbackOutcome: "unknown",
      currentValueStale: true,
      error: "写入结果未知，请升级 Device Bridge 后重新读取节点"
    });
    expect(session.getSnapshot().events.at(-1)).toMatchObject({
      status: "写入结果未知",
      stderr: "写入结果未知，请升级 Device Bridge 后重新读取节点"
    });
  });

  it("surfaces unsupported readback without turning the executed write into a failure", async () => {
    const actions = createActions({
      writeNode: vi.fn().mockResolvedValue({
        ok: true,
        verified: null,
        writeOutcome: "executed",
        readbackOutcome: "unsupported",
        operation: operation({ readbackOutcome: "unsupported" })
      })
    });
    const session = createNodeDebuggingSession({
      initialParameters: [parameter()],
      readProtocol: () => "hdc",
      writeProtocol: () => undefined
    });

    await session.detect(actions, offlineProbe);
    await session.requestWrite("dbg-charge-input-current", actions);

    expect(session.getSnapshot().rows[0]).toMatchObject({
      runtimeStatus: "写入已执行",
      writeOutcome: "executed",
      readbackOutcome: "unsupported",
      currentValueStale: true,
      error: undefined
    });
    expect(session.getSnapshot().events.at(-1)?.status).toBe("不支持回读");
  });
});
