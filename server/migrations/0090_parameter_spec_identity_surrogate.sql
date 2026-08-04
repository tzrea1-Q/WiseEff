-- ADR-0017 / D-ID-1: definition identity is located by columns, not by a hash of them.
-- Demote parameter_specs.id to a surrogate: keep historical ids, add a denormalized
-- property_key so the identity triple lives on one table, enforce uniqueness there.
--
-- Preflight (2026-08-04, local wiseeff DB): 0 duplicate triples among rows with
-- attribution_subject_id; 78 null-subject rows and 20 rows without dts_property_specs
-- stay outside the uniqueness domain via the partial index.

alter table parameter_specs
  add column if not exists property_key text;

comment on column parameter_specs.property_key is
  'Denormalized catalog identity key (ADR-0017). Source of truth for uniqueness with organization_id + attribution_subject_id; kept in sync with dts_property_specs.property_key.';

-- Backfill from the 1:1 dts_property_specs row when present.
update parameter_specs ps
set property_key = dps.property_key
from dts_property_specs dps
where dps.parameter_spec_id = ps.id
  and ps.property_key is null
  and coalesce(dps.property_key, '') <> '';

-- Fall back to the last specification_key segment (strip the 24-hex digest suffix
-- used by subject-scoped keys). Matches how readers already recover a display key.
update parameter_specs ps
set property_key = nullif(
  regexp_replace(
    (string_to_array(ps.specification_key, '/'))[cardinality(string_to_array(ps.specification_key, '/'))],
    '-[0-9a-f]{24}$',
    ''
  ),
  ''
)
where coalesce(ps.property_key, '') = ''
  and ps.attribution_subject_id is not null
  and coalesce(ps.specification_key, '') <> '';

-- Fail-closed: identity-bearing rows that already have a subject must also carry a key.
do $$
declare
  unresolved_count integer;
  sample text;
begin
  select count(*)::integer into unresolved_count
  from parameter_specs ps
  where ps.attribution_subject_id is not null
    and coalesce(ps.property_key, '') = ''
    and (
      ps.source_kind = 'manual'
      or exists (
        select 1 from project_parameter_bindings b where b.parameter_spec_id = ps.id
      )
      or exists (
        select 1 from driver_schema_overlay_properties odp where odp.parameter_spec_id = ps.id
      )
      or exists (
        select 1 from dts_property_specs d where d.parameter_spec_id = ps.id
      )
    );

  if unresolved_count > 0 then
    select string_agg(format('%s (%s)', ps.id, ps.specification_key), ', ' order by ps.id)
      into sample
    from (
      select id, specification_key
      from parameter_specs ps
      where ps.attribution_subject_id is not null
        and coalesce(ps.property_key, '') = ''
        and (
          ps.source_kind = 'manual'
          or exists (select 1 from project_parameter_bindings b where b.parameter_spec_id = ps.id)
          or exists (select 1 from driver_schema_overlay_properties odp where odp.parameter_spec_id = ps.id)
          or exists (select 1 from dts_property_specs d where d.parameter_spec_id = ps.id)
        )
      order by ps.id
      limit 20
    ) ps;

    raise exception
      '0090_parameter_spec_identity_surrogate: refuse to proceed; % identity-bearing parameter_specs lack property_key after backfill. DETAIL: %',
      unresolved_count,
      coalesce(sample, '(none)');
  end if;
end $$;

-- Fail-closed: refuse to create the unique index over an already-duplicated triple.
do $$
declare
  duplicate_count integer;
  sample text;
begin
  select count(*)::integer into duplicate_count
  from (
    select organization_id, attribution_subject_id, property_key
    from parameter_specs
    where attribution_subject_id is not null
      and coalesce(property_key, '') <> ''
    group by organization_id, attribution_subject_id, property_key
    having count(*) > 1
  ) d;

  if duplicate_count > 0 then
    select string_agg(
      format(
        '(%s, %s, %s) x%s → %s',
        coalesce(organization_id, 'platform'),
        attribution_subject_id,
        property_key,
        row_count,
        spec_ids
      ),
      '; ' order by property_key
    )
      into sample
    from (
      select
        organization_id,
        attribution_subject_id,
        property_key,
        count(*) as row_count,
        string_agg(id, ', ' order by id) as spec_ids
      from parameter_specs
      where attribution_subject_id is not null
        and coalesce(property_key, '') <> ''
      group by organization_id, attribution_subject_id, property_key
      having count(*) > 1
      order by count(*) desc, property_key
      limit 20
    ) d;

    raise exception
      '0090_parameter_spec_identity_surrogate: refuse to proceed; % duplicate identity triples. DETAIL: %',
      duplicate_count,
      coalesce(sample, '(none)');
  end if;
end $$;

create unique index if not exists parameter_specs_identity_triple_uidx
  on parameter_specs (organization_id, attribution_subject_id, property_key)
  nulls not distinct
  where attribution_subject_id is not null
    and property_key is not null;
