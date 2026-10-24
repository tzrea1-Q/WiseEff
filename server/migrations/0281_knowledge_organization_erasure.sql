-- Temporary physical-key custody deliberately outlives the target and accounts.
create table public.knowledge_attachment_writes (
  id uuid primary key,
  organization_id text not null,
  storage_key text not null,
  erasure_id text references public.organization_erasures(id),
  created_at timestamptz not null default clock_timestamp()
);
create index knowledge_attachment_writes_owner_idx on public.knowledge_attachment_writes(organization_id);
create trigger organization_lifecycle_guard before insert or update or delete on public.knowledge_attachment_writes
  for each row execute function public.guard_organization_lifecycle();
grant select,insert,update,delete on public.knowledge_attachment_writes to catalog_migration_owner;
grant select on public.organization_erasures to catalog_migration_owner;
grant select,update on public.product_feedback_attachment_uploads,public.project_parameter_plane_archives,
  public.log_skill_artifact_objects,public.log_skill_deletions to catalog_migration_owner;

-- Exact domain operations only: cycle break, receipt adoption and deletion. Old
-- suspension completion/maintenance exceptions remain forbidden while deleting.
do $$ declare installed text; changed text; begin
  select pg_get_functiondef('public.guard_organization_lifecycle()'::regprocedure) into strict installed;
  changed:=replace(installed,
    'if state=''deleting'' then',
    $guard$if state='deleting' or (state is null and tg_table_schema='public' and tg_table_name='knowledge_attachment_writes') then
      if tg_table_schema='public' and exists(select 1 from public.organization_erasures e
        where e.target_organization_id=org and e.status='running' and e.stage='domains'
          and e.id=current_setting('wiseeff.organization_erasure_id',true)
          and e.lease_owner=current_setting('wiseeff.organization_erasure_lease',true)
          and e.lease_expires_at>clock_timestamp()) then
        if tg_op='INSERT' and tg_table_name='knowledge_attachment_writes'
          and new_value->>'erasure_id'=current_setting('wiseeff.organization_erasure_id',true) then return new; end if;
        if tg_op='DELETE' and tg_table_name=any(array['knowledge_entries','knowledge_revisions','knowledge_files',
          'knowledge_chunks','knowledge_index_status','knowledge_definition_references','knowledge_parameter_references',
          'knowledge_reference_suggestions','knowledge_import_batches','knowledge_import_documents','knowledge_attachment_writes',
          'log_domain_knowledge_links']) then return old; end if;
        if tg_op='UPDATE' and tg_table_name='knowledge_entries' and new_value->>'head_revision_id' is null
          and old_value-'head_revision_id'=new_value-'head_revision_id' then return new; end if;
        if tg_op='UPDATE' and tg_table_name='knowledge_attachment_writes'
          and new_value->>'erasure_id'=current_setting('wiseeff.organization_erasure_id',true)
          and old_value-'erasure_id'=new_value-'erasure_id' then return new; end if;
      end if;$guard$);
  changed:=replace(changed,'if not found then'||chr(10)||'      raise exception using errcode=''23503'',message=''Organization was not found'',detail=org;',
    $guard$if not found and not (tg_table_schema='public' and tg_table_name='knowledge_attachment_writes'
      and exists(select 1 from public.organization_erasures e where e.target_organization_id=org
        and e.id=current_setting('wiseeff.organization_erasure_id',true) and e.status='running' and e.stage='domains'
        and e.lease_owner=current_setting('wiseeff.organization_erasure_lease',true) and e.lease_expires_at>clock_timestamp())) then
      raise exception using errcode='23503',message='Organization was not found',detail=org;$guard$);
  if changed=installed then raise exception 'Deleting lifecycle branch unavailable'; end if;
  execute changed;
end $$;

