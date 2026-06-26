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

function pickPreferredRelease(items: DeviceBridgeReleaseItem[]) {
  if (items.length === 0) {
    return null;
  }
  const installer = items.find((item) => item.artifactKind === "installer");
  return installer ?? items[0] ?? null;
}

export function pickBridgeReleaseForHost(
  items: DeviceBridgeReleaseItem[],
  target: BrowserBridgeTarget = detectBrowserBridgeTarget()
): DeviceBridgeReleaseItem | null {
  const exactMatches = items.filter((item) => item.platform === target.platform && item.arch === target.arch);
  const exact = pickPreferredRelease(exactMatches);
  if (exact) {
    return exact;
  }

  const samePlatform = items.filter((item) => item.platform === target.platform);
  const platformMatch = pickPreferredRelease(samePlatform);
  if (platformMatch) {
    return platformMatch;
  }

  return pickPreferredRelease(items);
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
  if (item.artifactKind === "installer") {
    if (item.platform === "windows") {
      return "安装 Bridge（Windows）";
    }
    if (item.platform === "darwin") {
      return item.arch === "arm64" ? "安装 Bridge（macOS Apple Silicon）" : "安装 Bridge（macOS Intel）";
    }
    return `安装 Bridge（${bridgePlatformLabel(item.platform)}）`;
  }

  const archLabel = item.arch === "arm64" ? "Apple Silicon" : item.arch === "amd64" ? "x64" : item.arch;
  return `下载 ${bridgePlatformLabel(item.platform)} Bridge（${archLabel}）`;
}

export function bridgeHostTargetLabel(target: BrowserBridgeTarget) {
  if (target.platform === "darwin") {
    if (target.arch === "arm64") {
      return "macOS（Apple Silicon）";
    }
    if (target.arch === "amd64") {
      return "macOS（Intel）";
    }
    return `macOS（${target.arch}）`;
  }
  if (target.platform === "windows") {
    return target.arch === "amd64" ? "Windows（x64）" : `Windows（${target.arch}）`;
  }
  return `${bridgePlatformLabel(target.platform)}（${target.arch}）`;
}

export function isBridgeReleaseForHost(item: DeviceBridgeReleaseItem, target: BrowserBridgeTarget) {
  return item.platform === target.platform && item.arch === target.arch;
}

export function pickHostPortableRelease(
  items: DeviceBridgeReleaseItem[],
  target: BrowserBridgeTarget = detectBrowserBridgeTarget()
) {
  const portableItems = items.filter((item) => item.artifactKind !== "installer");
  const exact = portableItems.find((item) => isBridgeReleaseForHost(item, target));
  if (exact) {
    return exact;
  }
  return portableItems.find((item) => item.platform === target.platform) ?? null;
}

export function listPortableBridgeReleases(items: DeviceBridgeReleaseItem[], primary: DeviceBridgeReleaseItem | null) {
  return items.filter((item) => {
    if (primary && item.downloadUrl === primary.downloadUrl) {
      return false;
    }
    return item.artifactKind !== "installer";
  });
}

export function listInstallerBridgeReleases(items: DeviceBridgeReleaseItem[], primary: DeviceBridgeReleaseItem | null) {
  return items.filter((item) => {
    if (item.artifactKind !== "installer") {
      return false;
    }
    if (primary && item.downloadUrl === primary.downloadUrl) {
      return false;
    }
    return true;
  });
}

export function listAlternateBridgeReleases(items: DeviceBridgeReleaseItem[], primary: DeviceBridgeReleaseItem | null) {
  return items.filter((item) => !primary || item.downloadUrl !== primary.downloadUrl);
}
