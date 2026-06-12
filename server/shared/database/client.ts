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
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close?(): Promise<void>;
};

type DatabaseOptions = {
  tracing?: Pick<TracingBoundary, "withSpan">;
};

export function createDatabase(queryable: Queryable, options: DatabaseOptions = {}): Database {
  const query = <Row,>(text: string, values: unknown[] = []) => traceQuery(options.tracing, text, values, () => queryable.query<Row>(text, values));

  return {
    query,
    transaction: async (fn) => {
      await query("begin");
      const tx: Queryable = { query };
      try {
        const result = await fn(tx);
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

export function createPostgresDatabase(connectionString: string, options: DatabaseOptions = {}): Database {
  const pool = new pg.Pool({ connectionString });
  const query = <Row,>(text: string, values: unknown[] = []) =>
    traceQuery(options.tracing, text, values, async () => {
      const result = await pool.query(text, values);
      return { rows: result.rows as Row[], rowCount: result.rowCount };
    });

  return {
    query,
    transaction: async (fn) => {
      const client = await pool.connect();
      const tx: Queryable = {
        query: <Row,>(text: string, values: unknown[] = []) =>
          traceQuery(options.tracing, text, values, async () => {
            const result = await client.query(text, values);
            return { rows: result.rows as Row[], rowCount: result.rowCount };
          })
      };

      try {
        await tx.query("begin");
        const result = await fn(tx);
        await tx.query("commit");
        return result;
      } catch (error) {
        await tx.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end()
  };
}
