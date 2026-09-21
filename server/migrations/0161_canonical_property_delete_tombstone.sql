-- Canonical property deletion keeps the Binding/value/history identities while
-- pinning the new current value to the exact DTS delete effect that removed the
-- property.  The 0151 migration remains immutable; this is an additive successor.

alter table parameter_catalog.project_parameter_values
  add column if not exists value_state text not null default 'present';
alter table parameter_catalog.project_parameter_values
  drop constraint if exists project_parameter_values_value_state_ck;
alter table parameter_catalog.project_parameter_values
  add constraint project_parameter_values_value_state_ck check (value_state in ('present', 'deleted'));

alter table parameter_catalog.project_value_source_pins
  add column if not exists value_state text not null default 'present',
  add column if not exists base_source_pin_id text,
  add column if not exists delete_request_id text,
  add column if not exists delete_proof jsonb;
alter table parameter_catalog.project_value_source_pins
  drop constraint if exists project_value_source_pin_delete_state_ck;
alter table parameter_catalog.project_value_source_pins
  add constraint project_value_source_pin_delete_state_ck check (
    (value_state = 'present' and base_source_pin_id is null and delete_request_id is null and delete_proof is null)
    or (value_state = 'deleted' and base_source_pin_id is not null and delete_request_id is not null and delete_proof is not null)
  );
create unique index if not exists project_parameter_value_change_requests_id_owner_binding_uk
  on public.project_parameter_value_change_requests (id, organization_id, project_id, binding_id);
alter table parameter_catalog.project_value_source_pins
  drop constraint if exists project_value_source_pin_delete_base_fk,
  drop constraint if exists project_value_source_pin_delete_request_fk;
alter table parameter_catalog.project_value_source_pins
  add constraint project_value_source_pin_delete_base_fk
    foreign key (base_source_pin_id, organization_id, project_id, binding_id)
    references parameter_catalog.project_value_source_pins(id, organization_id, project_id, binding_id)
    deferrable initially deferred,
  add constraint project_value_source_pin_delete_request_fk
    foreign key (delete_request_id, organization_id, project_id, binding_id)
    references public.project_parameter_value_change_requests(id, organization_id, project_id, binding_id)
    deferrable initially deferred;

create or replace function parameter_catalog.canonical_dts_delete_locator_digest(locator jsonb)
returns text
language sql
immutable
strict
set search_path = pg_catalog, parameter_catalog
as $$
  select 'sha256:' || encode(
    pg_catalog.sha256(convert_to(
      concat(
        '{', chr(10),
        '  "fileVersionId": ', to_json(locator ->> 'fileVersionId')::text, ',', chr(10),
        '  "kind": ', to_json(locator ->> 'kind')::text, ',', chr(10),
        '  "nodeOccurrenceId": ', to_json(locator ->> 'nodeOccurrenceId')::text, ',', chr(10),
        '  "propertyName": ', to_json(locator ->> 'propertyName')::text, chr(10),
        '}', chr(10)
      ),
      'UTF8'
    )),
    'hex'
  )
$$;

create or replace function parameter_catalog.canonical_json_delete_locator_digest(locator jsonb)
returns text
language sql
immutable
strict
set search_path = pg_catalog, parameter_catalog
as $$
  select 'sha256:' || encode(pg_catalog.sha256(convert_to(concat(
    '{', chr(10),
    '  "fileVersionId": ', to_json(locator ->> 'fileVersionId')::text, ',', chr(10),
    '  "kind": ', to_json(locator ->> 'kind')::text, ',', chr(10),
    '  "memberKey": ', to_json(locator ->> 'memberKey')::text, ',', chr(10),
    '  "parentPointer": ', to_json(locator ->> 'parentPointer')::text, ',', chr(10),
    '  "pointer": ', to_json(locator ->> 'pointer')::text, ',', chr(10),
    '  "rootPointer": ', to_json(locator ->> 'rootPointer')::text, chr(10),
    '}', chr(10)
  ), 'UTF8')), 'hex')
$$;

alter table parameter_catalog.project_value_source_pins
  drop constraint if exists project_value_source_pin_locator_ck;

