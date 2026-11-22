import type { Queryable } from "../../../shared/database/client";
import { ApiError } from "../../../shared/http/errors";
import type { ContractJsonValue } from "../../parameter-catalog-contract";
import { currentManagedSourceBindingPredicate } from "./currentManagedBindings";

type JsonFileInstanceRow = {
  occurrenceId: string; configurationInstanceId: string; subjectId: string; rootPointer: string;
  bindings: Array<{ bindingId: string; valueId: string; definitionId: string; pointer: string; value: ContractJsonValue }>;
};

export async function selectCurrentJsonInstancesForFile(
  db: Queryable,
  file: { organizationId: string; projectId: string; configSetId: string; fileId: string; fileVersionId: string },
) {
  const result = await db.query<JsonFileInstanceRow>(`
    select occurrence.id as "occurrenceId",occurrence.configuration_instance_id as "configurationInstanceId",
      occurrence.configuration_schema_subject_id as "subjectId",occurrence.root_pointer as "rootPointer",
      jsonb_agg(jsonb_build_object('bindingId',binding.id,'valueId',value.id,'definitionId',binding.definition_id,
        'pointer',pin.locator->>'pointer','value',value.value) order by binding.definition_id) as bindings
    from parameter_catalog.project_parameter_source_occurrences occurrence
    join parameter_catalog.current_project_parameter_bindings binding on binding.source_occurrence_id=occurrence.id
    join parameter_catalog.project_parameter_values value on value.id=binding.current_value_id and value.binding_id=binding.id
    join parameter_catalog.project_value_source_pins pin on pin.binding_id=binding.id and pin.project_value_id=value.id
    where occurrence.organization_id=$1 and occurrence.project_id=$2 and occurrence.file_id=$3 and occurrence.config_set_id=$4
      and occurrence.occurrence_kind='json' and pin.file_id=$3 and pin.file_version_id=$5 and pin.format='json'
    group by occurrence.id order by occurrence.root_pointer,occurrence.id`,
  [file.organizationId, file.projectId, file.fileId, file.configSetId, file.fileVersionId]);
  return result.rows;
}

