import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveDeviceBridgeDownloadUrl } from "./deviceBridgeDownloadUrl";

describe("resolveDeviceBridgeDownloadUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("prefixes API origin when the SPA runs on a different port", () => {
    vi.stubEnv("MODE", "development");
    vi.stubEnv("VITE_WISEEFF_API_BASE_URL", "http://127.0.0.1:8787");
    vi.stubGlobal("window", {
      location: {
        origin: "http://127.0.0.1:5173"
      }
    } as Window);

    expect(
      resolveDeviceBridgeDownloadUrl(
        "/downloads/device-bridge/0.1.0/darwin/arm64/WiseEffBridge_0.1.0_darwin_arm64.pkg"
      )
    ).toBe("http://127.0.0.1:8787/downloads/device-bridge/0.1.0/darwin/arm64/WiseEffBridge_0.1.0_darwin_arm64.pkg");
  });

  it("keeps relative paths when page and API share the same origin", () => {
    vi.stubEnv("MODE", "development");
    vi.stubEnv("VITE_WISEEFF_API_BASE_URL", "http://127.0.0.1:8787");
    vi.stubGlobal("window", {
      location: {
        origin: "http://127.0.0.1:8787"
      }
    } as Window);

    expect(
      resolveDeviceBridgeDownloadUrl(
        "/downloads/device-bridge/0.1.0/darwin/arm64/WiseEffBridge_0.1.0_darwin_arm64.pkg"
      )
    ).toBe("/downloads/device-bridge/0.1.0/darwin/arm64/WiseEffBridge_0.1.0_darwin_arm64.pkg");
  });

  it("returns absolute URLs unchanged", () => {
    expect(resolveDeviceBridgeDownloadUrl("https://example.com/bridge.pkg")).toBe("https://example.com/bridge.pkg");
  });
});
