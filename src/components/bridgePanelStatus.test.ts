import { describe, expect, it } from "vitest";

import { deriveBridgePanelStatus, formatDetectFailureMessage, isToolMissingDetectError } from "./bridgePanelStatus";
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