// B is selected before its evidence is checked: broken current references must
// never disappear through an inner join and become a successful zero count.
export const currentInstancesCte = `with current_instance_bindings as materialized (
  select * from parameter_catalog.current_project_parameter_bindings
  where organization_id = $1 and definition_id = any($2::text[])
), current_instance_placements as materialized (
  select registration_id, organization_id, module_id
  from parameter_catalog.registration_effective_module where organization_id = $1
), latest_dts_effects as (
  select config_revision_id, logical_node_revision_id, property_occurrence_id,
                  node_occurrence_id, property_name
  from (
    select effect.*, max(source_order) over (
      partition by config_revision_id, logical_node_revision_id, property_name
    ) as last_source_order
    from public.dts_occurrence_effects effect
    join (
      select distinct pin.config_revision_id
      from current_instance_bindings binding
      join parameter_catalog.project_value_source_pins pin
        on pin.project_value_id = binding.current_value_id and pin.binding_id = binding.id
       and pin.organization_id = binding.organization_id and pin.project_id = binding.project_id
       and pin.format = 'dts'
    ) revisions using (config_revision_id)
  ) ranked
  where source_order = last_source_order and effect_kind in ('set', 'override')
), candidates as (
  select b.id as binding_id, b.organization_id, b.project_id, project.name as project_name,
         b.definition_id, b.effective_revision_id, b.current_value_id, b.source_occurrence_id,
         value.id, value.definition_revision_id, value_revision.revision_number::text as value_revision_number,
         value_revision.content->>'unit' as value_unit, value_revision.content->>'lifecycle' as value_lifecycle,
         value_revision.content as value_revision_content,
         value.source_ref, value.value_kind, value.value, value.value::text as value_json_text,
         value.value_state, pin.format as source_format, pin.format as source_pin_format, source_property.raw_text as source_raw_text,
         occurrence.config_set_id, config_set.name as config_set_name, pin.file_id, pin.file_version_id,
         coalesce(member.source_name, file.file_name) as file_name,
         pin.locator as source_locator,
         case when pin.format = 'json' then pin.locator->>'pointer'
              when pin.format = 'dts' then logical.node_locator || ' · ' || (pin.locator->>'propertyName') end as source_location,
         module.name as module_name,
         coalesce(subject.display_name, module.name) as driver_module,
         (value.id is not null and value_revision.id is not null and pin.id is not null
          and ((value.source_ref <> 'canonical-binding-identity' and value.config_revision_id <> 'canonical-binding-identity')
            or (value.source_ref = 'canonical-binding-identity' and value.config_revision_id = 'canonical-binding-identity'
              and value.id = 'pval_' || encode(sha256(convert_to(E'{\\n  "bindingId": ' || to_json(b.id)::text || E',\\n  "source": "canonical-binding-identity"\\n}\\n', 'UTF8')), 'hex')
              and value.value_kind = 'json' and value.value = '{}'::jsonb
              and value.value_digest = 'sha256:' || encode(sha256(convert_to(E'{}\\n', 'UTF8')), 'hex')))
          and occurrence.id is not null and config_set.id is not null and revision.id is not null
          and (member.file_id is not null and member.source_name is not null or (value.value_state = 'deleted' and pin.member_config_revision_id is null
            and pin.locator->>'kind' = 'dts-source-absence' and pin.delete_proof is not null))
          and file.id is not null and pin.format = occurrence.occurrence_kind and pin.value_state = value.value_state
          and (value.value_state <> 'present' or (
            (pin.format = 'json' and pin.property_occurrence_id is null
              and pin.locator = jsonb_build_object('kind', 'json-pointer', 'pointer', pin.locator->>'pointer')
              and pin.locator->>'pointer' is not null
              and (occurrence.root_pointer = '' or pin.locator->>'pointer' = occurrence.root_pointer
                or left(pin.locator->>'pointer', length(occurrence.root_pointer) + 1) = occurrence.root_pointer || '/')
              and occurrence.configuration_schema_subject_id = b.subject_id
              and pin.locator_digest = 'sha256:' || encode(sha256(convert_to(E'{\\n  "kind": "json-pointer",\\n  "pointer": ' || to_json(pin.locator->>'pointer')::text || E'\\n}\\n', 'UTF8')), 'hex'))
            or (pin.format = 'dts'
                and source_property.config_revision_id = pin.config_revision_id
                and source_property.file_version_id = pin.file_version_id
                and (pin.config_revision_id, logical.id, source_property.id,
                     source_property.node_occurrence_id, source_property.property_name) in (
                  select config_revision_id, logical_node_revision_id, property_occurrence_id,
                         node_occurrence_id, property_name
                  from latest_dts_effects
                ) is true
                and source_property.property_name = definition.property_key
                and pin.locator = jsonb_build_object('kind', 'dts-property', 'propertyOccurrenceId', source_property.id,
                  'nodeOccurrenceId', source_property.node_occurrence_id, 'fileVersionId', source_property.file_version_id, 'propertyName', source_property.property_name)
                and pin.locator_digest = 'sha256:' || encode(sha256(convert_to(
                  E'{\\n  "fileVersionId": ' || to_json(source_property.file_version_id)::text || E',\\n  "kind": "dts-property",\\n  "nodeOccurrenceId": ' ||
                  to_json(source_property.node_occurrence_id)::text || E',\\n  "propertyName": ' || to_json(source_property.property_name)::text ||
                  E',\\n  "propertyOccurrenceId": ' || to_json(source_property.id)::text || E'\\n}\\n', 'UTF8')), 'hex')
            )))
          and (occurrence.file_id = pin.file_id or parameter_catalog.source_origin_matches(b.id, occurrence.id, pin.file_id))) as valid
    from current_instance_bindings b
    join public.projects project on project.id = b.project_id and project.organization_id = b.organization_id
    left join parameter_catalog.project_parameter_values value
      on value.id = b.current_value_id and value.binding_id = b.id and value.definition_id = b.definition_id
    left join parameter_catalog.definition_revisions value_revision
      on value_revision.id = value.definition_revision_id and value_revision.definition_id = b.definition_id
    left join parameter_catalog.project_value_source_pins pin
      on pin.project_value_id = value.id and pin.binding_id = b.id and pin.definition_id = b.definition_id
     and pin.organization_id = b.organization_id and pin.project_id = b.project_id
     and pin.source_occurrence_id = b.source_occurrence_id and pin.config_revision_id = value.config_revision_id
    left join public.dts_property_occurrences source_property on source_property.id = pin.property_occurrence_id
    left join parameter_catalog.project_parameter_source_occurrences occurrence
      on occurrence.id = pin.source_occurrence_id and occurrence.organization_id = b.organization_id
     and occurrence.project_id = b.project_id
    left join public.dts_config_revisions revision
      on revision.id = pin.config_revision_id and revision.organization_id = b.organization_id
     and revision.project_id = b.project_id and revision.config_set_id = occurrence.config_set_id
    left join public.dts_config_set config_set on config_set.id = occurrence.config_set_id
     and config_set.organization_id = b.organization_id and config_set.project_id = b.project_id
    left join public.dts_logical_node_revisions logical on logical.logical_node_id = occurrence.logical_node_id
     and logical.config_revision_id = pin.config_revision_id
    left join parameter_catalog.parameter_definitions definition on definition.id = b.definition_id
    left join public.dts_config_revision_members member
      on member.config_revision_id = pin.config_revision_id and member.file_id = pin.file_id
     and member.file_version_id = pin.file_version_id
    left join public.project_parameter_files file
      on file.id = pin.file_id and file.organization_id = b.organization_id
     and file.project_id = b.project_id and file.config_set_id = occurrence.config_set_id
    left join current_instance_placements placement
      on placement.registration_id = b.registration_id and placement.organization_id = b.organization_id
    left join public.parameter_modules module on module.id = placement.module_id and module.organization_id = b.organization_id
    left join public.attribution_subjects subject on subject.id = module.attribution_subject_id
   where b.organization_id = $1 and b.definition_id = any($2::text[])
     and ${currentManagedSourceBindingPredicate("b", 1)}
)`;

