-- Domain-owned, durable receipts contain identifiers and object keys, never log content.
create table parameter_catalog.log_erasures (
  organization_id text not null, log_id text primary key, preview_version text not null,
  erased_by text not null, erased_at timestamptz not null default clock_timestamp(),
  run_ids text[] not null, job_ids text[] not null, pending_object_refs text[] not null default '{}'
);
alter table parameter_catalog.log_erasures owner to catalog_migration_owner;
revoke all on parameter_catalog.log_erasures from public;

-- Reserve analysis/index writes before object IO, including a lost upload response.
create table public.log_artifact_objects (
  organization_id text not null, record_id text not null, object_key text not null,
  primary key(organization_id,record_id,object_key),
  foreign key(record_id,organization_id) references public.log_records(id,organization_id) on delete cascade
);
alter table public.knowledge_entries add column source_log_deleted boolean not null default false;

create function parameter_catalog.lock_log_erasure(p_org text,p_log text,p_actor text) returns void
language plpgsql security definer set search_path=pg_catalog,parameter_catalog,public as $$
begin
  perform set_config('lock_timeout','2s',true);
  perform parameter_catalog.acquire_current_pointer_lock_exclusive();
  -- ponytail: the existing global maintenance fence serializes erasures; narrow
  -- it when all object-reference writers have a common per-object fence.
  lock table public.audit_events,public.dts_reload_runs,public.jobs,public.knowledge_entries,public.knowledge_files,
    public.log_analysis_reports,public.log_analysis_runs,
    public.log_analysis_stages,public.log_analysis_trace_steps,public.log_artifact_objects,
    public.log_evidence,public.log_feedback,public.log_file_objects,public.log_files,
    public.log_original_uploads,public.log_records,public.log_skill_analysis_cases,public.log_skill_dry_runs,
    public.log_skill_samples,public.log_source_snapshots,
    public.log_webhook_deliveries,public.log_webhook_outbox,public.notification_outbox,
    public.product_feedback_attachments,public.project_parameter_file_candidates,
    public.project_parameter_file_versions,public.user_notifications,public.user_role_bindings,public.users in share mode;
  perform parameter_catalog.require_project_erasure_admin(p_org,p_actor);
end; $$;

