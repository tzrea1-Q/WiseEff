import type { Queryable } from "../../../shared/database/client";

export type ModuleRecognitionPlacementFact = {
  registration_id: string;
  subject_id: string;
  module_id: string | null;
};

/** Current retained placement ownership, including retired and unset registrations. */
export async function listModuleRecognitionPlacements(db: Queryable, organizationId: string): Promise<ModuleRecognitionPlacementFact[]> {
  const result = await db.query<ModuleRecognitionPlacementFact>(
    `select registration.id as registration_id, registration.subject_id, placement.module_id
     from parameter_catalog.organization_subject_registrations registration
     join parameter_catalog.subject_placements placement
       on placement.id = registration.current_placement_id and placement.organization_id = registration.organization_id
     where registration.organization_id = $1`, [organizationId],
  );
  return result.rows;
}

export type ModuleRecognitionSubjectDefault = {
  subject_id: string;
  selector_snapshot: { kind: string; values?: string[]; value?: string };
  nature: "physical-device" | "logical-service" | null;
  cardinality: "multiple" | "singleton-per-project" | null;
  aliases: string[];
};

/** Published selectors and driver attributes for a captured release, or the current release when absent. */
export async function readModuleRecognitionSubjectDefaults(
  db: Queryable, subjectIds: readonly string[], releaseId: string | null,
): Promise<ModuleRecognitionSubjectDefault[]> {
  if (subjectIds.length === 0) return [];
  const result = await db.query<ModuleRecognitionSubjectDefault>(
    `select membership.subject_id, membership.selector_snapshot, driver.nature, driver.cardinality,
       coalesce((select array_agg(alias.normalized_selector order by alias.normalized_selector)
         from parameter_catalog.catalog_release_subject_aliases alias_membership
         join parameter_catalog.catalog_subject_aliases alias on alias.id = alias_membership.alias_id
         where alias_membership.release_id = membership.release_id and alias.subject_id = membership.subject_id
           and alias_membership.lifecycle = 'active'), '{}') as aliases
     from parameter_catalog.catalog_release_subjects membership
     left join parameter_catalog.catalog_drivers driver on driver.subject_id = membership.subject_id
     where membership.subject_id = any($1::text[]) and membership.release_id = coalesce($2::text,
       (select current_catalog_release_id from parameter_catalog.catalog_state))`, [subjectIds, releaseId],
  );
  return result.rows;
}

export async function hasMultipleCurrentModuleSubjectInstances(
  db: Queryable, organizationId: string, subjectId: string | null,
): Promise<boolean> {
  if (!subjectId) return false;
  const result = await db.query<{ project_id: string }>(
    `select project_id from parameter_catalog.current_project_parameter_bindings
     where organization_id = $1 and subject_id = $2 group by project_id
     having count(distinct coalesce(logical_node_id, source_occurrence_id)) > 1 limit 1`,
    [organizationId, subjectId],
  );
  return result.rows.length > 0;
}
