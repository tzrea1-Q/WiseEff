import type { LocalBridgeHealthState } from "./deviceBridgeClient";
import { resolveLocalBridgeHealthUrl } from "./localBridgeHttpUrl";

export type DebugConnectionProtocol = "adb" | "hdc";

export function buildBridgeToolInstallUrl(origin: string, protocol: DebugConnectionProtocol | "all" = "all") {
  const url = new URL("wiseeff-bridge://install-tools");
  url.searchParams.set("server", origin);
  url.searchParams.set("protocol", protocol);
  return url.toString();
}

export function launchBridgeToolInstall(url: string) {
  window.location.href = url;
}

export function shouldConfirmBridgeToolInstall(storage: Pick<Storage, "getItem"> = window.localStorage) {
  return storage.getItem("wiseeff.bridgeToolInstallConfirm") !== "1";
}

export function rememberBridgeToolInstallConfirm(storage: Pick<Storage, "setItem"> = window.localStorage) {
  storage.setItem("wiseeff.bridgeToolInstallConfirm", "1");
}

function isProtocolToolReady(health: LocalBridgeHealthState, protocol: DebugConnectionProtocol | "all") {
  if (!health.tools) {
    return false;
  }
  if (protocol === "all") {
    return health.tools.adb.available && health.tools.hdc.available;
  }
  return health.tools[protocol].available;
}

export async function pollBridgeToolInstall(options: {
  fetchImpl?: typeof fetch;
  protocol: DebugConnectionProtocol | "all";
  intervalMs?: number;
  timeoutMs?: number;
  onProgress?: (health: LocalBridgeHealthState) => void;
  previousInstallUpdatedAt?: string;
}): Promise<LocalBridgeHealthState | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const intervalMs = options.intervalMs ?? 2000;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    let body: LocalBridgeHealthState | null = null;
    try {
      const response = await fetchImpl(resolveLocalBridgeHealthUrl(), { signal: AbortSignal.timeout(3000) });
      if (response.ok) {
        body = (await response.json()) as LocalBridgeHealthState;
      }
    } catch {
      // The local service may restart during installation; retry only transport failures.
    }
    if (body) {
      options.onProgress?.(body);
      if (body.toolsInstall?.status === "failed" && (!options.previousInstallUpdatedAt || body.toolsInstall.updatedAt !== options.previousInstallUpdatedAt)) {
        throw new Error(body.toolsInstall.error ?? "调试工具安装失败。");
      }
      if (isProtocolToolReady(body, options.protocol)) return body;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return null;
}
