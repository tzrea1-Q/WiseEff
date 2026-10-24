-- Exact physical-key custody survives the target's users and metadata.
create table public.log_object_writes (
  id uuid primary key, organization_id text not null, object_key text not null,
  created_at timestamptz not null default clock_timestamp()
);
create index log_object_writes_owner_idx on public.log_object_writes(organization_id);
create trigger organization_lifecycle_guard before insert or update or delete on public.log_object_writes
  for each row execute function public.guard_organization_lifecycle();
create table parameter_catalog.organization_log_erasure_objects (
  erasure_id text not null references public.organization_erasures(id),
  organization_id text not null, object_key text not null,
  primary key(erasure_id,object_key)
);
alter table parameter_catalog.organization_log_erasure_objects owner to catalog_migration_owner;
revoke all on parameter_catalog.organization_log_erasure_objects from public;
grant select,insert,update,delete on public.log_object_writes to catalog_migration_owner;
grant select,update on public.organization_erasures to catalog_migration_owner;
grant select,update,delete on public.log_domains,public.log_skill_revisions,public.log_skill_samples,
  public.log_skill_dry_runs,public.log_skill_analysis_cases,public.log_skill_analysis_case_runs,
  public.log_source_snapshots,public.log_source_files,public.log_source_chunks,public.log_source_statements,
  public.log_analysis_trace_steps,public.log_skill_artifact_objects,public.log_skill_deletions,
  public.log_integration_credentials,public.log_domain_knowledge_links to catalog_migration_owner;
grant select,update on public.product_feedback_attachment_uploads,public.project_parameter_plane_archives to catalog_migration_owner;

do $$ declare installed text; changed text; begin
  select pg_get_functiondef('public.guard_organization_lifecycle()'::regprocedure) into strict installed;
  changed:=replace(installed,'if state=''deleting''',$guard$if state='deleting' then
      if tg_table_schema='public' and exists(select 1 from public.organization_erasures e
        where e.target_organization_id=org and e.status='running' and e.stage='domains'
          and e.id=current_setting('wiseeff.organization_erasure_id',true)
          and e.lease_owner=current_setting('wiseeff.organization_erasure_lease',true)
          and e.lease_expires_at>clock_timestamp()) then
        if tg_op='DELETE' and tg_table_name=any(array['log_records','log_file_objects','log_files','log_original_uploads',
          'log_artifact_objects','log_analysis_runs','log_analysis_reports','log_analysis_stages','log_analysis_trace_steps',
          'log_evidence','log_feedback','log_domains','log_skill_revisions','log_skill_samples','log_skill_dry_runs',
          'log_skill_analysis_cases','log_skill_analysis_case_runs','log_skill_artifact_objects','log_skill_deletions',
          'log_source_snapshots','log_source_files','log_source_chunks','log_source_statements','log_integration_credentials',
          'log_domain_knowledge_links','log_webhook_outbox','log_webhook_deliveries','log_object_writes']) then return old; end if;
        if tg_op='DELETE' and tg_table_name='jobs' and old_value->>'kind'='log-analysis' then return old; end if;
        if tg_op='UPDATE' and tg_table_name='log_records' and new_value->>'current_run_id' is null
          and old_value-'current_run_id'=new_value-'current_run_id' then return new; end if;
      end if;
    end if;
    if state='deleting'$guard$);
  if changed=installed then raise exception 'Deleting lifecycle seam unavailable'; end if;
  execute changed;
end $$;

