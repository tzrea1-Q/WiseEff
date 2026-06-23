import os from "node:os";

import { detectBridgePlatform, loadBridgeConfig, saveBridgeConfig, type BridgeConfig } from "./config";
import { createRpcHandlers } from "./rpcHandlers";
import { startHealthServer } from "./healthServer";
import { createBridgeWsClient } from "./wsClient";

const BRIDGE_VERSION = "0.1.0";

type ParsedArgs = {
  command?: "pair" | "start" | "status";
  flags: Map<string, string>;
};

type CliDependencies = {
  fetchImpl: typeof fetch;
  loadConfig: () => Promise<BridgeConfig | null>;
  saveConfig: (config: BridgeConfig) => Promise<void>;
  stdout: Pick<Console, "log" | "error">;
};

function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const flags = new Map<string, string>();

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const next = rest[index + 1];
    if (next && !next.startsWith("--")) {
      flags.set(key, next);
      index += 1;
      continue;
    }
    flags.set(key, "true");
  }

  if (command === "pair" || command === "start" || command === "status") {
    return { command, flags };
  }
  return { flags };
}

function usage() {
  return [
    "wiseeff-bridge <command>",
    "",
    "Commands:",
    "  pair --server <url> --code <6-digit-code>",
    "  start",
    "  status"
  ].join("\n");
}

function normalizeServerUrl(raw: string) {
  const url = new URL(raw);
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function isPairingCode(code: string) {
  return /^\d{6}$/.test(code);
}

async function runPairCommand(
  parsed: ParsedArgs,
  deps: CliDependencies
): Promise<{ exitCode: number; config?: BridgeConfig }> {
  const server = parsed.flags.get("server");
  const code = parsed.flags.get("code");
  if (!server || !code) {
    deps.stdout.error("Missing required flags for pair.");
    deps.stdout.log(usage());
    return { exitCode: 1 };
  }
  if (!isPairingCode(code)) {
    deps.stdout.error("Pairing code must be a 6-digit number.");
    return { exitCode: 1 };
  }

  const normalizedServerUrl = normalizeServerUrl(server);
  const requestBody = {
    code,
    machineLabel: os.hostname(),
    platform: detectBridgePlatform(),
    arch: process.arch,
    clientVersion: BRIDGE_VERSION
  };

  const response = await deps.fetchImpl(`${normalizedServerUrl}/api/v1/device-bridges/pair`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(requestBody)
  });
  if (!response.ok) {
    const body = await response.text();
    deps.stdout.error(`Pair request failed (${response.status}): ${body}`);
    return { exitCode: 1 };
  }

  const payload = (await response.json()) as {
    bridgeId: string;
    bridgeToken: string;
    tokenExpiresAt: string;
  };
  if (!payload.bridgeId || !payload.bridgeToken || !payload.tokenExpiresAt) {
    deps.stdout.error("Pair response is missing required fields.");
    return { exitCode: 1 };
  }

  const config: BridgeConfig = {
    bridgeId: payload.bridgeId,
    bridgeToken: payload.bridgeToken,
    tokenExpiresAt: payload.tokenExpiresAt,
    serverUrl: normalizedServerUrl,
    machineLabel: requestBody.machineLabel,
    platform: requestBody.platform,
    arch: requestBody.arch,
    clientVersion: requestBody.clientVersion,
    pairedAt: new Date().toISOString()
  };
  await deps.saveConfig(config);
  deps.stdout.log(`Paired bridge ${config.bridgeId} with ${config.serverUrl}`);
  return { exitCode: 0, config };
}

function waitForTerminationSignal() {
  return new Promise<void>((resolve) => {
    const shutdown = () => {
      process.off("SIGINT", shutdown);
      process.off("SIGTERM", shutdown);
      resolve();
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
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

export async function runCli(argv = process.argv.slice(2), overrides: Partial<CliDependencies> = {}) {
  const deps: CliDependencies = {
    fetchImpl: overrides.fetchImpl ?? fetch,
    loadConfig: overrides.loadConfig ?? (() => loadBridgeConfig()),
    saveConfig: overrides.saveConfig ?? ((config) => saveBridgeConfig(config)),
    stdout: overrides.stdout ?? console
  };

  const parsed = parseArgs(argv);
  if (!parsed.command) {
    deps.stdout.log(usage());
    return 1;
  }

  if (parsed.command === "pair") {
    const result = await runPairCommand(parsed, deps);
    return result.exitCode;
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

export { parseArgs };
