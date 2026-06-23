import { randomUUID } from "node:crypto";

import type { Queryable } from "../../shared/database/client";
import type {
  ConsumedPairingCode,
  DeviceBridgePlatform,
  DeviceBridgeRecord,
  DeviceBridgeTokenScope
} from "./types";

type DeviceBridgeRow = {
  id: string;
  organization_id: string;
  user_id: string;
  machine_label: string;
  platform: DeviceBridgePlatform;
  arch: string;
  client_version: string | null;
  capabilities: Record<string, unknown> | string;
  created_at: string | Date;
  last_seen_at: string | Date | null;
  revoked_at: string | Date | null;
};

function dateTimeToIso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value;
}

function nullableDateTimeToIso(value: string | Date | null) {
  if (!value) return null;
  return dateTimeToIso(value);
}

function parseJsonObject(value: Record<string, unknown> | string) {
  if (typeof value === "string") {
    return JSON.parse(value) as Record<string, unknown>;
  }
  return value;
}

function toDeviceBridgeRecord(row: DeviceBridgeRow): DeviceBridgeRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    machineLabel: row.machine_label,
    platform: row.platform,
    arch: row.arch,
    clientVersion: row.client_version,
    capabilities: parseJsonObject(row.capabilities),
    createdAt: dateTimeToIso(row.created_at),
    lastSeenAt: nullableDateTimeToIso(row.last_seen_at),
    revokedAt: nullableDateTimeToIso(row.revoked_at)
  };
}

export async function createPairingCode(
  db: Queryable,
  input: {
    id: string;
    organizationId: string;
    userId: string;
    codeHash: string;
    expiresAt: Date;
  }
) {
  await db.query(
    `
    insert into device_bridge_pairing_codes (
      id, organization_id, user_id, code_hash, expires_at
    )
    values ($1, $2, $3, $4, $5)
    `,
    [input.id, input.organizationId, input.userId, input.codeHash, input.expiresAt.toISOString()]
  );
}

export async function consumePairingCode(
  db: Queryable,
  input: { codeHash: string; consumedAt: Date }
): Promise<ConsumedPairingCode | null> {
  const result = await db.query<{ organization_id: string; user_id: string }>(
    `
    update device_bridge_pairing_codes
    set consumed_at = $2
    where code_hash = $1
      and consumed_at is null
      and expires_at > $2
    returning organization_id, user_id
    `,
    [input.codeHash, input.consumedAt.toISOString()]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    organizationId: row.organization_id,
    userId: row.user_id
  };
}

export async function createBridge(
  db: Queryable,
  input: {
    id: string;
    organizationId: string;
    userId: string;
    machineLabel: string;
    platform: DeviceBridgePlatform;
    arch: string;
    clientVersion?: string | null;
    capabilities?: Record<string, unknown>;
  }
): Promise<DeviceBridgeRecord> {
  const result = await db.query<DeviceBridgeRow>(
    `
    insert into device_bridges (
      id, organization_id, user_id, machine_label, platform, arch, client_version, capabilities
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
    returning
      id,
      organization_id,
      user_id,
      machine_label,
      platform,
      arch,
      client_version,
      capabilities,
      created_at,
      last_seen_at,
      revoked_at
    `,
    [
      input.id,
      input.organizationId,
      input.userId,
      input.machineLabel,
      input.platform,
      input.arch,
      input.clientVersion ?? null,
      JSON.stringify(input.capabilities ?? {})
    ]
  );

  return toDeviceBridgeRecord(result.rows[0]);
}

export async function createBridgeToken(
  db: Queryable,
  input: {
    id: string;
    bridgeId: string;
    tokenHash: string;
    scopes: DeviceBridgeTokenScope[];
    expiresAt: Date;
  }
) {
  await db.query(
    `
    insert into device_bridge_tokens (
      id, bridge_id, token_hash, scopes, expires_at
    )
    values ($1, $2, $3, $4, $5)
    `,
    [input.id, input.bridgeId, input.tokenHash, input.scopes, input.expiresAt.toISOString()]
  );

  return { id: input.id };
}

export async function validateBridgeToken(
  db: Queryable,
  input: { tokenHash: string; now: Date }
): Promise<{ bridgeId: string; scopes: DeviceBridgeTokenScope[] } | null> {
  const result = await db.query<{ bridge_id: string; scopes: DeviceBridgeTokenScope[] }>(
    `
    update device_bridge_tokens as tokens
    set last_used_at = $2
    from device_bridges as bridges
    where tokens.bridge_id = bridges.id
      and tokens.token_hash = $1
      and tokens.revoked_at is null
      and tokens.expires_at > $2
      and bridges.revoked_at is null
    returning tokens.bridge_id, tokens.scopes
    `,
    [input.tokenHash, input.now.toISOString()]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    bridgeId: row.bridge_id,
    scopes: row.scopes
  };
}

export async function touchBridgeLastSeen(
  db: Queryable,
  input: { bridgeId: string; seenAt: Date }
) {
  await db.query(
    `
    update device_bridges
    set last_seen_at = $2
    where id = $1
    `,
    [input.bridgeId, input.seenAt.toISOString()]
  );
}

export function createDeviceBridgeRepository(db: Queryable) {
  return {
    createPairingCode: (input: Parameters<typeof createPairingCode>[1]) => createPairingCode(db, input),
    consumePairingCode: (input: Parameters<typeof consumePairingCode>[1]) => consumePairingCode(db, input),
    createBridge: (input: Parameters<typeof createBridge>[1]) => createBridge(db, input),
    createBridgeToken: (input: Parameters<typeof createBridgeToken>[1]) => createBridgeToken(db, input),
    validateBridgeToken: (input: Parameters<typeof validateBridgeToken>[1]) => validateBridgeToken(db, input),
    touchBridgeLastSeen: (input: Parameters<typeof touchBridgeLastSeen>[1]) => touchBridgeLastSeen(db, input)
  };
}

export type DeviceBridgeRepository = ReturnType<typeof createDeviceBridgeRepository>;

export { randomUUID };
