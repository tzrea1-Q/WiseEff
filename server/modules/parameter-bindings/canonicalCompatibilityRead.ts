import { ApiError } from "../../shared/http/errors";
import { getRootPostgresPool, type Database } from "../../shared/database/client";
import type { AuthContext } from "../auth/types";
import { canViewParameters } from "../parameter-kernel/policy";
import { requireCanViewProject } from "../parameter-topology/service";
import { lookupProtectedIdentity } from "../catalog-cutover/mapping";
import { LEGACY_LOOKUP_SOURCE_SYSTEM } from "../parameter-catalog-api/legacy/types";

export async function resolveCanonicalParameter(db: Database, auth: AuthContext, parameterId: string) {
  if (!canViewParameters(auth) || !auth.user.isActive) throw new ApiError("FORBIDDEN", "Parameter view permission is required.");
  let bindingId = parameterId;
  let mappedProjectId: string | null = null;
  if (!parameterId.startsWith("pbind_")) {
    const identities = await db.query<{ project_id: string }>(
      `select identity.owner_scope_id as project_id
       from parameter_catalog.legacy_identities identity
       join projects project on project.id = identity.owner_scope_id
       where identity.source_system = $1 and identity.source_kind = 'project-parameter-binding'
         and identity.owner_scope_kind = 'project' and identity.source_id = $2
         and project.organization_id = $3`, [LEGACY_LOOKUP_SOURCE_SYSTEM, parameterId, auth.organization.id]
    );
    if (identities.rows.length !== 1) return null;
    mappedProjectId = identities.rows[0]!.project_id;
    requireCanViewProject(auth, mappedProjectId);
    const pool = getRootPostgresPool(db);
    if (!pool) throw new ApiError("INTERNAL_ERROR", "Canonical identity resolution requires the root database.");
    const mapping = await lookupProtectedIdentity({ client: pool, identity: {
      kind: "source-tuple", sourceSystem: LEGACY_LOOKUP_SOURCE_SYSTEM,
      sourceKind: "project-parameter-binding", ownerScopeKind: "project",
      ownerScopeId: mappedProjectId, sourceId: parameterId
    } });
    if (!mapping.ok) {
      if (["PCAT-MAP-UNKNOWN-IDENTITY", "PCAT-MAP-UNMAPPED", "PCAT-MAP-CONFLICT"].includes(mapping.error.code)) return null;
      throw new ApiError("INTERNAL_ERROR", "Canonical identity resolution failed.");
    }
    if (mapping.value.outcome !== "mapped" || mapping.value.targetKind !== "parameter-binding") return null;
    bindingId = mapping.value.targetId;
  }
  const result = await db.query<{ id: string; project_id: string }>(
    `select id, project_id from parameter_catalog.project_parameter_bindings
     where organization_id = $1 and id = $2 and ($3::text is null or project_id = $3)`,
    [auth.organization.id, bindingId, mappedProjectId]
  );
  const binding = result.rows[0];
  if (!binding && mappedProjectId) return null;
  if (!binding) throw new ApiError("NOT_FOUND", "Parameter was not found.", { parameterId });
  requireCanViewProject(auth, binding.project_id);
  return binding;
}
