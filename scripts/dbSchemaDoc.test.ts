import { describe, expect, it } from "vitest";
import type { Database, QueryResult } from "../server/shared/database/client";
import { renderDbSchemaFromDatabase } from "./dbSchemaDoc";

function result<Row>(rows: Row[]): QueryResult<Row> {
  return { rows, rowCount: rows.length };
}

function schemaInventoryDatabase(): Database {
  const database = {
    query: async <Row>(text: string, values: unknown[] = []) => {
      if (text.includes("from information_schema.tables")) {
        return result([
          { schema_name: "parameter_catalog", table_name: "shared_name" },
          { schema_name: "public", table_name: "shared_name" },
        ]) as QueryResult<Row>;
      }
      if (text.includes("from pg_attribute")) {
        const schema = String(values[0]);
        return result([
          {
            column_name: `${schema}_column`,
            data_type: "text",
            not_null: true,
            default_expr: null,
          },
        ]) as QueryResult<Row>;
      }
      if (text.includes("from pg_constraint")) {
        return result([]) as QueryResult<Row>;
      }
      if (text.includes("from pg_indexes")) {
        return result([]) as QueryResult<Row>;
      }
      if (text.includes("from pg_type")) {
        return result([
          { schema_name: "parameter_catalog", typname: "state", label: "current" },
          { schema_name: "public", typname: "state", label: "legacy" },
        ]) as QueryResult<Row>;
      }
      throw new Error(`Unexpected schema inventory query: ${text}`);
    },
    transaction: async <T>(fn: (tx: Database) => Promise<T>) => fn(database),
  } satisfies Database;
  return database;
}

describe("database schema documentation", () => {
  it("renders schema-qualified relations and enums without colliding with public names", async () => {
    const document = await renderDbSchemaFromDatabase(schemaInventoryDatabase());

    expect(document).toContain("## Tables (2)");
    expect(document).toContain(
      "- [`parameter_catalog.shared_name`](#parametercatalogsharedname)",
    );
    expect(document).toContain("- [`shared_name`](#sharedname)");
    expect(document).toContain("### parameter_catalog.shared_name");
    expect(document).toContain("`parameter_catalog_column`");
    expect(document).toContain("### shared_name");
    expect(document).toContain("`public_column`");
    expect(document).toContain("- `parameter_catalog.state`: `current`");
    expect(document).toContain("- `state`: `legacy`");
  });
});
