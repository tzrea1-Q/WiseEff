import type { LocalBridgeHealthState } from "./deviceBridgeClient";

export function buildBridgeConnectUrl(origin: string, code?: string) {
  const url = new URL("wiseeff-bridge://connect");
  url.searchParams.set("server", origin);
  if (code) {
    url.searchParams.set("code", code);
  }
  return url.toString();
}

export function launchBridgeConnect(url: string) {
  window.location.href = url;
}

export async function probeLocalBridgeHealth(fetchImpl: typeof fetch = fetch): Promise<LocalBridgeHealthState | null> {
  try {
    const response = await fetchImpl("http://127.0.0.1:18787/health");
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as Record<string, unknown>;
    if (body.ok !== true || typeof body.updatedAt !== "string") {
      return null;
    }
    return {
      ok: true,
      paired: Boolean(body.paired),
      connected: Boolean(body.connected),
      bridgeId: typeof body.bridgeId === "string" ? body.bridgeId : undefined,
      serverUrl: typeof body.serverUrl === "string" ? body.serverUrl : undefined,
      lastError: typeof body.lastError === "string" ? body.lastError : undefined,
      updatedAt: body.updatedAt
    };
  } catch {
    return null;
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
