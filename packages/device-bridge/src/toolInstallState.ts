import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveToolsRoot, type DebugProtocol } from "./toolPaths";

export type InstalledToolRecord = {
  version: string;
  sha256: string;
  installedAt: string;
};

export type ToolInstallState = {
  adb?: InstalledToolRecord;
  hdc?: InstalledToolRecord;
};

export type ToolInstallStateOptions = {
  platform?: NodeJS.Platform;
  localAppData?: string;
  homeDir?: string;
  toolsRoot?: string;
};

function stateFilePath(options: ToolInstallStateOptions = {}) {
  const root = options.toolsRoot ?? resolveToolsRoot(options);
  return path.join(root, "state.json");
}

export async function readToolInstallState(options: ToolInstallStateOptions = {}): Promise<ToolInstallState> {
  try {
    const raw = await readFile(stateFilePath(options), "utf8");
    const parsed = JSON.parse(raw) as ToolInstallState;
    return parsed ?? {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

export async function writeToolInstallState(state: ToolInstallState, options: ToolInstallStateOptions = {}) {
  const filePath = stateFilePath(options);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export async function recordToolInstall(
  protocol: DebugProtocol,
  record: InstalledToolRecord,
  options: ToolInstallStateOptions = {}
) {
  const current = await readToolInstallState(options);
  const next: ToolInstallState = { ...current, [protocol]: record };
  await writeToolInstallState(next, options);
  return next;
}

export async function getInstalledToolVersion(
  protocol: DebugProtocol,
  options: ToolInstallStateOptions = {}
): Promise<string | undefined> {
  const state = await readToolInstallState(options);
  return state[protocol]?.version;
}
