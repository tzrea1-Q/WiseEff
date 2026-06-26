import { spawn } from "node:child_process";

import { stopLocalBridgeHealthListener, waitForLocalBridgeConnection } from "./localBridgeProcess";
import { runWindowsServiceCommand } from "./windowsService";

export type LocalBridgeHealthSnapshot = {
  connected: boolean;
  paired?: boolean;
};

export type EnsureBridgeRunningDependencies = {
  fetchImpl: typeof fetch;
  platform: NodeJS.Platform;
  execPath: string;
  cliPath: string;
  stdout: Pick<Console, "log" | "error">;
};

export async function probeLocalBridgeHealth(fetchImpl: typeof fetch): Promise<LocalBridgeHealthSnapshot | null> {
  try {
    const response = await fetchImpl("http://127.0.0.1:18787/health");
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as Record<string, unknown>;
    return {
      connected: Boolean(body.connected),
      paired: typeof body.paired === "boolean" ? body.paired : undefined
    };
  } catch {
    return null;
  }
}

function spawnDetachedStart(deps: Pick<EnsureBridgeRunningDependencies, "execPath" | "cliPath" | "stdout">) {
  const child = spawn(deps.execPath, [deps.cliPath, "start"], {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
  deps.stdout.log("Started bridge in background.");
}

export async function ensureBridgeRunning(deps: EnsureBridgeRunningDependencies): Promise<{ exitCode: number }> {
  const health = await probeLocalBridgeHealth(deps.fetchImpl);
  if (health?.connected) {
    deps.stdout.log("Bridge already connected.");
    return { exitCode: 0 };
  }

  if (deps.platform === "win32") {
    const serviceExit = await runWindowsServiceCommand("start", {
      platform: deps.platform,
      cliPath: deps.cliPath,
      nodePath: deps.execPath,
      log: (message) => deps.stdout.log(message),
      error: (message) => deps.stdout.error(message)
    });
    if (serviceExit === 0) {
      return { exitCode: 0 };
    }
  }

  if (health && !health.connected) {
    await stopLocalBridgeHealthListener(deps.platform);
    const restarted = await waitForLocalBridgeConnection(deps.fetchImpl);
    if (restarted?.connected) {
      deps.stdout.log("Bridge reconnected.");
      return { exitCode: 0 };
    }
  }

  spawnDetachedStart(deps);
  const connected = await waitForLocalBridgeConnection(deps.fetchImpl);
  if (connected?.connected) {
    deps.stdout.log("Bridge connected.");
  }
  return { exitCode: 0 };
}
