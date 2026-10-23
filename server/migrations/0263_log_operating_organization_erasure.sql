-- Keep the erasure fence, owner-failed-log rule, receipts and writer grants.
-- A platform administrator remains in their real Home organization.
create or replace function parameter_catalog.require_log_erasure_actor(p_org text,p_log text,p_actor text) returns void
language plpgsql stable security definer set search_path=pg_catalog,parameter_catalog,public as $$
begin
  if not exists(select 1 from public.users u where u.id=p_actor and u.is_active and (
    exists(select 1 from public.user_role_bindings b where b.user_id=u.id and b.organization_id=u.organization_id
      and b.project_id is null and b.role_id='platform-admin')
    or (u.organization_id=p_org and (
      exists(select 1 from public.user_role_bindings b where b.user_id=u.id and b.organization_id=p_org
        and b.project_id is null and b.role_id='admin')
      or exists(select 1 from public.log_records l where l.organization_id=p_org and l.id=p_log
        and l.submitted_by_user_id=p_actor and l.status='failed')
      or exists(select 1 from parameter_catalog.log_erasures e where e.organization_id=p_org and e.log_id=p_log and e.erased_by=p_actor)
    ))
  )) then raise exception using errcode='42501',message='只能删除本人上传且分析失败或已取消的日志。'; end if;
end; $$;

create or replace function parameter_catalog.list_log_erasures(p_org text,p_actor text)
returns table(log_id text,version text,pending text[])
language plpgsql stable security definer set search_path=pg_catalog,parameter_catalog,public as $$
declare platform_actor boolean;
begin
  select exists(select 1 from public.users u join public.user_role_bindings b
    on b.user_id=u.id and b.organization_id=u.organization_id
    where u.id=p_actor and u.is_active and b.project_id is null and b.role_id='platform-admin') into platform_actor;
  if not platform_actor and not exists(select 1 from public.users where id=p_actor and organization_id=p_org and is_active)
    then raise exception using errcode='42501',message='无权访问此组织的存储清理记录。'; end if;
  return query select r.log_id,r.preview_version,r.pending_object_refs from parameter_catalog.log_erasures r
    where r.organization_id=p_org and cardinality(r.pending_object_refs)>0 and (
      platform_actor or r.erased_by=p_actor or exists(select 1 from public.user_role_bindings b
        where b.user_id=p_actor and b.organization_id=p_org and b.project_id is null and b.role_id='admin')
    ) order by r.erased_at;
end; $$;
