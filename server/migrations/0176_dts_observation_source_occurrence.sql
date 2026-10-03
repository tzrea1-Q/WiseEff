-- #897: let the API's explicitly assumed governance role bind a DTS observation
-- to an exact persisted revision member without Catalog table DML privileges.
create function parameter_catalog.ensure_dts_observation_source_occurrence(
  requested_id text, owner_organization_id text, owner_project_id text,
  owner_config_set_id text, owner_file_id text, owner_logical_node_id text,
  source_revision_id text, source_file_version_id text
) returns text language plpgsql security definer
set search_path = pg_catalog, parameter_catalog as $$
declare occurrence_id text;
begin
  if not exists (
    select 1 from public.dts_config_revisions revision
    join public.dts_config_revision_members member
      on member.config_revision_id=revision.id
      and member.file_id=owner_file_id
      and member.file_version_id=source_file_version_id
    join public.project_parameter_files file
      on file.id=member.file_id and file.organization_id=revision.organization_id
      and file.project_id=revision.project_id and file.config_set_id=revision.config_set_id
      and file.current_version_id=member.file_version_id and file.format='dts'
    join public.dts_logical_node_revisions logical
      on logical.config_revision_id=revision.id and logical.logical_node_id=owner_logical_node_id
    where revision.id=source_revision_id and revision.organization_id=owner_organization_id
      and revision.project_id=owner_project_id and revision.config_set_id=owner_config_set_id
      and revision.manifest_state='complete'
  ) then
    raise exception using errcode='23514', message='DTS observation source is not an exact current revision member';
  end if;

  insert into parameter_catalog.project_parameter_source_occurrences
    (id,organization_id,project_id,config_set_id,file_id,occurrence_kind,logical_node_id)
  values (requested_id,owner_organization_id,owner_project_id,owner_config_set_id,
    owner_file_id,'dts',owner_logical_node_id)
  on conflict do nothing;
  select id into occurrence_id
    from parameter_catalog.project_parameter_source_occurrences
    where organization_id=owner_organization_id and project_id=owner_project_id
      and config_set_id=owner_config_set_id and file_id=owner_file_id
      and occurrence_kind='dts' and logical_node_id=owner_logical_node_id;
  if occurrence_id is null then
    raise exception using errcode='23514', message='DTS observation source occurrence is ambiguous';
  end if;
  return occurrence_id;
end;
$$;
alter function parameter_catalog.ensure_dts_observation_source_occurrence(
  text,text,text,text,text,text,text,text) owner to catalog_migration_owner;
revoke all on function parameter_catalog.ensure_dts_observation_source_occurrence(
  text,text,text,text,text,text,text,text) from public;
grant execute on function parameter_catalog.ensure_dts_observation_source_occurrence(
  text,text,text,text,text,text,text,text) to parameter_governance_writer_role;
