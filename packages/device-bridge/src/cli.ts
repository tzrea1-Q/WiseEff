import { execFile as defaultExecFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { access, chmod, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { loadBridgeConfig, saveBridgeConfig, type BridgeConfig } from "./config";
import { createResolvedRpcHandlers } from "./createResolvedRpcHandlers";
import { createToolProbeCache, type BridgeHealthState } from "./healthServer";
import { startHealthServer, type BridgeConnectRequest, type BridgeConnectResult } from "./healthServer";
import { createBridgeWsClient } from "./wsClient";
import { runServiceCommand } from "./serviceCommand";
import type { MacosLaunchAgentDependencies } from "./macosLaunchAgent";
import type { ServiceAction } from "./windowsService";
import {
  runConnectCommand,
  runPairCommand,
  waitForTerminationSignal,
  type CliDependencies,
  type StartBridgeFn
} from "./connectCommand";
import { ensureBridgeRunning, spawnDetachedConnect } from "./ensureBridgeRunning";
import { kickOffInstallTools, runToolsInstallCliCommand } from "./toolsInstallCli";
import { parseBridgeUrl } from "./urlScheme";
import { createProxiedFetch } from "./proxyFetch";
import {
  pairingStartupErrorMessage,
  resolveBridgeLauncherPath,
  resolveWindowsBridgeLauncher
} from "./bridgeRuntimePaths";
import { appendBridgeLaunchLog } from "./bridgeLaunchLog";
import { clearPairingError, readPairingError, writePairingError } from "./pairingErrorStore";
import {
  isPortableUrlSchemeRegistered,
  runMacosUrlSchemeCommand,
  type MacosUrlSchemeDependencies,
  type ExecFileFn
} from "./macosUrlScheme";
import {
  isWindowsUrlSchemeRegistered,
  runWindowsUrlSchemeCommand,
  type ExecFileFn as WindowsUrlSchemeExecFileFn,
  type WindowsUrlSchemeDependencies
} from "./windowsUrlScheme";

const CLI_ENTRY_PATH = fileURLToPath(import.meta.url);

type ParsedArgs = {
  command?: "pair" | "start" | "status" | "service" | "connect" | "tools" | "register" | "unregister";
  toolsAction?: "install";
  serviceAction?: ServiceAction;
  flags: Map<string, string>;
};

const SERVICE_ACTIONS = new Set<ServiceAction>(["install", "start", "stop", "uninstall"]);

function parseFlags(tokens: string[]): Map<string, string> {
  const flags = new Map<string, string>();

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const next = tokens[index + 1];
    if (next && !next.startsWith("--")) {
      flags.set(key, next);
      index += 1;
      continue;
    }
    flags.set(key, "true");
  }

  return flags;
}

function parseArgs(argv: string[]): ParsedArgs {
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--handle-url" && argv[index + 1]) {
      return { flags: new Map([["handle-url", argv[index + 1]]]) };
    }
  }

  const [command, ...rest] = argv;

  if (command === "service") {
    const [serviceAction, ...serviceRest] = rest;
    if (serviceAction && SERVICE_ACTIONS.has(serviceAction as ServiceAction)) {
      return { command: "service", serviceAction: serviceAction as ServiceAction, flags: parseFlags(serviceRest) };
    }
    return { command: "service", flags: parseFlags(rest) };
  }

  if (command === "tools") {
    const [toolsAction, ...toolsRest] = rest;
    if (toolsAction === "install") {
      return { command: "tools", toolsAction: "install", flags: parseFlags(toolsRest) };
    }
    return { command: "tools", flags: parseFlags(rest) };
  }

  if (command === "pair" || command === "start" || command === "status" || command === "connect" || command === "register" || command === "unregister") {
    return { command, flags: parseFlags(rest) };
  }
  return { flags: parseFlags(rest) };
}

