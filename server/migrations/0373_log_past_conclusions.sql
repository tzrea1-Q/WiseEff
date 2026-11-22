alter table log_analysis_runs
  add column eval_case_draft_exported_at timestamptz,
  add column eval_case_root_cause_category text,
  add column historical_run_ids text[] not null default '{}';

create index log_runs_past_conclusions_idx on log_analysis_runs(organization_id, skill_revision_id)
  where status = 'complete';
create index log_feedback_helpful_run_idx on log_feedback(organization_id, run_id)
  where rating = 'helpful';
