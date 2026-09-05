import {
  CATALOG_DEPRECATION_HEADER,
  CATALOG_IDEMPOTENCY_HEADER,
  CATALOG_IF_MATCH_HEADER,
  CATALOG_RELEASE_HEADER,
  catalogForbiddenSpoofHeaders,
  parameterCatalogCanonicalRoutes,
  parameterCatalogKernelReadByRouteId,
  parameterCatalogLegacyWriteRouteIds,
} from "../../../contracts/dtoSchemas/parameterCatalog";
import { routeManifest } from "../../../contracts/routeManifest";
import { apiVerificationGateIds } from "../../core/gateRegistry";
import type { CatalogApiPrincipalMode } from "./types";

export const CATALOG_API_GATE_IDS = apiVerificationGateIds;

export const CATALOG_API_PROBE_CONTEXT = {
  subjectId: "csub_acme_power",
  definitionId: "pdef_acme_power_iin_min",
  revisionId: "drev_acme_power_iin_min_1",
  projectId: "prj-s10-api",
} as const;

export type CatalogApiProbeContext = {
  readonly organizationId: string;
  readonly catalogReleaseId: string;
  readonly subjectId: string;
  readonly definitionId: string;
  readonly revisionId: string;
  readonly projectId: string;
};

export type CatalogApiProbeExchange = {
  readonly exchangeId: string;
  readonly method: string;
  readonly path: string;
  readonly principal: CatalogApiPrincipalMode;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
  readonly spoof?: boolean;
};

const spoofHeaders = Object.fromEntries(
  catalogForbiddenSpoofHeaders.map((name) => [name, name === "X-WiseEff-Agent" ? "true" : "platform-admin"]),
) as Record<string, string>;

const writeRoute = routeManifest.find((route) => route.id === parameterCatalogLegacyWriteRouteIds[0]);
const eligibleRead = routeManifest.find((route) => route.id === "parameterSpecs.list");

const nineKernelRoutes = parameterCatalogCanonicalRoutes.filter(
  (route) => route.id in parameterCatalogKernelReadByRouteId,
);

const fill = (path: string, ctx: CatalogApiProbeContext): string =>
  path
    .replace(":subjectId", ctx.subjectId)
    .replace(":definitionId", ctx.definitionId)
    .replace(":revisionId", ctx.revisionId)
    .replace(":organizationId", ctx.organizationId)
    .replace(":projectId", ctx.projectId)
    .replace(":legacyType", "parameter-spec")
    .replace(":legacyId", "unknown-legacy")
    .replace(":bindingId", "bind-s10-api");

export const kernelReadRouteIds = nineKernelRoutes.map((route) => route.id);

const kernelExchanges = (ctx: CatalogApiProbeContext): CatalogApiProbeExchange[] =>
  nineKernelRoutes.map((route) => ({
    exchangeId: route.id,
    method: route.method,
    path: fill(route.path, ctx),
    principal: "authorized",
    headers: { [CATALOG_RELEASE_HEADER]: ctx.catalogReleaseId },
  }));

