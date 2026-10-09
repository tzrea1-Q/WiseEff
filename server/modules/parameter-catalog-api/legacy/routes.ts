import type { z } from "zod";

import { canViewParameters } from "../../parameter-kernel/policy";
import type { TrustedInvocationContext } from "../../auth/trustedInvocation";
import { assertTrustedRefusalAuditSink, type TrustedRefusalAuditSink } from "../../audit/trustedRefusalSink";
import {
  CATALOG_RELEASE_HEADER,
  catalogDefinitionResponseSchema,
  catalogDefinitionRevisionListResponseSchema,
  catalogLegacySpecListResponseSchema,
  catalogLegacySpecResponseSchema,
  type catalogLegacySpecDtoSchema,
  type catalogLegacySpecDispositionDtoSchema,
  type catalogDefinitionRevisionDtoSchema,
  catalogLegacyIdentifierResponseSchema,
  parameterCatalogBoundedLegacyReadRouteIds,
  parameterCatalogCanonicalRoutes,
  parameterCatalogLegacyWriteRouteIds,
} from "../../contracts/dtoSchemas/parameterCatalog";
import { routeManifest } from "../../contracts/routeManifest";
import { errorEnvelopeSchema } from "../../contracts/dtoSchemas/envelopes";
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
import { catalogLegacyGoneResult, legacyRouteSuccessor, LEGACY_GOVERNANCE_GONE_MESSAGE, LEGACY_WRITE_GONE_MESSAGE } from "./gone";
import { lookupLegacyIdentifier } from "./lookup";
import type { LegacyCatalogOptions, LegacyHttpHeaders, LegacyHttpResult, LegacyLookupOutcome } from "./types";

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

const currentCatalogReleaseId = async (options: LegacyCatalogOptions): Promise<string> =>
  options.resolveCatalogReleaseId
    ? options.resolveCatalogReleaseId()
    : options.catalogReleaseId;

