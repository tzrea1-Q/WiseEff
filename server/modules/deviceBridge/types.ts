export const DEVICE_BRIDGE_CONNECT_SCOPE = "device-bridge:connect";
export const DEVICE_BRIDGE_EXECUTE_SCOPE = "device-bridge:execute";

export const DEVICE_BRIDGE_TOKEN_SCOPES = [
  DEVICE_BRIDGE_CONNECT_SCOPE,
  DEVICE_BRIDGE_EXECUTE_SCOPE
] as const;

export type DeviceBridgeTokenScope = (typeof DEVICE_BRIDGE_TOKEN_SCOPES)[number];

export type DeviceBridgePlatform = "windows" | "darwin" | "linux";

export type DeviceBridgeRecord = {
  id: string;
  organizationId: string;
  userId: string;
  machineLabel: string;
  platform: DeviceBridgePlatform;
  arch: string;
  clientVersion: string | null;
  capabilities: Record<string, unknown>;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
};

export type DeviceBridgeTokenRecord = {
  id: string;
  bridgeId: string;
  tokenHash: string;
  scopes: DeviceBridgeTokenScope[];
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
};

export type DeviceBridgePairingCodeRecord = {
  id: string;
  organizationId: string;
  userId: string;
  codeHash: string;
  expiresAt: string;
  consumedAt: string | null;
  createdAt: string;
};

export type ConsumedPairingCode = {
  userId: string;
  organizationId: string;
};
