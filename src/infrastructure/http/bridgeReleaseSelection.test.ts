import { describe, expect, it } from "vitest";

import {
  bridgeReleaseDownloadLabel,
  detectBrowserBridgeTarget,
  pickBridgeReleaseForHost,
  type BrowserBridgeTarget
} from "./bridgeReleaseSelection";
import type { DeviceBridgeReleaseItem } from "./deviceBridgeClient";

const releases: DeviceBridgeReleaseItem[] = [
  {
    platform: "windows",
    arch: "amd64",
    version: "0.1.0",
    downloadUrl: "/downloads/device-bridge/0.1.0/windows/amd64/wiseeff-bridge_0.1.0_windows_amd64.zip"
  },
  {
    platform: "darwin",
    arch: "arm64",
    version: "0.1.0",
    downloadUrl: "/downloads/device-bridge/0.1.0/darwin/arm64/wiseeff-bridge_0.1.0_darwin_arm64.tar.gz"
  },
  {
    platform: "darwin",
    arch: "amd64",
    version: "0.1.0",
    downloadUrl: "/downloads/device-bridge/0.1.0/darwin/amd64/wiseeff-bridge_0.1.0_darwin_amd64.tar.gz"
  }
];

describe("bridgeReleaseSelection", () => {
  it("detects macOS from user agent", () => {
    expect(detectBrowserBridgeTarget("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")).toEqual({
      platform: "darwin",
      arch: "arm64"
    });
  });

  it("detects Windows from user agent", () => {
    expect(detectBrowserBridgeTarget("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toEqual({
      platform: "windows",
      arch: "amd64"
    });
  });

  it("picks the host-matching release", () => {
    const target: BrowserBridgeTarget = { platform: "darwin", arch: "arm64" };
    expect(pickBridgeReleaseForHost(releases, target)?.downloadUrl).toContain("darwin/arm64");
  });

  it("falls back to another arch on the same platform", () => {
    const target: BrowserBridgeTarget = { platform: "darwin", arch: "unknown" };
    expect(pickBridgeReleaseForHost(releases, target)?.platform).toBe("darwin");
  });

  it("labels macOS downloads clearly", () => {
    expect(bridgeReleaseDownloadLabel(releases[1]!)).toBe("下载 macOS Bridge（Apple Silicon）");
  });
});
