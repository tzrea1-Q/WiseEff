import { createApiClient } from "./apiClient";
import { createDefaultApiClient } from "./defaultApiClient";

type ApiClient = ReturnType<typeof createApiClient>;

type ItemsEnvelope<T> = { items: T[] };

export type DeviceBridgePairingCode = {
  code: string;
  expiresAt: string;
};

export type DeviceBridgeRecord = {
  id: string;
  machineLabel: string;
  platform: "windows" | "darwin" | "linux";
  arch: string;
  clientVersion: string | null;
  capabilities: Record<string, unknown>;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
};

export type DeviceBridgePlatform = "windows" | "darwin" | "linux";

export type DeviceBridgeReleaseItem = {
  platform: DeviceBridgePlatform;
  arch: string;
  version: string;
  sha256?: string;
  downloadUrl: string;
};

export type DeviceBridgeReleaseManifest = {
  recommendedVersion: string;
  minCompatibleVersion: string;
  items: DeviceBridgeReleaseItem[];
};

export type LocalBridgeHealthState = {
  ok: true;
  paired: boolean;
  connected: boolean;
  bridgeId?: string;
  serverUrl?: string;
  lastError?: string;
  updatedAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function createPairingCode(apiClient: ApiClient = createDefaultApiClient()) {
  return apiClient.post<DeviceBridgePairingCode>("/api/v1/device-bridges/pairing-codes", {});
}

export async function listMyBridges(apiClient: ApiClient = createDefaultApiClient()) {
  const response = await apiClient.get<ItemsEnvelope<DeviceBridgeRecord>>("/api/v1/device-bridges/mine");
  return response.items;
}

export async function renameBridge(
  bridgeId: string,
  machineLabel: string,
  apiClient: ApiClient = createDefaultApiClient()
) {
  const response = await apiClient.patch<{ item: DeviceBridgeRecord }>(
    `/api/v1/device-bridges/${encodeURIComponent(bridgeId)}`,
    { machineLabel }
  );
  return response.item;
}

export async function revokeBridge(
  bridgeId: string,
  apiClient: ApiClient = createDefaultApiClient()
) {
  const response = await apiClient.post<{ item: DeviceBridgeRecord }>(
    `/api/v1/device-bridges/${encodeURIComponent(bridgeId)}/revoke`,
    {}
  );
  return response.item;
}

export async function listReleases(apiClient: ApiClient = createDefaultApiClient()) {
  return apiClient.get<DeviceBridgeReleaseManifest>("/api/v1/device-bridges/releases");
}

export async function probeLocalBridgeHealth(fetchImpl: typeof fetch = fetch): Promise<LocalBridgeHealthState | null> {
  try {
    const response = await fetchImpl("http://127.0.0.1:18787/health");
    if (!response.ok) {
      return null;
    }
    const body = await response.json();
    if (!isRecord(body) || body.ok !== true || typeof body.updatedAt !== "string") {
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
