-- References pin an immutable upstream version; files and versions belong to one project.
create table public.project_shared_dtsi_references (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  project_id text not null references public.projects(id) on delete cascade,
  config_set_id text not null references public.dts_config_set(id) on delete cascade,
  resource_id text not null,
  revision_id text not null,
  created_by_user_id text not null,
  created_at timestamptz not null default now(),
  unique(config_set_id,resource_id),
  foreign key(revision_id,resource_id,organization_id) references public.shared_dtsi_revisions(id,resource_id,organization_id)
);
create table public.project_shared_dtsi_snapshots (
  file_id text primary key references public.project_parameter_files(id) on delete cascade,
  file_version_id text not null unique references public.project_parameter_file_versions(id),
  reference_id text not null references public.project_shared_dtsi_references(id) on delete cascade,
  revision_id text not null,
  member_id text not null,
  unique(reference_id,member_id),
  foreign key(revision_id,member_id) references public.shared_dtsi_revision_members(revision_id,member_id)
);
alter table public.dts_config_revision_members add column shared_reference jsonb;

create function public.guard_project_shared_dtsi_provenance() returns trigger language plpgsql as $$
begin
  if TG_TABLE_NAME='project_shared_dtsi_references' then
    if not exists(select 1 from public.dts_config_set s where s.id=NEW.config_set_id
      and s.project_id=NEW.project_id and s.organization_id=NEW.organization_id) then
      raise exception 'Shared reference configuration ownership mismatch';
    end if;
  elsif not exists(select 1 from public.project_shared_dtsi_references r
    join public.project_parameter_files f on f.id=NEW.file_id and f.project_id=r.project_id
      and f.organization_id=r.organization_id and f.config_set_id=r.config_set_id and f.format='dts'
    join public.project_parameter_file_versions v on v.id=NEW.file_version_id and v.file_id=f.id and v.id=f.current_version_id
    join public.shared_dtsi_revision_members m on m.revision_id=r.revision_id and m.member_id=NEW.member_id
      and m.revision_id=NEW.revision_id and m.checksum=v.checksum and m.size_bytes=v.size_bytes and m.source_name=f.file_name
    where r.id=NEW.reference_id) then
    raise exception 'Shared snapshot does not match exact published source provenance';
  end if;
  return NEW;
end $$;

