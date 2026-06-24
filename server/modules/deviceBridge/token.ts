import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";

import {
  DEVICE_BRIDGE_TOKEN_SCOPES,
  type DeviceBridgeTokenScope
} from "./types";

export const DEVICE_BRIDGE_PAIRING_TTL_MS = 30 * 60 * 1000;
export const DEVICE_BRIDGE_TOKEN_TTL_DAYS = 90;
export const DEVICE_BRIDGE_TOKEN_PREFIX = "wb_";
export const DEVICE_BRIDGE_ID_PREFIX = "br_";

export function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function generatePairingCode() {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function issueBridgeToken() {
  return `${DEVICE_BRIDGE_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function createBridgeId() {
  return `${DEVICE_BRIDGE_ID_PREFIX}${randomUUID()}`;
}

export function bridgeTokenExpiresAt(from: Date, ttlDays = DEVICE_BRIDGE_TOKEN_TTL_DAYS) {
  const expiresAt = new Date(from);
  expiresAt.setUTCDate(expiresAt.getUTCDate() + ttlDays);
  return expiresAt;
}

export function defaultBridgeTokenScopes(): DeviceBridgeTokenScope[] {
  return [...DEVICE_BRIDGE_TOKEN_SCOPES];
}