alter table parameter_catalog.project_value_source_pins
  add constraint project_value_source_pin_locator_ck check (
    (format = 'dts'
      and property_occurrence_id is not null
      and locator->>'kind' = 'dts-property'
      and locator = jsonb_build_object(
        'kind', 'dts-property',
        'propertyOccurrenceId', locator->>'propertyOccurrenceId',
        'nodeOccurrenceId', locator->>'nodeOccurrenceId',
        'fileVersionId', locator->>'fileVersionId',
        'propertyName', locator->>'propertyName'
      )
      and btrim(coalesce(locator->>'propertyOccurrenceId', '')) <> ''
      and btrim(coalesce(locator->>'nodeOccurrenceId', '')) <> ''
      and btrim(coalesce(locator->>'fileVersionId', '')) <> ''
      and btrim(coalesce(locator->>'propertyName', '')) <> '')
    or
    (format = 'dts'
      and property_occurrence_id is null
      and locator->>'kind' = 'dts-delete'
      and locator = jsonb_build_object(
        'kind', 'dts-delete',
        'nodeOccurrenceId', locator->>'nodeOccurrenceId',
        'fileVersionId', locator->>'fileVersionId',
        'propertyName', locator->>'propertyName'
      )
      and btrim(coalesce(locator->>'nodeOccurrenceId', '')) <> ''
      and btrim(coalesce(locator->>'fileVersionId', '')) <> ''
      and btrim(coalesce(locator->>'propertyName', '')) <> '')
    or
    (format = 'json'
      and property_occurrence_id is null
      and locator->>'kind' = 'json-pointer'
      and locator = jsonb_build_object(
        'kind', 'json-pointer',
        'pointer', locator->>'pointer'
      )
      and locator->>'pointer' is not null
      and (locator->>'pointer' = '' or locator->>'pointer' ~ '^(/([^~/]|~0|~1)*)+$'))
    or
    (format = 'json'
      and property_occurrence_id is null
      and locator->>'kind' = 'json-delete'
      and locator = jsonb_build_object(
        'kind', 'json-delete', 'rootPointer', locator->>'rootPointer',
        'pointer', locator->>'pointer', 'parentPointer', locator->>'parentPointer',
        'memberKey', locator->>'memberKey', 'fileVersionId', locator->>'fileVersionId')
      and locator->>'rootPointer' is not null
      and locator->>'pointer' is not null
      and locator->>'parentPointer' is not null
      and locator->>'memberKey' is not null
      and locator->>'fileVersionId' is not null
      and (locator->>'pointer' = '' or locator->>'pointer' ~ '^(/([^~/]|~0|~1)*)+$'))
  );

alter table parameter_catalog.project_value_source_pins
  drop constraint if exists project_value_source_pin_delete_proof_ck;
alter table parameter_catalog.project_value_source_pins
  add constraint project_value_source_pin_delete_proof_ck check (
    (value_state = 'present' and delete_proof is null)
    or
    (value_state = 'deleted'
      and delete_proof is not null
      and delete_proof->>'kind' is not null
      and delete_proof->>'scannerVersion' is not null
      and (
        (format = 'dts' and delete_proof = jsonb_build_object(
          'kind', delete_proof->>'kind', 'scannerVersion', delete_proof->>'scannerVersion',
          'nodeOccurrenceId', delete_proof->>'nodeOccurrenceId', 'propertyName', delete_proof->>'propertyName',
          'beforeValueDigest', delete_proof->>'beforeValueDigest', 'beforeSourceDigest', delete_proof->>'beforeSourceDigest',
          'afterSourceDigest', delete_proof->>'afterSourceDigest')
          and delete_proof->>'kind' = 'dts-delete-v1' and delete_proof->>'scannerVersion' = 'dts-cst-v1'
          and delete_proof->>'beforeValueDigest' ~ '^sha256:[0-9a-f]{64}$'
          and delete_proof->>'beforeSourceDigest' ~ '^sha256:[0-9a-f]{64}$'
          and delete_proof->>'afterSourceDigest' ~ '^sha256:[0-9a-f]{64}$')
        or
        (format = 'json' and delete_proof = jsonb_build_object(
          'kind', delete_proof->>'kind', 'scannerVersion', delete_proof->>'scannerVersion',
          'rootPointer', delete_proof->>'rootPointer', 'pointer', delete_proof->>'pointer',
          'parentPointer', delete_proof->>'parentPointer', 'memberKey', delete_proof->>'memberKey',
          'beforeValueDigest', delete_proof->>'beforeValueDigest', 'beforeSourceDigest', delete_proof->>'beforeSourceDigest',
          'afterSourceDigest', delete_proof->>'afterSourceDigest')
          and delete_proof->>'kind' = 'json-delete-v1' and delete_proof->>'scannerVersion' = 'json-span-v1'
          and delete_proof->>'beforeValueDigest' ~ '^sha256:[0-9a-f]{64}$'
          and delete_proof->>'beforeSourceDigest' ~ '^sha256:[0-9a-f]{64}$'
          and delete_proof->>'afterSourceDigest' ~ '^sha256:[0-9a-f]{64}$')
      )
    )
  );

