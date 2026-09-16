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
        health: runningUnpairedHealth
      })
    ).toContain("尚未完成配对");
  });

  it("prefers pairing errors from health", () => {
    expect(
      describeBridgeConnectFailureMessage({
        health: { ...runningUnpairedHealth, pairingError: "配对码无效" }
      })
    ).toBe("配对码无效");
  });

  it("does not describe a foreign-account local bridge as an expired token", () => {
    expect(
      describeBridgeConnectFailureMessage({
        health: {
          ok: true,
          paired: true,
          connected: true,
          bridgeId: "br-A",
          updatedAt: "2026-09-16T00:00:00.000Z"
        },
        previousBridgeId: "br-A",
        registeredBridgeIds: ["br-B"],
        reconnectAttempted: true
      })
    ).toContain("仍在运行旧账号");
    expect(
      describeBridgeConnectFailureMessage({
        health: {
          ok: true,
          paired: true,
          connected: true,
          bridgeId: "br-A",
          updatedAt: "2026-09-16T00:00:00.000Z"
        },
        previousBridgeId: "br-A",
        registeredBridgeIds: ["br-B"],
        reconnectAttempted: true
      })
    ).not.toContain("配对已失效");
  });

  it("reports a listing failure instead of pairing expiry", () => {
    expect(
      describeBridgeConnectFailureMessage({
        health: {
          ok: true,
          paired: true,
          connected: true,
          bridgeId: "br-B",
          updatedAt: "2026-09-16T00:00:00.000Z"
        },
        listingFailed: true,
        listingError: "代理列表暂时不可用",
        reconnectAttempted: true,
        previousBridgeId: "br-A"
      })
    ).toContain("刷新当前账号的设备代理列表失败");
  });

  it("reports an old installer when local HTTP connect is unsupported", () => {
    expect(
      describeBridgeConnectFailureMessage({
        health: {
          ok: true,
          paired: true,
          connected: true,
          bridgeId: "br-A",
          updatedAt: "2026-09-16T00:00:00.000Z"
        },
        connectResult: { ok: false, reachable: true, error: "connect_unsupported" },
        previousBridgeId: "br-A",
        reconnectAttempted: true
      })
    ).toContain("不支持安全重新绑定");
  });

  it("reports websocket offline after pair when the new bridge is registered but not connected", () => {
    expect(
      describeBridgeConnectFailureMessage({
        health: {
          ok: true,
          paired: true,
          connected: false,
          bridgeId: "br-B",
          updatedAt: "2026-09-16T00:00:00.000Z"
        },
        registeredBridgeIds: ["br-B"],
        previousBridgeId: "br-A",
        reconnectAttempted: true
      })
    ).toContain("尚未连接到服务器");
  });

  it("reports pairing-code expiry from health pairingError", () => {
    expect(
      describeBridgeConnectFailureMessage({
        health: {
          ...runningUnpairedHealth,
          pairingError: "配对码无效、已过期或已被使用。请回到网页重新生成配对码后再试。"
        },
        reconnectAttempted: true
      })
    ).toContain("已过期");
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
