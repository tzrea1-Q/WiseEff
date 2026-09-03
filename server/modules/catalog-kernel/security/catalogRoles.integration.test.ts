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
  EXCLUSIVE_LOCK_FUNCTION_IDENTITY,
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
  VERIFICATION_MIGRATION,
  VERIFICATION_RELATIONS,
  SYNCHRONIZER_EXECUTE_FUNCTION_NAMES,
  SYNCHRONIZER_HEAD_UPDATES,
  TRIGGER_SECURITY_DEFINER_FUNCTION_IDENTITIES,
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
    await client.query("reset role").catch(() => undefined);
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
    await client.query("reset role").catch(() => undefined);
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

type CanonicalDriverFixture = {
  orgId: string;
  projectId: string;
  projectCode: string;
  attributionId: string;
  moduleId: string;
  releaseId: string;
  releaseSequence: number;
  releaseVersion: string;
  subjectId: string;
  canonicalKey: string;
  registrationId: string;
  placementId: string;
  definitionId: string;
  revisionId: string;
  bindingId: string;
  valueId: string;
};

function assertSafeFixtureId(value: string): string {
  if (!/^[A-Za-z0-9-]+$/.test(value)) {
    throw new Error(`Refusing to interpolate non-identifier ${value}`);
  }
  return value;
}

function sqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function canonicalDriverFixture(suffix: string, releaseSequence: number): CanonicalDriverFixture {
  const fixture = {
    orgId: `org-s2r-${suffix}`,
    projectId: `prj-s2r-${suffix}`,
    projectCode: `S2R${suffix.toUpperCase()}`.slice(0, 16),
    attributionId: `asub-s2r-${suffix}`,
    moduleId: `pmod-s2r-${suffix}`,
    releaseId: `crel-s2r-${suffix}`,
    releaseSequence,
    releaseVersion: `s2r-${suffix}`,
    subjectId: `csub-s2r-${suffix}`,
    canonicalKey: `s2r${suffix},driver`,
    registrationId: `reg-s2r-${suffix}`,
    placementId: `place-s2r-${suffix}`,
    definitionId: `pdef-s2r-${suffix}`,
    revisionId: `drev-s2r-${suffix}`,
    bindingId: `bind-s2r-${suffix}`,
    valueId: `pval-s2r-${suffix}`,
  };
  for (const value of Object.values(fixture)) {
    if (typeof value === "string") {
      assertSafeFixtureId(value.replaceAll(",", ""));
    }
  }
  return fixture;
}

