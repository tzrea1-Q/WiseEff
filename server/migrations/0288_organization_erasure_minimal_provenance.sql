-- One finite platform provenance boundary; unrelated shared facts stay intact.
create function parameter_catalog.minimal_organization_erasure_audit(p_row jsonb,p_org text,p_counts jsonb)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,parameter_catalog as $$
declare proof parameter_catalog.definition_erasures%rowtype; actor text;
begin
  select * into proof from parameter_catalog.definition_erasures where audit_event_id=p_row->>'id';
  if not found and not (p_row->>'organization_id' is null and
    ((p_row->>'target_type'='organization' and p_row->>'target_id'=p_org) or p_row#>>'{metadata,operatingOrganizationId}'=p_org)) then return null; end if;
  actor:=coalesce(proof.erased_by,p_row#>>'{metadata,actorUserId}',p_row->>'actor_user_id');
  return p_row||jsonb_build_object('organization_id',null,'project_id',null,'actor_user_id',null,
    'actor_type','user','app','user-governance','kind','organization-erasure','action','erase','severity','High',
    'target_type',case when proof.definition_id is null then 'organization' else 'parameter-definition' end,
    'target_id',coalesce(proof.definition_id,p_org),'trace_id',p_row->>'id','historical_attribution','{}'::jsonb,
    'metadata',jsonb_build_object('scope','platform','actorUserId',actor,'counts',coalesce(proof.counts,p_counts),'result','deleted'));
end $$;
alter function parameter_catalog.minimal_organization_erasure_audit(jsonb,text,jsonb) owner to catalog_migration_owner;
revoke all on function parameter_catalog.minimal_organization_erasure_audit(jsonb,text,jsonb) from public;
grant select,update on public.audit_events to catalog_migration_owner;

-- Only the exact derived, content-free UPDATE can cross the deleting fence.
do $$ declare installed text; changed text; begin
  select pg_get_functiondef('public.guard_organization_lifecycle()'::regprocedure) into strict installed;
  changed:=regexp_replace(installed,'if state=''deleting''',$guard$if state='deleting' and tg_table_schema='public' and tg_table_name='audit_events' and tg_op='UPDATE'
      and exists(select 1 from public.organization_erasures e where e.target_organization_id=org and e.status='running' and e.stage='management'
        and e.id=current_setting('wiseeff.organization_erasure_id',true) and e.lease_owner=current_setting('wiseeff.organization_erasure_lease',true)
        and e.lease_expires_at>clock_timestamp() and new_value=parameter_catalog.minimal_organization_erasure_audit(old_value,org,e.counts)) then return new; end if;
    if state='deleting'$guard$);
  if changed=installed then raise exception 'Deleting lifecycle boundary unavailable'; end if;
  execute changed;
end $$;

create function parameter_catalog.compact_organization_erasure_provenance(p_id text,p_lease text) returns void
language plpgsql security definer set search_path=pg_catalog,public,parameter_catalog as $$
declare intent public.organization_erasures%rowtype; item record; minimal public.audit_events%rowtype;
begin
  select * into intent from public.organization_erasures where id=p_id and status='running' and stage='management'
    and lease_owner=p_lease and lease_expires_at>clock_timestamp() for update;
  if not found then raise insufficient_privilege; end if;
  perform set_config('wiseeff.organization_erasure_id',p_id,true),set_config('wiseeff.organization_erasure_lease',p_lease,true);
  for item in select a.* from public.audit_events a where
    (a.organization_id=intent.target_organization_id and exists(select 1 from parameter_catalog.definition_erasures e where e.audit_event_id=a.id))
    or (a.organization_id is null and ((a.target_type='organization' and a.target_id=intent.target_organization_id)
      or a.metadata->>'operatingOrganizationId'=intent.target_organization_id)) order by a.id for update loop
    select * into minimal from jsonb_populate_record(null::public.audit_events,
      parameter_catalog.minimal_organization_erasure_audit(to_jsonb(item),intent.target_organization_id,intent.counts));
    update public.audit_events set organization_id=null,project_id=null,actor_user_id=null,actor_type=minimal.actor_type,
      app=minimal.app,kind=minimal.kind,action=minimal.action,severity=minimal.severity,target_type=minimal.target_type,target_id=minimal.target_id,
      metadata=minimal.metadata,trace_id=minimal.trace_id,historical_attribution=minimal.historical_attribution where id=item.id;
  end loop;
end $$;
alter function parameter_catalog.compact_organization_erasure_provenance(text,text) owner to catalog_migration_owner;
revoke all on function parameter_catalog.compact_organization_erasure_provenance(text,text) from public;
do $$ declare actor record; begin
  for actor in select rolname from pg_roles where rolcanlogin and not rolsuper and not rolinherit
    and has_table_privilege(oid,'public.users','UPDATE') and pg_has_role(oid,'catalog_publication_coordinator_role','MEMBER') loop
    execute format('grant execute on function parameter_catalog.compact_organization_erasure_provenance(text,text) to %I',actor.rolname);
  end loop;
end $$;

-- Detailed attempts are temporary. Completed records keep identity, actor,
-- target, times, category counts and result; no domain work state or keys.
update public.organization_erasures set domain_progress='{}',attempts=0,error_code=null,lease_owner=null,lease_expires_at=null where status='deleted';
alter table public.organization_erasures add constraint organization_erasure_minimal_completion check
  (status<>'deleted' or (domain_progress='{}' and attempts=0 and error_code is null and lease_owner is null and lease_expires_at is null));
