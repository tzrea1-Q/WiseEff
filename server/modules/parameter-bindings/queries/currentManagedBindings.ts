import type { Queryable } from "../../../shared/database/client";

/**
 * Current display/adoption excludes ineligible governance and exact tips that a
 * committed source revision suspended. Unrelated configuration/file revisions
 * do not invalidate an otherwise current exact pin. Source pin/provenance
 * validation remains with each caller so malformed pins retain their existing
 * error boundaries. Keep this predicate out of owner mutation/cohort queries.
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
     where (coalesce(managed_registration.owner_subject_id,managed_subject.owner_subject_id) is null or exists (
       select 1 from parameter_catalog.catalog_release_subjects managed_owner
       join parameter_catalog.organization_subject_registrations managed_owner_registration
         on managed_owner_registration.subject_id=managed_owner.subject_id
        and managed_owner_registration.organization_id=${binding}.organization_id
        and managed_owner_registration.status='active'
       where managed_owner.release_id=managed_state.current_catalog_release_id
         and managed_owner.subject_id=coalesce(managed_registration.owner_subject_id,managed_subject.owner_subject_id) and managed_owner.lifecycle='active'
     ))
       and not parameter_catalog.current_source_binding_is_suspended(
         ${binding}.organization_id, ${binding}.project_id, ${binding}.id
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
