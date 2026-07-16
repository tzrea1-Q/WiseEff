import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { probeDtc, type DtcProbeResult } from "./check-dtc";
import {
  checkPinnedToolchainVersions,
  extractSemverLike,
  loadPinnedToolchainVersions,
  type PinnedDtsToolchainVersions
} from "../server/modules/parameter-files/dtsToolchain";

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
  pinned: PinnedDtsToolchainVersions;
  versionsMatch: boolean;
  versionError: string | null;
  ok: boolean;
};

function probeVersionedCommand(command: string, args: string[]): {
  available: boolean;
  version: string | null;
  error: string | null;
} {
  const result = spawnSync(command, args, { encoding: "utf8" });
  const raw = (result.stdout ?? "").trim() || (result.stderr ?? "").trim();
  if (result.error) {
    return { available: false, version: null, error: result.error.message };
  }
  if (result.status === 0) {
    const version = extractSemverLike(raw);
    return {
      available: true,
      version: version ?? (raw || null),
      error: version ? null : `Unparseable ${command} version output: ${raw || "(empty)"}`
    };
  }
  return {
    available: false,
    version: null,
    error: raw || `${command} executable was not found on PATH`
  };
}

export function loadPinnedVersions(
  rootDir = join(dirname(fileURLToPath(import.meta.url)), "..")
): PinnedDtsToolchainVersions {
  return loadPinnedToolchainVersions(rootDir);
}

export function evaluateToolchainProbe(input: {
  dtc: DtcProbeResult;
  fdtoverlay: { available: boolean; version: string | null; error: string | null };
  dtschema: { available: boolean; version: string | null; error: string | null };
  pinned: PinnedDtsToolchainVersions;
}): ToolchainProbeResult {
  const toolsPresent = input.dtc.available && input.fdtoverlay.available && input.dtschema.available;
  const pinCheck = checkPinnedToolchainVersions(
    {
      dtc: extractSemverLike(input.dtc.version) ?? input.dtc.version,
      fdtoverlay: extractSemverLike(input.fdtoverlay.version) ?? input.fdtoverlay.version,
      dtschema: extractSemverLike(input.dtschema.version) ?? input.dtschema.version
    },
    input.pinned
  );

  const versionsMatch = pinCheck.ok;
  const versionError = pinCheck.ok ? null : pinCheck.reason;
  // Presence alone is insufficient: --required and release gates also require pinned versions.
  const ok = toolsPresent && versionsMatch;

  return {
    dtc: input.dtc,
    fdtoverlay: input.fdtoverlay,
    dtschema: input.dtschema,
    pinned: input.pinned,
    versionsMatch,
    versionError,
    ok
  };
}

export function probeDtsToolchain(): ToolchainProbeResult {
  const pinned = loadPinnedVersions();
  const dtc = probeDtc();
  const fdtoverlay = probeVersionedCommand("fdtoverlay", ["--version"]);
  const dtschema = probeVersionedCommand("dt-validate", ["--version"]);
  return evaluateToolchainProbe({ dtc, fdtoverlay, dtschema, pinned });
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
    const versionLine = result.versionError
      ? `Version pin failed: ${result.versionError}\n`
      : "";
    console.error(
      `DTS toolchain required but incomplete` +
        (missing.length > 0 ? ` (missing: ${missing.join(", ")})` : "") +
        `.\n` +
        versionLine +
        `Pinned: dtc ${result.pinned.dtc.version} @ ${result.pinned.dtc.commit}, dtschema ${result.pinned.dtschema}.\n` +
        `Install guidance:\n` +
        `  - dtc/fdtoverlay: npm run dtc:bootstrap (or brew/apk/apt package device-tree-compiler)\n` +
        `  - dtschema: python3 -m pip install -r tools/dts-toolchain/requirements.txt\n` +
        `  - ensure dt-validate is on PATH (often ~/.local/bin or ~/Library/Python/*/bin)\n` +
        `  - macOS tip: export PATH="$HOME/Library/Python/3.9/bin:$PATH"`
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
