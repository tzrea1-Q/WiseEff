import os from "node:os";

import { detectBridgePlatform, type BridgeConfig } from "./config";
import { ensureBridgeRunning, type EnsureBridgeRunningDependencies } from "./ensureBridgeRunning";
import { normalizeCorsOrigin } from "./healthServer";
import { stopLocalBridgeHealthListener } from "./localBridgeProcess";
import { writePairingError } from "./pairingErrorStore";

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

export function isBridgeTokenExpired(tokenExpiresAt: string, now = Date.now()) {
  const expires = new Date(tokenExpiresAt);
  return Number.isNaN(expires.getTime()) || expires.getTime() <= now;
}

export async function runPairCommand(
  parsed: ParsedPairArgs,
  deps: CliDependencies
): Promise<{ exitCode: number; config?: BridgeConfig }> {
  const server = parsed.flags.get("server");
  const code = parsed.flags.get("code");
  const webOrigin = parsed.flags.get("webOrigin");
  if (!server || !code) {
    deps.stdout.error("Missing required flags for pair.");
    return { exitCode: 1 };
  }
  if (!isPairingCode(code)) {
    deps.stdout.error("Pairing code must be a 6-digit number.");
    return { exitCode: 1 };
  }

  const normalizedServerUrl = normalizeServerUrl(server);
  const resolvedWebOrigin = webOrigin ? normalizeCorsOrigin(webOrigin) : new URL(normalizedServerUrl).origin;
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
    await writePairingError(
      `配对请求失败（HTTP ${response.status}）。若使用 Clash 等系统代理，请把 ${normalizedServerUrl} 加入直连规则，或设置 NO_PROXY 后重试。`
    );
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
    webOrigin: resolvedWebOrigin,
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
  ensureBridgeRunning: (deps: EnsureBridgeRunningDependencies) => Promise<{ exitCode: number }>;
  stopLocalBridgeHealthListener: typeof stopLocalBridgeHealthListener;
  execPath: string;
  cliPath: string;
  platform: NodeJS.Platform;
};

export async function runConnectCommand(
  deps: ConnectCommandDependencies,
  input: { server: string; code?: string; webOrigin?: string }
): Promise<{ exitCode: number }> {
  const existing = await deps.loadConfig();
  const normalizedServer = normalizeServerUrl(input.server);
  const explicitWebOrigin = input.webOrigin ? normalizeCorsOrigin(input.webOrigin) : undefined;
  const derivedWebOrigin = explicitWebOrigin ?? new URL(normalizedServer).origin;
  const serverMatches = existing?.serverUrl === normalizedServer;
  const tokenValid = existing && !isBridgeTokenExpired(existing.tokenExpiresAt);

  if (input.code) {
    const pairFlags = new Map([
      ["server", input.server],
      ["code", input.code]
    ]);
    if (derivedWebOrigin) {
      pairFlags.set("webOrigin", derivedWebOrigin);
    }
    const pairResult = await runPairCommand(
      {
        flags: pairFlags
      },
      deps
    );
    if (pairResult.exitCode !== 0) {
      return pairResult;
    }
  } else if (!existing || !serverMatches || !tokenValid) {
    if (existing && serverMatches && !tokenValid) {
      deps.stdout.error("Bridge token expired. Pass --code with a new 6-digit pairing code to re-pair.");
    } else {
      deps.stdout.error("Pairing code required. Pass --code with a 6-digit pairing code.");
    }
    return { exitCode: 1 };
  }

  let config = await deps.loadConfig();
  if (!config) {
    deps.stdout.error("Bridge is not paired.");
    return { exitCode: 1 };
  }

  if (explicitWebOrigin && config.webOrigin !== explicitWebOrigin) {
    config = { ...config, webOrigin: explicitWebOrigin };
    await deps.saveConfig(config);
    await deps.stopLocalBridgeHealthListener(deps.platform);
  }

  const webOriginChanged = Boolean(explicitWebOrigin && existing?.webOrigin !== explicitWebOrigin);

  return deps.ensureBridgeRunning({
    fetchImpl: deps.fetchImpl,
    platform: deps.platform,
    execPath: deps.execPath,
    cliPath: deps.cliPath,
    stdout: deps.stdout,
    forceRestart: webOriginChanged
  });
}
