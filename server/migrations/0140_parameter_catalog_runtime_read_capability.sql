-- Management-only preparation for distinct runtime reader and governance logins.
-- This grants no LOGIN, password, Catalog DML, writer membership, or owner membership.
do $$
declare
  reader_oid oid;
  target_database_oid oid;
begin
  select oid into reader_oid from pg_catalog.pg_roles where rolname='catalog_runtime_reader_role';
  if reader_oid is null then
    create role catalog_runtime_reader_role nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
    select oid into reader_oid from pg_catalog.pg_roles where rolname='catalog_runtime_reader_role';
  end if;
  select oid into target_database_oid from pg_catalog.pg_database where datname=pg_catalog.current_database();
  if exists (select 1 from pg_catalog.pg_roles where oid=reader_oid
      and (rolcanlogin or rolsuper or rolcreatedb or rolcreaterole or rolinherit or rolreplication or rolbypassrls))
    or exists (select 1 from pg_catalog.pg_auth_members where member=reader_oid) then
    raise exception using errcode='55000', message='PCAT_RUNTIME_READER_ROLE_UNSAFE';
  end if;
  -- Explicit ACLs and ownership in this database only. PUBLIC defaults are not
  -- role-owned grants; pg_control_system's PUBLIC grant is narrowed below.
  -- Never rewrite privileges belonging to the same role in another database.
  if exists (
    select 1 from pg_catalog.pg_class relation
    cross join lateral pg_catalog.aclexplode(relation.relacl) acl
    where acl.grantee=reader_oid and (
      acl.privilege_type <> 'SELECT' or acl.is_grantable or relation.oid not in (
        'parameter_catalog.catalog_releases'::regclass, 'parameter_catalog.catalog_subjects'::regclass,
        'parameter_catalog.catalog_drivers'::regclass, 'parameter_catalog.catalog_node_types'::regclass,
        'parameter_catalog.catalog_release_subjects'::regclass, 'parameter_catalog.catalog_subject_aliases'::regclass,
        'parameter_catalog.catalog_release_subject_aliases'::regclass, 'parameter_catalog.parameter_definitions'::regclass,
        'parameter_catalog.definition_revisions'::regclass, 'parameter_catalog.catalog_release_definition_heads'::regclass,
        'parameter_catalog.catalog_materializations'::regclass, 'parameter_catalog.catalog_state'::regclass))
  ) or exists (
    select 1 from pg_catalog.pg_attribute attribute
    cross join lateral pg_catalog.aclexplode(attribute.attacl) acl where acl.grantee=reader_oid
  ) or exists (
    select 1 from pg_catalog.pg_namespace namespace
    cross join lateral pg_catalog.aclexplode(namespace.nspacl) acl
    where acl.grantee=reader_oid and (namespace.nspname <> 'parameter_catalog' or acl.privilege_type <> 'USAGE' or acl.is_grantable)
  ) or exists (
    select 1 from pg_catalog.pg_database database
    cross join lateral pg_catalog.aclexplode(database.datacl) acl
    where database.oid=target_database_oid and acl.grantee=reader_oid
      and (acl.privilege_type <> 'CONNECT' or acl.is_grantable)
  ) or exists (
    select 1 from pg_catalog.pg_proc routine
    cross join lateral pg_catalog.aclexplode(routine.proacl) acl
    where acl.grantee=reader_oid and (acl.is_grantable or routine.oid is distinct from pg_catalog.to_regprocedure('parameter_catalog.runtime_database_identity()')
      and routine.oid is distinct from pg_catalog.to_regprocedure('parameter_catalog.read_proposal_success_audit(text,text,text,text)'))
  ) or exists (
    select 1 from pg_catalog.pg_default_acl defaults
    cross join lateral pg_catalog.aclexplode(defaults.defaclacl) acl where acl.grantee=reader_oid
  ) or exists (
    select 1 from (
      select typacl as acl from pg_catalog.pg_type
      union all select lomacl from pg_catalog.pg_largeobject_metadata
      union all select srvacl from pg_catalog.pg_foreign_server
      union all select fdwacl from pg_catalog.pg_foreign_data_wrapper
      union all select lanacl from pg_catalog.pg_language
      union all select spcacl from pg_catalog.pg_tablespace
      union all select paracl from pg_catalog.pg_parameter_acl
    ) object_acl cross join lateral pg_catalog.aclexplode(object_acl.acl) acl
    where acl.grantee=reader_oid
  ) or exists (
    select 1 from pg_catalog.pg_shdepend dependency
    where dependency.refclassid='pg_catalog.pg_authid'::regclass and dependency.refobjid=reader_oid
      and dependency.deptype='o' and (dependency.dbid=target_database_oid
        or dependency.classid='pg_catalog.pg_database'::regclass and dependency.objid=target_database_oid)
  ) then
    raise exception using errcode='55000', message='PCAT_RUNTIME_READER_ACL_UNSAFE';
  end if;
