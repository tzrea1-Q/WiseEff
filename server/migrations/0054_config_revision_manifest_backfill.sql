-- Backfill Config Set manifest fields for historical config revisions.

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
    cr.id as config_revision_id,
    ppf.file_name,
    ppf.config_set_role as role,
    ppf.config_set_sort_order as sort_order,
    count(*) filter (where ppf.config_set_role = 'base') over (partition by cr.id) as base_count
  from dts_config_revisions cr
  inner join dts_config_set cs on cs.id = cr.config_set_id
  inner join project_parameter_files ppf on ppf.config_set_id = cs.id
  where ppf.config_set_role is not null
),
base_pick as (
  select distinct on (config_revision_id)
    config_revision_id,
    file_name
  from member_ranked
  where role = 'base' and base_count = 1
  order by config_revision_id, sort_order, file_name
),
overlay_pick as (
  select
    config_revision_id,
    jsonb_agg(file_name order by sort_order, file_name) as overlays
  from member_ranked
  where role = 'overlay'
  group by config_revision_id
),
ambiguous as (
  select distinct config_revision_id
  from member_ranked
  where base_count > 1 or base_count = 0
)
update dts_config_revisions cr
set
  entry_file = coalesce(cr.entry_file, bp.file_name),
  overlay_order = case
    when cr.overlay_order is not null and cr.overlay_order <> '[]'::jsonb then cr.overlay_order
    else coalesce(op.overlays, '[]'::jsonb)
  end,
  manifest_state = case
    when amb.config_revision_id is not null then 'needs_review'
    when bp.file_name is null and cr.entry_file is null then 'needs_review'
    else 'complete'
  end
from base_pick bp
full outer join overlay_pick op on op.config_revision_id = bp.config_revision_id
left join ambiguous amb on amb.config_revision_id = coalesce(bp.config_revision_id, op.config_revision_id)
where cr.id = coalesce(bp.config_revision_id, op.config_revision_id);

update dts_config_revisions cr
set manifest_state = 'needs_review'
where cr.entry_file is null
  and (cr.overlay_order is null or cr.overlay_order = '[]'::jsonb)
  and not exists (
    select 1
    from dts_config_set cs
    inner join project_parameter_files ppf on ppf.config_set_id = cs.id
    where cs.id = cr.config_set_id
      and ppf.config_set_role is not null
  );

create index if not exists dts_config_revisions_manifest_state_idx
  on dts_config_revisions (manifest_state)
  where manifest_state = 'needs_review';
