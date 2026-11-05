import type { Queryable } from "../../../shared/database/client";
import { ApiError } from "../../../shared/http/errors";
import { currentManagedSourceBindingPredicate } from "./currentManagedBindings";

// B is selected before its evidence is checked: broken current references must
// never disappear through an inner join and become a successful zero count.
export const currentInstancesCte = `with candidates as (
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
            or (pin.format = 'dts' and exists (
              select 1 from public.dts_property_occurrences property
              join public.dts_occurrence_effects effect on effect.property_occurrence_id = property.id
                and effect.node_occurrence_id = property.node_occurrence_id and effect.config_revision_id = property.config_revision_id
              join public.dts_logical_node_revisions logical on logical.id = effect.logical_node_revision_id
                and logical.logical_node_id = occurrence.logical_node_id and logical.config_revision_id = property.config_revision_id
              join parameter_catalog.parameter_definitions definition on definition.id = b.definition_id
              where property.id = pin.property_occurrence_id and property.config_revision_id = pin.config_revision_id
                and property.file_version_id = pin.file_version_id and property.property_name = definition.property_key
                and effect.property_name = property.property_name and effect.effect_kind in ('set', 'override')
                and not exists (select 1 from public.dts_occurrence_effects later
                  where later.config_revision_id = effect.config_revision_id and later.logical_node_revision_id = effect.logical_node_revision_id
                    and later.property_name = effect.property_name and later.source_order > effect.source_order)
                and pin.locator = jsonb_build_object('kind', 'dts-property', 'propertyOccurrenceId', property.id,
                  'nodeOccurrenceId', property.node_occurrence_id, 'fileVersionId', property.file_version_id, 'propertyName', property.property_name)
                and pin.locator_digest = 'sha256:' || encode(sha256(convert_to(
                  E'{\\n  "fileVersionId": ' || to_json(property.file_version_id)::text || E',\\n  "kind": "dts-property",\\n  "nodeOccurrenceId": ' ||
                  to_json(property.node_occurrence_id)::text || E',\\n  "propertyName": ' || to_json(property.property_name)::text ||
                  E',\\n  "propertyOccurrenceId": ' || to_json(property.id)::text || E'\\n}\\n', 'UTF8')), 'hex')
            ))))
          and (occurrence.file_id = pin.file_id or parameter_catalog.source_origin_matches(b.id, occurrence.id, pin.file_id))) as valid
    from parameter_catalog.current_project_parameter_bindings b
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
    left join public.dts_config_revision_members member
      on member.config_revision_id = pin.config_revision_id and member.file_id = pin.file_id
     and member.file_version_id = pin.file_version_id
    left join public.project_parameter_files file
      on file.id = pin.file_id and file.organization_id = b.organization_id
     and file.project_id = b.project_id and file.config_set_id = occurrence.config_set_id
    left join parameter_catalog.registration_effective_module placement
      on placement.registration_id = b.registration_id and placement.organization_id = b.organization_id
    left join public.parameter_modules module on module.id = placement.module_id and module.organization_id = b.organization_id
    left join public.attribution_subjects subject on subject.id = module.attribution_subject_id
   where b.organization_id = $1 and b.definition_id = any($2::text[])
     and ${currentManagedSourceBindingPredicate("b")}
)`;

export async function assertCurrentInstancesValid(db: Queryable, organizationId: string, definitionIds: readonly string[]): Promise<void> {
  const result = await db.query<{ binding_id: string; id: string | null }>(`${currentInstancesCte}
    select binding_id, id from candidates where not coalesce(valid, false) limit 1`, [organizationId, [...definitionIds]]);
  if (result.rows[0]) throw new ApiError("CONFLICT", "Current configuration evidence is unavailable.", {
    reason: result.rows[0].id ? "invalid-source-pin" : "missing-current-value",
  });
}

export async function summarizeCurrentInstances(db: Queryable, organizationId: string, definitionIds: readonly string[], projectId?: string) {
  if (!definitionIds.length) return new Map<string, { configuredProjectCount: number; configuredInstanceCount: number } | null>();
  const result = await db.query<{ definition_id: string; valid: boolean; projects: string; instances: string }>(`${currentInstancesCte}
    select definition_id, bool_and(coalesce(valid, false)) as valid,
      count(distinct project_id) filter (where value_state = 'present' and source_ref <> 'canonical-binding-identity')::text as projects,
      count(distinct binding_id) filter (where value_state = 'present' and source_ref <> 'canonical-binding-identity')::text as instances
    from candidates where ($3::text is null or project_id=$3) group by definition_id`, [organizationId, [...definitionIds], projectId ?? null]);
  const rows = new Map(result.rows.map((row) => [row.definition_id, row]));
  return new Map(definitionIds.map((id) => {
    const row = rows.get(id);
    return [id, row && !row.valid ? null : { configuredProjectCount: Number(row?.projects ?? 0), configuredInstanceCount: Number(row?.instances ?? 0) }];
  }));
}

export async function selectConfiguredDefinitions(db: Queryable, organizationId: string, definitionIds: readonly string[], projectId?: string) {
  if (projectId && !(await db.query("select 1 from public.projects where organization_id=$1 and id=$2", [organizationId, projectId])).rows.length) {
    throw new ApiError("NOT_FOUND", "Project not found.");
  }
  const result = await db.query<{ definition_id: string; valid: boolean; missing_value: boolean; matches: boolean }>(`${currentInstancesCte}
    select definition_id, bool_and(coalesce(valid, false)) as valid,
      bool_or(id is null) as missing_value,
      bool_or(value_state='present' and source_ref <> 'canonical-binding-identity' and ($3::text is null or project_id=$3)) as matches
    from candidates group by definition_id`, [organizationId, [...definitionIds], projectId ?? null]);
  const invalid = result.rows.find((row) => !row.valid);
  if (invalid) throw new ApiError("CONFLICT", "Current configuration evidence is unavailable.", { reason: invalid.missing_value ? "missing-current-value" : "invalid-source-pin" });
  return result.rows.filter((row) => row.matches).map((row) => row.definition_id);
}
