import type { Queryable } from "../../shared/database/client";
import { structuralReadResponseSchema, type StructuralReadResponse } from "./schemas";
import { readDtsStructuralModel } from "./structuralReadRepository";
import { loadOrganizationNavigationScope } from "./structuralNavigationScope";
import type { GovernanceQueryAuthScope } from "../parameter-governance/queries";

/** Read structured DTS model for a file version from dts_* tables only. */
export async function getParameterFileVersionStructure(
  db: Queryable,
  fileVersionId: string,
  navigationAuthScope?: GovernanceQueryAuthScope,
): Promise<StructuralReadResponse> {
  const result = await readDtsStructuralModel(db, fileVersionId);
  if (!navigationAuthScope) return structuralReadResponseSchema.parse(result);
  const scope = await loadOrganizationNavigationScope(db, navigationAuthScope);
  const navigation = scope.status === "ready"
    ? { status: "ready" as const, catalogReleaseId: scope.catalogReleaseId, managedNodePaths: scope.matchNodePaths(result.nodes) }
    : scope;
  return structuralReadResponseSchema.parse({ ...result, navigation });
}
