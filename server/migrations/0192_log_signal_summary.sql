-- Bounded run-owned signals share the report's tenant and run isolation.
alter table log_analysis_reports add column signal_summary jsonb;
comment on column log_analysis_reports.signal_summary is 'Bounded generic and pinned-skill signals, line templates and file:line evidence anchors';
