alter table public.parameter_modules add column archived_at timestamptz;
grant select (archived_at) on public.parameter_modules to wiseeff_mod_d02_source_reader;

alter table parameter_catalog.organization_subject_registrations
  add column display_alias text,
  add constraint registration_display_alias_ck check (
    display_alias is null or (display_alias <> '' and btrim(display_alias) = display_alias
      and char_length(display_alias) <= 128 and display_alias !~ '[[:cntrl:]]')
  );
grant select (display_alias) on parameter_catalog.organization_subject_registrations to wiseeff_mod_d02_source_reader;

create table parameter_catalog.module_structure_migration_map (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  organization_id text not null references public.organizations(id) on delete restrict,
  module_id text not null,
  registration_id text,
  action text not null,
  from_module_id text,
  to_module_id text,
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (module_id, organization_id) references public.parameter_modules(id, organization_id) on delete restrict,
  foreign key (registration_id, organization_id) references parameter_catalog.organization_subject_registrations(id, organization_id) on delete restrict
);
alter table parameter_catalog.module_structure_migration_map owner to catalog_migration_owner;

do $$
declare app_grant record;
begin
  for app_grant in
    select grantee, privilege_type from information_schema.role_table_grants
    where table_schema = 'parameter_catalog' and table_name = 'subject_placements'
      and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
  loop
    execute format('grant %s on parameter_catalog.module_structure_migration_map to %I', app_grant.privilege_type, app_grant.grantee);
  end loop;
end;
$$;

grant select, delete on parameter_catalog.module_structure_migration_map to catalog_migration_owner;

create trigger organization_lifecycle_guard before insert or update or delete
  on parameter_catalog.module_structure_migration_map
  for each row execute function public.guard_organization_lifecycle();

do $$ declare installed text; changed text; begin
  select pg_get_functiondef('parameter_catalog.preview_organization_deletion_0276(text,text)'::regprocedure) into strict installed;
  changed:=replace(installed, '(''public.registration_recognition_migration_map'',''organization-parameters'',''r.organization_id=$1'')',
    '(''parameter_catalog.module_structure_migration_map'',''organization-parameters'',''r.organization_id=$1''),'
    || '(''public.registration_recognition_migration_map'',''organization-parameters'',''r.organization_id=$1'')');
  if changed=installed then raise exception 'Module migration inventory seam missing'; end if; execute changed;

  select pg_get_functiondef('parameter_catalog.purge_organization_parameter_assets(text,text,text)'::regprocedure) into strict installed;
  changed:=replace(installed, '  -- Fixed ownership closure, never recursive FK discovery or arbitrary tables.',
    '  lock table parameter_catalog.module_structure_migration_map in share row exclusive mode;'
    || E'\n  -- Fixed ownership closure, never recursive FK discovery or arbitrary tables.');
  if changed=installed then raise exception 'Module migration lock seam missing'; end if; installed:=changed;
  changed:=replace(installed, '(''public.registration_recognition_migration_map'',''organization_id=$1'')',
    '(''parameter_catalog.module_structure_migration_map'',''organization_id=$1''),'
    || '(''public.registration_recognition_migration_map'',''organization_id=$1'')');
  if changed=installed then raise exception 'Module migration purge seam missing'; end if; execute changed;

  select pg_get_functiondef('public.guard_organization_lifecycle()'::regprocedure) into strict installed;
  changed:=replace(installed, '''organization_subject_registrations'',''subject_placements'',',
    '''organization_subject_registrations'',''subject_placements'',''module_structure_migration_map'',');
  if changed=installed then raise exception 'Module migration lifecycle seam missing'; end if; execute changed;
end $$;

create or replace function parameter_catalog.assert_subject_placement_kind()
returns trigger language plpgsql security definer
set search_path = pg_catalog, parameter_catalog as $$
declare module_kind text; owner_id text; module_archived_at timestamptz;
begin
  if new.module_id is null then return null; end if;
  select module.kind, subject.owner_subject_id, module.archived_at into module_kind, owner_id, module_archived_at
  from parameter_catalog.organization_subject_registrations registration
  join parameter_catalog.catalog_subjects subject on subject.id = registration.subject_id
  join public.parameter_modules module on module.id = new.module_id and module.organization_id = new.organization_id
  where registration.id = new.registration_id and registration.organization_id = new.organization_id;
  if module_archived_at is not null or
    (owner_id is not null and not (tg_op = 'UPDATE' and old.module_id is not distinct from new.module_id
      and old.organization_id = new.organization_id and old.registration_id = new.registration_id))
    or module_kind is null or (module_kind not in ('business', 'unclassified')
    and not (tg_op = 'UPDATE' and old.module_id is not distinct from new.module_id
      and old.organization_id = new.organization_id and module_kind in ('driver-group', 'node-type'))) then
    raise exception using errcode = '23514', message = 'Subject placement kind does not match Catalog subject kind',
      constraint = 'subject_placement_kind_ck';
  end if;
  return null;
end;
$$;

create function parameter_catalog.assert_active_module_parent()
returns trigger language plpgsql security definer
set search_path = pg_catalog, parameter_catalog as $$
begin
  if new.parent_id is not null then
    perform 1 from public.parameter_modules
      where id = new.parent_id and organization_id = new.organization_id and archived_at is null for share;
    if not found then
      raise exception using errcode = '23514', message = 'Module parent is unavailable',
        constraint = 'parameter_module_active_parent_ck';
    end if;
  end if;
  return new;
end;
$$;

alter function parameter_catalog.assert_active_module_parent() owner to catalog_migration_owner;
revoke all on function parameter_catalog.assert_active_module_parent() from public;

create trigger parameter_module_active_parent
before insert or update of parent_id, organization_id on public.parameter_modules
for each row execute function parameter_catalog.assert_active_module_parent();
