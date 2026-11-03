-- Export baselines are server-generated organization state. Application roles
-- can insert and read them, but cannot rewrite or remove an existing baseline.
create table parameter_catalog.module_structure_created_refs (
  organization_id text not null references public.organizations(id) on delete restrict,
  source_organization_id text not null,
  export_id text not null,
  package_ref text not null,
  module_id text not null,
  initial_snapshot jsonb not null check (jsonb_typeof(initial_snapshot) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  primary key (organization_id, source_organization_id, export_id, package_ref),
  unique (organization_id, module_id)
);
alter table parameter_catalog.module_structure_created_refs owner to catalog_migration_owner;

do $$
declare app_grant record;
begin
  for app_grant in
    select distinct grantee from information_schema.role_table_grants
    where table_schema = 'parameter_catalog' and table_name = 'subject_placements'
      and privilege_type = 'INSERT' and grantee <> 'PUBLIC'
  loop
    execute format('grant select, insert on parameter_catalog.module_structure_created_refs to %I', app_grant.grantee);
  end loop;
end;
$$;
grant select, delete on parameter_catalog.module_structure_created_refs to catalog_migration_owner;

create trigger organization_lifecycle_guard before insert or update or delete
  on parameter_catalog.module_structure_created_refs
  for each row execute function public.guard_organization_lifecycle();

do $$ declare installed text; changed text; begin
  select pg_get_functiondef('parameter_catalog.preview_organization_deletion_0276(text,text)'::regprocedure) into strict installed;
  changed:=replace(installed, '(''parameter_catalog.module_structure_migration_map'',''organization-parameters'',''r.organization_id=$1'')',
    '(''parameter_catalog.module_structure_created_refs'',''organization-parameters'',''r.organization_id=$1''),'
    || '(''parameter_catalog.module_structure_migration_map'',''organization-parameters'',''r.organization_id=$1'')');
  if changed=installed then raise exception 'Module mapping inventory seam missing'; end if; execute changed;

  select pg_get_functiondef('parameter_catalog.purge_organization_parameter_assets(text,text,text)'::regprocedure) into strict installed;
  changed:=replace(installed, '  -- Fixed ownership closure, never recursive FK discovery or arbitrary tables.',
    '  lock table parameter_catalog.module_structure_created_refs in share row exclusive mode;'
    || E'\n  -- Fixed ownership closure, never recursive FK discovery or arbitrary tables.');
  if changed=installed then raise exception 'Module mapping lock seam missing'; end if; installed:=changed;
  changed:=replace(installed, '(''parameter_catalog.module_structure_migration_map'',''organization_id=$1'')',
    '(''parameter_catalog.module_structure_created_refs'',''organization_id=$1''),'
    || '(''parameter_catalog.module_structure_migration_map'',''organization_id=$1'')');
  if changed=installed then raise exception 'Module mapping purge seam missing'; end if; execute changed;

  select pg_get_functiondef('public.guard_organization_lifecycle()'::regprocedure) into strict installed;
  changed:=replace(installed, '''module_structure_migration_map'',',
    '''module_structure_migration_map'',''module_structure_created_refs'',');
  if changed=installed then raise exception 'Module mapping lifecycle seam missing'; end if; execute changed;
end $$;