export const probesFor = (ctx: CatalogApiProbeContext): Record<(typeof CATALOG_API_GATE_IDS)[number], readonly CatalogApiProbeExchange[]> => {
  const releaseHeaders = { [CATALOG_RELEASE_HEADER]: ctx.catalogReleaseId };
  const writeHeaders = {
    ...releaseHeaders,
    [CATALOG_IDEMPOTENCY_HEADER]: `s10-api:${ctx.organizationId}`,
  };
  return {
    "PCAT-API-01": [
      {
        exchangeId: "catalog-ready",
        method: "GET",
        path: "/api/v2/catalog",
        principal: "authorized",
      },
      {
        exchangeId: "catalog-unauthenticated",
        method: "GET",
        path: "/api/v2/catalog",
        principal: "unauthenticated",
      },
    ],
    "PCAT-API-02": [
      {
        exchangeId: "list-subjects",
        method: "GET",
        path: "/api/v2/catalog/subjects",
        principal: "authorized",
      },
      {
        exchangeId: "get-subject",
        method: "GET",
        path: `/api/v2/catalog/subjects/${ctx.subjectId}`,
        principal: "authorized",
      },
      {
        exchangeId: "list-definitions",
        method: "GET",
        path: "/api/v2/catalog/definitions",
        principal: "authorized",
      },
      {
        exchangeId: "hidden-subject",
        method: "GET",
        path: "/api/v2/catalog/subjects/csub_missing_s10_api",
        principal: "authorized",
      },
      {
        exchangeId: "spoof-list-subjects",
        method: "GET",
        path: "/api/v2/catalog/subjects",
        principal: "authorized",
        spoof: true,
        headers: spoofHeaders,
      },
    ],
    "PCAT-API-03": [
      {
        exchangeId: "list-revisions",
        method: "GET",
        path: `/api/v2/catalog/definitions/${ctx.definitionId}/revisions`,
        principal: "authorized",
      },
      {
        exchangeId: "get-revision",
        method: "GET",
        path: `/api/v2/catalog/definitions/${ctx.definitionId}/revisions/${ctx.revisionId}`,
        principal: "authorized",
      },
      {
        exchangeId: "missing-revision",
        method: "GET",
        path: `/api/v2/catalog/definitions/${ctx.definitionId}/revisions/drev_does_not_exist`,
        principal: "authorized",
      },
      {
        exchangeId: "timeline",
        method: "GET",
        path: `/api/v2/catalog/definitions/${ctx.definitionId}/timeline`,
        principal: "authorized",
      },
    ],
    "PCAT-API-04": [
      {
        exchangeId: "create-registration",
        method: "POST",
        path: `/api/v2/organizations/${ctx.organizationId}/subject-registrations`,
        principal: "authorized",
        headers: writeHeaders,
        body: {
          subjectId: ctx.subjectId,
          placement: { mode: "use-default" },
          reason: "s10-api registration evidence",
        },
      },
      {
        exchangeId: "list-registrations",
        method: "GET",
        path: `/api/v2/organizations/${ctx.organizationId}/subject-registrations`,
        principal: "authorized",
        headers: releaseHeaders,
      },
    ],
    "PCAT-API-05": [
      {
        exchangeId: "list-review-items",
        method: "GET",
        path: `/api/v2/organizations/${ctx.organizationId}/parameter-review-items`,
        principal: "authorized",
        headers: releaseHeaders,
      },
      {
        exchangeId: "review-unauthenticated",
        method: "GET",
        path: `/api/v2/organizations/${ctx.organizationId}/parameter-review-items`,
        principal: "unauthenticated",
      },
    ],
    "PCAT-API-06": [
      {
        exchangeId: "create-proposal",
        method: "POST",
        path: "/api/v2/catalog/definition-proposals",
        principal: "authorized",
        headers: {
          ...writeHeaders,
          [CATALOG_IDEMPOTENCY_HEADER]: `s10-api-proposal:${ctx.organizationId}`,
        },
        body: {
          base: {
            catalogReleaseId: ctx.catalogReleaseId,
            definitionId: ctx.definitionId,
            definitionRevisionId: ctx.revisionId,
          },
          requestedChange: { kind: "revise-definition", note: "s10-api" },
          reason: "s10-api proposal evidence",
        },
      },
    ],
    "PCAT-API-07": [
      {
        exchangeId: "legacy-lookup",
        method: "GET",
        path: "/api/v2/catalog/legacy-identifiers/parameter-spec/unknown-legacy",
        principal: "authorized",
        headers: releaseHeaders,
      },
    ],
    "PCAT-API-08": [
      {
        exchangeId: "legacy-write-gone",
        method: writeRoute?.method ?? "POST",
        path: writeRoute?.path ?? "/api/v2/parameter-specs",
        principal: "authorized",
        body: { name: "retired-write" },
      },
      {
        exchangeId: "legacy-read-headers",
        method: "GET",
        path: eligibleRead?.path ?? "/api/v2/parameter-specs",
        principal: "authorized",
        headers: releaseHeaders,
      },
    ],
    "PCAT-API-09": [
      {
        exchangeId: "agent-read",
        method: "GET",
        path: `/api/v2/organizations/${ctx.organizationId}/parameter-review-items`,
        principal: "agent",
        headers: releaseHeaders,
      },
      {
        exchangeId: "agent-write",
        method: "POST",
        path: `/api/v2/organizations/${ctx.organizationId}/subject-registrations`,
        principal: "agent",
        headers: {
          ...releaseHeaders,
          [CATALOG_IDEMPOTENCY_HEADER]: `s10-api-agent:${ctx.organizationId}`,
        },
        body: {
          subjectId: ctx.subjectId,
          placement: { mode: "use-default" },
          reason: "agent must not mutate",
        },
      },
      {
        exchangeId: "spoof-write",
        method: "GET",
        path: `/api/v2/organizations/${ctx.organizationId}/parameter-review-items`,
        principal: "authorized",
        spoof: true,
        headers: { ...releaseHeaders, ...spoofHeaders },
      },
    ],
    "PCAT-API-10": [
      {
        exchangeId: "release-drift",
        method: "GET",
        path: "/api/v2/catalog/subjects",
        principal: "authorized",
        headers: { [CATALOG_RELEASE_HEADER]: "crel_stale_s10_api" },
      },
      {
        exchangeId: "missing-idempotency",
        method: "POST",
        path: `/api/v2/organizations/${ctx.organizationId}/subject-registrations`,
        principal: "authorized",
        headers: releaseHeaders,
        body: {
          subjectId: ctx.subjectId,
          placement: { mode: "use-default" },
        },
      },
      {
        exchangeId: "stale-if-match",
        method: "POST",
        path: `/api/v2/organizations/${ctx.organizationId}/parameter-review-items/prit_missing/resolve`,
        principal: "authorized",
        headers: {
          ...writeHeaders,
          [CATALOG_IF_MATCH_HEADER]: '"stale-etag"',
          [CATALOG_IDEMPOTENCY_HEADER]: `s10-api-if-match:${ctx.organizationId}`,
        },
        body: { resolution: { type: "mark-out-of-scope" }, reason: "unknown" },
      },
    ],
    "PCAT-API-11": kernelExchanges(ctx),
    "PCAT-API-12": [
      {
        exchangeId: "list-bindings",
        method: "GET",
        path: `/api/v2/projects/${ctx.projectId}/parameter-bindings`,
        principal: "authorized",
      },
      {
        exchangeId: "binding-history",
        method: "GET",
        path: `/api/v2/projects/${ctx.projectId}/bindings/bind-s10-api/history`,
        principal: "authorized",
      },
      {
        exchangeId: "binding-unauthenticated",
        method: "GET",
        path: `/api/v2/projects/${ctx.projectId}/parameter-bindings`,
        principal: "unauthenticated",
      },
    ],
  };
};

export { CATALOG_DEPRECATION_HEADER, CATALOG_RELEASE_HEADER };
