import type { LocalBridgeHealthState, ToolProbeState } from "./deviceBridgeClient";
import { resolveBridgeServerUrl, resolveBridgeWebOrigin } from "./bridgeServerUrl";
import { resolveLocalBridgeHealthUrl } from "./localBridgeHttpUrl";

export function buildBridgeConnectUrl(serverUrl?: string, code?: string, webOrigin?: string) {
  const url = new URL("wiseeff-bridge://connect");
  url.searchParams.set("server", serverUrl ?? resolveBridgeServerUrl());
  const origin = webOrigin ?? resolveBridgeWebOrigin();
  if (origin) {
    url.searchParams.set("webOrigin", origin);
  }
  if (code) {
    url.searchParams.set("code", code);
  }
  return url.toString();
}

export function launchBridgeConnect(url: string) {
  window.location.href = url;
}

export function buildBridgeInstallServiceUrl() {
  return "wiseeff-bridge://install-service";
}

export function launchBridgeInstallService() {
  window.location.href = buildBridgeInstallServiceUrl();
}

export type LocalBridgeReachability = "ok" | "offline" | "possibly_blocked";

export type LocalBridgeProbeResult = {
  health: LocalBridgeHealthState | null;
  reachability: LocalBridgeReachability;
};

export function classifyLocalBridgeReachability(pageOrigin: string): LocalBridgeReachability {
  return isRemoteWebOrigin(pageOrigin) ? "possibly_blocked" : "offline";
}

function isRemoteWebOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return host !== "localhost" && host !== "127.0.0.1" && host !== "[::1]";
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseToolProbeState(value: unknown): ToolProbeState | undefined {
  if (typeof value !== "object" || value === null || typeof (value as ToolProbeState).available !== "boolean") {
    return undefined;
  }
  const record = value as ToolProbeState;
  return {
    available: record.available,
    source: record.source === "managed" || record.source === "system" ? record.source : undefined,
    version: typeof record.version === "string" ? record.version : undefined,
    reason: typeof record.reason === "string" ? record.reason : undefined
  };
}

function parseLocalBridgeHealthBody(body: Record<string, unknown>): LocalBridgeHealthState | null {
  if (body.ok !== true || typeof body.updatedAt !== "string") {
    return null;
  }

  let tools: LocalBridgeHealthState["tools"];
  if (isRecord(body.tools)) {
    const adb = parseToolProbeState(body.tools.adb);
    const hdc = parseToolProbeState(body.tools.hdc);
    if (adb && hdc) {
      tools = { adb, hdc };
    }
  }

  let toolsInstall: LocalBridgeHealthState["toolsInstall"];
  if (isRecord(body.toolsInstall) && typeof body.toolsInstall.updatedAt === "string") {
    const status = body.toolsInstall.status;
    if (status === "idle" || status === "running" || status === "succeeded" || status === "failed") {
      toolsInstall = {
        status,
        protocol:
          body.toolsInstall.protocol === "adb" ||
          body.toolsInstall.protocol === "hdc" ||
          body.toolsInstall.protocol === "all"
            ? body.toolsInstall.protocol
            : undefined,
        error: typeof body.toolsInstall.error === "string" ? body.toolsInstall.error : undefined,
        updatedAt: body.toolsInstall.updatedAt
      };
    }
  }

  return {
    ok: true,
    paired: Boolean(body.paired),
    connected: Boolean(body.connected),
    bridgeId: typeof body.bridgeId === "string" ? body.bridgeId : undefined,
    serverUrl: typeof body.serverUrl === "string" ? body.serverUrl : undefined,
    tokenExpiresAt: typeof body.tokenExpiresAt === "string" ? body.tokenExpiresAt : undefined,
    lastError: typeof body.lastError === "string" ? body.lastError : undefined,
    pairingError: typeof body.pairingError === "string" ? body.pairingError : undefined,
    updatedAt: body.updatedAt,
    tools,
    toolsInstall
  };
}

export async function probeLocalBridgeHealth(fetchImpl: typeof fetch = fetch): Promise<LocalBridgeHealthState | null> {
  const result = await probeLocalBridgeHealthDetailed(fetchImpl);
  return result.health;
}

export async function probeLocalBridgeHealthDetailed(
  fetchImpl: typeof fetch = fetch,
  pageOrigin: string = typeof window === "undefined" ? "" : window.location.origin
): Promise<LocalBridgeProbeResult> {
  try {
    const response = await fetchImpl(resolveLocalBridgeHealthUrl());
    if (!response.ok) {
      return { health: null, reachability: "offline" };
    }
    const body = (await response.json()) as Record<string, unknown>;
    return {
      health: parseLocalBridgeHealthBody(body),
      reachability: "ok"
    };
  } catch {
    return {
      health: null,
      reachability: classifyLocalBridgeReachability(pageOrigin)
    };
  }
}

export async function pollLocalBridgeHealth(options: {
  fetchImpl?: typeof fetch;
  intervalMs?: number;
  timeoutMs?: number;
}): Promise<LocalBridgeHealthState | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const intervalMs = options.intervalMs ?? 2000;
  const timeoutMs = options.timeoutMs ?? 30000;
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const health = await probeLocalBridgeHealth(fetchImpl);
    if (health?.connected) {
      return health;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return probeLocalBridgeHealth(fetchImpl);
}

export function shouldConfirmBridgeSchemeLaunch(storage: Pick<Storage, "getItem"> = window.localStorage) {
  return storage.getItem("wiseeff.bridgeSchemeConfirm") !== "1";
}

export function rememberBridgeSchemeLaunchConfirm(storage: Pick<Storage, "setItem"> = window.localStorage) {
  storage.setItem("wiseeff.bridgeSchemeConfirm", "1");
}
