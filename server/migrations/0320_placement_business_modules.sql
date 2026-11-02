alter table parameter_catalog.subject_placements
  drop constraint subject_placements_organization_id_module_id_key;

create index subject_placements_organization_id_module_id_idx
  on parameter_catalog.subject_placements (organization_id, module_id);

create or replace function parameter_catalog.assert_subject_placement_kind()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, parameter_catalog
as $$
declare
  module_kind text;
begin
  if new.module_id is null then return null; end if;
  select module.kind into module_kind
  from parameter_catalog.organization_subject_registrations registration
  join public.parameter_modules module
    on module.id = new.module_id and module.organization_id = new.organization_id
  where registration.id = new.registration_id and registration.organization_id = new.organization_id;
  if module_kind is null or (module_kind not in ('business', 'unclassified')
    and not (tg_op = 'UPDATE' and old.module_id is not distinct from new.module_id
             and old.organization_id = new.organization_id and module_kind in ('driver-group', 'node-type'))) then
    raise exception using errcode = '23514',
      message = 'Subject placement kind does not match Catalog subject kind',
      constraint = 'subject_placement_kind_ck';
  end if;
  return null;
end;
$$;

create or replace function parameter_catalog.assert_parameter_module_placement_kind()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, parameter_catalog
as $$
begin
  if new.kind not in ('business', 'unclassified') and new.kind is distinct from old.kind
     and exists (select 1 from parameter_catalog.subject_placements placement
                 where placement.module_id = new.id and placement.organization_id = new.organization_id) then
    raise exception using errcode = '23514',
      message = 'Parameter module kind does not match its retained Catalog Subject placement',
      constraint = 'subject_placement_kind_ck';
  end if;
  return null;
end;
$$;
