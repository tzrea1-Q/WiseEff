-- Organization-maintained recognition rules override current matching only.
-- Published Catalog identities, release snapshots and historical evidence stay intact.
create table public.module_recognition_rules (
  organization_id text not null,
  module_id text not null,
  canonical_subject_id text references parameter_catalog.catalog_subjects(id) on delete restrict,
  compatibles text[] not null default '{}',
  driver_nature text check (driver_nature in ('physical-device', 'logical-service')),
  instance_cardinality text check (instance_cardinality in ('multiple', 'singleton-per-project')),
  node_type_name text,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (organization_id, module_id),
  foreign key (module_id, organization_id) references public.parameter_modules(id, organization_id) on delete cascade,
  check (cardinality(compatibles) <= 128 and array_position(compatibles, null) is null),
  check ((node_type_name is null and driver_nature is not null and instance_cardinality is not null)
    or (node_type_name is not null and btrim(node_type_name) <> '' and cardinality(compatibles) = 0
      and driver_nature is null and instance_cardinality is null))
);
create unique index module_recognition_rules_org_subject_unique
  on public.module_recognition_rules (organization_id, canonical_subject_id)
  where canonical_subject_id is not null;

-- Match the existing module table's application grants for already provisioned
-- runtime logins; newly provisioned logins receive normal public-schema grants.
do $$
declare app_grant record;
begin
  for app_grant in
    select grantee, privilege_type from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'parameter_modules'
      and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
  loop
    execute format('grant %s on public.module_recognition_rules to %I', app_grant.privilege_type, app_grant.grantee);
  end loop;
end;
$$;
