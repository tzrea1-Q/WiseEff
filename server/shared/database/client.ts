import pg from "pg";

export type QueryResult<Row> = {
  rows: Row[];
  rowCount: number | null;
};

export type Queryable = {
  query<Row>(text: string, values?: unknown[]): Promise<QueryResult<Row>>;
};

export type Database = Queryable & {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
};

export function createDatabase(queryable: Queryable): Database {
  return {
    query: (text, values = []) => queryable.query(text, values),
    transaction: async (fn) => {
      await queryable.query("begin");
      try {
        const result = await fn(queryable);
        await queryable.query("commit");
        return result;
      } catch (error) {
        await queryable.query("rollback");
        throw error;
      }
    }
  };
}

export function createPostgresDatabase(connectionString: string): Database {
  const pool = new pg.Pool({ connectionString });
  return {
    query: async <Row,>(text: string, values: unknown[] = []) => {
      const result = await pool.query(text, values);
      return { rows: result.rows as Row[], rowCount: result.rowCount };
    },
    transaction: async (fn) => {
      const client = await pool.connect();
      const tx: Queryable = {
        query: async <Row,>(text: string, values: unknown[] = []) => {
          const result = await client.query(text, values);
          return { rows: result.rows as Row[], rowCount: result.rowCount };
        }
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
    }
  };
}
