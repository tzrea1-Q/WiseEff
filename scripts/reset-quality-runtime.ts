import "dotenv/config";
import { pathToFileURL } from "node:url";

import { loadServerEnv } from "../server/config/env";
import { createPostgresDatabase, type Database } from "../server/shared/database/client";

const seededUserIds = [
  "u-xu-yun",
  "u-zhao-heng",
  "u-liu-min",
  "u-wang-jie",
  "u-chen-na",
  "u-li-peng",
  "u-sun-mei"
] as const;

export async function resetQualityRuntime(db: Database) {
  await db.transaction(async (tx) => {
    await tx.query("update users set organization_id = 'org-chargelab' where id = any($1::text[])", [seededUserIds]);
    await tx.query("delete from local_registration_role_requests");
    await tx.query("delete from auth_sessions");
    await tx.query("delete from user_password_credentials");
    await tx.query("delete from user_role_bindings");
    await tx.query("delete from audit_events where app in ('auth', 'user-governance') or target_type = 'user'");
    await tx.query("delete from users where id <> all($1::text[])", [seededUserIds]);
  });
}

async function main() {
  const env = loadServerEnv(process.env);

  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to reset quality runtime data.");
  }

  await resetQualityRuntime(createPostgresDatabase(env.DATABASE_URL));
  console.log("Reset transient WiseEff quality runtime data.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