create or replace function parameter_catalog.assert_project_value_source_pin_owner()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, parameter_catalog
as $$
declare
  binding_occurrence text;
  value_binding text;
  value_definition text;
  value_config_revision text;
  current_value_state text;
  pin_provenance_valid boolean;
begin
  select value.binding_id, value.definition_id, value.config_revision_id, value.value_state
    into value_binding, value_definition, value_config_revision, current_value_state
  from parameter_catalog.project_parameter_values value
  where value.id = new.project_value_id;
  select binding.source_occurrence_id into binding_occurrence
  from parameter_catalog.project_parameter_bindings binding
  where binding.id = new.binding_id
    and binding.organization_id = new.organization_id
    and binding.project_id = new.project_id;
  if value_binding is distinct from new.binding_id
     or value_definition is distinct from new.definition_id
     or binding_occurrence is distinct from new.source_occurrence_id then
    raise exception using errcode = '23503', message = 'ProjectValue source pin owner mismatch';
  end if;

  select exists (
    select 1
    from parameter_catalog.project_value_source_pins pin
    join parameter_catalog.project_parameter_bindings binding
      on binding.id = pin.binding_id
     and binding.organization_id = pin.organization_id
     and binding.project_id = pin.project_id
    join parameter_catalog.project_parameter_values value
      on value.id = pin.project_value_id
     and value.binding_id = pin.binding_id
     and value.definition_id = pin.definition_id
    join parameter_catalog.project_parameter_source_occurrences occurrence
      on occurrence.id = pin.source_occurrence_id
     and occurrence.organization_id = pin.organization_id
     and occurrence.project_id = pin.project_id
    join public.dts_config_revisions revision
      on revision.id = pin.config_revision_id
     and revision.organization_id = pin.organization_id
     and revision.project_id = pin.project_id
     and revision.config_set_id = occurrence.config_set_id
    join public.dts_config_revision_members member
      on member.config_revision_id = pin.config_revision_id
     and member.file_id = pin.file_id
     and member.file_version_id = pin.file_version_id
     and member.source_name is not null
    join public.project_parameter_file_versions file_version
      on file_version.id = pin.file_version_id
     and file_version.file_id = pin.file_id
    join public.project_parameter_files file
      on file.id = pin.file_id
     and file.organization_id = pin.organization_id
     and file.project_id = pin.project_id
     and file.config_set_id = occurrence.config_set_id
     and file.id = occurrence.file_id
    join parameter_catalog.parameter_definitions definition
      on definition.id = pin.definition_id
    where pin.id = new.id
      and pin.project_value_id = new.project_value_id
      and pin.binding_id = new.binding_id
      and pin.definition_id = new.definition_id
      and pin.organization_id = new.organization_id
      and pin.project_id = new.project_id
      and pin.source_occurrence_id = binding_occurrence
      and pin.config_revision_id = value_config_revision
      and pin.value_state = current_value_state
      and (pin.value_state = 'present' or exists (
        select 1
        from parameter_catalog.project_value_source_pins base_pin
        join parameter_catalog.project_parameter_values base_value on base_value.id=base_pin.project_value_id
        join public.project_parameter_value_change_requests request
          on request.id=pin.delete_request_id and request.organization_id=pin.organization_id
         and request.project_id=pin.project_id and request.binding_id=pin.binding_id
        join parameter_catalog.binding_history_events history
          on history.id=request.applied_history_event_id and history.binding_id=pin.binding_id
         and history.old_current_value_id=base_value.id and history.new_current_value_id=value.id
         and history.success_audit_ref=request.applied_audit_ref
        join public.audit_events audit on audit.id=request.applied_audit_ref
          and audit.organization_id=pin.organization_id and audit.project_id=pin.project_id
          and audit.target_id=request.id and audit.action='value-change-applied'
        join public.project_parameter_file_candidates candidate on candidate.id=request.candidate_id
          and candidate.organization_id=pin.organization_id and candidate.project_id=pin.project_id
          and candidate.file_id=pin.file_id and candidate.base_version_id=base_pin.file_version_id
          and candidate.status='active' and candidate.activated_version_id=pin.file_version_id
        where base_pin.id=pin.base_source_pin_id and base_pin.value_state='present'
          and base_value.value_state='present' and base_value.value_kind=value.value_kind
          and base_value.value=value.value and base_value.value_digest=value.value_digest
          and base_pin.organization_id=pin.organization_id and base_pin.project_id=pin.project_id
          and base_pin.binding_id=pin.binding_id and base_pin.definition_id=pin.definition_id
          and base_pin.source_occurrence_id=pin.source_occurrence_id and base_pin.file_id=pin.file_id
          and base_pin.format=pin.format and pin.locator->>'fileVersionId'=pin.file_version_id
          and request.source_pin_id=base_pin.id and request.base_current_value_id=base_value.id
          and request.config_revision_id=base_pin.config_revision_id
          and request.action='delete' and request.status='approved' and request.applied_value_id=value.id
          and candidate.base_digest=request.candidate_base_digest
          and candidate.proposed_digest=request.candidate_proposed_digest
          and candidate.diff_digest=request.candidate_diff_digest
          and candidate.frozen_member_manifest=request.candidate_member_manifest
          and candidate.frozen_binding_manifest=request.candidate_binding_manifest
          and audit.metadata->'result'=request.applied_source_result
          and request.applied_source_result->'bindings' @> jsonb_build_array(jsonb_build_object(
            'kind','target','bindingId',pin.binding_id,'oldValueId',base_value.id,'newValueId',value.id,
            'sourcePinId',pin.id,'configRevisionId',pin.config_revision_id,'fileVersionId',pin.file_version_id,
            'historyEventId',history.id,'action','delete','valueState','deleted'))
          and (pin.format='dts' or (
            base_pin.locator->>'pointer'=pin.locator->>'pointer'
            and pin.locator->>'pointer' <> occurrence.root_pointer
            and pin.locator->>'parentPointer'=regexp_replace(pin.locator->>'pointer','/[^/]*$','')
            and pin.locator->>'memberKey'=replace(replace(
              regexp_replace(pin.locator->>'pointer','^.*/',''),'~1','/'),'~0','~')
          ))
      ))
      and not exists (
        select 1
        from public.dts_config_revision_members missing_member
        where missing_member.config_revision_id = pin.config_revision_id
          and missing_member.source_name is null
      )
      and (
        (
          pin.format = 'dts'
          and pin.value_state = 'present'
          and occurrence.occurrence_kind = 'dts'
          and pin.property_occurrence_id is not null
          and exists (
            select 1
            from public.dts_property_occurrences property
            join public.dts_node_occurrences node
              on node.id = property.node_occurrence_id
             and node.config_revision_id = property.config_revision_id
             and node.file_version_id = property.file_version_id
            join public.dts_occurrence_effects effect
              on effect.property_occurrence_id = property.id
             and effect.node_occurrence_id = node.id
             and effect.config_revision_id = property.config_revision_id
            join public.dts_logical_node_revisions logical_revision
              on logical_revision.id = effect.logical_node_revision_id
             and logical_revision.logical_node_id = occurrence.logical_node_id
             and logical_revision.config_revision_id = property.config_revision_id
            where property.id = pin.property_occurrence_id
              and property.config_revision_id = pin.config_revision_id
              and property.file_version_id = pin.file_version_id
              and property.property_name = definition.property_key
              and property.property_name = pin.locator->>'propertyName'
              and pin.locator->>'propertyOccurrenceId' = property.id
              and pin.locator->>'nodeOccurrenceId' = node.id
              and pin.locator->>'fileVersionId' = property.file_version_id
          )
        )
        or
        (
          pin.format = 'dts'
          and pin.value_state = 'deleted'
          and occurrence.occurrence_kind = 'dts'
          and pin.property_occurrence_id is null
          and pin.locator->>'kind' = 'dts-delete'
          and pin.locator = jsonb_build_object(
            'kind', 'dts-delete',
            'nodeOccurrenceId', pin.locator->>'nodeOccurrenceId',
            'fileVersionId', pin.locator->>'fileVersionId',
            'propertyName', pin.locator->>'propertyName'
          )
          and pin.locator->>'nodeOccurrenceId' is not null
          and pin.locator->>'fileVersionId' = pin.file_version_id
          and pin.locator->>'propertyName' = definition.property_key
          and pin.locator_digest = parameter_catalog.canonical_dts_delete_locator_digest(pin.locator)
          and pin.delete_proof->>'nodeOccurrenceId' = pin.locator->>'nodeOccurrenceId'
          and pin.delete_proof->>'propertyName' = pin.locator->>'propertyName'
          and pin.delete_proof->>'beforeValueDigest' = (
            select old_value.value_digest from parameter_catalog.project_value_source_pins base_pin
            join parameter_catalog.project_parameter_values old_value on old_value.id=base_pin.project_value_id
            where base_pin.id=pin.base_source_pin_id)
          and pin.delete_proof->>'beforeSourceDigest' = (
            select case when base_file_version.checksum like 'sha256:%' then base_file_version.checksum else 'sha256:' || base_file_version.checksum end
              from parameter_catalog.project_value_source_pins base_pin
              join public.project_parameter_file_versions base_file_version on base_file_version.id=base_pin.file_version_id and base_file_version.file_id=base_pin.file_id
             where base_pin.id=pin.base_source_pin_id)
          and pin.delete_proof->>'afterSourceDigest' = case when file_version.checksum like 'sha256:%' then file_version.checksum else 'sha256:' || file_version.checksum end
          and exists (
            select 1 from parameter_catalog.project_value_source_pins base_pin
            join public.project_parameter_value_change_requests request
              on request.id = pin.delete_request_id
             and request.organization_id = pin.organization_id
             and request.project_id = pin.project_id
             and request.binding_id = pin.binding_id
            where base_pin.id = pin.base_source_pin_id
              and base_pin.binding_id = pin.binding_id
              and base_pin.project_value_id = request.base_current_value_id
              and request.action = 'delete'
              and request.status = 'approved'
          )
          and (
            select count(*)
            from public.dts_occurrence_effects effect
            join public.dts_node_occurrences node
              on node.id = effect.node_occurrence_id
             and node.config_revision_id = effect.config_revision_id
             and node.file_version_id = pin.file_version_id
            join public.dts_logical_node_revisions logical_revision
              on logical_revision.id = effect.logical_node_revision_id
             and logical_revision.config_revision_id = effect.config_revision_id
             and logical_revision.logical_node_id = occurrence.logical_node_id
            where effect.config_revision_id = pin.config_revision_id
              and effect.property_name = definition.property_key
              and effect.effect_kind = 'delete'
              and effect.property_occurrence_id is null
              and node.id = pin.locator->>'nodeOccurrenceId'
              and not exists (
                select 1
                from public.dts_occurrence_effects later
                where later.config_revision_id = effect.config_revision_id
                  and later.logical_node_revision_id = effect.logical_node_revision_id
                  and later.property_name = effect.property_name
                  and (later.source_order > effect.source_order
                    or (later.source_order = effect.source_order and later.id <> effect.id))
              )
          ) = 1
        )
        or
        (
          pin.format = 'json'
          and pin.value_state = 'present'
          and occurrence.occurrence_kind = 'json'
          and pin.property_occurrence_id is null
          and revision.config_set_id = occurrence.config_set_id
          and exists (
            select 1
            from parameter_catalog.organization_subject_registrations registration
            where registration.organization_id = pin.organization_id
              and registration.subject_id = occurrence.configuration_schema_subject_id
              and registration.status = 'active'
          )
          and pin.locator->>'kind' = 'json-pointer'
          and occurrence.configuration_schema_subject_id = binding.subject_id
          and parameter_catalog.json_pointer_contains(
            occurrence.root_pointer,
            pin.locator->>'pointer'
          )
        )
        or
        (
          pin.format = 'json'
          and pin.value_state = 'deleted'
          and occurrence.occurrence_kind = 'json'
          and pin.property_occurrence_id is null
          and pin.locator->>'kind' = 'json-delete'
          and pin.locator_digest = parameter_catalog.canonical_json_delete_locator_digest(pin.locator)
          and occurrence.configuration_schema_subject_id = binding.subject_id
          and pin.locator->>'rootPointer' = occurrence.root_pointer
          and pin.delete_proof->>'rootPointer' = pin.locator->>'rootPointer'
          and pin.delete_proof->>'pointer' = pin.locator->>'pointer'
          and pin.delete_proof->>'parentPointer' = pin.locator->>'parentPointer'
          and pin.delete_proof->>'memberKey' = pin.locator->>'memberKey'
          and pin.delete_proof->>'beforeValueDigest' = (
            select old_value.value_digest from parameter_catalog.project_value_source_pins base_pin
            join parameter_catalog.project_parameter_values old_value on old_value.id=base_pin.project_value_id
            where base_pin.id=pin.base_source_pin_id)
          and pin.delete_proof->>'beforeSourceDigest' = (
            select case when base_file_version.checksum like 'sha256:%' then base_file_version.checksum else 'sha256:' || base_file_version.checksum end
              from parameter_catalog.project_value_source_pins base_pin
              join public.project_parameter_file_versions base_file_version on base_file_version.id=base_pin.file_version_id and base_file_version.file_id=base_pin.file_id
             where base_pin.id=pin.base_source_pin_id)
          and pin.delete_proof->>'afterSourceDigest' = case when file_version.checksum like 'sha256:%' then file_version.checksum else 'sha256:' || file_version.checksum end
          and parameter_catalog.json_pointer_contains(occurrence.root_pointer, pin.locator->>'pointer')
          and exists (
            select 1 from parameter_catalog.project_value_source_pins base_pin
            join public.project_parameter_value_change_requests request
              on request.id = pin.delete_request_id
             and request.organization_id = pin.organization_id
             and request.project_id = pin.project_id
             and request.binding_id = pin.binding_id
            where base_pin.id = pin.base_source_pin_id
              and base_pin.binding_id = pin.binding_id
              and base_pin.project_value_id = request.base_current_value_id
              and request.action = 'delete'
              and request.status = 'approved'
          )
        )
      )
  ) into pin_provenance_valid;
  if not pin_provenance_valid then
    raise exception using errcode = '23503', message = 'ProjectValue source pin does not prove its exact revision, member and locator';
  end if;
  return null;
