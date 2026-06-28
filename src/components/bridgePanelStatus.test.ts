import { describe, expect, it } from "vitest";

import { deriveBridgePanelStatus, formatDetectFailureMessage, isToolMissingDetectError, shouldClearStaleBridgeConnectError, canConnectBridgeWithoutPairingCode } from "./bridgePanelStatus";
import type { LocalBridgeHealthState } from "../infrastructure/http/deviceBridgeClient";

const connectedHealth: LocalBridgeHealthState = {
  ok: true,
  paired: true,
  connected: true,
  updatedAt: "2026-06-25T00:00:00.000Z",
  tools: {
    adb: { available: false, reason: "adb not found" },
    hdc: { available: true, version: "hdc version 2.0.0", source: "system" }
  }
};

describe("deriveBridgePanelStatus", () => {
  it("returns missing_bridge when remote page cannot reach local health and no bridge is registered on this host", () => {
    expect(
      deriveBridgePanelStatus({
        health: null,
        bridgeCount: 1,
        registeredBridgeCountForHost: 0,
        healthReachability: "possibly_blocked"
      })
    ).toBe("missing_bridge");
  });

  it("returns bridge_blocked when remote page cannot reach local health but this host already has a registered bridge", () => {
    expect(
      deriveBridgePanelStatus({
        health: null,
        bridgeCount: 1,
        registeredBridgeCountForHost: 1,
        healthReachability: "possibly_blocked"
      })
    ).toBe("bridge_blocked");
  });

  it("returns not_running when a bridge is registered on this host but local health is unreachable on localhost", () => {
    expect(
      deriveBridgePanelStatus({
        health: null,
        bridgeCount: 1,
        registeredBridgeCountForHost: 1,
        healthReachability: "offline"
      })
    ).toBe("not_running");
  });

  it("returns missing_bridge when only bridges from other platforms are registered", () => {
    expect(
      deriveBridgePanelStatus({
        health: null,
        bridgeCount: 1,
        registeredBridgeCountForHost: 0,
        healthReachability: "offline"
      })
    ).toBe("missing_bridge");
  });

  it("allows reconnect without pairing code when bridge is registered but not running", () => {
    expect(
      canConnectBridgeWithoutPairingCode({
        panelStatus: "not_running",
        hasRegisteredBridge: true
      })
    ).toBe(true);
  });

  it("requires pairing code for first-time bridge_blocked setup", () => {
    expect(
      canConnectBridgeWithoutPairingCode({
        panelStatus: "bridge_blocked",
        hasRegisteredBridge: false
      })
    ).toBe(false);
  });

  it("clears stale connect errors once bridge health reports online", () => {
    expect(
      shouldClearStaleBridgeConnectError({
        connectError: "30 秒内未检测到 Bridge 上线。",
        health: {
          ok: true,
          paired: true,
          connected: true,
          updatedAt: "2026-06-28T00:00:00.000Z"
        },
        panelStatus: "online_no_device"
      })
    ).toBe(true);
    expect(
      shouldClearStaleBridgeConnectError({
        connectError: "",
        health: connectedHealth,
        panelStatus: "online_no_device"
      })
    ).toBe(false);
  });

  it("returns not_paired when local bridge id is missing from registered server bridges", () => {
    expect(
      deriveBridgePanelStatus({
        health: {
          ok: true,
          paired: true,
          connected: false,
          bridgeId: "br_local",
          updatedAt: "2026-06-26T00:00:00.000Z"
        },
        bridgeCount: 1,
        registeredBridgeIds: ["br_server"]
      })
    ).toBe("not_paired");
  });

  it("returns not_paired when local bridge token auth fails", () => {
    expect(
      deriveBridgePanelStatus({
        health: {
          ok: true,
          paired: true,
          connected: false,
          bridgeId: "br_local",
          lastError: "Invalid or expired bridge token.",
          updatedAt: "2026-06-26T00:00:00.000Z"
        },
        bridgeCount: 1,
        registeredBridgeIds: ["br_local"]
      })
    ).toBe("not_paired");
  });

  it("returns not_paired when local bridge token is expired", () => {
    expect(
      deriveBridgePanelStatus({
        health: {
          ok: true,
          paired: true,
          connected: false,
          bridgeId: "br_local",
          tokenExpiresAt: "2020-01-01T00:00:00.000Z",
          updatedAt: "2026-06-26T00:00:00.000Z"
        },
        bridgeCount: 1,
        registeredBridgeIds: ["br_local"]
      })
    ).toBe("not_paired");
  });

  it("returns tools_missing when connected but required protocol tool is unavailable", () => {
    expect(
      deriveBridgePanelStatus({
        health: connectedHealth,
        bridgeCount: 1,
        protocol: "adb"
      })
    ).toBe("tools_missing");
  });

  it("returns online_no_device when tools are available but no target is selected", () => {
    expect(
      deriveBridgePanelStatus({
        health: connectedHealth,
        bridgeCount: 1,
        protocol: "hdc"
      })
    ).toBe("online_no_device");
  });
});

describe("detect failure mapping", () => {
  it("maps adb/hdc not found errors to tool install guidance", () => {
    expect(isToolMissingDetectError("ADB exited with 127: adb not found")).toBe(true);
    expect(
      formatDetectFailureMessage({
        error: new Error("adb not found"),
        health: null,
        protocol: "adb",
        formatError: (error) => (error instanceof Error ? error.message : "failed")
      })
    ).toBe("缺少 ADB 调试工具，请先安装调试工具。");
  });
});
