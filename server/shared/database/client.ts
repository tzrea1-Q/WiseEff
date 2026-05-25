import pg from "pg";

export type QueryResult<Row> = {
  rows: Row[];
  rowCount: number | null;
};

export type Queryable = {
  query<Row>(text: string, values?: unknown[]): Promise<QueryResult<Row>>;
};

export function createDatabase(queryable: Queryable): Queryable {
  return {
    query: (text, values = []) => queryable.query(text, values)
  };
}

export function createPostgresDatabase(connectionString: string): Queryable {
  const pool = new pg.Pool({ connectionString });
  return createDatabase({
    query: async <Row,>(text: string, values: unknown[] = []) => {
      const result = await pool.query(text, values);
      return { rows: result.rows as Row[], rowCount: result.rowCount };
    }
  });
}
