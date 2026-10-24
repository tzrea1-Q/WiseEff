-- Exact saver ownership survives accounts and precedes the first checkpoint write.
create table public.agent_checkpoint_namespaces (
  store_id text not null,
  store_kind text not null check(store_kind in ('postgres','memory')),
  checkpoint_thread_id text not null,
  organization_id text not null,
  actor_user_id text not null,
  logical_thread_id text not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(store_id,checkpoint_thread_id),
  check(checkpoint_thread_id=organization_id||':'||actor_user_id||':'||logical_thread_id)
);
alter table public.agent_checkpoint_namespaces owner to catalog_migration_owner;
grant update(id) on public.organizations to catalog_migration_owner;
create function public.protect_agent_checkpoint_identity() returns trigger language plpgsql as $$
begin raise exception using errcode='55000',message='Agent checkpoint ownership is immutable'; end $$;
revoke all on function public.protect_agent_checkpoint_identity() from public;
create trigger immutable_checkpoint_identity before update on public.agent_checkpoint_namespaces
  for each row execute function public.protect_agent_checkpoint_identity();
grant select on public.agent_checkpoint_namespaces to catalog_baseline_reader_role;
create trigger organization_lifecycle_guard before insert or update or delete on public.agent_checkpoint_namespaces
  for each row execute function public.guard_organization_lifecycle();

