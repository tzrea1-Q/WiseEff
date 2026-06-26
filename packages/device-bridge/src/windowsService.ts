import { execFile as defaultExecFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

export const WISEEFF_BRIDGE_SERVICE_NAME = "WiseEffBridge";
export const WISEEFF_BRIDGE_SERVICE_DISPLAY_NAME = "WiseEff Device Bridge";

export type ServiceAction = "install" | "start" | "stop" | "uninstall";

export type ExecFileFn = (
  file: string,
  args: readonly string[],
  options?: { windowsHide?: boolean }
) => Promise<{ stdout: string; stderr: string }>;

export type WindowsServiceDependencies = {
  execFile: ExecFileFn;
  platform: NodeJS.Platform;
  homedir: () => string;
  writeFile: typeof fs.writeFile;
  mkdir: typeof fs.mkdir;
  unlink: typeof fs.unlink;
  nodePath: string;
  cliPath: string;
  log: (message: string) => void;
  error: (message: string) => void;
};

const execFileAsync = promisify(defaultExecFile);

export function createDefaultExecFile(): ExecFileFn {
  return async (file, args, options) => {
    const { stdout, stderr } = await execFileAsync(file, args, {
      ...options,
      encoding: "utf8"
    });
    return { stdout: String(stdout), stderr: String(stderr) };
  };
}

export function isWindowsPlatform(platform: NodeJS.Platform): boolean {
  return platform === "win32";
}

export function getServiceWrapperPath(homedir: () => string = os.homedir): string {
  return path.win32.join(homedir(), "AppData", "Local", "WiseEff", "device-bridge", "start-service.cmd");
}

export function buildServiceWrapperContent(nodePath: string, cliPath: string): string {
  return `@echo off\r\n"${nodePath}" "${cliPath}" start\r\n`;
}

export function formatScBinPath(wrapperPath: string): string {
  if (wrapperPath.includes(" ")) {
    return `binPath= "${wrapperPath}"`;
  }
  return `binPath= ${wrapperPath}`;
}

export async function runSc(
  deps: Pick<WindowsServiceDependencies, "execFile">,
  args: readonly string[]
): Promise<{ stdout: string; stderr: string }> {
  return deps.execFile("sc.exe", args, { windowsHide: true });
}

function unsupportedPlatformMessage(): string {
  return "Windows service commands are only supported on Windows.";
}

export function assertWindowsPlatform(deps: Pick<WindowsServiceDependencies, "platform" | "error">): boolean {
  if (isWindowsPlatform(deps.platform)) {
    return true;
  }
  deps.error(unsupportedPlatformMessage());
  return false;
}

function execFailureMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export async function installWindowsService(deps: WindowsServiceDependencies): Promise<number> {
  if (!assertWindowsPlatform(deps)) {
    return 1;
  }

  const wrapperPath = getServiceWrapperPath(deps.homedir);
  await deps.mkdir(path.win32.dirname(wrapperPath), { recursive: true });
  await deps.writeFile(wrapperPath, buildServiceWrapperContent(deps.nodePath, deps.cliPath), "utf8");

  const createArgs = [
    "create",
    WISEEFF_BRIDGE_SERVICE_NAME,
    formatScBinPath(wrapperPath),
    "start=auto",
    `DisplayName=${WISEEFF_BRIDGE_SERVICE_DISPLAY_NAME}`
  ] as const;

  try {
    await runSc(deps, createArgs);
  } catch (error) {
    const message = execFailureMessage(error);
    if (!(message.includes("1073") || message.toLowerCase().includes("already exists"))) {
      deps.error(`Failed to install Windows service: ${message}`);
      return 1;
    }

    try {
      await runSc(deps, ["stop", WISEEFF_BRIDGE_SERVICE_NAME]);
    } catch {
      // Service may already be stopped.
    }
    try {
      await runSc(deps, ["delete", WISEEFF_BRIDGE_SERVICE_NAME]);
    } catch (deleteError) {
      deps.error(`Failed to reinstall Windows service: ${execFailureMessage(deleteError)}`);
      return 1;
    }

    try {
      await runSc(deps, createArgs);
    } catch (recreateError) {
      deps.error(`Failed to reinstall Windows service: ${execFailureMessage(recreateError)}`);
      return 1;
    }

    deps.log(`Reinstalled Windows service ${WISEEFF_BRIDGE_SERVICE_NAME}.`);
    deps.log(`Wrapper script: ${wrapperPath}`);
    return 0;
  }

  deps.log(`Installed Windows service ${WISEEFF_BRIDGE_SERVICE_NAME}.`);
  deps.log(`Wrapper script: ${wrapperPath}`);
  return 0;
}

export async function startWindowsService(deps: Pick<WindowsServiceDependencies, "execFile" | "platform" | "log" | "error">): Promise<number> {
  if (!assertWindowsPlatform(deps)) {
    return 1;
  }

  try {
    await runSc(deps, ["start", WISEEFF_BRIDGE_SERVICE_NAME]);
  } catch (error) {
    deps.error(`Failed to start Windows service: ${execFailureMessage(error)}`);
    return 1;
  }

  deps.log(`Started Windows service ${WISEEFF_BRIDGE_SERVICE_NAME}.`);
  return 0;
}

export async function stopWindowsService(deps: Pick<WindowsServiceDependencies, "execFile" | "platform" | "log" | "error">): Promise<number> {
  if (!assertWindowsPlatform(deps)) {
    return 1;
  }

  try {
    await runSc(deps, ["stop", WISEEFF_BRIDGE_SERVICE_NAME]);
  } catch (error) {
    deps.error(`Failed to stop Windows service: ${execFailureMessage(error)}`);
    return 1;
  }

  deps.log(`Stopped Windows service ${WISEEFF_BRIDGE_SERVICE_NAME}.`);
  return 0;
}

export async function uninstallWindowsService(
  deps: Pick<WindowsServiceDependencies, "execFile" | "platform" | "homedir" | "unlink" | "log" | "error">
): Promise<number> {
  if (!assertWindowsPlatform(deps)) {
    return 1;
  }

  try {
    await runSc(deps, ["stop", WISEEFF_BRIDGE_SERVICE_NAME]);
  } catch {
    // Service may already be stopped.
  }

  try {
    await runSc(deps, ["delete", WISEEFF_BRIDGE_SERVICE_NAME]);
  } catch (error) {
    deps.error(`Failed to uninstall Windows service: ${execFailureMessage(error)}`);
    return 1;
  }

  const wrapperPath = getServiceWrapperPath(deps.homedir);
  try {
    await deps.unlink(wrapperPath);
  } catch {
    // Wrapper may already be removed.
  }

  deps.log(`Uninstalled Windows service ${WISEEFF_BRIDGE_SERVICE_NAME}.`);
  return 0;
}

export async function runWindowsServiceCommand(
  action: ServiceAction,
  overrides: Partial<WindowsServiceDependencies> = {}
): Promise<number> {
  const deps: WindowsServiceDependencies = {
    execFile: overrides.execFile ?? createDefaultExecFile(),
    platform: overrides.platform ?? process.platform,
    homedir: overrides.homedir ?? os.homedir,
    writeFile: overrides.writeFile ?? fs.writeFile,
    mkdir: overrides.mkdir ?? fs.mkdir,
    unlink: overrides.unlink ?? fs.unlink,
    nodePath: overrides.nodePath ?? process.execPath,
    cliPath: overrides.cliPath ?? "",
    log: overrides.log ?? console.log,
    error: overrides.error ?? console.error
  };

  switch (action) {
    case "install":
      return installWindowsService(deps);
    case "start":
      return startWindowsService(deps);
    case "stop":
      return stopWindowsService(deps);
    case "uninstall":
      return uninstallWindowsService(deps);
    default:
      deps.error(`Unknown service action: ${String(action)}`);
      return 1;
  }
}
