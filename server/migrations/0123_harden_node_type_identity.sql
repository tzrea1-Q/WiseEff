-- Issue #649 follow-up: refuse blank node-type taxonomy names.
--
-- 0122 corrected legacy nodetype subjects, but databases that had an empty
-- source-key suffix and empty display name could still receive an empty
-- `bare_node_name`. Repair only from trusted subject metadata; if neither
-- source nor display metadata yields a name, fail closed for operator review.

update node_type_definitions ntd
set bare_node_name = coalesce(
  nullif(btrim(regexp_replace(lower(asub.source_key), '^nodetype:', '')), ''),
  nullif(btrim(asub.display_name), '')
)
from attribution_subjects asub
where asub.id = ntd.attribution_subject_id
  and btrim(ntd.bare_node_name) = ''
  and coalesce(
    nullif(btrim(regexp_replace(lower(asub.source_key), '^nodetype:', '')), ''),
    nullif(btrim(asub.display_name), '')
  ) is not null;

do $$
declare
  invalid_count integer;
  sample text;
begin
  select count(*)::integer
    into invalid_count
  from node_type_definitions ntd
  where btrim(ntd.bare_node_name) = '';

  if invalid_count > 0 then
    select string_agg(
      format('%s (%s)', ntd.attribution_subject_id, asub.source_key),
      ', ' order by ntd.attribution_subject_id
    )
      into sample
    from node_type_definitions ntd
    inner join attribution_subjects asub on asub.id = ntd.attribution_subject_id
    where btrim(ntd.bare_node_name) = ''
    limit 20;

    raise exception
      '0123_harden_node_type_identity: refuse to proceed; % node-type taxonomy rows have no non-empty bare_node_name. DETAIL: %',
      invalid_count,
      coalesce(sample, '(none)');
  end if;
end $$;

alter table node_type_definitions
  drop constraint if exists node_type_definitions_bare_node_name_check;

alter table node_type_definitions
  add constraint node_type_definitions_bare_node_name_check
  check (btrim(bare_node_name) <> '');

-- Serialize DriverSchema version selection with reconciliation. The apply path
-- records an exact active version/fingerprint; every writer takes the same
-- transaction advisory lock before changing that version set.
create or replace function wiseeff_lock_driver_schema_version_mutation()
returns trigger
language plpgsql
as $$
begin
  perform pg_advisory_xact_lock(hashtext(new.driver_schema_id));
  return new;
end;
$$;

drop trigger if exists wiseeff_driver_schema_version_mutation_lock
  on driver_schema_versions;
create trigger wiseeff_driver_schema_version_mutation_lock
before insert or update on driver_schema_versions
for each row execute function wiseeff_lock_driver_schema_version_mutation();

-- Placement rows are organization-owned declarations. Platform subjects may be
-- placed by many tenants; an organization-owned subject may only be placed by
-- its own tenant, and the subject must remain a DriverRegistration.
create or replace function wiseeff_guard_driver_registration_placement()
returns trigger
language plpgsql
as $$
declare
  subject_kind text;
  subject_organization_id text;
begin
  select asub.subject_kind, asub.organization_id
    into subject_kind, subject_organization_id
  from attribution_subjects asub
  where asub.id = new.attribution_subject_id;

  if subject_kind is distinct from 'driver-registration'
     or (subject_organization_id is not null and subject_organization_id <> new.organization_id) then
    raise exception 'driver registration placement % has an invalid subject owner or kind', new.id
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from parameter_modules pm
    inner join driver_registrations dr
      on dr.attribution_subject_id = pm.attribution_subject_id
    where pm.id = new.driver_group_module_id
      and pm.organization_id = new.organization_id
      and pm.kind = 'driver-group'
      and pm.attribution_subject_id = new.attribution_subject_id
  ) then
    raise exception 'driver registration placement % must reference an organization driver-group with the same subject', new.id
      using errcode = '23514';
  end if;

  if new.default_business_category_module_id is not null and not exists (
    select 1 from parameter_modules pm
    where pm.id = new.default_business_category_module_id
      and pm.organization_id = new.organization_id
      and pm.kind = 'business'
  ) then
    raise exception 'driver registration placement % default must be an organization business module', new.id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists wiseeff_driver_registration_placement_guard
  on driver_registration_placements;
create trigger wiseeff_driver_registration_placement_guard
before insert or update on driver_registration_placements
for each row execute function wiseeff_guard_driver_registration_placement();
