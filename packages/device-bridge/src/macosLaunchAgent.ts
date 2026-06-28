import { execFile as defaultExecFile } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { ServiceAction } from "./windowsService";

export const WISEEFF_BRIDGE_LAUNCH_AGENT_LABEL = "com.wiseeff.bridge";

export type ExecFileFn = (
  file: string,
  args: readonly string[],
  options?: { windowsHide?: boolean }
) => Promise<{ stdout: string; stderr: string }>;

export type MacosLaunchAgentDependencies = {
  execFile: ExecFileFn;
  platform: NodeJS.Platform;
  homedir: () => string;
  getuid: () => number;
  writeFile: typeof fs.writeFile;
  mkdir: typeof fs.mkdir;
  unlink: typeof fs.unlink;
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

export function isDarwinPlatform(platform: NodeJS.Platform): boolean {
  return platform === "darwin";
}

export function getLaunchAgentPlistPath(homedir: () => string = os.homedir): string {
  return path.join(homedir(), "Library", "LaunchAgents", `${WISEEFF_BRIDGE_LAUNCH_AGENT_LABEL}.plist`);
}

export function getLaunchAgentDomain(uid: number): string {
  return `gui/${uid}`;
}

export function getLaunchAgentServiceName(uid: number): string {
  return `${getLaunchAgentDomain(uid)}/${WISEEFF_BRIDGE_LAUNCH_AGENT_LABEL}`;
}

export function resolveBridgeBinPath(cliPath: string): string {
  return path.join(path.dirname(cliPath), "wiseeff-bridge");
}

export function buildLaunchAgentPathEnv(homedir: string): string {
  return [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(homedir, ".local/bin"),
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin"
  ].join(":");
}

export function buildLaunchAgentPlistContent(input: {
  bridgeBin: string;
  homedir: string;
  logPath: string;
}): string {
  const pathEnv = buildLaunchAgentPathEnv(input.homedir);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${WISEEFF_BRIDGE_LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${input.bridgeBin}</string>
    <string>start</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${input.logPath}</string>
  <key>StandardErrorPath</key><string>${input.logPath}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${pathEnv}</string>
    <key>HOME</key><string>${input.homedir}</string>
  </dict>
</dict>
</plist>
`;
}

export async function isLaunchAgentPlistInstalled(homedir: () => string = os.homedir): Promise<boolean> {
  return existsSync(getLaunchAgentPlistPath(homedir));
}

function unsupportedPlatformMessage(): string {
  return "LaunchAgent service commands are only supported on macOS.";
}

function assertDarwinPlatform(deps: Pick<MacosLaunchAgentDependencies, "platform" | "error">): boolean {
  if (isDarwinPlatform(deps.platform)) {
    return true;
  }
  deps.error(unsupportedPlatformMessage());
  return false;
}

function resolveBridgeProgram(deps: Pick<MacosLaunchAgentDependencies, "cliPath" | "error">): string | null {
  const bridgeBin = resolveBridgeBinPath(deps.cliPath);
  if (existsSync(bridgeBin)) {
    return bridgeBin;
  }
  deps.error(`Bridge launcher not found at ${bridgeBin}. Reinstall WiseEff Bridge.app or run from the app bundle.`);
  return null;
}

async function runLaunchctl(
  deps: Pick<MacosLaunchAgentDependencies, "execFile">,
  args: readonly string[]
): Promise<{ stdout: string; stderr: string }> {
  return deps.execFile("/bin/launchctl", args);
}

async function bootoutLaunchAgent(deps: MacosLaunchAgentDependencies, uid: number, plistPath: string): Promise<void> {
  const domain = getLaunchAgentDomain(uid);
  const targets = [plistPath, `${domain}/${WISEEFF_BRIDGE_LAUNCH_AGENT_LABEL}`, `${domain}/${plistPath}`];
  for (const target of targets) {
    try {
      await runLaunchctl(deps, ["bootout", domain, target]);
    } catch {
      // Ignore missing services.
    }
  }
}

export async function installMacosLaunchAgent(deps: MacosLaunchAgentDependencies): Promise<number> {
  if (!assertDarwinPlatform(deps)) {
    return 1;
  }

  const bridgeBin = resolveBridgeProgram(deps);
  if (!bridgeBin) {
    return 1;
  }

  const homedir = deps.homedir();
  const uid = deps.getuid();
  const plistPath = getLaunchAgentPlistPath(deps.homedir);
  const logPath = path.join(homedir, ".wiseeff", "bridge-launchd.log");

  await deps.mkdir(path.dirname(plistPath), { recursive: true });
  await deps.mkdir(path.dirname(logPath), { recursive: true });
  await bootoutLaunchAgent(deps, uid, plistPath);

  await deps.writeFile(
    plistPath,
    buildLaunchAgentPlistContent({
      bridgeBin,
      homedir,
      logPath
    }),
    "utf8"
  );
  deps.log(`Wrote LaunchAgent plist: ${plistPath}`);

  const domain = getLaunchAgentDomain(uid);
  try {
    await runLaunchctl(deps, ["bootstrap", domain, plistPath]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.error(`Failed to load LaunchAgent: ${message}`);
    return 1;
  }

  try {
    await runLaunchctl(deps, ["enable", getLaunchAgentServiceName(uid)]);
  } catch {
    // enable may fail on older macOS; bootstrap is enough for many setups.
  }

  try {
    await runLaunchctl(deps, ["kickstart", "-k", getLaunchAgentServiceName(uid)]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.log(`LaunchAgent registered; kickstart returned: ${message}`);
  }

  deps.log("Bridge will start automatically when you log in.");
  deps.log(`LaunchAgent logs: ${logPath}`);
  return 0;
}

export async function uninstallMacosLaunchAgent(deps: MacosLaunchAgentDependencies): Promise<number> {
  if (!assertDarwinPlatform(deps)) {
    return 1;
  }

  const uid = deps.getuid();
  const plistPath = getLaunchAgentPlistPath(deps.homedir);
  await bootoutLaunchAgent(deps, uid, plistPath);

  try {
    await deps.unlink(plistPath);
    deps.log(`Removed LaunchAgent plist: ${plistPath}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      deps.log("LaunchAgent is not installed.");
      return 0;
    }
    const message = error instanceof Error ? error.message : String(error);
    deps.error(`Failed to remove LaunchAgent plist: ${message}`);
    return 1;
  }

  deps.log("LaunchAgent uninstalled.");
  return 0;
}

