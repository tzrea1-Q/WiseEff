import fs from "node:fs/promises";

import { resolveBundledNodePath } from "./bridgeRuntimePaths";
import {
  createDefaultExecFile,
  isDarwinPlatform,
  runMacosLaunchAgentCommand,
  type MacosLaunchAgentDependencies
} from "./macosLaunchAgent";
import {
  createDefaultExecFile as createWindowsExecFile,
  isWindowsPlatform,
  runWindowsServiceCommand,
  type ServiceAction,
  type WindowsServiceDependencies
} from "./windowsService";

export type ServiceCommandDependencies = {
  platform: NodeJS.Platform;
  cliPath: string;
  nodePath: string;
  homedir: () => string;
  getuid: () => number;
  log: (message: string) => void;
  error: (message: string) => void;
  execFile?: MacosLaunchAgentDependencies["execFile"];
  writeFile?: typeof fs.writeFile;
  mkdir?: typeof fs.mkdir;
  unlink?: typeof fs.unlink;
};

function createMacosDeps(deps: ServiceCommandDependencies): MacosLaunchAgentDependencies {
  return {
    execFile: deps.execFile ?? createDefaultExecFile(),
    platform: deps.platform,
    homedir: deps.homedir,
    getuid: deps.getuid,
    writeFile: deps.writeFile ?? fs.writeFile,
    mkdir: deps.mkdir ?? fs.mkdir,
    unlink: deps.unlink ?? fs.unlink,
    cliPath: deps.cliPath,
    log: deps.log,
    error: deps.error
  };
}

function createWindowsDeps(deps: ServiceCommandDependencies): WindowsServiceDependencies {
  return {
    execFile: deps.execFile ?? createWindowsExecFile(),
    platform: deps.platform,
    homedir: deps.homedir,
    writeFile: deps.writeFile ?? fs.writeFile,
    mkdir: deps.mkdir ?? fs.mkdir,
    unlink: deps.unlink ?? fs.unlink,
    nodePath: resolveBundledNodePath(deps.cliPath, deps.nodePath, deps.platform),
    cliPath: deps.cliPath,
    log: deps.log,
    error: deps.error
  };
}

export async function runServiceCommand(action: ServiceAction, deps: ServiceCommandDependencies): Promise<number> {
  if (isWindowsPlatform(deps.platform)) {
    return runWindowsServiceCommand(action, createWindowsDeps(deps));
  }
  if (isDarwinPlatform(deps.platform)) {
    return runMacosLaunchAgentCommand(action, createMacosDeps(deps));
  }
  deps.error("Service commands are only supported on Windows and macOS.");
  return 1;
}
