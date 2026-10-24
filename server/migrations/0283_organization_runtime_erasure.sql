-- Temporary exact-key custody outlives tenant accounts; successful cleanup removes it.
create table public.organization_runtime_erasure_objects (
  erasure_id text not null references public.organization_erasures(id),
  object_key text not null,
  primary key(erasure_id,object_key)
);
alter table public.organization_runtime_erasure_objects owner to catalog_migration_owner;
grant select on public.organization_erasures to catalog_migration_owner;
grant select,update,delete on public.device_bridges,public.device_bridge_tokens to catalog_migration_owner;
grant select,delete on public.agent_checkpoint_namespaces,public.agent_sessions,public.agent_messages,public.agent_tool_calls,public.agent_approvals,public.agent_run_traces,
  public.device_bridge_pairing_codes,public.debugging_events,public.node_operations,public.debugging_snapshots,public.debug_device_leases,
  public.debugging_sessions,public.debugging_targets,public.debugging_devices,public.debugging_parameter_node_bindings,public.debugging_parameters,
  public.debug_node_bindings,public.debug_nodes,public.debug_node_modules,public.product_feedback,public.product_feedback_attachments,
  public.product_feedback_progress_events,public.product_feedback_attachment_deletions,public.product_feedback_attachment_uploads,
  public.user_notifications,public.notification_outbox to catalog_migration_owner;
grant update(operation_id) on public.debugging_snapshots to catalog_migration_owner;
grant update(id) on public.product_feedback_attachment_uploads to catalog_migration_owner;
-- SHARE metadata locks require a write privilege; these stay on the NOLOGIN
-- migration owner, never the API/worker LOGIN or a generic cleanup role.
grant delete on public.dts_reload_runs,public.knowledge_files,public.log_analysis_runs,public.log_artifact_objects,public.log_file_objects,
  public.log_files,public.log_original_uploads,public.log_skill_analysis_cases,public.log_skill_artifact_objects,public.log_skill_dry_runs,
  public.log_skill_samples,public.log_source_snapshots,public.project_parameter_file_candidates,public.project_parameter_file_versions,
  public.project_parameter_plane_archives,public.log_skill_deletions to catalog_migration_owner;

-- Retain the original function OID/ACL and every predecessor's finite custody
-- union. A pending object belongs to its admitted target, not its retry actor.
do $$ declare installed text; body text; begin
  select pg_get_functiondef(p.oid),p.prosrc into strict installed,body from pg_proc p where p.oid='parameter_catalog.organization_deletion_object_references()'::regprocedure;
  execute replace(installed,body,body||E'\n union all select e.target_organization_id,''plane'',o.object_key from public.organization_runtime_erasure_objects o join public.organization_erasures e on e.id=o.erasure_id\n');
end $$;

-- Legacy progress projections may have the typed source ID without metadata.
-- Add only rows the earlier direct-owner/metadata inventory did not count.
do $$ declare installed text; body text; changed text; begin
  select pg_get_functiondef(p.oid),p.prosrc into strict installed,body from pg_proc p where p.oid='parameter_catalog.preview_organization_deletion(text,text)'::regprocedure;
  changed:=regexp_replace(body,'end[;[:space:]]*$', $append$
  return query select 'public.notification_outbox.feedback-progress-foreign','feedback-notifications',count(*),
    encode(sha256(convert_to(coalesce(string_agg(to_jsonb(n)::text,'' order by n.id),''),'UTF8')),'hex')
    from public.notification_outbox n where n.organization_id<>p_org and n.payload->'metadata'->>'feedbackOrganizationId' is distinct from p_org
      and n.payload->>'sourceKind'='product-feedback-progress' and exists(select 1 from public.product_feedback_progress_events p where p.organization_id=p_org and p.id::text=n.payload->>'sourceId');
  return query select 'public.user_notifications.feedback-progress-foreign','feedback-notifications',count(*),
    encode(sha256(convert_to(coalesce(string_agg(to_jsonb(n)::text,'' order by n.id),''),'UTF8')),'hex')
    from public.user_notifications n where n.organization_id<>p_org and n.metadata->>'feedbackOrganizationId' is distinct from p_org
      and n.source_kind='product-feedback-progress' and exists(select 1 from public.product_feedback_progress_events p where p.organization_id=p_org and p.id::text=n.source_id);
end;
$append$,'i');
  if changed=body then raise exception 'Expected preview boundary was not found'; end if;
  execute replace(installed,body,changed);
