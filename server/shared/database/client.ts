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
const rootPools = new WeakMap<object, pg.Pool>();

/** Runtime identity check for the server-owned pool root; wrappers and transactions are not roots. */
export function getRootPostgresPool(value: Database | undefined): pg.Pool | undefined {
  if (!value || !isRootDatabase(value)) {
    return undefined;
  }
  return rootPools.get(value);
}

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

type PostgresDatabaseOptions = DatabaseOptions & {
  /** Server-owned observation of this actual lease, before caller SQL/BEGIN.
   * Must finish its observation and release any probe locks. It owns no caller
   * transaction and grants no startup/release permission by itself. */
  verifyCheckout?: (session: Queryable) => Promise<void>;
};
type CheckoutCallback = (error: Error | undefined, client: pg.PoolClient | undefined, release: pg.PoolClient["release"]) => void;

/** Kernel deliberately obtains the real pool and owns its own transactions.
 * Verify at the pool checkout seam, including pg's callback-based query path,
 * rather than only wrapping RootDatabase.transaction(). */
class VerifiedCheckoutPool extends pg.Pool {
  constructor(connectionString: string, private readonly verify: (session: Queryable) => Promise<void>) {
    super({ connectionString });
  }

  override connect(): Promise<pg.PoolClient>;
  override connect(callback: CheckoutCallback): void;
  override connect(callback?: CheckoutCallback): Promise<pg.PoolClient> | void {
    let resolve!: (client: pg.PoolClient) => void;
    let reject!: (error: Error) => void;
    const result = callback ? undefined : new Promise<pg.PoolClient>((res, rej) => { resolve = res; reject = rej; });
    const fail = (error: unknown) => {
      // pg callbacks distinguish failure by truthiness. Never pass a falsy throw.
      const refusal = error instanceof Error ? error : new Error("PCAT-DATABASE-CHECKOUT-VERIFICATION-FAILED");
      if (callback) callback(refusal, undefined, () => undefined);
      else reject(refusal);
    };
    // Install synchronously inside pg's actual acquisition callback, before the
    // driver can emit another event. A Promise.then here leaves a listener gap.
    super.connect((acquisitionError, client) => {
      if (acquisitionError) { fail(acquisitionError); return; }
      if (!client) { fail(new Error("PCAT-DATABASE-CHECKOUT-VERIFICATION-FAILED")); return; }
      // pg-pool removed its idle error listener when it leased this client.
      // The caller cannot install its listener until observation finishes.
      let connectionFailure: Error | undefined;
      let rejectConnection!: (error: Error) => void;
      const disconnected = new Promise<never>((_, reject) => { rejectConnection = reject; });
      const onError = () => {
        connectionFailure ??= new Error("PCAT-DATABASE-CHECKOUT-CONNECTION-FAILED");
        rejectConnection(connectionFailure);
      };
      client.on("error", onError);
      const verification = Promise.race([disconnected, Promise.resolve().then(() => this.verify({ query: async <Row,>(text: string, values?: unknown[]) => {
          if (connectionFailure) throw connectionFailure;
          const result = await client.query(text, values);
          return { rows: result.rows as Row[], rowCount: result.rowCount };
        } }))]);
      const refuseLease = (error: unknown) => {
        // Keep the listener through destruction, preserving the first refusal.
        client.once("end", () => client.removeListener("error", onError));
        try { client.release(true); } catch { /* preserve original refusal */ }
        fail(error);
      };
      void verification.then(() => {
        if (connectionFailure) { refuseLease(connectionFailure); return; }
        if (callback) {
          try { callback(undefined, client, client.release); }
          finally { client.removeListener("error", onError); }
        } else {
          resolve(client);
          // The already waiting promise caller resumes before listener removal.
          queueMicrotask(() => client.removeListener("error", onError));
        }
      }, refuseLease);
    });
    return result;
  }
}

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

export function createPostgresDatabase(connectionString: string, options: PostgresDatabaseOptions = {}): RootDatabase {
  const pool = options.verifyCheckout
    ? new VerifiedCheckoutPool(connectionString, options.verifyCheckout)
    : new pg.Pool({ connectionString });
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
  rootPools.set(rootDatabase, pool);
  return rootDatabase;
}
