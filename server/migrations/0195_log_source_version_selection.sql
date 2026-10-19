alter table log_analysis_runs
  add column requested_source_version text check (length(requested_source_version) between 1 and 200),
  add column source_snapshot_selection text check (source_snapshot_selection in ('matched_version', 'default', 'none'));
