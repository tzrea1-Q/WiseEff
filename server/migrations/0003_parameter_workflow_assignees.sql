alter table parameter_change_requests
  add column if not exists workflow_hardware_committer_user_id text references users(id),
  add column if not exists workflow_software_committer_user_id text references users(id),
  add column if not exists workflow_software_user_id text references users(id);