export async function startMacosLaunchAgent(deps: MacosLaunchAgentDependencies): Promise<number> {
  if (!assertDarwinPlatform(deps)) {
    return 1;
  }

  const plistPath = getLaunchAgentPlistPath(deps.homedir);
  if (!existsSync(plistPath)) {
    deps.error("LaunchAgent is not installed. Run: wiseeff-bridge service install");
    return 1;
  }

  try {
    await runLaunchctl(deps, ["kickstart", "-k", getLaunchAgentServiceName(deps.getuid())]);
    deps.log("LaunchAgent started.");
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.error(`Failed to start LaunchAgent: ${message}`);
    return 1;
  }
}

export async function stopMacosLaunchAgent(deps: MacosLaunchAgentDependencies): Promise<number> {
  if (!assertDarwinPlatform(deps)) {
    return 1;
  }

  const uid = deps.getuid();
  const plistPath = getLaunchAgentPlistPath(deps.homedir);
  if (!existsSync(plistPath)) {
    deps.error("LaunchAgent is not installed.");
    return 1;
  }

  try {
    await bootoutLaunchAgent(deps, uid, plistPath);
    deps.log("LaunchAgent stopped.");
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.error(`Failed to stop LaunchAgent: ${message}`);
    return 1;
  }
}

export async function statusMacosLaunchAgent(deps: MacosLaunchAgentDependencies): Promise<number> {
  if (!assertDarwinPlatform(deps)) {
    return 1;
  }

  const plistPath = getLaunchAgentPlistPath(deps.homedir);
  if (!existsSync(plistPath)) {
    deps.log("launchAgentStatus=not_installed");
    return 0;
  }

  try {
    const { stdout } = await runLaunchctl(deps, ["print", getLaunchAgentServiceName(deps.getuid())]);
    const running = stdout.includes('state = running') || stdout.includes('"state" = "running"');
    deps.log(`launchAgentStatus=${running ? "running" : "installed"}`);
    return 0;
  } catch {
    deps.log("launchAgentStatus=installed");
    return 0;
  }
}

export async function runMacosLaunchAgentCommand(
  action: ServiceAction,
  deps: MacosLaunchAgentDependencies
): Promise<number> {
  switch (action) {
    case "install":
      return installMacosLaunchAgent(deps);
    case "uninstall":
      return uninstallMacosLaunchAgent(deps);
    case "start":
      return startMacosLaunchAgent(deps);
    case "stop":
      return stopMacosLaunchAgent(deps);
  }
}
