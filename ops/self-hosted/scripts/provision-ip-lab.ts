import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { loadServerEnv } from "../../../server/config/env";
import { createAuditEvent } from "../../../server/modules/audit/repository";
import { seedBaselineAuthCatalog } from "../../../server/modules/auth/baselineCatalog";
import {
  hashLocalAccountPassword,
  validateLocalAccountPassword,
  validateLocalAccountUsername
} from "../../../server/modules/auth/localAccountCredentials";
import { createPostgresDatabase, type Database } from "../../../server/shared/database/client";
import { ipLabSeedOrganizationId, ipLabSeedOrganizationName } from "./ip-lab-profile";

const labAdminRoles = ["admin", "platform-admin"] as const;

export type AttachLabAdminResult = {
  userId: string;
  username: string;
  organizationId: string;
  organizationName: string;
  roles: string[];
  created: boolean;
};

export async function attachLocalAdminToSeedOrganization(
  db: Database,
  username: string
): Promise<AttachLabAdminResult> {
  const normalized = username.trim().toLowerCase();
  const found = await db.query<{ user_id: string }>(
    `
    select user_id
    from user_password_credentials
    where lower(username) = lower($1)
    limit 1
    `,
    [normalized]
  );
  const userId = found.rows[0]?.user_id;
  if (!userId) {
    throw new Error(`No local account found for username ${normalized}.`);
  }

  await ensureSeedOrganization(db);
  await db.query(`update users set organization_id = $2 where id = $1`, [userId, ipLabSeedOrganizationId]);
  await db.query(`update user_role_bindings set organization_id = $2 where user_id = $1`, [
    userId,
    ipLabSeedOrganizationId
  ]);
  const roles = await ensureLabAdminRoles(db, userId);

  return {
    userId,
    username: normalized,
    organizationId: ipLabSeedOrganizationId,
    organizationName: ipLabSeedOrganizationName,
    roles,
    created: false
  };
}

export async function ensureIpLabAdmin(
  db: Database,
  input: { username: string; password: string; name?: string }
): Promise<AttachLabAdminResult> {
  await seedBaselineAuthCatalog(db);
  await ensureSeedOrganization(db);

  const username = input.username.trim().toLowerCase();
  validateLocalAccountUsername(username);
  validateLocalAccountPassword(input.password);
  const name = input.name?.trim() || "Platform Admin";

  const existing = await db.query<{ user_id: string }>(
    `
    select user_id
    from user_password_credentials
    where lower(username) = lower($1)
    limit 1
    `,
    [username]
  );
  if (existing.rows[0]?.user_id) {
    return attachLocalAdminToSeedOrganization(db, username);
  }

  const userId = `u-${randomUUID()}`;
  await db.query(
    `
    insert into users (id, organization_id, name, title, is_active, last_active_at)
    values ($1, $2, $3, $4, true, now())
    `,
    [userId, ipLabSeedOrganizationId, name, "Platform Admin"]
  );
  await db.query("insert into user_password_credentials (user_id, username, password_hash) values ($1, $2, $3)", [
    userId,
    username,
    await hashLocalAccountPassword(input.password)
  ]);
  const roles = await ensureLabAdminRoles(db, userId);
  await createAuditEvent(db, {
    id: randomUUID(),
    organizationId: ipLabSeedOrganizationId,
    projectId: null,
    actorUserId: userId,
    actorType: "system",
    app: "auth",
    kind: "auth-event",
    action: "ip-lab-admin",
    severity: "High",
    targetType: "user",
    targetId: userId,
    metadata: { username, organization: ipLabSeedOrganizationName },
    traceId: "provision-ip-lab"
  });

  return {
    userId,
    username,
    organizationId: ipLabSeedOrganizationId,
    organizationName: ipLabSeedOrganizationName,
    roles,
    created: true
  };
}

export async function provisionIpLab(env: NodeJS.ProcessEnv = process.env) {
  const serverEnv = loadServerEnv(env);
  if (!serverEnv.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to provision the IP lab.");
  }
  if (serverEnv.AUTH_PROVIDER !== "local") {
    throw new Error("AUTH_PROVIDER=local is required to provision the IP lab.");
  }

  const username = env.WISEEFF_LAB_ADMIN_USERNAME?.trim() || "admin.ops";
  const password = env.WISEEFF_LAB_ADMIN_PASSWORD;
  const name = env.WISEEFF_LAB_ADMIN_NAME?.trim() || "Platform Admin";
  if (!password) {
    throw new Error("WISEEFF_LAB_ADMIN_PASSWORD is required to provision the IP lab.");
  }

  const seed = spawnSync("npm", ["run", "db:seed:all"], {
    stdio: "inherit",
    env,
    shell: process.platform === "win32"
  });
  if (seed.status !== 0) {
    throw new Error("Seed step failed: db:seed:all");
  }

  const db = createPostgresDatabase(serverEnv.DATABASE_URL);
  const attached = await ensureIpLabAdmin(db, { username, password, name });
  return {
    bootstrap: attached.created ? "created" : "already-exists",
    attached
  };
}

async function ensureSeedOrganization(db: Database) {
  await db.query(
    `
    insert into organizations (id, name)
    values ($1, $2)
    on conflict (id) do update set name = excluded.name
    `,
    [ipLabSeedOrganizationId, ipLabSeedOrganizationName]
  );
}

async function ensureLabAdminRoles(db: Database, userId: string) {
  const roles: string[] = [];
  for (const roleId of labAdminRoles) {
    const existing = await db.query<{ id: string }>(
      `
      select id
      from user_role_bindings
      where user_id = $1
        and organization_id = $2
        and role_id = $3
        and project_id is null
      limit 1
      `,
      [userId, ipLabSeedOrganizationId, roleId]
    );
    if (existing.rows.length === 0) {
      await db.query(
        `
        insert into user_role_bindings (id, user_id, organization_id, project_id, role_id)
        values ($1, $2, $3, null, $4)
        `,
        [randomUUID(), userId, ipLabSeedOrganizationId, roleId]
      );
    }
    roles.push(roleId);
  }
  return roles;
}

async function main() {
  const result = await provisionIpLab();
  console.log(
    JSON.stringify(
      {
        status: "ready",
        bootstrap: result.bootstrap,
        username: result.attached.username,
        organizationId: result.attached.organizationId,
        organizationName: result.attached.organizationName,
        roles: result.attached.roles,
        message: "Log in with WISEEFF_LAB_ADMIN_USERNAME / WISEEFF_LAB_ADMIN_PASSWORD. Demo data is in ChargeLab."
      },
      null,
      2
    )
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
