import "dotenv/config";
import { pathToFileURL } from "node:url";
import { loadServerEnv } from "../server/config/env";
import { createPostgresDatabase } from "../server/shared/database/client";
import type { Database } from "../server/shared/database/client";
import { seedBaselinePlatformRoles } from "../server/modules/auth/baselineCatalog";

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

  await seedBaselinePlatformRoles(db);

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
