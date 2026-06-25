import {
  createDefaultAdbCommandRunner,
  type AdbCommandRunner
} from "@wiseeff/device-command-core/adbRunner";
import {
  createDefaultHdcCommandRunner,
  type HdcCommandRunner
} from "@wiseeff/device-command-core/hdcRunner";

import { getInstalledToolVersion } from "./toolInstallState";
import { resolveToolBinary, type ResolveToolsRootOptions } from "./toolPaths";
import { probeTools, type ToolProbeResult } from "./toolProbe";
import { createRpcHandlers } from "./rpcHandlers";

export async function createResolvedRpcHandlers(options: ResolveToolsRootOptions = {}) {
  const [adbVersion, hdcVersion] = await Promise.all([
    getInstalledToolVersion("adb", options),
    getInstalledToolVersion("hdc", options)
  ]);
  const [adbResolved, hdcResolved] = await Promise.all([
    resolveToolBinary("adb", { ...options, installedVersion: adbVersion }),
    resolveToolBinary("hdc", { ...options, installedVersion: hdcVersion })
  ]);

  const adbRunner = createDefaultAdbCommandRunner(adbResolved.command);
  const hdcRunner = createDefaultHdcCommandRunner(hdcResolved.command);

  return {
    rpc: createRpcHandlers({
      adbRunner,
      hdcRunner,
      adbCommand: adbResolved.command,
      hdcCommand: hdcResolved.command,
      adbSource: adbResolved.source,
      hdcSource: hdcResolved.source
    }),
    probeTools: (timeoutMs?: number) =>
      probeTools({
        adbRunner,
        hdcRunner,
        adbSource: adbResolved.source,
        hdcSource: hdcResolved.source,
        timeoutMs
      }),
    refreshResolvedCommands: async () => createResolvedRpcHandlers(options)
  };
}

export type ResolvedRpcRuntime = Awaited<ReturnType<typeof createResolvedRpcHandlers>>;

export async function createResolvedToolProbe(options: ResolveToolsRootOptions = {}): Promise<() => Promise<ToolProbeResult>> {
  const runtime = await createResolvedRpcHandlers(options);
  return () => runtime.probeTools();
}
