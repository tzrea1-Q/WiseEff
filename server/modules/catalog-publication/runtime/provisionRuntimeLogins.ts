import { randomBytes } from "node:crypto";
import pg from "pg";

import {
  CATALOG_BASELINE_READER_ROLE,
  CATALOG_MIGRATION_OWNER,
  CATALOG_PUBLICATION_COORDINATOR_ROLE,
  CATALOG_SYNCHRONIZER_ROLE,
  GOVERNANCE_RELATIONS,
  LEGACY_STRUCTURAL_TABLES,
  PARAMETER_GOVERNANCE_WRITER_ROLE,
  quoteIdent,
} from "../../catalog-kernel/security/catalogRoleManifest";

export const PUBLICATION_API_LOGIN = "wiseeff_api";
export const PUBLICATION_WORKER_LOGIN = "wiseeff_worker";
export const PUBLICATION_MANAGER_LOGIN = "wiseeff_publication_manager";

export const PUBLICATION_RUNTIME_OWNERSHIP_PREFIX = "wiseeff-publication-runtime";

/** Workbench Binding/Value DML on the API LOGIN. Not Catalog-core immutability. */
export const WORKBENCH_BINDING_RELATIONS = [
  "project_parameter_bindings",
  "project_parameter_values",
  "binding_history_events",
] as const;

export type PublicationRuntimeLoginMode = "official" | "lab";

export type PublicationRuntimeLoginNames = {
  readonly api: string;
  readonly worker: string;
  readonly manager: string;
};

export type ProvisionPublicationRuntimeLoginsInput = {
  readonly mode: PublicationRuntimeLoginMode;
  readonly runToken?: string;
  readonly rotatePasswords?: boolean;
  readonly names?: PublicationRuntimeLoginNames;
};

