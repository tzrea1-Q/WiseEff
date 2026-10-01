import type { Queryable } from "../../../shared/database/client";
import {
  CatalogReleaseId, CatalogSubjectId, DefinitionRevisionId, ParameterBindingId,
  ParameterDefinitionId, ProjectValueId, SubjectRegistrationId,
} from "../../parameter-catalog-contract";
import type { BindingRow } from "./repositories";
import type { Binding } from "./types";

export type PersistedBindingReference = Omit<Binding, "catalogRelease"> & {
  readonly catalogReleaseId: CatalogReleaseId;
};

export type OwnedCurrentBindingRead =
  | { readonly status: "current"; readonly binding: PersistedBindingReference }
  | { readonly status: "replaced" | "missing" };

/** Exact scoped identity, not replacement-following lookup. A missing current
 * row remains distinguishable from its retained base row. Locks stay on the
 * caller's Queryable; this read never acquires a pool connection. */
export async function readOwnedCurrentBinding(
  queryable: Queryable,
  input: { organizationId: string; projectId: string; bindingId: string; lock?: boolean },
): Promise<OwnedCurrentBindingRead> {
  const scope = [input.organizationId, input.projectId, input.bindingId];
  const result = await queryable.query<BindingRow>(
    `select id, organization_id, catalog_release_id, project_id, logical_node_id,
            source_occurrence_id, registration_id, subject_id, definition_id,
            effective_revision_id, current_value_id
       from parameter_catalog.current_project_parameter_bindings
      where organization_id = $1 and project_id = $2 and id = $3
      limit 1${input.lock ? " for update" : ""}`,
    scope,
  );
  const row = result.rows[0];
  if (!row) {
    const retained = await queryable.query<{ id: string }>(
      `select id from parameter_catalog.project_parameter_bindings
        where organization_id = $1 and project_id = $2 and id = $3 limit 1`,
      scope,
    );
    return { status: retained.rows.length === 1 ? "replaced" : "missing" };
  }
  return {
    status: "current",
    binding: {
      id: ParameterBindingId(row.id),
      organizationId: row.organization_id,
      projectId: row.project_id,
      logicalNodeId: row.logical_node_id,
      sourceOccurrenceId: row.source_occurrence_id,
      registrationId: SubjectRegistrationId(row.registration_id),
      subjectId: CatalogSubjectId(row.subject_id),
      definitionId: ParameterDefinitionId(row.definition_id),
      effectiveRevisionId: DefinitionRevisionId(row.effective_revision_id),
      currentValueId: ProjectValueId(row.current_value_id),
      catalogReleaseId: CatalogReleaseId(row.catalog_release_id),
    },
  };
}
