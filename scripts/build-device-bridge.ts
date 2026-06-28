import { chmod, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { build } from "esbuild";

const execFileAsync = promisify(execFile);

const VERSION = "0.1.0";

type BridgeArtifactTarget = {
  platform: "windows" | "darwin" | "linux";
  arch: string;
  package: "zip" | "tar.gz";
};

const ARTIFACT_TARGETS: BridgeArtifactTarget[] = [
  { platform: "windows", arch: "amd64", package: "zip" },
  { platform: "darwin", arch: "arm64", package: "tar.gz" },
  { platform: "darwin", arch: "amd64", package: "tar.gz" }
];

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const entryPoint = path.join(rootDir, "packages", "device-bridge", "src", "cli.ts");
const bundleDir = path.join(rootDir, "packages", "device-bridge", "dist");
const bundlePath = path.join(bundleDir, "cli.js");
const stagingDir = path.join(bundleDir, "staging");
const manifestPath = path.join(rootDir, "ops", "self-hosted", "bridge-artifacts", VERSION, "manifest.json");

const MAC_LAUNCHER = await readFile(
  path.join(rootDir, "ops", "self-hosted", "bridge-installer", "wiseeff-bridge.launcher.sh"),
  "utf8"
);
const BRIDGE_PACKAGE_JSON = `${JSON.stringify({ type: "module", private: true }, null, 2)}\n`;

function artifactFilename(target: BridgeArtifactTarget) {
  const extension = target.package === "zip" ? "zip" : "tar.gz";
  return `wiseeff-bridge_${VERSION}_${target.platform}_${target.arch}.${extension}`;
}

async function sha256File(filePath: string) {
  const { stdout } = await execFileAsync("shasum", ["-a", "256", filePath]);
  return stdout.split(/\s+/)[0] ?? "";
}

async function packageZip(inputPath: string, outputPath: string) {
  await rm(outputPath, { force: true });
  await execFileAsync("zip", ["-j", outputPath, inputPath]);
}

async function packageTarGz(stagingPath: string, outputPath: string) {
  await rm(outputPath, { force: true });
  await execFileAsync("tar", [
    "-czf",
    outputPath,
    "-C",
    stagingPath,
    "cli.js",
    "package.json",
    "wiseeff-bridge",
    "install-launchagent.sh",
    "BridgeAppMain.swift",
    "rebuild-app-executable.sh"
  ]);
}

await mkdir(bundleDir, { recursive: true });
await mkdir(stagingDir, { recursive: true });

await build({
  entryPoints: [entryPoint],
  outfile: bundlePath,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: false,
  minify: false,
  legalComments: "none",
  external: ["undici"],
  banner: {
    js: [
      "#!/usr/bin/env node",
      "import { createRequire } from 'module';",
      "const require = createRequire(import.meta.url);"
    ].join("\n")
  }
});

const manifestItems: Array<{
  platform: BridgeArtifactTarget["platform"];
  arch: string;
  version: string;
  artifact: string;
  sha256: string;
  artifactKind: "portable" | "installer";
}> = [];

for (const target of ARTIFACT_TARGETS) {
  const artifactDir = path.join(rootDir, "ops", "self-hosted", "bridge-artifacts", VERSION, target.platform, target.arch);
  const artifactName = artifactFilename(target);
  const artifactPath = path.join(artifactDir, artifactName);

  await mkdir(artifactDir, { recursive: true });

  if (target.package === "zip") {
    await packageZip(bundlePath, artifactPath);
  } else {
    const targetStagingDir = path.join(stagingDir, `${target.platform}-${target.arch}`);
    await rm(targetStagingDir, { recursive: true, force: true });
    await mkdir(targetStagingDir, { recursive: true });
    await writeFile(path.join(targetStagingDir, "cli.js"), await readFile(bundlePath));
    await writeFile(path.join(targetStagingDir, "package.json"), BRIDGE_PACKAGE_JSON);
    const launcherPath = path.join(targetStagingDir, "wiseeff-bridge");
    await writeFile(launcherPath, MAC_LAUNCHER, "utf8");
    await chmod(launcherPath, 0o755);
    await copyFile(
      path.join(rootDir, "ops", "self-hosted", "bridge-installer", "macos", "BridgeAppMain.swift"),
      path.join(targetStagingDir, "BridgeAppMain.swift")
    );
    await copyFile(
      path.join(rootDir, "ops", "self-hosted", "bridge-installer", "macos", "rebuild-app-executable.sh"),
      path.join(targetStagingDir, "rebuild-app-executable.sh")
    );
    await copyFile(
      path.join(rootDir, "ops", "self-hosted", "bridge-installer", "install-launchagent.sh"),
      path.join(targetStagingDir, "install-launchagent.sh")
    );
    await chmod(path.join(targetStagingDir, "install-launchagent.sh"), 0o755);
    await packageTarGz(targetStagingDir, artifactPath);
  }

  const sha256 = await sha256File(artifactPath);
  manifestItems.push({
    platform: target.platform,
    arch: target.arch,
    version: VERSION,
    artifact: artifactName,
    sha256,
    artifactKind: "portable"
  });

  console.log(`Created artifact: ${artifactPath}`);
}

const manifest = {
  recommendedVersion: VERSION,
  minCompatibleVersion: VERSION,
  items: [
    ...manifestItems,
    ...((await readExistingInstallerItems()) ?? [])
  ]
};

async function readExistingInstallerItems() {
  try {
    const existing = JSON.parse(await readFile(manifestPath, "utf8")) as {
      items?: Array<{ artifactKind?: string }>;
    };
    return existing.items?.filter((item) => item.artifactKind === "installer") ?? [];
  } catch {
    return [];
  }
}

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Updated manifest: ${manifestPath}`);
console.log(`Built device bridge bundle: ${bundlePath}`);
