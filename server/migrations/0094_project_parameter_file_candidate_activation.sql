-- Candidate activation lifecycle states (ADR-0018 / #232).
-- Extends staged candidates with stale-base and activated terminal statuses.

alter table project_parameter_file_candidates
  drop constraint if exists project_parameter_file_candidates_status_check;

alter table project_parameter_file_candidates
  add constraint project_parameter_file_candidates_status_check
  check (
    status in (
      'uploading',
      'parsing',
      'ready',
      'blocked',
      'failed',
      'abandoned',
      'stale',
      'active'
    )
  );

alter table project_parameter_file_candidates
  add column if not exists activated_at timestamptz;

alter table project_parameter_file_candidates
  add column if not exists activated_by_user_id text references users(id);

alter table project_parameter_file_candidates
  add column if not exists activated_version_id text references project_parameter_file_versions(id) on delete set null;
