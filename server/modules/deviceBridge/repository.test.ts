/**
 * Behavior-level integration coverage for the device bridge repository:
 * pairing-code lifecycle, bridge and token creation, and revoked-bridge
 * filtering against a real database. Asserts returned DTOs and subsequent
 * reads — never SQL text.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import {
  consumePairingCode,
  createBridge,
  createBridgeToken,
  createPairingCode,
  listBridgesForUser
} from "./repository";
import { DEVICE_BRIDGE_CONNECT_SCOPE, DEVICE_BRIDGE_EXECUTE_SCOPE } from "./types";

const databaseAvailable = await isTestDatabaseAvailable();

describe.skipIf(!databaseAvailable)("device bridge repository", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedCoreGraph(db, {
      organization: { id: "org-1", name: "ChargeLab" },
      users: [
        { id: "u-1", name: "Riley Chen", email: "riley@example.com" },
        { id: "u-2", name: "Other User", email: "other@example.com" }
      ]
    });
  });

  afterEach(async () => {
    await db?.rollback();
  });

  it("inserts pairing codes with hashed values and expiry", async () => {
    const expiresAt = new Date("2126-06-23T00:05:00.000Z");

    await createPairingCode(db, {
      id: "pair-1",
      organizationId: "org-1",
      userId: "u-1",
      codeHash: "hash-123",
      expiresAt
    });

    const stored = await db.query<{ code_hash: string; user_id: string; expires_at: Date }>(
      `select code_hash, user_id, expires_at from device_bridge_pairing_codes where id = 'pair-1'`
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]).toMatchObject({ code_hash: "hash-123", user_id: "u-1" });
    expect(new Date(stored.rows[0].expires_at).toISOString()).toBe(expiresAt.toISOString());
  });

  it("consumes pairing codes once and returns the owning user", async () => {
    await createPairingCode(db, {
      id: "pair-1",
      organizationId: "org-1",
      userId: "u-1",
      codeHash: "hash-123",
      expiresAt: new Date(Date.now() + 5 * 60_000)
    });
    const consumedAt = new Date();

    const first = await consumePairingCode(db, { codeHash: "hash-123", consumedAt });
    const second = await consumePairingCode(db, { codeHash: "hash-123", consumedAt });

    expect(first).toEqual({ organizationId: "org-1", userId: "u-1" });
    // The one-shot consume never hands the same code out twice.
    expect(second).toBeNull();
    // An unknown hash consumes nothing.
    await expect(consumePairingCode(db, { codeHash: "hash-unknown", consumedAt })).resolves.toBeNull();
  });

  it("creates bridge records and scoped bridge tokens", async () => {
    const expiresAt = new Date("2126-09-21T00:00:00.000Z");

    const bridge = await createBridge(db, {
      id: "br-1",
      organizationId: "org-1",
      userId: "u-1",
      machineLabel: "WIN-PC",
      platform: "windows",
      arch: "amd64"
    });

    await createBridgeToken(db, {
      id: "tok-1",
      bridgeId: "br-1",
      tokenHash: "hash-token",
      scopes: [DEVICE_BRIDGE_CONNECT_SCOPE, DEVICE_BRIDGE_EXECUTE_SCOPE],
      expiresAt
    });

    expect(bridge).toMatchObject({
      id: "br-1",
      organizationId: "org-1",
      userId: "u-1",
      machineLabel: "WIN-PC",
      platform: "windows",
      arch: "amd64",
      revokedAt: null
    });
    const storedToken = await db.query<{ bridge_id: string; token_hash: string; scopes: string[] }>(
      `select bridge_id, token_hash, scopes from device_bridge_tokens where id = 'tok-1'`
    );
    expect(storedToken.rows).toEqual([
      {
        bridge_id: "br-1",
        token_hash: "hash-token",
        scopes: [DEVICE_BRIDGE_CONNECT_SCOPE, DEVICE_BRIDGE_EXECUTE_SCOPE]
      }
    ]);
  });

  it("omits revoked bridges from the default user listing", async () => {
    await createBridge(db, {
      id: "br-live",
      organizationId: "org-1",
      userId: "u-1",
      machineLabel: "WIN-PC",
      platform: "windows",
      arch: "amd64"
    });
    await createBridge(db, {
      id: "br-revoked",
      organizationId: "org-1",
      userId: "u-1",
      machineLabel: "Old laptop",
      platform: "darwin",
      arch: "arm64"
    });
    await db.query(`update device_bridges set revoked_at = now() where id = 'br-revoked'`);
    // Another user's bridge stays out of the listing.
    await createBridge(db, {
      id: "br-other-user",
      organizationId: "org-1",
      userId: "u-2",
      machineLabel: "Not mine",
      platform: "linux",
      arch: "amd64"
    });

    const bridges = await listBridgesForUser(db, { userId: "u-1", organizationId: "org-1" });

    expect(bridges.map((bridge) => bridge.id)).toEqual(["br-live"]);
  });
});
