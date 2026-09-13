import { randomBytes } from "node:crypto";
import pg from "pg";

import {
  CATALOG_BASELINE_READER_ROLE,
  CATALOG_MIGRATION_OWNER,
  CATALOG_PUBLICATION_COORDINATOR_ROLE,
  CATALOG_SYNCHRONIZER_ROLE,
  PARAMETER_GOVERNANCE_WRITER_ROLE,
  quoteIdent,
} from "../../catalog-kernel/security/catalogRoleManifest";

export const PUBLICATION_API_LOGIN = "wiseeff_api";
export const PUBLICATION_WORKER_LOGIN = "wiseeff_worker";
export const PUBLICATION_MANAGER_LOGIN = "wiseeff_publication_manager";

export type ProvisionedRuntimeLogins = {
  readonly database: string;
  readonly apiUrl: string;
  readonly workerUrl: string;
  readonly managerUrl: string;
  readonly apiRole: string;
  readonly workerRole: string;
  readonly managerRole: string;
};

const password = (): string => randomBytes(18).toString("base64url");

const databaseNameOf = (url: string): string =>
  decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));

const withUser = (adminUrl: string, user: string, secret: string): string => {
  const url = new URL(adminUrl);
  url.username = user;
  url.password = secret;
  return url.toString();
};

const ensureLogin = async (
  admin: pg.Client,
  role: string,
  secret: string,
): Promise<void> => {
  const exists = await admin.query<{ exists: boolean }>(
    `select exists(select 1 from pg_roles where rolname = $1) as exists`,
    [role],
  );
  if (!exists.rows[0]?.exists) {
    await admin.query(
      `create role ${quoteIdent(role)} login password '${secret}' nosuperuser noinherit nocreaterole nocreatedb noreplication`,
    );
    return;
  }
  await admin.query(`alter role ${quoteIdent(role)} with login password '${secret}' nosuperuser noinherit`);
};