export type ProvisionedRuntimeLogins = {
  readonly database: string;
  readonly apiUrl: string;
  readonly workerUrl: string;
  readonly managerUrl: string;
  readonly apiRole: string;
  readonly workerRole: string;
  readonly managerRole: string;
  readonly mode: PublicationRuntimeLoginMode;
  readonly runToken: string | null;
  readonly ownershipComment: string;
  readonly created: readonly string[];
  readonly reused: readonly string[];
  readonly passwordsDelivered: boolean;
  readonly rotatePasswords: boolean;
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

const quotePassword = (secret: string): string => {
  const tag = `pw${randomBytes(8).toString("hex")}`;
  if (secret.includes(tag)) {
    throw new Error("generated password quote tag collided");
  }
  return `$${tag}$${secret}$${tag}$`;
};

const normalizeRunToken = (token: string): string => {
  const normalized = token.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (normalized.length < 6 || normalized.length > 24) {
    throw new Error("lab runToken must be 6-24 alphanumeric characters");
  }
  return normalized;
};

export function publicationRuntimeOwnershipComment(
  mode: PublicationRuntimeLoginMode,
  runToken: string | null,
): string {
  if (mode === "lab") {
    if (!runToken) {
      throw new Error("lab provisioning requires a runToken");
    }
    return `${PUBLICATION_RUNTIME_OWNERSHIP_PREFIX}:lab:${runToken}`;
  }
  return `${PUBLICATION_RUNTIME_OWNERSHIP_PREFIX}:official`;
}

export function publicationRuntimeLoginNames(
  input: ProvisionPublicationRuntimeLoginsInput,
): PublicationRuntimeLoginNames {
  if (input.names) {
    return input.names;
  }
  if (input.mode === "lab") {
    const token = normalizeRunToken(input.runToken ?? "");
    return {
      api: `wiseeff_ra_${token}_api`,
      worker: `wiseeff_ra_${token}_worker`,
      manager: `wiseeff_ra_${token}_manager`,
    };
  }
  return {
    api: PUBLICATION_API_LOGIN,
    worker: PUBLICATION_WORKER_LOGIN,
    manager: PUBLICATION_MANAGER_LOGIN,
  };
}

type RoleInspection = {
  readonly rolname: string;
  readonly rolcanlogin: boolean;
  readonly rolsuper: boolean;
  readonly rolinherit: boolean;
  readonly rolcreaterole: boolean;
  readonly rolcreatedb: boolean;
  readonly rolreplication: boolean;
  readonly comment: string | null;
};

const inspectRole = async (admin: pg.Client, role: string): Promise<RoleInspection | null> => {
  const result = await admin.query<RoleInspection>(
    `select r.rolname,
            r.rolcanlogin,
            r.rolsuper,
            r.rolinherit,
            r.rolcreaterole,
            r.rolcreatedb,
            r.rolreplication,
            shobj_description(r.oid, 'pg_authid') as comment
       from pg_roles r
      where r.rolname = $1`,
    [role],
  );
  return result.rows[0] ?? null;
};

const assertOwnedLogin = (role: string, existing: RoleInspection, expectedComment: string): void => {
  if (existing.comment !== expectedComment) {
    throw new Error(
      `refusing to take over role ${role}: ownership comment ${JSON.stringify(existing.comment)} does not match ${JSON.stringify(expectedComment)}`,
    );
  }
  if (
    existing.rolsuper ||
    existing.rolinherit ||
    existing.rolcreaterole ||
    existing.rolcreatedb ||
    existing.rolreplication ||
    !existing.rolcanlogin
  ) {
    throw new Error(`refusing to take over role ${role}: LOGIN attributes are not NOSUPERUSER NOINHERIT NOCREATEROLE NOCREATEDB NOREPLICATION`);
  }
};

const quoteLiteral = (value: string): string => {
  const tag = `lit${randomBytes(8).toString("hex")}`;
  if (value.includes(tag)) {
    throw new Error("generated literal quote tag collided");
  }
  return `$${tag}$${value}$${tag}$`;
};

const createLogin = async (admin: pg.Client, role: string, secret: string, comment: string): Promise<void> => {
  await admin.query(
    `create role ${quoteIdent(role)} login password ${quotePassword(secret)} nosuperuser noinherit nocreaterole nocreatedb noreplication`,
  );
  await admin.query(`comment on role ${quoteIdent(role)} is ${quoteLiteral(comment)}`);
};

const rotateLoginPassword = async (admin: pg.Client, role: string, secret: string): Promise<void> => {
  await admin.query(
    `alter role ${quoteIdent(role)} with login password ${quotePassword(secret)} nosuperuser noinherit nocreaterole nocreatedb noreplication`,
  );
};

const grantConnectAndUsage = async (
  admin: pg.Client,
  database: string,
  role: string,
  schemas: readonly string[],
): Promise<void> => {
  await admin.query(`grant connect on database ${quoteIdent(database)} to ${quoteIdent(role)}`);
  for (const schema of schemas) {
    await admin.query(`grant usage on schema ${quoteIdent(schema)} to ${quoteIdent(role)}`);
  }
};

const revokeSchemaAccess = async (admin: pg.Client, role: string, schema: string): Promise<void> => {
  await admin.query(`revoke all on all tables in schema ${quoteIdent(schema)} from ${quoteIdent(role)}`);
  await admin.query(`revoke all on all sequences in schema ${quoteIdent(schema)} from ${quoteIdent(role)}`);
  await admin.query(`revoke all on all functions in schema ${quoteIdent(schema)} from ${quoteIdent(role)}`);
  await admin.query(`revoke usage, create on schema ${quoteIdent(schema)} from ${quoteIdent(role)}`);
};

const grantSelectOnSchema = async (admin: pg.Client, role: string, schema: string): Promise<void> => {
  await admin.query(`grant select on all tables in schema ${quoteIdent(schema)} to ${quoteIdent(role)}`);
  await admin.query(`grant usage, select on all sequences in schema ${quoteIdent(schema)} to ${quoteIdent(role)}`);
  await admin.query(
    `alter default privileges in schema ${quoteIdent(schema)} grant select on tables to ${quoteIdent(role)}`,
  );
};

const grantPublicAppDml = async (admin: pg.Client, role: string): Promise<void> => {
  await admin.query(`grant select, insert, update, delete on all tables in schema public to ${quoteIdent(role)}`);
  await admin.query(`grant usage, select, update on all sequences in schema public to ${quoteIdent(role)}`);
};

const grantPublicSelect = async (admin: pg.Client, role: string): Promise<void> => {
  await admin.query(`grant select on all tables in schema public to ${quoteIdent(role)}`);
  await admin.query(`grant usage, select on all sequences in schema public to ${quoteIdent(role)}`);
};

const revokePublicDml = async (admin: pg.Client, role: string): Promise<void> => {
  await admin.query(`revoke insert, update, delete on all tables in schema public from ${quoteIdent(role)}`);
  await admin.query(`revoke update on all sequences in schema public from ${quoteIdent(role)}`);
};

const revokeLegacyStructuralDml = async (admin: pg.Client, roles: readonly string[]): Promise<void> => {
  const existing = await admin.query<{ table_name: string }>(
    `select table_name
       from information_schema.tables
      where table_schema = 'public'
        and table_name = any($1::text[])`,
    [LEGACY_STRUCTURAL_TABLES],
  );
  for (const table of existing.rows) {
    for (const role of roles) {
      await admin.query(
        `revoke insert, update, delete on table ${quoteIdent("public")}.${quoteIdent(table.table_name)} from ${quoteIdent(role)}`,
      );
    }
  }
};

const grantMembership = async (admin: pg.Client, role: string, member: string): Promise<void> => {
  await admin.query(`grant ${quoteIdent(role)} to ${quoteIdent(member)}`);
};

const revokeMembership = async (admin: pg.Client, role: string, member: string): Promise<void> => {
  await admin.query(`revoke ${quoteIdent(role)} from ${quoteIdent(member)}`);
};

const convergeCatalogWriteGrants = async (admin: pg.Client, role: string): Promise<void> => {
  await admin.query(
    `revoke insert, update, delete, truncate, references, trigger on all tables in schema parameter_catalog from ${quoteIdent(role)}`,
  );
  await admin.query(
    `revoke insert, update, delete, truncate, references, trigger on all tables in schema catalog_publication from ${quoteIdent(role)}`,
  );
  await admin.query(`revoke update on all sequences in schema parameter_catalog from ${quoteIdent(role)}`);
  await admin.query(`revoke update on all sequences in schema catalog_publication from ${quoteIdent(role)}`);
};

export async function dropLabRuntimeLogins(
  bootstrapUrl: string,
  runToken: string,
): Promise<{ readonly dropped: readonly string[]; readonly failed: readonly string[] }> {
  const names = publicationRuntimeLoginNames({ mode: "lab", runToken });
  const expected = publicationRuntimeOwnershipComment("lab", normalizeRunToken(runToken));
  const admin = new pg.Client({ connectionString: bootstrapUrl });
  await admin.connect();
  const dropped: string[] = [];
  const failed: string[] = [];
  try {
    for (const role of [names.api, names.worker, names.manager]) {
      const existing = await inspectRole(admin, role);
      if (!existing) {
        continue;
      }
      if (existing.comment !== expected) {
        failed.push(role);
        continue;
      }
      try {
        await admin.query(
          `select pg_terminate_backend(pid)
             from pg_stat_activity
            where usename = $1
              and pid <> pg_backend_pid()`,
          [role],
        );
        for (const schema of ["public", "parameter_catalog", "catalog_publication"]) {
          await admin.query(
            `alter default privileges in schema ${quoteIdent(schema)} revoke select on tables from ${quoteIdent(role)}`,
          );
          await admin.query(`revoke all on all tables in schema ${quoteIdent(schema)} from ${quoteIdent(role)}`);
          await admin.query(`revoke all on all sequences in schema ${quoteIdent(schema)} from ${quoteIdent(role)}`);
          await admin.query(`revoke all on schema ${quoteIdent(schema)} from ${quoteIdent(role)}`);
        }
        await admin.query(`revoke all on database ${quoteIdent(databaseNameOf(bootstrapUrl))} from ${quoteIdent(role)}`);
        await admin.query(`drop role ${quoteIdent(role)}`);
        dropped.push(role);
      } catch {
        failed.push(role);
      }
    }
  } finally {
    await admin.end();
  }
  return { dropped, failed };
}

export async function provisionPublicationRuntimeLogins(
  bootstrapUrl: string,
  input: ProvisionPublicationRuntimeLoginsInput = { mode: "official" },
): Promise<ProvisionedRuntimeLogins> {
  const mode = input.mode;
  const runToken = mode === "lab" ? normalizeRunToken(input.runToken ?? "") : null;
  const names = publicationRuntimeLoginNames({ ...input, mode, runToken: runToken ?? undefined });
  const ownershipComment = publicationRuntimeOwnershipComment(mode, runToken);
  const rotatePasswords = input.rotatePasswords === true;
  const database = databaseNameOf(bootstrapUrl);
  const secrets = {
    api: password(),
    worker: password(),
    manager: password(),
  };
  const admin = new pg.Client({ connectionString: bootstrapUrl });
  await admin.connect();
  const created: string[] = [];
  const reused: string[] = [];
  let passwordsDelivered = false;
  try {
    const superuser = await admin.query<{ rolsuper: boolean }>(
      `select rolsuper from pg_roles where rolname = current_user`,
    );
    if (superuser.rows[0]?.rolsuper !== true) {
      throw new Error("provisioning publication runtime logins requires a bootstrap superuser connection");
    }

    await admin.query("begin");
    try {
      for (const [kind, role] of [
        ["api", names.api],
        ["worker", names.worker],
        ["manager", names.manager],
      ] as const) {
        const existing = await inspectRole(admin, role);
        if (!existing) {
          await createLogin(admin, role, secrets[kind], ownershipComment);
          created.push(role);
          passwordsDelivered = true;
          continue;
        }
        assertOwnedLogin(role, existing, ownershipComment);
        reused.push(role);
        if (rotatePasswords) {
          await rotateLoginPassword(admin, role, secrets[kind]);
          passwordsDelivered = true;
        }
      }

      if (reused.length > 0 && created.length > 0 && !rotatePasswords) {
        throw new Error(
          "refusing mixed create/reuse without rotatePasswords: credential delivery would be incomplete",
        );
      }
      if (reused.length > 0 && !passwordsDelivered && created.length === 0 && !rotatePasswords) {
        // Reuse path: grants still converge; caller must already hold credentials.
      } else if (created.length > 0 || rotatePasswords) {
        passwordsDelivered = true;
      }

      await grantConnectAndUsage(admin, database, names.api, [
        "public",
        "parameter_catalog",
        "catalog_publication",
      ]);
      await grantConnectAndUsage(admin, database, names.worker, ["public"]);
      await grantConnectAndUsage(admin, database, names.manager, [
        "public",
        "parameter_catalog",
        "catalog_publication",
      ]);

      await grantPublicAppDml(admin, names.api);
      await grantPublicAppDml(admin, names.worker);
      await revokePublicDml(admin, names.manager);
      await grantPublicSelect(admin, names.manager);
      await revokeLegacyStructuralDml(admin, [names.api, names.worker, names.manager]);

      await revokeSchemaAccess(admin, names.worker, "parameter_catalog");
      await revokeSchemaAccess(admin, names.worker, "catalog_publication");

      await grantSelectOnSchema(admin, names.api, "parameter_catalog");
      await grantSelectOnSchema(admin, names.api, "catalog_publication");
      await convergeCatalogWriteGrants(admin, names.api);
      await convergeCatalogWriteGrants(admin, names.worker);
      await convergeCatalogWriteGrants(admin, names.manager);
      for (const table of GOVERNANCE_RELATIONS) {
        await admin.query(
          `grant insert, update, delete on table parameter_catalog.${quoteIdent(table)} to ${quoteIdent(names.api)}`,
        );
      }
      for (const table of WORKBENCH_BINDING_RELATIONS) {
        await admin.query(
          `grant insert, update, delete on table parameter_catalog.${quoteIdent(table)} to ${quoteIdent(names.api)}`,
        );
      }

      await grantMembership(admin, CATALOG_PUBLICATION_COORDINATOR_ROLE, names.api);
      await grantMembership(admin, PARAMETER_GOVERNANCE_WRITER_ROLE, names.api);
      await grantMembership(admin, CATALOG_BASELINE_READER_ROLE, names.api);
      await grantMembership(admin, CATALOG_PUBLICATION_COORDINATOR_ROLE, names.manager);
      await grantMembership(admin, CATALOG_SYNCHRONIZER_ROLE, names.manager);

      await revokeMembership(admin, CATALOG_SYNCHRONIZER_ROLE, names.api);
      await revokeMembership(admin, CATALOG_MIGRATION_OWNER, names.api);
      await revokeMembership(admin, CATALOG_SYNCHRONIZER_ROLE, names.worker);
      await revokeMembership(admin, CATALOG_PUBLICATION_COORDINATOR_ROLE, names.worker);
      await revokeMembership(admin, CATALOG_BASELINE_READER_ROLE, names.worker);
      await revokeMembership(admin, PARAMETER_GOVERNANCE_WRITER_ROLE, names.worker);
      await revokeMembership(admin, CATALOG_MIGRATION_OWNER, names.worker);
      await revokeMembership(admin, CATALOG_MIGRATION_OWNER, names.manager);
      await revokeMembership(admin, PARAMETER_GOVERNANCE_WRITER_ROLE, names.manager);
      await revokeMembership(admin, CATALOG_BASELINE_READER_ROLE, names.manager);

      await admin.query("commit");
    } catch (error) {
      await admin.query("rollback");
      throw error;
    }

    if ((created.length > 0 || rotatePasswords) && !passwordsDelivered) {
      throw new Error("provisioning changed roles but did not deliver passwords");
    }

    return {
      database,
      apiRole: names.api,
      workerRole: names.worker,
      managerRole: names.manager,
      mode,
      runToken,
      ownershipComment,
      created,
      reused,
      passwordsDelivered,
      rotatePasswords,
      apiUrl: passwordsDelivered ? withUser(bootstrapUrl, names.api, secrets.api) : "",
      workerUrl: passwordsDelivered ? withUser(bootstrapUrl, names.worker, secrets.worker) : "",
      managerUrl: passwordsDelivered ? withUser(bootstrapUrl, names.manager, secrets.manager) : "",
    };
  } finally {
    await admin.end();
  }
}

export async function inspectLoginBoundary(
  url: string,
): Promise<{
  readonly user: string;
  readonly sessionUser: string;
  readonly superuser: boolean;
  readonly inherit: boolean;
  readonly memberOf: readonly string[];
  readonly catalogDml: readonly string[];
  readonly publicationDml: readonly string[];
}> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const role = await client.query<{
      current_user: string;
      session_user: string;
      rolsuper: boolean;
      rolinherit: boolean;
    }>(
      `select current_user,
              session_user,
              r.rolsuper,
              r.rolinherit
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
    const dml = await client.query<{ table_schema: string; table_name: string; privilege_type: string }>(
      `select table_schema, table_name, privilege_type
         from information_schema.role_table_grants
        where grantee = current_user
          and table_schema in ('parameter_catalog', 'catalog_publication')
          and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
        order by table_schema, table_name, privilege_type`,
    );
    const row = role.rows[0];
    if (!row) {
      throw new Error("login boundary probe failed");
    }
    return {
      user: row.current_user,
      sessionUser: row.session_user,
      superuser: row.rolsuper,
      inherit: row.rolinherit,
      memberOf: members.rows.map((entry) => entry.rolname),
      catalogDml: dml.rows
        .filter((entry) => entry.table_schema === "parameter_catalog")
        .map((entry) => `${entry.table_name}:${entry.privilege_type}`),
      publicationDml: dml.rows
        .filter((entry) => entry.table_schema === "catalog_publication")
        .map((entry) => `${entry.table_name}:${entry.privilege_type}`),
    };
  } finally {
    await client.end();
  }
}
