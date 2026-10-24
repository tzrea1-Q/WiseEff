-- 0279 replaced the preview function; direct NOINHERIT LOGIN grants stayed on
-- the renamed implementation OID. Restore only the existing API capability.
revoke all on function parameter_catalog.preview_organization_deletion(text,text) from public;
grant execute on function parameter_catalog.preview_organization_deletion(text,text) to catalog_baseline_reader_role;
revoke all on function parameter_catalog.preview_organization_deletion_0276(text,text) from public,catalog_baseline_reader_role;
do $$ declare runtime record; begin
  for runtime in select rolname from pg_roles where rolcanlogin and not rolsuper and not rolinherit
    and pg_has_role(oid,'parameter_governance_writer_role','MEMBER')
    and pg_has_role(oid,'parameter_governance_writer_role','SET')
    and has_table_privilege(oid,'public.agent_sessions','INSERT') loop
    execute format('grant execute on function parameter_catalog.preview_organization_deletion(text,text) to %I',runtime.rolname);
    execute format('grant select on public.agent_checkpoint_namespaces to %I',runtime.rolname);
    execute format('revoke all on function parameter_catalog.preview_organization_deletion_0276(text,text) from %I',runtime.rolname);
  end loop;
end $$;