const requireRelease = async (
  request: RouteRequest,
  options: LegacyCatalogOptions,
): Promise<LegacyHttpResult | null> => {
  const current = await currentCatalogReleaseId(options);
  const offered = headerValue(request.headers, CATALOG_RELEASE_HEADER);
  if (!offered || offered === current) {
    return null;
  }
  return {
    status: 409,
    headers: lookupHeaders({ ...options, catalogReleaseId: current }),
    body: serializeApiError(
      new ApiError("CONFLICT", "The catalog release changed. Refresh before continuing.", {
        reason: "release-drift",
        expectedCatalogReleaseId: offered,
        currentCatalogReleaseId: current,
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
  let invocation: TrustedInvocationContext | null;
  try {
    invocation = await options.resolveInvocation(request);
  } catch (error) {
    if (!(error instanceof ApiError) || !["UNAUTHENTICATED", "FORBIDDEN"].includes(error.code)) throw error;
    return { status: error.status, headers, body: serializeApiError(error, request.requestId) };
  }
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
  const release = await requireRelease(request, options);
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
  return view === "governance" || view === "raw" || view === "migration" || mode === "raw" || mode === "migration";
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

  options = {
    ...options,
    catalogReleaseId: await currentCatalogReleaseId(options),
  };

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
      const gone = catalogLegacyGoneResult(matched.requestId, LEGACY_WRITE_GONE_MESSAGE, legacyRouteSuccessor(route.id));
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
      if (options.readCatalog && (route.id === "parameterSpecs.list" || route.id === "parameterSpecs.get")) {
        const release = await requireRelease(matched, options);
        if (release) return { status: release.status, body: { __legacy: release } };
        const caller = await requireLookupCaller(matched, options, headers);
        if ("status" in caller) return { status: caller.status, body: { __legacy: caller } };
        const inference = queryValue(matched.query, "q") ?? queryValue(matched.query, "propertyKey");
        const result = inference !== undefined
          ? outcomeToResult(matched, options, headers, { kind: "not-found" })
          : await readLegacySpecs({ request: matched, options, headers, exactId, detail: route.id === "parameterSpecs.get",
            organizationId: callerOrganizationId(caller.invocation) });
        return { status: result.status, body: { __legacy: result } };
      }
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
      const release = await requireRelease(matched, options);
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

export function registerCatalogLegacyRetirementRoutes(
  router: WiseEffRouter,
  options?: { resolveInvocation: LegacyCatalogOptions["resolveInvocation"]; refusalAuditSink: TrustedRefusalAuditSink },
): void {
  if (options) assertTrustedRefusalAuditSink(options.refusalAuditSink);
  for (const route of writeRoutes) {
    router.prepend(route.method, route.path, async (request) => {
      if (options) {
        let invocation: TrustedInvocationContext | null;
        try {
          invocation = await options.resolveInvocation(request);
        } catch (error) {
          if (!(error instanceof ApiError) || !["UNAUTHENTICATED", "FORBIDDEN"].includes(error.code)) throw error;
          invocation = null;
        }
        if (invocation) {
          await options.refusalAuditSink.write({
            invocation,
            projectId: null,
            app: "parameter-catalog",
            kind: "legacy-surface-retired",
            action: "deny",
            severity: "Low",
            targetType: "legacy-route",
            targetId: route.id,
            metadata: { reason: "legacy-surface-retired", routeId: route.id, method: route.method },
            traceId: request.requestId,
          });
        }
      }
      return catalogLegacyGoneResult(request.requestId, LEGACY_WRITE_GONE_MESSAGE, legacyRouteSuccessor(route.id));
    });
  }
}

export function registerCatalogLegacyRoutes(
  router: WiseEffRouter,
  options: LegacyCatalogOptions,
): void {
  const handler = async (request: RouteRequest) => {
    const result = await handleLegacyCatalogRequest(request, options);
    return { status: result.status, body: result.body, headers: { ...result.headers } };
  };

  for (const route of catalogLegacyIdentifierRoutes) {
    addRoute(router, route.method, route.path, handler);
  }
  for (const route of writeRoutes) {
    addRoute(router, route.method, route.path, handler);
  }
  for (const route of eligibleRoutes) {
    if (route.id === "parameterSpecs.list" || route.id === "parameterSpecs.get") {
      router.prepend(route.method, route.path, handler);
    } else {
      addRoute(router, route.method, route.path, handler);
    }
  }
}

type SpecItem = z.infer<typeof catalogLegacySpecDtoSchema>;
type Disposition = z.infer<typeof catalogLegacySpecDispositionDtoSchema>;

async function readLegacySpecs(input: {
  request: RouteRequest;
  options: LegacyCatalogOptions;
  organizationId: string | null;
  headers: LegacyHttpHeaders;
  exactId: string | null;
  detail: boolean;
}): Promise<LegacyHttpResult> {
  const { request, options, organizationId, headers, exactId, detail } = input;
  const client = await options.getQueryable();
  const identities = await client.query<{ source_kind: "parameter-spec" | "parameter-spec-version"; source_id: string }>(`
    select distinct source_kind, source_id from parameter_catalog.legacy_identities
    where source_system = 'wiseeff-v1' and source_kind in ('parameter-spec', 'parameter-spec-version')
      and ((owner_scope_kind = 'platform' and owner_scope_id = 'platform')
        or (owner_scope_kind = 'organization' and owner_scope_id = $1))
    order by source_kind, source_id`, [organizationId]);
  const lookup = (legacyType: string, legacyId: string) => lookupLegacyIdentifier({
    client, lookup: options.lookup, legacyType, legacyId, organizationId,
  });
  const disposition = (legacyType: "parameter-spec" | "parameter-spec-version", legacyId: string,
    outcome: LegacyLookupOutcome): Disposition => outcome.kind === "mapped" ? outcome.item : {
      legacyType, legacyId, disposition: outcome.kind, historicalOnly: true,
    };
  const read = async (path: string) => {
    const response = await options.readCatalog!({ ...request,
      headers: { ...request.headers, [CATALOG_RELEASE_HEADER]: options.catalogReleaseId },
    }, path);
    const boundedHeaders = { ...headers, ...response.headers };
    if (response.status === 409) {
      const parsed = errorEnvelopeSchema.safeParse(response.body);
      const details = parsed.success ? parsed.data.error.details : {};
      if (details.reason === "release-drift" && typeof details.currentCatalogReleaseId === "string") {
        boundedHeaders[CATALOG_RELEASE_HEADER] = details.currentCatalogReleaseId;
      }
    }
    return { ...response, headers: boundedHeaders };
  };
  const items: SpecItem[] = [];
  const historicalItems: Disposition[] = [];
  const revisionsById = new Map<string, z.infer<typeof catalogDefinitionRevisionDtoSchema>>();
  const specIds = exactId ? [exactId] : identities.rows
    .filter((identity) => identity.source_kind === "parameter-spec").map((identity) => identity.source_id);
  for (const legacyId of specIds) {
    const outcome = await lookup("parameter-spec", legacyId);
    if (outcome.kind !== "mapped" || outcome.item.target.kind !== "parameter-definition") {
      historicalItems.push(disposition("parameter-spec", legacyId, outcome));
      continue;
    }
    const canonical = await read(`/api/v2/catalog/definitions/${encodeURIComponent(outcome.item.target.id)}`);
    if (canonical.status === 404) {
      historicalItems.push(disposition("parameter-spec", legacyId, { kind: "not-found" }));
      continue;
    }
    if (canonical.status !== 200) return canonical;
    const definition = catalogDefinitionResponseSchema.parse(canonical.body).item;
    items.push({ ...outcome.item, legacyType: "parameter-spec", definition, revisions: [] });
  }
  if (identities.rows.some((identity) => identity.source_kind === "parameter-spec-version")) {
    for (const definitionId of new Set(items.map((item) => item.definition.id))) {
      let cursor: string | null = null;
      do {
        const query = new URLSearchParams({ limit: "100", ...(cursor ? { cursor } : {}) });
        const canonical = await read(`/api/v2/catalog/definitions/${encodeURIComponent(definitionId)}/revisions?${query}`);
        if (canonical.status !== 200) return canonical;
        const page = catalogDefinitionRevisionListResponseSchema.parse(canonical.body);
        for (const revision of page.items) revisionsById.set(revision.id, revision);
        cursor = page.nextCursor;
      } while (cursor);
    }
  }
  for (const identity of identities.rows.filter((row) => row.source_kind === "parameter-spec-version")) {
    const outcome = await lookup(identity.source_kind, identity.source_id);
    if (outcome.kind !== "mapped" || outcome.item.target.kind !== "definition-revision") {
      if (!exactId) historicalItems.push(disposition(identity.source_kind, identity.source_id, outcome));
      continue;
    }
    const revision = revisionsById.get(outcome.item.target.id);
    if (!revision) {
      if (!exactId) historicalItems.push({ ...outcome.item, historicalOnly: true });
      continue;
    }
    const specs = items.filter((item) => item.definition.id === revision.definitionId);
    for (const spec of specs) spec.revisions.push({ ...outcome.item, legacyType: "parameter-spec-version", revision });
  }
  if (!detail) return { status: 200, headers,
    body: catalogLegacySpecListResponseSchema.parse({ items, historicalItems }) };
  if (items[0]) return { status: 200, headers,
    body: catalogLegacySpecResponseSchema.parse({ item: items[0] }) };
  const historical = historicalItems[0]!;
  if (historical.disposition === "mapped") return { status: 200, headers,
    body: catalogLegacySpecResponseSchema.parse({ item: historical }) };
  const status = historical.disposition === "archived" ? 410 : historical.disposition === "ambiguous" ? 409 : 404;
  const code = status === 410 ? "GONE" : status === 409 ? "CONFLICT" : "NOT_FOUND";
  return { status, headers, body: serializeApiError(new ApiError(code, "No exact operational spec mapping is available.", {
    disposition: historical.disposition, historicalOnly: true,
    ...(status === 404 ? {} : { reason: status === 410 ? "legacy-id-archived" : "legacy-id-ambiguous", retryable: false }),
  }), request.requestId) };
}

export const legacyWriteRouteManifest = writeRoutes.map((route) => ({
  id: route.id,
  method: route.method as HttpMethod,
  path: route.path,
}));

export const legacyDriverSchemaRetirementRouteManifest = legacyWriteRouteManifest.filter((route) => [
  "parameterSpecs.listOrganizationDriverSchemas",
  "parameterSpecs.getOrganizationDriverSchema",
  "parameterSpecs.createOrganizationDriverSchema",
  "parameterSpecs.updateOrganizationDriverSchema",
  "parameterSpecs.activateOrganizationDriverSchema",
  "parameterSpecs.previewOrganizationDriverSchemaDeprecation",
  "parameterSpecs.deprecateOrganizationDriverSchema",
  "parameterSpecs.listPromotionCandidates",
  "parameterSpecs.promoteDriverSchemaOverlay",
  "parameterSpecs.revertDriverSchemaPromotion",
].includes(route.id));

export const legacyEligibleRouteManifest = eligibleRoutes.map((route) => ({
  id: route.id,
  method: route.method as HttpMethod,
  path: route.path,
}));