create function parameter_catalog.read_log_erasure(p_org text,p_log text,p_actor text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,parameter_catalog,public as $$
begin
  perform parameter_catalog.require_project_erasure_admin(p_org,p_actor);
  return (select jsonb_build_object('version',preview_version,'pending',to_jsonb(pending_object_refs))
    from parameter_catalog.log_erasures where organization_id=p_org and log_id=p_log);
end; $$;

create function parameter_catalog.list_log_erasures(p_org text,p_actor text)
returns table(log_id text,version text,pending text[])
language plpgsql stable security definer set search_path=pg_catalog,parameter_catalog,public as $$
begin
  perform parameter_catalog.require_project_erasure_admin(p_org,p_actor);
  return query select r.log_id,r.preview_version,r.pending_object_refs from parameter_catalog.log_erasures r
    where r.organization_id=p_org and cardinality(r.pending_object_refs)>0 order by r.erased_at;
end; $$;

create function parameter_catalog.purge_log(p_org text,p_log text,p_actor text,p_version text) returns void
language plpgsql security definer set search_path=pg_catalog,parameter_catalog,public as $$
declare erased_file_id text; erased_runs text[]; erased_jobs text[]; erased_refs text[];
begin
  perform parameter_catalog.lock_log_erasure(p_org,p_log,p_actor);
  if exists(select 1 from parameter_catalog.log_erasures where organization_id=p_org and log_id=p_log) then return; end if;
  select file_object_id into erased_file_id from public.log_records where organization_id=p_org and id=p_log;
  if erased_file_id is null then raise exception using errcode='P0002',message='Log not found'; end if;
  select coalesce(array_agg(id),'{}') into erased_runs from public.log_analysis_runs where organization_id=p_org and log_record_id=p_log;
  select coalesce(array_agg(id),'{}') into erased_jobs from public.jobs where organization_id=p_org and kind='log-analysis' and target_id=any(erased_runs);
  select coalesce(array_agg(distinct object_key) filter(where object_key is not null),'{}') into erased_refs from (
    select storage_key object_key from public.log_file_objects where id=erased_file_id
    union all select object_key from public.log_files where organization_id=p_org and record_id=p_log
    union all select line_index_key from public.log_files where organization_id=p_org and record_id=p_log
    union all select object_key from public.log_original_uploads where organization_id=p_org and record_id=p_log
    union all select decoded_events_object_key from public.log_analysis_runs where organization_id=p_org and log_record_id=p_log
    union all select object_key from public.log_artifact_objects where organization_id=p_org and record_id=p_log
  ) objects;
  insert into parameter_catalog.log_erasures(organization_id,log_id,preview_version,erased_by,run_ids,job_ids,pending_object_refs)
    values(p_org,p_log,p_version,p_actor,erased_runs,erased_jobs,erased_refs);
  -- Feedback notes and rerun questions can contain copied raw log text. Keep
  -- the administrative event identity/actor/time, but erase its content payload.
  update public.audit_events set metadata=jsonb_build_object('logPermanentlyDeleted',true)
    where organization_id=p_org and target_type='log-record' and target_id=p_log;
  update public.knowledge_entries set source_log_deleted=true,source_log_id=null where organization_id=p_org and source_log_id=p_log;
  delete from public.notification_outbox where organization_id=p_org and
    ((payload->>'sourceKind'='log-analysis-run' and payload->>'sourceId'=any(erased_runs)) or payload->'metadata'->>'logId'=p_log);
  delete from public.user_notifications where organization_id=p_org and
    ((source_kind='log-analysis-run' and source_id=any(erased_runs)) or metadata->>'logId'=p_log);
  delete from public.log_webhook_outbox where organization_id=p_org and log_record_id=p_log;
  delete from public.log_webhook_deliveries where organization_id=p_org and log_record_id=p_log;
  delete from public.jobs where organization_id=p_org and id=any(erased_jobs);
  delete from public.log_feedback where organization_id=p_org and log_record_id=p_log;
  delete from public.log_evidence where organization_id=p_org and log_record_id=p_log;
  delete from public.log_analysis_reports where organization_id=p_org and log_record_id=p_log;
  delete from public.log_analysis_stages where organization_id=p_org and run_id=any(erased_runs);
  update public.log_records set current_run_id=null where organization_id=p_org and id=p_log;
  delete from public.log_analysis_runs where organization_id=p_org and id=any(erased_runs);
  delete from public.log_records where organization_id=p_org and id=p_log;
  delete from public.log_file_objects where id=erased_file_id and not exists(select 1 from public.log_records where file_object_id=erased_file_id);
end; $$;

create function parameter_catalog.finish_log_erasure_object(p_org text,p_log text,p_actor text,p_key text) returns void
language plpgsql security definer set search_path=pg_catalog,parameter_catalog,public as $$
begin
  perform parameter_catalog.lock_log_erasure(p_org,p_log,p_actor);
  update parameter_catalog.log_erasures set pending_object_refs=array_remove(pending_object_refs,p_key)
    where organization_id=p_org and log_id=p_log;
end; $$;

-- Missing durable jobs are intentionally acknowledged only for the exact erased
-- organization/record/job tuple. Queue workers get no receipt or private table access.
create function public.is_erased_log_job(p_org text,p_log text,p_job text) returns boolean
language sql stable security definer set search_path=pg_catalog,parameter_catalog,public as $$
  select exists(select 1 from parameter_catalog.log_erasures where organization_id=p_org and log_id=p_log and p_job=any(job_ids));
$$;
alter function public.is_erased_log_job(text,text,text) owner to catalog_migration_owner;

create function parameter_catalog.reject_erased_log_reference() returns trigger
language plpgsql security definer set search_path=pg_catalog,parameter_catalog,public as $$
declare erased boolean;
begin
  if tg_table_name='log_records' then
    select exists(select 1 from parameter_catalog.log_erasures where log_id=new.id) into erased;
  elsif tg_table_name='jobs' then
    select exists(select 1 from parameter_catalog.log_erasures where organization_id=new.organization_id and new.target_id=any(run_ids))
      and new.kind='log-analysis' into erased;
  elsif tg_table_name='notification_outbox' then
    select exists(select 1 from parameter_catalog.log_erasures where organization_id=new.organization_id and
      ((new.payload->>'sourceKind'='log-analysis-run' and new.payload->>'sourceId'=any(run_ids)) or new.payload->'metadata'->>'logId'=log_id)) into erased;
  else
    select exists(select 1 from parameter_catalog.log_erasures where organization_id=new.organization_id and
      ((new.source_kind='log-analysis-run' and new.source_id=any(run_ids)) or new.metadata->>'logId'=log_id)) into erased;
  end if;
  if erased then raise exception using errcode='55000',message='Erased log cannot be recreated'; end if;
  return new;
end; $$;
create trigger log_erased_identity before insert or update of id on public.log_records for each row execute function parameter_catalog.reject_erased_log_reference();
create trigger log_erased_job before insert or update of target_id on public.jobs for each row execute function parameter_catalog.reject_erased_log_reference();
create trigger log_erased_outbox before insert or update on public.notification_outbox for each row execute function parameter_catalog.reject_erased_log_reference();
create trigger log_erased_notification before insert or update on public.user_notifications for each row execute function parameter_catalog.reject_erased_log_reference();

grant select,insert,update,delete on public.log_artifact_objects to catalog_migration_owner;
grant select,update,delete on public.log_records,public.log_file_objects,public.log_analysis_runs,public.log_analysis_reports,
  public.log_analysis_stages,public.log_analysis_trace_steps,public.log_evidence,public.log_feedback,public.log_webhook_outbox,
  public.log_webhook_deliveries,public.jobs,public.notification_outbox,public.user_notifications to catalog_migration_owner;
grant select,update on public.knowledge_entries to catalog_migration_owner;
grant select,update on public.audit_events to catalog_migration_owner;
-- SHARE table locks require UPDATE/DELETE table privilege, not column grants.
-- These retained object-reference tables are only locked/read by the definer.
grant update on public.log_files,public.log_original_uploads,public.log_skill_analysis_cases,
  public.log_skill_dry_runs,public.log_skill_samples to catalog_migration_owner;
grant select on public.knowledge_revisions,public.log_files,public.log_original_uploads,public.log_domains,
  public.log_skill_analysis_cases,public.log_skill_dry_runs,public.log_skill_revisions,public.log_skill_samples to catalog_migration_owner;
do $$ declare r record; begin
  for r in select oid::regprocedure name from pg_proc where pronamespace='parameter_catalog'::regnamespace and proname in
    ('lock_log_erasure','read_log_erasure','list_log_erasures','purge_log','finish_log_erasure_object','reject_erased_log_reference') loop
    execute format('alter function %s owner to catalog_migration_owner',r.name);
    execute format('revoke all on function %s from public',r.name);
  end loop;
  for r in select rolname from pg_roles where has_table_privilege(oid,'public.log_domains','INSERT') and rolname<>'PUBLIC' loop
    execute format('grant select,insert,update,delete on public.log_artifact_objects to %I',r.rolname);
  end loop;
end $$;
grant execute on function parameter_catalog.lock_log_erasure(text,text,text),parameter_catalog.read_log_erasure(text,text,text),
  parameter_catalog.list_log_erasures(text,text),parameter_catalog.purge_log(text,text,text,text),
  parameter_catalog.finish_log_erasure_object(text,text,text,text) to parameter_governance_writer_role;
