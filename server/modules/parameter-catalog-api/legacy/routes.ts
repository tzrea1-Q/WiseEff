import { canViewParameters } from "../../parameter-kernel/policy";
import type { TrustedInvocationContext } from "../../auth/trustedInvocation";
import {
  CATALOG_RELEASE_HEADER,
  catalogLegacyIdentifierResponseSchema,
  parameterCatalogBoundedLegacyReadRouteIds,
  parameterCatalogCanonicalRoutes,
  parameterCatalogLegacyWriteRouteIds,
} from "../../contracts/dtoSchemas/parameterCatalog";
import { routeManifest } from "../../contracts/routeManifest";
import { ApiError, serializeApiError } from "../../../shared/http/errors";
import {
  createRouter,
  type HttpMethod,
  type RouteRequest,
  type WiseEffRouter,
} from "../../../shared/http/router";

import {
  boundedLegacyHeaders,
  LEGACY_IDENTITY_CONTRACT,
  LEGACY_IDENTITY_WARNING,
  LEGACY_MODULE_CONTRACT,
  LEGACY_MODULE_WARNING,
  LEGACY_SPEC_CONTRACT,
  LEGACY_SPEC_WARNING,
} from "./headers";
import { catalogLegacyGoneResult, LEGACY_GOVERNANCE_GONE_MESSAGE, LEGACY_WRITE_GONE_MESSAGE } from "./gone";
import { lookupLegacyIdentifier } from "./lookup";
import type { LegacyCatalogOptions, LegacyHttpResult } from "./types";

const OPERATOR_PREFIX = "/api/v2/operator/parameter-catalog";

const writeRoutes = routeManifest.filter((route) =>
  (parameterCatalogLegacyWriteRouteIds as readonly string[]).includes(route.id),
);

const eligibleRoutes = routeManifest.filter((route) =>
  (parameterCatalogBoundedLegacyReadRouteIds as readonly string[]).includes(route.id),
);

const catalogLegacyIdentifierRoutes = parameterCatalogCanonicalRoutes.filter(
  (route) => route.id === "catalog.getLegacyIdentifier",
);

function addRoute(
  router: WiseEffRouter,
  method: HttpMethod,
  path: string,
  handler: Parameters<WiseEffRouter["get"]>[1],
): void {
  const add =
    method === "GET"
      ? router.get
      : method === "POST"
        ? router.post
        : method === "PUT"
          ? router.put
          : method === "PATCH"
            ? router.patch
            : router.delete;
  add.call(router, path, handler);
}

const headerValue = (
  headers: RouteRequest["headers"],
  name: string,
): string | undefined => {
  const needle = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== needle) {
      continue;
    }
    const raw = Array.isArray(value) ? value[0] : value;
    const trimmed = raw?.trim();
    return trimmed ? trimmed : undefined;
  }
  return undefined;
};

const queryValue = (query: RouteRequest["query"], name: string): string | undefined => {
  const value = query[name];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
};

const callerOrganizationId = (invocation: TrustedInvocationContext): string | null => {
  if (invocation.initiator === "system") {
    return null;
  }
  return invocation.principal.organization.id;
};

const callerCanLookup = (invocation: TrustedInvocationContext): boolean => {
  if (invocation.initiator === "system") {
    return true;
  }
  return canViewParameters(invocation.principal);
};

const familyHeaders = (
  routeId: string,
  options: LegacyCatalogOptions,
): ReturnType<typeof boundedLegacyHeaders> => {
  if (routeId.startsWith("parameterModules.")) {
    return boundedLegacyHeaders({
      sunsetHttpDate: options.sunsetHttpDate,
      contract: LEGACY_MODULE_CONTRACT,
      warning: LEGACY_MODULE_WARNING,
      catalogReleaseId: options.catalogReleaseId,
    });
  }
  if (routeId.startsWith("parameterTopology.")) {
    return boundedLegacyHeaders({
      sunsetHttpDate: options.sunsetHttpDate,
      contract: LEGACY_IDENTITY_CONTRACT,
      warning: LEGACY_IDENTITY_WARNING,
      catalogReleaseId: options.catalogReleaseId,
    });
  }
  return boundedLegacyHeaders({
    sunsetHttpDate: options.sunsetHttpDate,
    contract: LEGACY_SPEC_CONTRACT,
    warning: LEGACY_SPEC_WARNING,
    catalogReleaseId: options.catalogReleaseId,
  });
};

