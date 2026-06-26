import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const BRIDGE_CONFIG_BASENAME = "bridge.json";

export type BridgeConfig = {
  bridgeId: string;
  bridgeToken: string;
  tokenExpiresAt: string;
  serverUrl: string;
  /** Browser origin allowed to read local bridge health from a deployed web UI. */
  webOrigin?: string;
  machineLabel: string;
  platform: "windows" | "darwin" | "linux";
  arch: string;
  clientVersion?: string;
  pairedAt: string;
};

export type ResolveBridgeConfigPathOptions = {
  platform?: NodeJS.Platform;
  localAppData?: string;
  homeDir?: string;
};

function normalizePlatform(platform: NodeJS.Platform): BridgeConfig["platform"] {
  if (platform === "win32") {
    return "windows";
  }
  if (platform === "darwin") {
    return "darwin";
  }
  return "linux";
}

export function detectBridgePlatform(platform: NodeJS.Platform = process.platform): BridgeConfig["platform"] {
  return normalizePlatform(platform);
}

export function resolveBridgeConfigPath(options: ResolveBridgeConfigPathOptions = {}) {
  const platform = options.platform ?? process.platform;
  const localAppData = options.localAppData ?? process.env.LOCALAPPDATA;
  const homeDir = options.homeDir ?? os.homedir();

  if (platform === "win32" && localAppData) {
    return path.join(localAppData, "WiseEff", BRIDGE_CONFIG_BASENAME);
  }

  return path.join(homeDir, ".wiseeff", BRIDGE_CONFIG_BASENAME);
}

export async function loadBridgeConfig(configPath = resolveBridgeConfigPath()): Promise<BridgeConfig | null> {
  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as BridgeConfig;
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function saveBridgeConfig(config: BridgeConfig, configPath = resolveBridgeConfigPath()) {
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}
