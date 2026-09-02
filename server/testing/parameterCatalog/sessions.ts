import pg from "pg";
import type { QueryResult, QueryResultRow } from "pg";

import { assertRealPostgresUrl } from "./database";

export type IndependentCatalogSession = {
  readonly backendPid: number;
  query<Row extends QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
  begin(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  close(): Promise<void>;
};

/**
 * Open dedicated max-1 pools. Two catalog clients must not share one
 * connection or transaction; a shared-session fixture is not catalog evidence.
 */
export async function openIndependentCatalogSessions(
  connectionString: string,
  count = 2,
): Promise<IndependentCatalogSession[]> {
  assertRealPostgresUrl(connectionString);
  if (count < 2) {
    throw new Error("Independent catalog sessions require at least two dedicated pools");
  }

  const sessions = await Promise.all(
    Array.from({ length: count }, () => openDedicatedSession(connectionString)),
  );
  const pids = new Set(sessions.map((session) => session.backendPid));
  if (pids.size !== sessions.length) {
    await Promise.all(sessions.map((session) => session.close()));
    throw new Error(
      "Independent catalog sessions shared a backend PID; shared-session fixtures are not catalog evidence",
    );
  }
  return sessions;
}

async function openDedicatedSession(
  connectionString: string,
): Promise<IndependentCatalogSession> {
  const pool = new pg.Pool({
    connectionString,
    max: 1,
    allowExitOnIdle: false,
  });
  const client = await pool.connect();
  try {
    const pid = await client.query<{ pid: number }>("select pg_backend_pid() as pid");
    const backendPid = pid.rows[0]?.pid;
    if (!backendPid) {
      throw new Error("Failed to read pg_backend_pid for an independent catalog session");
    }

    let inTransaction = false;
    const session: IndependentCatalogSession = {
      backendPid,
      query: <Row extends QueryResultRow>(text: string, values: unknown[] = []) =>
        client.query<Row>(text, values),
      begin: async () => {
        if (inTransaction) {
          throw new Error("Catalog session is already inside a transaction");
        }
        await client.query("begin");
        inTransaction = true;
      },
      commit: async () => {
        await client.query("commit");
        inTransaction = false;
      },
      rollback: async () => {
        await client.query("rollback");
        inTransaction = false;
      },
      close: async () => {
        if (inTransaction) {
          await client.query("rollback").catch(() => undefined);
          inTransaction = false;
        }
        client.release();
        await pool.end();
      },
    };
    return session;
  } catch (error) {
    client.release();
    await pool.end().catch(() => undefined);
    throw error;
  }
}
