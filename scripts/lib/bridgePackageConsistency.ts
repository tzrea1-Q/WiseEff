import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const execFile = promisify(execFileCallback);

export const BRIDGE_RUNTIME_SOURCE_GLOBS = [
  "packages/device-bridge/src",
  "ops/self-hosted/bridge-installer",
  "scripts/build-device-bridge.ts",
  "scripts/build-bridge-installers.ts",
  "scripts/lib/bridgePackageConsistency.ts"
] as const;

export const REQUIRED_BRIDGE_BUNDLE_MARKERS = [
  'forceRestart: Boolean(input.code)',
  'pathname === "/connect"'
] as const;

type ManifestFile = {
  recommendedVersion: string;
  minCompatibleVersion: string;
  sourceFingerprint?: string;
  items: Array<{
    platform: string;
    arch: string;
    version: string;
    artifact: string;
    sha256?: string;
    artifactKind?: string;
  }>;
};

export type BridgePackageCheckFailure = {
  code: string;
  message: string;
};

async function listFilesRecursive(target: string): Promise<string[]> {
  const info = await stat(target);
  if (info.isFile()) {
    return [target];
  }
  const entries = await readdir(target, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const child = path.join(target, entry.name);
      if (entry.isDirectory()) {
        return listFilesRecursive(child);
      }
      return [child];
    })
  );
  return nested.flat();
}

function isRuntimeSourceFile(filePath: string) {
  const relative = filePath.replaceAll("\\", "/");
  if (relative.endsWith(".test.ts") || relative.endsWith(".md")) {
    return false;
  }
  return (
    relative.endsWith(".ts") ||
    relative.endsWith(".js") ||
    relative.endsWith(".sh") ||
    relative.endsWith(".cmd") ||
    relative.endsWith(".ps1") ||
    relative.endsWith(".iss") ||
    relative.endsWith(".plist") ||
    relative.endsWith(".swift") ||
    relative.endsWith(".template") ||
    relative.endsWith(".json")
  );
}

export async function collectBridgeRuntimeSourceFiles(rootDir: string): Promise<string[]> {
  const collected: string[] = [];
  for (const relative of BRIDGE_RUNTIME_SOURCE_GLOBS) {
    const absolute = path.join(rootDir, relative);
    try {
      const files = await listFilesRecursive(absolute);
      collected.push(...files.filter((file) => isRuntimeSourceFile(file)));
    } catch {
      throw new Error(`Bridge runtime source path is missing: ${relative}`);
    }
  }
  return [...new Set(collected)].sort((left, right) => left.localeCompare(right));
}

export async function computeBridgeSourceFingerprint(rootDir: string): Promise<string> {
  const files = await collectBridgeRuntimeSourceFiles(rootDir);
  const hash = createHash("sha256");
  for (const file of files) {
    const relative = path.relative(rootDir, file).replaceAll("\\", "/");
    const content = await readFile(file);
    hash.update(relative);
    hash.update("\n");
    hash.update(createHash("sha256").update(content).digest("hex"));
    hash.update("\n");
  }
  return hash.digest("hex");
}

export async function sha256File(filePath: string): Promise<string> {
  const { stdout } = await execFile("shasum", ["-a", "256", filePath]);
  return stdout.split(/\s+/)[0] ?? "";
}

export async function readBridgeClientVersion(rootDir: string): Promise<string> {
  const source = await readFile(path.join(rootDir, "packages/device-bridge/src/version.ts"), "utf8");
  const match = source.match(/BRIDGE_CLIENT_VERSION = "([^"]+)"/);
  if (!match?.[1]) {
    throw new Error("BRIDGE_CLIENT_VERSION is missing from packages/device-bridge/src/version.ts");
  }
  const packageJson = JSON.parse(
    await readFile(path.join(rootDir, "packages/device-bridge/package.json"), "utf8")
  ) as { version?: string };
  if (packageJson.version !== match[1]) {
    throw new Error(
      `packages/device-bridge/package.json version ${packageJson.version ?? "(missing)"} does not match BRIDGE_CLIENT_VERSION ${match[1]}`
    );
  }
  return match[1];
}

