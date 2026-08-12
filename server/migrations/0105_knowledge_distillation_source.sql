-- Knowledge distillation (Phase 3): entries distilled from a log-analysis record
-- keep a durable source linkage. Phase 1's source attribution columns cover WHO
-- authored the entry (source_type + source_session_id); this column covers WHAT
-- structured analysis it was distilled from. The linkage survives log archival
-- and degrades to null only if the log record is ever hard-deleted.

alter table knowledge_entries
  add column if not exists source_log_id text references log_records(id) on delete set null;

create index if not exists knowledge_entries_source_log_idx
  on knowledge_entries (source_log_id)
  where source_log_id is not null;
