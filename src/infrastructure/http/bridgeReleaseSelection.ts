import type { DeviceBridgePlatform, DeviceBridgeReleaseItem } from "./deviceBridgeClient";

export type BrowserBridgeTarget = {
  platform: DeviceBridgePlatform;
  arch: string;
};

export function detectBrowserBridgeTarget(userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent): BrowserBridgeTarget {
  if (/Win/i.test(userAgent)) {
    return { platform: "windows", arch: "amd64" };
  }

  if (/Mac/i.test(userAgent)) {
    // Safari and Chromium on Apple Silicon still report "Intel Mac OS X" in UA.
    // Prefer arm64 first; pickBridgeReleaseForHost falls back to amd64 when needed.
    return { platform: "darwin", arch: "arm64" };
  }

  return { platform: "linux", arch: "amd64" };
}

export function pickBridgeReleaseForHost(
  items: DeviceBridgeReleaseItem[],
  target: BrowserBridgeTarget = detectBrowserBridgeTarget()
): DeviceBridgeReleaseItem | null {
  const exact = items.find((item) => item.platform === target.platform && item.arch === target.arch);
  if (exact) {
    return exact;
  }

  const samePlatform = items.find((item) => item.platform === target.platform);
  if (samePlatform) {
    return samePlatform;
  }

  return items[0] ?? null;
}

export function bridgePlatformLabel(platform: DeviceBridgePlatform) {
  switch (platform) {
    case "windows":
      return "Windows";
    case "darwin":
      return "macOS";
    case "linux":
      return "Linux";
  }
}

export function bridgeReleaseDownloadLabel(item: DeviceBridgeReleaseItem) {
  const archLabel = item.arch === "arm64" ? "Apple Silicon" : item.arch === "amd64" ? "x64" : item.arch;
  return `下载 ${bridgePlatformLabel(item.platform)} Bridge（${archLabel}）`;
}
