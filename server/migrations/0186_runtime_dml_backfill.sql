-- Backfill tables created after dedicated runtime LOGIN provisioning; upgrades
-- run as the owner and do not re-run provision-logins or apply default privileges.
do $$
declare
  table_name text;
  role_name text;
begin
  foreach table_name in array array[
    'public.product_feedback_progress_events',
    'public.knowledge_definition_references'
  ]
  loop
    for role_name in
      select rolname from pg_roles
      where has_table_privilege(oid, 'public.log_domains', 'INSERT')
        and oid <> (select relowner from pg_class where oid = table_name::regclass)
        and rolname <> 'PUBLIC'
    loop
      execute format('grant select, insert, update, delete on %s to %I', table_name, role_name);
    end loop;
  end loop;
end $$;