export async function provisionPublicationRuntimeLogins(
  bootstrapUrl: string,
): Promise<ProvisionedRuntimeLogins> {
  const database = databaseNameOf(bootstrapUrl);
  const apiSecret = password();
  const workerSecret = password();
  const managerSecret = password();
  const admin = new pg.Client({ connectionString: bootstrapUrl });
  await admin.connect();
  try {
    const superuser = await admin.query<{ rolsuper: boolean }>(
      `select rolsuper from pg_roles where rolname = current_user`,
    );
    if (superuser.rows[0]?.rolsuper !== true) {
      throw new Error("provisioning publication runtime logins requires a bootstrap superuser connection");
    }
    await ensureLogin(admin, PUBLICATION_API_LOGIN, apiSecret);
    await ensureLogin(admin, PUBLICATION_WORKER_LOGIN, workerSecret);
    await ensureLogin(admin, PUBLICATION_MANAGER_LOGIN, managerSecret);

    for (const role of [PUBLICATION_API_LOGIN, PUBLICATION_WORKER_LOGIN, PUBLICATION_MANAGER_LOGIN]) {
      await admin.query(`grant connect on database ${quoteIdent(database)} to ${quoteIdent(role)}`);
      await admin.query(`grant usage on schema public to ${quoteIdent(role)}`);
      await admin.query(`grant usage on schema catalog_publication to ${quoteIdent(role)}`);
      await admin.query(`grant usage on schema parameter_catalog to ${quoteIdent(role)}`);
      await admin.query(
        `grant select, insert, update, delete on all tables in schema public to ${quoteIdent(role)}`,
      );
      await admin.query(`grant usage, select, update on all sequences in schema public to ${quoteIdent(role)}`);
    }

    await admin.query(
      `grant ${quoteIdent(CATALOG_PUBLICATION_COORDINATOR_ROLE)} to ${quoteIdent(PUBLICATION_API_LOGIN)}`,
    );
    await admin.query(
      `grant ${quoteIdent(PARAMETER_GOVERNANCE_WRITER_ROLE)} to ${quoteIdent(PUBLICATION_API_LOGIN)}`,
    );
    await admin.query(
      `grant ${quoteIdent(CATALOG_BASELINE_READER_ROLE)} to ${quoteIdent(PUBLICATION_API_LOGIN)}`,
    );
    await admin.query(
      `grant select, insert, update, delete on all tables in schema parameter_catalog to ${quoteIdent(PUBLICATION_API_LOGIN)}`,
    );
    await admin.query(
      `grant usage, select, update on all sequences in schema parameter_catalog to ${quoteIdent(PUBLICATION_API_LOGIN)}`,
    );
    await admin.query(
      `grant select, insert, update on all tables in schema catalog_publication to ${quoteIdent(PUBLICATION_API_LOGIN)}`,
    );
    await admin.query(
      `grant usage, select, update on all sequences in schema catalog_publication to ${quoteIdent(PUBLICATION_API_LOGIN)}`,
    );
    await admin.query(
      `grant ${quoteIdent(PARAMETER_GOVERNANCE_WRITER_ROLE)} to ${quoteIdent(PUBLICATION_WORKER_LOGIN)}`,
    );
    await admin.query(
      `grant ${quoteIdent(CATALOG_PUBLICATION_COORDINATOR_ROLE)} to ${quoteIdent(PUBLICATION_MANAGER_LOGIN)}`,
    );
    await admin.query(
      `grant ${quoteIdent(CATALOG_SYNCHRONIZER_ROLE)} to ${quoteIdent(PUBLICATION_MANAGER_LOGIN)}`,
    );

    for (const forbidden of [
      [PUBLICATION_API_LOGIN, CATALOG_SYNCHRONIZER_ROLE],
      [PUBLICATION_API_LOGIN, CATALOG_MIGRATION_OWNER],
      [PUBLICATION_WORKER_LOGIN, CATALOG_SYNCHRONIZER_ROLE],
      [PUBLICATION_WORKER_LOGIN, CATALOG_PUBLICATION_COORDINATOR_ROLE],
      [PUBLICATION_WORKER_LOGIN, CATALOG_MIGRATION_OWNER],
      [PUBLICATION_MANAGER_LOGIN, CATALOG_MIGRATION_OWNER],
    ] as const) {
      await admin.query(`revoke ${quoteIdent(forbidden[1])} from ${quoteIdent(forbidden[0])}`).catch(() => undefined);
    }

    return {
      database,
      apiRole: PUBLICATION_API_LOGIN,
      workerRole: PUBLICATION_WORKER_LOGIN,
      managerRole: PUBLICATION_MANAGER_LOGIN,
      apiUrl: withUser(bootstrapUrl, PUBLICATION_API_LOGIN, apiSecret),
      workerUrl: withUser(bootstrapUrl, PUBLICATION_WORKER_LOGIN, workerSecret),
      managerUrl: withUser(bootstrapUrl, PUBLICATION_MANAGER_LOGIN, managerSecret),
    };
  } finally {
    await admin.end();
  }
}

export async function inspectLoginBoundary(
  url: string,
): Promise<{
  readonly user: string;
  readonly superuser: boolean;
  readonly inherit: boolean;
  readonly memberOf: readonly string[];
}> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const role = await client.query<{ current_user: string; rolsuper: boolean; rolinherit: boolean }>(
      `select current_user, r.rolsuper, r.rolinherit
         from pg_roles r
        where r.rolname = current_user`,
    );
    const members = await client.query<{ rolname: string }>(
      `select r.rolname
         from pg_auth_members m
         join pg_roles r on r.oid = m.roleid
         join pg_roles u on u.oid = m.member
        where u.rolname = current_user
        order by r.rolname`,
    );
    const row = role.rows[0];
    if (!row) {
      throw new Error("login boundary probe failed");
    }
    return {
      user: row.current_user,
      superuser: row.rolsuper,
      inherit: row.rolinherit,
      memberOf: members.rows.map((entry) => entry.rolname),
    };
  } finally {
    await client.end();
  }
}
