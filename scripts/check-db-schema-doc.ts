import { readFile } from "node:fs/promises";
import { DB_SCHEMA_DOC_PATH, isDatabaseReachable, isVectorExtensionAvailable, renderDbSchemaDoc } from "./dbSchemaDoc";

const args = process.argv.slice(2);
const required = args.length === 1 && args[0] === "--require-database";
if (args.length && !required) {
  console.error("db-schema doc check failed: unknown arguments.");
  process.exit(2);
}
// This option only tightens verification; it is not target authorization.
// The owned runner supplies its private TEST_DATABASE_URL. Do not fall back
// to DATABASE_URL or the ordinary developer default in strict mode.
if (required && !process.env.TEST_DATABASE_URL?.trim()) {
  console.error("db-schema doc check failed: an explicit test database is required.");
  process.exit(1);
}

if (!(await isDatabaseReachable())) {
  console.warn(
    "db-schema doc check skipped: no reachable PostgreSQL. The generated artifact was not verified against migrations."
  );
  process.exit(required ? 1 : 0);
}

if (!(await isVectorExtensionAvailable())) {
  console.warn(
    "db-schema doc check skipped: the pgvector extension is unavailable on this server, so the pgvector-canonical artifact cannot be verified here (CI verifies it on pgvector/pgvector:pg16)."
  );
  process.exit(required ? 1 : 0);
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
