-- Keep the applied 0282 immutable. A raw put holds its committed receipt row;
-- SELECT FOR UPDATE only takes RowShare table locks, compatible with SHARE.
-- Explicitly lock those rows before adopting their keys and deleting metadata.
do $$ declare installed text; changed text; begin
  select pg_get_functiondef('parameter_catalog.erase_organization_logs(text,text,text)'::regprocedure) into strict installed;
  changed:=replace(installed,
    'target:=parameter_catalog.lock_organization_log_erasure(p_id,p_lease,p_actor);',
    'target:=parameter_catalog.lock_organization_log_erasure(p_id,p_lease,p_actor);'||chr(10)||
    '  perform id from public.log_object_writes where organization_id=target order by id for update nowait;');
  if changed=installed then raise exception 'Pending log writer seam unavailable'; end if;
  execute changed;
end $$;
