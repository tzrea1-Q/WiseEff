import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  privilegeVerificationFailureCodes,
  privilegeVerificationGateIds,
} from "../../parameter-catalog-contract";
import { applyMigrations } from "../../../shared/database/migrations";
import {
  createEphemeralTestDatabase,
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase,
} from "../../../testing/testDatabase";
import { migrationsDir, withTempDatabase } from "../../../testing/tempDatabase";
import type { Database } from "../../../shared/database/client";
import {
  BINDING_CUTOVER_RELATIONS,
  CATALOG_MIGRATION_OWNER,
  CATALOG_RELATIONS,
  CATALOG_ROLES,
  CATALOG_SYNCHRONIZER_ROLE,
  FLOOR_MIGRATION,
  GOVERNANCE_RELATIONS,
  GUARD_FUNCTION_IDENTITY,
  LEGACY_STRUCTURAL_TABLES,
  P01_FAILURE_CODE,
  P01_GATE_ID,
  P02_FAILURE_CODE,
  P02_GATE_ID,
  PARAMETER_GOVERNANCE_WRITER_ROLE,
  ROLES_MIGRATION,
  SCHEMA_MIGRATION,
  SYNCHRONIZER_HEAD_UPDATES,
  quoteIdent,
} from "./catalogRoleManifest";

const databaseAvailable = await isTestDatabaseAvailable();

if (!databaseAvailable) {
  throw new Error(
    "S2-RBAC role tests require a reachable real PostgreSQL server with pgvector; skipping is forbidden",
  );
}

const pgVectorInstalled = await (async () => {
  const probe = await createInMemoryTestDatabase();
  try {
    const result = await probe.query<{ installed: boolean }>(
      `select exists (
         select 1
         from pg_catalog.pg_extension
         where extname = 'vector'
       ) as installed`,
    );
    return result.rows[0]?.installed === true;
  } finally {
    await probe.rollback();
  }
})();

if (!pgVectorInstalled) {
  throw new Error(
    "S2-RBAC role tests require pgvector installed in the real PostgreSQL test database; skipping is forbidden",
  );
}

async function captureDatabaseError(action: Promise<unknown>): Promise<pg.DatabaseError> {
  try {
    await action;
  } catch (error) {
    expect(error).toBeInstanceOf(pg.DatabaseError);
    return error as pg.DatabaseError;
  }
  throw new Error("Expected PostgreSQL to reject the operation");
}

async function captureRoleStatementError(
  client: pg.Client,
  role: string,
  sql: string,
): Promise<pg.DatabaseError> {
  await client.query("begin");
  try {
    await client.query(`set local role ${quoteIdent(role)}`);
    return await captureDatabaseError(client.query(sql));
  } finally {
    await client.query("rollback").catch(() => undefined);
  }
}

async function withLocalRole<T>(
  client: pg.Client,
  role: string,
  fn: () => Promise<T>,
): Promise<T> {
  await client.query("begin");
  try {
    await client.query(`set local role ${quoteIdent(role)}`);
    return await fn();
  } finally {
    await client.query("rollback").catch(() => undefined);
  }
}

function assertSqlstate42501(
  error: pg.DatabaseError,
  gate: { id: string; code: string },
): void {
  expect(error.code, `${gate.id} ${gate.code} must come from the executed statement`).toBe(
    "42501",
  );
  expect(error.message.toLowerCase()).toContain("permission denied");
}

function p01Gate() {
  return { id: P01_GATE_ID, code: P01_FAILURE_CODE };
}

function p02Gate() {
  return { id: P02_GATE_ID, code: P02_FAILURE_CODE };
}

function uniqueRoleName(label: string): string {
  const rand = Math.floor(Math.random() * 1_000_000_000).toString(36);
  return `pcat_s2r_${label}_${process.pid}_${rand}`.replace(/[^a-z0-9_]/g, "").slice(0, 63);
}

