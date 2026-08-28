-- Issue #649: make driver/property identity and organization placement durable.
-- This is the expand phase. Existing rows are retained; reconciliation is the
-- data repair that classifies and upgrades dirty catalog rows.

-- ---------------------------------------------------------------------------
-- Driver schema -> canonical attribution subject
-- ---------------------------------------------------------------------------

alter table driver_schemas
  add column if not exists attribution_subject_id text
    references attribution_subjects(id);

create index if not exists driver_schemas_attribution_subject_idx
  on driver_schemas (attribution_subject_id)
  where attribution_subject_id is not null;

-- Reuse a subject already registered for the same canonical source key. If a
-- schema has no compatible evidence, keep a deterministic nodetype identity;
-- it remains subject-scoped and is still subject to placement governance.
with schema_candidates as (
  select distinct on (ds.id)
    ds.id as driver_schema_id,
    ds.organization_id,
    case
      when jsonb_typeof(dsv.compatible_patterns) = 'array'
       and jsonb_array_length(dsv.compatible_patterns) > 0
       and nullif(trim(dsv.compatible_patterns->>0), '') is not null
        then 'compatible:' || lower(trim(dsv.compatible_patterns->>0))
      else 'nodetype:' || coalesce(
        nullif(lower(regexp_replace(trim(ds.schema_namespace), '^.*/', '')), ''),
        '/'
      )
    end as source_key,
    coalesce(
      nullif(trim(dsv.compatible_patterns->>0), ''),
      nullif(trim(ds.schema_namespace), ''),
      ds.id
    ) as display_name
  from driver_schemas ds
  left join driver_schema_versions dsv on dsv.driver_schema_id = ds.id
  where ds.attribution_subject_id is null
  order by
    ds.id,
    case when dsv.lifecycle = 'active' then 0 else 1 end,
    dsv.version desc nulls last,
    dsv.id desc nulls last
),
new_subjects as (
  select distinct on (organization_id, source_key)
    'asub:driver-registration:schema:' || md5(
      coalesce(organization_id, 'platform') || E'\u001f' || source_key
    ) as id,
    organization_id,
    source_key,
    display_name
  from schema_candidates
  order by organization_id, source_key, driver_schema_id
)
insert into attribution_subjects (
  id, organization_id, subject_kind, display_name, origin, source_key
)
select
  ns.id,
  ns.organization_id,
  'driver-registration',
  ns.display_name,
  'auto',
  ns.source_key
from new_subjects ns
where not exists (
  select 1
  from attribution_subjects existing
  where existing.organization_id is not distinct from ns.organization_id
    and existing.source_key = ns.source_key
)
on conflict (id) do nothing;

insert into driver_registrations (
  attribution_subject_id, driver_nature, instance_cardinality, notes
)
select asub.id, 'physical-device', 'multiple', ''
from attribution_subjects asub
where asub.subject_kind = 'driver-registration'
  and not exists (
    select 1 from driver_registrations dr
    where dr.attribution_subject_id = asub.id
  )
on conflict (attribution_subject_id) do nothing;

with schema_keys as (
  select distinct on (ds.id)
    ds.id as driver_schema_id,
    ds.organization_id,
    case
      when jsonb_typeof(dsv.compatible_patterns) = 'array'
       and jsonb_array_length(dsv.compatible_patterns) > 0
       and nullif(trim(dsv.compatible_patterns->>0), '') is not null
        then 'compatible:' || lower(trim(dsv.compatible_patterns->>0))
      else 'nodetype:' || coalesce(
        nullif(lower(regexp_replace(trim(ds.schema_namespace), '^.*/', '')), ''),
        '/'
      )
    end as source_key
  from driver_schemas ds
  left join driver_schema_versions dsv on dsv.driver_schema_id = ds.id
  where ds.attribution_subject_id is null
  order by
    ds.id,
    case when dsv.lifecycle = 'active' then 0 else 1 end,
    dsv.version desc nulls last,
    dsv.id desc nulls last
)
update driver_schemas ds
set attribution_subject_id = asub.id
from schema_keys sk
inner join attribution_subjects asub
  on asub.organization_id is not distinct from sk.organization_id
 and asub.source_key = sk.source_key
where ds.id = sk.driver_schema_id
  and ds.attribution_subject_id is null;

-- ---------------------------------------------------------------------------
-- Organization-scoped declared driver placement
-- ---------------------------------------------------------------------------

create table if not exists driver_registration_placements (
  id text primary key,
  organization_id text not null references organizations(id) on delete cascade,
  attribution_subject_id text not null references attribution_subjects(id),
  driver_group_module_id text not null references parameter_modules(id),
  default_business_category_module_id text references parameter_modules(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, attribution_subject_id),
  unique (organization_id, driver_group_module_id)
);

create index if not exists driver_registration_placements_subject_idx
  on driver_registration_placements (attribution_subject_id);

