-- PR2 / D-AG-03 / TD-047: parameter_specs identity → AttributionSubject only.
-- There is no physical driver_module column; historical identity used the
-- specification_key prefix (API alias driverModule) via buildManualSpecIds.
-- New writes use buildSubjectScopedManualSpecIds; this migration backfills
-- attribution_subject_id and fail-closes when identity-bearing rows cannot resolve.
-- Historical id / specification_key values are intentionally preserved.

-- Helper expression (inlined): driver token from specification_key matches the
-- historical driverModule SQL alias.

-- 0) Ensure catalog subjects exist for unambiguous overlay compatibles that still
-- lack a subject (mirrors compatibleSourceKey + insertAttributionSubjectForNewModule).
insert into attribution_subjects (
  id, organization_id, subject_kind, display_name, origin, source_key
)
select distinct on (o.organization_id, lower(trim(o.compatible)))
  'asub:driver-registration:overlay:' || md5(
    coalesce(o.organization_id, 'platform') || E'\u001f' || lower(trim(o.compatible))
  ),
  o.organization_id,
  'driver-registration',
  coalesce(nullif(trim(o.display_name), ''), lower(trim(o.compatible))),
  'auto',
  'compatible:' || lower(trim(o.compatible))
from driver_schema_overlays o
where nullif(trim(o.compatible), '') is not null
  and not exists (
    select 1
    from attribution_subjects asub
    where asub.organization_id is not distinct from o.organization_id
      and asub.source_key = 'compatible:' || lower(trim(o.compatible))
  )
order by o.organization_id, lower(trim(o.compatible)), o.updated_at desc
on conflict (id) do nothing;

insert into driver_registrations (
  attribution_subject_id, driver_nature, instance_cardinality, notes
)
select asub.id, 'physical-device', 'multiple', ''
from attribution_subjects asub
where asub.subject_kind = 'driver-registration'
  and asub.source_key like 'compatible:%'
  and not exists (
    select 1 from driver_registrations dr where dr.attribution_subject_id = asub.id
  )
on conflict (attribution_subject_id) do nothing;

-- 0b) Ensure subjects for unique specification_key tokens on identity-bearing rows
-- that still lack a subject (compatible:{token} and nodetype:{token}).
with identity_rows as (
  select
    ps.id,
    ps.organization_id,
    lower(
      nullif(
        case
          when cardinality(string_to_array(ps.specification_key, '/')) >= 3
            then (string_to_array(ps.specification_key, '/'))[
              cardinality(string_to_array(ps.specification_key, '/')) - 1
            ]
          else split_part(ps.specification_key, '/', 1)
        end,
        ''
      )
    ) as driver_token
  from parameter_specs ps
  where ps.attribution_subject_id is null
    and (
      ps.source_kind = 'manual'
      or exists (select 1 from project_parameter_bindings b where b.parameter_spec_id = ps.id)
      or exists (select 1 from driver_schema_overlay_properties odp where odp.parameter_spec_id = ps.id)
    )
),
tokens as (
  select distinct organization_id, driver_token
  from identity_rows
  where driver_token is not null
    and driver_token not in ('manual', 'vendor', 'platform', 'linux', 'unknown')
)
insert into attribution_subjects (
  id, organization_id, subject_kind, display_name, origin, source_key
)
select
  'asub:driver-registration:token:' || md5(
    coalesce(t.organization_id, 'platform') || E'\u001f' || t.driver_token
  ),
  t.organization_id,
  'driver-registration',
  t.driver_token,
  'auto',
  'compatible:' || t.driver_token
from tokens t
where not exists (
  select 1
  from attribution_subjects asub
  where asub.organization_id is not distinct from t.organization_id
    and (
      asub.source_key = 'compatible:' || t.driver_token
      or asub.source_key = 'nodetype:' || t.driver_token
      or (
        asub.source_key like 'compatible:%'
        and lower(substring(asub.source_key from '[^,]+$')) = t.driver_token
      )
    )
)
on conflict (id) do nothing;

insert into driver_registrations (
  attribution_subject_id, driver_nature, instance_cardinality, notes
)
select asub.id, 'physical-device', 'multiple', ''
from attribution_subjects asub
where asub.id like 'asub:driver-registration:token:%'
  and not exists (
    select 1 from driver_registrations dr where dr.attribution_subject_id = asub.id
  )
on conflict (attribution_subject_id) do nothing;