function usage() {
  return [
    "wiseeff-bridge <command>",
    "",
    "Commands:",
    "  connect --server <url> [--code <6-digit-code>] [--webOrigin <url>]",
    "  pair --server <url> --code <6-digit-code>",
    "  start",
    "  status",
    "  register          Register wiseeff-bridge:// URL scheme (Windows/macOS)",
    "  unregister        Remove URL scheme registration (Windows/macOS)",
    "  service install   Register background service (Windows service or macOS LaunchAgent)",
    "  service start     Start installed service",
    "  service stop      Stop installed service",
    "  service uninstall Remove installed service",
    "  tools install --protocol adb|hdc|all [--server <url>] [--force]",
    "",
    "Options:",
    "  --handle-url <wiseeff-bridge://...>  Handle URL scheme activation"
  ].join("\n");
}

function createHttpConnectHandler(
  deps: CliDependencies,
  runtimePaths: { cliPath: string; platform: NodeJS.Platform },
  overrides: {
    ensureBridgeRunning?: typeof ensureBridgeRunning;
    execPath?: string;
  } = {}
) {
  const connectDeps = {
    ...deps,
    ensureBridgeRunning: overrides.ensureBridgeRunning ?? ensureBridgeRunning,
    execPath: overrides.execPath ?? process.execPath,
    cliPath: runtimePaths.cliPath,
    platform: runtimePaths.platform
  };

  return async (request: BridgeConnectRequest): Promise<BridgeConnectResult> => {
    await appendBridgeLaunchLog(`http-connect server=${request.server} code=${request.code ?? "none"}`);
    spawnDetachedConnect(connectDeps, request);
    return { ok: true, accepted: true };
  };
}

async function runStartCommand(
  deps: CliDependencies,
  config: BridgeConfig,
  runtimePaths: { cliPath: string; platform: NodeJS.Platform }
): Promise<{ exitCode: number; statusLine: string }> {
  const runtime = await createResolvedRpcHandlers();
  const toolProbeCache = createToolProbeCache({
    probe: () => runtime.probeTools()
  });

  await toolProbeCache.refreshTools(true);

  const launcherPath = resolveBridgeLauncherPath(runtimePaths.cliPath, runtimePaths.platform);

  let status: BridgeHealthState = {
    paired: true,
    connected: false,
    bridgeId: config.bridgeId,
    serverUrl: config.serverUrl,
    tokenExpiresAt: config.tokenExpiresAt,
    lastError: undefined,
    launcherPath,
    updatedAt: new Date().toISOString(),
    tools: toolProbeCache.getTools(),
    toolsInstall: toolProbeCache.getToolsInstall()
  };

  const wsClient = createBridgeWsClient({
    serverUrl: config.serverUrl,
    bridgeToken: config.bridgeToken,
    rpc: runtime.rpc,
    onStatusChange: (next) => {
      status = {
        paired: true,
        connected: next.connected,
        bridgeId: next.bridgeId ?? config.bridgeId,
        serverUrl: config.serverUrl,
        tokenExpiresAt: config.tokenExpiresAt,
        lastError: next.lastError,
        launcherPath,
        updatedAt: next.updatedAt,
        tools: toolProbeCache.getTools(),
        toolsInstall: toolProbeCache.getToolsInstall()
      };
    }
  });

  const health = await startHealthServer({
    getState: () => status,
    allowedOrigin: [config.webOrigin, config.serverUrl].filter(Boolean),
    onConnect: createHttpConnectHandler(deps, runtimePaths),
    onHealthRead: async () => {
      await toolProbeCache.refreshTools();
      status = {
        ...status,
        tools: toolProbeCache.getTools(),
        toolsInstall: toolProbeCache.getToolsInstall(),
        updatedAt: new Date().toISOString()
      };
    },
    onToolsInstall: async (protocol) => {
      toolProbeCache.setToolsInstall({
        status: "running",
        protocol,
        updatedAt: new Date().toISOString()
      });
      status = {
        ...status,
        toolsInstall: toolProbeCache.getToolsInstall(),
        updatedAt: new Date().toISOString()
      };
      kickOffInstallTools({
        serverUrl: config.serverUrl,
        protocol,
        fetchImpl: deps.fetchImpl,
        onStatus: (next) => {
          toolProbeCache.setToolsInstall({
            status: next.status,
            protocol: next.protocol,
            error: next.error,
            updatedAt: new Date().toISOString()
          });
          if (next.status === "succeeded") {
            void toolProbeCache.refreshTools(true).then((tools) => {
              status = {
                ...status,
                tools,
                toolsInstall: toolProbeCache.getToolsInstall(),
                updatedAt: new Date().toISOString()
              };
            });
            return;
          }
          status = {
            ...status,
            toolsInstall: toolProbeCache.getToolsInstall(),
            updatedAt: new Date().toISOString()
          };
        }
      });
    }
  });

  wsClient.start();
  deps.stdout.log(`Bridge started. Health: ${health.url}`);
  deps.stdout.log("Press Ctrl+C to stop.");

  await waitForTerminationSignal();
  wsClient.stop();
  await health.close();
  deps.stdout.log("Bridge stopped.");
  return { exitCode: 0, statusLine: status.connected ? "connected" : "disconnected" };
}

