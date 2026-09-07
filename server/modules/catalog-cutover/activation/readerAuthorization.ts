import type { Queryable } from "../../../shared/database/client";
import { CATALOG_READER_RELATIONS, CATALOG_READER_ROLE } from "../../catalog-kernel/security/catalogReaderManifest";
import { ActivationRefusal } from "./interface";

/** This is the dedicated Kernel connection, not the application's business pool.
 * Audit the actual LOGIN as well as the capability role on every checkout. No
 * role repair, grants, SQL execution probe or caller-provided role assertion.
 */
export async function assertDedicatedCatalogReader(reader: Queryable): Promise<void> {
  const relations = CATALOG_READER_RELATIONS.map(name => name.startsWith("parameter_catalog.") ? name.slice("parameter_catalog.".length) : name);
  const row = (await reader.query<{ safe: boolean }>(`with
    identities as (select oid,rolname,rolcanlogin,rolinherit,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication
      from pg_catalog.pg_roles where rolname=session_user or rolname=$1),
    permitted_relations as (select c.oid from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='parameter_catalog' and c.relname=any($2::text[]) and c.relkind in ('r','p'))
    select session_user=current_user and session_user<>$1
      and (select count(*)=2 from identities)
      and not exists(select 1 from identities where rolsuper or rolbypassrls or rolcreatedb or rolcreaterole or rolreplication
        or (rolname=$1 and (rolcanlogin or rolinherit)) or (rolname=session_user and not rolcanlogin))
      and (select count(*)=1 from pg_catalog.pg_auth_members m where m.member in (select oid from identities))
      and exists(select 1 from pg_catalog.pg_auth_members m join identities login on login.oid=m.member
        join identities capability on capability.oid=m.roleid where login.rolname=session_user and capability.rolname=$1
        and m.inherit_option and not m.set_option and not m.admin_option)
      and pg_has_role(session_user,$1,'USAGE')
      and not exists(select 1 from pg_catalog.pg_shdepend where refobjid in (select oid from identities) and deptype='o')
      and not exists(select 1 from pg_catalog.pg_db_role_setting where setrole in (select oid from identities))
      and not exists(select 1 from pg_catalog.pg_class c,lateral aclexplode(c.relacl) acl
        where acl.grantee in (select oid from identities) and (c.oid not in (select oid from permitted_relations)
          or acl.privilege_type<>'SELECT' or acl.is_grantable))
      and not exists(select 1 from pg_catalog.pg_attribute a,lateral aclexplode(a.attacl) acl where acl.grantee in (select oid from identities))
      and not exists(select 1 from pg_catalog.pg_proc p,lateral aclexplode(p.proacl) acl where acl.grantee in (select oid from identities))
      and not exists(select 1 from pg_catalog.pg_namespace n,lateral aclexplode(n.nspacl) acl
        where acl.grantee in (select oid from identities) and (n.nspname<>'parameter_catalog' or acl.privilege_type<>'USAGE' or acl.is_grantable))
      and not exists(select 1 from pg_catalog.pg_database d,lateral aclexplode(d.datacl) acl where acl.grantee in (select oid from identities))
      and not exists(select 1 from pg_catalog.pg_default_acl d left join lateral aclexplode(d.defaclacl) acl on true
        where d.defaclrole in (select oid from identities) or acl.grantee in (select oid from identities))
      and not exists(select 1 from pg_catalog.pg_parameter_acl p left join pg_catalog.pg_settings s on s.name=p.parname,
        lateral aclexplode(p.paracl) acl where acl.grantee in (select oid from identities)
          or (acl.grantee=0 and (acl.privilege_type='ALTER SYSTEM' or coalesce(s.context,'unknown')<>'user')))
      and not exists(select 1 from pg_catalog.pg_largeobject_metadata o,lateral aclexplode(o.lomacl) acl where acl.grantee in (select oid from identities))
      and not exists(select 1 from pg_catalog.pg_type o,lateral aclexplode(o.typacl) acl where acl.grantee in (select oid from identities))
      and not exists(select 1 from pg_catalog.pg_language o,lateral aclexplode(o.lanacl) acl where acl.grantee in (select oid from identities))
      and not exists(select 1 from pg_catalog.pg_tablespace o,lateral aclexplode(o.spcacl) acl where acl.grantee in (select oid from identities))
      and not exists(select 1 from pg_catalog.pg_foreign_data_wrapper o,lateral aclexplode(o.fdwacl) acl where acl.grantee in (select oid from identities))
      and not exists(select 1 from pg_catalog.pg_foreign_server o,lateral aclexplode(o.srvacl) acl where acl.grantee in (select oid from identities))
      -- PUBLIC cannot add Catalog interfaces or a writable search-path schema.
      and not exists(select 1 from pg_catalog.pg_namespace n where n.nspname !~ '^pg_(toast|temp)'
        and has_schema_privilege(session_user,n.oid,'CREATE'))
      and not has_database_privilege(session_user,current_database(),'CREATE')
      and not exists(select 1 from pg_catalog.pg_namespace n,lateral aclexplode(n.nspacl) acl
        where n.nspname='parameter_catalog' and acl.grantee=0)
      and not exists(select 1 from pg_catalog.pg_default_acl d,lateral aclexplode(d.defaclacl) acl
        where acl.grantee=0 and d.defaclnamespace in (0,(select oid from pg_catalog.pg_namespace where nspname='parameter_catalog'))
          and d.defaclrole in (select oid from pg_catalog.pg_roles where rolname='catalog_migration_owner'))
      and not exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace,
        lateral aclexplode(c.relacl) acl where n.nspname='parameter_catalog' and acl.grantee=0)
      and not exists(select 1 from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid=a.attrelid
        join pg_catalog.pg_namespace n on n.oid=c.relnamespace,lateral aclexplode(a.attacl) acl
        where n.nspname='parameter_catalog' and acl.grantee=0)
      and not exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
        where n.nspname not in ('pg_catalog','information_schema') and n.nspname !~ '^pg_(toast|temp)'
          and c.oid not in (select oid from permitted_relations) and c.relkind in ('r','p','v','m','f','S')
          and (case when c.relkind='S' then has_sequence_privilege(session_user,c.oid,'USAGE,SELECT,UPDATE') else
            has_table_privilege(session_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
              or has_any_column_privilege(session_user,c.oid,'SELECT,INSERT,UPDATE,REFERENCES') end))
      and not exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
        where n.nspname='parameter_catalog' and has_function_privilege(session_user,p.oid,'EXECUTE'))
      -- PostgreSQL records non-default initdb ACLs in pg_init_privs. Compare
      -- PUBLIC execution against that baseline, not the permissive default
      -- function ACL: restricted built-ins must stay restricted.
      and not exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
        join pg_catalog.pg_init_privs i on i.classoid='pg_catalog.pg_proc'::regclass and i.objoid=p.oid and i.objsubid=0 and i.privtype='i'
        where n.nspname='pg_catalog' and exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE')
          and not exists(select 1 from aclexplode(i.initprivs) a where a.grantee=0 and a.privilege_type='EXECUTE'))
      and not exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
        join pg_catalog.pg_roles owner on owner.oid=p.proowner
        where p.prosecdef and n.nspname not in ('pg_catalog','information_schema') and n.nspname !~ '^pg_(toast|temp)_'
          and has_function_privilege(session_user,p.oid,'EXECUTE')
          and (owner.rolsuper or owner.rolbypassrls or owner.rolcreatedb or owner.rolcreaterole or owner.rolreplication
            or exists(select 1 from pg_catalog.pg_roles elevated where (elevated.rolsuper or elevated.rolbypassrls
              or elevated.rolcreatedb or elevated.rolcreaterole or elevated.rolreplication) and pg_has_role(owner.oid,elevated.oid,'MEMBER'))
            or has_schema_privilege(owner.oid,'parameter_catalog','CREATE')
            or exists(select 1 from pg_catalog.pg_proc target join pg_catalog.pg_namespace tn on tn.oid=target.pronamespace
              where tn.nspname='parameter_catalog' and has_function_privilege(owner.oid,target.oid,'EXECUTE'))
            or exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace cn on cn.oid=c.relnamespace
              where cn.nspname='parameter_catalog' and c.relkind in ('r','p','v','m','f')
                and (has_table_privilege(owner.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                  or has_any_column_privilege(owner.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')))
            -- A low-privilege definer can delegate a capability outside Catalog.
            -- Compare effective privileges, not its SQL body or role's name.
            or has_database_privilege(owner.oid,current_database(),'CREATE')
            or exists(select 1 from pg_catalog.pg_namespace s where s.nspname not in ('pg_catalog','information_schema')
              and s.nspname !~ '^pg_(toast|temp)' and has_schema_privilege(owner.oid,s.oid,'CREATE'))
            or exists(select 1 from pg_catalog.pg_proc delegated where has_function_privilege(owner.oid,delegated.oid,'EXECUTE')
              and not has_function_privilege(session_user,delegated.oid,'EXECUTE'))
            or exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace s on s.oid=c.relnamespace
              where s.nspname not in ('pg_catalog','information_schema') and s.nspname !~ '^pg_(toast|temp)'
                and c.relkind in ('r','p','v','m','f','S') and case when c.relkind='S' then
                  exists(select 1 from unnest(array['SELECT','USAGE','UPDATE']) privilege where
                    has_sequence_privilege(owner.oid,c.oid,privilege) and not has_sequence_privilege(session_user,c.oid,privilege))
                else exists(select 1 from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privilege where
                    has_table_privilege(owner.oid,c.oid,privilege) and not has_table_privilege(session_user,c.oid,privilege))
                  or exists(select 1 from pg_catalog.pg_attribute a cross join unnest(array['SELECT','INSERT','UPDATE','REFERENCES']) privilege
                    where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
                      and has_column_privilege(owner.oid,c.oid,a.attnum,privilege)
                      and not has_column_privilege(session_user,c.oid,a.attnum,privilege)) end)))
      as safe`, [CATALOG_READER_ROLE, relations])).rows[0];
  if (row?.safe !== true) throw new ActivationRefusal("catalog-reader-login-required");
}
