import { describe, expect, it } from "vitest";

import {
  bridgeHostTargetLabel,
  bridgeReleaseDownloadLabel,
  detectBrowserBridgeTarget,
  isBridgeReleaseForHost,
  listInstallerBridgeReleases,
  listPortableBridgeReleases,
  pickBridgeReleaseForHost,
  pickHostPortableRelease,
  type BrowserBridgeTarget
} from "./bridgeReleaseSelection";
import type { DeviceBridgeReleaseItem } from "./deviceBridgeClient";

const releases: DeviceBridgeReleaseItem[] = [
  {
    platform: "windows",
    arch: "amd64",
    version: "0.1.0",
    downloadUrl: "/downloads/device-bridge/0.1.0/windows/amd64/wiseeff-bridge_0.1.0_windows_amd64.zip",
    artifactKind: "portable"
  },
  {
    platform: "darwin",
    arch: "arm64",
    version: "0.1.0",
    downloadUrl: "/downloads/device-bridge/0.1.0/darwin/arm64/wiseeff-bridge_0.1.0_darwin_arm64.tar.gz",
    artifactKind: "portable"
  },
  {
    platform: "darwin",
    arch: "amd64",
    version: "0.1.0",
    downloadUrl: "/downloads/device-bridge/0.1.0/darwin/amd64/wiseeff-bridge_0.1.0_darwin_amd64.tar.gz",
    artifactKind: "portable"
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

  it("prefers installer artifact over portable zip for primary CTA", () => {
    const items: DeviceBridgeReleaseItem[] = [
      {
        platform: "darwin",
        arch: "arm64",
        version: "0.1.0",
        downloadUrl: "/downloads/device-bridge/0.1.0/darwin/arm64/wiseeff-bridge_0.1.0_darwin_arm64.tar.gz",
        artifactKind: "portable"
      },
      {
        platform: "darwin",
        arch: "arm64",
        version: "0.1.0",
        downloadUrl: "/downloads/device-bridge/0.1.0/darwin/arm64/WiseEffBridge_0.1.0_darwin_arm64.pkg",
        artifactKind: "installer"
      }
    ];
    expect(pickBridgeReleaseForHost(items, { platform: "darwin", arch: "arm64" })?.downloadUrl).toContain(".pkg");
  });

  it("falls back to another arch on the same platform", () => {
    const target: BrowserBridgeTarget = { platform: "darwin", arch: "unknown" };
    expect(pickBridgeReleaseForHost(releases, target)?.platform).toBe("darwin");
  });

  it("labels macOS downloads clearly", () => {
    expect(bridgeReleaseDownloadLabel(releases[1]!)).toBe("下载 macOS Bridge（Apple Silicon）");
  });

  it("labels the detected host environment", () => {
    expect(bridgeHostTargetLabel({ platform: "darwin", arch: "arm64" })).toBe("macOS（Apple Silicon）");
    expect(bridgeHostTargetLabel({ platform: "windows", arch: "amd64" })).toBe("Windows（x64）");
  });

  it("matches releases to the host target", () => {
    expect(isBridgeReleaseForHost(releases[1]!, { platform: "darwin", arch: "arm64" })).toBe(true);
    expect(isBridgeReleaseForHost(releases[0]!, { platform: "darwin", arch: "arm64" })).toBe(false);
  });

  it("picks the host portable release", () => {
    expect(pickHostPortableRelease(releases, { platform: "darwin", arch: "arm64" })?.downloadUrl).toContain("darwin/arm64");
  });

  it("labels installer downloads for primary CTA", () => {
    expect(
      bridgeReleaseDownloadLabel({
        platform: "windows",
        arch: "amd64",
        version: "0.1.0",
        downloadUrl: "/downloads/device-bridge/0.1.0/windows/amd64/WiseEffBridgeSetup_0.1.0.exe",
        artifactKind: "installer"
      })
    ).toBe("安装 Bridge（Windows）");
  });

  it("lists installer alternates excluding the primary release", () => {
    const items: DeviceBridgeReleaseItem[] = [
      {
        platform: "darwin",
        arch: "arm64",
        version: "0.1.0",
        downloadUrl: "/downloads/device-bridge/0.1.0/darwin/arm64/WiseEffBridge_0.1.0_darwin_arm64.pkg",
        artifactKind: "installer"
      },
      {
        platform: "windows",
        arch: "amd64",
        version: "0.1.0",
        downloadUrl: "/downloads/device-bridge/0.1.0/windows/amd64/WiseEffBridgeSetup_0.1.0.exe",
        artifactKind: "installer"
      },
      {
        platform: "darwin",
        arch: "arm64",
        version: "0.1.0",
        downloadUrl: "/downloads/device-bridge/0.1.0/darwin/arm64/wiseeff-bridge_0.1.0_darwin_arm64.tar.gz",
        artifactKind: "portable"
      }
    ];
    const primary = items[0];
    expect(listInstallerBridgeReleases(items, primary).map((item) => item.downloadUrl)).toEqual([
      "/downloads/device-bridge/0.1.0/windows/amd64/WiseEffBridgeSetup_0.1.0.exe"
    ]);
    expect(listPortableBridgeReleases(items, null).length).toBe(1);
  });
});
