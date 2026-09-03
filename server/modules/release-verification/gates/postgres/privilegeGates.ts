import pg from "pg";
import {
  CATALOG_MIGRATION_OWNER,
  CATALOG_SYNCHRONIZER_ROLE,
  LEGACY_STRUCTURAL_TABLES,
  PARAMETER_GOVERNANCE_WRITER_ROLE,
} from "../../../catalog-kernel/security/catalogRoleManifest";
import type { Database } from "../../../../shared/database/client";
import type { GateResult } from "../../core/types";
import { countedResult } from "./evidence";
import { IMMUTABLE_CATALOG_RELATIONS, catalogRelation, quoteIdent } from "./relations";

export type PrivilegeProbe = {
  readonly role: string;
  readonly sql: string;
  readonly sqlstate: string;
  readonly succeeded: boolean;
  readonly message: string;
};

const isDatabaseError = (error: unknown): error is pg.DatabaseError =>
  error instanceof pg.DatabaseError ||
  (typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string");

const probe = async (db: Database, role: string, sql: string): Promise<PrivilegeProbe> => {
  const savepoint = `pcat_priv_${Math.floor(Math.random() * 1_000_000_000).toString(36)}`;
  await db.query(`savepoint ${savepoint}`);
  try {
    await db.query(`set local role ${quoteIdent(role)}`);
    await db.query(sql);
    await db.query(`rollback to savepoint ${savepoint}`);
    await db.query(`release savepoint ${savepoint}`);
    return {
      role,
      sql,
      sqlstate: "00000",
      succeeded: true,
      message: "write-succeeded",
    };
  } catch (error) {
    await db.query(`rollback to savepoint ${savepoint}`).catch(() => undefined);
    await db.query(`release savepoint ${savepoint}`).catch(() => undefined);
    if (isDatabaseError(error)) {
      return {
        role,
        sql,
        sqlstate: error.code ?? "unknown",
        succeeded: false,
        message: error.message,
      };
    }
    throw error;
  }
};

const checksumProbes = (probes: readonly PrivilegeProbe[]): string =>
  probes
    .map((item) => `${item.role}|${item.sqlstate}|${item.succeeded ? "1" : "0"}`)
    .sort()
    .join("\n");

const legacyInserts = (): readonly string[] =>
  LEGACY_STRUCTURAL_TABLES.map(
    (table) => `insert into public.${quoteIdent(table)} default values`,
  );

export const runP01 = async (db: Database): Promise<GateResult> => {
  const tablePrivileges = await db.query<{
    role_name: string;
    relation: string;
    privilege_type: string;
    allowed: boolean;
  }>(
    `
    select
      roles.role_name,
      relations.relation,
      privileges.privilege_type,
      pg_catalog.has_table_privilege(
        roles.role_name,
        format('parameter_catalog.%I', relations.relation),
        privileges.privilege_type
      ) as allowed
    from unnest($1::text[]) as roles(role_name)
    cross join unnest($2::text[]) as relations(relation)
    cross join unnest(array['INSERT', 'UPDATE', 'DELETE']::text[]) as privileges(privilege_type)
    `,
    [[PARAMETER_GOVERNANCE_WRITER_ROLE], [...IMMUTABLE_CATALOG_RELATIONS]],
  );
  const granted = tablePrivileges.rows.filter((row) => row.allowed);

  const probes: PrivilegeProbe[] = [
    await probe(
      db,
      PARAMETER_GOVERNANCE_WRITER_ROLE,
      `insert into ${catalogRelation("catalog_releases")} (
         id, release_sequence, release_version, release_digest,
         compiled_model_digest, toolchain_digest, published_at
       ) values (
         'crel-p01-probe', 1, 'p01-probe', 'sha256:p01-probe',
         'sha256:p01-probe-model', 'sha256:p01-probe-toolchain', '2026-09-03T00:00:00Z'
       )`,
    ),
    await probe(
      db,
      PARAMETER_GOVERNANCE_WRITER_ROLE,
      `update ${catalogRelation("catalog_releases")} set release_version = release_version where false`,
    ),
    await probe(
      db,
      PARAMETER_GOVERNANCE_WRITER_ROLE,
      `delete from ${catalogRelation("catalog_releases")} where false`,
    ),
    await probe(
      db,
      PARAMETER_GOVERNANCE_WRITER_ROLE,
      `select * from ${catalogRelation("catalog_state")}`,
    ),
    await probe(
      db,
      CATALOG_SYNCHRONIZER_ROLE,
      `delete from ${catalogRelation("catalog_releases")} where false`,
    ),
    await probe(
      db,
      CATALOG_SYNCHRONIZER_ROLE,
      `update ${catalogRelation("catalog_releases")} set release_digest = release_digest where false`,
    ),
    await probe(
      db,
      CATALOG_SYNCHRONIZER_ROLE,
      `update ${catalogRelation("catalog_state")} set singleton = true where false`,
    ),
  ];

  const members = await db.query<{ member: string; granted: string }>(
    `
    select member.rolname as member, granted.rolname as granted
    from pg_catalog.pg_auth_members membership
    join pg_catalog.pg_roles granted on granted.oid = membership.roleid
    join pg_catalog.pg_roles member on member.oid = membership.member
    where granted.rolname = any($1::text[])
      and member.rolcanlogin
    `,
    [[CATALOG_MIGRATION_OWNER, CATALOG_SYNCHRONIZER_ROLE, PARAMETER_GOVERNANCE_WRITER_ROLE]],
  );

  const bypasses = probes.filter((item) => item.succeeded || item.sqlstate !== "42501");
  const violationCount = granted.length + bypasses.length + members.rows.length;
  await db.query("reset role").catch(() => undefined);
  return countedResult("PCAT-DB-P01", "PCAT-PRIV-CATALOG-IMMUTABILITY-BYPASS", violationCount, {
    bypassCount: bypasses.length,
    granted: granted.map((row) => ({
      privilege: row.privilege_type,
      relation: row.relation,
      role: row.role_name,
    })),
    loginMembers: members.rows,
    probeCount: probes.length,
    sqlstateChecksum: checksumProbes(probes),
    sqlstates: probes.map((item) => item.sqlstate),
  });
};

export const runP02 = async (db: Database): Promise<GateResult> => {
  const probes: PrivilegeProbe[] = [];
  for (const role of [PARAMETER_GOVERNANCE_WRITER_ROLE, CATALOG_SYNCHRONIZER_ROLE]) {
    for (const sql of legacyInserts()) {
      probes.push(await probe(db, role, sql));
    }
  }
  probes.push(
    await probe(
      db,
      PARAMETER_GOVERNANCE_WRITER_ROLE,
      `create function ${catalogRelation("forged_catalog_writer")}()
       returns void
       language sql
       security definer
       as $$ select 1 $$`,
    ),
  );

  const definers = await db.query<{ proname: string }>(
    `
    select procedure.proname
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
    where procedure.prosecdef
      and pg_catalog.has_function_privilege($1, procedure.oid, 'execute')
      and pg_catalog.pg_get_functiondef(procedure.oid) ~* '\\y(insert|update|delete)\\y'
      and (
        namespace.nspname = 'parameter_catalog'
        or pg_catalog.pg_get_functiondef(procedure.oid) ilike '%parameter_catalog%'
      )
    order by procedure.proname
    `,
    [PARAMETER_GOVERNANCE_WRITER_ROLE],
  );
  const unexpectedDefiners = definers.rows.filter(
    (row) => row.proname !== "assert_catalog_subject_active",
  );

  const bypasses = probes.filter((item) => item.succeeded || item.sqlstate !== "42501");
  const violationCount = bypasses.length + unexpectedDefiners.length;
  await db.query("reset role").catch(() => undefined);
  return countedResult("PCAT-DB-P02", "PCAT-PRIV-LEGACY-WRITER-BYPASS", violationCount, {
    bypassCount: bypasses.length,
    probeCount: probes.length,
    sqlstateChecksum: checksumProbes(probes),
    sqlstates: probes.map((item) => item.sqlstate),
    unexpectedDefiners: unexpectedDefiners.map((row) => row.proname),
  });
};
