-- #287: extend dts_reload_runs terminal statuses for behavioural verification outcomes.
--
-- After a successful trigger (+ kernel log capture), the platform may graduate a run from
-- unverifiable to behaviourally verified / contradicted by reading existing debug-node
-- bindings via debug.readNode. Status check widens accordingly.

alter table dts_reload_runs
  drop constraint if exists dts_reload_runs_status_check;

alter table dts_reload_runs
  add constraint dts_reload_runs_status_check
  check (status in (
    'pending',
    'blocked',
    'validated',
    'deploying',
    'unverifiable',
    'verified',
    'contradicted',
    'failed'
  ));
