-- Persist Config Set manifest on each immutable config revision.
-- Validate / typed edit / re-ingest must reload these fields (never invent includeSearchPaths=["."]).

alter table dts_config_revisions
  add column if not exists entry_file text,
  add column if not exists include_search_paths jsonb not null default '[]'::jsonb,
  add column if not exists overlay_order jsonb not null default '[]'::jsonb;

-- Allow validation_failed so re-validation can revoke validated publishability.
do $$
declare
  cname text;
begin
  for cname in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    where rel.relname = 'dts_config_revisions'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%status%'
  loop
    execute format('alter table dts_config_revisions drop constraint %I', cname);
  end loop;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'dts_config_revisions_status_check'
  ) then
    alter table dts_config_revisions
      add constraint dts_config_revisions_status_check
      check (status in (
        'draft',
        'resolving',
        'needs_mapping',
        'invalid',
        'resolved',
        'validated',
        'validation_failed',
        'compiled',
        'pending_approval',
        'published'
      ));
  end if;
end;
$$;