create function parameter_catalog.lock_organization_log_erasure(p_id text,p_lease text,p_actor text) returns text
language plpgsql security definer set search_path=pg_catalog,public,parameter_catalog as $$
declare target text;
begin
  perform set_config('lock_timeout','2s',true);
  perform parameter_catalog.acquire_current_pointer_lock_exclusive();
  -- ponytail: fixed metadata fence; replace with per-object locks once every legacy reference writer participates.
  lock table public.log_object_writes,parameter_catalog.organization_log_erasure_objects,
    public.log_domains,public.log_skill_revisions,public.log_skill_samples,public.log_skill_dry_runs,
    public.log_skill_analysis_cases,public.log_skill_analysis_case_runs,public.log_source_snapshots,
    public.log_source_files,public.log_source_chunks,public.log_source_statements,public.log_analysis_trace_steps,
    public.log_skill_artifact_objects,public.log_skill_deletions,public.log_integration_credentials,
    public.log_domain_knowledge_links,public.log_webhook_outbox,public.log_webhook_deliveries,
    public.log_records,public.log_file_objects,public.log_files,public.log_original_uploads,public.log_artifact_objects,
    public.log_analysis_runs,public.log_analysis_reports,public.log_analysis_stages,public.log_evidence,public.log_feedback,
    public.jobs,public.knowledge_files,public.knowledge_entries,public.product_feedback_attachments,
    public.product_feedback_attachment_uploads,public.project_parameter_file_versions,public.project_parameter_file_candidates,
    public.project_parameter_plane_archives,public.dts_reload_runs,public.notification_outbox,public.user_notifications,
    parameter_catalog.project_erasures,parameter_catalog.log_erasures,parameter_catalog.definition_erasures,
    parameter_catalog.parameter_catalog_archives in share mode nowait;
  if to_regclass('public.parameter_object_writes') is not null then
    lock table public.parameter_object_writes,parameter_catalog.catalog_archive_writes,
      parameter_catalog.organization_parameter_erasure_objects in share mode nowait;
  end if;
  if to_regclass('public.knowledge_attachment_writes') is not null then lock table public.knowledge_attachment_writes in share mode nowait; end if;
  if to_regclass('public.organization_runtime_erasure_objects') is not null then lock table public.organization_runtime_erasure_objects in share mode nowait; end if;
  select target_organization_id into target from public.organization_erasures
    where id=p_id and status='running' and stage='domains' and lease_owner=p_lease and lease_expires_at>clock_timestamp() for update;
  if target is null or not exists(select 1 from public.users u join public.user_role_bindings b on b.user_id=u.id
    and b.organization_id=u.organization_id and b.project_id is null and b.role_id='platform-admin'
    where u.id=p_actor and u.is_active and u.organization_id<>target)
  then raise insufficient_privilege; end if;
  perform set_config('wiseeff.organization_erasure_id',p_id,true);
  perform set_config('wiseeff.organization_erasure_lease',p_lease,true);
  return target;
end $$;

create function parameter_catalog.erase_organization_logs(p_id text,p_lease text,p_actor text) returns void
language plpgsql security definer set search_path=pg_catalog,public,parameter_catalog as $$
declare target text;
begin
  target:=parameter_catalog.lock_organization_log_erasure(p_id,p_lease,p_actor);
  insert into parameter_catalog.organization_log_erasure_objects(erasure_id,organization_id,object_key)
    select p_id,target,object_key from (
      select storage_key object_key from public.log_file_objects where organization_id=target
      union select object_key from public.log_files where organization_id=target
      union select line_index_key from public.log_files where organization_id=target
      union select object_key from public.log_original_uploads where organization_id=target
      union select object_key from public.log_artifact_objects where organization_id=target
      union select decoded_events_object_key from public.log_analysis_runs where organization_id=target
      union select object_key from public.log_skill_samples where organization_id=target
      union select sample_object_key from public.log_skill_dry_runs where organization_id=target
      union select u->>'objectKey' from public.log_skill_analysis_cases cross join lateral jsonb_array_elements(uploads) u where organization_id=target
      union select storage_key from public.log_source_snapshots where organization_id=target
      union select object_key from public.log_skill_artifact_objects where organization_id=target
      union select unnest(pending_object_keys) from public.log_skill_deletions where organization_id=target
      union select unnest(pending_object_refs) from parameter_catalog.log_erasures where organization_id=target
      union select object_key from public.log_object_writes where organization_id=target
    ) objects where object_key is not null on conflict do nothing;
  -- Keep exact erased-job acknowledgement without retaining the log's content.
  insert into parameter_catalog.log_erasures(organization_id,log_id,preview_version,erased_by,run_ids,job_ids)
    select target,r.id,'organization-erasure',p_actor,
      coalesce((select array_agg(a.id) from public.log_analysis_runs a where a.organization_id=target and a.log_record_id=r.id),'{}'),
      coalesce((select array_agg(j.id) from public.jobs j join public.log_analysis_runs a on j.target_id=a.id
        where j.organization_id=target and j.kind='log-analysis' and a.log_record_id=r.id),'{}')
    from public.log_records r where r.organization_id=target on conflict do nothing;
  update parameter_catalog.log_erasures set pending_object_refs='{}' where organization_id=target;
  delete from public.notification_outbox n where
    (n.payload->>'sourceKind'='log-analysis-run' and n.payload->>'sourceId' in(select unnest(run_ids) from parameter_catalog.log_erasures where organization_id=target))
    or n.payload->'metadata'->>'logId' in(select log_id from parameter_catalog.log_erasures where organization_id=target);
  delete from public.user_notifications n where
    (n.source_kind='log-analysis-run' and n.source_id in(select unnest(run_ids) from parameter_catalog.log_erasures where organization_id=target))
    or n.metadata->>'logId' in(select log_id from parameter_catalog.log_erasures where organization_id=target);
  delete from public.log_webhook_outbox where organization_id=target;
  delete from public.log_webhook_deliveries where organization_id=target;
  delete from public.jobs where organization_id=target and kind='log-analysis';
  delete from public.log_feedback where organization_id=target;
  delete from public.log_evidence where organization_id=target;
  delete from public.log_analysis_reports where organization_id=target;
  delete from public.log_analysis_stages where organization_id=target;
  delete from public.log_analysis_trace_steps where organization_id=target;
  update public.log_records set current_run_id=null where organization_id=target;
  delete from public.log_analysis_runs where organization_id=target;
  delete from public.log_records where organization_id=target;
  delete from public.log_file_objects where organization_id=target;
  delete from public.log_source_snapshots where organization_id=target;
  delete from public.log_integration_credentials where organization_id=target;
  delete from public.log_domains where organization_id=target;
  delete from public.log_skill_deletions where organization_id=target;
  delete from public.log_object_writes where organization_id=target;
