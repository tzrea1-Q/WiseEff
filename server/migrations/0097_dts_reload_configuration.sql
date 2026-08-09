-- DTS reload configuration: organisation defaults with optional per-device overrides (#282 / spec #280).
--
-- The reload configuration is the device-side contract every reload run must obey. Resolution is
-- always server-side from these stored records (device override wins over organisation default);
-- request bodies never supply the effective contract for a run.

create table if not exists dts_reload_org_defaults (
  organization_id text primary key references organizations(id) on delete cascade,
  destination_directory text not null,
  destination_filename text not null,
  trigger_node_path text not null,
  trigger_payload text not null,
  kernel_log_command text not null,
  updated_by_user_id text references users(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists dts_reload_device_overrides (
  id text primary key,
  organization_id text not null references organizations(id) on delete cascade,
  device_id text not null references debugging_devices(id) on delete cascade,
  destination_directory text not null,
  destination_filename text not null,
  trigger_node_path text not null,
  trigger_payload text not null,
  kernel_log_command text not null,
  updated_by_user_id text references users(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (organization_id, device_id)
);

create index if not exists dts_reload_device_overrides_org_idx
  on dts_reload_device_overrides (organization_id);

create index if not exists dts_reload_device_overrides_device_idx
  on dts_reload_device_overrides (device_id);