end $$;

create function public.guard_notification_erasure_source() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare content jsonb; metadata jsonb; kind text; source_id text; source_org text; typed_org text; org text; state text;
begin
  if tg_table_name='notification_outbox' then content:=new.payload; metadata:=content->'metadata'; kind:=content->>'sourceKind'; source_id:=content->>'sourceId';
  else metadata:=new.metadata; kind:=new.source_kind; source_id:=new.source_id; end if;
  source_org:=metadata->>'feedbackOrganizationId';
  if kind='product-feedback' then select organization_id into typed_org from public.product_feedback where id::text=source_id;
  elsif kind='product-feedback-progress' then select organization_id into typed_org from public.product_feedback_progress_events where id::text=source_id; end if;
  if kind in ('product-feedback','product-feedback-progress') and (typed_org is null or (source_org is not null and source_org<>typed_org)) then
    raise exception using errcode='55000',message='Feedback notification source is unavailable';
  end if;
  source_org:=coalesce(typed_org,source_org);
  for org in select distinct id from unnest(array[new.organization_id,source_org]) id where id is not null order by id loop
    select status into state from public.organizations where id=org for share;
    if not found or state='deleting' then raise exception using errcode='55000',message='Notification Organization is unavailable'; end if;
  end loop;
  return new;
end $$;
revoke all on function public.guard_notification_erasure_source() from public;
create trigger notification_erasure_source before insert or update of organization_id,payload on public.notification_outbox
  for each row execute function public.guard_notification_erasure_source();
create trigger notification_erasure_source before insert or update of organization_id,metadata,source_kind,source_id,title,body on public.user_notifications
  for each row execute function public.guard_notification_erasure_source();

-- Deleting is never a suspension completion exception. This lease admits only
-- this finite domain's DELETEs and the snapshot cycle-breaking NULL update.
do $$ declare installed text; changed text; begin
  select pg_get_functiondef('public.guard_organization_lifecycle()'::regprocedure) into strict installed;
  changed:=replace(installed,'if state=''deleting'' then', $guard$if state='deleting' then
      if tg_table_schema='public' and current_setting('wiseeff.organization_erasure_domain',true)='agent-devices-feedback'
        and ((tg_op='DELETE' and tg_table_name=any(array['agent_checkpoint_namespaces','agent_sessions','agent_messages','agent_tool_calls','agent_approvals','agent_run_traces',
          'device_bridge_pairing_codes','debugging_events','node_operations','debugging_snapshots','debug_device_leases','debugging_sessions','debugging_targets','debugging_devices',
          'debugging_parameter_node_bindings','debugging_parameters','debug_node_bindings','debug_nodes','debug_node_modules',
          'product_feedback','product_feedback_attachments','product_feedback_progress_events','product_feedback_attachment_deletions','product_feedback_attachment_uploads']))
          or (tg_op='UPDATE' and tg_table_name='debugging_snapshots' and new_value->>'operation_id' is null and old_value-'operation_id'=new_value-'operation_id'))
        and exists(select 1 from public.organization_erasures e where e.target_organization_id=org and e.status='running' and e.stage='domains'
          and e.id=current_setting('wiseeff.organization_erasure_id',true) and e.lease_owner=current_setting('wiseeff.organization_erasure_lease',true)
          and e.lease_expires_at>clock_timestamp()) then
        if tg_op='DELETE' then return old; else return new; end if;
      end if;$guard$);
  if changed=installed then raise exception 'Expected deleting guard was not found'; end if;
  execute changed;
end $$;

