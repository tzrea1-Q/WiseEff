import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { DtcProbeResult } from "./check-dtc";
import {
  checkPinnedToolchainVersions,
  extractSemverLike,
  loadPinnedToolchainVersions,
  probeDtsToolchain as probeRuntimeDtsToolchain,
  type DtsToolchainToolProbe,
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

function commandProbeResult(command: string, probe: DtsToolchainToolProbe): {
  available: boolean;
  version: string | null;
  error: string | null;
} {
  return probe.path
    ? { available: true, version: probe.version, error: null }
    : { available: false, version: null, error: `${command} unavailable through the shared DTS binary resolver` };
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

export async function probeDtsToolchain(): Promise<ToolchainProbeResult> {
  const pinned = loadPinnedVersions();
  const runtimeProbe = await probeRuntimeDtsToolchain();
  const dtc = commandProbeResult("dtc", runtimeProbe.dtc);
  const fdtoverlay = commandProbeResult("fdtoverlay", runtimeProbe.fdtoverlay);
  const dtschema = commandProbeResult("dt-validate", runtimeProbe.dtschema);
  return evaluateToolchainProbe({ dtc, fdtoverlay, dtschema, pinned });
}

async function main() {
  const required = process.argv.includes("--required");
  const result = await probeDtsToolchain();
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
        `  - install the pinned project toolchain: npm run dts:toolchain:bootstrap\n` +
        `  - the API runtime and this check share .wiseeff-tools/dts-toolchain; no personal PATH export is required\n` +
        `  - optional controlled overrides: WISEEFF_DTC_PATH, WISEEFF_FDTOVERLAY_PATH, WISEEFF_DT_VALIDATE_PATH`
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
