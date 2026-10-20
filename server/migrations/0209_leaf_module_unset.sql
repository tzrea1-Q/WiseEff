-- Deleting taxonomy leaves removes attribution, never parameters or registrations.
-- Retained Catalog Placements keep their identity and can be placed again later.
alter table parameter_catalog.subject_placements alter column module_id drop not null;
alter table public.driver_registration_placements alter column driver_group_module_id drop not null;
alter table public.project_parameter_bindings alter column module_id drop not null;
-- Multiple retained bindings can become unset without merging their identities.
alter table public.project_parameter_bindings
  drop constraint project_parameter_bindings_project_node_spec_module_unique;
create unique index project_parameter_bindings_project_node_spec_module_unique
  on public.project_parameter_bindings (project_id, logical_node_id, parameter_spec_id, module_id)
  nulls not distinct where module_id is not null;

alter table parameter_catalog.subject_placements
  drop constraint subject_placements_module_id_organization_id_fkey,
  add constraint subject_placements_module_id_organization_id_fkey
    foreign key (module_id, organization_id)
    references public.parameter_modules(id, organization_id)
    on delete set null (module_id);

alter table public.parameter_definitions
  drop constraint parameter_definitions_parameter_module_id_fkey,
  add constraint parameter_definitions_parameter_module_id_fkey
    foreign key (parameter_module_id) references public.parameter_modules(id) on delete set null;
alter table public.project_parameter_bindings
  drop constraint project_parameter_bindings_module_id_fkey,
  add constraint project_parameter_bindings_module_id_fkey
    foreign key (module_id) references public.parameter_modules(id) on delete set null;
alter table public.project_modules
  drop constraint project_modules_parameter_module_id_fkey,
  add constraint project_modules_parameter_module_id_fkey
    foreign key (parameter_module_id) references public.parameter_modules(id) on delete set null,
  drop constraint project_modules_parent_id_fkey,
  add constraint project_modules_parent_id_fkey
    foreign key (parent_id) references public.parameter_modules(id) on delete set null;
alter table public.project_parameter_files
  drop constraint project_parameter_files_module_hint_fkey,
  add constraint project_parameter_files_module_hint_fkey
    foreign key (module_hint) references public.parameter_modules(id) on delete set null;
alter table public.driver_registrations
  drop constraint driver_registrations_default_business_category_module_id_fkey,
  add constraint driver_registrations_default_business_category_module_id_fkey
    foreign key (default_business_category_module_id) references public.parameter_modules(id) on delete set null;
alter table public.driver_registration_placements
  drop constraint driver_registration_placements_driver_group_module_id_fkey,
  add constraint driver_registration_placements_driver_group_module_id_fkey
    foreign key (driver_group_module_id) references public.parameter_modules(id) on delete set null,
  drop constraint driver_registration_placement_default_business_category_mo_fkey,
  add constraint driver_placement_default_category_fkey
    foreign key (default_business_category_module_id) references public.parameter_modules(id) on delete set null;

create or replace function parameter_catalog.assert_subject_placement_kind()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, parameter_catalog
as $$
declare
  subject_kind text;
  module_kind text;
begin
  if new.module_id is null then return null; end if;
  select subject.kind, module.kind into subject_kind, module_kind
  from parameter_catalog.organization_subject_registrations registration
  join parameter_catalog.catalog_subjects subject on subject.id = registration.subject_id
  join public.parameter_modules module
    on module.id = new.module_id and module.organization_id = new.organization_id
  where registration.id = new.registration_id and registration.organization_id = new.organization_id;
  if subject_kind is null
     or (subject_kind = 'driver' and module_kind <> 'driver-group')
     or (subject_kind = 'node-type' and module_kind <> 'node-type')
     or (subject_kind = 'configuration-schema' and module_kind <> 'business') then
    raise exception using errcode = '23514',
      message = 'Subject placement kind does not match Catalog subject kind',
      constraint = 'subject_placement_kind_ck';
  end if;
  return null;
end;
$$;

create function parameter_catalog.refresh_detached_placement()
returns trigger language plpgsql set search_path = pg_catalog, parameter_catalog as $$
begin
  new.updated_at := clock_timestamp();
  new.origin := 'curated';
  return new;
end;
$$;
alter function parameter_catalog.refresh_detached_placement() owner to catalog_migration_owner;
revoke all on function parameter_catalog.refresh_detached_placement() from public;
create trigger subject_placement_detached_version
before update of module_id on parameter_catalog.subject_placements
for each row when (old.module_id is not null and new.module_id is null)
execute function parameter_catalog.refresh_detached_placement();

create function public.clear_deleted_parameter_module_label()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  new.module := 'unset';
  return new;
end;
$$;
revoke all on function public.clear_deleted_parameter_module_label() from public;
create trigger parameter_definition_detached_module_label
before update of parameter_module_id on public.parameter_definitions
for each row when (old.parameter_module_id is not null and new.parameter_module_id is null)
execute function public.clear_deleted_parameter_module_label();
