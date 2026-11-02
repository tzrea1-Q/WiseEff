-- The direct placement is the effective module until owner inheritance is added.
create view parameter_catalog.registration_effective_module as
select registration.organization_id, registration.id as registration_id,
       registration.subject_id, placement.module_id,
       null::text as via_owner_registration_id
from parameter_catalog.organization_subject_registrations registration
left join parameter_catalog.subject_placements placement
  on placement.id = registration.current_placement_id
 and placement.registration_id = registration.id
 and placement.organization_id = registration.organization_id;

do $$
declare source_grant record;
begin
  for source_grant in
    select distinct grantee from information_schema.role_table_grants
    where table_schema = 'parameter_catalog' and table_name = 'subject_placements'
      and privilege_type = 'SELECT' and grantee <> 'PUBLIC'
  loop
    execute format('grant select on parameter_catalog.registration_effective_module to %I', source_grant.grantee);
  end loop;
end;
$$;

create table public.registration_recognition_rules (
  organization_id text not null,
  registration_id text not null,
  canonical_subject_id text references parameter_catalog.catalog_subjects(id) on delete restrict,
  compatibles text[] not null default '{}',
  driver_nature text check (driver_nature in ('physical-device', 'logical-service')),
  instance_cardinality text check (instance_cardinality in ('multiple', 'singleton-per-project')),
  node_type_name text,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (organization_id, registration_id),
  foreign key (registration_id, organization_id)
    references parameter_catalog.organization_subject_registrations(id, organization_id) on delete cascade,
  check (cardinality(compatibles) <= 128 and array_position(compatibles, null) is null),
  check ((node_type_name is null and driver_nature is not null and instance_cardinality is not null)
    or (node_type_name is not null and btrim(node_type_name) <> '' and cardinality(compatibles) = 0
      and driver_nature is null and instance_cardinality is null))
);

-- Retain the source rows for rollback while preventing migrated rules from
-- becoming overrides for a different registration later placed in the module.
create table public.registration_recognition_migration_map (
  organization_id text not null,
  module_id text not null,
  registration_id text not null,
  primary key (organization_id, module_id),
  foreign key (organization_id, module_id)
    references public.module_recognition_rules(organization_id, module_id) on delete cascade,
  foreign key (registration_id, organization_id)
    references parameter_catalog.organization_subject_registrations(id, organization_id) on delete cascade
);

insert into public.registration_recognition_migration_map (organization_id, module_id, registration_id)
select rule.organization_id, rule.module_id, min(effective.registration_id)
from public.module_recognition_rules rule
join parameter_catalog.registration_effective_module effective
  on effective.organization_id = rule.organization_id and effective.module_id = rule.module_id
group by rule.organization_id, rule.module_id, rule.canonical_subject_id
having count(*) = 1 and min(effective.subject_id) = rule.canonical_subject_id;

insert into public.registration_recognition_rules
  (organization_id, registration_id, canonical_subject_id, compatibles, driver_nature, instance_cardinality, node_type_name, updated_at)
select rule.organization_id, effective.registration_id, effective.subject_id, rule.compatibles,
       rule.driver_nature, rule.instance_cardinality, rule.node_type_name, rule.updated_at
from public.module_recognition_rules rule
join public.registration_recognition_migration_map migrated
  on migrated.organization_id = rule.organization_id and migrated.module_id = rule.module_id
join parameter_catalog.registration_effective_module effective
  on effective.organization_id = migrated.organization_id and effective.registration_id = migrated.registration_id;

do $$
declare skipped record;
begin
  for skipped in
    select rule.organization_id, rule.module_id, rule.canonical_subject_id,
           count(effective.registration_id) as registration_count, min(effective.subject_id) as placed_subject_id
    from public.module_recognition_rules rule
    left join parameter_catalog.registration_effective_module effective
      on effective.organization_id = rule.organization_id and effective.module_id = rule.module_id
    group by rule.organization_id, rule.module_id, rule.canonical_subject_id
    having count(effective.registration_id) <> 1
       or rule.canonical_subject_id is distinct from min(effective.subject_id)
  loop
    raise notice 'Recognition rule for organization %, module % retained in legacy table: % registrations, saved subject %, placed subject %',
      skipped.organization_id, skipped.module_id, skipped.registration_count, skipped.canonical_subject_id, skipped.placed_subject_id;
  end loop;
end;
$$;

do $$
declare app_grant record;
begin
  for app_grant in
    select grantee, privilege_type from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'parameter_modules'
      and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
  loop
    execute format('grant %s on public.registration_recognition_rules to %I', app_grant.privilege_type, app_grant.grantee);
    execute format('grant %s on public.registration_recognition_migration_map to %I', app_grant.privilege_type, app_grant.grantee);
  end loop;
end;
$$;
