-- Backfill Config Set manifest fields for historical config revisions.
-- Uses pinned dts_config_revision_members (role/sort_order/file_version), never live ppf columns.

alter table dts_config_revisions
  add column if not exists manifest_state text not null default 'complete';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'dts_config_revisions_manifest_state_check'
  ) then
    alter table dts_config_revisions
      add constraint dts_config_revisions_manifest_state_check
      check (manifest_state in ('complete', 'needs_review'));
  end if;
end;
$$;

with member_ranked as (
  select
    m.config_revision_id,
    ppf.file_name,
    m.role,
    m.sort_order,
    count(*) filter (where m.role = 'base') over (partition by m.config_revision_id) as base_count
  from dts_config_revision_members m
  inner join project_parameter_files ppf on ppf.id = m.file_id
),
per_revision as (
  select
    config_revision_id,
    max(base_count) as base_count,
    max(case when role = 'base' and base_count = 1 then file_name end) as sole_base_file,
    coalesce(
      jsonb_agg(file_name order by sort_order, file_name) filter (where role = 'overlay'),
      '[]'::jsonb
    ) as overlay_files
  from member_ranked
  group by config_revision_id
),
overlay_order_uncertain as (
  select distinct config_revision_id
  from member_ranked
  where role = 'overlay'
  group by config_revision_id, sort_order
  having count(*) > 1
)
update dts_config_revisions cr
set
  entry_file = coalesce(cr.entry_file, pr.sole_base_file),
  overlay_order = case
    when cr.overlay_order is not null and cr.overlay_order <> '[]'::jsonb then cr.overlay_order
    else pr.overlay_files
  end,
  manifest_state = case
    when pr.base_count <> 1 then 'needs_review'
    when ou.config_revision_id is not null then 'needs_review'
    when coalesce(cr.entry_file, pr.sole_base_file) is null then 'needs_review'
    when cr.include_search_paths is null or cr.include_search_paths = '[]'::jsonb then 'needs_review'
    else 'complete'
  end
from per_revision pr
left join overlay_order_uncertain ou on ou.config_revision_id = pr.config_revision_id
where cr.id = pr.config_revision_id;

update dts_config_revisions cr
set manifest_state = 'needs_review'
where not exists (
  select 1
  from dts_config_revision_members m
  where m.config_revision_id = cr.id
);

create index if not exists dts_config_revisions_manifest_state_idx
  on dts_config_revisions (manifest_state)
  where manifest_state = 'needs_review';
