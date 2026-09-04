import type { AuthContext } from "../auth/types";
import { createUserInvocation } from "../auth/trustedInvocation";
import {
  registerCatalogLegacyRoutes,
  type LegacyCatalogOptions,
} from "../parameter-catalog-api/legacy";
import { routeManifest } from "../contracts/routeManifest";
import { getRootPostgresPool, type Database } from "../../shared/database/client";
import { createRouter, type RouteRequest, type WiseEffRouter } from "../../shared/http/router";

const CATALOG_SUNSET_HTTP_DATE = "Fri, 31 Dec 2027 00:00:00 GMT";
const UNAVAILABLE_RELEASE_ID = "catalog-unready";
const SPEC_FAMILY_PREFIX = "parameterSpecs.";

function createCghLegacyCatalogOptions(options: {
  db?: Database;
  getCurrentAuthContext: (request: RouteRequest) => Promise<AuthContext> | AuthContext;
}): LegacyCatalogOptions {
  return {
    catalogReleaseId: UNAVAILABLE_RELEASE_ID,
    sunsetHttpDate: CATALOG_SUNSET_HTTP_DATE,
    getQueryable: async () => {
      const pool = getRootPostgresPool(options.db);
      if (pool) {
        return pool;
      }
      if (options.db) {
        return options.db as unknown as Awaited<ReturnType<LegacyCatalogOptions["getQueryable"]>>;
      }
      throw new Error("Catalog legacy lookup requires a database");
    },
    resolveInvocation: async (request) =>
      createUserInvocation(await options.getCurrentAuthContext(request)),
  };
}

function parameterSpecLegacyPathPatterns(): ReadonlySet<string> {
  return new Set(
    routeManifest
      .filter((route) => route.id.startsWith(SPEC_FAMILY_PREFIX))
      .map((route) => route.path),
  );
}

/**
 * Catalog/governance HTTP consumers use S8-LEG exact adapters (typed lookup or 410).
 * Live Effective/Governance writers are no longer reachable through these routes.
 */
export function registerParameterSpecRoutes(
  router: WiseEffRouter,
  options: {
    db?: Database;
    objectStore?: unknown;
    refusalAuditSink?: unknown;
    getCurrentAuthContext: (
      request: RouteRequest,
    ) => Promise<AuthContext> | AuthContext;
  },
) {
  const inner = createRouter();
  registerCatalogLegacyRoutes(inner, createCghLegacyCatalogOptions(options));
  const specPatterns = parameterSpecLegacyPathPatterns();
  const originalHandle = router.handle.bind(router);
  router.handle = async (request) => {
    const pattern = inner.matchRoutePattern(request.method, request.path);
    if (pattern && specPatterns.has(pattern)) {
      return inner.handle(request);
    }
    return originalHandle(request);
  };
}
