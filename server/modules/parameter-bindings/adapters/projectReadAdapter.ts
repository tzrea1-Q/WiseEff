import type pg from "pg";

import { ApiError } from "../../../shared/http/errors";
import { assertTrustedInvocationContext, type TrustedInvocationContext } from "../../auth/trustedInvocation";
import {
  createCatalogKernel,
  type DefinitionRevisionSnapshot,
  type PinnedCatalogSnapshot
} from "../../catalog-kernel/interface";
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
import { readProtectedReference } from "./readAdapter";
import type { ProtectedReferenceDto } from "./dto";

export type ProjectProtectedParameter = {
  readonly pin: ProtectedReferenceDto;
  readonly propertyKey: string;
  readonly revision: DefinitionRevisionSnapshot;
};

/** The Binding domain owns discovery of its persisted references. Callers
 * provide a trusted principal and project, never a client-selected release,
 * reconstructed Binding, or a latest/name-based fallback. */
export async function readProjectProtectedParameters(
  pool: pg.Pool,
  input: { readonly invocation: TrustedInvocationContext; readonly projectId?: string }
): Promise<readonly ProjectProtectedParameter[]> {
  const invocation = assertTrustedInvocationContext(input.invocation);
  if (invocation.initiator === "system") {
    throw new ApiError("FORBIDDEN", "Project parameter reads require an accountable principal.");
  }
  const auth = invocation.principal;
  const projectId = input.projectId;
  if (!auth.user.isActive || !auth.permissions.includes("parameter:view")) {
    throw new ApiError("FORBIDDEN", "Missing permission: parameter:view.");
  }
  const globalAdmin = auth.roles.some(
    (role) => role.projectId === null && (role.roleId === "admin" || role.roleId === "platform-admin")
  );
  if (!projectId || (!globalAdmin && !auth.roles.some((role) => role.projectId === projectId))) {
    throw new ApiError("FORBIDDEN", "Project parameter scope is required.");
  }
  const project = await pool.query("select 1 from public.projects where id = $1 and organization_id = $2", [
    projectId,
    auth.organization.id
  ]);
  if (project.rowCount !== 1) {
    throw new ApiError("NOT_FOUND", "Project was not found.");
  }
  const listed = await pool.query<BindingRow>(
    `select id, organization_id, catalog_release_id, project_id, logical_node_id,
            registration_id, subject_id, definition_id, effective_revision_id, current_value_id
       from parameter_catalog.project_parameter_bindings
      where organization_id = $1 and project_id = $2
      order by id`,
    [auth.organization.id, projectId]
  );
  const kernel = createCatalogKernel(pool);
  const snapshots = new Map<string, PinnedCatalogSnapshot>();
  const items: ProjectProtectedParameter[] = [];
  for (const row of listed.rows) {
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
      registrationId: SubjectRegistrationId(row.registration_id),
      subjectId: CatalogSubjectId(row.subject_id),
      definitionId: ParameterDefinitionId(row.definition_id),
      effectiveRevisionId: DefinitionRevisionId(row.effective_revision_id),
      currentValueId: ProjectValueId(row.current_value_id),
      catalogRelease: snapshot.release
    };
    const protectedRead = await readProtectedReference(pool, {
      snapshot,
      binding,
      definitionRevisionId: binding.effectiveRevisionId
    });
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
