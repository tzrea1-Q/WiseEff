import type { Queryable } from "../../../shared/database/client";
import { publishedSubjectOwner } from "../../catalog-kernel/ownerSchema";

/**
 * Current display/adoption excludes ineligible governance and exact tips that a
 * committed source revision suspended. Unrelated configuration/file revisions
 * do not invalidate an otherwise current exact pin. Source pin/provenance
 * validation remains with each caller so malformed pins retain their existing
 * error boundaries. Keep this predicate out of owner mutation/cohort queries.
 */
export function currentManagedSourceBindingPredicate(binding: string, organizationParameter?: number): string {
  if (!/^[a-z][a-z0-9_]*$/u.test(binding)) throw new TypeError("Invalid Binding SQL alias");
  const owner = `coalesce(registration.owner_subject_id, ${publishedSubjectOwner("membership", "subject")})`;
  const suspension = organizationParameter === undefined
    ? `not parameter_catalog.current_source_binding_is_suspended(
        ${binding}.organization_id, ${binding}.project_id, ${binding}.id)`
    : `${binding}.organization_id = $${organizationParameter}
      and (${binding}.project_id, ${binding}.id) not in (
        select suspended.project_id, suspended.binding_id
        from parameter_catalog.current_source_binding_suspensions($${organizationParameter}) suspended
      )`;
  // Keep membership as reusable hashed sets even in queries with many joins.
  return `(
    ((${binding}.organization_id, ${binding}.subject_id, ${binding}.registration_id) in (
      select registration.organization_id, registration.subject_id, registration.id
      from parameter_catalog.organization_subject_registrations registration
      join parameter_catalog.catalog_state state on true
      join parameter_catalog.catalog_release_subjects membership
        on membership.release_id = state.current_catalog_release_id
       and membership.subject_id = registration.subject_id and membership.lifecycle = 'active'
      join parameter_catalog.catalog_subjects subject on subject.id = membership.subject_id
      left join parameter_catalog.catalog_release_subjects owner_membership
        on owner_membership.release_id = state.current_catalog_release_id
       and owner_membership.subject_id = ${owner} and owner_membership.lifecycle = 'active'
      left join parameter_catalog.organization_subject_registrations owner_registration
        on owner_registration.organization_id = registration.organization_id
       and owner_registration.subject_id = owner_membership.subject_id and owner_registration.status = 'active'
      where registration.status = 'active'
        and (${owner} is null or owner_registration.id is not null)
    ) is true)
    and (${binding}.definition_id in (
      select head.definition_id
      from parameter_catalog.catalog_state state
      join parameter_catalog.catalog_release_definition_heads head
        on head.release_id = state.current_catalog_release_id
      join parameter_catalog.definition_revisions revision
        on revision.id = head.revision_id and revision.definition_id = head.definition_id
      where coalesce(revision.content->>'lifecycle', 'active') in ('active', 'deprecated')
    ) is true)
    and ${suspension}
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
      and ${currentManagedSourceBindingPredicate("binding", 1)}`,
  [input.organizationId, input.projectId, [...input.bindingIds]]);
  return new Set(result.rows.map(row => row.id));
}
