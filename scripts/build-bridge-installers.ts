import { access, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile, spawnSync } from "node:child_process";

const execFileAsync = promisify(execFile);

const VERSION = "0.1.0";
const NODE_VERSION = "22.14.0";
const BRIDGE_PACKAGE_JSON = `${JSON.stringify({ type: "module", private: true }, null, 2)}\n`;

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const bundlePath = path.join(rootDir, "packages", "device-bridge", "dist", "cli.js");
const stagingDir = path.join(rootDir, "ops", "self-hosted", "bridge-installer", "staging");
const manifestPath = path.join(rootDir, "ops", "self-hosted", "bridge-artifacts", VERSION, "manifest.json");
const artifactRoot = path.join(rootDir, "ops", "self-hosted", "bridge-artifacts", VERSION);

type InstallerTarget = {
  platform: "windows" | "darwin";
  arch: "amd64" | "arm64";
  artifact: string;
};

const INSTALLER_TARGETS: InstallerTarget[] = [
  { platform: "windows", arch: "amd64", artifact: `WiseEffBridgeSetup_${VERSION}.exe` },
  { platform: "darwin", arch: "arm64", artifact: `WiseEffBridge_${VERSION}_darwin_arm64.pkg` },
  { platform: "darwin", arch: "amd64", artifact: `WiseEffBridge_${VERSION}_darwin_amd64.pkg` }
];

async function exists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

const BRIDGE_HTTP_CONNECT_ROUTE_MARKER = 'pathname === "/connect"';

async function sha256File(filePath: string) {
  if (process.platform === "win32") {
    const ps = `(Get-FileHash -LiteralPath '${filePath.replace(/'/g, "''")}' -Algorithm SHA256).Hash.ToLower()`;
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", ps]);
    return stdout.trim();
  }
  const { stdout } = await execFileAsync("shasum", ["-a", "256", filePath]);
  return stdout.split(/\s+/)[0] ?? "";
}

type ManifestInstallerItem = {
  platform: InstallerTarget["platform"];
  arch: InstallerTarget["arch"];
  version: string;
  artifact: string;
  artifactKind: "installer";
  sha256: string;
};

async function ensurePortableBuild() {
  console.log("Running npm run bridge:build...");
  const result = spawnSync("npm", ["run", "bridge:build"], {
    cwd: rootDir,
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  if (result.status !== 0) {
    throw new Error(`bridge:build failed with exit code ${result.status ?? 1}`);
  }
}

async function assertBridgeHttpConnectRoute() {
  const source = await readFile(bundlePath, "utf8");
  if (!source.includes(BRIDGE_HTTP_CONNECT_ROUTE_MARKER)) {
    throw new Error(
      `${bundlePath} is missing POST /connect. Check out latest main and rerun npm run build:bridge-installers.`
    );
  }
}

async function stageBundle() {
  const launcher = await readFile(
    path.join(rootDir, "ops", "self-hosted", "bridge-installer", "wiseeff-bridge.launcher.sh"),
    "utf8"
  );
  const windowsCmd = await readFile(
    path.join(rootDir, "ops", "self-hosted", "bridge-installer", "wiseeff-bridge.cmd.template"),
    "utf8"
  );
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });
  await copyFile(bundlePath, path.join(stagingDir, "cli.js"));
  await writeFile(path.join(stagingDir, "package.json"), BRIDGE_PACKAGE_JSON);
  await writeFile(path.join(stagingDir, "wiseeff-bridge"), launcher, "utf8");
  await writeFile(path.join(stagingDir, "wiseeff-bridge.cmd"), windowsCmd, "utf8");
}

async function buildWindowsInstaller() {
  const buildScript = path.join(rootDir, "ops", "self-hosted", "bridge-installer", "windows", "build.ps1");
  if (!(await exists(buildScript))) {
    console.warn("Skipping Windows installer: build.ps1 not found.");
    return null;
  }

  try {
    const result = spawnSync(
      "pwsh",
      ["-File", buildScript, "-Version", VERSION, "-StagingDir", stagingDir, "-NodeVersion", NODE_VERSION],
      { cwd: rootDir, stdio: "inherit" }
    );
    if (result.status !== 0) {
      throw new Error(`Windows installer build exited with ${result.status ?? 1}`);
    }
  } catch (error) {
    console.warn("Windows installer build skipped or failed:", error instanceof Error ? error.message : error);
    return null;
  }

  const outputPath = path.join(artifactRoot, "windows", "amd64", `WiseEffBridgeSetup_${VERSION}.exe`);
  return (await exists(outputPath)) ? outputPath : null;
}

async function buildMacInstaller(arch: "amd64" | "arm64") {
  const buildScript = path.join(rootDir, "ops", "self-hosted", "bridge-installer", "macos", "build-macos-installer.sh");
  if (!(await exists(buildScript))) {
    console.warn("Skipping macOS installer: build-macos-installer.sh not found.");
    return null;
  }

  try {
    const result = spawnSync("bash", [buildScript, VERSION, arch, stagingDir], { cwd: rootDir, stdio: "inherit" });
    if (result.status !== 0) {
      throw new Error(`macOS installer build exited with ${result.status ?? 1}`);
    }
  } catch (error) {
    console.warn(`macOS ${arch} installer build skipped or failed:`, error instanceof Error ? error.message : error);
    return null;
  }

  const outputPath = path.join(artifactRoot, "darwin", arch, `WiseEffBridge_${VERSION}_darwin_${arch}.pkg`);
  return (await exists(outputPath)) ? outputPath : null;
}

async function mergeManifestInstallers(built: Array<{ target: InstallerTarget; path: string }>) {
  const raw = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(raw) as {
    recommendedVersion: string;
    minCompatibleVersion: string;
    items: Array<Record<string, unknown>>;
  };

  const portableItems = manifest.items.filter((item) => item.artifactKind !== "installer");
  const installerItems: ManifestInstallerItem[] = [];

  for (const entry of built) {
    installerItems.push({
      platform: entry.target.platform,
      arch: entry.target.arch,
      version: VERSION,
      artifact: entry.target.artifact,
      artifactKind: "installer",
      sha256: await sha256File(entry.path)
    });
  }

  const placeholders = INSTALLER_TARGETS.filter(
    (target) => !installerItems.some((item) => item.platform === target.platform && item.arch === target.arch)
  ).map((target) => ({
    platform: target.platform,
    arch: target.arch,
    version: VERSION,
    artifact: target.artifact,
    artifactKind: "installer",
    sha256: "0000000000000000000000000000000000000000000000000000000000000000"
  }));

  manifest.items = [...installerItems, ...placeholders, ...portableItems.map((item) => ({ ...item, artifactKind: item.artifactKind ?? "portable" }))];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Updated manifest with installer artifacts: ${manifestPath}`);
}

await ensurePortableBuild();
await assertBridgeHttpConnectRoute();
await stageBundle();

const builtInstallers: Array<{ target: InstallerTarget; path: string }> = [];

const windowsPath = await buildWindowsInstaller();
if (windowsPath) {
  builtInstallers.push({ target: INSTALLER_TARGETS[0]!, path: windowsPath });
}

if (process.platform === "darwin") {
  for (const arch of ["arm64", "amd64"] as const) {
    const pkgPath = await buildMacInstaller(arch);
    if (pkgPath) {
      const target = INSTALLER_TARGETS.find((item) => item.platform === "darwin" && item.arch === arch);
      if (target) {
        builtInstallers.push({ target, path: pkgPath });
      }
    }
  }
}

await mergeManifestInstallers(builtInstallers);
console.log("Bridge installer build finished.");
