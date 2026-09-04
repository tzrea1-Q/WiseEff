import type { AuthContext } from "../auth/types";
import { createUserInvocation } from "../auth/trustedInvocation";
import { hasLegacyParameterSpecId } from "../parameter-bindings/adapters/dto";
import { handleLegacyCatalogRequest } from "../parameter-catalog-api/legacy";
import type { LegacyCatalogOptions } from "../parameter-catalog-api/legacy";
import { canAdminParameters, canViewParameters } from "../parameter-kernel/policy";
import { routeManifest } from "../contracts/routeManifest";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { RouteRequest, RouteResponse } from "../../shared/http/router";

const SPEC_FAMILY_PREFIX = "parameterSpecs.";
const RESOLVE_REVIEW_ROUTE_ID = `${SPEC_FAMILY_PREFIX}resolveReviewTask`;
const LIST_REVIEW_ROUTE_ID = `${SPEC_FAMILY_PREFIX}listReviewTasks`;

function pathMatches(pattern: string, path: string): boolean {
  const patternSegments = pattern.split("/").filter(Boolean);
  const pathSegments = path.split("/").filter(Boolean);
  if (patternSegments.length !== pathSegments.length) {
    return false;
  }
  for (let index = 0; index < patternSegments.length; index += 1) {
    const expected = patternSegments[index]!;
    if (expected.startsWith(":")) {
      continue;
    }
    if (expected !== pathSegments[index]) {
      return false;
    }
  }
  return true;
}

function matchSpecRoute(method: string, path: string) {
  return routeManifest.find(
    (route) =>
      route.id.startsWith(SPEC_FAMILY_PREFIX) &&
      route.method === method &&
      pathMatches(route.path, path),
  );
}

/**
 * Topology-owned intercept for retired spec-family HTTP. Live topology contracts
 * (bindings, history, compare, mapping tasks, drafts) are not intercepted.
 */
export async function interceptLegacySpecSurface(
  request: RouteRequest,
  options: {
    db?: Database;
    getCurrentAuthContext: (request: RouteRequest) => Promise<AuthContext> | AuthContext;
  },
): Promise<RouteResponse | null> {
  const matched = matchSpecRoute(request.method, request.path);
  if (!matched) {
    return null;
  }

  const auth = await options.getCurrentAuthContext(request);
  const reviewSurface =
    matched.id === LIST_REVIEW_ROUTE_ID || matched.id === RESOLVE_REVIEW_ROUTE_ID;
  if (request.method !== "GET" || reviewSurface) {
    if (!canAdminParameters(auth)) {
      throw new ApiError("FORBIDDEN", "Parameter admin permission is required.");
    }
  } else if (!canViewParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Parameter view permission is required.");
  }

  if (matched.id === RESOLVE_REVIEW_ROUTE_ID) {
    const body =
      request.body && typeof request.body === "object"
        ? (request.body as Record<string, unknown>)
        : {};
    if (
      body.decision === "resolved" &&
      body.createSpec !== true &&
      !hasLegacyParameterSpecId(body)
    ) {
      throw new ApiError("VALIDATION_FAILED", "Invalid parameter topology route input.");
    }
  }

  const legacyOptions: LegacyCatalogOptions = {
    catalogReleaseId: "catalog-unready",
    sunsetHttpDate: "Fri, 31 Dec 2027 00:00:00 GMT",
    getQueryable: async () => {
      if (!options.db) {
        throw new Error("Catalog legacy lookup requires a database");
      }
      return options.db as never;
    },
    resolveInvocation: async () => createUserInvocation(auth),
  };

  try {
    const result = await handleLegacyCatalogRequest(request, legacyOptions);
    return { status: result.status, body: result.body, headers: { ...result.headers } };
  } catch {
    throw new ApiError("NOT_FOUND", "Parameter spec was not found.");
  }
}
