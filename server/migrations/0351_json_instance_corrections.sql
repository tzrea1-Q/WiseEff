-- An association correction supersedes a live occurrence. Exact occurrence,
-- Binding, value and source-pin history stays owned by the original identity.
create table parameter_catalog.json_instance_corrections (
  previous_occurrence_id text primary key references parameter_catalog.project_parameter_source_occurrences(id) on delete cascade,
  successor_occurrence_id text not null unique references parameter_catalog.project_parameter_source_occurrences(id) on delete cascade,
  request_id text not null,
  check (previous_occurrence_id<>successor_occurrence_id)
);
alter table parameter_catalog.json_instance_corrections owner to catalog_migration_owner;

create function parameter_catalog.assert_json_instance_correction()
returns trigger language plpgsql security definer set search_path=pg_catalog,parameter_catalog,public as $$
begin
  if not exists (
    select 1 from parameter_catalog.project_parameter_source_occurrences previous
    join parameter_catalog.project_parameter_source_occurrences successor
      on successor.organization_id=previous.organization_id and successor.project_id=previous.project_id
      and successor.config_set_id=previous.config_set_id and successor.file_id=previous.file_id
      and successor.occurrence_kind='json' and successor.id=new.successor_occurrence_id
    join public.project_parameter_value_change_requests request
      on request.id=new.request_id and request.organization_id=previous.organization_id
      and request.project_id=previous.project_id and request.source_revision_config_set_id=previous.config_set_id
      and request.request_kind='member_addition' and request.status='approved'
      and request.source_revision_context->'jsonCorrection'->>'previousOccurrenceId'=previous.id
      and request.applied_source_result->'jsonCorrection'->>'previousOccurrenceId'=previous.id
      and request.applied_source_result->'jsonCorrection'->>'successorOccurrenceId'=successor.id
    join public.audit_events audit on audit.id=request.applied_audit_ref
      and audit.metadata->>'operation'='correct_json_instance'
      and audit.metadata->'result'=request.applied_source_result
    where previous.id=new.previous_occurrence_id and previous.occurrence_kind='json'
      and request.source_revision_context->'jsonCorrection'->>'subjectId'=successor.configuration_schema_subject_id
      and request.source_revision_context->'jsonCorrection'->>'rootPointer'=successor.root_pointer
  ) then
    raise exception using errcode='23514',message='JSON correction requires an exact audited source receipt';
  end if;
  return null;
end $$;
alter function parameter_catalog.assert_json_instance_correction() owner to catalog_migration_owner;
revoke all on function parameter_catalog.assert_json_instance_correction() from public;
create constraint trigger json_instance_correction_receipt after insert on parameter_catalog.json_instance_corrections
  deferrable initially deferred for each row execute function parameter_catalog.assert_json_instance_correction();

do $$
declare view_sql text; options text[]; api_name text;
begin
  select pg_get_viewdef(oid,true),reloptions into strict view_sql,options from pg_class
    where oid='parameter_catalog.current_project_parameter_bindings'::regclass;
  execute 'create or replace view parameter_catalog.current_project_parameter_bindings'
    ||case when coalesce(cardinality(options),0)>0 then ' with ('||array_to_string(options,',')||')' else '' end
    ||' as '||rtrim(view_sql,E';\n\r ')||' and not exists (
      select 1 from parameter_catalog.json_instance_corrections correction
      where correction.previous_occurrence_id=binding.source_occurrence_id)';

  -- Existing database-local API logins already own the exact source insert capability.
  for api_name in select distinct role.rolname from pg_roles role
    join information_schema.role_table_grants authority on authority.grantee=role.rolname
    where role.rolcanlogin and not role.rolsuper and not role.rolinherit
      and (shobj_description(role.oid,'pg_authid')='wiseeff-publication-runtime:official'
        or shobj_description(role.oid,'pg_authid') ~ '^wiseeff-publication-runtime:lab:[a-z0-9]{6,24}$')
      and authority.table_schema='parameter_catalog' and authority.table_name='project_value_source_pins'
      and authority.privilege_type='INSERT'
  loop
    execute format('grant select,insert on parameter_catalog.json_instance_corrections to %I',api_name);
  end loop;
end $$;
