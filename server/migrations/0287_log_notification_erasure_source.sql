-- Extend the existing finite feedback projection fence with typed log sources.
-- A recipient's Home never determines ownership of the copied log content.
do $$ declare installed text; changed text; begin
  select pg_get_functiondef('public.guard_notification_erasure_source()'::regprocedure) into strict installed;
  changed:=replace(installed,
    'if kind in (''product-feedback'',''product-feedback-progress'')',
    $source$if kind='log-analysis-run' then
    select organization_id into typed_org from public.log_analysis_runs
      where id=source_id and (metadata->>'logId' is null or log_record_id=metadata->>'logId');
    if typed_org is null then raise exception using errcode='55000',message='Log notification source is unavailable'; end if;
  end if;
  if kind in ('product-feedback','product-feedback-progress')$source$);
  if changed=installed then raise exception 'Typed notification source seam unavailable'; end if;
  execute changed;
end $$;
