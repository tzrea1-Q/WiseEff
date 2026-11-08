-- Durable identity allocation for the publication stage of a structure import.
-- Catalog activation remains owned by the existing publication manager.
create table parameter_catalog.module_structure_driver_publications (
  organization_id text not null references public.organizations(id) on delete restrict,
  export_id text not null,
  declarations_digest text not null,
  declarations jsonb not null check (jsonb_typeof(declarations) = 'array'),
  candidate_id text not null references catalog_publication.candidates(id) on delete restrict,
  job_id text not null references catalog_publication.publication_jobs(id) on delete restrict,
  allocated_subjects jsonb not null check (jsonb_typeof(allocated_subjects) = 'object'),
  applied_receipt jsonb check (jsonb_typeof(applied_receipt) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  primary key (organization_id, export_id)
);
alter table parameter_catalog.module_structure_driver_publications owner to catalog_migration_owner;
do $$ declare app_grant record; begin
  for app_grant in select distinct grantee from information_schema.role_table_grants
    where table_schema='parameter_catalog' and table_name='subject_placements'
      and privilege_type='INSERT' and grantee<>'PUBLIC'
  loop
    execute format('grant select, insert on parameter_catalog.module_structure_driver_publications to %I', app_grant.grantee);
    execute format('grant update (candidate_id,job_id,allocated_subjects,applied_receipt) on parameter_catalog.module_structure_driver_publications to %I', app_grant.grantee);
  end loop;
end $$;
grant select, delete on parameter_catalog.module_structure_driver_publications to catalog_migration_owner;
create trigger organization_lifecycle_guard before insert or update or delete
  on parameter_catalog.module_structure_driver_publications
  for each row execute function public.guard_organization_lifecycle();
do $$ declare installed text; changed text; begin
  select pg_get_functiondef('parameter_catalog.preview_organization_deletion_0276(text,text)'::regprocedure) into strict installed;
  changed:=replace(installed, '(''parameter_catalog.module_structure_migration_map'',''organization-parameters'',''r.organization_id=$1'')',
    '(''parameter_catalog.module_structure_driver_publications'',''organization-parameters'',''r.organization_id=$1''),'
    || '(''parameter_catalog.module_structure_migration_map'',''organization-parameters'',''r.organization_id=$1'')');
  if changed=installed then raise exception 'Driver publication inventory seam missing'; end if; execute changed;
  select pg_get_functiondef('parameter_catalog.purge_organization_parameter_assets(text,text,text)'::regprocedure) into strict installed;
  changed:=replace(installed, '  -- Fixed ownership closure, never recursive FK discovery or arbitrary tables.',
    '  lock table parameter_catalog.module_structure_driver_publications in share row exclusive mode;'
    || E'\n  -- Fixed ownership closure, never recursive FK discovery or arbitrary tables.');
  if changed=installed then raise exception 'Driver publication lock seam missing'; end if; installed:=changed;
  changed:=replace(installed, '(''parameter_catalog.module_structure_migration_map'',''organization_id=$1'')',
    '(''parameter_catalog.module_structure_driver_publications'',''organization_id=$1''),'
    || '(''parameter_catalog.module_structure_migration_map'',''organization_id=$1'')');
  if changed=installed then raise exception 'Driver publication purge seam missing'; end if; execute changed;
  select pg_get_functiondef('public.guard_organization_lifecycle()'::regprocedure) into strict installed;
  changed:=replace(installed, '''module_structure_migration_map'',',
    '''module_structure_migration_map'',''module_structure_driver_publications'',');
  if changed=installed then raise exception 'Driver publication lifecycle seam missing'; end if; execute changed;
end $$;
