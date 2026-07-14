-- TD-040 fix: project deletion must cascade to its DTS config sets.
-- The 0043 backfill creates a default config set for every project, so without
-- ON DELETE CASCADE on dts_config_set.project_id, deleting any project (and the
-- dashboard test fixtures that recreate projects) fails on the foreign key.
-- Append-only, idempotent: drop whatever FK currently guards project_id and
-- re-add it with ON DELETE CASCADE. Cascades further into dts_release_baseline
-- and dts_release_baseline_members (already ON DELETE CASCADE from 0043).
do $$
declare
  cname text;
begin
  for cname in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    where rel.relname = 'dts_config_set'
      and con.contype = 'f'
      and pg_get_constraintdef(con.oid) ilike '%projects(id)%'
  loop
    execute format('alter table dts_config_set drop constraint %I', cname);
  end loop;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'dts_config_set_project_id_fkey'
  ) then
    alter table dts_config_set
      add constraint dts_config_set_project_id_fkey
      foreign key (project_id) references projects(id) on delete cascade;
  end if;
end;
$$;