-- 1) Unique match via specification_key token → attribution_subjects.source_key.
with candidates as (
  select
    ps.id as parameter_spec_id,
    ps.organization_id,
    lower(
      nullif(
        case
          when cardinality(string_to_array(ps.specification_key, '/')) >= 3
            then (string_to_array(ps.specification_key, '/'))[
              cardinality(string_to_array(ps.specification_key, '/')) - 1
            ]
          else split_part(ps.specification_key, '/', 1)
        end,
        ''
      )
    ) as driver_token
  from parameter_specs ps
  where ps.attribution_subject_id is null
),
matched as (
  select
    c.parameter_spec_id,
    asub.id as attribution_subject_id
  from candidates c
  inner join attribution_subjects asub
    on asub.organization_id is not distinct from c.organization_id
   and c.driver_token is not null
   and (
     asub.source_key = 'compatible:' || c.driver_token
     or asub.source_key = 'nodetype:' || c.driver_token
     or (
       asub.source_key like 'compatible:%'
       and lower(substring(asub.source_key from '[^,]+$')) = c.driver_token
     )
   )
),
unique_matches as (
  select parameter_spec_id, min(attribution_subject_id) as attribution_subject_id
  from matched
  group by parameter_spec_id
  having count(distinct attribution_subject_id) = 1
)
update parameter_specs ps
set attribution_subject_id = um.attribution_subject_id
from unique_matches um
where ps.id = um.parameter_spec_id
  and ps.attribution_subject_id is null;

-- 1b) Overlay property → overlay.compatible → subject (unique).
with overlay_matched as (
  select
    odp.parameter_spec_id,
    asub.id as attribution_subject_id
  from driver_schema_overlay_properties odp
  inner join driver_schema_overlays o on o.id = odp.driver_schema_overlay_id
  inner join attribution_subjects asub
    on asub.organization_id is not distinct from o.organization_id
   and asub.source_key = 'compatible:' || lower(trim(o.compatible))
),
unique_overlay as (
  select parameter_spec_id, min(attribution_subject_id) as attribution_subject_id
  from overlay_matched
  group by parameter_spec_id
  having count(distinct attribution_subject_id) = 1
)
update parameter_specs ps
set attribution_subject_id = uo.attribution_subject_id
from unique_overlay uo
where ps.id = uo.parameter_spec_id
  and ps.attribution_subject_id is null;

-- 2) Unique subject via bindings → parameter_modules.attribution_subject_id.
with binding_subjects as (
  select
    b.parameter_spec_id,
    pm.attribution_subject_id
  from project_parameter_bindings b
  inner join parameter_modules pm on pm.id = b.module_id
  where pm.attribution_subject_id is not null
  group by b.parameter_spec_id, pm.attribution_subject_id
),
unique_binding_subjects as (
  select parameter_spec_id, min(attribution_subject_id) as attribution_subject_id
  from binding_subjects
  group by parameter_spec_id
  having count(*) = 1
)
update parameter_specs ps
set attribution_subject_id = ubs.attribution_subject_id
from unique_binding_subjects ubs
where ps.id = ubs.parameter_spec_id
  and ps.attribution_subject_id is null;

-- 3) Fail-closed: identity-bearing rows must resolve a subject.
do $$
declare
  unresolved_count integer;
  sample text;
begin
  select count(*)::integer into unresolved_count
  from parameter_specs ps
  where ps.attribution_subject_id is null
    and (
      ps.source_kind = 'manual'
      or exists (
        select 1
        from project_parameter_bindings b
        where b.parameter_spec_id = ps.id
      )
      or exists (
        select 1
        from driver_schema_overlay_properties odp
        where odp.parameter_spec_id = ps.id
      )
    );

  if unresolved_count > 0 then
    select string_agg(format('%s (%s)', ps.id, ps.specification_key), ', ' order by ps.id)
      into sample
    from (
      select id, specification_key
      from parameter_specs ps
      where ps.attribution_subject_id is null
        and (
          ps.source_kind = 'manual'
          or exists (
            select 1 from project_parameter_bindings b where b.parameter_spec_id = ps.id
          )
          or exists (
            select 1 from driver_schema_overlay_properties odp where odp.parameter_spec_id = ps.id
          )
        )
      order by ps.id
      limit 20
    ) ps;

    raise exception
      '0088_parameter_spec_subject_required: refuse to proceed; % identity-bearing parameter_specs still lack attribution_subject_id. DETAIL: %',
      unresolved_count,
      coalesce(sample, '(none)');
  end if;
end $$;

comment on column parameter_specs.attribution_subject_id is
  'Durable catalog identity (ADR-0013). New manual writes use subject-scoped ids; driverModule is display-only derived from subject/module, not identity.';
