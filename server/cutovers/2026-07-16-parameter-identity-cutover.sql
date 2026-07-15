-- Maintenance-window ONLY. Not discovered by db:migrate.
-- Atomic cutover: verify migration run, enforce semantic FKs, archive legacy
-- identity tables, drop legacy identity columns from active workflow tables,
-- record cutover marker.
-- Caller (applyParameterIdentityCutover) runs this body inside one transaction.
--
-- Placeholders replaced by applyParameterIdentityCutover():
--   {{MIGRATION_RUN_ID}}
--   {{CUTOVER_ID}}

do $$
declare
  run_status text;
begin
  select status into run_status
  from parameter_identity_migration_runs
  where id = '{{MIGRATION_RUN_ID}}';

  if run_status is distinct from 'completed' then
    raise exception 'cutover blocked: migration run % is not completed (status=%)',
      '{{MIGRATION_RUN_ID}}', coalesce(run_status, '<missing>');
  end if;

  if exists (select 1 from parameter_identity_cutovers) then
    raise exception 'cutover blocked: cutover marker already present';
  end if;

  if exists (
    select 1 from parameter_history_entries where project_parameter_binding_id is null
  ) then
    raise exception 'cutover blocked: history missing project_parameter_binding_id';
  end if;

  if exists (
    select 1 from parameter_change_requests where project_parameter_binding_id is null
  ) then
    raise exception 'cutover blocked: change requests missing project_parameter_binding_id';
  end if;

  if exists (
    select 1 from parameter_drafts where project_parameter_binding_id is null
  ) then
    raise exception 'cutover blocked: drafts missing project_parameter_binding_id';
  end if;

  if exists (
    select 1 from parameter_file_sync_conflicts where project_parameter_binding_id is null
  ) then
    raise exception 'cutover blocked: file conflicts missing project_parameter_binding_id';
  end if;

  if exists (
    select 1 from project_parameter_values ppv
    where not exists (
      select 1 from legacy_parameter_migration_evidence e
      where e.legacy_kind = 'project_parameter_value'
        and e.legacy_id = ppv.id
        and e.project_parameter_binding_id is not null
    )
  ) then
    raise exception 'cutover blocked: project values without binding evidence';
  end if;
end;
$$;

-- Make semantic workflow columns non-null where fully populated.
alter table parameter_history_entries
  alter column project_parameter_binding_id set not null;

alter table parameter_change_requests
  alter column project_parameter_binding_id set not null;

alter table parameter_submission_items
  alter column project_parameter_binding_id set not null;

alter table parameter_drafts
  alter column project_parameter_binding_id set not null;

alter table parameter_file_sync_conflicts
  alter column project_parameter_binding_id set not null;

-- CUTOVER_FAILURE_INJECT_POINT
-- (applyParameterIdentityCutover splits here for mid-transaction failure tests)

-- Drop legacy identity FKs / columns from active workflow tables.
alter table parameter_history_entries
  drop constraint if exists parameter_history_entries_parameter_definition_id_fkey;
alter table parameter_history_entries
  drop column if exists parameter_definition_id;

alter table parameter_change_requests
  drop constraint if exists parameter_change_requests_parameter_definition_id_fkey;
alter table parameter_change_requests
  drop column if exists parameter_definition_id;

alter table parameter_file_sync_conflicts
  drop constraint if exists parameter_file_sync_conflicts_parameter_definition_id_fkey;
alter table parameter_file_sync_conflicts
  drop column if exists parameter_definition_id;

alter table debugging_parameters
  drop constraint if exists debugging_parameters_parameter_definition_id_fkey;
alter table debugging_parameters
  drop column if exists parameter_definition_id;

alter table node_operations
  drop constraint if exists node_operations_parameter_definition_id_fkey;
alter table node_operations
  drop column if exists parameter_definition_id;

-- Retarget remaining value FKs to archived tables after rename.
alter table parameter_history_entries
  drop constraint if exists parameter_history_entries_project_parameter_value_id_fkey;
alter table parameter_drafts
  drop constraint if exists parameter_drafts_project_parameter_value_id_fkey;
alter table parameter_change_requests
  drop constraint if exists parameter_change_requests_project_parameter_value_id_fkey;
alter table parameter_submission_items
  drop constraint if exists parameter_submission_items_project_parameter_value_id_fkey;
alter table parameter_file_sync_conflicts
  drop constraint if exists parameter_file_sync_conflicts_project_parameter_value_id_fkey;

alter table project_parameter_values
  drop constraint if exists project_parameter_values_parameter_definition_id_fkey;

alter table parameter_definitions rename to legacy_parameter_definitions;
alter table project_parameter_values rename to legacy_project_parameter_values;

alter table parameter_history_entries
  add constraint parameter_history_entries_legacy_ppv_fkey
  foreign key (project_parameter_value_id) references legacy_project_parameter_values(id);

alter table parameter_drafts
  add constraint parameter_drafts_legacy_ppv_fkey
  foreign key (project_parameter_value_id) references legacy_project_parameter_values(id);

alter table parameter_change_requests
  add constraint parameter_change_requests_legacy_ppv_fkey
  foreign key (project_parameter_value_id) references legacy_project_parameter_values(id);

alter table parameter_submission_items
  add constraint parameter_submission_items_legacy_ppv_fkey
  foreign key (project_parameter_value_id) references legacy_project_parameter_values(id);

alter table parameter_file_sync_conflicts
  add constraint parameter_file_sync_conflicts_legacy_ppv_fkey
  foreign key (project_parameter_value_id) references legacy_project_parameter_values(id);

alter table legacy_project_parameter_values
  add constraint legacy_ppv_legacy_definition_fkey
  foreign key (parameter_definition_id) references legacy_parameter_definitions(id);

insert into parameter_identity_cutovers (id, migration_run_id, cutover_at)
values ('{{CUTOVER_ID}}', '{{MIGRATION_RUN_ID}}', now());