-- One bounded runtime domain, not a relation-discovery or arbitrary SQL engine.
create function parameter_catalog.erase_organization_runtime(p_intent text,p_lease text,p_action text,p_key text default null)
returns text[] language plpgsql security definer set search_path=pg_catalog,public,parameter_catalog as $$
declare target text; result text[]; removed integer;
begin
  select e.target_organization_id into target from public.organization_erasures e
    where e.id=p_intent and e.status='running' and e.stage='domains' and e.lease_owner=p_lease and e.lease_expires_at>clock_timestamp()
      and exists(select 1 from public.organizations o where o.id=e.target_organization_id and o.status='deleting');
  if target is null then raise exception using errcode='55000',message='Runtime erasure lease is unavailable'; end if;
  perform set_config('wiseeff.organization_erasure_id',p_intent,true),set_config('wiseeff.organization_erasure_lease',p_lease,true),
    set_config('wiseeff.organization_erasure_domain','agent-devices-feedback',true);
  if p_action='prepare' then
    -- Admission/final-write fences already exclude new producers. Wait for every
    -- admitted upload's physical IO, including reservations without feedback rows.
    perform id from public.product_feedback_attachment_uploads where organization_id=target order by id for update;
    insert into public.organization_runtime_erasure_objects(erasure_id,object_key)
      select p_intent,storage_key from public.product_feedback_attachments where organization_id=target
      union select p_intent,unnest(object_keys) from public.product_feedback_attachment_uploads where organization_id=target
      on conflict do nothing;
    select array_agg(id order by id) into result from public.device_bridges where organization_id=target;
    update public.device_bridge_tokens t set revoked_at=coalesce(t.revoked_at,clock_timestamp()) from public.device_bridges b where b.id=t.bridge_id and b.organization_id=target;
    update public.device_bridges set revoked_at=coalesce(revoked_at,clock_timestamp()) where organization_id=target;
    delete from public.device_bridge_pairing_codes where organization_id=target;
    -- Typed source IDs cover legacy projections; metadata covers foreign Home
    -- projections even after a feedback source has already been removed.
    delete from public.notification_outbox n where n.organization_id=target or n.payload->'metadata'->>'feedbackOrganizationId'=target
      or (n.payload->>'sourceKind'='product-feedback' and n.payload->>'sourceId' in(select id::text from public.product_feedback where organization_id=target))
      or (n.payload->>'sourceKind'='product-feedback-progress' and n.payload->>'sourceId' in(select id::text from public.product_feedback_progress_events where organization_id=target));
    delete from public.user_notifications n where n.organization_id=target or n.metadata->>'feedbackOrganizationId'=target
      or (n.source_kind='product-feedback' and n.source_id in(select id::text from public.product_feedback where organization_id=target))
      or (n.source_kind='product-feedback-progress' and n.source_id in(select id::text from public.product_feedback_progress_events where organization_id=target));
    delete from public.product_feedback where organization_id=target;
    delete from public.product_feedback_attachment_uploads where organization_id=target;
  elsif p_action='keys' then
    select array_agg(object_key order by object_key) into result from public.organization_runtime_erasure_objects where erasure_id=p_intent;
  elsif p_action='object' then
    -- Same bounded metadata fence as feedback cleanup, extended to all typed
    -- plane references. No foreign writer can attach this key during deletion.
    perform set_config('lock_timeout','2s',true);
    lock table public.dts_reload_runs,public.knowledge_files,public.log_analysis_runs,public.log_artifact_objects,public.log_file_objects,
      public.log_files,public.log_original_uploads,public.log_skill_analysis_cases,public.log_skill_artifact_objects,public.log_skill_dry_runs,
      public.log_skill_samples,public.log_source_snapshots,public.product_feedback_attachments,public.product_feedback_attachment_uploads,
      public.project_parameter_file_candidates,public.project_parameter_file_versions,public.project_parameter_plane_archives,
      public.log_skill_deletions,public.organization_runtime_erasure_objects,parameter_catalog.project_erasures,parameter_catalog.log_erasures,parameter_catalog.definition_erasures in share mode nowait;
    if to_regclass('public.knowledge_attachment_writes') is not null then lock table public.knowledge_attachment_writes in share mode nowait; end if;
    if to_regclass('public.parameter_object_writes') is not null then lock table public.parameter_object_writes in share mode nowait; end if;
    if to_regclass('parameter_catalog.catalog_archive_writes') is not null then lock table parameter_catalog.catalog_archive_writes in share mode nowait; end if;
    if to_regclass('parameter_catalog.organization_parameter_erasure_objects') is not null then lock table parameter_catalog.organization_parameter_erasure_objects in share mode nowait; end if;
    if to_regclass('public.log_object_writes') is not null then lock table public.log_object_writes in share mode nowait; end if;
    if to_regclass('parameter_catalog.organization_log_erasure_objects') is not null then lock table parameter_catalog.organization_log_erasure_objects in share mode nowait; end if;
    perform object_key from public.organization_runtime_erasure_objects where erasure_id=p_intent and object_key=p_key for update;
    if not found then return array[]::text[]; end if;
    if exists(with refs as (select * from parameter_catalog.organization_deletion_object_references()
      except all select target,'plane',object_key from public.organization_runtime_erasure_objects where erasure_id=p_intent and object_key=p_key)
      select 1 from refs where store='plane' and object_ref=p_key) then
      delete from public.organization_runtime_erasure_objects where erasure_id=p_intent and object_key=p_key;
    else result:=array[p_key]; end if;
  elsif p_action='ack' then
    delete from public.organization_runtime_erasure_objects where erasure_id=p_intent and object_key=p_key;
  elsif p_action='finish' then
    if exists(select 1 from public.organization_runtime_erasure_objects where erasure_id=p_intent) then raise exception 'Runtime objects remain'; end if;
    delete from public.agent_sessions where organization_id=target;
    delete from public.agent_checkpoint_namespaces where organization_id=target;
    delete from public.debugging_events where organization_id=target;
    update public.debugging_snapshots set operation_id=null where organization_id=target;
    delete from public.node_operations where organization_id=target;
    delete from public.debugging_snapshots where organization_id=target;
    delete from public.debug_device_leases where organization_id=target;
    delete from public.debugging_sessions where organization_id=target;
    delete from public.debugging_targets where organization_id=target;
    delete from public.debugging_devices where organization_id=target;
    delete from public.debugging_parameter_node_bindings where organization_id=target;
    delete from public.debugging_parameters where organization_id=target;
    delete from public.debug_node_bindings where organization_id=target;
    delete from public.debug_nodes where organization_id=target;
    loop
      delete from public.debug_node_modules m where m.organization_id=target and not exists(select 1 from public.debug_node_modules c where c.parent_id=m.id);
      get diagnostics removed=row_count; exit when removed=0;
    end loop;
    if exists(select 1 from public.debug_node_modules where organization_id=target) then raise exception 'Debug module ownership is unresolved'; end if;
    delete from public.device_bridge_tokens where bridge_id in(select id from public.device_bridges where organization_id=target);
    delete from public.device_bridges where organization_id=target;
  else raise exception 'Unknown runtime erasure action'; end if;
  if not exists(select 1 from public.organization_erasures where id=p_intent and status='running' and lease_owner=p_lease and lease_expires_at>clock_timestamp()) then
    raise exception using errcode='55000',message='Runtime erasure lease expired';
  end if;
  return coalesce(result,array[]::text[]);
end $$;
alter function parameter_catalog.erase_organization_runtime(text,text,text,text) owner to catalog_migration_owner;
revoke all on function parameter_catalog.erase_organization_runtime(text,text,text,text) from public;
do $$ declare actor record; begin
  for actor in select rolname from pg_roles where rolcanlogin and not rolsuper and not rolinherit
    and has_table_privilege(oid,'public.users','UPDATE') and pg_has_role(oid,'catalog_publication_coordinator_role','MEMBER') loop
    execute format('grant execute on function parameter_catalog.erase_organization_runtime(text,text,text,text) to %I',actor.rolname);
  end loop;
end $$;
