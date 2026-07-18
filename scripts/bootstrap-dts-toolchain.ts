import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  checkPinnedToolchainVersions,
  loadPinnedToolchainVersions,
  probeDtsToolchain
} from "../server/modules/parameter-files/dtsToolchain";

export type DtsToolchainVenvPaths = {
  venvDir: string;
  python: string;
  dtValidate: string;
};

export function resolveDtsToolchainVenvPaths(
  rootDir: string,
  platform: NodeJS.Platform = process.platform
): DtsToolchainVenvPaths {
  const venvDir = join(rootDir, ".wiseeff-tools", "dts-toolchain");
  const binDir = join(venvDir, platform === "win32" ? "Scripts" : "bin");
  return {
    venvDir,
    python: join(binDir, platform === "win32" ? "python.exe" : "python"),
    dtValidate: join(binDir, platform === "win32" ? "dt-validate.exe" : "dt-validate")
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

async function main() {
  const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
  const paths = resolveDtsToolchainVenvPaths(rootDir);
  const hostPython = process.env.PYTHON?.trim() || "python3";

  if (!existsSync(paths.python)) {
    console.log(`Creating project DTS toolchain venv: ${paths.venvDir}`);
    runRequired(hostPython, ["-m", "venv", paths.venvDir], rootDir);
  }

  runRequired(
    paths.python,
    [
      "-m",
      "pip",
      "install",
      "--disable-pip-version-check",
      "-r",
      join(rootDir, "tools", "dts-toolchain", "requirements.txt")
    ],
    rootDir
  );

  const probe = await probeDtsToolchain();
  const pinned = loadPinnedToolchainVersions(rootDir);
  const versionCheck = checkPinnedToolchainVersions(
    {
      dtc: probe.dtc.version,
      fdtoverlay: probe.fdtoverlay.version,
      dtschema: probe.dtschema.version
    },
    pinned
  );
  if (!probe.dtc.path || !probe.fdtoverlay.path || !probe.dtschema.path || !versionCheck.ok) {
    throw new Error(
      `Project DTS toolchain bootstrap did not satisfy pinned versions. ${
        versionCheck.ok ? "Check dtc/fdtoverlay availability." : versionCheck.reason
      }`
    );
  }

  console.log(`Project dtschema ready: ${probe.dtschema.path} (${probe.dtschema.version})`);
  console.log("Verify without modifying PATH: npm run dts:toolchain:check");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
