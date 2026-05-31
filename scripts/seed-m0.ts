import "dotenv/config";
import { pathToFileURL } from "node:url";
import { loadServerEnv } from "../server/config/env";
import { createPostgresDatabase } from "../server/shared/database/client";
import type { Database } from "../server/shared/database/client";

const organizationId = "org-chargelab";

const users = [
  ["u-xu-yun", "Xu Yun", "xu@chargelab.cn", "Platform Owner"],
  ["u-zhao-heng", "Zhao Heng", "zhao@chargelab.cn", "Hardware Engineer"],
  ["u-liu-min", "Liu Min", "liu@chargelab.cn", "Software Engineer"],
  ["u-wang-jie", "Wang Jie", "wang@chargelab.cn", "Hardware Reviewer"],
  ["u-chen-na", "Chen Na", "chen@chargelab.cn", "Software Integrator"],
  ["u-li-peng", "Li Peng", "lipeng@chargelab.cn", "Hardware Committer"],
  ["u-sun-mei", "Sun Mei", "sun@chargelab.cn", "Software Reviewer"]
] as const;

const roles = [
  ["guest", "Guest", "guest", ["parameter:view", "logs:view"]],
  [
    "hardware-user",
    "Hardware User",
    "user",
    ["parameter:view", "parameter:edit", "debugging:use", "debugging:view", "debugging:read", "logs:view", "logs:upload", "logs:feedback"]
  ],
  [
    "software-user",
    "Software User",
    "user",
    ["parameter:view", "parameter:edit", "debugging:use", "debugging:view", "debugging:read", "logs:view", "logs:upload", "logs:feedback"]
  ],
  [
    "hardware-committer",
    "Hardware Committer",
    "committer",
    [
      "parameter:view",
      "parameter:edit",
      "debugging:use",
      "debugging:view",
      "debugging:read",
      "debugging:write",
      "debugging:rollback",
      "logs:view",
      "logs:upload",
      "logs:feedback",
      "parameter:review"
    ]
  ],
  [
    "software-committer",
    "Software Committer",
    "committer",
    [
      "parameter:view",
      "parameter:edit",
      "debugging:use",
      "debugging:view",
      "debugging:read",
      "debugging:write",
      "debugging:rollback",
      "logs:view",
      "logs:upload",
      "logs:feedback",
      "parameter:review"
    ]
  ],
  [
    "admin",
    "Admin",
    "admin",
    [
      "parameter:view",
      "parameter:edit",
      "debugging:use",
      "debugging:view",
      "debugging:read",
      "debugging:write",
      "debugging:rollback",
      "debugging:admin",
      "logs:view",
      "logs:upload",
      "logs:feedback",
      "logs:analyze",
      "logs:archive",
      "parameter:review",
      "admin:access",
      "users:manage"
    ]
  ]
] as const;

export async function seedM0Foundation(db: Database) {
  await db.query(
    `
    insert into organizations (id, name)
    values ($1, $2)
    on conflict (id) do update set name = excluded.name
    `,
    [organizationId, "ChargeLab"]
  );

  for (const [id, name, email, title] of users) {
    await db.query(
      `
      insert into users (id, organization_id, name, email, title, is_active)
      values ($1, $2, $3, $4, $5, true)
      on conflict (id) do update set
        organization_id = excluded.organization_id,
        name = excluded.name,
        email = excluded.email,
        title = excluded.title,
        is_active = excluded.is_active
      `,
      [id, organizationId, name, email, title]
    );
  }

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
    ["urb-xu-admin", "u-xu-yun", organizationId, "admin"]
  );
}

async function main() {
  const env = loadServerEnv(process.env);

  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to seed M0 data.");
  }

  await seedM0Foundation(createPostgresDatabase(env.DATABASE_URL));
  console.log("Seeded M0 WiseEff data.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