export async function assertCurrentInstancesValid(db: Queryable, organizationId: string, definitionIds: readonly string[]): Promise<void> {
  const result = await db.query<{ binding_id: string; id: string | null }>(`${currentInstancesCte}
    select binding_id, id from candidates where not coalesce(valid, false) limit 1`, [organizationId, [...definitionIds]]);
  if (result.rows[0]) throw new ApiError("CONFLICT", "Current configuration evidence is unavailable.", {
    reason: result.rows[0].id ? "invalid-source-pin" : "missing-current-value",
  });
}

export const currentInstancesSummarySql = `select definition_id, bool_and(coalesce(valid, false)) as valid,
      count(distinct project_id) filter (where value_state = 'present' and source_ref <> 'canonical-binding-identity')::text as projects,
      count(distinct binding_id) filter (where value_state = 'present' and source_ref <> 'canonical-binding-identity')::text as instances
    from candidates where ($5::text is null or project_id=$5) group by definition_id`;

export async function selectConfiguredDefinitions(db: Queryable, organizationId: string, definitionIds: readonly string[], projectId?: string) {
  if (projectId && !(await db.query("select 1 from public.projects where organization_id=$1 and id=$2", [organizationId, projectId])).rows.length) {
    throw new ApiError("NOT_FOUND", "Project not found.");
  }
  const result = await db.query<{ definition_id: string; valid: boolean; missing_value: boolean; projects: string; instances: string }>(`${currentInstancesCte}
    select definition_id, bool_and(coalesce(valid, false)) as valid,
      bool_or(id is null) as missing_value,
      count(distinct project_id) filter (where value_state='present' and source_ref <> 'canonical-binding-identity' and ($3::text is null or project_id=$3))::text as projects,
      count(distinct binding_id) filter (where value_state='present' and source_ref <> 'canonical-binding-identity' and ($3::text is null or project_id=$3))::text as instances
    from candidates group by definition_id`, [organizationId, [...definitionIds], projectId ?? null]);
  const invalid = result.rows.find((row) => !row.valid);
  if (invalid) throw new ApiError("CONFLICT", "Current configuration evidence is unavailable.", { reason: invalid.missing_value ? "missing-current-value" : "invalid-source-pin" });
  return new Map(result.rows.filter((row) => Number(row.instances) > 0).map((row) => [row.definition_id, {
    configuredProjectCount: Number(row.projects), configuredInstanceCount: Number(row.instances),
  }]));
}
