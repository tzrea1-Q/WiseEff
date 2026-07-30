-- ADR-0013: attribution subjects are stable catalog entities.
-- Driver registrations and node-type definitions leave the module row identity,
-- while parameter_modules remains the taxonomy placement / display tree.
-- Existing driver-groups default to physical-device + multiple; logical-service
-- singleton cardinality is a curated correction, not an ingest guess.

create table if not exists attribution_subjects (
  id text primary key,
  organization_id text references organizations(id),
  subject_kind text not null
    check (subject_kind in ('driver-registration', 'node-type-definition')),
  display_name text not null,
  origin text not null default 'curated'
    check (origin in ('curated', 'auto')),
  source_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (organization_id, source_key)
);

create index if not exists attribution_subjects_org_kind_idx
  on attribution_subjects (organization_id, subject_kind);

create table if not exists driver_registrations (
  attribution_subject_id text primary key
    references attribution_subjects(id) on delete cascade,
  driver_nature text not null
    check (driver_nature in ('physical-device', 'logical-service')),
  instance_cardinality text not null
    check (instance_cardinality in ('multiple', 'singleton-per-project')),
  notes text not null default ''
);

create table if not exists node_type_definitions (
  attribution_subject_id text primary key
    references attribution_subjects(id) on delete cascade,
  bare_node_name text not null
);

alter table parameter_modules
  add column if not exists attribution_subject_id text
    references attribution_subjects(id);

create index if not exists parameter_modules_attribution_subject_idx
  on parameter_modules (attribution_subject_id)
  where attribution_subject_id is not null;

-- Backfill driver-group subjects.
insert into attribution_subjects (
  id,
  organization_id,
  subject_kind,
  display_name,
  origin,
  source_key,
  created_at,
  updated_at
)
select
  'asub:driver-registration:' || pm.id,
  pm.organization_id,
  'driver-registration',
  pm.name,
  pm.origin,
  coalesce(
    nullif(trim(pm.source_key), ''),
    'compatible:legacy:' || pm.id
  ),
  pm.created_at,
  pm.updated_at
from parameter_modules pm
where pm.kind = 'driver-group'
on conflict do nothing;

insert into driver_registrations (
  attribution_subject_id,
  driver_nature,
  instance_cardinality,
  notes
)
select
  'asub:driver-registration:' || pm.id,
  'physical-device',
  'multiple',
  coalesce(pm.description, '')
from parameter_modules pm
where pm.kind = 'driver-group'
on conflict do nothing;

update parameter_modules pm
set attribution_subject_id = 'asub:driver-registration:' || pm.id
where pm.kind = 'driver-group'
  and pm.attribution_subject_id is null;

-- Backfill node-type subjects.
insert into attribution_subjects (
  id,
  organization_id,
  subject_kind,
  display_name,
  origin,
  source_key,
  created_at,
  updated_at
)
select
  'asub:node-type-definition:' || pm.id,
  pm.organization_id,
  'node-type-definition',
  pm.name,
  pm.origin,
  coalesce(
    nullif(trim(pm.source_key), ''),
    'nodetype:legacy:' || pm.id
  ),
  pm.created_at,
  pm.updated_at
from parameter_modules pm
where pm.kind = 'node-type'
on conflict do nothing;

insert into node_type_definitions (
  attribution_subject_id,
  bare_node_name
)
select
  'asub:node-type-definition:' || pm.id,
  coalesce(
    nullif(regexp_replace(coalesce(pm.source_key, ''), '^nodetype:', ''), ''),
    pm.name
  )
from parameter_modules pm
where pm.kind = 'node-type'
on conflict do nothing;

update parameter_modules pm
set attribution_subject_id = 'asub:node-type-definition:' || pm.id
where pm.kind = 'node-type'
  and pm.attribution_subject_id is null;

-- Placement nodes that represent catalog subjects must keep the link.
alter table parameter_modules
  drop constraint if exists parameter_modules_subject_kind_check;

alter table parameter_modules
  add constraint parameter_modules_subject_kind_check
  check (
    (
      kind in ('driver-group', 'node-type')
      and attribution_subject_id is not null
    )
    or (
      kind in ('business', 'unclassified')
      and attribution_subject_id is null
    )
  );
