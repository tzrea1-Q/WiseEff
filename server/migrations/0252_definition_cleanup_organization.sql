-- Cleanup ownership survives the deleting administrator's account lifecycle.
alter table parameter_catalog.definition_erasures add column organization_id text;
update parameter_catalog.definition_erasures e set organization_id=u.organization_id
from public.users u where u.id=e.erased_by;

-- Capture ownership in the original INSERT, never through a later caller.
do $$ declare installed text; changed text; begin
  select pg_get_functiondef('parameter_catalog.purge_parameter_definition(text,jsonb,text,text)'::regprocedure) into strict installed;
  changed:=replace(installed,
    'insert into parameter_catalog.definition_erasures(definition_id,erased_by,audit_event_id,counts,pending_object_refs,catalog_rewrite)',
    'insert into parameter_catalog.definition_erasures(definition_id,organization_id,erased_by,audit_event_id,counts,pending_object_refs,catalog_rewrite)');
  if changed=installed then raise exception 'Definition erasure receipt INSERT marker is unavailable'; end if;
  installed:=changed;
  changed:=replace(installed,
    'values(p_id,p_actor,p_audit_id,counts,pending_refs,jsonb_build_object(',
    'values(p_id,(select organization_id from public.users where id=p_actor),p_actor,p_audit_id,counts,pending_refs,jsonb_build_object(');
  if changed=installed then raise exception 'Definition erasure receipt VALUES marker is unavailable'; end if;
  execute changed;
end $$;

create function parameter_catalog.list_definition_erasures(p_organization text)
returns table(definition_id text,erased_at timestamptz,counts jsonb,pending_object_refs text[])
language sql stable security definer set search_path=pg_catalog,parameter_catalog as $$
  select e.definition_id,e.erased_at,e.counts,e.pending_object_refs
  from parameter_catalog.definition_erasures e where e.organization_id=p_organization
  order by e.erased_at,e.definition_id;
$$;

alter function parameter_catalog.list_definition_erasures(text) owner to catalog_migration_owner;
revoke all on function parameter_catalog.list_definition_erasures(text) from public;
grant execute on function parameter_catalog.list_definition_erasures(text) to parameter_governance_writer_role;
