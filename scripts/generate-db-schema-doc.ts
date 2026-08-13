import { writeFile } from "node:fs/promises";
import { DB_SCHEMA_DOC_PATH, isDatabaseReachable, isVectorExtensionAvailable, renderDbSchemaDoc } from "./dbSchemaDoc";

if (!(await isDatabaseReachable())) {
  console.error(
    "Cannot generate docs/generated/db-schema.md: no reachable PostgreSQL (set DATABASE_URL or start the local database)."
  );
  process.exit(1);
}

if (!(await isVectorExtensionAvailable())) {
  console.error(
    "Cannot generate docs/generated/db-schema.md: the artifact is pgvector-canonical and this server lacks the vector extension. Point DATABASE_URL at a pgvector-enabled PostgreSQL (e.g. a pgvector/pgvector:pg16 container)."
  );
  process.exit(1);
}

const rendered = await renderDbSchemaDoc();
await writeFile(DB_SCHEMA_DOC_PATH, rendered, "utf8");
console.log(`Wrote ${DB_SCHEMA_DOC_PATH}`);
