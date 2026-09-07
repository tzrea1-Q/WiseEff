-- PR #824: explicitly authorized additive Kernel read capability.
-- Historical 0138/0139 bytes and their ungranted-login negatives stay intact.
-- This migration grants no LOGIN membership. A controlled credential provisioner
-- must separately grant WITH INHERIT TRUE, SET FALSE, ADMIN FALSE on PG16.
-- Reuse across databases is permitted only after global attributes/capabilities
-- and this database's ACLs pass. Never normalize a contaminated existing role.
-- Other databases' ACLs are not observable here: this migration does not attest
-- them or authorize a login there. Their own migration/startup audits still apply.
do $$
declare
  reader oid;
begin
  if not exists (select 1 from pg_roles where rolname='catalog_runtime_reader_role') then
    begin
      create role catalog_runtime_reader_role
        nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
    exception when duplicate_object then
      -- A migrator in another database may have created the cluster role.
      -- The same mandatory audit below applies to the winner's actual object.
      null;
    end;
  end if;
  select oid into strict reader from pg_roles where rolname='catalog_runtime_reader_role';
  if exists (select 1 from pg_roles where oid=reader and
      (rolcanlogin or rolsuper or rolcreatedb or rolcreaterole or rolinherit or rolreplication or rolbypassrls))
    or exists (select 1 from pg_auth_members where member=reader
      or (roleid=reader and (admin_option or set_option or not inherit_option)))
    or exists (select 1 from pg_shdepend where refobjid=reader and deptype='o')
    or exists (select 1 from pg_db_role_setting where setrole=reader)
  then raise exception using errcode='42501', message='PCAT-READER-ROLE-CAPABILITY-DRIFT'; end if;

  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace,
      lateral aclexplode(c.relacl) acl
    where acl.grantee=reader and (n.nspname <> 'parameter_catalog'
      or c.relname not in ('catalog_state','catalog_releases','catalog_materializations',
        'catalog_release_subjects','catalog_subjects','catalog_release_subject_aliases',
        'catalog_subject_aliases','catalog_release_definition_heads','parameter_definitions','definition_revisions')
      or c.relkind not in ('r','p') or acl.privilege_type <> 'SELECT' or acl.is_grantable)
  ) or exists (
    select 1 from pg_attribute a, lateral aclexplode(a.attacl) acl where acl.grantee=reader
  ) or exists (
    select 1 from pg_proc p, lateral aclexplode(p.proacl) acl where acl.grantee=reader
  ) or exists (
    select 1 from pg_namespace n, lateral aclexplode(n.nspacl) acl
    where acl.grantee=reader and (n.nspname <> 'parameter_catalog' or acl.privilege_type <> 'USAGE' or acl.is_grantable)
  ) or exists (
    select 1 from pg_database d, lateral aclexplode(d.datacl) acl where acl.grantee=reader
  ) or exists (
    select 1 from pg_default_acl d left join lateral aclexplode(d.defaclacl) acl on true
    where d.defaclrole=reader or acl.grantee=reader
  ) or exists (
    select 1 from pg_parameter_acl p, lateral aclexplode(p.paracl) acl where acl.grantee=reader
  ) then raise exception using errcode='42501', message='PCAT-READER-ACL-DRIFT'; end if;

  -- PUBLIC must not bypass the exact Catalog object/capability contract.
  if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace,
      lateral aclexplode(c.relacl) acl where n.nspname='parameter_catalog' and acl.grantee=0)
    or exists (select 1 from pg_attribute a join pg_class c on c.oid=a.attrelid
      join pg_namespace n on n.oid=c.relnamespace, lateral aclexplode(a.attacl) acl
      where n.nspname='parameter_catalog' and acl.grantee=0)
    or exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
      lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
      where n.nspname='parameter_catalog' and acl.grantee=0)
    or exists (select 1 from pg_namespace n, lateral aclexplode(n.nspacl) acl
      where n.nspname='parameter_catalog' and acl.grantee=0)
    or exists (select 1 from pg_default_acl d, lateral aclexplode(d.defaclacl) acl
      where acl.grantee=0 and d.defaclnamespace in (0,'parameter_catalog'::regnamespace)
        and d.defaclrole in (current_user::regrole,'catalog_migration_owner'::regrole))
  then raise exception using errcode='42501', message='PCAT-READER-PUBLIC-DRIFT'; end if;
end;
$$;

grant usage on schema parameter_catalog to catalog_runtime_reader_role;
grant select on table
  parameter_catalog.catalog_state,
  parameter_catalog.catalog_releases,
  parameter_catalog.catalog_materializations,
  parameter_catalog.catalog_release_subjects,
  parameter_catalog.catalog_subjects,
  parameter_catalog.catalog_release_subject_aliases,
  parameter_catalog.catalog_subject_aliases,
  parameter_catalog.catalog_release_definition_heads,
  parameter_catalog.parameter_definitions,
  parameter_catalog.definition_revisions
to catalog_runtime_reader_role;

-- No EXECUTE, sequence, default ACL, ownership or other-domain privileges.
-- PUBLIC ACL remains as revoked by 0138 and 0139; deployment effective-capability
-- inspection remains mandatory and is not replaced by this grant declaration.
