import type { DeviceBridgePlatform } from "./deviceBridgeClient";

export function defaultBridgeCliPath(platform: DeviceBridgePlatform): string {
  switch (platform) {
    case "windows":
      return "%LOCALAPPDATA%\\WiseEff\\Bridge\\wiseeff-bridge.cmd";
    case "darwin":
      return "/Applications/WiseEff Bridge.app/Contents/Resources/wiseeff-bridge";
    default:
      return "./wiseeff-bridge";
  }
}

export function formatBridgeConnectFallbackCommand(input: {
  platform: DeviceBridgePlatform;
  serverUrl: string;
  webOrigin: string;
  code?: string;
}): string {
  const base = `"${defaultBridgeCliPath(input.platform)}" connect --server ${input.serverUrl} --webOrigin ${input.webOrigin}`;
  return input.code ? `${base} --code ${input.code}` : base;
}

export function formatBridgeServiceInstallCommand(platform: DeviceBridgePlatform): string {
  return `"${defaultBridgeCliPath(platform)}" service install`;
}

export function isRemoteWebOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return host !== "localhost" && host !== "127.0.0.1" && host !== "[::1]";
  } catch {
    return false;
  }
}
