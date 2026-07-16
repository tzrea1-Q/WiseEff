import "dotenv/config";
import { loadServerEnv } from "../server/config/env";
import { checkParameterIdentityCutover } from "../server/modules/parameter-topology/migration";
import { createPostgresDatabase } from "../server/shared/database/client";

async function main() {
  const env = loadServerEnv(process.env);
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for parameter identity cutover check.");
  }

  const db = createPostgresDatabase(env.DATABASE_URL);
  const result = await checkParameterIdentityCutover(db);
  console.log(JSON.stringify(result, null, 2));

  if (!result.ok) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
