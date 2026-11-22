-- Keep receipts private. The batch read returns only the same current-tip
-- suspension decisions to runtimes that can already enumerate Binding IDs.
create function parameter_catalog.current_source_binding_suspensions(p_org text)
returns table(project_id text, binding_id text)
language sql stable strict security definer set search_path = pg_catalog, parameter_catalog, public as $$
  select receipt.project_id, receipt.binding_id
  from parameter_catalog.source_binding_suspension_receipts receipt
  join parameter_catalog.project_parameter_bindings binding
    on binding.id = receipt.binding_id
   and binding.organization_id = receipt.organization_id
   and binding.project_id = receipt.project_id
   and binding.definition_id = receipt.definition_id
   and binding.current_value_id = receipt.old_value_id
  where receipt.organization_id = p_org
    and parameter_catalog.source_revision_exclusion_matches(
      receipt.request_id, binding.id, binding.current_value_id,
      receipt.source_pin_id, receipt.applied_config_revision_id
    );
$$;

alter function parameter_catalog.current_source_binding_suspensions(text) owner to catalog_migration_owner;
revoke all on function parameter_catalog.current_source_binding_suspensions(text) from public;

do $$
declare reader name;
begin
  for reader in
    select role.rolname
    from pg_catalog.pg_proc routine
    cross join lateral pg_catalog.aclexplode(routine.proacl) acl
    join pg_catalog.pg_roles role on role.oid = acl.grantee
    where routine.oid = 'parameter_catalog.current_source_binding_is_suspended(text,text,text)'::regprocedure
      and acl.privilege_type = 'EXECUTE'
      and acl.grantee <> routine.proowner
      and pg_catalog.has_table_privilege(
        role.oid, 'parameter_catalog.project_parameter_bindings', 'SELECT'
      )
  loop
    execute format('grant execute on function parameter_catalog.current_source_binding_suspensions(text) to %I', reader);
  end loop;
end
$$;
