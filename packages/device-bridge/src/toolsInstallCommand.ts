import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { detectBridgePlatform } from "./config";
import { getInstalledToolVersion, readToolInstallState, recordToolInstall } from "./toolInstallState";
import { resolveManagedToolPath, resolveToolsRoot, type DebugProtocol } from "./toolPaths";

export type ToolInstallProtocol = DebugProtocol | "all";

export type BridgeToolReleaseItem = {
  platform: "windows" | "darwin" | "linux";
  arch: string;
  protocol: DebugProtocol;
  version: string;
  downloadUrl: string;
  sha256: string;
};

export type BridgeToolReleaseManifest = {
  recommendedVersion: string;
  minCompatibleVersion: string;
  items: BridgeToolReleaseItem[];
};

type InstallProgress = {
  onStatus?: (status: {
    status: "running" | "succeeded" | "failed";
    protocol?: ToolInstallProtocol;
    error?: string;
  }) => void;
};

function normalizeArch(arch: string) {
  if (arch === "x64" || arch === "x86_64") {
    return "amd64";
  }
  if (arch === "arm64" || arch === "aarch64") {
    return "arm64";
  }
  return arch;
}

function resolveHostArch(platform: NodeJS.Platform = process.platform) {
  return normalizeArch(process.arch);
}

