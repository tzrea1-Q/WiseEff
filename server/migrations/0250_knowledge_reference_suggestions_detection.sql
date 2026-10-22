-- A successful empty detection also counts: suggestions alone cannot mark backfill completion.
alter table knowledge_entries add column reference_suggestions_detected_at timestamptz;
create index knowledge_entries_reference_suggestions_undetected_idx
  on knowledge_entries (id)
  where reference_suggestions_detected_at is null and status <> 'archived';
