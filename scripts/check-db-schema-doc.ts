import { readFile } from "node:fs/promises";
import { DB_SCHEMA_DOC_PATH, isDatabaseReachable, renderDbSchemaDoc } from "./dbSchemaDoc";

if (!(await isDatabaseReachable())) {
  console.warn(
    "db-schema doc check skipped: no reachable PostgreSQL. The generated artifact was not verified against migrations."
  );
  process.exit(0);
}

const expected = await renderDbSchemaDoc();

let actual: string;
try {
  actual = await readFile(DB_SCHEMA_DOC_PATH, "utf8");
} catch (error) {
  console.error(`db-schema artifact is missing at ${DB_SCHEMA_DOC_PATH}. Run npm run db:schema-doc.`);
  throw error;
}

if (actual !== expected) {
  console.error(
    "docs/generated/db-schema.md is out of date with server/migrations. Run npm run db:schema-doc and commit the result."
  );
  process.exit(1);
}

console.log("db-schema artifact is current.");