async function runStandbyStartCommand(
  deps: CliDependencies,
  runtimePaths: { cliPath: string; platform: NodeJS.Platform }
): Promise<number> {
  const existingHealth = await deps.fetchImpl("http://127.0.0.1:18787/health").catch(() => null);
  if (existingHealth?.ok) {
    deps.stdout.log("Bridge service already running.");
    return 0;
  }

  const runtime = await createResolvedRpcHandlers();
  const toolProbeCache = createToolProbeCache({
    probe: () => runtime.probeTools()
  });

  const launcherPath = resolveBridgeLauncherPath(runtimePaths.cliPath, runtimePaths.platform);

  let status: BridgeHealthState = {
    paired: false,
    connected: false,
    launcherPath,
    updatedAt: new Date().toISOString()
  };

  try {
    const health = await startHealthServer({
      getState: () => status,
      onConnect: createHttpConnectHandler(deps, runtimePaths),
      onHealthRead: async () => {
        await toolProbeCache.refreshTools();
        const pairingError = await readPairingError();
        status = {
          ...status,
          tools: toolProbeCache.getTools(),
          toolsInstall: toolProbeCache.getToolsInstall(),
          pairingError,
          updatedAt: new Date().toISOString()
        };
      }
    });

    await toolProbeCache.refreshTools(true);
    const initialError = await readPairingError();
    status = {
      ...status,
      tools: toolProbeCache.getTools(),
      toolsInstall: toolProbeCache.getToolsInstall(),
      pairingError: initialError
    };

    deps.stdout.log(`Bridge standby started. Health: ${health.url}`);
    deps.stdout.log("Pair from the web UI to finish setup.");
    if (runtimePaths.platform === "darwin") {
      const registered = await isPortableUrlSchemeRegistered({
        homedir: () => os.homedir(),
        access
      });
      if (!registered) {
        deps.stdout.log("To enable browser pairing via URL scheme, run: wiseeff-bridge register");
      }
    }
    if (runtimePaths.platform === "win32") {
      const urlSchemeDeps = createWindowsUrlSchemeDeps(deps, runtimePaths);
      const registered = await isWindowsUrlSchemeRegistered(launcherPath, urlSchemeDeps);
      if (!registered) {
        deps.stdout.log("To enable browser pairing via URL scheme, run: wiseeff-bridge register");
      }
    }

    await waitForTerminationSignal();
    await health.close();
    deps.stdout.log("Bridge stopped.");
    return 0;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EADDRINUSE") {
      deps.stdout.log("Bridge service already running.");
      return 0;
    }
    throw error;
  }
}

