import { createPostgresDatabase, type RootDatabase } from "./client";

export class RuntimeConnectionError extends Error {
  constructor(readonly code: string) { super(code); this.name = "RuntimeConnectionError"; }
}

// This is a login precondition, not the complete role manifest or release verifier.
// Follow all membership edges, including NOINHERIT roles reachable through SET ROLE.
const loginSql = `with recursive reachable(oid) as (
  select oid from pg_catalog.pg_roles where rolname = session_user
  union
  select m.roleid from pg_catalog.pg_auth_members m join reachable r on m.member = r.oid
), application_schemas as (
  select oid from pg_catalog.pg_namespace
  where nspname not in ('pg_catalog', 'information_schema')
    and nspname not like 'pg_toast%' and nspname not like 'pg_temp%'
)
select session_user = current_user as same_identity,
  (select count(*)::int from pg_catalog.pg_roles r join reachable on reachable.oid = r.oid
    where r.rolsuper or r.rolbypassrls or r.rolcreatedb or r.rolcreaterole or r.rolreplication) as privileged_roles,
  (select count(*)::int from pg_catalog.pg_roles r join reachable on reachable.oid = r.oid
    where r.rolname in ('catalog_migration_owner', 'catalog_synchronizer_role', 'catalog_verification_writer_role')) as management_roles,
  (select count(*)::int from pg_catalog.pg_roles r join reachable on reachable.oid = r.oid
    where r.rolname = 'parameter_governance_writer_role') as governance_roles,
  ((select count(*)::int from pg_catalog.pg_class c join application_schemas s on s.oid = c.relnamespace
      where c.relowner in (select oid from reachable)) +
   (select count(*)::int from pg_catalog.pg_namespace n join application_schemas s on s.oid = n.oid
      where n.nspowner in (select oid from reachable)) +
   (select count(*)::int from pg_catalog.pg_proc p join application_schemas s on s.oid = p.pronamespace
      where p.proowner in (select oid from reachable)) +
   (select count(*)::int from pg_catalog.pg_database d where d.datname = current_database()
      and d.datdba in (select oid from reachable))) as owned_objects,
  exists(select 1 from pg_catalog.pg_namespace where nspname = 'parameter_catalog') as catalog_present`;

type LoginFacts = {
  same_identity: boolean;
  privileged_roles: number;
  management_roles: number;
  governance_roles: number;
  owned_objects: number;
  catalog_present: boolean;
};

export async function openRuntimeDatabase(
  options: {
    connectionString: string;
    nodeEnv: string;
    databaseOptions?: Parameters<typeof createPostgresDatabase>[1];
    purpose?: "application" | "catalog-governance-command";
    // A server-owned adapter must derive current target state and call the existing
    // Release Verification projection. A request/environment payload is not authority.
    verifyCatalogStartup?: (db: RootDatabase) => Promise<void>;
  },
  create = createPostgresDatabase,
) {
  let db: RootDatabase | undefined;
  try {
    db = create(options.connectionString, options.databaseOptions);
    if (options.nodeEnv !== "production") return db;
    const facts = (await db.query<LoginFacts>(loginSql)).rows[0];
    if (!facts || facts.same_identity !== true) throw new RuntimeConnectionError("PCAT-RUNTIME-LOGIN-IDENTITY-MISMATCH");
    if (facts.privileged_roles > 0) throw new RuntimeConnectionError("PCAT-RUNTIME-PRIVILEGED-LOGIN");
    if (facts.management_roles > 0) throw new RuntimeConnectionError("PCAT-RUNTIME-MANAGEMENT-ROLE-REACHABLE");
    if (facts.owned_objects > 0) throw new RuntimeConnectionError("PCAT-RUNTIME-OBJECT-OWNER");
    if (options.purpose === "catalog-governance-command") {
      if (facts.governance_roles !== 1) throw new RuntimeConnectionError("PCAT-RUNTIME-GOVERNANCE-CAPABILITY-MISSING");
    } else if (facts.governance_roles > 0) {
      throw new RuntimeConnectionError("PCAT-RUNTIME-GOVERNANCE-CAPABILITY-IN-APPLICATION-POOL");
    }
    if (options.purpose !== "catalog-governance-command") {
      if (facts.catalog_present !== true) throw new RuntimeConnectionError("PCAT-RUNTIME-CATALOG-SCHEMA-MISSING");
      if (!options.verifyCatalogStartup) throw new RuntimeConnectionError("PCAT-RUNTIME-LIVE-PIN-ADAPTER-UNAVAILABLE");
      await options.verifyCatalogStartup(db);
    }
    return db;
  } catch (error) {
    await db?.close().catch(() => undefined);
    if (error instanceof RuntimeConnectionError) throw error;
    // pg errors can contain connection strings, object names, or private SQL.
    throw new RuntimeConnectionError("PCAT-RUNTIME-BOOTSTRAP-QUERY-FAILED");
  }
}
