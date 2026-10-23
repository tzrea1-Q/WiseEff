-- Keep missing ownership an integrity refusal, distinct from a suspended owner.
-- Rewrite only this admission branch so forward cleanup exceptions stay intact.
do $$
declare installed text; changed text;
begin
  select pg_get_functiondef('public.guard_organization_lifecycle()'::regprocedure) into strict installed;
  changed := replace(installed,
    'select status into state from public.organizations where id=org for share;',
    $guard$select status into state from public.organizations where id=org for share;
    if not found then
      raise exception using errcode='23503',message='Organization was not found',detail=org;
    end if;$guard$);
  if changed=installed then raise exception 'Lifecycle owner lookup was not found'; end if;
  execute changed;
end $$;

-- Existing webhook writers need only the two columns used by claim admission.
-- Readers, PUBLIC and organization writes retain their existing boundaries.
do $$
declare role_name text;
begin
  for role_name in select rolname from pg_roles
    where not rolsuper and has_table_privilege(oid,'public.log_webhook_outbox','UPDATE')
  loop
    execute format('grant select(id,status) on public.organizations to %I',role_name);
  end loop;
end $$;
