import type { Queryable } from "../../../shared/database/client";

/**
 * Current display/adoption scope is narrower than the Binding owner's current
 * identity. Retained values keep their immutable provenance and remain writable
 * only through an authorized reconciliation, but are not current project data.
 * Keep this predicate out of owner mutation/cohort queries: a source commit
 * creates its successor configuration before it advances each Binding tip.
 */
export function currentManagedSourceBindingPredicate(binding: string): string {
  if (!/^[a-z][a-z0-9_]*$/u.test(binding)) throw new TypeError("Invalid Binding SQL alias");
  return `exists (
    select 1
      from parameter_catalog.catalog_state managed_state
      join parameter_catalog.catalog_release_subjects managed_subject_membership
        on managed_subject_membership.release_id=managed_state.current_catalog_release_id
       and managed_subject_membership.subject_id=${binding}.subject_id
       and managed_subject_membership.lifecycle='active'
      join parameter_catalog.catalog_subjects managed_subject
        on managed_subject.id=managed_subject_membership.subject_id
      join parameter_catalog.catalog_release_definition_heads managed_head
        on managed_head.release_id=managed_state.current_catalog_release_id
       and managed_head.definition_id=${binding}.definition_id
      join parameter_catalog.definition_revisions managed_definition
        on managed_definition.id=managed_head.revision_id
       and managed_definition.definition_id=managed_head.definition_id
       and coalesce(managed_definition.content->>'lifecycle','active') in ('active','deprecated')
      join parameter_catalog.organization_subject_registrations managed_registration
        on managed_registration.id=${binding}.registration_id
       and managed_registration.organization_id=${binding}.organization_id
       and managed_registration.subject_id=${binding}.subject_id
       and managed_registration.status='active'
      join parameter_catalog.project_parameter_values managed_value
        on managed_value.id=${binding}.current_value_id and managed_value.binding_id=${binding}.id
       and managed_value.definition_id=${binding}.definition_id and managed_value.value_state='present'
       and managed_value.source_ref<>'canonical-binding-identity'
      join parameter_catalog.project_value_source_pins managed_pin
        on managed_pin.project_value_id=managed_value.id and managed_pin.binding_id=${binding}.id
       and managed_pin.definition_id=${binding}.definition_id
       and managed_pin.organization_id=${binding}.organization_id and managed_pin.project_id=${binding}.project_id
       and managed_pin.source_occurrence_id=${binding}.source_occurrence_id
       and managed_pin.config_revision_id=managed_value.config_revision_id and managed_pin.value_state='present'
      join parameter_catalog.project_parameter_source_occurrences managed_occurrence
        on managed_occurrence.id=managed_pin.source_occurrence_id
       and managed_occurrence.organization_id=${binding}.organization_id and managed_occurrence.project_id=${binding}.project_id
      join public.dts_config_revisions managed_config
        on managed_config.id=managed_pin.config_revision_id
       and managed_config.organization_id=${binding}.organization_id and managed_config.project_id=${binding}.project_id
       and managed_config.config_set_id=managed_occurrence.config_set_id
       and managed_config.status in ('resolved','validated','compiled','pending_approval')
      join public.dts_config_revision_members managed_member
        on managed_member.config_revision_id=managed_config.id
       and managed_member.file_id=managed_pin.file_id and managed_member.file_version_id=managed_pin.file_version_id
      join public.project_parameter_files managed_file
        on managed_file.id=managed_pin.file_id and managed_file.current_version_id=managed_pin.file_version_id
       and managed_file.organization_id=${binding}.organization_id and managed_file.project_id=${binding}.project_id
       and managed_file.config_set_id=managed_occurrence.config_set_id
     where (managed_subject.owner_subject_id is null or exists (
       select 1 from parameter_catalog.catalog_release_subjects managed_owner
       join parameter_catalog.organization_subject_registrations managed_owner_registration
         on managed_owner_registration.subject_id=managed_owner.subject_id
        and managed_owner_registration.organization_id=${binding}.organization_id
        and managed_owner_registration.status='active'
       where managed_owner.release_id=managed_state.current_catalog_release_id
         and managed_owner.subject_id=managed_subject.owner_subject_id and managed_owner.lifecycle='active'
     ))
       and not exists (
         select 1 from public.dts_config_revisions managed_newer
          where managed_newer.organization_id=${binding}.organization_id and managed_newer.project_id=${binding}.project_id
            and managed_newer.config_set_id=managed_config.config_set_id
            and managed_newer.status in ('resolved','validated','compiled','pending_approval')
            and managed_newer.revision_number>managed_config.revision_number
       )
  )`;
}

/** Exact scoped filter for consumers that already hold retained owner identities. */
export async function readCurrentManagedSourceBindingIds(db: Queryable, input: {
  organizationId: string; projectId: string; bindingIds: readonly string[];
}): Promise<ReadonlySet<string>> {
  if (!input.bindingIds.length) return new Set();
  const result = await db.query<{ id: string }>(`select binding.id
    from parameter_catalog.current_project_parameter_bindings binding
    where binding.organization_id=$1 and binding.project_id=$2 and binding.id=any($3::text[])
      and ${currentManagedSourceBindingPredicate("binding")}`,
  [input.organizationId, input.projectId, [...input.bindingIds]]);
  return new Set(result.rows.map(row => row.id));
}