async function sha256File(filePath: string) {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

async function extractArchive(archivePath: string, destination: string) {
  return defaultExtractArchive(archivePath, destination);
}

export async function defaultExtractArchive(archivePath: string, destination: string) {
  await mkdir(destination, { recursive: true });
  if (archivePath.endsWith(".zip")) {
    if (process.platform === "win32") {
      const result = spawnSync(
        "powershell",
        ["-NoProfile", "-Command", `Expand-Archive -Path '${archivePath.replace(/'/g, "''")}' -DestinationPath '${destination.replace(/'/g, "''")}' -Force`],
        { encoding: "utf8" }
      );
      if (result.status !== 0) {
        throw new Error(result.stderr || "Failed to extract zip archive.");
      }
      return;
    }
    const result = spawnSync("unzip", ["-o", archivePath, "-d", destination], { encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(result.stderr || "Failed to extract zip archive.");
    }
    return;
  }
  if (archivePath.endsWith(".tar.gz") || archivePath.endsWith(".tgz")) {
    const result = spawnSync("tar", ["-xzf", archivePath, "-C", destination], { encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(result.stderr || "Failed to extract tar.gz archive.");
    }
    return;
  }
  throw new Error(`Unsupported archive format: ${path.basename(archivePath)}`);
}

async function chmodExecutable(filePath: string) {
  if (process.platform === "win32") {
    return;
  }
  await chmod(filePath, 0o755);
}

async function ensureManagedBinaryLayout(protocol: DebugProtocol, version: string, toolsRoot: string) {
  const managedPath = resolveManagedToolPath(protocol, version, { toolsRoot, platform: process.platform });
  if (protocol === "adb") {
    const platformToolsDir = path.dirname(managedPath);
    const nestedAdb = path.join(platformToolsDir, process.platform === "win32" ? "adb.exe" : "adb");
    try {
      await readFile(nestedAdb);
      if (nestedAdb !== managedPath) {
        await mkdir(path.dirname(managedPath), { recursive: true });
        await writeFile(managedPath, await readFile(nestedAdb));
        await chmodExecutable(managedPath);
      }
    } catch {
      // layout already matches managed path
    }
  }
  await chmodExecutable(managedPath);
}

export async function fetchToolReleaseManifest(serverUrl: string, fetchImpl: typeof fetch = fetch) {
  const response = await fetchImpl(`${serverUrl.replace(/\/$/, "")}/api/v1/device-bridges/tool-releases`);
  if (!response.ok) {
    throw new Error(`Tool release manifest request failed with ${response.status}.`);
  }
  return (await response.json()) as BridgeToolReleaseManifest;
}

export function selectToolReleaseItems(input: {
  manifest: BridgeToolReleaseManifest;
  protocol: ToolInstallProtocol;
  platform?: ReturnType<typeof detectBridgePlatform>;
  arch?: string;
}) {
  const platform = input.platform ?? detectBridgePlatform();
  const arch = normalizeArch(input.arch ?? resolveHostArch());
  const protocols: DebugProtocol[] =
    input.protocol === "all" ? ["adb", "hdc"] : [input.protocol];

  return protocols.map((protocol) => {
    const item = input.manifest.items.find(
      (entry) => entry.platform === platform && entry.arch === arch && entry.protocol === protocol
    );
    if (!item) {
      throw new Error(`No tool artifact found for ${platform}/${arch}/${protocol}.`);
    }
    return item;
  });
}

export async function installToolReleaseItem(input: {
  serverUrl: string;
  item: BridgeToolReleaseItem;
  toolsRoot?: string;
  fetchImpl?: typeof fetch;
  force?: boolean;
  extractArchive?: typeof defaultExtractArchive;
}) {
  const fetchImpl = input.fetchImpl ?? fetch;
  const toolsRoot = input.toolsRoot ?? resolveToolsRoot();
  const extract = input.extractArchive ?? defaultExtractArchive;
  const installedVersion = await getInstalledToolVersion(input.item.protocol, { toolsRoot });
  if (!input.force && installedVersion === input.item.version) {
    const state = await readToolInstallState({ toolsRoot });
    const record = state[input.item.protocol];
    if (record?.sha256 === input.item.sha256) {
      return { skipped: true as const, item: input.item };
    }
  }

  const downloadUrl = new URL(input.item.downloadUrl, input.serverUrl).toString();
  const response = await fetchImpl(downloadUrl);
  if (!response.ok) {
    throw new Error(`Tool download failed with ${response.status}.`);
  }

  const tempDir = path.join(toolsRoot, ".tmp", `${input.item.protocol}-${Date.now()}`);
  const archivePath = path.join(tempDir, path.basename(input.item.downloadUrl));
  await mkdir(path.dirname(archivePath), { recursive: true });
  await writeFile(archivePath, Buffer.from(await response.arrayBuffer()));

  const digest = await sha256File(archivePath);
  if (digest !== input.item.sha256) {
    throw new Error(`SHA256 mismatch for ${input.item.protocol} artifact.`);
  }

  const extractRoot = path.join(toolsRoot, input.item.protocol, input.item.version);
  await mkdir(extractRoot, { recursive: true });
  await extract(archivePath, extractRoot);
  await ensureManagedBinaryLayout(input.item.protocol, input.item.version, toolsRoot);

  await recordToolInstall(
    input.item.protocol,
    {
      version: input.item.version,
      sha256: input.item.sha256,
      installedAt: new Date().toISOString()
    },
    { toolsRoot }
  );

  return { skipped: false as const, item: input.item };
}

export async function runToolsInstallCommand(input: {
  serverUrl: string;
  protocol: ToolInstallProtocol;
  toolsRoot?: string;
  fetchImpl?: typeof fetch;
  force?: boolean;
  platform?: ReturnType<typeof detectBridgePlatform>;
  arch?: string;
  extractArchive?: typeof defaultExtractArchive;
} & InstallProgress) {
  input.onStatus?.({ status: "running", protocol: input.protocol });
  try {
    const manifest = await fetchToolReleaseManifest(input.serverUrl, input.fetchImpl);
    const items = selectToolReleaseItems({
      manifest,
      protocol: input.protocol,
      platform: input.platform,
      arch: input.arch
    });

    for (const item of items) {
      await installToolReleaseItem({
        serverUrl: input.serverUrl,
        item,
        toolsRoot: input.toolsRoot,
        fetchImpl: input.fetchImpl,
        force: input.force,
        extractArchive: input.extractArchive
      });
    }

    input.onStatus?.({ status: "succeeded", protocol: input.protocol });
    return { ok: true as const, items };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tool install failed.";
    input.onStatus?.({ status: "failed", protocol: input.protocol, error: message });
    throw error;
  }
}