async function loadLatestManifest(rootDir: string): Promise<{ versionDir: string; manifestPath: string; manifest: ManifestFile }> {
  const artifactRoot = path.join(rootDir, "ops/self-hosted/bridge-artifacts");
  const entries = await readdir(artifactRoot, { withFileTypes: true });
  const versions = entries.filter((entry) => entry.isDirectory() && /^\d+\.\d+\.\d+$/.test(entry.name)).map((entry) => entry.name);
  if (versions.length === 0) {
    throw new Error("No versioned Bridge artifact directories were found.");
  }
  versions.sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  const versionDir = versions[versions.length - 1]!;
  const manifestPath = path.join(artifactRoot, versionDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as ManifestFile;
  return { versionDir, manifestPath, manifest };
}

async function extractArtifactText(artifactPath: string, member: string): Promise<string | null> {
  if (artifactPath.endsWith(".zip")) {
    try {
      const { stdout } = await execFile("unzip", ["-p", artifactPath, member]);
      return stdout;
    } catch {
      return null;
    }
  }
  if (artifactPath.endsWith(".tar.gz")) {
    try {
      const { stdout } = await execFile("tar", ["-xOf", artifactPath, member]);
      return stdout;
    } catch {
      return null;
    }
  }
  return null;
}

export async function checkBridgePackageConsistency(rootDir: string): Promise<{
  ok: boolean;
  failures: BridgePackageCheckFailure[];
  recommendedVersion?: string;
  sourceFingerprint?: string;
}> {
  const failures: BridgePackageCheckFailure[] = [];
  let clientVersion: string;
  try {
    clientVersion = await readBridgeClientVersion(rootDir);
  } catch (error) {
    return {
      ok: false,
      failures: [{ code: "version", message: error instanceof Error ? error.message : String(error) }]
    };
  }

  let latest: { versionDir: string; manifestPath: string; manifest: ManifestFile };
  try {
    latest = await loadLatestManifest(rootDir);
  } catch (error) {
    return {
      ok: false,
      failures: [{ code: "manifest", message: error instanceof Error ? error.message : String(error) }]
    };
  }

  if (latest.manifest.recommendedVersion !== clientVersion) {
    failures.push({
      code: "version-mismatch",
      message: `manifest recommendedVersion ${latest.manifest.recommendedVersion} does not match Bridge clientVersion ${clientVersion}`
    });
  }
  if (latest.versionDir !== clientVersion) {
    failures.push({
      code: "artifact-dir",
      message: `latest artifact directory ${latest.versionDir} does not match Bridge clientVersion ${clientVersion}`
    });
  }

  const sourceFingerprint = await computeBridgeSourceFingerprint(rootDir);
  if (!latest.manifest.sourceFingerprint) {
    failures.push({
      code: "missing-fingerprint",
      message: "Bridge manifest is missing sourceFingerprint. Rebuild with npm run bridge:build."
    });
  } else if (latest.manifest.sourceFingerprint !== sourceFingerprint) {
    failures.push({
      code: "stale-fingerprint",
      message:
        "Bridge runtime source changed but published artifacts/manifest were not rebuilt. Run npm run bridge:build and npm run build:bridge-installers."
    });
  }

  const versionRoot = path.dirname(latest.manifestPath);
  let inspectedBundle = false;
  for (const item of latest.manifest.items) {
    const artifactPath = path.join(versionRoot, item.platform, item.arch, item.artifact);
    try {
      await stat(artifactPath);
    } catch {
      if (item.sha256 === "0".repeat(64)) {
        continue;
      }
      failures.push({
        code: "missing-artifact",
        message: `manifest lists ${item.artifact} but the file is missing`
      });
      continue;
    }
    if (item.sha256 && item.sha256 !== "0".repeat(64)) {
      const digest = await sha256File(artifactPath);
      if (digest !== item.sha256) {
        failures.push({
          code: "sha256-mismatch",
          message: `${item.artifact} sha256 ${digest} does not match manifest ${item.sha256}`
        });
      }
    }
    const bundled = await extractArtifactText(artifactPath, "cli.js");
    if (bundled) {
      inspectedBundle = true;
      for (const marker of REQUIRED_BRIDGE_BUNDLE_MARKERS) {
        if (!bundled.includes(marker)) {
          failures.push({
            code: "missing-marker",
            message: `${item.artifact} is missing required Bridge runtime marker: ${marker}`
          });
        }
      }
    }
  }

  if (!inspectedBundle) {
    failures.push({
      code: "no-bundle",
      message: "No portable Bridge artifact contained cli.js to verify the rebind/restart runtime."
    });
  }

  return {
    ok: failures.length === 0,
    failures,
    recommendedVersion: latest.manifest.recommendedVersion,
    sourceFingerprint
  };
}
