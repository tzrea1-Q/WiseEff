import { spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { appendBridgeLaunchLog } from "./bridgeLaunchLog";
import {
  resolveBundledNodePath,
  resolveDetachedBridgeConnectCommand,
  resolveDetachedBridgeStartCommand
} from "./bridgeRuntimePaths";
import { stopLocalBridgeHealthListener, waitForLocalBridgeConnection } from "./localBridgeProcess";
import { runWindowsServiceCommand } from "./windowsService";

const GUI_PATH = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  path.join(os.homedir(), ".local/bin"),
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin"
].join(":");

function shellQuoteSingle(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildDarwinLoginShellStartScript(command: string, args: string[]): string {
  return [shellQuoteSingle(command), ...args.map(shellQuoteSingle)].join(" ");
}

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
  forceRestart?: boolean;
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

function resolveDetachedStartCommand(deps: Pick<EnsureBridgeRunningDependencies, "platform" | "execPath" | "cliPath">) {
  return resolveDetachedBridgeStartCommand(deps);
}

function spawnDetachedCommand(
  deps: Pick<EnsureBridgeRunningDependencies, "execPath" | "cliPath" | "stdout" | "platform">,
  command: string,
  args: string[],
  label: string
) {
  const logPath = path.join(os.homedir(), ".wiseeff", "bridge-start.log");
  mkdirSync(path.dirname(logPath), { recursive: true });
  const logFd = openSync(logPath, "a");
  const spawnEnv = {
    ...process.env,
    HOME: os.homedir(),
    PATH: process.env.PATH ? `${GUI_PATH}:${process.env.PATH}` : GUI_PATH
  };

  if (deps.platform === "darwin") {
    const inner = buildDarwinLoginShellStartScript(command, args);
    const child = spawn("/bin/bash", ["-lc", inner], {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: spawnEnv
    });
    child.on("error", (error) => {
      void appendBridgeLaunchLog(`spawn ERROR ${error.message}`);
    });
    child.unref();
    deps.stdout.log(`${label} via login shell (${command}).`);
    void appendBridgeLaunchLog(`spawn detached ${inner}`);
    return;
  }

  const child = spawn(command, args, {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    windowsHide: true,
    env: spawnEnv
  });
  child.on("error", (error) => {
    void appendBridgeLaunchLog(`spawn ERROR ${error.message}`);
  });
  child.unref();
  deps.stdout.log(`${label} (${command}).`);
  void appendBridgeLaunchLog(`spawn detached ${command} ${args.join(" ")}`);
}

function spawnDetachedStart(deps: Pick<EnsureBridgeRunningDependencies, "execPath" | "cliPath" | "stdout" | "platform">) {
  const { command, args } = resolveDetachedBridgeStartCommand(deps);
  spawnDetachedCommand(deps, command, args, "Started bridge in background");
}

export function spawnDetachedConnect(
  deps: Pick<EnsureBridgeRunningDependencies, "execPath" | "cliPath" | "stdout" | "platform">,
  input: { server: string; code?: string; webOrigin?: string }
) {
  const { command, args } = resolveDetachedBridgeConnectCommand({ ...deps, ...input });
  spawnDetachedCommand(deps, command, args, "Started bridge connect in background");
}

export async function ensureBridgeRunning(deps: EnsureBridgeRunningDependencies): Promise<{ exitCode: number }> {
  const health = await probeLocalBridgeHealth(deps.fetchImpl);
  if (health?.connected && !deps.forceRestart) {
    deps.stdout.log("Bridge already connected.");
    return { exitCode: 0 };
  }

  const nodePath = resolveBundledNodePath(deps.cliPath, deps.execPath, deps.platform);

  if (deps.platform === "win32") {
    const serviceExit = await runWindowsServiceCommand("start", {
      platform: deps.platform,
      cliPath: deps.cliPath,
      nodePath,
      log: (message) => deps.stdout.log(message),
      error: (message) => deps.stdout.error(message)
    });
    if (serviceExit === 0) {
      const connected = await waitForLocalBridgeConnection(deps.fetchImpl, 25_000);
      if (connected?.connected) {
        deps.stdout.log("Bridge connected via Windows service.");
        return { exitCode: 0 };
      }
      deps.stdout.log("Windows service started but Bridge is not connected yet; trying detached start.");
    }
  }

  if (health && !health.connected) {
    await stopLocalBridgeHealthListener(deps.platform);
  } else if (deps.forceRestart) {
    await stopLocalBridgeHealthListener(deps.platform);
  }

  spawnDetachedStart(deps);
  const connected = await waitForLocalBridgeConnection(deps.fetchImpl, 25_000);
  if (connected?.connected) {
    deps.stdout.log("Bridge connected.");
    return { exitCode: 0 };
  }
  deps.stdout.error("Bridge failed to come online within 25 seconds.");
  return { exitCode: 1 };
}