const lookupHeaders = (options: LegacyCatalogOptions) =>
  boundedLegacyHeaders({
    sunsetHttpDate: options.sunsetHttpDate,
    contract: LEGACY_SPEC_CONTRACT,
    warning: LEGACY_SPEC_WARNING,
    catalogReleaseId: options.catalogReleaseId,
  });

const requireRelease = (
  request: RouteRequest,
  options: LegacyCatalogOptions,
): LegacyHttpResult | null => {
  const offered = headerValue(request.headers, CATALOG_RELEASE_HEADER);
  if (!offered || offered === options.catalogReleaseId) {
    return null;
  }
  return {
    status: 409,
    headers: lookupHeaders(options),
    body: serializeApiError(
      new ApiError("CONFLICT", "The catalog release changed. Refresh before continuing.", {
        reason: "release-drift",
        expectedCatalogReleaseId: offered,
        currentCatalogReleaseId: options.catalogReleaseId,
        retryable: true,
      }),
      request.requestId,
    ),
  };
};

const outcomeToResult = (
  request: RouteRequest,
  options: LegacyCatalogOptions,
  headers: ReturnType<typeof boundedLegacyHeaders>,
  outcome: Awaited<ReturnType<typeof lookupLegacyIdentifier>>,
): LegacyHttpResult => {
  if (outcome.kind === "mapped") {
    return {
      status: 200,
      headers,
      body: catalogLegacyIdentifierResponseSchema.parse({ item: outcome.item }),
    };
  }
  if (outcome.kind === "archived") {
    return {
      status: 410,
      headers,
      body: serializeApiError(
        new ApiError("GONE", "The legacy identifier was archived and is not available for operational reads.", {
          reason: "legacy-id-archived",
          retryable: false,
        }),
        request.requestId,
      ),
    };
  }
  if (outcome.kind === "ambiguous") {
    return {
      status: 409,
      headers,
      body: serializeApiError(
        new ApiError("CONFLICT", "The legacy identifier mapping is ambiguous.", {
          reason: "legacy-id-ambiguous",
          retryable: false,
        }),
        request.requestId,
      ),
    };
  }
  return {
    status: 404,
    headers,
    body: serializeApiError(
      new ApiError("NOT_FOUND", "Legacy identifier was not found."),
      request.requestId,
    ),
  };
};

const requireLookupCaller = async (
  request: RouteRequest,
  options: LegacyCatalogOptions,
  headers: ReturnType<typeof boundedLegacyHeaders>,
): Promise<{ invocation: TrustedInvocationContext } | LegacyHttpResult> => {
  const invocation = await options.resolveInvocation(request);
  if (!invocation) {
    return {
      status: 401,
      headers,
      body: serializeApiError(
        new ApiError("UNAUTHENTICATED", "Authentication is required."),
        request.requestId,
      ),
    };
  }
  if (!callerCanLookup(invocation)) {
    return {
      status: 403,
      headers,
      body: serializeApiError(
        new ApiError("FORBIDDEN", "Parameter view permission is required.", {
          reason: "forbidden",
        }),
        request.requestId,
      ),
    };
  }
  return { invocation };
};

const runLookup = async (
  request: RouteRequest,
  options: LegacyCatalogOptions,
  legacyType: string,
  legacyId: string,
  headers: ReturnType<typeof boundedLegacyHeaders>,
): Promise<LegacyHttpResult> => {
  const release = requireRelease(request, options);
  if (release) {
    return release;
  }
  const caller = await requireLookupCaller(request, options, headers);
  if ("status" in caller) {
    return caller;
  }
  const q = queryValue(request.query, "q");
  const propertyKey = queryValue(request.query, "propertyKey");
  if (q !== undefined || propertyKey !== undefined) {
    return outcomeToResult(request, options, headers, { kind: "not-found" });
  }
  const client = await options.getQueryable();
  const outcome = await lookupLegacyIdentifier({
    client,
    lookup: options.lookup,
    legacyType,
    legacyId,
    organizationId: callerOrganizationId(caller.invocation),
  });
  return outcomeToResult(request, options, headers, outcome);
};

const isRetiredReadShape = (request: RouteRequest): boolean => {
  const view = queryValue(request.query, "view")?.toLowerCase();
  const mode = queryValue(request.query, "mode")?.toLowerCase();
  return view === "governance" || view === "raw" || mode === "raw";
};

const eligibleExactId = (routeId: string, request: RouteRequest): string | null => {
  if (routeId === "parameterSpecs.get") {
    return request.params.specId ?? null;
  }
  return queryValue(request.query, "id") ?? queryValue(request.query, "specId") ?? null;
};