end;
$$;

grant usage on schema parameter_catalog to catalog_runtime_reader_role;
grant select on table
  parameter_catalog.catalog_releases, parameter_catalog.catalog_subjects,
  parameter_catalog.catalog_drivers, parameter_catalog.catalog_node_types,
  parameter_catalog.catalog_release_subjects, parameter_catalog.catalog_subject_aliases,
  parameter_catalog.catalog_release_subject_aliases, parameter_catalog.parameter_definitions,
  parameter_catalog.definition_revisions, parameter_catalog.catalog_release_definition_heads,
  parameter_catalog.catalog_materializations, parameter_catalog.catalog_state
to catalog_runtime_reader_role;

-- The system identifier is read by the protected owner, never directly by app logins.
-- PostgreSQL 16 exposes this function to PUBLIC by default. This ACL change is
-- local to the managed database; restore capability receipts must preserve it.
revoke execute on function pg_catalog.pg_control_system() from public;
grant execute on function pg_catalog.pg_control_system() to catalog_migration_owner;
create function parameter_catalog.runtime_database_identity() returns text
language sql stable security definer set search_path = pg_catalog
as $$
  select control.system_identifier::text || ':' || database.oid::text
  from pg_catalog.pg_control_system() control cross join pg_catalog.pg_database database
  where database.datname=pg_catalog.current_database()
$$;
alter function parameter_catalog.runtime_database_identity() owner to catalog_migration_owner;
revoke all on function parameter_catalog.runtime_database_identity() from public;
grant execute on function parameter_catalog.runtime_database_identity()
  to catalog_runtime_reader_role, parameter_governance_writer_role;

-- Exact replay lookup. Organization authorization remains with the authenticated
-- domain adapter; this function does not claim a per-user PostgreSQL identity.
create function parameter_catalog.read_proposal_success_audit(text,text,text,text) returns jsonb
language sql stable security definer set search_path = pg_catalog
as $$
  select pg_catalog.jsonb_build_object('resultSnapshot', event.metadata->'resultSnapshot') from public.audit_events event
  where event.organization_id=$1 and event.kind='definition-proposal'
    and event.action=$2 and event.trace_id=$3 and event.target_id=$4
    and event.severity='info'
    and event.action in ('proposal-create-draft', 'proposal-submit-existing', 'proposal-submit',
      'proposal-withdraw', 'proposal-accept', 'proposal-reject')
    and pg_catalog.jsonb_typeof(event.metadata->'resultSnapshot')='object'
  order by event.created_at asc limit 1
$$;
alter function parameter_catalog.read_proposal_success_audit(text,text,text,text) owner to catalog_migration_owner;
revoke all on function parameter_catalog.read_proposal_success_audit(text,text,text,text) from public;
grant execute on function parameter_catalog.read_proposal_success_audit(text,text,text,text) to catalog_runtime_reader_role;

-- Keep the destination row lock in the governance writer transaction. The
-- existing owner has the bounded SELECT/UPDATE needed for FOR SHARE (0138).
create function parameter_catalog.lock_governance_destination_module(text,text)
returns table(id text,organization_id text,parent_id text,kind text)
language sql volatile security definer set search_path = pg_catalog
as $$
  select module.id, module.organization_id, module.parent_id, module.kind::text
  from public.parameter_modules module where module.organization_id=$1 and module.id=$2
  for share
$$;
alter function parameter_catalog.lock_governance_destination_module(text,text) owner to catalog_migration_owner;
revoke all on function parameter_catalog.lock_governance_destination_module(text,text) from public;
grant execute on function parameter_catalog.lock_governance_destination_module(text,text) to parameter_governance_writer_role;
