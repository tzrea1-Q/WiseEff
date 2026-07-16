import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { probeDtc, type DtcProbeResult } from "./check-dtc";

export type ToolchainProbeResult = {
  dtc: DtcProbeResult;
  fdtoverlay: {
    available: boolean;
    version: string | null;
    error: string | null;
  };
  dtschema: {
    available: boolean;
    version: string | null;
    error: string | null;
  };
  pinned: {
    dtc: { version: string; commit: string };
    dtschema: string;
  };
  ok: boolean;
};

function probeVersionedCommand(command: string, args: string[]): {
  available: boolean;
  version: string | null;
  error: string | null;
} {
  const result = spawnSync(command, args, { encoding: "utf8" });
  const version = (result.stdout ?? "").trim() || (result.stderr ?? "").trim();
  if (result.error) {
    return { available: false, version: null, error: result.error.message };
  }
  if (result.status === 0) {
    return { available: true, version: version || `${command} (version unavailable)`, error: null };
  }
  return {
    available: false,
    version: null,
    error: version || `${command} executable was not found on PATH`
  };
}

export function loadPinnedVersions(rootDir = join(dirname(fileURLToPath(import.meta.url)), "..")): {
  dtc: { version: string; commit: string };
  dtschema: string;
} {
  const raw = readFileSync(join(rootDir, "tools/dts-toolchain/versions.json"), "utf8");
  return JSON.parse(raw) as { dtc: { version: string; commit: string }; dtschema: string };
}

export function probeDtsToolchain(): ToolchainProbeResult {
  const pinned = loadPinnedVersions();
  const dtc = probeDtc();
  const fdtoverlay = probeVersionedCommand("fdtoverlay", ["--version"]);
  const dtschema = probeVersionedCommand("dt-validate", ["--version"]);
  return {
    dtc,
    fdtoverlay,
    dtschema,
    pinned,
    ok: dtc.available && fdtoverlay.available && dtschema.available
  };
}

async function main() {
  const required = process.argv.includes("--required");
  const result = probeDtsToolchain();
  console.log(JSON.stringify(result, null, 2));

  if (required && !result.ok) {
    const missing: string[] = [];
    if (!result.dtc.available) missing.push("dtc");
    if (!result.fdtoverlay.available) missing.push("fdtoverlay");
    if (!result.dtschema.available) missing.push("dt-validate (dtschema)");
    console.error(
      `DTS toolchain required but incomplete (missing: ${missing.join(", ")}).\n` +
        `Pinned: dtc ${result.pinned.dtc.version} @ ${result.pinned.dtc.commit}, dtschema ${result.pinned.dtschema}.\n` +
        `Install guidance:\n` +
        `  - dtc/fdtoverlay: npm run dtc:bootstrap (or brew/apk/apt package device-tree-compiler)\n` +
        `  - dtschema: python3 -m pip install -r tools/dts-toolchain/requirements.txt\n` +
        `  - ensure dt-validate is on PATH (often ~/.local/bin or ~/Library/Python/*/bin)`
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
