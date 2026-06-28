import { describe, expect, it } from "vitest";

import {
  defaultBridgeCliPath,
  formatBridgeConnectFallbackCommand,
  isRemoteWebOrigin
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
    ).toContain("wiseeff-bridge.exe");
    expect(
      formatBridgeConnectFallbackCommand({
        platform: "darwin",
        serverUrl: "http://101.43.45.27",
        webOrigin: "http://101.43.45.27"
      })
    ).not.toContain("--code");
  });

  it("detects remote web origins", () => {
    expect(isRemoteWebOrigin("http://101.43.45.27")).toBe(true);
    expect(isRemoteWebOrigin("http://127.0.0.1:5173")).toBe(false);
  });
});
