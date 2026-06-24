import os from "node:os";

import { detectBridgePlatform, type BridgeConfig } from "./config";

const BRIDGE_VERSION = "0.1.0";

export type CliDependencies = {
  fetchImpl: typeof fetch;
  loadConfig: () => Promise<BridgeConfig | null>;
  saveConfig: (config: BridgeConfig) => Promise<void>;
  stdout: Pick<Console, "log" | "error">;
};

export type ParsedPairArgs = {
  flags: Map<string, string>;
};

export function normalizeServerUrl(raw: string) {
  const url = new URL(raw);
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function isPairingCode(code: string) {
  return /^\d{6}$/.test(code);
}

export async function runPairCommand(
  parsed: ParsedPairArgs,
  deps: CliDependencies
): Promise<{ exitCode: number; config?: BridgeConfig }> {
  const server = parsed.flags.get("server");
  const code = parsed.flags.get("code");
  if (!server || !code) {
    deps.stdout.error("Missing required flags for pair.");
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

export function waitForTerminationSignal() {
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

export type StartBridgeFn = (config: BridgeConfig) => Promise<{ exitCode: number; statusLine: string }>;

export type ConnectCommandDependencies = CliDependencies & {
  startBridge: StartBridgeFn;
};

export async function runConnectCommand(
  deps: ConnectCommandDependencies,
  input: { server: string; code?: string }
): Promise<{ exitCode: number }> {
  const existing = await deps.loadConfig();
  const serverMatches = existing?.serverUrl === normalizeServerUrl(input.server);

  if (!existing || !serverMatches) {
    if (!input.code) {
      deps.stdout.error("Pairing code required. Pass --code with a 6-digit pairing code.");
      return { exitCode: 1 };
    }
    const pairResult = await runPairCommand(
      {
        flags: new Map([
          ["server", input.server],
          ["code", input.code]
        ])
      },
      deps
    );
    if (pairResult.exitCode !== 0) {
      return pairResult;
    }
  }

  const config = await deps.loadConfig();
  if (!config) {
    deps.stdout.error("Bridge is not paired.");
    return { exitCode: 1 };
  }

  const startResult = await deps.startBridge(config);
  return { exitCode: startResult.exitCode };
}
