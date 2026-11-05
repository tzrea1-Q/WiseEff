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
         value.source_ref, value.value_kind, value.value,
         value.value_state, pin.format as source_format, pin.format as source_pin_format,
         occurrence.config_set_id, config_set.name as config_set_name, pin.file_id, pin.file_version_id,
         coalesce(member.source_name, file.file_name) as file_name,
         pin.locator as source_locator, module.name as module_name,
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
    left join parameter_catalog.project_parameter_source_occurrences occurrence
      on occurrence.id = pin.source_occurrence_id and occurrence.organization_id = b.organization_id
     and occurrence.project_id = b.project_id
    left join public.dts_config_revisions revision
      on revision.id = pin.config_revision_id and revision.organization_id = b.organization_id
     and revision.project_id = b.project_id and revision.config_set_id = occurrence.config_set_id
    left join public.dts_config_set config_set on config_set.id = occurrence.config_set_id
     and config_set.organization_id = b.organization_id and config_set.project_id = b.project_id
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

export async function summarizeCurrentInstances(db: Queryable, organizationId: string, definitionIds: readonly string[]) {
  if (!definitionIds.length) return new Map<string, { configuredProjectCount: number; configuredInstanceCount: number } | null>();
  const result = await db.query<{ definition_id: string; valid: boolean; projects: string; instances: string }>(`${currentInstancesCte}
    select definition_id, bool_and(coalesce(valid, false)) as valid,
      count(distinct project_id) filter (where value_state = 'present' and source_ref <> 'canonical-binding-identity')::text as projects,
      count(distinct binding_id) filter (where value_state = 'present' and source_ref <> 'canonical-binding-identity')::text as instances
    from candidates group by definition_id`, [organizationId, [...definitionIds]]);
  const rows = new Map(result.rows.map((row) => [row.definition_id, row]));
  return new Map(definitionIds.map((id) => {
    const row = rows.get(id);
    return [id, row && !row.valid ? null : { configuredProjectCount: Number(row?.projects ?? 0), configuredInstanceCount: Number(row?.instances ?? 0) }];
  }));
}
