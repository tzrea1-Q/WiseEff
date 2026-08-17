import { describe, expect, it, vi } from "vitest";

import type { DebugSessionSnapshot, DeviceTarget } from "@/application/ports/DebuggingGateway";
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
    accessMode: "WO",
    ...overrides
  };
}

function createActions(overrides: Partial<NodeDebuggingSessionActions> = {}): NodeDebuggingSessionActions {
  return {
    refresh: vi.fn().mockResolvedValue(undefined),
    detectAndStartSession: vi.fn().mockResolvedValue({ session: sessionSnapshot, target: deviceTarget }),
    readNode: vi.fn().mockResolvedValue({ ok: true, value: "3600" }),
    writeNode: vi.fn().mockResolvedValue({ ok: true, verified: true, value: "3700" }),
    rollbackSnapshot: vi.fn().mockResolvedValue(undefined),
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
});
