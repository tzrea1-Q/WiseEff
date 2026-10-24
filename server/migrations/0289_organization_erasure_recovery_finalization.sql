-- A restored consistent finalize-stage snapshot has already lost its target.
-- Its remaining NULL-owner platform facts still need finite compaction.
do $$ declare installed text; changed text; begin
  select pg_get_functiondef('parameter_catalog.compact_organization_erasure_provenance(text,text)'::regprocedure) into strict installed;
  changed:=replace(installed,'stage=''management''','stage in (''management'',''finalize'')');
  if changed=installed then raise exception 'Organization provenance finalization boundary unavailable'; end if;
  execute changed;
end $$;
