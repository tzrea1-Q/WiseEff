alter table knowledge_entries add column origin text;

update knowledge_entries
set origin = case
  when source_type = 'agent' then 'agent-drafted'
  when source_log_id is not null or source_log_deleted or source_reload_run_id is not null then 'distilled'
  when content_form = 'file' then 'uploaded'
  else 'authored'
end;

alter table knowledge_entries
  alter column origin set not null,
  alter column origin set default 'authored',
  add constraint knowledge_entries_origin_check
    check (origin in ('authored', 'uploaded', 'distilled', 'agent-drafted', 'imported'));
