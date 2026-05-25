import "dotenv/config";
import { loadServerEnv } from "../server/config/env";
import { createPostgresDatabase } from "../server/shared/database/client";

const env = loadServerEnv(process.env);

if (!env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to seed M0 data.");
}

const db = createPostgresDatabase(env.DATABASE_URL);

await db.query(
  `
  insert into organizations (id, name)
  values ($1, $2)
  on conflict (id) do update set name = excluded.name
  `,
  ["org-chargelab", "ChargeLab"]
);

await db.query(
  `
  insert into users (id, organization_id, name, email, title, is_active)
  values ($1, $2, $3, $4, $5, true)
  on conflict (id) do update set name = excluded.name, email = excluded.email, title = excluded.title
  `,
  ["u-xu-yun", "org-chargelab", "Xu Yun", "xu@chargelab.cn", "Platform Owner"]
);

const roles = [
  ["guest", "Guest", "guest", ["parameter:view"]],
  ["hardware-user", "Hardware User", "user", ["parameter:view", "parameter:edit", "debugging:use", "logs:upload"]],
  ["software-user", "Software User", "user", ["parameter:view", "parameter:edit", "debugging:use", "logs:upload"]],
  ["hardware-committer", "Hardware Committer", "committer", ["parameter:view", "parameter:edit", "debugging:use", "logs:upload", "parameter:review"]],
  ["software-committer", "Software Committer", "committer", ["parameter:view", "parameter:edit", "debugging:use", "logs:upload", "parameter:review"]],
  ["admin", "Admin", "admin", ["parameter:view", "parameter:edit", "debugging:use", "logs:upload", "parameter:review", "admin:access", "users:manage"]]
] as const;

for (const [id, name, level, permissions] of roles) {
  await db.query(
    `
    insert into roles (id, name, level, permissions)
    values ($1, $2, $3, $4)
    on conflict (id) do update set name = excluded.name, level = excluded.level, permissions = excluded.permissions
    `,
    [id, name, level, permissions]
  );
}

await db.query(
  `
  insert into user_role_bindings (id, user_id, organization_id, project_id, role_id)
  values ($1, $2, $3, null, $4)
  on conflict (id) do update set role_id = excluded.role_id
  `,
  ["urb-xu-admin", "u-xu-yun", "org-chargelab", "admin"]
);

console.log("Seeded M0 WiseEff data.");