async function runStatusCommand(deps: CliDependencies, config: BridgeConfig | null): Promise<number> {
  const response = await deps.fetchImpl("http://127.0.0.1:18787/health").catch(() => null);
  if (!response || !response.ok) {
    if (config) {
      deps.stdout.log(`paired bridge=${config.bridgeId} server=${config.serverUrl} bridgeStatus=offline`);
      return 0;
    }
    deps.stdout.log("bridgeStatus=offline paired=false");
    return 0;
  }
  const payload = (await response.json()) as { connected?: boolean; paired?: boolean; lastError?: string };
  if (!config) {
    const bridgeStatus = payload.connected ? "connected" : "disconnected";
    const paired = payload.paired === true ? "true" : "false";
    deps.stdout.log(`bridgeStatus=${bridgeStatus} paired=${paired}`);
    return 0;
  }
  const bridgeStatus = payload.connected ? "connected" : "disconnected";
  const lastError = typeof payload.lastError === "string" && payload.lastError ? ` error=${payload.lastError}` : "";
  deps.stdout.log(`paired bridge=${config.bridgeId} server=${config.serverUrl} bridgeStatus=${bridgeStatus}${lastError}`);
  return 0;
}

export async function runCli(
  argv = process.argv.slice(2),
  overrides: Partial<CliDependencies> & {
    startBridge?: StartBridgeFn;
    ensureBridgeRunning?: typeof ensureBridgeRunning;
    execPath?: string;
    cliPath?: string;
    platform?: NodeJS.Platform;
    execFile?: MacosLaunchAgentDependencies["execFile"];
    mkdir?: MacosLaunchAgentDependencies["mkdir"];
    writeFile?: MacosLaunchAgentDependencies["writeFile"];
    unlink?: MacosLaunchAgentDependencies["unlink"];
  } = {}
) {
  const existingConfig = await (overrides.loadConfig ?? (() => loadBridgeConfig()))().catch(() => null);
  const proxiedFetch = overrides.fetchImpl ?? (await createProxiedFetch({ serverUrl: existingConfig?.serverUrl }));
  const deps: CliDependencies = {
    fetchImpl: overrides.fetchImpl ?? proxiedFetch,
    loadConfig: overrides.loadConfig ?? (() => loadBridgeConfig()),
    saveConfig: overrides.saveConfig ?? ((config) => saveBridgeConfig(config)),
    stdout: overrides.stdout ?? console
  };
  const startBridge =
    overrides.startBridge ??
    ((config) =>
      runStartCommand(deps, config, {
        cliPath: overrides.cliPath ?? CLI_ENTRY_PATH,
        platform: overrides.platform ?? process.platform
      }));
  const connectDeps = {
    ...deps,
    ensureBridgeRunning: overrides.ensureBridgeRunning ?? ensureBridgeRunning,
    execPath: overrides.execPath ?? process.execPath,
    cliPath: overrides.cliPath ?? CLI_ENTRY_PATH,
    platform: overrides.platform ?? process.platform
  };
  const serviceDeps = {
    platform: overrides.platform ?? process.platform,
    cliPath: overrides.cliPath ?? CLI_ENTRY_PATH,
    nodePath: overrides.execPath ?? process.execPath,
    homedir: () => os.homedir(),
    getuid: () => process.getuid?.() ?? 501,
    execFile: overrides.execFile,
    mkdir: overrides.mkdir,
    writeFile: overrides.writeFile,
    unlink: overrides.unlink,
    log: (message: string) => deps.stdout.log(message),
    error: (message: string) => deps.stdout.error(message)
  };

  const parsed = parseArgs(argv);

  const handleUrl = parsed.flags.get("handle-url");
  if (handleUrl) {
    try {
      const parsedUrl = parseBridgeUrl(handleUrl);
      if (parsedUrl.kind === "install-service") {
        await appendBridgeLaunchLog("handle-url install-service");
        return runServiceCommand("install", serviceDeps);
      }
      if (parsedUrl.kind === "connect") {
        await appendBridgeLaunchLog(`handle-url connect server=${parsedUrl.server} code=${parsedUrl.code ?? "none"}`);
        const result = await runConnectCommand(connectDeps, parsedUrl);
        if (result.exitCode !== 0) {
          await writePairingError(pairingStartupErrorMessage(connectDeps.platform));
          await appendBridgeLaunchLog(`handle-url connect failed exit=${result.exitCode}`);
        } else {
          await clearPairingError();
          await appendBridgeLaunchLog("handle-url connect succeeded");
        }
        return result.exitCode;
      }
      const config = await deps.loadConfig();
      const serverUrl = parsedUrl.server ?? config?.serverUrl;
      if (!serverUrl) {
        deps.stdout.error("Bridge is not paired yet. Pair before installing tools.");
        return 1;
      }
      kickOffInstallTools({
        serverUrl,
        protocol: parsedUrl.protocol,
        fetchImpl: deps.fetchImpl,
        onStatus: (status) => {
          if (status.status === "failed") {
            deps.stdout.error(status.error ?? "Tool install failed.");
          }
        }
      });
      deps.stdout.log(`Installing ${parsedUrl.protocol} tools from ${serverUrl}...`);
      return 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid bridge URL";
      deps.stdout.error(message);
      await writePairingError(message);
      await appendBridgeLaunchLog(`handle-url error=${message}`);
      return 1;
    }
  }

  if (!parsed.command) {
    deps.stdout.log(usage());
    return 1;
  }

  if (parsed.command === "connect") {
    const server = parsed.flags.get("server");
    const code = parsed.flags.get("code");
    const webOrigin = parsed.flags.get("webOrigin");
    if (!server) {
      deps.stdout.error("Missing required flag: --server");
      deps.stdout.log(usage());
      return 1;
    }
    const result = await runConnectCommand(connectDeps, { server, code, webOrigin });
    return result.exitCode;
  }

  if (parsed.command === "pair") {
    const result = await runPairCommand(parsed, deps);
    if (result.exitCode !== 0) {
      await writePairingError(`配对失败。请检查网络代理设置（HTTPS_PROXY 环境变量或 ~/.wiseeff/proxy.json）。`);
    } else {
      await clearPairingError();
    }
    return result.exitCode;
  }

  if (parsed.command === "service") {
    if (!parsed.serviceAction) {
      deps.stdout.error("Missing service action.");
      deps.stdout.log(usage());
      return 1;
    }
    return runServiceCommand(parsed.serviceAction, serviceDeps);
  }

  if (parsed.command === "tools") {
    if (parsed.toolsAction !== "install") {
      deps.stdout.error("Missing tools action.");
      deps.stdout.log(usage());
      return 1;
    }
    const protocol = parsed.flags.get("protocol") ?? "all";
    if (protocol !== "adb" && protocol !== "hdc" && protocol !== "all") {
      deps.stdout.error("Protocol must be adb, hdc, or all.");
      return 1;
    }
    return runToolsInstallCliCommand(deps, {
      server: parsed.flags.get("server"),
      protocol,
      force: parsed.flags.get("force") === "true"
    });
  }

  if (parsed.command === "register" || parsed.command === "unregister") {
    const platform = overrides.platform ?? process.platform;
    if (platform === "darwin") {
      return runMacosUrlSchemeCommand(
        parsed.command,
        createMacosUrlSchemeDeps(deps, {
          platform,
          cliPath: overrides.cliPath,
          execPath: overrides.execPath,
          execFile: overrides.execFile as ExecFileFn | undefined
        })
      );
    }
    if (platform === "win32") {
      const runtimePaths = {
        cliPath: overrides.cliPath ?? CLI_ENTRY_PATH,
        platform: "win32" as const
      };
      return runWindowsUrlSchemeCommand(
        parsed.command,
        resolveWindowsRegisterLauncherPath(runtimePaths.cliPath),
        createWindowsUrlSchemeDeps(deps, runtimePaths, overrides.execFile as WindowsUrlSchemeExecFileFn | undefined)
      );
    }
    deps.stdout.error("register is only available on Windows and macOS.");
    return 1;
  }

  const config = await deps.loadConfig();

  if (parsed.command === "start") {
    const runtimePaths = {
      cliPath: overrides.cliPath ?? CLI_ENTRY_PATH,
      platform: overrides.platform ?? process.platform
    };
    if (!config) {
      return runStandbyStartCommand(deps, runtimePaths);
    }
    const result = await runStartCommand(deps, config, runtimePaths);
    return result.exitCode;
  }

  if (!config) {
    if (parsed.command === "status") {
      return runStatusCommand(deps, null);
    }
    deps.stdout.error("Bridge is not paired yet. Run: wiseeff-bridge pair --server <url> --code <6-digit-code>");
    return 1;
  }

  return runStatusCommand(deps, config);
}

