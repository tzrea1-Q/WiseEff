import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type DebugProtocol = "adb" | "hdc";

export type ToolBinarySource = "managed" | "system";

export type ResolvedToolBinary = {
  command: string;
  source: ToolBinarySource;
};

export type ResolveToolsRootOptions = {
  platform?: NodeJS.Platform;
  localAppData?: string;
  homeDir?: string;
  toolsRoot?: string;
};

export function resolveToolsRoot(options: ResolveToolsRootOptions = {}) {
  if (options.toolsRoot) {
    return options.toolsRoot;
  }

  const platform = options.platform ?? process.platform;
  const localAppData = options.localAppData ?? process.env.LOCALAPPDATA;
  const homeDir = options.homeDir ?? os.homedir();

  if (platform === "win32" && localAppData) {
    return path.join(localAppData, "WiseEff", "tools");
  }

  if (platform === "darwin") {
    return path.join(homeDir, "Library", "Application Support", "WiseEff", "tools");
  }

  return path.join(homeDir, ".wiseeff", "tools");
}

function executableName(protocol: DebugProtocol, platform: NodeJS.Platform) {
  const base = protocol === "adb" ? "adb" : "hdc";
  return platform === "win32" ? `${base}.exe` : base;
}

function managedRelativePath(protocol: DebugProtocol, version: string, platform: NodeJS.Platform) {
  const executable = executableName(protocol, platform);
  if (protocol === "adb") {
    return path.join("adb", version, "platform-tools", executable);
  }
  return path.join("hdc", version, executable);
}

export function resolveManagedToolPath(
  protocol: DebugProtocol,
  version: string,
  options: ResolveToolsRootOptions = {}
) {
  const platform = options.platform ?? process.platform;
  return path.join(resolveToolsRoot(options), managedRelativePath(protocol, version, platform));
}

async function isExecutable(filePath: string) {
  try {
    await access(filePath, os.constants.X_OK);
    return true;
  } catch {
    try {
      await access(filePath);
      return process.platform === "win32";
    } catch {
      return false;
    }
  }
}

export async function resolveToolBinary(
  protocol: DebugProtocol,
  input: ResolveToolsRootOptions & {
    installedVersion?: string;
  } = {}
): Promise<ResolvedToolBinary> {
  const platform = input.platform ?? process.platform;
  const commandName = protocol === "adb" ? "adb" : "hdc";

  if (input.installedVersion) {
    const managedPath = resolveManagedToolPath(protocol, input.installedVersion, input);
    if (await isExecutable(managedPath)) {
      return { command: managedPath, source: "managed" };
    }
  }

  return { command: commandName, source: "system" };
}
