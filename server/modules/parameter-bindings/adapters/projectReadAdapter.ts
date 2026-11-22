import { parameterOrganizationId, withParameterAccess } from "../../parameters/operatingScope";
import { getAuthContext } from "../../auth/repository";
import { ApiError } from "../../../shared/http/errors";
import { assertTrustedInvocationContext, type TrustedInvocationContext } from "../../auth/trustedInvocation";
import {
  createCatalogKernel,
  type DefinitionRevisionSnapshot,
  type PinnedCatalogSnapshot
} from "../../catalog-kernel/interface";
import type { CatalogReadSource } from "../../catalog-kernel/runtime/readTransaction";
import {
  CatalogReleaseId,
  CatalogSubjectId,
  DefinitionRevisionId,
  ParameterBindingId,
  ParameterDefinitionId,
  ProjectValueId,
  SubjectRegistrationId
} from "../../parameter-catalog-contract";
import type { Binding } from "../binding";
import type { BindingRow } from "../binding/repositories";
import { readListedCurrentValues } from "../values";
import { readListedProtectedReference } from "./readAdapter";
import type { ProtectedReferenceDto } from "./dto";
import { currentManagedSourceBindingPredicate } from "../queries/currentManagedBindings";

export type ProjectProtectedParameter = {
  readonly pin: ProtectedReferenceDto;
  readonly propertyKey: string;
  readonly revision: DefinitionRevisionSnapshot;
};

/** The Binding domain owns discovery of its persisted references. Callers
 * provide a trusted principal and project, never a client-selected release,
 * reconstructed Binding, or a latest/name-based fallback. */
export async function readProjectProtectedParameters(
  pool: CatalogReadSource,
  input: { readonly invocation: TrustedInvocationContext; readonly projectId?: string }
): Promise<readonly ProjectProtectedParameter[]> {
  const invocation = assertTrustedInvocationContext(input.invocation);
  if (invocation.initiator === "system" || invocation.initiator === "integration") {
    throw new ApiError("FORBIDDEN", "Project parameter reads require an accountable principal.");
  }
  const auth = invocation.operatingOrganization
    ? withParameterAccess(await getAuthContext(pool, invocation.principal.user.id), invocation)
    : invocation.principal;
  const projectId = input.projectId;
  if (!auth.user.isActive || !auth.permissions.includes("parameter:view")) {
    throw new ApiError("FORBIDDEN", "Missing permission: parameter:view.");
  }
  // Project visibility is organization-wide; participation gates writes only.
  if (!projectId) {
    throw new ApiError("FORBIDDEN", "Project parameter scope is required.");
  }
  const project = await pool.query("select 1 from public.projects where id = $1 and organization_id = $2", [
    projectId,
    parameterOrganizationId(auth)
  ]);
  if (project.rowCount !== 1) {
    throw new ApiError("NOT_FOUND", "Project was not found.");
  }
  const listed = await pool.query<BindingRow>(
    `select id, organization_id, catalog_release_id, project_id, logical_node_id, source_occurrence_id,
            registration_id, subject_id, definition_id, effective_revision_id, current_value_id
       from parameter_catalog.current_project_parameter_bindings binding
      where organization_id = $1 and project_id = $2
        and ${currentManagedSourceBindingPredicate("binding", 1)}
      order by id`,
    [parameterOrganizationId(auth), projectId]
  );
  if (!listed.rows.length) return [];
  const kernel = createCatalogKernel(pool);
  const currentValues = await readListedCurrentValues(pool, listed.rows.map((row) => row.current_value_id));
  // Direct readers can observe a new binding tip between PostgreSQL statements.
  const stored = await pool.query<BindingRow>(
    `select id, organization_id, catalog_release_id, project_id, logical_node_id, source_occurrence_id,
            registration_id, subject_id, definition_id, effective_revision_id, current_value_id
       from parameter_catalog.project_parameter_bindings
      where organization_id = $1 and project_id = $2 and id = any($3::text[])`,
    [parameterOrganizationId(auth), projectId, listed.rows.map((row) => row.id)]
  );
  const storedById = new Map(stored.rows.map((row) => [row.id, row]));
  const snapshots = new Map<string, PinnedCatalogSnapshot>();
  const items: ProjectProtectedParameter[] = [];
  for (const row of listed.rows) {
    const current = storedById.get(row.id);
    if (!current || (Object.keys(row) as Array<keyof BindingRow>).some((key) => current[key] !== row[key])) {
      throw new ApiError("CONFLICT", "Configured parameter cannot be read at its exact pin.", { reason: "missing-binding" });
    }
    let snapshot = snapshots.get(row.catalog_release_id);
    if (!snapshot) {
      const pin = await kernel.resolveCatalogReleasePin(CatalogReleaseId(row.catalog_release_id));
      if (!pin.ok) {
        throw new ApiError("CONFLICT", "Configured Catalog release is unavailable.", { reason: pin.error.kind });
      }
      const loaded = await kernel.loadPinnedCatalog(pin.value);
      if (!loaded.ok) {
        throw new ApiError("CONFLICT", "Configured Catalog snapshot is unavailable.", { reason: loaded.error.kind });
      }
      snapshot = loaded.value;
      snapshots.set(row.catalog_release_id, snapshot);
    }
    const binding: Binding = {
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
      catalogRelease: snapshot.release
    };
    const protectedRead = readListedProtectedReference({
      snapshot,
      binding,
      definitionRevisionId: binding.effectiveRevisionId
    }, currentValues);
    if (!protectedRead.ok) {
      throw new ApiError("CONFLICT", "Configured parameter cannot be read at its exact pin.", {
        reason: protectedRead.error.reason
      });
    }
    const definition = snapshot.getDefinitionById(binding.definitionId);
    const revision = snapshot.getDefinitionRevision({
      definitionId: binding.definitionId,
      revisionId: binding.effectiveRevisionId
    });
    if ((definition.status !== "found" && definition.status !== "retired") || revision.status !== "found") {
      throw new ApiError("CONFLICT", "Configured Definition revision is unavailable.", {
        reason: "revision-disagreement"
      });
    }
    items.push({
      pin: protectedRead.value,
      propertyKey: definition.definition.propertyKey,
      revision: revision.revision
    });
  }
  return items;
}
