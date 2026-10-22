-- Historical reports retain labels independently of the skill identity.
alter table log_records add column skill_name_snapshot text;
alter table log_analysis_runs add column skill_name_snapshot text,
  add column skill_revision_number_snapshot integer check (skill_revision_number_snapshot > 0);

-- Shared source snapshots can outlive their originating skill.
alter table log_source_snapshots alter column skill_id drop not null;