end $$;

create function parameter_catalog.organization_log_erasure_objects_pending(p_id text,p_lease text,p_actor text)
returns table(object_key text) language plpgsql security definer set search_path=pg_catalog,public,parameter_catalog as $$
begin
  perform parameter_catalog.lock_organization_log_erasure(p_id,p_lease,p_actor);
  return query select o.object_key from parameter_catalog.organization_log_erasure_objects o where erasure_id=p_id order by o.object_key;
end $$;
create function parameter_catalog.organization_log_erasure_object_referenced(p_id text,p_lease text,p_actor text,p_key text)
returns boolean language plpgsql security definer set search_path=pg_catalog,public,parameter_catalog as $$
begin
  perform parameter_catalog.lock_organization_log_erasure(p_id,p_lease,p_actor);
  if not exists(select 1 from parameter_catalog.organization_log_erasure_objects where erasure_id=p_id and object_key=p_key) then raise insufficient_privilege; end if;
  return exists(select 1 from (
    select store,object_ref from parameter_catalog.organization_deletion_object_references()
    except all select 'plane',object_key from parameter_catalog.organization_log_erasure_objects where erasure_id=p_id
  ) refs where object_ref=p_key and store in ('plane','unknown'));
end $$;
create function parameter_catalog.finish_organization_log_erasure_object(p_id text,p_lease text,p_actor text,p_key text)
returns void language plpgsql security definer set search_path=pg_catalog,public,parameter_catalog as $$
begin
  perform parameter_catalog.lock_organization_log_erasure(p_id,p_lease,p_actor);
  delete from parameter_catalog.organization_log_erasure_objects where erasure_id=p_id and object_key=p_key;
end $$;

do $$ declare installed text; changed text; r record; begin
  select pg_get_functiondef('parameter_catalog.preview_organization_deletion_0276(text,text)'::regprocedure) into strict installed;
  changed:=replace(installed,'(''public.log_records'',''logs'',',
    '(''public.log_object_writes'',''logs'',''r.organization_id=$1''),'||chr(10)||'    (''parameter_catalog.organization_log_erasure_objects'',''logs'',''r.organization_id=$1''),'||chr(10)||'    (''public.log_records'',''logs'',');
  -- Whole-org tombstones are minimal producer fences, not remaining business content.
  changed:=replace(changed,'''parameter_catalog.log_erasures'',''catalog'',''r.organization_id=$1''',
    '''parameter_catalog.log_erasures'',''logs'',''r.organization_id=$1 and cardinality(r.pending_object_refs)>0''');
  if changed=installed then raise exception 'Log inventory seam unavailable'; end if;
  execute changed;
  select pg_get_functiondef('parameter_catalog.organization_deletion_object_references()'::regprocedure) into strict installed;
  changed:=replace(installed,'select organization_id,''plane'',object_key from public.log_artifact_objects',
    'select organization_id,''plane'',object_key from public.log_artifact_objects union all select organization_id,''plane'',object_key from public.log_object_writes union all select organization_id,''plane'',object_key from parameter_catalog.organization_log_erasure_objects');
  if changed=installed then raise exception 'Typed log storage seam unavailable'; end if;
  execute changed;
  for r in select oid::regprocedure name from pg_proc where pronamespace='parameter_catalog'::regnamespace
    and proname in('lock_organization_log_erasure','erase_organization_logs','organization_log_erasure_objects_pending',
      'organization_log_erasure_object_referenced','finish_organization_log_erasure_object') loop
    execute format('alter function %s owner to catalog_migration_owner',r.name);
    execute format('revoke all on function %s from public',r.name);
  end loop;
  for r in select rolname from pg_roles where not rolsuper and has_table_privilege(oid,'public.users','UPDATE')
    and pg_has_role(oid,'catalog_publication_coordinator_role','MEMBER') loop
    execute format('grant select,insert,update,delete on public.log_object_writes to %I',r.rolname);
    execute format('grant execute on function parameter_catalog.erase_organization_logs(text,text,text),parameter_catalog.organization_log_erasure_objects_pending(text,text,text),parameter_catalog.organization_log_erasure_object_referenced(text,text,text,text),parameter_catalog.finish_organization_log_erasure_object(text,text,text,text) to %I',r.rolname);
  end loop;
end $$;
