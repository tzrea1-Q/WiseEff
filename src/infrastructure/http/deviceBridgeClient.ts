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
  artifactKind?: "portable" | "installer";
};

export type DeviceBridgeReleaseManifest = {
  recommendedVersion: string;
  minCompatibleVersion: string;
  items: DeviceBridgeReleaseItem[];
};

export type ToolProbeState = {
  available: boolean;
  source?: "managed" | "system";
  version?: string;
  reason?: string;
};

export type ToolsInstallStatus = {
  status: "idle" | "running" | "succeeded" | "failed";
  protocol?: "adb" | "hdc" | "all";
  error?: string;
  updatedAt: string;
};

export type LocalBridgeHealthState = {
  ok: true;
  paired: boolean;
  connected: boolean;
  bridgeId?: string;
  serverUrl?: string;
  lastError?: string;
  updatedAt: string;
  tools?: {
    adb: ToolProbeState;
    hdc: ToolProbeState;
  };
  toolsInstall?: ToolsInstallStatus;
};

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

function parseTools(value: unknown): LocalBridgeHealthState["tools"] {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const adb = parseToolProbeState(record.adb);
  const hdc = parseToolProbeState(record.hdc);
  if (!adb || !hdc) {
    return undefined;
  }
  return { adb, hdc };
}

function parseToolsInstall(value: unknown): ToolsInstallStatus | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    record.status !== "idle" &&
    record.status !== "running" &&
    record.status !== "succeeded" &&
    record.status !== "failed"
  ) {
    return undefined;
  }
  if (typeof record.updatedAt !== "string") {
    return undefined;
  }
  return {
    status: record.status,
    protocol:
      record.protocol === "adb" || record.protocol === "hdc" || record.protocol === "all"
        ? record.protocol
        : undefined,
    error: typeof record.error === "string" ? record.error : undefined,
    updatedAt: record.updatedAt
  };
}

function parseLocalBridgeHealthBody(body: Record<string, unknown>): LocalBridgeHealthState | null {
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
    updatedAt: body.updatedAt,
    tools: parseTools(body.tools),
    toolsInstall: parseToolsInstall(body.toolsInstall)
  };
}

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
    if (!isRecord(body)) {
      return null;
    }
    return parseLocalBridgeHealthBody(body);
  } catch {
    return null;
  }
}