create function parameter_catalog.register_agent_checkpoint_namespace(p_org text,p_actor text,p_thread text,p_store text,p_kind text,p_key text,p_existing boolean)
returns void language plpgsql security definer set search_path=pg_catalog,public,parameter_catalog as $$
declare current_row public.agent_checkpoint_namespaces; org_status text;
begin
  select status into org_status from public.organizations where id=p_org for share;
  if not found then raise exception using errcode='23503',message='Organization was not found'; end if;
  if org_status<>'active' then raise exception using errcode='55000',message='Organization cannot start or resume an Agent run'; end if;
  if not exists(select 1 from public.users u where u.id=p_actor and u.is_active and (u.organization_id=p_org or exists(
    select 1 from public.user_role_bindings b where b.user_id=u.id and b.organization_id=u.organization_id and b.project_id is null and b.role_id='platform-admin')))
  then raise exception using errcode='42501',message='Current Agent actor cannot operate in this Organization'; end if;
  if exists(select 1 from public.agent_sessions s where
    s.organization_id||':'||coalesce(s.historical_attribution#>>'{actors,actor_user_id,id}',s.actor_user_id)||':'||s.id=p_key
    and (s.organization_id,coalesce(s.historical_attribution#>>'{actors,actor_user_id,id}',s.actor_user_id),s.id) is distinct from (p_org,p_actor,p_thread))
  then raise exception using errcode='23505',message='Ambiguous historical Agent checkpoint namespace'; end if;
  select * into current_row from public.agent_checkpoint_namespaces where store_id=p_store and checkpoint_thread_id=p_key;
  if found then
    if (current_row.organization_id,current_row.actor_user_id,current_row.logical_thread_id,current_row.store_kind) is distinct from (p_org,p_actor,p_thread,p_kind)
    then raise exception using errcode='23505',message='Agent checkpoint namespace belongs to another tuple'; end if;
    return;
  end if;
  if p_existing and not exists(select 1 from public.agent_sessions s where s.id=p_thread and s.organization_id=p_org
    and coalesce(s.historical_attribution#>>'{actors,actor_user_id,id}',s.actor_user_id)=p_actor)
  then raise exception using errcode='23505',message='Existing Agent checkpoint ownership is unclassified'; end if;
  insert into public.agent_checkpoint_namespaces(store_id,store_kind,checkpoint_thread_id,organization_id,actor_user_id,logical_thread_id)
    values(p_store,p_kind,p_key,p_org,p_actor,p_thread) on conflict do nothing;
  select * into current_row from public.agent_checkpoint_namespaces where store_id=p_store and checkpoint_thread_id=p_key;
  if (current_row.organization_id,current_row.actor_user_id,current_row.logical_thread_id,current_row.store_kind) is distinct from (p_org,p_actor,p_thread,p_kind)
  then raise exception using errcode='23505',message='Agent checkpoint namespace belongs to another tuple'; end if;
end $$;
alter function parameter_catalog.register_agent_checkpoint_namespace(text,text,text,text,text,text,boolean) owner to catalog_migration_owner;
revoke all on function parameter_catalog.register_agent_checkpoint_namespace(text,text,text,text,text,text,boolean) from public;
do $$ declare actor record; begin
  for actor in select rolname from pg_roles where rolcanlogin and not rolsuper and not rolinherit
    and pg_has_role(oid,'parameter_governance_writer_role','MEMBER')
    and pg_has_role(oid,'parameter_governance_writer_role','SET') loop
    execute format('grant execute on function parameter_catalog.register_agent_checkpoint_namespace(text,text,text,text,text,text,boolean) to %I',actor.rolname);
  end loop;
end $$;

-- Store identity is explicit: a Catalog ciphertext ref is not a plane object key.
create function parameter_catalog.organization_deletion_object_references()
returns table(org text,store text,object_ref text) language sql stable security definer set search_path=pg_catalog,public,parameter_catalog as $$
  select organization_id,'plane',storage_key from public.log_file_objects
  union all select organization_id,'plane',object_key from public.log_original_uploads
  union all select organization_id,'plane',object_key from public.log_files
  union all select organization_id,'plane',line_index_key from public.log_files
  union all select organization_id,'plane',object_key from public.log_artifact_objects
  union all select organization_id,'plane',decoded_events_object_key from public.log_analysis_runs
  union all select organization_id,'plane',object_key from public.log_skill_samples
  union all select organization_id,'plane',sample_object_key from public.log_skill_dry_runs
  union all select organization_id,'plane',u->>'objectKey' from public.log_skill_analysis_cases cross join lateral jsonb_array_elements(uploads) u
  union all select organization_id,'plane',storage_key from public.log_source_snapshots
  union all select organization_id,'plane',object_key from public.log_skill_artifact_objects
  union all select organization_id,'plane',storage_key from public.knowledge_files
  union all select organization_id,'plane',storage_key from public.product_feedback_attachments
  union all select organization_id,'plane',unnest(object_keys) from public.product_feedback_attachment_uploads
  union all select f.organization_id,'plane',v.storage_key from public.project_parameter_file_versions v join public.project_parameter_files f on f.id=v.file_id
  union all select organization_id,'plane',storage_key from public.project_parameter_file_candidates
  union all select organization_id,'plane',object_ref from public.project_parameter_plane_archives
  union all select organization_id,'plane',overlay_source_storage_key from public.dts_reload_runs
  union all select organization_id,'plane',overlay_artifact_storage_key from public.dts_reload_runs
  union all select organization_id,'plane',unnest(pending_object_keys) from public.log_skill_deletions
  union all select organization_id,'plane',unnest(pending_object_refs) from parameter_catalog.project_erasures
  union all select organization_id,'plane',unnest(pending_object_refs) from parameter_catalog.log_erasures
  union all select null::text,case when ref like 'plane::%' then 'plane' when ref like 'catalog::%' then 'catalog' else 'unknown' end,
    case when ref like 'plane::%' then substr(ref,8) when ref like 'catalog::%' then substr(ref,10) else ref end
    from parameter_catalog.definition_erasures cross join lateral unnest(pending_object_refs) ref
  union all select case when a.owner_scope_kind='organization' then a.owner_scope_id when a.owner_scope_kind='project' then p.organization_id else null end,
    'catalog',a.encrypted_object_ref from parameter_catalog.parameter_catalog_archives a left join public.projects p on a.owner_scope_kind='project' and p.id=a.owner_scope_id
$$;
alter function parameter_catalog.organization_deletion_object_references() owner to catalog_migration_owner;
revoke all on function parameter_catalog.organization_deletion_object_references() from public;

-- Preserve the accepted finite ownership inventory; replace only these two seams.
-- Optional saver tables belong to the configured runtime, never this DEFINER.
do $$ declare installed text; first_marker integer; last_marker integer; begin
  select pg_get_functiondef('parameter_catalog.preview_organization_deletion(text,text)'::regprocedure) into strict installed;
  first_marker:=strpos(installed,'-- Runtime-owned LangGraph tables are optional and are not migration tables.');
  last_marker:=strpos(installed,'-- A newly introduced direct owner cannot silently disappear from the preview.');
  if first_marker=0 or last_marker<=first_marker then raise exception 'Expected checkpoint preview seam was not found'; end if;
  execute substr(installed,1,first_marker-1)||substr(installed,last_marker);
end $$;
alter function parameter_catalog.preview_organization_deletion(text,text) rename to preview_organization_deletion_0276;
revoke all on function parameter_catalog.preview_organization_deletion_0276(text,text) from catalog_baseline_reader_role;
create function parameter_catalog.preview_organization_deletion(p_org text,p_actor text)
returns table(key text,category text,item_count bigint,state_digest text)
language plpgsql stable security definer set search_path=pg_catalog,public,parameter_catalog as $$
begin
  return query select r.* from parameter_catalog.preview_organization_deletion_0276(p_org,p_actor) r
    where r.category<>'storage' and r.key<>'public.agent_checkpoint_namespaces';
  return query with refs as materialized(select * from parameter_catalog.organization_deletion_object_references()), objects as (
    select distinct own.store,own.object_ref,exists(select 1 from refs other where other.store=own.store and other.object_ref=own.object_ref and other.org is distinct from p_org) shared
    from refs own where own.org=p_org and own.object_ref is not null
  ) select case when shared then 'storage.shared' else 'storage.exclusive' end,'storage',count(*),
    encode(sha256(convert_to(string_agg(encode(sha256(convert_to(jsonb_build_array(store,object_ref)::text,'UTF8')),'hex'),'' order by store,object_ref),'UTF8')),'hex') from objects group by shared;
  return query select 'public.agent_checkpoint_namespaces','agent',count(*),
    encode(sha256(convert_to(coalesce(string_agg(to_jsonb(n)::text,'' order by n.store_id,n.checkpoint_thread_id),''),'UTF8')),'hex')
    from public.agent_checkpoint_namespaces n where organization_id=p_org;
  return query select 'agent.checkpoint-runtime','unclassified',1::bigint,'runtime-inspection-required';
  return query select 'storage.unknown-global-reference','unclassified',count(*),'unknown-store' from parameter_catalog.organization_deletion_object_references()
    where store='unknown' having count(*)>0;
  return query select 'parameter_catalog.definition_erasure_audit_provenance','shared-references',count(*),
    encode(sha256(convert_to(coalesce(string_agg(jsonb_build_array(e.definition_id,a)::text,'' order by e.definition_id),''),'UTF8')),'hex')
    from parameter_catalog.definition_erasures e join public.audit_events a on a.id=e.audit_event_id
    where a.organization_id=p_org or (a.organization_id is null and
      ((a.target_type='organization' and a.target_id=p_org) or a.metadata->>'operatingOrganizationId'=p_org));
end $$;
alter function parameter_catalog.preview_organization_deletion(text,text) owner to catalog_migration_owner;
revoke all on function parameter_catalog.preview_organization_deletion(text,text) from public;
grant execute on function parameter_catalog.preview_organization_deletion(text,text) to catalog_baseline_reader_role;
