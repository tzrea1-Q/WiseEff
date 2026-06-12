import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadServerEnv } from "../server/config/env";
import { createPostgresDatabase } from "../server/shared/database/client";
import { applyMigrations } from "../server/shared/database/migrations";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const env = loadServerEnv(process.env);

if (!env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to run migrations.");
}

const db = createPostgresDatabase(env.DATABASE_URL);

try {
  const applied = await applyMigrations(db, path.join(root, "server", "migrations"));
  console.log(`Applied ${applied.length} migration(s): ${applied.join(", ") || "none"}`);
} finally {
  await db.close?.();
}
