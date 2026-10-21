-- Queue acknowledgement needs only this exact erased organization/log/job bit.
-- Keep frozen capture/reader roles outside the runtime queue capability.
revoke all on function public.is_erased_log_job(text,text,text) from public;
do $$
declare runtime record;
begin
  for runtime in select rolname from pg_roles
    where rolcanlogin and has_table_privilege(oid,'public.jobs','INSERT')
  loop
    execute format('grant execute on function public.is_erased_log_job(text,text,text) to %I',runtime.rolname);
  end loop;
end $$;
