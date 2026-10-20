-- Null preserves the unknown selection provenance of existing records.
alter table log_records add column skill_selection jsonb;
alter table log_records add constraint log_records_skill_selection_shape check (
  skill_selection is null or (
    jsonb_typeof(skill_selection) = 'object'
    and skill_selection->>'mode' in ('recommended', 'explicit', 'generic')
    and jsonb_typeof(skill_selection->'reasons') = 'array'
  ) is true
);
