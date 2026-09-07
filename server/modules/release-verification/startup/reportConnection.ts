import { createPostgresDatabase, type RootDatabase } from "../../../shared/database/client";

/** Exact read grant in immutable migration 0139; no schema-wide/future grants. */
const reportRelations = [
  "verification_gate_registry", "verification_plans", "verification_attempts",
  "verification_gate_results", "verification_reports", "verification_approvals",
] as const;

export class StartupReportConnectionError extends Error {
  constructor(readonly code: string) { super(code); this.name = "StartupReportConnectionError"; }
}

// This pool has one purpose. PUBLIC's ordinary reads are not a new grant or a
// blanket reason to reject historical deployments; effective writes are rejected.
const identitySql = `with recursive reachable(oid) as (
  select oid from pg_catalog.pg_roles where rolname = session_user
  union select m.roleid from pg_catalog.pg_auth_members m join reachable r on m.member=r.oid
), app_schemas as (
  select oid from pg_catalog.pg_namespace where nspname not in ('pg_catalog','information_schema')
    and nspname not like 'pg_toast%' and nspname not like 'pg_temp%'
), app_relations as (
  select c.* from pg_catalog.pg_class c join app_schemas n on n.oid=c.relnamespace
    where c.relkind in ('r','p','v','m','f','S')
), reports as (
  select c.oid from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='parameter_catalog' and c.relname=any($1::text[]) and c.relkind='r'
)
select session_user=current_user as same_identity,
  exists(select 1 from pg_catalog.pg_roles r where r.rolname='catalog_verifier_role'
    and not r.rolcanlogin and not r.rolinherit and pg_catalog.pg_has_role(session_user,r.oid,'USAGE')) as reader_capability,
  (select count(*)::int from pg_catalog.pg_roles r join reachable x on x.oid=r.oid
    where r.rolsuper or r.rolbypassrls or r.rolcreatedb or r.rolcreaterole or r.rolreplication
      or r.rolname not in (session_user,'catalog_verifier_role')) as forbidden_roles,
  (select count(*)::int from pg_catalog.pg_auth_members m join reachable x on x.oid=m.member
    where m.admin_option or m.set_option or not m.inherit_option) as invalid_memberships,
  (select count(*)::int from pg_catalog.pg_shdepend d join reachable x on x.oid=d.refobjid
    where d.refclassid='pg_catalog.pg_authid'::pg_catalog.regclass and d.deptype='o') as owned_objects,
  (6-(select count(*)::int from reports r where pg_catalog.has_table_privilege(session_user,r.oid,'SELECT')
    and pg_catalog.has_schema_privilege(session_user,'parameter_catalog','USAGE'))) as missing_report_reads,
  ((select count(*)::int from app_relations c cross join lateral pg_catalog.aclexplode(c.relacl) a
      where a.grantee in (select oid from reachable) and a.privilege_type='SELECT'
        and (c.oid not in (select oid from reports) or a.is_grantable)) +
   (select count(*)::int from pg_catalog.pg_attribute t join app_relations c on c.oid=t.attrelid
      cross join lateral pg_catalog.aclexplode(t.attacl) a
      where a.grantee in (select oid from reachable)) +
   (select count(*)::int from app_relations c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='parameter_catalog' and c.oid not in (select oid from reports) and
        case when c.relkind='S' then pg_catalog.has_sequence_privilege(session_user,c.oid,'SELECT')
        else pg_catalog.has_table_privilege(session_user,c.oid,'SELECT')
          or pg_catalog.has_any_column_privilege(session_user,c.oid,'SELECT') end)) as unexpected_direct_reads,
  ((select count(*)::int from app_relations c where
      case when c.relkind='S' then pg_catalog.has_sequence_privilege(session_user,c.oid,'USAGE,UPDATE')
      else pg_catalog.has_table_privilege(session_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        or pg_catalog.has_any_column_privilege(session_user,c.oid,'INSERT,UPDATE,REFERENCES') end) +
   (select count(*)::int from app_schemas n where pg_catalog.has_schema_privilege(session_user,n.oid,'CREATE')) +
   case when pg_catalog.has_database_privilege(session_user,pg_catalog.current_database(),'CREATE') then 1 else 0 end) as effective_writes,
  (select count(*)::int from pg_catalog.pg_proc p left join app_schemas n on n.oid=p.pronamespace
    where pg_catalog.has_function_privilege(session_user,p.oid,'EXECUTE') and (
      exists(select 1 from pg_catalog.aclexplode(p.proacl) a where a.grantee in (select oid from reachable))
      or (n.oid is not null and p.prosecdef and (
        exists(select 1 from pg_catalog.pg_roles r where pg_catalog.pg_has_role(p.proowner,r.oid,'MEMBER')
          and (r.rolsuper or r.rolbypassrls or r.rolcreatedb or r.rolcreaterole or r.rolreplication))
        or exists(select 1 from app_schemas s where pg_catalog.has_schema_privilege(p.proowner,s.oid,'CREATE'))
        or exists(select 1 from app_relations c where
          case when c.relkind='S' then pg_catalog.has_sequence_privilege(p.proowner,c.oid,'USAGE,UPDATE')
          else pg_catalog.has_table_privilege(p.proowner,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
            or pg_catalog.has_any_column_privilege(p.proowner,c.oid,'INSERT,UPDATE,REFERENCES') end)
        or exists(select 1 from app_relations c join pg_catalog.pg_namespace s on s.oid=c.relnamespace
          where s.nspname='parameter_catalog' and c.oid not in (select oid from reports) and
            case when c.relkind='S' then pg_catalog.has_sequence_privilege(p.proowner,c.oid,'SELECT')
            else pg_catalog.has_table_privilege(p.proowner,c.oid,'SELECT')
              or pg_catalog.has_any_column_privilege(p.proowner,c.oid,'SELECT') end)
        or exists(select 1 from pg_catalog.pg_proc protected join pg_catalog.pg_namespace s on s.oid=protected.pronamespace
          where s.nspname='parameter_catalog' and pg_catalog.has_function_privilege(p.proowner,protected.oid,'EXECUTE'))
        or exists(select 1 from pg_catalog.pg_proc delegated
          where pg_catalog.has_function_privilege(p.proowner,delegated.oid,'EXECUTE')
            and not pg_catalog.has_function_privilege(session_user,delegated.oid,'EXECUTE'))
        or exists(select 1 from app_relations c where
          case when c.relkind='S' then pg_catalog.has_sequence_privilege(p.proowner,c.oid,'SELECT')
            and not pg_catalog.has_sequence_privilege(session_user,c.oid,'SELECT')
          else (pg_catalog.has_table_privilege(p.proowner,c.oid,'SELECT')
            and not pg_catalog.has_table_privilege(session_user,c.oid,'SELECT'))
            or exists(select 1 from pg_catalog.pg_attribute a where a.attrelid=c.oid
              and a.attnum>0 and not a.attisdropped
              and pg_catalog.has_column_privilege(p.proowner,c.oid,a.attnum,'SELECT')
              and not pg_catalog.has_column_privilege(session_user,c.oid,a.attnum,'SELECT')) end)
      )))) as unsafe_definers,
  (select count(*)::int from pg_catalog.pg_parameter_acl p cross join lateral pg_catalog.aclexplode(p.paracl) a
    left join pg_catalog.pg_settings s on s.name=p.parname
    where (a.grantee=0 or a.grantee in (select oid from reachable))
      and (a.privilege_type='ALTER SYSTEM' or s.context is distinct from 'user')) as unsafe_parameters`;

