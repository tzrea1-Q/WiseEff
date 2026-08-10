-- #285: extend dts_reload_runs for bridge deploy / trigger and reload snapshot evidence.
--
-- Status widens beyond preflight terminals (pending|blocked|validated) to cover in-request
-- deploy (deploying) and honest device outcomes (unverifiable|failed). Reload snapshot is
-- stored on the run itself — not debugging_snapshots — because there is no undoable previous
-- device-tree value to write back (see ADR reload-snapshot).

alter table dts_reload_runs
  drop constraint if exists dts_reload_runs_status_check;

alter table dts_reload_runs
  add constraint dts_reload_runs_status_check
  check (status in ('pending', 'blocked', 'validated', 'deploying', 'unverifiable', 'failed'));

alter table dts_reload_runs
  add column if not exists device_id text,
  add column if not exists bridge_id text,
  add column if not exists bridge_machine_label text,
  add column if not exists target_ref text,
  add column if not exists protocol text,
  add column if not exists integrity_check text
    check (integrity_check is null or integrity_check in ('sha256', 'md5', 'byte-length')),
  add column if not exists reload_snapshot jsonb not null default '{}'::jsonb;

create index if not exists dts_reload_runs_device_created_idx
  on dts_reload_runs (organization_id, device_id, created_at desc)
  where device_id is not null;
