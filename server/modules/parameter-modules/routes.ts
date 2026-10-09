import type { AuthContext } from "../auth/types";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { RouteRequest, WiseEffRouter } from "../../shared/http/router";
import { catalogLegacyGoneResult, LEGACY_GOVERNANCE_GONE_MESSAGE, LEGACY_WRITE_GONE_MESSAGE } from "../parameter-catalog-api/legacy/gone";
import { legacyWriteRouteManifest } from "../parameter-catalog-api/legacy/routes";
import {
  boundedLegacyHeaders,
  CATALOG_SUNSET_HTTP_DATE,
  LEGACY_MODULE_CONTRACT,
  LEGACY_MODULE_WARNING,
} from "../parameter-catalog-api/legacy/headers";
import { getModuleDiscoveryHints, getParameterModuleRegistry, listDriverRegistry } from "./service";

const legacyReadHeaders = boundedLegacyHeaders({
  sunsetHttpDate: CATALOG_SUNSET_HTTP_DATE,
  contract: LEGACY_MODULE_CONTRACT,
  warning: LEGACY_MODULE_WARNING,
});

function requireDb(db: Database | undefined) {
  if (!db) {
    throw new ApiError("INTERNAL_ERROR", "Database adapter is required for parameter module routes.");
  }
  return db;
}

export function registerParameterModuleRoutes(
  router: WiseEffRouter,
  options: {
    db?: Database;
    getCurrentAuthContext: (request: RouteRequest) => Promise<AuthContext> | AuthContext;
  }
) {
  for (const route of legacyWriteRouteManifest.filter(route => route.id.startsWith("parameterModules."))) {
    router[route.method.toLowerCase() as "post" | "patch" | "delete"](route.path, async request =>
      catalogLegacyGoneResult(request.requestId, LEGACY_WRITE_GONE_MESSAGE));
  }

  router.get("/api/v2/parameter-modules", async (request) => {
    if ([request.query.view, request.query.mode].flat().some(value => ["raw", "governance"].includes(value?.toLowerCase() ?? ""))) {
      return catalogLegacyGoneResult(request.requestId, LEGACY_GOVERNANCE_GONE_MESSAGE);
    }
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const result = await getParameterModuleRegistry(db, auth);
    return { status: 200, headers: legacyReadHeaders, body: result };
  });

  router.get("/api/v2/parameter-modules/discovery-hints", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const result = await getModuleDiscoveryHints(db, auth);
    return { status: 200, headers: legacyReadHeaders, body: result };
  });

  router.get("/api/v2/parameter-modules/driver-registry", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const result = await listDriverRegistry(db, auth);
    return { status: 200, headers: legacyReadHeaders, body: result };
  });
}
