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
  cliPath?: string;
}): string {
  const launcher = input.cliPath?.trim() || defaultBridgeCliPath(input.platform);
  const base = `"${launcher}" connect --server ${input.serverUrl} --webOrigin ${input.webOrigin}`;
  return input.code ? `${base} --code ${input.code}` : base;
}

export function bridgeCliDiscoveryHint(platform: DeviceBridgePlatform): string {
  switch (platform) {
    case "windows":
      return "若下方路径无效，请在开始菜单右键「WiseEff Bridge」快捷方式 → 打开文件所在位置，使用该文件夹中的 wiseeff-bridge.cmd。";
    case "darwin":
      return "若下方路径无效，请使用 Bridge 安装目录或 /Applications/WiseEff Bridge.app 内的 wiseeff-bridge。";
    default:
      return "若下方路径无效，请使用 Bridge 安装目录中的 wiseeff-bridge 可执行文件。";
  }
}

export function formatBridgeHandleUrlFallbackCommand(input: { cliPath?: string; connectUrl: string }): string {
  const launcher = input.cliPath?.trim() || defaultBridgeCliPath("windows");
  return `"${launcher}" --handle-url "${input.connectUrl}"`;
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