async function commitCanonicalDriverCatalog(
  client: pg.Client,
  fixture: CanonicalDriverFixture,
  options: { includePlacement: boolean; includeBinding: boolean },
): Promise<void> {
  const name = sqlText(`S2-RBAC ${fixture.releaseVersion}`);
  const statements = [
    `insert into public.organizations (id, name) values (${sqlText(fixture.orgId)}, ${name})`,
    `insert into public.projects (id, organization_id, name, code)
     values (${sqlText(fixture.projectId)}, ${sqlText(fixture.orgId)}, ${name}, ${sqlText(fixture.projectCode)})`,
    `insert into public.attribution_subjects (
       id, organization_id, subject_kind, display_name, source_key
     ) values (
       ${sqlText(fixture.attributionId)}, ${sqlText(fixture.orgId)}, 'driver-registration',
       ${name}, ${sqlText(`compatible:${fixture.canonicalKey}`)}
     )`,
    `insert into public.driver_registrations (
       attribution_subject_id, driver_nature, instance_cardinality
     ) values (${sqlText(fixture.attributionId)}, 'physical-device', 'multiple')`,
    `insert into public.parameter_modules (
       id, organization_id, name, path, depth, kind, origin, attribution_subject_id
     ) values (
       ${sqlText(fixture.moduleId)}, ${sqlText(fixture.orgId)}, ${name},
       ${sqlText(fixture.moduleId)}, 1, 'driver-group', 'curated', ${sqlText(fixture.attributionId)}
     )`,
    `insert into parameter_catalog.catalog_releases (
       id, release_sequence, release_version, release_digest,
       compiled_model_digest, toolchain_digest, published_at
     ) values (
       ${sqlText(fixture.releaseId)}, ${fixture.releaseSequence}, ${sqlText(fixture.releaseVersion)},
       ${sqlText(`sha256:${fixture.releaseVersion}`)},
       ${sqlText(`sha256:${fixture.releaseVersion}-model`)},
       ${sqlText(`sha256:${fixture.releaseVersion}-toolchain`)},
       '2026-09-03T00:00:00Z'
     )`,
    `insert into parameter_catalog.catalog_subjects (
       id, introduced_release_id, kind, canonical_key
     ) values (
       ${sqlText(fixture.subjectId)}, ${sqlText(fixture.releaseId)}, 'driver',
       ${sqlText(fixture.canonicalKey)}
     )`,
    `insert into parameter_catalog.catalog_drivers (subject_id, nature, cardinality)
     values (${sqlText(fixture.subjectId)}, 'physical-device', 'multiple')`,
    `insert into parameter_catalog.catalog_release_subjects (
       release_id, subject_id, lifecycle, selector_snapshot, selector_provenance
     ) values (${sqlText(fixture.releaseId)}, ${sqlText(fixture.subjectId)}, 'active', '{}', '{}')`,
  ];

  if (options.includePlacement) {
    statements.push(
      `insert into parameter_catalog.organization_subject_registrations (
         id, organization_id, subject_id, status, registration_method, proof, current_placement_id
       ) values (
         ${sqlText(fixture.registrationId)}, ${sqlText(fixture.orgId)}, ${sqlText(fixture.subjectId)},
         'active', 'explicit', '{}', ${sqlText(fixture.placementId)}
       )`,
      `insert into parameter_catalog.subject_placements (
         id, registration_id, organization_id, module_id, origin
       ) values (
         ${sqlText(fixture.placementId)}, ${sqlText(fixture.registrationId)},
         ${sqlText(fixture.orgId)}, ${sqlText(fixture.moduleId)}, 'curated'
       )`,
    );
  }

  if (options.includeBinding) {
    statements.push(
      `insert into parameter_catalog.parameter_definitions (
         id, introduced_release_id, subject_id, property_key, current_revision_id
       ) values (
         ${sqlText(fixture.definitionId)}, ${sqlText(fixture.releaseId)},
         ${sqlText(fixture.subjectId)}, 'iin_max', ${sqlText(fixture.revisionId)}
       )`,
      `insert into parameter_catalog.definition_revisions (
         id, definition_id, revision_number, catalog_release_id, content_digest, content
       ) values (
         ${sqlText(fixture.revisionId)}, ${sqlText(fixture.definitionId)}, 1,
         ${sqlText(fixture.releaseId)}, ${sqlText(`sha256:${fixture.releaseVersion}-rev`)}, '{}'
       )`,
      `insert into parameter_catalog.catalog_release_definition_heads (
         release_id, definition_id, revision_id
       ) values (
         ${sqlText(fixture.releaseId)}, ${sqlText(fixture.definitionId)}, ${sqlText(fixture.revisionId)}
       )`,
      `insert into parameter_catalog.catalog_materializations (
         release_id, compiled_fingerprint, database_fingerprint, attempt_id, success_audit_ref
       ) values (
         ${sqlText(fixture.releaseId)},
         ${sqlText(`sha256:${fixture.releaseVersion}-compiled-fp`)},
         ${sqlText(`sha256:${fixture.releaseVersion}-database-fp`)},
         ${sqlText(`${fixture.releaseVersion}-attempt`)},
         ${sqlText(`${fixture.releaseVersion}-audit`)}
       )`,
      `insert into parameter_catalog.project_parameter_bindings (
         id, organization_id, catalog_release_id, project_id, logical_node_id, registration_id,
         subject_id, definition_id, effective_revision_id, current_value_id
       ) values (
         ${sqlText(fixture.bindingId)}, ${sqlText(fixture.orgId)}, ${sqlText(fixture.releaseId)},
         ${sqlText(fixture.projectId)}, 'logical-s2r', ${sqlText(fixture.registrationId)},
         ${sqlText(fixture.subjectId)}, ${sqlText(fixture.definitionId)},
         ${sqlText(fixture.revisionId)}, ${sqlText(fixture.valueId)}
       )`,
      `insert into parameter_catalog.project_parameter_values (
         id, binding_id, definition_id, definition_revision_id,
         source_ref, config_revision_id, value_digest, value_kind, value
       ) values (
         ${sqlText(fixture.valueId)}, ${sqlText(fixture.bindingId)}, ${sqlText(fixture.definitionId)},
         ${sqlText(fixture.revisionId)}, 'source-s2r', 'config-s2r', 'sha256:s2r-value', 'number', '1'
       )`,
    );
  }

  await client.query("begin");
  try {
    await client.query(`${statements.join(";\n")};\nset constraints all immediate`);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
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
  const publicOwnerGrants = await query<{
    table_name: string;
    privilege_type: string;
  }>(`
        select table_name, privilege_type
        from information_schema.role_table_grants
        where table_schema = 'public'
          and grantee = 'catalog_migration_owner'
        order by table_name, privilege_type
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
        publicOwnerGrants,
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
      CATALOG_RELATIONS.length +
        GOVERNANCE_RELATIONS.length +
        BINDING_CUTOVER_RELATIONS.length +
        VERIFICATION_RELATIONS.length,
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

  it("grants the synchronizer only CHECK predicates and the exclusive lock", async () => {
    const granted = await client.query<{
      proname: string;
      public_execute: boolean;
      writer_execute: boolean;
    }>(`
      select
        procedure.proname,
        pg_catalog.has_function_privilege('public', procedure.oid, 'execute') as public_execute,
        pg_catalog.has_function_privilege($2, procedure.oid, 'execute') as writer_execute
      from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'parameter_catalog'
        and pg_catalog.has_function_privilege($1, procedure.oid, 'execute')
      order by procedure.proname
    `, [CATALOG_SYNCHRONIZER_ROLE, PARAMETER_GOVERNANCE_WRITER_ROLE]);
    expect(granted.rows).toEqual(
      [...SYNCHRONIZER_EXECUTE_FUNCTION_NAMES].map((proname) => ({
        proname,
        public_execute: false,
        writer_execute: false,
      })),
    );
  });

  it("keeps placement and observation-match guards SECURITY DEFINER without writer execute", async () => {
    const rows = await client.query<{
      identity: string;
      security_definer: boolean;
      public_execute: boolean;
      synchronizer_execute: boolean;
      writer_execute: boolean;
    }>(`
      select
        format(
          '%I.%I(%s)',
          namespace.nspname,
          procedure.proname,
          pg_catalog.pg_get_function_identity_arguments(procedure.oid)
        ) as identity,
        procedure.prosecdef as security_definer,
        pg_catalog.has_function_privilege('public', procedure.oid, 'execute') as public_execute,
        pg_catalog.has_function_privilege($1, procedure.oid, 'execute') as synchronizer_execute,
        pg_catalog.has_function_privilege($2, procedure.oid, 'execute') as writer_execute
      from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'parameter_catalog'
        and format(
          '%I.%I(%s)',
          namespace.nspname,
          procedure.proname,
          pg_catalog.pg_get_function_identity_arguments(procedure.oid)
        ) = any($3::text[])
      order by 1
    `, [
      CATALOG_SYNCHRONIZER_ROLE,
      PARAMETER_GOVERNANCE_WRITER_ROLE,
      [...TRIGGER_SECURITY_DEFINER_FUNCTION_IDENTITIES],
    ]);
    expect(rows.rows).toEqual(
      [...TRIGGER_SECURITY_DEFINER_FUNCTION_IDENTITIES].sort().map((identity) => ({
        identity,
        security_definer: true,
        public_execute: false,
        synchronizer_execute: false,
        writer_execute: false,
      })),
    );
  });

  it("synchronizer INSERT catalog_subjects succeeds through CHECK function execute", async () => {
    await withLocalRole(client, CATALOG_SYNCHRONIZER_ROLE, async () => {
      const inserted = await client.query(`
        insert into parameter_catalog.catalog_subjects (
          id, introduced_release_id, kind, canonical_key
        ) values (
          'csub-sync-check', 'crel-sync-check', 'driver', 'vendor,driver'
        )
      `);
      expect(inserted.rowCount).toBe(1);
    });
  });

  it("synchronizer SELECT acquire_current_pointer_lock_exclusive succeeds", async () => {
    await withLocalRole(client, CATALOG_SYNCHRONIZER_ROLE, async () => {
      await client.query(`select ${EXCLUSIVE_LOCK_FUNCTION_IDENTITY}`);
    });
  });

  it("writer EXECUTE exclusive lock fails 42501 P01", async () => {
    const error = await captureRoleStatementError(
      client,
      PARAMETER_GOVERNANCE_WRITER_ROLE,
      `select ${EXCLUSIVE_LOCK_FUNCTION_IDENTITY}`,
    );
    assertSqlstate42501(error, p01Gate());
  });

  it("writer INSERT subject_placements then SET CONSTRAINTS ALL IMMEDIATE succeeds without Catalog grants", async () => {
    const fixture = canonicalDriverFixture("place", 88910);
    await commitCanonicalDriverCatalog(client, fixture, {
      includePlacement: false,
      includeBinding: false,
    });

    await withLocalRole(client, PARAMETER_GOVERNANCE_WRITER_ROLE, async () => {
      const registration = await client.query(
        `
        insert into parameter_catalog.organization_subject_registrations (
          id, organization_id, subject_id, status, registration_method, proof, current_placement_id
        ) values ($1, $2, $3, 'active', 'explicit', '{}', $4)
        `,
        [fixture.registrationId, fixture.orgId, fixture.subjectId, fixture.placementId],
      );
      expect(registration.rowCount).toBe(1);

      const placement = await client.query(
        `
        insert into parameter_catalog.subject_placements (
          id, registration_id, organization_id, module_id, origin
        ) values ($1, $2, $3, $4, 'curated')
        `,
        [fixture.placementId, fixture.registrationId, fixture.orgId, fixture.moduleId],
      );
      expect(placement.rowCount).toBe(1);

      await client.query("set constraints all immediate");

      const stored = await client.query<{ id: string }>(
        "select id from parameter_catalog.subject_placements where id = $1",
        [fixture.placementId],
      );
      expect(stored.rows).toEqual([{ id: fixture.placementId }]);
    });

    const catalogSelect = await captureRoleStatementError(
      client,
      PARAMETER_GOVERNANCE_WRITER_ROLE,
      "select * from parameter_catalog.catalog_subjects",
    );
    assertSqlstate42501(catalogSelect, p01Gate());

    const privileges = await client.query<{ catalog_select: boolean; binding_select: boolean }>(`
      select
        pg_catalog.has_table_privilege($1, 'parameter_catalog.catalog_subjects', 'select') as catalog_select,
        pg_catalog.has_table_privilege($1, 'parameter_catalog.project_parameter_bindings', 'select') as binding_select
    `, [PARAMETER_GOVERNANCE_WRITER_ROLE]);
    expect(privileges.rows).toEqual([{ catalog_select: false, binding_select: false }]);
  });

  it("writer INSERT observation-match then SET CONSTRAINTS ALL IMMEDIATE succeeds without Binding grants", async () => {
    const fixture = canonicalDriverFixture("match", 88920);
    await commitCanonicalDriverCatalog(client, fixture, {
      includePlacement: true,
      includeBinding: true,
    });

    await withLocalRole(client, PARAMETER_GOVERNANCE_WRITER_ROLE, async () => {
      const observation = await client.query(
        `
        insert into parameter_catalog.parameter_observations (
          id, organization_id, project_id, logical_node_id, config_revision_id,
          source_identity, source_locator, catalog_release_id, matcher_revision, evidence_fingerprint
        ) values (
          $1, $2, $3, 'logical-s2r', 'config-s2r-match',
          'source-s2r-match', '{}', $4, 'matcher-s2r', 'sha256:s2r-match-obs'
        )
        `,
        ["pobs-s2r-match", fixture.orgId, fixture.projectId, fixture.releaseId],
      );
      expect(observation.rowCount).toBe(1);

      const match = await client.query(
        `
        insert into parameter_catalog.parameter_observation_matches (
          id, observation_id, organization_id, project_id, logical_node_id,
          registration_id, subject_id, definition_id, definition_revision_id, binding_id,
          catalog_release_id, matcher_revision
        ) values (
          'pmatch-s2r-match', 'pobs-s2r-match', $1, $2, 'logical-s2r',
          $3, $4, $5, $6, $7,
          $8, 'matcher-s2r'
        )
        `,
        [
          fixture.orgId,
          fixture.projectId,
          fixture.registrationId,
          fixture.subjectId,
          fixture.definitionId,
          fixture.revisionId,
          fixture.bindingId,
          fixture.releaseId,
        ],
      );
      expect(match.rowCount).toBe(1);

      await client.query("set constraints all immediate");

      const stored = await client.query<{ id: string }>(
        "select id from parameter_catalog.parameter_observation_matches where id = 'pmatch-s2r-match'",
      );
      expect(stored.rows).toEqual([{ id: "pmatch-s2r-match" }]);
    });

    const bindingSelect = await captureRoleStatementError(
      client,
      PARAMETER_GOVERNANCE_WRITER_ROLE,
      "select * from parameter_catalog.project_parameter_bindings",
    );
    assertSqlstate42501(bindingSelect, p01Gate());
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

  it("DEFINER owner extractor retains SELECT on public source tables after ownership transfer", async () => {
    const missing = await client.query<{
      function_name: string;
      table_name: string;
    }>(`
      with refs as (
        select
          procedure.proname as function_name,
          match[1] as table_name
        from pg_catalog.pg_proc procedure
        join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
        cross join lateral pg_catalog.regexp_matches(
          pg_catalog.pg_get_functiondef(procedure.oid),
          'public\\.([a-z_][a-z0-9_]*)',
          'g'
        ) as match
        where namespace.nspname = 'parameter_catalog'
          and procedure.prosecdef
      )
      select distinct function_name, table_name
      from refs
      where not pg_catalog.has_table_privilege(
        'catalog_migration_owner',
        format('public.%I', table_name),
        'select'
      )
      order by function_name, table_name
    `);
    expect(missing.rows).toEqual([]);

    await client.query(`
      insert into public.organizations (id, name)
      values ('org-s2r-legacy-owner', 'S2-RBAC legacy owner')
    `);
    await client.query(`
      insert into public.parameter_specs (
        id, organization_id, source_kind, specification_key, definition_lifecycle
      ) values (
        'source-s2r-legacy-owner', 'org-s2r-legacy-owner', 'manual',
        'source-s2r-legacy-owner', 'draft'
      )
    `);

    const inserted = await client.query(`
      insert into parameter_catalog.legacy_identities (
        id, source_system, source_kind, owner_scope_kind, owner_scope_id, source_id
      ) values (
        'lid-s2r-legacy-owner', 'legacy', 'parameter-spec', 'organization',
        'org-s2r-legacy-owner', 'source-s2r-legacy-owner'
      )
    `);
    expect(inserted.rowCount).toBe(1);

    const resolved = await client.query<{
      owner_scope_kind: string;
      owner_scope_id: string;
    }>(`
      select owner_scope_kind, owner_scope_id
      from parameter_catalog.resolve_legacy_identity_owner(
        'parameter-spec',
        'source-s2r-legacy-owner'
      )
    `);
    expect(resolved.rows).toEqual([
      { owner_scope_kind: "organization", owner_scope_id: "org-s2r-legacy-owner" },
    ]);
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

  it("T13: fresh current schema and 0137-then-0138-then-0139 upgrade produce the same ACL fingerprint", async () => {
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
        await applyMigrations(db, migrationsDir, { through: VERIFICATION_MIGRATION });
        upgrade = await aclFingerprint(db);
      },
    );

    expect(fresh).toMatch(/^[0-9a-f]{64}$/);
    expect(upgrade).toBe(fresh);
  }, 180_000);
});
