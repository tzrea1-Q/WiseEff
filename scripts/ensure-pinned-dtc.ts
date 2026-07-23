import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { cpus } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  extractSemverLike,
  loadPinnedToolchainVersions,
  probeDtsToolchain,
  type PinnedDtsToolchainVersions
} from "../server/modules/parameter-files/dtsToolchain";

export type PinnedDtcBinPaths = {
  binDir: string;
  dtc: string;
  fdtoverlay: string;
  sourceDir: string;
};

const DTC_GIT_REMOTE = "https://github.com/dgibson/dtc.git";

export function resolvePinnedDtcBinPaths(
  rootDir: string,
  platform: NodeJS.Platform = process.platform
): PinnedDtcBinPaths {
  const toolchainDir = join(rootDir, ".wiseeff-tools", "dts-toolchain");
  const binDir = join(toolchainDir, platform === "win32" ? "Scripts" : "bin");
  const exe = platform === "win32" ? ".exe" : "";
  return {
    binDir,
    dtc: join(binDir, `dtc${exe}`),
    fdtoverlay: join(binDir, `fdtoverlay${exe}`),
    sourceDir: join(rootDir, ".wiseeff-tools", "dtc-src")
  };
}

function runRequired(command: string, args: string[], cwd: string) {
  const result = spawnSync(command, args, { cwd, env: process.env, stdio: "inherit" });
  if (result.error || result.status !== 0) {
    throw new Error(
      result.error?.message ?? `${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}.`
    );
  }
}

function binaryVersion(binaryPath: string): string | null {
  if (!existsSync(binaryPath)) return null;
  const result = spawnSync(binaryPath, ["--version"], {
    encoding: "utf8",
    env: process.env
  });
  if (result.error || result.status !== 0) return null;
  return extractSemverLike(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
}

function localBinariesMatchPin(paths: PinnedDtcBinPaths, pinnedVersion: string): boolean {
  return binaryVersion(paths.dtc) === pinnedVersion && binaryVersion(paths.fdtoverlay) === pinnedVersion;
}

function checkoutPinnedSource(sourceDir: string, commit: string) {
  mkdirSync(dirname(sourceDir), { recursive: true });
  if (!existsSync(join(sourceDir, ".git"))) {
    mkdirSync(sourceDir, { recursive: true });
    runRequired("git", ["init"], sourceDir);
    runRequired("git", ["remote", "add", "origin", DTC_GIT_REMOTE], sourceDir);
  }
  runRequired("git", ["fetch", "--depth", "1", "origin", commit], sourceDir);
  runRequired("git", ["checkout", "--force", "FETCH_HEAD"], sourceDir);
}

function buildAndInstallPinnedDtc(paths: PinnedDtcBinPaths, pinned: PinnedDtsToolchainVersions) {
  if (process.platform === "win32") {
    throw new Error(
      "Pinned dtc source builds are not supported on Windows. Provide WISEEFF_DTC_PATH and WISEEFF_FDTOVERLAY_PATH."
    );
  }

  console.log(`Building pinned dtc ${pinned.dtc.version} @ ${pinned.dtc.commit} into ${paths.binDir}`);
  checkoutPinnedSource(paths.sourceDir, pinned.dtc.commit);
  runRequired("make", ["clean"], paths.sourceDir);
  runRequired("make", [`-j${Math.max(2, cpus().length || 2)}`], paths.sourceDir);

  const builtDtc = join(paths.sourceDir, "dtc");
  const builtOverlay = join(paths.sourceDir, "fdtoverlay");
  if (!existsSync(builtDtc) || !existsSync(builtOverlay)) {
    throw new Error(`Pinned dtc build finished but binaries are missing under ${paths.sourceDir}.`);
  }

  mkdirSync(paths.binDir, { recursive: true });
  copyFileSync(builtDtc, paths.dtc);
  copyFileSync(builtOverlay, paths.fdtoverlay);
  runRequired("chmod", ["+x", paths.dtc, paths.fdtoverlay], paths.binDir);

  if (!localBinariesMatchPin(paths, pinned.dtc.version)) {
    throw new Error(
      `Pinned dtc build installed binaries that do not report version ${pinned.dtc.version}.`
    );
  }
}

/**
 * Ensure project-local dtc/fdtoverlay match `tools/dts-toolchain/versions.json`.
 * Prefer an already-correct host or local toolchain; otherwise build from the pinned commit.
 */
export async function ensurePinnedDtcBinaries(
  rootDir: string,
  pinned: PinnedDtsToolchainVersions = loadPinnedToolchainVersions(rootDir)
): Promise<"already-ok" | "already-local" | "built"> {
  const paths = resolvePinnedDtcBinPaths(rootDir);
  if (localBinariesMatchPin(paths, pinned.dtc.version)) {
    return "already-local";
  }

  const probe = await probeDtsToolchain();
  // Host toolchain already matches pin (common on macOS Homebrew). Skip source build.
  // Ignore dtschema here — that is installed by the project venv step.
  if (
    extractSemverLike(probe.dtc.version) === pinned.dtc.version &&
    extractSemverLike(probe.fdtoverlay.version) === pinned.dtc.version
  ) {
    return "already-ok";
  }

  buildAndInstallPinnedDtc(paths, pinned);
  return "built";
}

async function main() {
  const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
  const pinned = loadPinnedToolchainVersions(rootDir);
  const result = await ensurePinnedDtcBinaries(rootDir, pinned);
  console.log(`Pinned dtc ensure result: ${result}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
