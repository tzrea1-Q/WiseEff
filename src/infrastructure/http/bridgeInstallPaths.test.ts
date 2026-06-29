import { describe, expect, it } from "vitest";

import {
  defaultBridgeCliPath,
  formatBridgeConnectFallbackCommand,
  formatBridgeHandleUrlFallbackCommand,
  isRemoteWebOrigin,
  bridgeCliDiscoveryHint
} from "./bridgeInstallPaths";

describe("bridgeInstallPaths", () => {
  it("returns platform-specific default CLI paths", () => {
    expect(defaultBridgeCliPath("windows")).toContain("LOCALAPPDATA");
    expect(defaultBridgeCliPath("darwin")).toContain("WiseEff Bridge.app");
  });

  it("builds connect fallback commands with optional pairing code", () => {
    expect(
      formatBridgeConnectFallbackCommand({
        platform: "windows",
        serverUrl: "http://101.43.45.27",
        webOrigin: "http://101.43.45.27",
        code: "123456"
      })
    ).toContain("wiseeff-bridge.cmd");
    expect(
      formatBridgeConnectFallbackCommand({
        platform: "darwin",
        serverUrl: "http://101.43.45.27",
        webOrigin: "http://101.43.45.27"
      })
    ).not.toContain("--code");
  });

  it("uses health launcherPath when provided", () => {
    expect(
      formatBridgeConnectFallbackCommand({
        platform: "windows",
        serverUrl: "http://101.43.45.27",
        webOrigin: "http://101.43.45.27",
        code: "123456",
        cliPath: "C:\\Custom\\Bridge\\wiseeff-bridge.cmd"
      })
    ).toContain("C:\\Custom\\Bridge\\wiseeff-bridge.cmd");
  });

  it("provides platform-specific CLI discovery hints", () => {
    expect(bridgeCliDiscoveryHint("windows")).toContain("开始菜单");
  });

  it("builds handle-url fallback commands for Windows", () => {
    expect(
      formatBridgeHandleUrlFallbackCommand({
        cliPath: "C:\\Bridge\\wiseeff-bridge.cmd",
        connectUrl: "wiseeff-bridge://connect?server=http%3A%2F%2F101.43.45.27&code=123456"
      })
    ).toContain("--handle-url");
  });

  it("detects remote web origins", () => {
    expect(isRemoteWebOrigin("http://101.43.45.27")).toBe(true);
    expect(isRemoteWebOrigin("http://127.0.0.1:5173")).toBe(false);
  });
});
