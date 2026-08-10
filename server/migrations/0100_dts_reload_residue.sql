-- #288: reload residue bookkeeping + restore-baseline purpose on runs.
--
-- Residue is platform bookkeeping derived from run history (not a device fact).
-- It is keyed by organisation + device and survives process restart.
--
-- Rule:
-- - SET when an ordinary run reaches a post-device-write terminal
--   (unverifiable | verified | contradicted) — i.e. debug values were applied.
-- - CLEAR when a restore-baseline run reaches the same post-device-write terminals.
-- - blocked / failed-before-successful-trigger do NOT set residue.
-- - A failed restore leaves residue in place.

alter table dts_reload_runs
  add column if not exists purpose text not null default 'ordinary';

alter table dts_reload_runs
  drop constraint if exists dts_reload_runs_purpose_check;

alter table dts_reload_runs
  add constraint dts_reload_runs_purpose_check
  check (purpose in ('ordinary', 'restore-baseline'));

create table if not exists dts_reload_device_residue (
  organization_id text not null references organizations(id),
  device_id text not null,
  project_id text not null references projects(id) on delete cascade,
  source_run_id text not null references dts_reload_runs(id) on delete restrict,
  parameters jsonb not null default '[]'::jsonb,
  recorded_at timestamptz not null default now(),
  primary key (organization_id, device_id)
);

create index if not exists dts_reload_device_residue_project_idx
  on dts_reload_device_residue (organization_id, project_id, recorded_at desc);
