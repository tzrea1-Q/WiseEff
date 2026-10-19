import type { Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { dtsSearchResponseSchema, type DtsSearchBy } from "./schemas";
import { readProjectDtsNavigationNodes, searchDtsStructuralModel, type DtsSearchInput, type DtsSearchResultDto } from "./dtsSearchRepository";
import { loadOrganizationNavigationScope, navigationPathsWithAncestors } from "./structuralNavigationScope";

export type SearchProjectDtsInput = {
  organizationId: string;
  projectId: string;
  q: string;
  by?: DtsSearchBy;
  navigationScope?: "organization";
  principalId?: string;
};

/** Project-scoped DTS structured search over dts_* tables only. */
export async function searchProjectDts(
  db: Queryable,
  input: SearchProjectDtsInput,
): Promise<DtsSearchResultDto> {
  let navigation: DtsSearchInput["navigation"];
  if (input.navigationScope) {
    if (!input.principalId) throw new ApiError("VALIDATION_FAILED", "Organization navigation requires an authenticated principal.");
    const scope = await loadOrganizationNavigationScope(db, {
      organizationId: input.organizationId,
      principalId: input.principalId,
    });
    if (scope.status === "unavailable") {
      throw new ApiError("INTERNAL_ERROR", "Organization DTS navigation scope is unavailable.", { reason: scope.reason });
    }
    const nodes = await readProjectDtsNavigationNodes(db, input);
    const byVersion = new Map<string, typeof nodes>();
    for (const node of nodes) {
      const group = byVersion.get(node.versionId) ?? [];
      group.push(node);
      byVersion.set(node.versionId, group);
    }
    navigation = new Map([...byVersion].map(([versionId, versionNodes]) => {
      const managed = scope.matchNodePaths(versionNodes);
      return [versionId, {
        managedNodePaths: new Set(managed),
        visibleNodePaths: navigationPathsWithAncestors(versionNodes, managed),
      }];
    }));
  }
  const result = await searchDtsStructuralModel(db, { ...input, ...(navigation ? { navigation } : {}) });
  return dtsSearchResponseSchema.parse(result);
}
