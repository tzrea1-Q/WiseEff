import type { Database } from "../../shared/database/client";
import {
  hashLocalAccountPassword,
  validateLocalAccountPassword,
  validateLocalAccountUsername
} from "./localAccountCredentials";

export const LOCAL_DEMO_SHARED_PASSWORD = "WiseEff-Dev!";

export const LOCAL_DEMO_CREDENTIALS = [
  { userId: "u-xu-yun", username: "xu.yun" },
  { userId: "u-zhao-heng", username: "zhao.heng" },
  { userId: "u-liu-min", username: "liu.min" },
  { userId: "u-wang-jie", username: "wang.jie" },
  { userId: "u-chen-na", username: "chen.na" },
  { userId: "u-li-peng", username: "li.peng" },
  { userId: "u-sun-mei", username: "sun.mei" }
] as const;

export function shouldSeedLocalDemoCredentials(env: NodeJS.ProcessEnv = process.env) {
  return env.NODE_ENV === "development";
}

export async function seedLocalDemoCredentials(db: Database, env: NodeJS.ProcessEnv = process.env) {
  if (!shouldSeedLocalDemoCredentials(env)) {
    return { seeded: false, count: 0 };
  }

  validateLocalAccountPassword(LOCAL_DEMO_SHARED_PASSWORD);
  const passwordHash = await hashLocalAccountPassword(LOCAL_DEMO_SHARED_PASSWORD);

  for (const row of LOCAL_DEMO_CREDENTIALS) {
    validateLocalAccountUsername(row.username);
    await db.query(
      `
      insert into user_password_credentials (user_id, username, password_hash)
      values ($1, $2, $3)
      on conflict (user_id) do update set
        username = excluded.username,
        password_hash = excluded.password_hash,
        password_updated_at = now()
      `,
      [row.userId, row.username, passwordHash]
    );
  }

  return { seeded: true, count: LOCAL_DEMO_CREDENTIALS.length };
}
