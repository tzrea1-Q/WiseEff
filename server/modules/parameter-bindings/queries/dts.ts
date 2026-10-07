import type { Queryable } from "../../../shared/database/client";
import type { ProjectValuePayload } from "../values";

export type CanonicalValueRow = {
  id: string;
  binding_id: string;
  definition_id: string;
  definition_revision_id: string;
  source_ref: string;
  value_kind: ProjectValuePayload["kind"];
  value: unknown;
  value_state: "present" | "deleted";
  source_occurrence_id: string | null;
  source_format: "dts" | "json" | null;
  source_pin_format: "dts" | "json" | null;
  config_set_id: string | null;
  file_id: string | null;
  file_version_id: string | null;
  file_name: string | null;
  source_locator: Record<string, unknown> | null;
};

export type CanonicalCompareQueryRow = CanonicalValueRow & {
  project_id: string;
  project_name: string;
  effective_revision_id: string;
  current_value_id: string;
  module_name: string | null;
  driver_module: string | null;
  source_occurrence_id: string;
};

/** Resolve historical values by their immutable IDs, within the exact tenant/project/binding. */
export async function readCanonicalHistoryValueRows(
  db: Queryable,
  input: { organizationId: string; projectId: string; bindingId: string; valueIds: readonly string[] },
): Promise<CanonicalValueRow[]> {
  const valueIds = [...new Set(input.valueIds.filter((id) => id.length > 0))];
  if (valueIds.length === 0) return [];
  const result = await db.query<CanonicalValueRow>(
    `
    select value.id,
           value.binding_id,
           value.definition_id,
           value.definition_revision_id,
           value.source_ref,
           value.value_kind,
           value.value,
           value.value_state,
           coalesce(pin.source_occurrence_id, binding.source_occurrence_id) as source_occurrence_id,
           coalesce(pin.format, occurrence.occurrence_kind) as source_format,
           pin.format as source_pin_format,
           occurrence.config_set_id,
           coalesce(pin.file_id, occurrence.file_id) as file_id,
           pin.file_version_id,
           file.file_name,
           pin.locator as source_locator
      from parameter_catalog.project_parameter_values value
      join parameter_catalog.project_parameter_bindings binding
        on binding.id = value.binding_id
       and binding.definition_id = value.definition_id
       and binding.organization_id = $1
       and binding.project_id = $2
      left join parameter_catalog.project_value_source_pins pin
        on pin.project_value_id = value.id
       and pin.binding_id = value.binding_id
       and pin.definition_id = value.definition_id
       and pin.organization_id = binding.organization_id
       and pin.project_id = binding.project_id
       and pin.source_occurrence_id = binding.source_occurrence_id
      left join parameter_catalog.project_parameter_source_occurrences occurrence
        on occurrence.id = binding.source_occurrence_id
       and occurrence.organization_id = binding.organization_id
       and occurrence.project_id = binding.project_id
      left join public.project_parameter_files file
        on file.id = pin.file_id
       and file.organization_id = binding.organization_id
       and file.project_id = binding.project_id
     where value.binding_id = $3
       and value.id = any($4::text[])
    `,
    [input.organizationId, input.projectId, input.bindingId, valueIds],
  );
  return result.rows;
}

/** Preserve every source occurrence as a separate compare peer; never select a first instance. */
export async function readCanonicalCompareRows(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    bindingId: string;
    visibleProjectIds?: readonly string[] | null;
  },
): Promise<CanonicalCompareQueryRow[] | null> {
  const source = await db.query<{ definition_id: string }>(
    `
    select definition_id
      from parameter_catalog.current_project_parameter_bindings
     where id = $1 and organization_id = $2 and project_id = $3
     limit 1
    `,
    [input.bindingId, input.organizationId, input.projectId],
  );
  const sourceRow = source.rows[0];
  if (!sourceRow) return null;

  const result = await db.query<CanonicalCompareQueryRow>(
    `
    select value.id,
           b.project_id,
           project.name as project_name,
           b.id as binding_id,
           b.definition_id,
           b.effective_revision_id,
           b.current_value_id,
           b.source_occurrence_id,
           value.source_ref,
           value.value_kind,
           value.value,
           value.value_state,
           pin.format as source_format,
           pin.format as source_pin_format,
           occurrence.config_set_id,
           pin.file_id,
           pin.file_version_id,
           file.file_name,
           pin.locator as source_locator,
           value.definition_revision_id,
           parameter_module.name as module_name,
           coalesce(subject.display_name, parameter_module.name) as driver_module
      from parameter_catalog.current_project_parameter_bindings b
      join parameter_catalog.project_parameter_values value
        on value.id = b.current_value_id
       and value.binding_id = b.id
       and value.definition_id = b.definition_id
      join parameter_catalog.project_value_source_pins pin
        on pin.project_value_id = value.id
       and pin.binding_id = b.id
       and pin.definition_id = b.definition_id
       and pin.organization_id = b.organization_id
       and pin.project_id = b.project_id
       and pin.source_occurrence_id = b.source_occurrence_id
       and pin.config_revision_id = value.config_revision_id
      join parameter_catalog.project_parameter_source_occurrences occurrence
        on occurrence.id = pin.source_occurrence_id
       and occurrence.organization_id = b.organization_id
       and occurrence.project_id = b.project_id
      left join public.project_parameter_files file
        on file.id = pin.file_id
       and file.organization_id = b.organization_id
       and file.project_id = b.project_id
      join public.projects project
        on project.id = b.project_id
       and project.organization_id = b.organization_id
      left join parameter_catalog.organization_subject_registrations registration
        on registration.id = b.registration_id
      left join parameter_catalog.subject_placements placement
        on placement.id = registration.current_placement_id
      left join public.parameter_modules parameter_module
        on parameter_module.id = placement.module_id
      left join public.attribution_subjects subject
        on subject.id = parameter_module.attribution_subject_id
     where b.organization_id = $2
       and b.id <> $1
       and ($3::text[] is null or b.project_id = any($3::text[]))
       and b.definition_id = $4
     order by project.name asc, b.project_id asc, b.id asc
    `,
    [input.bindingId, input.organizationId, input.visibleProjectIds ?? null, sourceRow.definition_id],
  );
  return result.rows;
}
