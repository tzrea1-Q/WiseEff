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

  const opened: IndependentCatalogSession[] = [];
  try {
    const results = await Promise.allSettled(
      Array.from({ length: count }, () => openDedicatedSession(connectionString)),
    );
    for (const result of results) {
      if (result.status === "fulfilled") {
        opened.push(result.value);
      }
    }
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failure) {
      throw failure.reason;
    }

    const pids = new Set(opened.map((session) => session.backendPid));
    if (pids.size !== opened.length) {
      throw new Error(
        "Independent catalog sessions shared a backend PID; shared-session fixtures are not catalog evidence",
      );
    }
    return opened;
  } catch (error) {
    await Promise.all(opened.map((session) => session.close().catch(() => undefined)));
    throw error;
  }
}

async function openDedicatedSession(
  connectionString: string,
): Promise<IndependentCatalogSession> {
  const pool = new pg.Pool({
    connectionString,
    max: 1,
    allowExitOnIdle: false,
  });
  let client: pg.PoolClient | undefined;
  try {
    client = await pool.connect();
    const pid = await client.query<{ pid: number }>("select pg_backend_pid() as pid");
    const backendPid = pid.rows[0]?.pid;
    if (!backendPid) {
      throw new Error("Failed to read pg_backend_pid for an independent catalog session");
    }

    const connected = client;
    let inTransaction = false;
    let closed = false;
    const session: IndependentCatalogSession = {
      backendPid,
      query: <Row extends QueryResultRow>(text: string, values: unknown[] = []) =>
        connected.query<Row>(text, values),
      begin: async () => {
        if (inTransaction) {
          throw new Error("Catalog session is already inside a transaction");
        }
        await connected.query("begin");
        inTransaction = true;
      },
      commit: async () => {
        await connected.query("commit");
        inTransaction = false;
      },
      rollback: async () => {
        await connected.query("rollback");
        inTransaction = false;
      },
      close: async () => {
        if (closed) {
          return;
        }
        closed = true;
        if (inTransaction) {
          await connected.query("rollback").catch(() => undefined);
          inTransaction = false;
        }
        connected.release();
        await pool.end();
      },
    };
    return session;
  } catch (error) {
    client?.release();
    await pool.end().catch(() => undefined);
    throw error;
  }
}