-- Extend the existing receipt only for an exact shared reference plus its root include edit.
-- Keep every existing cohort/origin-transfer and historical-receipt predicate intact.
do $$ declare installed text; changed text; begin
  select pg_get_expr(conbin,conrelid) into strict installed from pg_constraint
    where conrelid='public.project_parameter_value_change_requests'::regclass and conname='project_parameter_value_change_requests_outcome_ck';
  changed:=replace(installed,'jsonb_array_length(applied_file_version_ids) = 1',
    $new$(jsonb_array_length(applied_file_version_ids) = 1 or (request_kind='member_addition'
      and source_revision_context ? 'sharedReference' and source_revision_context ? 'rootEdit'
      and jsonb_array_length(applied_file_version_ids)=2
      and applied_source_result->>'fileVersionId' is distinct from applied_source_result->>'rootFileVersionId'
      and applied_file_version_ids @> jsonb_build_array(applied_source_result->>'fileVersionId',applied_source_result->>'rootFileVersionId')))$new$);
  if changed=installed then raise exception 'Member addition version count marker unavailable'; end if;
  alter table public.project_parameter_value_change_requests drop constraint project_parameter_value_change_requests_outcome_ck;
  execute format('alter table public.project_parameter_value_change_requests add constraint project_parameter_value_change_requests_outcome_ck check (%s)',changed);
  select pg_get_functiondef('parameter_catalog.assert_member_addition_receipt()'::regprocedure) into strict installed;
  changed:=replace(installed,
    $old$case when member.file_id=result->>'fileId' then result->>'fileVersionId' else frozen->>'fileVersionId' end$old$,
    $new$case when member.file_id=result->>'fileId' then result->>'fileVersionId'
      when r.source_revision_context ? 'sharedReference' and member.file_id=r.source_revision_context->'rootEdit'->>'fileId'
        then result->>'rootFileVersionId' else frozen->>'fileVersionId' end$new$);
  if changed=installed then raise exception 'Member addition composition receipt marker unavailable'; end if;
  changed:=replace(changed,'file.config_set_role=member.role',
    'file.config_set_role=case when member.role=''include'' then ''misc'' else member.role end');
  changed:=replace(changed,$old$result := r.applied_source_result;$old$,$new$result := r.applied_source_result;
  if r.source_revision_context ? 'sharedReference' and not exists(
    select 1 from public.project_shared_dtsi_references ref
    join public.project_shared_dtsi_snapshots snapshot on snapshot.reference_id=ref.id
      and snapshot.file_id=result->>'fileId' and snapshot.file_version_id=result->>'fileVersionId'
      and snapshot.member_id=r.source_revision_context->'sharedReference'->>'memberId'
    join public.dts_config_revision_members root on root.config_revision_id=result->>'configRevisionId'
      and root.file_id=r.source_revision_context->'rootEdit'->>'fileId' and root.file_version_id=result->>'rootFileVersionId'
      and root.role='base'
    join public.project_parameter_file_versions after_version on after_version.id=root.file_version_id and after_version.file_id=root.file_id
      and regexp_replace(after_version.checksum,'^sha256:','')=encode(sha256(convert_to(r.source_revision_context->'rootEdit'->>'after','UTF8')),'hex')
    join public.project_parameter_file_versions before_version on before_version.id=r.source_revision_context->'rootEdit'->>'baseFileVersionId'
      and before_version.file_id=root.file_id
      and regexp_replace(before_version.checksum,'^sha256:','')=encode(sha256(convert_to(r.source_revision_context->'rootEdit'->>'before','UTF8')),'hex')
    where ref.organization_id=r.organization_id and ref.project_id=r.project_id and ref.config_set_id=r.source_revision_config_set_id
      and ref.resource_id=r.source_revision_context->'sharedReference'->>'resourceId'
      and ref.revision_id=r.source_revision_context->'sharedReference'->>'versionId'
  ) then raise exception using errcode='23514',message='Shared reference has no exact root/source receipt'; end if;$new$);
  execute changed;
end $$;
create trigger project_shared_reference_provenance before insert on public.project_shared_dtsi_references
  for each row execute function public.guard_project_shared_dtsi_provenance();
create trigger project_shared_snapshot_provenance before insert on public.project_shared_dtsi_snapshots
  for each row execute function public.guard_project_shared_dtsi_provenance();

create function public.guard_project_shared_dtsi_source() returns trigger language plpgsql security definer set search_path=pg_catalog,public,parameter_catalog as $$
declare target_file text;
begin
  if TG_OP in ('UPDATE','DELETE') and current_user='catalog_migration_owner' then
    if parameter_catalog.definition_purge_allows_change(TG_TABLE_SCHEMA,TG_TABLE_NAME,to_jsonb(OLD),TG_OP) then
      if TG_OP='DELETE' then return OLD; else return NEW; end if;
    end if;
  end if;
  if TG_TABLE_NAME='project_parameter_files' then
    target_file=OLD.id;
    if TG_OP='UPDATE' and (to_jsonb(NEW)-'updated_at')=(to_jsonb(OLD)-'updated_at') then return NEW; end if;
  else
    if TG_OP='INSERT' then target_file=NEW.file_id; else target_file=OLD.file_id; end if;
  end if;
  if exists(select 1 from public.project_shared_dtsi_snapshots where file_id=target_file
    or (TG_OP='UPDATE' and file_id=to_jsonb(NEW)->>'file_id')) then
    raise exception using errcode='55000',message='Shared reference source is read-only';
  end if;
  if TG_OP='DELETE' then return OLD; else return NEW; end if;
end $$;
create trigger project_shared_source_readonly before update or delete on public.project_parameter_files
  for each row execute function public.guard_project_shared_dtsi_source();
create trigger project_shared_version_readonly before insert or update or delete on public.project_parameter_file_versions
  for each row execute function public.guard_project_shared_dtsi_source();

