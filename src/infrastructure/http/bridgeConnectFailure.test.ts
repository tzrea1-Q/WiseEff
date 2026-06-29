import { describe, expect, it } from "vitest";

import {
  describeBridgeConnectFailureMessage,
  shouldShowBridgeConnectFallback
} from "./bridgeConnectFailure";
import type { LocalBridgeHealthState } from "./deviceBridgeClient";

const runningUnpairedHealth: LocalBridgeHealthState = {
  ok: true,
  paired: false,
  connected: false,
  launcherPath: "C:\\Users\\Admin\\AppData\\Local\\WiseEff\\Bridge-install-fix-test\\wiseeff-bridge.cmd",
  updatedAt: "2026-06-28T00:00:00.000Z"
};

describe("bridgeConnectFailure", () => {
  it("describes pairing failures when bridge is running but unpaired", () => {
    expect(
      describeBridgeConnectFailureMessage({
        health: runningUnpairedHealth,
        pairingStale: false,
        pairingAuthFailure: false
      })
    ).toContain("尚未完成配对");
  });

  it("prefers pairing errors from health", () => {
    expect(
      describeBridgeConnectFailureMessage({
        health: { ...runningUnpairedHealth, pairingError: "配对码无效" },
        pairingStale: false,
        pairingAuthFailure: false
      })
    ).toBe("配对码无效");
  });

  it("shows fallback on step 2 when bridge is reachable but not connected", () => {
    expect(
      shouldShowBridgeConnectFallback({
        viewStep: 2,
        pairingCode: null,
        health: runningUnpairedHealth
      })
    ).toBe(true);
  });
});
