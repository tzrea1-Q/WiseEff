import { access, mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { createAdbCommandRunner } from "@wiseeff/device-command-core/adbRunner";
import { createDefaultHdcCommandRunner } from "@wiseeff/device-command-core/hdcRunner";
import { probeTools } from "../packages/device-bridge/src/toolProbe";
import {
  fetchToolReleaseManifest,
  installToolReleaseItem,
  runToolsInstallCommand,
  selectToolReleaseItems
} from "../packages/device-bridge/src/toolsInstallCommand";
import { resolveManagedToolPath } from "../packages/device-bridge/src/toolPaths";

const serverUrl = process.env.WISEEFF_PILOT_SERVER_URL ?? "http://127.0.0.1:8787";
const keepToolsRoot = process.env.WISEEFF_PILOT_KEEP_TOOLS_ROOT === "1";

async function main() {
  const toolsRoot =
    process.env.WISEEFF_PILOT_TOOLS_ROOT ??
    (await mkdtemp(path.join(os.tmpdir(), "wiseeff-pilot-tools-")));
  try {
    const force = process.env.WISEEFF_PILOT_FORCE_INSTALL === "1";
    await runToolsInstallCommand({
      serverUrl,
      protocol: "adb",
      toolsRoot,
      force
    });
    const adbPath = resolveManagedToolPath("adb", "0.1.0", { toolsRoot });
    await access(adbPath);
    console.log(`managed adb: ${adbPath}`);

    const version = spawnSync(adbPath, ["version"], { encoding: "utf8" });
    console.log(`adb version exit=${version.status} stdout=${version.stdout.split("\n")[0] ?? ""}`);

    const manifest = await fetchToolReleaseManifest(serverUrl);
    const items = selectToolReleaseItems({ manifest, protocol: "adb" });
    const skipResult = await installToolReleaseItem({
      serverUrl,
      item: items[0]!,
      toolsRoot
    });
    console.log(`idempotent skip: ${skipResult.skipped === true}`);

    const probe = await probeTools({
      adbRunner: createAdbCommandRunner({ command: adbPath }),
      hdcRunner: createDefaultHdcCommandRunner("hdc"),
      adbSource: "managed"
    });
    console.log(`probe adb available=${probe.adb.available} source=${probe.adb.source ?? "n/a"}`);
  } finally {
    if (!keepToolsRoot && !process.env.WISEEFF_PILOT_TOOLS_ROOT) {
      await rm(toolsRoot, { recursive: true, force: true });
    }
  }
}

void main();
