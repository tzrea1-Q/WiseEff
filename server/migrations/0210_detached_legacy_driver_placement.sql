-- Retain legacy registration metadata when its module becomes unset.
create or replace function public.wiseeff_guard_driver_registration_placement()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
declare
  subject_kind text;
  subject_organization_id text;
begin
  select asub.subject_kind, asub.organization_id into subject_kind, subject_organization_id
  from public.attribution_subjects asub where asub.id = new.attribution_subject_id;
  if subject_kind is distinct from 'driver-registration'
     or (subject_organization_id is not null and subject_organization_id <> new.organization_id) then
    raise exception 'driver registration placement % has an invalid subject owner or kind', new.id using errcode = '23514';
  end if;
  if new.driver_group_module_id is not null and not exists (
    select 1 from public.parameter_modules pm
    join public.driver_registrations dr on dr.attribution_subject_id = pm.attribution_subject_id
    where pm.id = new.driver_group_module_id and pm.organization_id = new.organization_id
      and pm.kind = 'driver-group' and pm.attribution_subject_id = new.attribution_subject_id
  ) then
    raise exception 'driver registration placement % must reference an organization driver-group with the same subject', new.id using errcode = '23514';
  end if;
  if new.default_business_category_module_id is not null and not exists (
    select 1 from public.parameter_modules pm where pm.id = new.default_business_category_module_id
      and pm.organization_id = new.organization_id and pm.kind = 'business'
  ) then
    raise exception 'driver registration placement % default must be an organization business module', new.id using errcode = '23514';
  end if;
  return new;
end;
$$;