type IdentityFacts = {
  same_identity: boolean; reader_capability: boolean; forbidden_roles: number;
  invalid_memberships: number; owned_objects: number; missing_report_reads: number;
  unexpected_direct_reads: number; effective_writes: number; unsafe_definers: number;
  unsafe_parameters: number;
};

/** Opens only the 0139 report-reading pool. It neither requires nor grants a
 * Catalog startup approval, so application bootstrap does not recurse. The
 * caller owns close() after success, including later startup/initialization failure.
 */
export async function openStartupReportDatabase(options: {
  readonly connectionString: string;
  readonly databaseOptions?: Parameters<typeof createPostgresDatabase>[1];
}): Promise<RootDatabase> {
  let db: RootDatabase | undefined;
  const refuse = (code: string): never => { throw new StartupReportConnectionError(code); };
  try {
    const connection = new URL(options.connectionString);
    if (!["postgres:", "postgresql:"].includes(connection.protocol) || !connection.hostname
      || !connection.username || connection.pathname.length < 2) refuse("PCAT-REPORT-LOGIN-CONFIG-REJECTED");
    db = createPostgresDatabase(options.connectionString, options.databaseOptions);
    const result = await db.query<IdentityFacts>(identitySql, [[...reportRelations]]);
    const facts = result.rows[0];
    if (result.rowCount !== 1 || !facts || typeof facts.same_identity !== "boolean"
      || typeof facts.reader_capability !== "boolean"
      || [facts.forbidden_roles, facts.invalid_memberships, facts.owned_objects, facts.missing_report_reads,
        facts.unexpected_direct_reads, facts.effective_writes, facts.unsafe_definers, facts.unsafe_parameters]
        .some(value => !Number.isSafeInteger(value) || value < 0)) refuse("PCAT-REPORT-LOGIN-QUERY-FAILED");
    if (!facts.same_identity || !facts.reader_capability || facts.forbidden_roles || facts.invalid_memberships) refuse("PCAT-REPORT-LOGIN-ROLE-REJECTED");
    if (facts.owned_objects) refuse("PCAT-REPORT-LOGIN-OBJECT-OWNER");
    if (facts.missing_report_reads || facts.unexpected_direct_reads || facts.effective_writes
      || facts.unsafe_definers || facts.unsafe_parameters) refuse("PCAT-REPORT-LOGIN-CAPABILITY-REJECTED");
    return db;
  } catch (error) {
    await db?.close().catch(() => undefined);
    if (error instanceof StartupReportConnectionError) throw error;
    throw new StartupReportConnectionError("PCAT-REPORT-LOGIN-QUERY-FAILED");
  }
}