const eligibleLegacyType = (routeId: string): string | null => {
  if (routeId === "parameterSpecs.list" || routeId === "parameterSpecs.get") {
    return "parameter-spec";
  }
  if (routeId === "parameterModules.getRegistry") {
    return "parameter-module";
  }
  return null;
};

export async function handleLegacyCatalogRequest(
  request: RouteRequest,
  options: LegacyCatalogOptions,
): Promise<LegacyHttpResult> {
  if (request.path === OPERATOR_PREFIX || request.path.startsWith(`${OPERATOR_PREFIX}/`)) {
    return {
      status: 404,
      headers: {},
      body: serializeApiError(
        new ApiError("NOT_FOUND", "Not found.", {
          reason: "migration-diagnostics-not-public",
        }),
        request.requestId,
      ),
    };
  }

  const router = createRouter();

  for (const route of catalogLegacyIdentifierRoutes) {
    addRoute(router, route.method, route.path, async (matched) => {
      const result = await runLookup(
        matched,
        options,
        matched.params.legacyType ?? "",
        matched.params.legacyId ?? "",
        lookupHeaders(options),
      );
      return { status: result.status, body: { __legacy: result } };
    });
  }

  for (const route of writeRoutes) {
    addRoute(router, route.method, route.path, async (matched) => {
      const gone = catalogLegacyGoneResult(matched.requestId, LEGACY_WRITE_GONE_MESSAGE);
      return { status: gone.status, body: { __legacy: gone } };
    });
  }

  for (const route of eligibleRoutes) {
    router.get(route.path, async (matched) => {
      const headers = familyHeaders(route.id, options);
      if (isRetiredReadShape(matched)) {
        const gone = catalogLegacyGoneResult(matched.requestId, LEGACY_GOVERNANCE_GONE_MESSAGE);
        return { status: gone.status, body: { __legacy: { ...gone, headers: { ...gone.headers, ...headers } } } };
      }
      const type = eligibleLegacyType(route.id);
      const exactId = eligibleExactId(route.id, matched);
      if (type && exactId) {
        const result = await runLookup(matched, options, type, exactId, headers);
        return { status: result.status, body: { __legacy: result } };
      }
      const q = queryValue(matched.query, "q");
      const propertyKey = queryValue(matched.query, "propertyKey");
      if (q !== undefined || propertyKey !== undefined) {
        const result = outcomeToResult(matched, options, headers, { kind: "not-found" });
        return { status: result.status, body: { __legacy: result } };
      }
      const release = requireRelease(matched, options);
      if (release) {
        return { status: release.status, body: { __legacy: release } };
      }
      const caller = await requireLookupCaller(matched, options, headers);
      if ("status" in caller) {
        return { status: caller.status, body: { __legacy: caller } };
      }
      return {
        status: 200,
        body: {
          __legacy: {
            status: 200,
            headers,
            body: { items: [] },
          },
        },
      };
    });
  }

  try {
    const routed = await router.handle(request);
    if ("body" in routed && routed.body && typeof routed.body === "object" && "__legacy" in routed.body) {
      return (routed.body as { __legacy: LegacyHttpResult }).__legacy;
    }
    return {
      status: routed.status,
      body: "body" in routed ? routed.body : {},
      headers: {},
    };
  } catch (error) {
    if (error instanceof ApiError && error.code === "NOT_FOUND") {
      return {
        status: 404,
        headers: {},
        body: serializeApiError(error, request.requestId),
      };
    }
    throw error;
  }
}

export function registerCatalogLegacyRoutes(
  router: WiseEffRouter,
  options: LegacyCatalogOptions,
): void {
  const handler = async (request: RouteRequest) => {
    const result = await handleLegacyCatalogRequest(request, options);
    // RouteResponse has no headers field; Deprecation/Sunset/Link/Warning stay on the isolated HTTP server.
    return { status: result.status, body: result.body };
  };

  for (const route of catalogLegacyIdentifierRoutes) {
    addRoute(router, route.method, route.path, handler);
  }
  for (const route of writeRoutes) {
    addRoute(router, route.method, route.path, handler);
  }
  for (const route of eligibleRoutes) {
    addRoute(router, route.method, route.path, handler);
  }
}

export const legacyWriteRouteManifest = writeRoutes.map((route) => ({
  id: route.id,
  method: route.method as HttpMethod,
  path: route.path,
}));

export const legacyEligibleRouteManifest = eligibleRoutes.map((route) => ({
  id: route.id,
  method: route.method as HttpMethod,
  path: route.path,
}));
