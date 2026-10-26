-- Older NOINHERIT API LOGINs can be governance writers without any direct
-- erasure-function grants. Do not use a previous erasure grant as the gate.
-- Existing SET ROLE authority is required; membership with SET FALSE is not
-- permission to execute writer routines. Only bridge these exact API routines.
do $$
declare runtime record;
begin
  for runtime in
    select rolname from pg_roles
    where rolcanlogin and not rolsuper and not rolinherit
      and pg_has_role(oid, 'parameter_governance_writer_role', 'MEMBER')
      and pg_has_role(oid, 'parameter_governance_writer_role', 'SET')
  loop
    execute format('grant execute on function
      parameter_catalog.preview_parameter_definition_purge(text),
      parameter_catalog.lock_parameter_definition_purge(text),
      parameter_catalog.purge_parameter_definition(text,jsonb,text,text),
      parameter_catalog.read_parameter_definition_erasure(text),
      parameter_catalog.list_definition_erasures(text),
      parameter_catalog.finish_parameter_definition_erasure_object(text,text),
      parameter_catalog.lock_parameter_plane_archive(),
      parameter_catalog.definition_erasure_object_is_referenced(text,text)
      to %I', runtime.rolname);
  end loop;
end $$;
