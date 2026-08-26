import pg from "pg";
import type { TracingBoundary } from "../../observability/tracing";

export type QueryResult<Row> = {
  rows: Row[];
  rowCount: number | null;
};

export type Queryable = {
  query<Row>(text: string, values?: unknown[]): Promise<QueryResult<Row>>;
};

export type Database = Queryable & {
  transaction<T>(fn: (tx: Database) => Promise<T>): Promise<T>;
};

const rootDatabaseBrand = Symbol("wiseeff.root-database");

/** A pool-backed database root that can own work which must outlive caller transactions. */
export type RootDatabase = Database & {
  readonly [rootDatabaseBrand]: true;
  readonly close: () => Promise<void>;
};

const rootDatabases = new WeakSet<object>();

/** Runtime identity check for the server-owned pool root; wrappers and transactions are not roots. */
export function isRootDatabase(value: unknown): value is RootDatabase {
  return (
    typeof value === "object" &&
    value !== null &&
    rootDatabases.has(value) &&
    Reflect.get(value, rootDatabaseBrand) === true
  );
}

type DatabaseOptions = {
  tracing?: Pick<TracingBoundary, "withSpan">;
};

/**
 * Transaction handle bound to one already-open session/transaction.
 * Nested transaction() calls map to SAVEPOINT / RELEASE / ROLLBACK TO on the
 * same session, so inner failures roll back only the inner scope.
 */
function savepointHandle(session: Queryable, depth: number): Database {
  return {
    query: (text, values) => session.query(text, values),
    transaction: async (fn) => {
      const savepoint = `wiseeff_sp_${depth}`;
      await session.query(`savepoint ${savepoint}`);
      try {
        const result = await fn(savepointHandle(session, depth + 1));
        await session.query(`release savepoint ${savepoint}`);
        return result;
      } catch (error) {
        await session.query(`rollback to savepoint ${savepoint}`);
        await session.query(`release savepoint ${savepoint}`);
        throw error;
      }
    }
  };
}

/**
 * Wraps a session that is already inside an externally-owned transaction
 * (for example the test fixture's outer BEGIN). transaction() starts at
 * savepoint depth 1 and never issues BEGIN/COMMIT of its own.
 */
export function createSavepointDatabase(session: Queryable): Database {
  return savepointHandle(session, 1);
}

/**
 * Wraps a single-session Queryable (one pg.Client or equivalent).
 * Must not be given a connection pool: transaction() issues BEGIN/COMMIT on
 * the shared session, which is only correct when every query runs on the
 * same connection. Pooled access goes through createPostgresDatabase.
 */
export function createDatabase(queryable: Queryable, options: DatabaseOptions = {}): Database {
  const query = <Row,>(text: string, values: unknown[] = []) => traceQuery(options.tracing, text, values, () => queryable.query<Row>(text, values));
  const session: Queryable = { query };

  return {
    query,
    transaction: async (fn) => {
      await query("begin");
      try {
        const result = await fn(savepointHandle(session, 1));
        await query("commit");
        return result;
      } catch (error) {
        await query("rollback");
        throw error;
      }
    }
  };
}

async function traceQuery<Row>(
  tracing: Pick<TracingBoundary, "withSpan"> | undefined,
  text: string,
  values: unknown[],
  fn: () => Promise<QueryResult<Row>>
): Promise<QueryResult<Row>> {
  const attributes: Record<string, string | number | boolean> = {
    statementType: statementType(text),
    parameterCount: values.length
  };

  const execute = async () => {
    try {
      const result = await fn();
      attributes.status = "succeeded";
      if (result.rowCount !== null) {
        attributes.rowCount = result.rowCount;
      }
      return result;
    } catch (error) {
      attributes.status = "failed";
      attributes.errorType = error instanceof Error ? error.name : "unknown";
      throw error;
    }
  };

  return tracing ? tracing.withSpan("db.query", attributes, execute) : execute();
}

function statementType(text: string) {
  return text.trim().split(/\s+/, 1)[0]?.toLowerCase() || "unknown";
}

export function createPostgresDatabase(connectionString: string, options: DatabaseOptions = {}): RootDatabase {
  const pool = new pg.Pool({ connectionString });
  let closed = false;
  const query = <Row,>(text: string, values: unknown[] = []) =>
    traceQuery(options.tracing, text, values, async () => {
      const result = await pool.query(text, values);
      return { rows: result.rows as Row[], rowCount: result.rowCount };
    });

  const rootDatabase: RootDatabase = {
    [rootDatabaseBrand]: true,
    query,
    transaction: async (fn) => {
      const client = await pool.connect();
      const session: Queryable = {
        query: <Row,>(text: string, values: unknown[] = []) =>
          traceQuery(options.tracing, text, values, async () => {
            const result = await client.query(text, values);
            return { rows: result.rows as Row[], rowCount: result.rowCount };
          })
      };

      try {
        await session.query("begin");
        const result = await fn(savepointHandle(session, 1));
        await session.query("commit");
        return result;
      } catch (error) {
        await session.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },
    close: async () => {
      if (closed) return;
      closed = true;
      await pool.end();
    }
  };
  Object.freeze(rootDatabase);
  rootDatabases.add(rootDatabase);
  return rootDatabase;
}
