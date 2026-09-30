-- Complete retained historical identities, not Discovery counts or Review Items.
-- Opt-in maintenance capability: all organizations, one explicitly supplied ID per call.
-- No LOGIN membership is assigned; ordinary API and MOD D02 logins are unchanged.
select pg_catalog.pg_advisory_xact_lock(8970182::bigint);

do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'catalog_legacy_identity_reader_role') then
    create role catalog_legacy_identity_reader_role nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  elsif exists (
    select 1 from pg_catalog.pg_roles where rolname = 'catalog_legacy_identity_reader_role'
      and (rolcanlogin or rolinherit or rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls)
  ) then
    raise exception 'Historical identity reader role attributes do not match the read-only capability';
  end if;
  if exists (
    select 1 from pg_catalog.pg_auth_members
     where member = 'catalog_legacy_identity_reader_role'::regrole
        or roleid = 'catalog_legacy_identity_reader_role'::regrole
  ) or exists (
    select 1 from pg_catalog.pg_class relation
      left join lateral pg_catalog.aclexplode(relation.relacl) acl on true
     where relation.relowner = 'catalog_legacy_identity_reader_role'::regrole
        or acl.grantee = 'catalog_legacy_identity_reader_role'::regrole
  ) or exists (
    select 1 from pg_catalog.pg_attribute attribute,
      lateral pg_catalog.aclexplode(attribute.attacl) acl
     where acl.grantee = 'catalog_legacy_identity_reader_role'::regrole
  ) or exists (
    select 1 from pg_catalog.pg_proc function_row
      left join lateral pg_catalog.aclexplode(function_row.proacl) acl on true
     where function_row.proowner = 'catalog_legacy_identity_reader_role'::regrole
        or acl.grantee = 'catalog_legacy_identity_reader_role'::regrole
  ) or exists (
    select 1 from pg_catalog.pg_namespace namespace_row
      left join lateral pg_catalog.aclexplode(namespace_row.nspacl) acl on true
     where namespace_row.nspowner = 'catalog_legacy_identity_reader_role'::regrole
        or (acl.grantee = 'catalog_legacy_identity_reader_role'::regrole
            and (namespace_row.nspname <> 'parameter_catalog' or acl.privilege_type <> 'USAGE'))
  ) or exists (
    select 1 from pg_catalog.pg_database database_row
      left join lateral pg_catalog.aclexplode(database_row.datacl) acl on true
     where database_row.datname = pg_catalog.current_database()
       and (database_row.datdba = 'catalog_legacy_identity_reader_role'::regrole
            or acl.grantee = 'catalog_legacy_identity_reader_role'::regrole)
  ) or exists (
    select 1 from pg_catalog.pg_default_acl default_row,
      lateral pg_catalog.aclexplode(default_row.defaclacl) acl
     where acl.grantee = 'catalog_legacy_identity_reader_role'::regrole
  ) then
    raise exception 'Historical identity reader has unapproved pre-existing capabilities';
  end if;
end;
$$;

create function parameter_catalog.list_retained_dismissed_compatible_identities(requested_organization_id text)
returns table (organization_id text, id text, compatible text)
language plpgsql stable security definer
set search_path = pg_catalog, parameter_catalog
as $$
begin
  if requested_organization_id is null or pg_catalog.btrim(requested_organization_id) = '' then
    raise exception 'A nonempty organization ID is required' using errcode = '22023';
  end if;
  return query
    select historical.organization_id, historical.id, historical.compatible
      from public.parameter_module_dismissed_compatibles historical
     where historical.organization_id = requested_organization_id
     order by historical.id collate "C";
end;
$$;

-- 0138 already grants the historical identity owner source SELECT. Consumers
-- receive only this projection, without direct legacy table reads or writes.
alter function parameter_catalog.list_retained_dismissed_compatible_identities(text) owner to catalog_migration_owner;
revoke all on function parameter_catalog.list_retained_dismissed_compatible_identities(text) from public;
grant usage on schema parameter_catalog to catalog_legacy_identity_reader_role;
grant execute on function parameter_catalog.list_retained_dismissed_compatible_identities(text) to catalog_legacy_identity_reader_role;
comment on function parameter_catalog.list_retained_dismissed_compatible_identities(text) is
  '0137 parameter-module-dismissed-compatible identity: original row ID, organization owner and unmodified compatible; complete C-ordered retained inventory. Not historical event enumeration.';
