-- Existing column-only readers must retain the view's owner-mediated read.
-- Keep the restore predicate identical without granting a new DEFINER RPC.
do $$
declare view_sql text; predicate_sql text; inline_sql text;
  call_sql constant text := 'parameter_catalog.source_member_is_restored(binding.id, tombstone.id)';
begin
  select pg_get_viewdef('parameter_catalog.current_project_parameter_bindings'::regclass,true) into strict view_sql;
  select prosrc into strict predicate_sql from pg_proc
    where oid='parameter_catalog.source_member_is_restored(text,text)'::regprocedure;
  if position(call_sql in view_sql)=0 then
    raise exception 'Expected restored membership view predicate is unavailable';
  end if;
  -- Freeze both outer IDs before the predicate introduces its own tombstone alias.
  predicate_sql:=replace(replace(predicate_sql,'$1','restore_input.binding_id'),'$2','restore_input.tombstone_id');
  inline_sql:='(select ('||predicate_sql||') from (select binding.id,tombstone.id) restore_input(binding_id,tombstone_id))';
  execute 'create or replace view parameter_catalog.current_project_parameter_bindings as '
    ||replace(view_sql,call_sql,inline_sql);
end $$;