-- Backfill only unambiguous existing driver-group placements. Rows with a
-- missing/competing parent remain visible to reconciliation as governance work.
with candidates as (
  select
    pm.organization_id,
    pm.attribution_subject_id,
    pm.id as driver_group_module_id,
    case when parent.kind = 'business' then parent.id else null end
      as default_business_category_module_id,
    count(*) over (
      partition by pm.organization_id, pm.attribution_subject_id
    ) as candidate_count,
    row_number() over (
      partition by pm.organization_id, pm.attribution_subject_id
      order by
        case when pm.origin = 'curated' then 0 else 1 end,
        pm.id
    ) as candidate_rank
  from parameter_modules pm
  left join parameter_modules parent on parent.id = pm.parent_id
  where pm.kind = 'driver-group'
    and pm.attribution_subject_id is not null
)
insert into driver_registration_placements (
  id, organization_id, attribution_subject_id, driver_group_module_id,
  default_business_category_module_id
)
select
  'drp:' || md5(c.organization_id || E'\u001f' || c.attribution_subject_id),
  c.organization_id,
  c.attribution_subject_id,
  c.driver_group_module_id,
  c.default_business_category_module_id
from candidates c
where c.candidate_count = 1
  and c.candidate_rank = 1
  and not exists (
    select 1
    from driver_registration_placements existing
    where existing.organization_id = c.organization_id
      and existing.attribution_subject_id = c.attribution_subject_id
  )
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Persisted reconciliation run/item evidence
-- ---------------------------------------------------------------------------

create table if not exists parameter_definition_reconciliation_runs (
  id text primary key,
  organization_id text references organizations(id) on delete cascade,
  mode text not null check (mode in ('dry-run', 'apply')),
  phase text not null check (phase in ('preflight', 'apply', 'verify')),
  status text not null check (status in ('planned', 'running', 'completed', 'blocked', 'failed')),
  invocation jsonb not null default '{}'::jsonb,
  report jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists parameter_definition_reconciliation_items (
  id text primary key,
  run_id text not null references parameter_definition_reconciliation_runs(id) on delete cascade,
  organization_id text not null references organizations(id) on delete cascade,
  property_key text not null,
  current_parameter_spec_id text references parameter_specs(id),
  candidate_parameter_spec_id text references parameter_specs(id),
  previous_subject_id text references attribution_subjects(id),
  next_subject_id text references attribution_subjects(id),
  status text not null check (status in ('pending', 'already-reconciled', 'applied', 'blocked', 'skipped')),
  blocker_code text,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, organization_id, current_parameter_spec_id, property_key)
);

create index if not exists parameter_definition_reconciliation_items_run_status_idx
  on parameter_definition_reconciliation_items (run_id, status);

-- ---------------------------------------------------------------------------
-- Expand-phase write guards. These reject new active subjectless DTS property
-- definitions but deliberately do not rewrite existing dirty rows.
-- ---------------------------------------------------------------------------

create or replace function wiseeff_guard_active_dts_property_definition()
returns trigger
language plpgsql
as $$
declare
  spec_source text;
  spec_lifecycle text;
  subject_id text;
  schema_subject_id text;
begin
  select ps.source_kind, ps.definition_lifecycle, ps.attribution_subject_id
    into spec_source, spec_lifecycle, subject_id
  from parameter_specs ps
  where ps.id = new.parameter_spec_id;

  if spec_source <> 'dts' or spec_lifecycle <> 'active' then
    return new;
  end if;

  if subject_id is null then
    raise exception 'active DTS property definition % must have an AttributionSubject', new.parameter_spec_id
      using errcode = '23514';
  end if;

  select ds.attribution_subject_id
    into schema_subject_id
  from driver_schemas ds
  where ds.id = new.driver_schema_id;

  if new.driver_schema_id is null or schema_subject_id is null then
    raise exception 'active DTS property definition % must link to a subject-bearing driver schema', new.parameter_spec_id
      using errcode = '23514';
  end if;

  if schema_subject_id <> subject_id then
    raise exception 'active DTS property definition % subject % disagrees with driver schema subject %',
      new.parameter_spec_id, subject_id, schema_subject_id
      using errcode = '23514';
  end if;

  if not exists (
    select 1 from attribution_subjects asub
    inner join driver_registrations dr on dr.attribution_subject_id = asub.id
    where asub.id = subject_id and asub.subject_kind = 'driver-registration'
  ) then
    raise exception 'active DTS property definition % subject % is not a driver registration',
      new.parameter_spec_id, subject_id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists wiseeff_active_dts_property_definition_guard
  on dts_property_specs;
create trigger wiseeff_active_dts_property_definition_guard
before insert or update on dts_property_specs
for each row execute function wiseeff_guard_active_dts_property_definition();

create or replace function wiseeff_guard_driver_registration_placement()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1
    from parameter_modules pm
    inner join attribution_subjects asub
      on asub.id = pm.attribution_subject_id
     and asub.subject_kind = 'driver-registration'
    inner join driver_registrations dr
      on dr.attribution_subject_id = asub.id
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

comment on table driver_registration_placements is
  'Organization-scoped declared placement for one canonical DriverRegistration (Issue #649).';
comment on table parameter_definition_reconciliation_runs is
  'Audited dry-run/apply evidence for effective driver parameter catalog reconciliation.';
