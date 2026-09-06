import { createHash } from "node:crypto";
import type pg from "pg";
import { serializeContract, type ContractJsonValue } from "../parameter-catalog-contract";
import { readBindingDatabaseIdentity, type BindingDatabaseIdentity } from "../parameter-bindings/cutoverImport/sourceBoundary";

/** Structure continuity for P4, not a release verifier. The first digest is
 * recorded only after controlled, byte-pinned migration/checkpoint preparation.
 * The controller compares a new digest with that committed receipt on replay.
 * P13 intentionally changes privileges and must use its own release verifier.
 *
 * The relation/column/constraint/index/trigger/function queries follow the
 * existing S2 canonicalSchemaFingerprint in catalogSchemaPrivileges.integration
 * (which cannot be imported: that test module opens the ambient test database).
 * This adds owners, grants, RLS, role membership and default privileges. Catalog
 * OIDs are used only for joins/deparsing; none are serialized into the digest.
 * No application rows, sequence current values or pg_authid/passwords are read.
 */
const queries: Readonly<Record<string, string>> = {
  database: `select pg_catalog.pg_get_userbyid(datdba) as owner,datacl is null as default_acl,
    array(select a::text from pg_catalog.unnest(datacl) a order by a::text collate "C") as acl
    from pg_catalog.pg_database where datname=pg_catalog.current_database()`,
  schemas: `select nspname as schema,pg_catalog.pg_get_userbyid(nspowner) as owner,
    nspacl is null as default_acl,
    array(select a::text from pg_catalog.unnest(nspacl) a order by a::text collate "C") as acl
    from pg_catalog.pg_namespace where nspname in ('public','parameter_catalog')`,
  extensions: `select e.extname as name,e.extversion as version,e.extrelocatable as relocatable,
    pg_catalog.pg_get_userbyid(e.extowner) as owner,n.nspname as schema
    from pg_catalog.pg_extension e join pg_catalog.pg_namespace n on n.oid=e.extnamespace`,
  relations: `select n.nspname as schema,c.relname as name,c.relkind as kind,c.relpersistence as persistence,
    pg_catalog.pg_get_userbyid(c.relowner) as owner,c.relrowsecurity as rls,c.relforcerowsecurity as force_rls,
    c.relreplident as replica_identity,c.relispartition as partition,
    pg_catalog.pg_get_expr(c.relpartbound,c.oid) as partition_bound,
    case when c.relkind='p' then pg_catalog.pg_get_partkeydef(c.oid) end as partition_key,
    c.relacl is null as default_acl,array(select a::text from pg_catalog.unnest(c.relacl) a order by a::text collate "C") as acl,
    array(select o from pg_catalog.unnest(c.reloptions) o order by o collate "C") as options,
    a.amname as access_method,t.spcname as tablespace
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    left join pg_catalog.pg_am a on a.oid=c.relam left join pg_catalog.pg_tablespace t on t.oid=c.reltablespace
    where n.nspname in ('public','parameter_catalog')`,
  inheritance: `select cn.nspname as schema,c.relname as relation,pn.nspname as parent_schema,p.relname as parent,
    i.inhseqno as ordinal,i.inhdetachpending as detach_pending
    from pg_catalog.pg_inherits i join pg_catalog.pg_class c on c.oid=i.inhrelid
    join pg_catalog.pg_namespace cn on cn.oid=c.relnamespace join pg_catalog.pg_class p on p.oid=i.inhparent
    join pg_catalog.pg_namespace pn on pn.oid=p.relnamespace where cn.nspname in ('public','parameter_catalog')`,
  columns: `select n.nspname as schema,c.relname as relation,a.attnum as ordinal,a.attname as name,
    pg_catalog.format_type(a.atttypid,a.atttypmod) as type,a.attnotnull as not_null,a.attidentity as identity,a.attgenerated as generated,
    a.attstorage as storage,a.attcompression as compression,a.attstattarget as statistics_target,
    pg_catalog.pg_get_expr(d.adbin,d.adrelid) as default_expression,cn.nspname as collation_schema,co.collname as collation,
    a.attacl is null as default_acl,array(select p::text from pg_catalog.unnest(a.attacl) p order by p::text collate "C") as acl
    from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid=a.attrelid
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    left join pg_catalog.pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
    left join pg_catalog.pg_collation co on co.oid=a.attcollation left join pg_catalog.pg_namespace cn on cn.oid=co.collnamespace
    where n.nspname in ('public','parameter_catalog') and a.attnum>0 and not a.attisdropped`,
  constraints: `select n.nspname as schema,c.relname as relation,t.typname as domain,p.conname as name,
    p.contype as kind,p.convalidated as validated,p.condeferrable as deferrable,p.condeferred as deferred,
    pg_catalog.pg_get_constraintdef(p.oid,false) as definition
    from pg_catalog.pg_constraint p join pg_catalog.pg_namespace n on n.oid=p.connamespace
    left join pg_catalog.pg_class c on c.oid=p.conrelid left join pg_catalog.pg_type t on t.oid=p.contypid
    where n.nspname in ('public','parameter_catalog')`,
  indexes: `select n.nspname as schema,t.relname as relation,c.relname as name,
    i.indisvalid as valid,i.indisready as ready,i.indislive as live,i.indisclustered as clustered,
    i.indisreplident as replica_identity,pg_catalog.pg_get_indexdef(c.oid) as definition
    from pg_catalog.pg_index i join pg_catalog.pg_class c on c.oid=i.indexrelid
    join pg_catalog.pg_class t on t.oid=i.indrelid join pg_catalog.pg_namespace n on n.oid=t.relnamespace
    where n.nspname in ('public','parameter_catalog')`,
  triggers: `select n.nspname as schema,c.relname as relation,t.tgname as name,t.tgenabled as enabled,
    t.tgisinternal as internal,pg_catalog.pg_get_triggerdef(t.oid,false) as definition
    from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','parameter_catalog') and not t.tgisinternal`,
  internalTriggers: `select n.nspname as schema,c.relname as relation,t.tgenabled as enabled,t.tgtype as kind,
    t.tgdeferrable as deferrable,t.tginitdeferred as deferred,p.conname as constraint_name,
    pn.nspname as constraint_schema,pc.relname as constraint_relation,
    fn.nspname as function_schema,f.proname as function_name,pg_catalog.pg_get_function_identity_arguments(f.oid) as function_arguments,
    t.tgattr::text as columns,pg_catalog.encode(t.tgargs,'hex') as arguments,pg_catalog.pg_get_expr(t.tgqual,t.tgrelid) as condition
    from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    left join pg_catalog.pg_constraint p on p.oid=t.tgconstraint
    left join pg_catalog.pg_namespace pn on pn.oid=p.connamespace left join pg_catalog.pg_class pc on pc.oid=p.conrelid
    join pg_catalog.pg_proc f on f.oid=t.tgfoid join pg_catalog.pg_namespace fn on fn.oid=f.pronamespace
    where n.nspname in ('public','parameter_catalog') and t.tgisinternal`,
  functions: `select n.nspname as schema,p.proname as name,pg_catalog.pg_get_function_identity_arguments(p.oid) as arguments,
    pg_catalog.pg_get_userbyid(p.proowner) as owner,p.prokind as kind,p.prosecdef as security_definer,p.proleakproof as leakproof,
    p.provolatile as volatility,p.proparallel as parallel,p.proisstrict as strict,
    p.proacl is null as default_acl,array(select a::text from pg_catalog.unnest(p.proacl) a order by a::text collate "C") as acl,
    array(select setting from pg_catalog.unnest(p.proconfig) setting order by setting collate "C") as settings,
    case when p.prokind<>'a' then pg_catalog.pg_get_functiondef(p.oid) else pg_catalog.pg_get_function_result(p.oid) end as definition
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','parameter_catalog')`,
  aggregates: `select n.nspname as schema,p.proname as name,pg_catalog.pg_get_function_identity_arguments(p.oid) as arguments,
    a.aggkind as kind,a.aggnumdirectargs as direct_arguments,a.aggtransfn::regprocedure::text as transition,
    a.aggfinalfn::regprocedure::text as final,a.aggcombinefn::regprocedure::text as combine,
    a.aggserialfn::regprocedure::text as serialize,a.aggdeserialfn::regprocedure::text as deserialize,
    a.aggmtransfn::regprocedure::text as moving_transition,a.aggminvtransfn::regprocedure::text as inverse_transition,
    a.aggmfinalfn::regprocedure::text as moving_final,a.aggfinalextra as final_extra,a.aggmfinalextra as moving_final_extra,
    a.aggfinalmodify as final_modify,a.aggmfinalmodify as moving_final_modify,
    pg_catalog.format_type(a.aggtranstype,null) as transition_type,pg_catalog.format_type(a.aggmtranstype,null) as moving_type,
    a.aggtransspace as transition_space,a.aggmtransspace as moving_space,a.agginitval as initial,a.aggminitval as moving_initial
    from pg_catalog.pg_aggregate a join pg_catalog.pg_proc p on p.oid=a.aggfnoid
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','parameter_catalog')`,
  policies: `select n.nspname as schema,c.relname as relation,p.polname as name,p.polcmd as command,p.polpermissive as permissive,
    array(select case when r=0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(r) end from pg_catalog.unnest(p.polroles) r order by 1) as roles,
    pg_catalog.pg_get_expr(p.polqual,p.polrelid) as using_expression,pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid) as check_expression
    from pg_catalog.pg_policy p join pg_catalog.pg_class c on c.oid=p.polrelid
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','parameter_catalog')`,
  rules: `select n.nspname as schema,c.relname as relation,r.rulename as name,r.ev_enabled as enabled,
    pg_catalog.pg_get_ruledef(r.oid,false) as definition from pg_catalog.pg_rewrite r
    join pg_catalog.pg_class c on c.oid=r.ev_class join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','parameter_catalog')`,
  types: `select n.nspname as schema,t.typname as name,t.typtype as kind,pg_catalog.pg_get_userbyid(t.typowner) as owner,
    t.typnotnull as not_null,t.typdefault as default_expression,pg_catalog.format_type(t.typbasetype,t.typtypmod) as base_type,
    t.typacl is null as default_acl,array(select a::text from pg_catalog.unnest(t.typacl) a order by a::text collate "C") as acl,
    array(select e.enumlabel from pg_catalog.pg_enum e where e.enumtypid=t.oid order by e.enumsortorder) as enum_labels
    from pg_catalog.pg_type t join pg_catalog.pg_namespace n on n.oid=t.typnamespace where n.nspname in ('public','parameter_catalog')`,
  sequences: `select n.nspname as schema,c.relname as name,pg_catalog.format_type(s.seqtypid,null) as type,
    s.seqstart::text as start,s.seqincrement::text as increment,s.seqmax::text as maximum,s.seqmin::text as minimum,s.seqcache::text as cache,s.seqcycle as cycle
    from pg_catalog.pg_sequence s join pg_catalog.pg_class c on c.oid=s.seqrelid
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','parameter_catalog')`,
  sequenceOwnership: `select n.nspname as schema,c.relname as name,d.deptype as dependency,
    rn.nspname as owner_schema,r.relname as owner_relation,a.attname as owner_column
    from pg_catalog.pg_depend d join pg_catalog.pg_class c on c.oid=d.objid and c.relkind='S'
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace join pg_catalog.pg_class r on r.oid=d.refobjid
    join pg_catalog.pg_namespace rn on rn.oid=r.relnamespace left join pg_catalog.pg_attribute a on a.attrelid=r.oid and a.attnum=d.refobjsubid
    where d.classid='pg_catalog.pg_class'::regclass and d.refclassid='pg_catalog.pg_class'::regclass
      and d.deptype in ('a','i') and n.nspname in ('public','parameter_catalog')`,
  roles: `select rolname as name,rolsuper as superuser,rolinherit as inherit,rolcreaterole as create_role,
    rolcreatedb as create_database,rolcanlogin as login,rolreplication as replication,rolbypassrls as bypass_rls,
    rolconnlimit as connection_limit,extract(epoch from rolvaliduntil)::text as valid_until,
    array(select config from pg_catalog.unnest(rolconfig) config where config like 'search_path=%' or config like 'role=%' or config like 'row_security=%' order by config collate "C") as security_settings
    from pg_catalog.pg_roles`,
  databaseRoleSettings: `select case when s.setrole=0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(s.setrole) end as role,
    s.setdatabase=0 as all_databases,
    array(select setting from pg_catalog.unnest(s.setconfig) setting
      where setting like 'search_path=%' or setting like 'role=%' or setting like 'row_security=%'
      order by setting collate "C") as security_settings
    from pg_catalog.pg_db_role_setting s where s.setdatabase=0
      or s.setdatabase=(select oid from pg_catalog.pg_database where datname=pg_catalog.current_database())`,
  memberships: `select r.rolname as role,m.rolname as member,g.rolname as grantor,
    a.admin_option as admin,a.inherit_option as inherit,a.set_option as set
    from pg_catalog.pg_auth_members a join pg_catalog.pg_roles r on r.oid=a.roleid
    join pg_catalog.pg_roles m on m.oid=a.member join pg_catalog.pg_roles g on g.oid=a.grantor`,
  defaults: `select pg_catalog.pg_get_userbyid(d.defaclrole) as role,n.nspname as schema,d.defaclobjtype as kind,
    array(select a::text from pg_catalog.unnest(d.defaclacl) a order by a::text collate "C") as acl
    from pg_catalog.pg_default_acl d left join pg_catalog.pg_namespace n on n.oid=d.defaclnamespace
    where d.defaclnamespace=0 or n.nspname in ('public','parameter_catalog')`,
};

