import { fileURLToPath } from "node:url";

import { loadBridgeConfig, saveBridgeConfig, type BridgeConfig } from "./config";
import { createRpcHandlers } from "./rpcHandlers";
import { startHealthServer } from "./healthServer";
import { createBridgeWsClient } from "./wsClient";
import { runWindowsServiceCommand, type ServiceAction } from "./windowsService";
import {
  runConnectCommand,
  runPairCommand,
  waitForTerminationSignal,
  type CliDependencies,
  type StartBridgeFn
} from "./connectCommand";
import { parseConnectUrl } from "./urlScheme";

const CLI_ENTRY_PATH = fileURLToPath(import.meta.url);

type ParsedArgs = {
  command?: "pair" | "start" | "status" | "service" | "connect";
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

  if (command === "pair" || command === "start" || command === "status" || command === "connect") {
    return { command, flags: parseFlags(rest) };
  }
  return { flags: parseFlags(rest) };
}

function usage() {
  return [
    "wiseeff-bridge <command>",
    "",
    "Commands:",
    "  connect --server <url> [--code <6-digit-code>]",
    "  pair --server <url> --code <6-digit-code>",
    "  start",
    "  status",
    "  service install   Register background service (Windows only)",
    "  service start     Start installed service (Windows only)",
    "  service stop      Stop installed service (Windows only)",
    "  service uninstall Remove installed service (Windows only)",
    "",
    "Options:",
    "  --handle-url <wiseeff-bridge://...>  Handle URL scheme activation"
  ].join("\n");
}

async function runStartCommand(
  deps: CliDependencies,
  config: BridgeConfig
): Promise<{ exitCode: number; statusLine: string }> {
  const rpc = createRpcHandlers();
  let status = {
    paired: true,
    connected: false,
    bridgeId: config.bridgeId,
    serverUrl: config.serverUrl,
    lastError: undefined as string | undefined,
    updatedAt: new Date().toISOString()
  };

  const wsClient = createBridgeWsClient({
    serverUrl: config.serverUrl,
    bridgeToken: config.bridgeToken,
    rpc,
    onStatusChange: (next) => {
      status = {
        paired: true,
        connected: next.connected,
        bridgeId: next.bridgeId ?? config.bridgeId,
        serverUrl: config.serverUrl,
        lastError: next.lastError,
        updatedAt: next.updatedAt
      };
    }
  });

  const health = await startHealthServer({
    getState: () => status
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

async function runStatusCommand(deps: CliDependencies, config: BridgeConfig): Promise<number> {
  const response = await deps.fetchImpl("http://127.0.0.1:18787/health").catch(() => null);
  if (!response || !response.ok) {
    deps.stdout.log(`paired bridge=${config.bridgeId} server=${config.serverUrl} bridgeStatus=offline`);
    return 0;
  }
  const payload = (await response.json()) as { connected?: boolean; lastError?: string };
  const bridgeStatus = payload.connected ? "connected" : "disconnected";
  const lastError = typeof payload.lastError === "string" && payload.lastError ? ` error=${payload.lastError}` : "";
  deps.stdout.log(`paired bridge=${config.bridgeId} server=${config.serverUrl} bridgeStatus=${bridgeStatus}${lastError}`);
  return 0;
}

export async function runCli(
  argv = process.argv.slice(2),
  overrides: Partial<CliDependencies> & { startBridge?: StartBridgeFn } = {}
) {
  const deps: CliDependencies = {
    fetchImpl: overrides.fetchImpl ?? fetch,
    loadConfig: overrides.loadConfig ?? (() => loadBridgeConfig()),
    saveConfig: overrides.saveConfig ?? ((config) => saveBridgeConfig(config)),
    stdout: overrides.stdout ?? console
  };
  const startBridge = overrides.startBridge ?? ((config) => runStartCommand(deps, config));

  const parsed = parseArgs(argv);

  const handleUrl = parsed.flags.get("handle-url");
  if (handleUrl) {
    try {
      const parsedUrl = parseConnectUrl(handleUrl);
      const result = await runConnectCommand(
        {
          ...deps,
          startBridge
        },
        parsedUrl
      );
      return result.exitCode;
    } catch (error) {
      deps.stdout.error(error instanceof Error ? error.message : "Invalid bridge URL");
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
    if (!server) {
      deps.stdout.error("Missing required flag: --server");
      deps.stdout.log(usage());
      return 1;
    }
    const result = await runConnectCommand(
      {
        ...deps,
        startBridge
      },
      { server, code }
    );
    return result.exitCode;
  }

  if (parsed.command === "pair") {
    const result = await runPairCommand(parsed, deps);
    return result.exitCode;
  }

  if (parsed.command === "service") {
    if (!parsed.serviceAction) {
      deps.stdout.error("Missing service action.");
      deps.stdout.log(usage());
      return 1;
    }
    return runWindowsServiceCommand(parsed.serviceAction, {
      cliPath: CLI_ENTRY_PATH,
      log: (message) => deps.stdout.log(message),
      error: (message) => deps.stdout.error(message)
    });
  }

  const config = await deps.loadConfig();
  if (!config) {
    deps.stdout.error("Bridge is not paired yet. Run: wiseeff-bridge pair --server <url> --code <6-digit-code>");
    return 1;
  }

  if (parsed.command === "start") {
    const result = await runStartCommand(deps, config);
    return result.exitCode;
  }

  return runStatusCommand(deps, config);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const exitCode = await runCli();
  process.exit(exitCode);
}

export { parseArgs, runStartCommand };
