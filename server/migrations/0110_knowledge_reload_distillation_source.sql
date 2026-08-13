-- Knowledge distillation source #2 (design deferred roadmap item 3): entries
-- distilled from a DTS reload run keep a durable source linkage alongside
-- Phase 3's source_log_id. The reload run is the audit and evidence subject,
-- so the linkage points at the run row; it survives normal operation and
-- degrades to null only if the run row is ever deleted (project cascade).

alter table knowledge_entries
  add column if not exists source_reload_run_id text references dts_reload_runs(id) on delete set null;

create index if not exists knowledge_entries_source_reload_run_idx
  on knowledge_entries (source_reload_run_id)
  where source_reload_run_id is not null;
