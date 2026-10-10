import type { Queryable } from "../../../shared/database/client";

export const loadReviewObservationSource = async (
  client: Queryable,
  organizationId: string,
  observationId: string,
) => {
  const result = await client.query<{
    catalogReleaseId: string; matcherRevision: string; projectId: string;
    configRevisionId: string; logicalNodeId: string | null; configSetId: string;
    fileId: string; locator: Record<string, unknown>;
  }>(
    `select observation.catalog_release_id as "catalogReleaseId", observation.matcher_revision as "matcherRevision",
       observation.project_id as "projectId", observation.config_revision_id as "configRevisionId",
       observation.logical_node_id as "logicalNodeId", occurrence.config_set_id as "configSetId",
       occurrence.file_id as "fileId", observation.source_locator as locator
     from parameter_catalog.parameter_observations observation
     join parameter_catalog.project_parameter_source_occurrences occurrence
       on occurrence.id = observation.source_occurrence_id and occurrence.organization_id = observation.organization_id
       and occurrence.project_id = observation.project_id
     where observation.id = $1 and observation.organization_id = $2`,
    [observationId, organizationId],
  );
  const source = result.rows[0];
  if (!source) return null;
  const { catalogReleaseId, matcherRevision, locator, ...references } = source;
  return { catalogReleaseId, matcherRevision, references: { ...references, ...locator } };
};
