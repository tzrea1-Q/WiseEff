alter table debugging_parameters
  add column if not exists enabled boolean not null default true;

alter table debugging_parameters
  add column if not exists archived_at timestamptz;

alter table debugging_parameters
  add column if not exists archived_by text references users(id);

alter table debugging_parameters
  add column if not exists archive_reason text;

create index if not exists debugging_parameters_runtime_enabled_idx
  on debugging_parameters(organization_id, project_id, module, risk, sort_order)
  where enabled = true
    and archived_at is null;

create index if not exists debugging_parameters_shared_runtime_enabled_idx
  on debugging_parameters(organization_id, module, risk, sort_order)
  where project_id is null
    and enabled = true
    and archived_at is null;

create index if not exists debugging_parameters_admin_archive_idx
  on debugging_parameters(organization_id, project_id, enabled, archived_at, sort_order);
