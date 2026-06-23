import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  bridgeTokenExpiresAt,
  defaultBridgeTokenScopes,
  DEVICE_BRIDGE_TOKEN_PREFIX,
  generatePairingCode,
  issueBridgeToken,
  sha256Hex
} from "./token";
import { DEVICE_BRIDGE_CONNECT_SCOPE, DEVICE_BRIDGE_EXECUTE_SCOPE } from "./types";

describe("device bridge token helpers", () => {
  it("hashes pairing codes and bridge tokens with sha-256 hex", () => {
    const digest = sha256Hex("123456");
    expect(digest).toBe(createHash("sha256").update("123456").digest("hex"));
    expect(digest).toHaveLength(64);
  });

  it("issues bridge tokens with wb_ prefix", () => {
    const token = issueBridgeToken();
    expect(token.startsWith(DEVICE_BRIDGE_TOKEN_PREFIX)).toBe(true);
    expect(token.length).toBeGreaterThan(DEVICE_BRIDGE_TOKEN_PREFIX.length);
  });

  it("generates 6-digit pairing codes", () => {
    expect(generatePairingCode()).toMatch(/^\d{6}$/);
  });

  it("includes connect and execute scopes by default", () => {
    expect(defaultBridgeTokenScopes()).toEqual([
      DEVICE_BRIDGE_CONNECT_SCOPE,
      DEVICE_BRIDGE_EXECUTE_SCOPE
    ]);
  });

  it("computes bridge token expiry from ttl days", () => {
    const from = new Date("2026-06-23T00:00:00.000Z");
    const expiresAt = bridgeTokenExpiresAt(from, 90);
    expect(expiresAt.toISOString()).toBe("2026-09-21T00:00:00.000Z");
  });
});
