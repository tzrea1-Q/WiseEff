-- ADR-0014: parameter definitions are versioned subjects with soft retirement.
-- Separates definition_lifecycle from version_status, copies content onto versions,
-- and adds nullable attribution_subject_id. Keeps parameter_spec_versions.lifecycle
-- for one-phase dual-write so existing writers and binding FKs stay intact.

-- ---------------------------------------------------------------------------
-- Definition identity + lifecycle
-- ---------------------------------------------------------------------------

alter table parameter_specs
  add column if not exists attribution_subject_id text
    references attribution_subjects(id);

create index if not exists parameter_specs_attribution_subject_idx
  on parameter_specs (attribution_subject_id)
  where attribution_subject_id is not null;

alter table parameter_specs
  add column if not exists definition_lifecycle text;

-- Any active version → active; only-deprecated versions → deprecated; else draft.
update parameter_specs ps
set definition_lifecycle = coalesce(
  (
    select case
      when bool_or(psv.lifecycle = 'active') then 'active'
      when count(*) > 0 and bool_and(psv.lifecycle = 'deprecated') then 'deprecated'
      else 'draft'
    end
    from parameter_spec_versions psv
    where psv.parameter_spec_id = ps.id
  ),
  'draft'
)
where definition_lifecycle is null;

alter table parameter_specs
  alter column definition_lifecycle set default 'draft';

update parameter_specs
set definition_lifecycle = 'draft'
where definition_lifecycle is null;

alter table parameter_specs
  alter column definition_lifecycle set not null;

alter table parameter_specs
  drop constraint if exists parameter_specs_definition_lifecycle_check;

alter table parameter_specs
  add constraint parameter_specs_definition_lifecycle_check
  check (definition_lifecycle in ('draft', 'active', 'deprecated'));

-- ---------------------------------------------------------------------------
-- Version status + activation stamp + content columns
-- ---------------------------------------------------------------------------

alter table parameter_spec_versions
  add column if not exists version_status text;

alter table parameter_spec_versions
  add column if not exists activated_at timestamptz;

alter table parameter_spec_versions
  add column if not exists units text;

alter table parameter_spec_versions
  add column if not exists constraints jsonb not null default '{}'::jsonb;

alter table parameter_spec_versions
  add column if not exists documentation text;

alter table parameter_spec_versions
  add column if not exists reference_rules jsonb not null default '{}'::jsonb;

-- Map legacy version lifecycle → version_status.
-- Old deprecated versions become superseded (historical / retired version rows).
update parameter_spec_versions
set version_status = case lifecycle
  when 'active' then 'active'
  when 'deprecated' then 'superseded'
  else 'draft'
end
where version_status is null;

update parameter_spec_versions
set activated_at = coalesce(activated_at, created_at, now())
where lifecycle = 'active'
  and activated_at is null;

-- Copy property content onto the corresponding version rows when still empty.
update parameter_spec_versions psv
set
  units = coalesce(psv.units, dps.units),
  constraints = case
    when psv.constraints = '{}'::jsonb then coalesce(dps.constraints, '{}'::jsonb)
    else psv.constraints
  end,
  documentation = coalesce(psv.documentation, dps.documentation),
  reference_rules = case
    when psv.reference_rules = '{}'::jsonb then coalesce(dps.reference_rules, '{}'::jsonb)
    else psv.reference_rules
  end
from dts_property_specs dps
where dps.parameter_spec_id = psv.parameter_spec_id;

alter table parameter_spec_versions
  alter column version_status set default 'draft';

update parameter_spec_versions
set version_status = 'draft'
where version_status is null;

alter table parameter_spec_versions
  alter column version_status set not null;

alter table parameter_spec_versions
  drop constraint if exists parameter_spec_versions_version_status_check;

alter table parameter_spec_versions
  add constraint parameter_spec_versions_version_status_check
  check (version_status in ('draft', 'active', 'superseded'));

-- Dual-write: keep lifecycle in sync with version_status for legacy readers/writers.
-- lifecycle remains draft|active|deprecated; superseded maps to deprecated.
create or replace function parameter_spec_versions_sync_status()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if new.version_status is distinct from old.version_status
       and new.lifecycle is not distinct from old.lifecycle then
      new.lifecycle := case new.version_status
        when 'superseded' then 'deprecated'
        else new.version_status
      end;
    elsif new.lifecycle is distinct from old.lifecycle
       and new.version_status is not distinct from old.version_status then
      new.version_status := case new.lifecycle
        when 'deprecated' then 'superseded'
        else new.lifecycle
      end;
    elsif new.version_status is distinct from old.version_status then
      -- Both changed: prefer version_status as the ADR-0014 source of truth.
      new.lifecycle := case new.version_status
        when 'superseded' then 'deprecated'
        else new.version_status
      end;
    end if;
  else
    -- INSERT: legacy writers set lifecycle only (version_status defaults to draft).
    if new.lifecycle is not null
       and new.lifecycle <> 'draft'
       and new.version_status = 'draft' then
      new.version_status := case new.lifecycle
        when 'deprecated' then 'superseded'
        else new.lifecycle
      end;
    elsif new.version_status is not null and new.version_status <> 'draft' then
      new.lifecycle := case new.version_status
        when 'superseded' then 'deprecated'
        else new.version_status
      end;
    elsif new.lifecycle is not null then
      new.version_status := case new.lifecycle
        when 'deprecated' then 'superseded'
        else new.lifecycle
      end;
    end if;
  end if;

  -- Auto-promote definition draft → active when a version becomes active.
  -- Soft deprecate/restore remains an explicit definition_lifecycle write.
  if new.version_status = 'active' or new.lifecycle = 'active' then
    update parameter_specs
    set definition_lifecycle = 'active'
    where id = new.parameter_spec_id
      and definition_lifecycle = 'draft';
  end if;

  return new;
end;
$$;

drop trigger if exists parameter_spec_versions_sync_status_trg on parameter_spec_versions;
create trigger parameter_spec_versions_sync_status_trg
before insert or update of lifecycle, version_status
on parameter_spec_versions
for each row
execute function parameter_spec_versions_sync_status();
