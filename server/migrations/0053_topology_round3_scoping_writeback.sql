-- Round 3: scoped matcher overrides, review task ownership, merge writeback identity.

alter table parameter_spec_matcher_overrides
  add column if not exists node_locator_fingerprint text not null default '';

update parameter_spec_matcher_overrides
set node_locator_fingerprint = coalesce(nullif(trim(node_locator), ''), '')
where node_locator is not null and node_locator_fingerprint = '';

do $$
declare
  cname text;
begin
  for cname in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    where rel.relname = 'parameter_spec_matcher_overrides'
      and con.contype = 'u'
      and pg_get_constraintdef(con.oid) ilike '%compatible_fingerprint%property_key%'
      and pg_get_constraintdef(con.oid) not ilike '%node_locator_fingerprint%'
  loop
    execute format('alter table parameter_spec_matcher_overrides drop constraint %I', cname);
  end loop;
end;
$$;

create unique index if not exists parameter_spec_matcher_overrides_scope_uidx
  on parameter_spec_matcher_overrides (
    organization_id,
    project_id,
    compatible_fingerprint,
    node_locator_fingerprint,
    property_key
  );

alter table parameter_spec_review_tasks
  add column if not exists project_id text references projects(id) on delete cascade,
  add column if not exists config_revision_id text references dts_config_revisions(id) on delete cascade,
  add column if not exists property_occurrence_id text references dts_property_occurrences(id) on delete cascade,
  add column if not exists blocker_scope text not null default 'revision';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'parameter_spec_review_tasks_blocker_scope_check'
  ) then
    alter table parameter_spec_review_tasks
      add constraint parameter_spec_review_tasks_blocker_scope_check
      check (blocker_scope in ('revision', 'project', 'platform'));
  end if;
end;
$$;

create index if not exists parameter_spec_review_tasks_revision_idx
  on parameter_spec_review_tasks (organization_id, config_revision_id, status)
  where config_revision_id is not null;

create index if not exists parameter_spec_review_tasks_project_idx
  on parameter_spec_review_tasks (organization_id, project_id, status)
  where project_id is not null;

alter table parameter_change_requests
  add column if not exists base_config_revision_id text references dts_config_revisions(id),
  add column if not exists binding_revision_id text references project_parameter_binding_revisions(id),
  add column if not exists property_occurrence_id text references dts_property_occurrences(id),
  add column if not exists source_file_version_id text references project_parameter_file_versions(id),
  add column if not exists expected_checksum text,
  add column if not exists occurrence_span jsonb;

alter table parameter_drafts
  add column if not exists base_config_revision_id text references dts_config_revisions(id),
  add column if not exists binding_revision_id text references project_parameter_binding_revisions(id),
  add column if not exists property_occurrence_id text references dts_property_occurrences(id),
  add column if not exists source_file_version_id text references project_parameter_file_versions(id),
  add column if not exists expected_checksum text,
  add column if not exists occurrence_span jsonb;

alter table parameter_identity_migration_runs
  drop constraint if exists parameter_identity_migration_runs_mode_check;

alter table parameter_identity_migration_runs
  add constraint parameter_identity_migration_runs_mode_check
  check (mode in ('dry-run', 'stage-review', 'finalize', 'apply'));

alter table parameter_identity_migration_runs
  drop constraint if exists parameter_identity_migration_runs_status_check;

alter table parameter_identity_migration_runs
  add constraint parameter_identity_migration_runs_status_check
  check (status in ('completed', 'failed', 'blocked', 'staged', 'finalized'));
