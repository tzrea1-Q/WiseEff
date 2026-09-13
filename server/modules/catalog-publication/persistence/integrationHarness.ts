import { createHash } from "node:crypto";
import pg from "pg";
import { expect } from "vitest";

import { quoteIdent } from "../../catalog-kernel/security/catalogRoleManifest";
import type { Queryable } from "../../../shared/database/client";
import {
  createEphemeralTestDatabase,
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
} from "../../../testing/testDatabase";

export async function requirePgvectorTestDatabase(): Promise<void> {
  const databaseAvailable = await isTestDatabaseAvailable();
  if (!databaseAvailable) {
    throw new Error(
      "CP-02 publication persistence tests require a reachable real PostgreSQL server with pgvector; skipping is forbidden",
    );
  }

  const probe = await createInMemoryTestDatabase();
  try {
    const result = await probe.query<{ installed: boolean }>(
      `select exists (
         select 1
         from pg_catalog.pg_extension
         where extname = 'vector'
       ) as installed`,
    );
    if (result.rows[0]?.installed !== true) {
      throw new Error(
        "CP-02 publication persistence tests require pgvector installed in the real PostgreSQL test database; skipping is forbidden",
      );
    }
  } finally {
    await probe.rollback();
  }
}

export async function captureDatabaseError(action: Promise<unknown>): Promise<pg.DatabaseError> {
  try {
    await action;
  } catch (error) {
    expect(error).toBeInstanceOf(pg.DatabaseError);
    return error as pg.DatabaseError;
  }
  throw new Error("Expected PostgreSQL to reject the operation");
}

export async function captureSavepointError(
  client: pg.Client,
  action: () => Promise<unknown>,
): Promise<pg.DatabaseError> {
  const savepoint = `cp02_sp_${Math.floor(Math.random() * 1_000_000_000).toString(36)}`;
  await client.query(`savepoint ${savepoint}`);
  try {
    const error = await captureDatabaseError(action());
    await client.query(`rollback to savepoint ${savepoint}`);
    await client.query(`release savepoint ${savepoint}`);
    return error;
  } catch (error) {
    await client.query(`rollback to savepoint ${savepoint}`).catch(() => undefined);
    await client.query(`release savepoint ${savepoint}`).catch(() => undefined);
    throw error;
  }
}

export async function captureRoleStatementError(
  client: pg.Client,
  role: string,
  sql: string,
  values: unknown[] = [],
): Promise<pg.DatabaseError> {
  await client.query("begin");
  try {
    await client.query(`set local role ${quoteIdent(role)}`);
    return await captureDatabaseError(client.query(sql, values));
  } finally {
    await client.query("rollback").catch(() => undefined);
    await client.query("reset role").catch(() => undefined);
  }
}

export async function withLocalRole<T>(
  client: pg.Client,
  role: string,
  fn: () => Promise<T>,
): Promise<T> {
  await client.query("begin");
  try {
    await client.query(`set local role ${quoteIdent(role)}`);
    return await fn();
  } finally {
    await client.query("rollback").catch(() => undefined);
    await client.query("reset role").catch(() => undefined);
  }
}

export async function withCommittedRole<T>(
  client: pg.Client,
  role: string,
  fn: () => Promise<T>,
): Promise<T> {
  await client.query("begin");
  await client.query(`set local role ${quoteIdent(role)}`);
  try {
    const result = await fn();
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.query("reset role").catch(() => undefined);
  }
}

export function asQueryable(client: pg.Client): Queryable {
  return {
    query: async (text, values = []) => {
      const result = await client.query(text, values);
      return { rows: result.rows, rowCount: result.rowCount };
    },
  };
}

function uniqueRoleName(label: string): string {
  const rand = Math.floor(Math.random() * 1_000_000_000).toString(36);
  return `pcat_cp02_${label}_${process.pid}_${rand}`.replace(/[^a-z0-9_]/g, "").slice(0, 63);
}

export async function withProductionLogin(
  admin: pg.Client,
  parentUrl: string,
  label: string,
  fn: (login: pg.Client, roleName: string) => Promise<void>,
  grantRole?: string,
): Promise<void> {
  const roleName = uniqueRoleName(label);
  const password = `cp02_${roleName}`;
  const databaseName = decodeURIComponent(new URL(parentUrl).pathname.replace(/^\//, ""));
  await admin.query(`
    create role ${quoteIdent(roleName)}
    login password '${password}'
    nosuperuser noinherit nocreaterole nocreatedb noreplication
  `);
  await admin.query(
    `grant connect on database ${quoteIdent(databaseName)} to ${quoteIdent(roleName)}`,
  );
  if (grantRole) {
    await admin.query(`grant ${quoteIdent(grantRole)} to ${quoteIdent(roleName)}`);
  }
  const url = new URL(parentUrl);
  url.username = roleName;
  url.password = password;
  const login = new pg.Client({ connectionString: url.toString() });
  try {
    await login.connect();
    await fn(login, roleName);
  } finally {
    await login.end().catch(() => undefined);
    if (grantRole) {
      await admin
        .query(`revoke ${quoteIdent(grantRole)} from ${quoteIdent(roleName)}`)
        .catch(() => undefined);
    }
    await admin
      .query(`revoke connect on database ${quoteIdent(databaseName)} from ${quoteIdent(roleName)}`)
      .catch(() => undefined);
    await admin.query(`drop role if exists ${quoteIdent(roleName)}`);
  }
}

export function sha256Digest(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function adoptionEvidence(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    source_bundle_digest: sha256Digest("bundle"),
    verification_digest: sha256Digest("verify-adopt"),
    data_mode: "populated",
    collected_at: "2026-09-12T00:00:00.000Z",
    approved_by: "operator",
    ...overrides,
  };
}

export function bootstrapEvidence(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    bootstrap_command: "explicit-bootstrap",
    approved_by: "operator",
    recorded_at: "2026-09-12T00:00:00.000Z",
    ...overrides,
  };
}

export function uniqueToken(label: string): string {
  const rand = Math.floor(Math.random() * 1_000_000_000).toString(36);
  return `${label}_${process.pid}_${rand}`.replace(/[^A-Za-z0-9_]/g, "").slice(0, 40);
}

export async function openEphemeralClient(label: string): Promise<{
  url: string;
  client: pg.Client;
  drop: () => Promise<void>;
}> {
  const database = await createEphemeralTestDatabase(label);
  const client = new pg.Client({ connectionString: database.url });
  await client.connect();
  return {
    url: database.url,
    client,
    drop: async () => {
      await client.end().catch(() => undefined);
      await database.drop();
    },
  };
}
