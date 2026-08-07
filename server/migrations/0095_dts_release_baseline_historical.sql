-- Expand release-baseline status so a new tip can demote the previous tip to historical
-- without deleting prior release identity (PCW Phase 5 / #238).

do $$
declare
  cname text;
begin
  for cname in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    where rel.relname = 'dts_release_baseline'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%status%'
  loop
    execute format('alter table dts_release_baseline drop constraint %I', cname);
  end loop;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'dts_release_baseline_status_check'
  ) then
    alter table dts_release_baseline
      add constraint dts_release_baseline_status_check
      check (status in ('draft', 'released', 'historical'));
  end if;
end;
$$;
