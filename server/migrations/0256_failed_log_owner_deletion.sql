-- Keep the existing deletion closure, fence, receipts and audit transaction.
-- Cancelled analyses are stored as failed records; there is no cancelled record status.
create function parameter_catalog.require_log_erasure_actor(p_org text,p_log text,p_actor text) returns void
language plpgsql stable security definer set search_path=pg_catalog,parameter_catalog,public as $$
begin
  if not exists(select 1 from public.users u where u.id=p_actor and u.organization_id=p_org and u.is_active and (
    exists(select 1 from public.user_role_bindings r where r.user_id=u.id and r.organization_id=p_org
      and r.project_id is null and r.role_id in ('admin','platform-admin'))
    or exists(select 1 from public.log_records l where l.organization_id=p_org and l.id=p_log
      and l.submitted_by_user_id=p_actor and l.status='failed')
    or exists(select 1 from parameter_catalog.log_erasures e where e.organization_id=p_org and e.log_id=p_log and e.erased_by=p_actor)
  )) then raise exception using errcode='42501',message='只能删除本人上传且分析失败或已取消的日志。'; end if;
end; $$;
alter function parameter_catalog.require_log_erasure_actor(text,text,text) owner to catalog_migration_owner;
revoke all on function parameter_catalog.require_log_erasure_actor(text,text,text) from public;

create or replace function parameter_catalog.lock_log_erasure(p_org text,p_log text,p_actor text) returns void
language plpgsql security definer set search_path=pg_catalog,parameter_catalog,public as $$
begin
  perform set_config('lock_timeout','2s',true);
  perform parameter_catalog.acquire_current_pointer_lock_exclusive();
  -- ponytail: retain the global erasure fence; narrow only when all writers share a per-object fence.
  lock table public.audit_events,public.dts_reload_runs,public.jobs,public.knowledge_entries,public.knowledge_files,
    public.log_analysis_reports,public.log_analysis_runs,
    public.log_analysis_stages,public.log_analysis_trace_steps,public.log_artifact_objects,
    public.log_evidence,public.log_feedback,public.log_file_objects,public.log_files,
    public.log_original_uploads,public.log_records,public.log_skill_analysis_cases,public.log_skill_dry_runs,
    public.log_skill_samples,public.log_source_snapshots,
    public.log_webhook_deliveries,public.log_webhook_outbox,public.notification_outbox,
    public.product_feedback_attachments,public.project_parameter_file_candidates,
    public.project_parameter_file_versions,public.user_notifications,public.user_role_bindings,public.users in share mode;
  perform parameter_catalog.require_log_erasure_actor(p_org,p_log,p_actor);
end; $$;

create or replace function parameter_catalog.read_log_erasure(p_org text,p_log text,p_actor text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,parameter_catalog,public as $$
begin
  perform parameter_catalog.require_log_erasure_actor(p_org,p_log,p_actor);
  return (select jsonb_build_object('version',preview_version,'pending',to_jsonb(pending_object_refs))
    from parameter_catalog.log_erasures where organization_id=p_org and log_id=p_log);
end; $$;

create or replace function parameter_catalog.list_log_erasures(p_org text,p_actor text)
returns table(log_id text,version text,pending text[])
language plpgsql stable security definer set search_path=pg_catalog,parameter_catalog,public as $$
begin
  if not exists(select 1 from public.users where id=p_actor and organization_id=p_org and is_active)
    then raise exception using errcode='42501',message='无权访问此组织的存储清理记录。'; end if;
  return query select r.log_id,r.preview_version,r.pending_object_refs from parameter_catalog.log_erasures r
    where r.organization_id=p_org and cardinality(r.pending_object_refs)>0 and (
      r.erased_by=p_actor or exists(select 1 from public.user_role_bindings b
        where b.user_id=p_actor and b.organization_id=p_org and b.project_id is null and b.role_id in ('admin','platform-admin'))
    ) order by r.erased_at;
end; $$;
