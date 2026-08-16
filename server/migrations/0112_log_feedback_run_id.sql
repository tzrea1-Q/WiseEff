-- TD-092: attribute log-analysis quality feedback to the analysis run that
-- was current when the row was written, so later reruns cannot retarget old
-- sentiment onto a newer analyzer's provenance.
--
-- Backfill is honest, not reconstructed: existing rows inherit whatever
-- log_records.current_run_id is at migration time. Pre-migration leftovers
-- that still have a null run_id fall back to the log's current run at read
-- time (see aggregateFeedbackInsights).
--
-- log_analysis_runs are never deleted in product code; sibling FKs
-- (reports, evidence, stages, log_records.current_run_id) use the default
-- NO ACTION / RESTRICT behavior. Match that so a run with feedback cannot
-- disappear out from under an append-only rating.

alter table log_feedback
  add column if not exists run_id text references log_analysis_runs(id) on delete restrict;

update log_feedback lf
set run_id = lr.current_run_id
from log_records lr
where lf.log_record_id = lr.id
  and lf.organization_id = lr.organization_id
  and lf.run_id is null
  and lr.current_run_id is not null;

create index if not exists log_feedback_run_idx
  on log_feedback (run_id)
  where run_id is not null;
