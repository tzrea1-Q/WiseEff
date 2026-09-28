import type { AuthContext } from "../auth/types";
import { listDriverCompatibleDiscovery } from "../parameter-governance/queries";
import type { Database } from "../../shared/database/client";
import type { RouteRequest, WiseEffRouter } from "../../shared/http/router";
import type { ObjectStore } from "../logs/objectStore";
import { parameterCatalogCanonicalRoutes } from "../contracts/dtoSchemas/parameterCatalog";
import { catalogGovernanceOk, catalogNotReady, notFound, releaseDrift, unauthenticated, validationFailed } from "./governance/errors";
import { catalogReleaseHeader } from "./governance/query";

const path = parameterCatalogCanonicalRoutes.find((route) =>
  route.id === "catalog.listDriverCompatibleDiscovery")!.path;

/** C1 owns parsing, matching, source proof and the final publication pin check. */
export function registerCatalogDriverCompatibleDiscoveryRoute(router: WiseEffRouter, options: {
  db?: Database;
  objectStore?: ObjectStore;
  resolveAuth: (request: RouteRequest) => Promise<AuthContext> | AuthContext;
}): void {
  router.get(path, async (request) => {
    const auth = await options.resolveAuth(request);
    if (!auth.user.isActive) return unauthenticated(request.requestId);
    if (request.params.organizationId !== auth.organization.id) return notFound(request.requestId);
    const allowed = new Set(["projectId", "observationId", "cursor", "limit"]);
    if (Object.entries(request.query).some(([key, value]) => !allowed.has(key) || Array.isArray(value))) {
      return validationFailed(request.requestId, "query");
    }
    const { projectId, observationId, cursor, limit: rawLimit } = request.query;
    const expectedReleaseId = catalogReleaseHeader(request.headers);
    if (cursor !== undefined && !expectedReleaseId) {
      return validationFailed(request.requestId, "catalogReleaseId");
    }
    if (rawLimit !== undefined && !/^[1-9]\d*$/.test(rawLimit as string)) {
      return validationFailed(request.requestId, "limit");
    }
    if (!options.db || !options.objectStore) return catalogNotReady(request.requestId);
    const page = await listDriverCompatibleDiscovery({
      db: options.db, objectStore: options.objectStore, auth,
      projectId: projectId as string | undefined,
      observationId: observationId as string | undefined,
      cursor: cursor as string | undefined,
      limit: rawLimit === undefined ? undefined : Number(rawLimit),
    });
    if (page.status === "unavailable") {
      return { status: 200, body: page, headers: { "X-Request-Id": request.requestId } };
    }
    if (expectedReleaseId && expectedReleaseId !== page.catalogRelease.id) {
      return releaseDrift(request.requestId, expectedReleaseId, page.catalogRelease.id);
    }
    return catalogGovernanceOk({body: page, requestId: request.requestId,
      catalogReleaseId: page.catalogRelease.id});
  });
}
