-- #322 follow-up: reclaim reload runs wedged in `deploying` by a crashed deployer.
--
-- The in-request try/finally drives a terminal state on any thrown error, but a process crash
-- mid-deploy leaves the run stuck in `deploying` forever (claim only re-enters from validated|failed).
-- `deploy_claimed_at` is stamped on claim and heartbeated on each deploying progress persist; a
-- maintenance sweep resets runs whose heartbeat is older than the worst-case deploy window back to
-- `failed` so they become deployable again. The threshold must exceed the device-lease TTL, so an
-- actively-deploying run is never reclaimed out from under a live deployer.

alter table dts_reload_runs
  add column if not exists deploy_claimed_at timestamptz;

create index if not exists dts_reload_runs_deploying_claimed_idx
  on dts_reload_runs (deploy_claimed_at)
  where status = 'deploying';
