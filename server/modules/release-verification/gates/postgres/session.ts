import type { Database, QueryResult } from "../../../../shared/database/client";

export type GateQuery = {
  <Row>(text: string, values?: unknown[]): Promise<QueryResult<Row>>;
};

export type PostgresGateContext = {
  readonly db: Database;
  readonly migrationsDir: string;
};

export const queryOf = (db: Database): GateQuery => {
  return (text, values = []) => db.query(text, values);
};