-- One fixed reference boundary shared by this domain's physical retries. Locks
-- live until the caller transaction settles its actual object IO.
create function public.knowledge_erasure_object_referenced(p_id text,p_lease text,p_key text) returns boolean
language plpgsql security definer set search_path=pg_catalog,public,parameter_catalog as $$
begin
  if not exists(select 1 from public.organization_erasures where id=p_id and status='running' and stage='domains'
    and lease_owner=p_lease and lease_expires_at>clock_timestamp()) then raise insufficient_privilege; end if;
  -- ponytail: fixed metadata fence; replace with per-object reservations when all legacy reference writers participate.
  lock table public.knowledge_files,public.knowledge_attachment_writes,public.log_file_objects,public.log_files,
    public.log_original_uploads,public.log_artifact_objects,public.log_analysis_runs,public.log_skill_samples,
    public.log_skill_dry_runs,public.log_skill_analysis_cases,public.log_source_snapshots,public.log_skill_artifact_objects,
    public.product_feedback_attachments,public.product_feedback_attachment_uploads,public.project_parameter_file_versions,
    public.project_parameter_file_candidates,public.project_parameter_plane_archives,public.dts_reload_runs,
    public.log_skill_deletions,parameter_catalog.project_erasures,parameter_catalog.log_erasures,
    parameter_catalog.definition_erasures,parameter_catalog.parameter_catalog_archives in share mode nowait;
  if to_regclass('public.parameter_object_writes') is not null then
    lock table public.parameter_object_writes,parameter_catalog.catalog_archive_writes,
      parameter_catalog.organization_parameter_erasure_objects in share mode nowait;
  end if;
  if to_regclass('public.organization_runtime_erasure_objects') is not null then
    lock table public.organization_runtime_erasure_objects in share mode nowait;
  end if;
  if to_regclass('public.log_object_writes') is not null then
    lock table public.log_object_writes,parameter_catalog.organization_log_erasure_objects in share mode nowait;
  end if;
  return exists(select 1 from (
    select store,object_ref from parameter_catalog.organization_deletion_object_references()
    except all select 'plane',storage_key from public.knowledge_attachment_writes where erasure_id=p_id
  ) refs where object_ref=p_key and store in ('plane','unknown'));
end $$;
alter function public.knowledge_erasure_object_referenced(text,text,text) owner to catalog_migration_owner;
revoke all on function public.knowledge_erasure_object_referenced(text,text,text) from public;

do $$ declare role_name text; begin
  for role_name in select rolname from pg_roles where not rolsuper and has_table_privilege(oid,'public.users','UPDATE')
    and pg_has_role(oid,'catalog_publication_coordinator_role','MEMBER')
  loop
    execute format('grant select,insert,update,delete on public.knowledge_attachment_writes to %I',role_name);
    execute format('grant execute on function public.knowledge_erasure_object_referenced(text,text,text) to %I',role_name);
  end loop;
end $$;

-- Extend the existing typed inventory and physical reference union, not its
-- authorization or negative-inventory policy.
do $$ declare installed text; changed text; begin
  select pg_get_functiondef('parameter_catalog.preview_organization_deletion_0276(text,text)'::regprocedure) into strict installed;
  changed:=replace(installed,'(''public.knowledge_chunks'',''knowledge'',',
    '(''public.knowledge_attachment_writes'',''knowledge'',''r.organization_id=$1''),'||chr(10)||'    (''public.knowledge_chunks'',''knowledge'',');
  if changed=installed or position('public.knowledge_attachment_writes' in changed)=0 then raise exception 'Knowledge inventory seam unavailable'; end if;
  execute changed;
  select pg_get_functiondef('parameter_catalog.organization_deletion_object_references()'::regprocedure) into strict installed;
  changed:=replace(installed,'select organization_id,''plane'',storage_key from public.knowledge_files',
    'select organization_id,''plane'',storage_key from public.knowledge_files union all select organization_id,''plane'',storage_key from public.knowledge_attachment_writes');
  if changed=installed then raise exception 'Typed knowledge storage seam unavailable'; end if;
  execute changed;
end $$;
