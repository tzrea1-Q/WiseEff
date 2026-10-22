-- Existing NOINHERIT API logins need the same capability during an upgrade.
do $$ declare runtime record; begin
  for runtime in select rolname from pg_roles where rolcanlogin
    and has_function_privilege(oid,'parameter_catalog.read_parameter_definition_erasure(text)','EXECUTE')
  loop
    execute format('grant execute on function parameter_catalog.list_definition_erasures(text) to %I',runtime.rolname);
  end loop;
end $$;
