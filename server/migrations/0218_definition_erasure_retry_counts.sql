-- The retry branch reads the committed counts, not the local accumulator.
do $$
declare routine_sql text; corrected_sql text;
begin
  select pg_get_functiondef('parameter_catalog.purge_parameter_definition(text,jsonb,text,text)'::regprocedure) into routine_sql;
  corrected_sql:=replace(routine_sql,
    $before$jsonb_build_object('erased',true,'counts',counts,'pendingObjectRefs',to_jsonb(pending_object_refs)) from parameter_catalog.definition_erasures where definition_id=p_id$before$,
    $after$jsonb_build_object('erased',true,'counts',erasure.counts,'pendingObjectRefs',to_jsonb(erasure.pending_object_refs)) from parameter_catalog.definition_erasures erasure where erasure.definition_id=p_id$after$);
  if corrected_sql=routine_sql then raise exception 'Missing Definition erasure retry branch'; end if;
  execute corrected_sql;
end;
$$;
