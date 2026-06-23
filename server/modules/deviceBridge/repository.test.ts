import { describe, expect, it } from "vitest";
import type { QueryResult, Queryable } from "../../shared/database/client";
import {
  consumePairingCode,
  createBridge,
  createBridgeToken,
  createPairingCode
} from "./repository";
import { DEVICE_BRIDGE_CONNECT_SCOPE, DEVICE_BRIDGE_EXECUTE_SCOPE } from "./types";

type QueryCall = {
  text: string;
  values: unknown[];
};

function createFakeDb(results: unknown[][] = []) {
  const calls: QueryCall[] = [];
  const db: Queryable = {
    query: async <Row,>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> => {
      calls.push({ text, values });
      const rows = (results.shift() ?? []) as Row[];
      return { rows, rowCount: rows.length };
    }
  };

  return { calls, db };
}

function bridgeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "br-1",
    organization_id: "org-1",
    user_id: "u-1",
    machine_label: "WIN-PC",
    platform: "windows",
    arch: "amd64",
    client_version: null,
    capabilities: {},
    created_at: "2026-06-23T00:00:00.000Z",
    last_seen_at: null,
    revoked_at: null,
    ...overrides
  };
}

describe("device bridge repository", () => {
  it("inserts pairing codes with hashed values and expiry", async () => {
    const { db, calls } = createFakeDb([[]]);
    const expiresAt = new Date("2026-06-23T00:05:00.000Z");

    await createPairingCode(db, {
      id: "pair-1",
      organizationId: "org-1",
      userId: "u-1",
      codeHash: "hash-123",
      expiresAt
    });

    expect(calls[0].text).toContain("insert into device_bridge_pairing_codes");
    expect(calls[0].values).toEqual(["pair-1", "org-1", "u-1", "hash-123", expiresAt.toISOString()]);
  });

  it("consumes pairing codes once and returns the owning user", async () => {
    const consumedAt = new Date("2026-06-23T00:01:00.000Z");
    const { db, calls } = createFakeDb([[{ organization_id: "org-1", user_id: "u-1" }], []]);

    const first = await consumePairingCode(db, { codeHash: "hash-123", consumedAt });
    const second = await consumePairingCode(db, { codeHash: "hash-123", consumedAt });

    expect(first).toEqual({ organizationId: "org-1", userId: "u-1" });
    expect(second).toBeNull();
    expect(calls[0].text).toContain("update device_bridge_pairing_codes");
    expect(calls[0].values).toEqual(["hash-123", consumedAt.toISOString()]);
  });

  it("creates bridge records and scoped bridge tokens", async () => {
    const { db, calls } = createFakeDb([[bridgeRow()], []]);
    const expiresAt = new Date("2026-09-21T00:00:00.000Z");

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

    expect(bridge.id).toBe("br-1");
    expect(bridge.machineLabel).toBe("WIN-PC");
    expect(calls[0].text).toContain("insert into device_bridges");
    expect(calls[1].text).toContain("insert into device_bridge_tokens");
    expect(calls[1].values).toEqual([
      "tok-1",
      "br-1",
      "hash-token",
      [DEVICE_BRIDGE_CONNECT_SCOPE, DEVICE_BRIDGE_EXECUTE_SCOPE],
      expiresAt.toISOString()
    ]);
  });
});
