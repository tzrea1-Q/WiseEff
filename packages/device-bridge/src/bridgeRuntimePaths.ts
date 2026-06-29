import { existsSync } from "node:fs";
import path from "node:path";

function pathForPlatform(platform: NodeJS.Platform) {
  return platform === "win32" ? path.win32 : path;
}

export function resolveBundledNodePath(
  cliPath: string,
  fallbackExecPath: string,
  platform: NodeJS.Platform = process.platform
): string {
  const pathApi = pathForPlatform(platform);
  const bundledNode = pathApi.join(pathApi.dirname(cliPath), "node.exe");
  if (existsSync(bundledNode)) {
    return bundledNode;
  }
  return fallbackExecPath;
}

export function resolveBridgeLauncherPath(cliPath: string, platform: NodeJS.Platform = process.platform): string {
  const pathApi = pathForPlatform(platform);

  if (platform === "darwin") {
    const wrapperPath = pathApi.join(pathApi.dirname(cliPath), "wiseeff-bridge");
    if (existsSync(wrapperPath)) {
      return wrapperPath;
    }
  }

  if (platform === "win32") {
    const launcher = resolveWindowsBridgeLauncher(cliPath, platform);
    if (launcher) {
      return launcher;
    }
  }

  return cliPath;
}

export function resolveWindowsBridgeLauncher(cliPath: string, platform: NodeJS.Platform = process.platform): string | null {
  const pathApi = pathForPlatform(platform);
  const directory = pathApi.dirname(cliPath);
  const candidates = ["wiseeff-bridge.cmd", "wiseeff-bridge.exe"];
  for (const name of candidates) {
    const candidate = pathApi.join(directory, name);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function resolveDetachedBridgeStartCommand(input: {
  platform: NodeJS.Platform;
  execPath: string;
  cliPath: string;
}): { command: string; args: string[] } {
  const pathApi = pathForPlatform(input.platform);

  if (input.platform === "darwin") {
    const wrapperPath = pathApi.join(pathApi.dirname(input.cliPath), "wiseeff-bridge");
    if (existsSync(wrapperPath)) {
      return { command: wrapperPath, args: ["start"] };
    }
  }

  if (input.platform === "win32") {
    const launcher = resolveWindowsBridgeLauncher(input.cliPath, input.platform);
    if (launcher) {
      return { command: launcher, args: ["start"] };
    }
  }

  return {
    command: resolveBundledNodePath(input.cliPath, input.execPath, input.platform),
    args: [input.cliPath, "start"]
  };
}

export function pairingStartupErrorMessage(platform: NodeJS.Platform): string {
  if (platform === "win32") {
    return "配对或启动失败。请确认 WiseEff Bridge 已安装并运行，或查看 %LOCALAPPDATA%\\WiseEff\\device-bridge\\ 与 bridge-start.log。";
  }
  if (platform === "darwin") {
    return "配对或启动失败。请确认已安装 Node.js 20+，并查看 ~/.wiseeff/bridge-launch.log。";
  }
  return "配对或启动失败。请确认 Node.js 20+ 已安装，并查看 ~/.wiseeff/bridge-launch.log。";
}