end;
$$;

create or replace view parameter_catalog.current_project_parameter_bindings as
select binding.*
from parameter_catalog.project_parameter_bindings binding
where not exists (
  select 1
  from parameter_catalog.definition_replacement_projects replacement
  where replacement.status = 'completed'
    and replacement.old_binding_id = binding.id
)
and not exists (
  select 1
    from parameter_catalog.project_parameter_values value
   where value.id = binding.current_value_id
     and value.value_state = 'deleted'
)
and not exists (
  select 1
  from parameter_catalog.project_parameter_values value
  join parameter_catalog.project_value_source_pins pin
    on pin.project_value_id = value.id
   and pin.binding_id = value.binding_id
  where value.id = binding.current_value_id
    and pin.locator->>'kind' in ('dts-delete', 'json-delete')
);

alter function parameter_catalog.canonical_dts_delete_locator_digest(jsonb) owner to catalog_migration_owner;
alter function parameter_catalog.canonical_json_delete_locator_digest(jsonb) owner to catalog_migration_owner;
alter function parameter_catalog.assert_project_value_source_pin_owner() owner to catalog_migration_owner;
revoke all on function parameter_catalog.canonical_dts_delete_locator_digest(jsonb)
  from public, catalog_synchronizer_role, parameter_governance_writer_role;
revoke all on function parameter_catalog.canonical_json_delete_locator_digest(jsonb)
  from public, catalog_synchronizer_role, parameter_governance_writer_role;
revoke all on function parameter_catalog.assert_project_value_source_pin_owner()
  from public, catalog_synchronizer_role, parameter_governance_writer_role;
