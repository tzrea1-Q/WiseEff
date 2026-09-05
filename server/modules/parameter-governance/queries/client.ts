import pg from "pg";

import type { GovernanceQueryAuthScope, GovernanceQueryable, GovernanceQueryFailure, Result } from "./types";

export const isUsableToken = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.trim() === value &&
  !/[\u0000-\u001F\u007F-\u009F]/u.test(value);

export const fail = (error: GovernanceQueryFailure): Result<never, GovernanceQueryFailure> => ({
  ok: false,
  error,
});

export const asQueryable = (
  client: pg.Pool | pg.PoolClient | GovernanceQueryable,
): GovernanceQueryable => ({
  query: (text, values) =>
    (client as GovernanceQueryable).query(text, values as unknown[] | undefined),
});

const isPool = (source: pg.Pool | pg.PoolClient | GovernanceQueryable): source is pg.Pool =>
  typeof (source as pg.Pool).connect === "function" &&
  typeof (source as pg.Pool).end === "function" &&
  typeof (source as pg.PoolClient).release !== "function";

export const withReadTransaction = async <T>(
  source: pg.Pool | pg.PoolClient | GovernanceQueryable,
  work: (client: GovernanceQueryable) => Promise<T>,
): Promise<T> => {
  if (!isPool(source)) {
    return work(asQueryable(source));
  }
  const client = await source.connect();
  try {
    await client.query("begin read only");
    const result = await work(asQueryable(client));
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
};

export const assertOrgScope = (
  organizationId: string,
  authScope: GovernanceQueryAuthScope,
): Result<true, GovernanceQueryFailure> => {
  if (!isUsableToken(organizationId)) {
    return fail({ kind: "invalid-query", reason: "organizationId" });
  }
  if (!isUsableToken(authScope.organizationId) || !isUsableToken(authScope.principalId)) {
    return fail({ kind: "invalid-query", reason: "authScope" });
  }
  if (organizationId !== authScope.organizationId) {
    return fail({ kind: "not-found", resource: "organization" });
  }
  return { ok: true, value: true };
};

const connectionCodes = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "57P01", "08006", "08001"]);

export const mapQueryError = (error: unknown, operation: string): GovernanceQueryFailure => {
  const code =
    error instanceof pg.DatabaseError
      ? error.code ?? ""
      : error !== null && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code ?? "")
        : "";
  if (code === "57014" || code === "55P03") {
    return { kind: "timeout", operation };
  }
  if (connectionCodes.has(code)) {
    return { kind: "dependency-failure", operation };
  }
  return { kind: "query-unavailable", operation };
};

export const runQuery = async <T>(
  source: pg.Pool | pg.PoolClient | GovernanceQueryable,
  operation: string,
  work: (client: GovernanceQueryable) => Promise<Result<T, GovernanceQueryFailure>>,
): Promise<Result<T, GovernanceQueryFailure>> => {
  try {
    return await withReadTransaction(source, work);
  } catch (error) {
    return fail(mapQueryError(error, operation));
  }
};
