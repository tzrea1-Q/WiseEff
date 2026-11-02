alter table parameter_catalog.organization_subject_registrations
  add column cascade_retired boolean not null default false;

create or replace view parameter_catalog.registration_effective_module as
select registration.organization_id, registration.id as registration_id,
       registration.subject_id,
       case when subject.owner_subject_id is null then placement.module_id else owner_placement.module_id end as module_id,
       owner_registration.id as via_owner_registration_id
from parameter_catalog.organization_subject_registrations registration
join parameter_catalog.catalog_subjects subject on subject.id = registration.subject_id
left join parameter_catalog.subject_placements placement
  on placement.id = registration.current_placement_id
 and placement.registration_id = registration.id
 and placement.organization_id = registration.organization_id
left join parameter_catalog.organization_subject_registrations owner_registration
  on owner_registration.organization_id = registration.organization_id
 and owner_registration.subject_id = subject.owner_subject_id
left join parameter_catalog.subject_placements owner_placement
  on owner_placement.id = owner_registration.current_placement_id
 and owner_placement.registration_id = owner_registration.id
 and owner_placement.organization_id = owner_registration.organization_id;

grant select (organization_id, registration_id, module_id)
  on parameter_catalog.registration_effective_module to wiseeff_mod_d02_source_reader;

create or replace function parameter_catalog.assert_subject_placement_kind()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, parameter_catalog
as $$
declare
  module_kind text;
  owner_id text;
begin
  if new.module_id is null then return null; end if;
  select module.kind, subject.owner_subject_id into module_kind, owner_id
  from parameter_catalog.organization_subject_registrations registration
  join parameter_catalog.catalog_subjects subject on subject.id = registration.subject_id
  join public.parameter_modules module
    on module.id = new.module_id and module.organization_id = new.organization_id
  where registration.id = new.registration_id and registration.organization_id = new.organization_id;
  if (owner_id is not null and not (tg_op = 'UPDATE' and old.module_id is not distinct from new.module_id
      and old.organization_id = new.organization_id and old.registration_id = new.registration_id))
    or module_kind is null or (module_kind not in ('business', 'unclassified')
    and not (tg_op = 'UPDATE' and old.module_id is not distinct from new.module_id
             and old.organization_id = new.organization_id and module_kind in ('driver-group', 'node-type'))) then
    raise exception using errcode = '23514',
      message = 'Subject placement kind does not match Catalog subject kind',
      constraint = 'subject_placement_kind_ck';
  end if;
  return null;
end;
$$;