function resolveWindowsRegisterLauncherPath(cliPath: string): string {
  return (
    resolveWindowsBridgeLauncher(cliPath, "win32") ??
    path.win32.join(path.win32.dirname(cliPath), "wiseeff-bridge.cmd")
  );
}

function createWindowsUrlSchemeDeps(
  deps: CliDependencies,
  runtimePaths: { cliPath: string; platform: NodeJS.Platform },
  execFileOverride?: WindowsUrlSchemeExecFileFn
): WindowsUrlSchemeDependencies {
  const execFileAsync = promisify(defaultExecFile);
  const defaultExecFileFn: WindowsUrlSchemeExecFileFn = async (file, args, options) => {
    const { stdout, stderr } = await execFileAsync(file, args, {
      ...options,
      encoding: "utf8"
    });
    return { stdout: String(stdout), stderr: String(stderr) };
  };

  return {
    platform: runtimePaths.platform,
    execFile: execFileOverride ?? defaultExecFileFn,
    log: (message) => deps.stdout.log(message),
    error: (message) => deps.stdout.error(message)
  };
}

function createMacosUrlSchemeDeps(
  deps: CliDependencies,
  overrides: Partial<MacosUrlSchemeDependencies> & {
    platform?: NodeJS.Platform;
    cliPath?: string;
    execPath?: string;
    execFile?: ExecFileFn;
  } = {}
): MacosUrlSchemeDependencies {
  const execFileAsync = promisify(defaultExecFile);
  const defaultExecFileFn: ExecFileFn = async (file, args, options) => {
    const { stdout, stderr } = await execFileAsync(file, args, {
      ...options,
      encoding: "utf8"
    });
    return { stdout: String(stdout), stderr: String(stderr) };
  };

  return {
    platform: overrides.platform ?? process.platform,
    homedir: () => os.homedir(),
    execFile: overrides.execFile ?? defaultExecFileFn,
    mkdir,
    writeFile,
    chmod,
    rm,
    access,
    nodePath: overrides.execPath ?? process.execPath,
    cliPath: overrides.cliPath ?? CLI_ENTRY_PATH,
    log: (message) => deps.stdout.log(message),
    error: (message) => deps.stdout.error(message)
  };
}

function resolveCliEntryPath(filePath: string) {
  try {
    return realpathSync(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

function isCliEntryPoint(argv: string[] = process.argv) {
  const entryPath = argv[1];
  if (!entryPath) {
    return false;
  }
  return resolveCliEntryPath(fileURLToPath(import.meta.url)) === resolveCliEntryPath(entryPath);
}

if (isCliEntryPoint()) {
  const exitCode = await runCli();
  process.exit(exitCode);
}

export { isCliEntryPoint, parseArgs, resolveCliEntryPath, runStartCommand };