export async function captureManagementStructureDigest(input: { client: pg.PoolClient; target: BindingDatabaseIdentity }): Promise<string> {
  try {
    // Caller owns the transaction. Fixed deparser visibility avoids URL/role
    // search_path turning identical objects into different textual definitions.
    await input.client.query(`select pg_catalog.set_config('search_path','pg_catalog, pg_temp',true),
      pg_catalog.set_config('TimeZone','UTC',true),pg_catalog.set_config('DateStyle','ISO, YMD',true),
      pg_catalog.set_config('IntervalStyle','postgres',true),pg_catalog.set_config('extra_float_digits','3',true)`);
    const target = await readBindingDatabaseIdentity(input.client);
    if (target.systemIdentifier !== input.target.systemIdentifier || target.databaseOid !== input.target.databaseOid) throw new Error("target mismatch");
    const hash = createHash("sha256").update("pcat-managed-structure-v1\n");
    let size = 0;
    for (const [kind, sql] of Object.entries(queries)) {
      const result = await input.client.query(sql);
      const rows = result.rows.map(row => serializeContract(row as ContractJsonValue)).sort();
      if (rows.length > 100000) throw new Error("structure inventory too large");
      hash.update(`${kind}\n`);
      for (const row of rows) {
        const length = Buffer.byteLength(row); size += length;
        if (size > 64 * 1024 * 1024) throw new Error("structure inventory too large");
        hash.update(`${length}:`).update(row);
      }
    }
    return `sha256:${hash.digest("hex")}`;
  } catch { throw new Error("management-structure-unavailable"); }
}