async function withProductionLogin(
  admin: pg.Client,
  parentUrl: string,
  label: string,
  fn: (login: pg.Client, roleName: string) => Promise<void>,
): Promise<void> {
  const roleName = uniqueRoleName(label);
  const password = `s2rbac_${roleName}`;
  const databaseName = decodeURIComponent(new URL(parentUrl).pathname.replace(/^\//, ""));
  await admin.query(`
    create role ${quoteIdent(roleName)}
    login password '${password}'
    nosuperuser noinherit nocreaterole nocreatedb noreplication
  `);
  await admin.query(
    `grant connect on database ${quoteIdent(databaseName)} to ${quoteIdent(roleName)}`,
  );
  const url = new URL(parentUrl);
  url.username = roleName;
  url.password = password;
  const login = new pg.Client({ connectionString: url.toString() });
  try {
    await login.connect();
    await fn(login, roleName);
  } finally {
    await login.end().catch(() => undefined);
    await admin
      .query(`revoke connect on database ${quoteIdent(databaseName)} from ${quoteIdent(roleName)}`)
      .catch(() => undefined);
    await admin.query(`drop role if exists ${quoteIdent(roleName)}`);
  }
}

async function aclFingerprint(db: Database | pg.Client): Promise<string> {
  const query = async <Row>(text: string): Promise<Row[]> => {
    const result = await db.query(text);
    return result.rows as Row[];
  };

  const owners = await query<{ kind: string; name: string; owner: string }>(`
        select 'table'::text as kind, class.relname as name, pg_catalog.pg_get_userbyid(class.relowner) as owner
        from pg_catalog.pg_class class
        join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
        where namespace.nspname = 'parameter_catalog'
          and class.relkind in ('r', 'p', 'S')
        union all
        select 'function',
          procedure.proname || '(' || pg_catalog.pg_get_function_identity_arguments(procedure.oid) || ')',
          pg_catalog.pg_get_userbyid(procedure.proowner)
        from pg_catalog.pg_proc procedure
        join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
        where namespace.nspname = 'parameter_catalog'
        union all
        select 'schema', namespace.nspname, pg_catalog.pg_get_userbyid(namespace.nspowner)
        from pg_catalog.pg_namespace namespace
        where namespace.nspname = 'parameter_catalog'
        order by 1, 2
      `);
  const roleAttrs = await query<{
    rolname: string;
    rolcanlogin: boolean;
    rolsuper: boolean;
    rolinherit: boolean;
  }>(`
        select rolname, rolcanlogin, rolsuper, rolinherit
        from pg_catalog.pg_roles
        where rolname in (
          'catalog_migration_owner',
          'catalog_synchronizer_role',
          'parameter_governance_writer_role'
        )
        order by rolname
      `);
  const tableGrants = await query<{
    grantee: string;
    table_name: string;
    privilege_type: string;
  }>(`
        select grantee, table_name, privilege_type
        from information_schema.role_table_grants
        where table_schema = 'parameter_catalog'
        order by grantee, table_name, privilege_type
      `);
  const columnGrants = await query<{
    grantee: string;
    table_name: string;
    column_name: string;
    privilege_type: string;
  }>(`
        select grantee, table_name, column_name, privilege_type
        from information_schema.column_privileges
        where table_schema = 'parameter_catalog'
          and grantee in ('catalog_synchronizer_role', 'parameter_governance_writer_role')
        order by grantee, table_name, column_name, privilege_type
      `);
  const functionExecute = await query<{
    role_name: string;
    function_name: string;
    can_execute: boolean;
  }>(`
        select
          role_name,
          procedure.proname as function_name,
          pg_catalog.has_function_privilege(
            role_name,
            procedure.oid,
            'execute'
          ) as can_execute
        from pg_catalog.pg_proc procedure
        join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
        cross join (
          values
            ('public'),
            ('catalog_synchronizer_role'),
            ('parameter_governance_writer_role')
        ) as roles(role_name)
        where namespace.nspname = 'parameter_catalog'
        order by role_name, procedure.proname, pg_catalog.pg_get_function_identity_arguments(procedure.oid)
      `);
  const schemaUsage = await query<{ role_name: string; can_use: boolean }>(`
        select role_name, pg_catalog.has_schema_privilege(role_name, 'parameter_catalog', 'usage') as can_use
        from (
          values
            ('public'),
            ('catalog_synchronizer_role'),
            ('parameter_governance_writer_role')
        ) as roles(role_name)
        order by role_name
      `);
  const members = await query<{ granted: string; member: string }>(`
        select granted.rolname as granted, member.rolname as member
        from pg_catalog.pg_auth_members membership
        join pg_catalog.pg_roles granted on granted.oid = membership.roleid
        join pg_catalog.pg_roles member on member.oid = membership.member
        where granted.rolname in (
          'catalog_migration_owner',
          'catalog_synchronizer_role',
          'parameter_governance_writer_role'
        )
          and member.rolcanlogin
        order by granted.rolname, member.rolname
      `);

  return createHash("sha256")
    .update(
      JSON.stringify({
        owners,
        roleAttrs,
        tableGrants,
        columnGrants,
        functionExecute,
        schemaUsage,
        members,
      }),
    )
    .digest("hex");
}

describe("canonical Catalog roles, grants, and guard reachability", () => {
  let database: EphemeralTestDatabase;
  let client: pg.Client;

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("pcatrbac");
    client = new pg.Client({ connectionString: database.url });
    await client.connect();
  });

  afterAll(async () => {
    await client?.end().catch(() => undefined);
    await database?.drop();
  });

  it("keeps the frozen P01/P02 privilege gate identifiers", () => {
    expect([...privilegeVerificationGateIds]).toEqual([P01_GATE_ID, P02_GATE_ID]);
    expect([...privilegeVerificationFailureCodes]).toEqual([
      P01_FAILURE_CODE,
      P02_FAILURE_CODE,
    ]);
  });

  it("T1: Catalog relations and functions are owned by NOLOGIN catalog_migration_owner", async () => {
    const tables = await client.query<{ tablename: string; tableowner: string }>(`
      select tablename, tableowner
      from pg_catalog.pg_tables
      where schemaname = 'parameter_catalog'
      order by tablename
    `);
    expect(tables.rows.length).toBe(
      CATALOG_RELATIONS.length + GOVERNANCE_RELATIONS.length + BINDING_CUTOVER_RELATIONS.length,
    );
    expect(new Set(tables.rows.map((row) => row.tableowner))).toEqual(
      new Set([CATALOG_MIGRATION_OWNER]),
    );

    const functions = await client.query<{ owner: string }>(`
      select pg_catalog.pg_get_userbyid(procedure.proowner) as owner
      from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'parameter_catalog'
    `);
    expect(functions.rows.length).toBeGreaterThan(0);
    expect(new Set(functions.rows.map((row) => row.owner))).toEqual(
      new Set([CATALOG_MIGRATION_OWNER]),
    );

    const schema = await client.query<{ owner: string }>(`
      select pg_catalog.pg_get_userbyid(namespace.nspowner) as owner
      from pg_catalog.pg_namespace namespace
      where namespace.nspname = 'parameter_catalog'
    `);
    expect(schema.rows).toEqual([{ owner: CATALOG_MIGRATION_OWNER }]);

    const roles = await client.query<{
      rolname: string;
      rolcanlogin: boolean;
      rolsuper: boolean;
    }>(`
      select rolname, rolcanlogin, rolsuper
      from pg_catalog.pg_roles
      where rolname = any($1::text[])
      order by rolname
    `, [[...CATALOG_ROLES]]);
    expect(roles.rows).toEqual(
      [...CATALOG_ROLES].sort().map((rolname) => ({
        rolname,
        rolcanlogin: false,
        rolsuper: false,
      })),
    );
  });

  it("T2: parameter_governance_writer_role can EXECUTE the current-release guard", async () => {
    const privilege = await client.query<{ allowed: boolean }>(`
      select pg_catalog.has_function_privilege(
        $1,
        $2,
        'execute'
      ) as allowed
    `, [PARAMETER_GOVERNANCE_WRITER_ROLE, GUARD_FUNCTION_IDENTITY]);
    expect(privilege.rows).toEqual([{ allowed: true }]);

    const typed = await captureRoleStatementError(
      client,
      PARAMETER_GOVERNANCE_WRITER_ROLE,
      `select ${GUARD_FUNCTION_IDENTITY.replace("text,text,text,text", "'rel', 'dig', 'sub', 'active'")}`,
    );
    expect(typed.code).toBe("PCA04");
    expect(typed.detail).toBe("PCAT-GUARD-DRIFT");
  });

  it("T3: re-running 0138 is idempotent", async () => {
    const before = await aclFingerprint(client);
    const sql = await fs.readFile(path.join(migrationsDir, ROLES_MIGRATION), "utf8");
    await client.query(sql);
    const after = await aclFingerprint(client);
    expect(after).toBe(before);
    expect(before).toMatch(/^[0-9a-f]{64}$/);
  });

  it("T4: PUBLIC remains revoked for Catalog tables and the guard", async () => {
    const publicExecute = await client.query<{ allowed: boolean }>(`
      select pg_catalog.has_function_privilege('public', $1, 'execute') as allowed
    `, [GUARD_FUNCTION_IDENTITY]);
    expect(publicExecute.rows).toEqual([{ allowed: false }]);

    const publicTables = await client.query<{ count: string }>(`
      select count(*)::text as count
      from information_schema.role_table_grants
      where table_schema = 'parameter_catalog'
        and grantee = 'PUBLIC'
    `);
    expect(publicTables.rows).toEqual([{ count: "0" }]);

    const publicSchema = await client.query<{ allowed: boolean }>(`
      select pg_catalog.has_schema_privilege('public', 'parameter_catalog', 'usage') as allowed
    `);
    expect(publicSchema.rows).toEqual([{ allowed: false }]);
  });

  it("T5: governance writer SELECT on catalog_state fails 42501 P01", async () => {
    const error = await captureRoleStatementError(
      client,
      PARAMETER_GOVERNANCE_WRITER_ROLE,
      "select * from parameter_catalog.catalog_state",
    );
    assertSqlstate42501(error, p01Gate());
    expect(`${error.table ?? ""} ${error.message}`).toMatch(/catalog_state/);
  });

  it("T6: governance writer INSERT/UPDATE/DELETE on catalog_releases fails 42501 P01", async () => {
    for (const sql of [
      `insert into parameter_catalog.catalog_releases (
         id, release_sequence, release_version, release_digest,
         compiled_model_digest, toolchain_digest, published_at
       ) values (
         'crel-p01-writer', 1, 'p01-writer', 'sha256:p01-writer',
         'sha256:p01-writer-model', 'sha256:p01-writer-toolchain', '2026-09-03T00:00:00Z'
       )`,
      "update parameter_catalog.catalog_releases set release_version = release_version where false",
      "delete from parameter_catalog.catalog_releases where false",
    ]) {
      const error = await captureRoleStatementError(
        client,
        PARAMETER_GOVERNANCE_WRITER_ROLE,
        sql,
      );
      assertSqlstate42501(error, p01Gate());
    }
  });

  it("T7: application and Agent cannot SET ROLE to Catalog writers", async () => {
    for (const label of ["app", "agt"] as const) {
      await withProductionLogin(client, database.url, label, async (login) => {
        for (const writer of CATALOG_ROLES) {
          const error = await captureDatabaseError(
            login.query(`set role ${quoteIdent(writer)}`),
          );
          assertSqlstate42501(error, p01Gate());
        }
      });
    }
  });

  it("T8: synchronizer can insert immutable Catalog rows and only column-limited head updates", async () => {
    await withLocalRole(client, CATALOG_SYNCHRONIZER_ROLE, async () => {
      const inserted = await client.query(`
        insert into parameter_catalog.catalog_releases (
          id, release_sequence, release_version, release_digest,
          compiled_model_digest, toolchain_digest, published_at
        ) values (
          'crel-sync-t8', 88008, 'sync-t8', 'sha256:sync-t8',
          'sha256:sync-t8-model', 'sha256:sync-t8-toolchain', '2026-09-03T00:00:00Z'
        )
      `);
      expect(inserted.rowCount).toBe(1);

      await client.query(`
        update parameter_catalog.catalog_state
        set ${SYNCHRONIZER_HEAD_UPDATES.catalog_state} = ${SYNCHRONIZER_HEAD_UPDATES.catalog_state}
        where false
      `);
      await client.query(`
        update parameter_catalog.parameter_definitions
        set ${SYNCHRONIZER_HEAD_UPDATES.parameter_definitions} = ${SYNCHRONIZER_HEAD_UPDATES.parameter_definitions}
        where false
      `);
    });

    const extraState = await captureRoleStatementError(
      client,
      CATALOG_SYNCHRONIZER_ROLE,
      "update parameter_catalog.catalog_state set singleton = true where false",
    );
    assertSqlstate42501(extraState, p01Gate());

    const extraDefinition = await captureRoleStatementError(
      client,
      CATALOG_SYNCHRONIZER_ROLE,
      "update parameter_catalog.parameter_definitions set property_key = property_key where false",
    );
    assertSqlstate42501(extraDefinition, p01Gate());
  });

  it("T9: verifier cannot SET ROLE, execute the guard, or call write-capable functions", async () => {
    await withProductionLogin(client, database.url, "vfy", async (login, verifier) => {
      const setRole = await captureDatabaseError(
        login.query(`set role ${quoteIdent(PARAMETER_GOVERNANCE_WRITER_ROLE)}`),
      );
      assertSqlstate42501(setRole, p01Gate());

      const execute = await captureDatabaseError(
        login.query(
          `select ${GUARD_FUNCTION_IDENTITY.replace("text,text,text,text", "'rel', 'dig', 'sub', 'active'")}`,
        ),
      );
      assertSqlstate42501(execute, p01Gate());

      const verifierGuard = await client.query<{ allowed: boolean }>(`
        select pg_catalog.has_function_privilege($1, $2, 'execute') as allowed
      `, [verifier, GUARD_FUNCTION_IDENTITY]);
      expect(verifierGuard.rows).toEqual([{ allowed: false }]);
    });

    const lockExecute = await client.query<{ allowed: boolean }>(`
      select pg_catalog.has_function_privilege(
        $1,
        'parameter_catalog.lock_catalog_state_pointer()',
        'execute'
      ) as allowed
    `, [PARAMETER_GOVERNANCE_WRITER_ROLE]);
    expect(lockExecute.rows).toEqual([{ allowed: false }]);
  });

  it("T10: production roles fail legacy structural writes with 42501 P02", async () => {
    const productionRoles = [
      PARAMETER_GOVERNANCE_WRITER_ROLE,
      CATALOG_SYNCHRONIZER_ROLE,
    ];
    for (const role of productionRoles) {
      for (const table of LEGACY_STRUCTURAL_TABLES) {
        const error = await captureRoleStatementError(
          client,
          role,
          `insert into public.${quoteIdent(table)} default values`,
        );
        assertSqlstate42501(error, p02Gate());
      }
    }

    const writerDefiners = await client.query<{ proname: string }>(`
      select procedure.proname
      from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
      where procedure.prosecdef
        and pg_catalog.has_function_privilege(
          $1,
          procedure.oid,
          'execute'
        )
        and (
          namespace.nspname = 'parameter_catalog'
          or pg_catalog.pg_get_functiondef(procedure.oid) ilike '%parameter_catalog%'
        )
      order by procedure.proname
    `, [PARAMETER_GOVERNANCE_WRITER_ROLE]);
    expect(writerDefiners.rows).toEqual([{ proname: "assert_catalog_subject_active" }]);

    const guardBody = await client.query<{ definition: string }>(`
      select pg_catalog.pg_get_functiondef(procedure.oid) as definition
      from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'parameter_catalog'
        and procedure.proname = 'assert_catalog_subject_active'
    `);
    expect(guardBody.rows[0]?.definition).not.toMatch(/\b(insert|update|delete)\b/i);
  });

  it("T12: governance writer cannot create a SECURITY DEFINER writer function", async () => {
    const catalogForged = await captureRoleStatementError(
      client,
      PARAMETER_GOVERNANCE_WRITER_ROLE,
      `create function parameter_catalog.forged_catalog_writer()
       returns void
       language sql
       security definer
       as $$ insert into parameter_catalog.catalog_releases (
         id, release_sequence, release_version, release_digest,
         compiled_model_digest, toolchain_digest, published_at
       ) values (
         'forged', 1, 'forged', 'sha256:forged',
         'sha256:forged-model', 'sha256:forged-toolchain', now()
       ) $$`,
    );
    assertSqlstate42501(catalogForged, p02Gate());

    const publicForged = await captureRoleStatementError(
      client,
      PARAMETER_GOVERNANCE_WRITER_ROLE,
      `create function public.forged_legacy_writer()
       returns void
       language sql
       security definer
       as $$ insert into public.parameter_definitions default values $$`,
    );
    assertSqlstate42501(publicForged, p02Gate());
  });

  it("governance writer has governance DML and success-audit append, not Binding/Cutover", async () => {
    await withLocalRole(client, PARAMETER_GOVERNANCE_WRITER_ROLE, async () => {
      const idempotency = await client.query(`
        insert into parameter_catalog.governance_command_idempotency (
          organization_id, command_family, idempotency_key, request_fingerprint, state
        ) values (
          'org-hardware-department', 'register-subject', 's2-rbac-t2', 'fp-s2-rbac-t2', 'pending'
        )
      `);
      expect(idempotency.rowCount).toBe(1);

      const audit = await client.query(`
        insert into public.audit_events (
          id, organization_id, actor_type, app, kind, action, severity, metadata, trace_id
        ) values (
          'aud-s2-rbac-append', 'org-hardware-department', 'user', 'wiseeff',
          'parameter-governance', 'append', 'Low', '{}'::jsonb, 'trace-s2-rbac'
        )
      `);
      expect(audit.rowCount).toBe(1);
    });

    const binding = await captureRoleStatementError(
      client,
      PARAMETER_GOVERNANCE_WRITER_ROLE,
      "select * from parameter_catalog.project_parameter_bindings",
    );
    assertSqlstate42501(binding, p01Gate());

    const cutover = await captureRoleStatementError(
      client,
      PARAMETER_GOVERNANCE_WRITER_ROLE,
      "select * from parameter_catalog.parameter_catalog_cutover_runs",
    );
    assertSqlstate42501(cutover, p01Gate());

    const auditMutate = await captureRoleStatementError(
      client,
      PARAMETER_GOVERNANCE_WRITER_ROLE,
      "update public.audit_events set action = action where false",
    );
    expect(auditMutate.code).toBe("42501");
  });

  it("application, agent, and verifier logins are not members of Catalog writer roles", async () => {
    const members = await client.query<{ member: string }>(`
      select member.rolname as member
      from pg_catalog.pg_auth_members membership
      join pg_catalog.pg_roles granted on granted.oid = membership.roleid
      join pg_catalog.pg_roles member on member.oid = membership.member
      where granted.rolname = any($1::text[])
        and member.rolcanlogin
    `, [[...CATALOG_ROLES]]);
    expect(members.rows).toEqual([]);
  });
});

