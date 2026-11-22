import { expect } from "vitest";
import type { Queryable } from "../../../shared/database/client";
import { currentManagedSourceBindingPredicate } from "./currentManagedBindings";

export async function expectEligibleBindingsToMatch(db: Queryable, organizationId: string) {
  const owner = `coalesce(managed_registration.owner_subject_id, case when to_jsonb(managed_subject_membership)->>'rules_snapshot' is null
    then managed_subject.owner_subject_id
    else to_jsonb(managed_subject_membership)->'rules_snapshot'->>'ownerSubjectId' end)`;
  const oracle = `exists (
    select 1
      from parameter_catalog.catalog_state managed_state
      join parameter_catalog.catalog_release_subjects managed_subject_membership
        on managed_subject_membership.release_id=managed_state.current_catalog_release_id
       and managed_subject_membership.subject_id=binding.subject_id
       and managed_subject_membership.lifecycle='active'
      join parameter_catalog.catalog_subjects managed_subject
        on managed_subject.id=managed_subject_membership.subject_id
      join parameter_catalog.catalog_release_definition_heads managed_head
        on managed_head.release_id=managed_state.current_catalog_release_id
       and managed_head.definition_id=binding.definition_id
      join parameter_catalog.definition_revisions managed_definition
        on managed_definition.id=managed_head.revision_id
       and managed_definition.definition_id=managed_head.definition_id
       and coalesce(managed_definition.content->>'lifecycle','active') in ('active','deprecated')
      join parameter_catalog.organization_subject_registrations managed_registration
        on managed_registration.id=binding.registration_id
       and managed_registration.organization_id=binding.organization_id
       and managed_registration.subject_id=binding.subject_id
       and managed_registration.status='active'
     where (${owner} is null or exists (
       select 1 from parameter_catalog.catalog_release_subjects managed_owner
       join parameter_catalog.organization_subject_registrations managed_owner_registration
         on managed_owner_registration.subject_id=managed_owner.subject_id
        and managed_owner_registration.organization_id=binding.organization_id
        and managed_owner_registration.status='active'
       where managed_owner.release_id=managed_state.current_catalog_release_id
         and managed_owner.subject_id=${owner} and managed_owner.lifecycle='active'
     ))
       and not parameter_catalog.current_source_binding_is_suspended(
         binding.organization_id, binding.project_id, binding.id
       )
  )`;
  const result = await db.query(`
    select binding.id
    from parameter_catalog.project_parameter_bindings binding
    where binding.organization_id = $1
      and (${oracle}) is distinct from (${currentManagedSourceBindingPredicate("binding", 1)})
  `, [organizationId]);
  expect(result.rows).toEqual([]);
}
