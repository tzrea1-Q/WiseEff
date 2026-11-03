-- Read-only inventory for the existing FK detachments; callers retain their own table privileges.
create function parameter_catalog.module_deletion_references(p_organization_id text, p_module_ids text[])
returns table(module_id text, kind text, id text)
language sql stable security invoker set search_path = pg_catalog as $$
  select m.id, refs.kind, refs.id
  from public.parameter_modules m cross join lateral (
    select 'definitions' as kind,id::text from public.parameter_definitions where parameter_module_id=m.id
    union all select 'bindings',id::text from public.project_parameter_bindings where module_id=m.id
    union all select 'project modules',id::text from public.project_modules where parameter_module_id=m.id or parent_id=m.id
    union all select 'project files',id::text from public.project_parameter_files where module_hint=m.id
    union all select 'driver registrations',id::text from public.driver_registrations where default_business_category_module_id=m.id
    union all select 'driver placements',id::text from public.driver_registration_placements where driver_group_module_id=m.id or default_business_category_module_id=m.id
  ) refs where m.organization_id=p_organization_id and m.id=any(p_module_ids) order by 1,2,3
$$;
alter function parameter_catalog.module_deletion_references(text,text[]) owner to catalog_migration_owner;
revoke all on function parameter_catalog.module_deletion_references(text,text[]) from public;
do $$
declare app_grant record;
begin
  for app_grant in select distinct grants.grantee from information_schema.role_table_grants grants
    join pg_catalog.pg_roles role on role.rolname=grants.grantee and role.rolcanlogin
    where grants.table_schema='parameter_catalog' and grants.table_name='subject_placements' and grants.privilege_type='INSERT'
  loop
    execute format('grant execute on function parameter_catalog.module_deletion_references(text,text[]) to %I', app_grant.grantee);
  end loop;
end $$;
