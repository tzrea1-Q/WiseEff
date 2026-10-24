-- A compacted scope fact does not claim the Organization is deleted until the
-- same final transaction commits its receipt. Global Definition results already
-- completed independently and retain that truthful result.
do $$ declare installed text; changed text; begin
  select pg_get_functiondef('parameter_catalog.minimal_organization_erasure_audit(jsonb,text,jsonb)'::regprocedure) into strict installed;
  changed:=replace(installed,$old$'result','deleted'$old$,
    $new$'result',case when proof.definition_id is not null or exists(select 1 from public.organization_erasures e
      where e.target_organization_id=p_org and e.status='running' and e.stage='finalize') then 'deleted' else 'processing' end$new$);
  if changed=installed then raise exception 'Organization provenance result boundary unavailable'; end if;
  execute changed;
end $$;