create function public.freeze_project_shared_dtsi_member() returns trigger language plpgsql as $$
begin
  select jsonb_build_object('referenceId',r.id,'resourceId',r.resource_id,'versionId',r.revision_id,
    'version',v.version,'memberId',s.member_id,'digest',v.digest,'readOnly',true)
    into NEW.shared_reference from public.project_shared_dtsi_snapshots s
    join public.project_shared_dtsi_references r on r.id=s.reference_id
    join public.shared_dtsi_revisions v on v.id=r.revision_id
    where s.file_id=NEW.file_id and s.file_version_id=NEW.file_version_id;
  if exists(select 1 from public.project_shared_dtsi_snapshots where file_id=NEW.file_id)
    and NEW.shared_reference is null then raise exception 'Shared manifest source version mismatch'; end if;
  return NEW;
end $$;
create trigger project_shared_manifest_provenance before insert on public.dts_config_revision_members
  for each row execute function public.freeze_project_shared_dtsi_member();

-- The relationships and immutable provenance survive every later project revision.
create function public.guard_project_shared_dtsi_identity() returns trigger language plpgsql security definer set search_path=pg_catalog,public,parameter_catalog as $$
begin
  if current_user='catalog_migration_owner' and parameter_catalog.definition_purge_allows_change(TG_TABLE_SCHEMA,TG_TABLE_NAME,to_jsonb(OLD),TG_OP) then
    if TG_OP='DELETE' then return OLD; else return NEW; end if;
  end if;
  raise exception using errcode='55000',message='Shared reference provenance is immutable';
end $$;

-- Add only these owned rows to the established human-authorized project erasure closure.
grant select,delete on public.project_shared_dtsi_references,public.project_shared_dtsi_snapshots to catalog_migration_owner;
do $$ declare installed text; changed text; begin
  select pg_get_functiondef('parameter_catalog.purge_project(text,text,text,text)'::regprocedure) into strict installed;
  changed:=replace(installed,$old$(40,'public.dts_config_revision_members'$old$,
    $new$(38.1,'public.project_shared_dtsi_snapshots','reference_id in(select id from public.project_shared_dtsi_references where organization_id=$1 and project_id=$2)'),
    (38.2,'public.project_shared_dtsi_references','organization_id=$1 and project_id=$2'),
    (40,'public.dts_config_revision_members'$new$);
  if changed=installed then raise exception 'Project erasure ownership marker unavailable'; end if;
  execute changed;
  select pg_get_functiondef('parameter_catalog.lock_project_erasure(text,text,text)'::regprocedure) into strict installed;
  changed:=replace(installed,'lock table parameter_catalog.binding_history_events,',
    'lock table public.project_shared_dtsi_references,public.project_shared_dtsi_snapshots,parameter_catalog.binding_history_events,');
  if changed=installed then raise exception 'Project erasure lock marker unavailable'; end if;
  execute changed;
end $$;
create trigger project_shared_reference_immutable before update or delete on public.project_shared_dtsi_references
  for each row execute function public.guard_project_shared_dtsi_identity();
create trigger project_shared_snapshot_immutable before update or delete on public.project_shared_dtsi_snapshots
  for each row execute function public.guard_project_shared_dtsi_identity();
create trigger project_shared_manifest_immutable before update on public.dts_config_revision_members
  for each row when(OLD.shared_reference is not null or NEW.shared_reference is not null)
  execute function public.guard_project_shared_dtsi_identity();
create trigger project_shared_manifest_retained before delete on public.dts_config_revision_members
  for each row when(OLD.shared_reference is not null) execute function public.guard_project_shared_dtsi_identity();
create trigger organization_lifecycle_guard before insert or update or delete on public.project_shared_dtsi_references
  for each row execute function public.guard_organization_lifecycle();
alter function public.guard_project_shared_dtsi_source() owner to catalog_migration_owner;
alter function public.guard_project_shared_dtsi_identity() owner to catalog_migration_owner;
revoke all on function public.guard_project_shared_dtsi_source(),public.guard_project_shared_dtsi_identity() from public;
do $$ declare source_grant record; target text; begin
  for source_grant in select grantee,privilege_type from information_schema.role_table_grants
    where table_schema='public' and table_name='project_parameter_files' and privilege_type in ('SELECT','INSERT') and grantee<>'PUBLIC'
  loop
    foreach target in array array['project_shared_dtsi_references','project_shared_dtsi_snapshots'] loop
      execute format('grant %s on public.%I to %I',source_grant.privilege_type,target,source_grant.grantee);
    end loop;
  end loop;
end $$;
