alter table log_records
  add column if not exists related_parameter_project_id text;

alter table log_records
  add constraint log_records_related_parameter_project_check
  check (related_parameter_project_id is null or related_parameter_id is not null);

create index if not exists log_records_related_parameter_scope_idx
  on log_records (organization_id, related_parameter_project_id, captured_at desc)
  where related_parameter_id is not null;

alter table log_analysis_runs
  add column if not exists related_parameter_snapshot jsonb;

alter table log_analysis_runs
  add constraint log_analysis_runs_related_parameter_snapshot_object_check
  check (related_parameter_snapshot is null or jsonb_typeof(related_parameter_snapshot) = 'object');

create or replace function prevent_log_related_parameter_snapshot_update()
returns trigger
language plpgsql
as $$
begin
  if new.related_parameter_snapshot is distinct from old.related_parameter_snapshot then
    raise exception 'log analysis run parameter snapshots are immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists log_analysis_run_parameter_snapshot_immutable on log_analysis_runs;
create trigger log_analysis_run_parameter_snapshot_immutable
before update of related_parameter_snapshot on log_analysis_runs
for each row execute function prevent_log_related_parameter_snapshot_update();