describe("0138 Catalog role migration paths", () => {
  it("applies as the contiguous suffix after 0137", async () => {
    await withTempDatabase(
      { prefix: "pcat_rbac_floor", migrate: false },
      async ({ db }) => {
        const throughSchema = await applyMigrations(db, migrationsDir, {
          through: SCHEMA_MIGRATION,
        });
        expect(throughSchema.at(-1)).toBe(SCHEMA_MIGRATION);

        const ownerBefore = await db.query<{ tableowner: string }>(`
          select tableowner
          from pg_catalog.pg_tables
          where schemaname = 'parameter_catalog'
            and tablename = 'catalog_state'
        `);
        expect(ownerBefore.rows[0]?.tableowner).not.toBe(CATALOG_MIGRATION_OWNER);

        const applied = await applyMigrations(db, migrationsDir, {
          through: ROLES_MIGRATION,
        });
        expect(applied).toEqual([ROLES_MIGRATION]);
        expect(await applyMigrations(db, migrationsDir, { through: ROLES_MIGRATION })).toEqual(
          [],
        );

        const ownerAfter = await db.query<{ tableowner: string }>(`
          select tableowner
          from pg_catalog.pg_tables
          where schemaname = 'parameter_catalog'
            and tablename = 'catalog_state'
        `);
        expect(ownerAfter.rows).toEqual([{ tableowner: CATALOG_MIGRATION_OWNER }]);
      },
    );
  }, 120_000);

  it("T11: granting the guard without creating the grantee role fails closed", async () => {
    const missing = uniqueRoleName("miss");
    await withTempDatabase(
      { prefix: "pcat_rbac_missing", migrate: false },
      async ({ db }) => {
        await applyMigrations(db, migrationsDir, { through: SCHEMA_MIGRATION });
        await db.query(`drop role if exists ${quoteIdent(missing)}`);
        const error = await captureDatabaseError(
          db.query(`
            grant execute on function ${GUARD_FUNCTION_IDENTITY}
            to ${quoteIdent(missing)}
          `),
        );
        expect(error.code).toBe("42704");
      },
    );
  }, 120_000);

  it("T13: fresh 0138 and 0137-then-0138 upgrade produce the same ACL fingerprint", async () => {
    let fresh = "";
    let upgrade = "";

    await withTempDatabase({ prefix: "pcat_rbac_fresh" }, async ({ db }) => {
      fresh = await aclFingerprint(db);
    });

    await withTempDatabase(
      { prefix: "pcat_rbac_upgrade", migrate: false },
      async ({ db }) => {
        await applyMigrations(db, migrationsDir, { through: FLOOR_MIGRATION });
        await applyMigrations(db, migrationsDir, { through: SCHEMA_MIGRATION });
        await applyMigrations(db, migrationsDir, { through: ROLES_MIGRATION });
        upgrade = await aclFingerprint(db);
      },
    );

    expect(fresh).toMatch(/^[0-9a-f]{64}$/);
    expect(upgrade).toBe(fresh);
  }, 180_000);
});
