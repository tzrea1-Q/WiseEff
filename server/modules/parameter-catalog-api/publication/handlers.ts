import {
  catalogCreatePublicationCandidateRequestSchema,
  catalogPublishPublicationCandidateRequestSchema,
} from "../../contracts/dtoSchemas/parameterCatalog";
import type { CatalogReleasePin } from "../../parameter-catalog-contract/index";
import { itemEnvelope, mapPublicationCandidate, mapPublicationJob } from "./dto";
import {
  catalogNotReady,
  catalogPublicationOk,
  forbidden,
  mapPublicationFailure,
  notFound,
  releaseDrift,
  unauthenticated,
  validationFailed,
} from "./errors";
import {
  catalogPublicationCommandByRouteId,
  catalogPublicationRoutes,
  catalogPublicationWriteRouteIds,
  type CatalogPublicationCommandName,
} from "./mapping";
import { catalogReleaseHeader, stripSpoofHeaders } from "./query";
import type {
  CatalogPublicationPorts,
  CatalogPublicationRequest,
  CatalogPublicationResponse,
  CatalogPublicationRouteId,
  TrustedPublicationScope,
} from "./types";

const writeRoutes = new Set<string>(catalogPublicationWriteRouteIds);

const catalogPublicationRouteTable = catalogPublicationRoutes
  .map((route) => {
    const segments = route.path.split("/").filter(Boolean);
    return {
      id: route.id as CatalogPublicationRouteId,
      method: route.method,
      path: route.path,
      segments,
      staticCount: segments.filter((segment) => !segment.startsWith(":")).length,
    };
  })
  .sort(
    (left, right) =>
      right.segments.length - left.segments.length || right.staticCount - left.staticCount,
  );

export function matchCatalogPublicationRoute(
  method: string,
  path: string,
): { readonly id: CatalogPublicationRouteId; readonly params: Record<string, string> } | null {
  const pathSegments = path.split("/").filter(Boolean);
  for (const route of catalogPublicationRouteTable) {
    if (route.method !== method.toUpperCase()) {
      continue;
    }
    if (route.segments.length !== pathSegments.length) {
      continue;
    }
    const params: Record<string, string> = {};
    let matched = true;
    for (let index = 0; index < route.segments.length; index += 1) {
      const expected = route.segments[index]!;
      const actual = pathSegments[index]!;
      if (expected.startsWith(":")) {
        try {
          params[expected.slice(1)] = decodeURIComponent(actual);
        } catch {
          matched = false;
          break;
        }
      } else if (expected !== actual) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return { id: route.id, params };
    }
  }
  return null;
}

function asCommandName(id: CatalogPublicationRouteId): CatalogPublicationCommandName {
  return catalogPublicationCommandByRouteId[id];
}

async function requirePin(
  ports: CatalogPublicationPorts,
  request: CatalogPublicationRequest,
  options: { readonly requireHeader: boolean },
): Promise<
  | { ok: true; pin: CatalogReleasePin }
  | { ok: false; response: CatalogPublicationResponse }
> {
  const pin = await ports.currentRelease();
  if (!pin) {
    return { ok: false, response: catalogNotReady(request.requestId) };
  }
  const offered = catalogReleaseHeader(request.headers);
  if (options.requireHeader && !offered) {
    return { ok: false, response: validationFailed(request.requestId, "X-WiseEff-Catalog-Release") };
  }
  if (offered && offered !== pin.id) {
    return { ok: false, response: releaseDrift(request.requestId, offered, pin.id) };
  }
  return { ok: true, pin };
}

function denyAgent(scope: TrustedPublicationScope, requestId: string): CatalogPublicationResponse | null {
  if (scope.actorKind === "agent" || scope.trustedActor.initiator !== "user") {
    return forbidden(requestId, "publication-not-authorized");
  }
  return null;
}

async function dispatch(
  ports: CatalogPublicationPorts,
  request: CatalogPublicationRequest,
  scope: TrustedPublicationScope,
  routeId: CatalogPublicationRouteId,
  params: Record<string, string>,
): Promise<CatalogPublicationResponse> {
  const command = asCommandName(routeId);
  if (command === "previewCandidate" || command === "publishCandidate") {
    const agentDenied = denyAgent(scope, request.requestId);
    if (agentDenied) {
      return agentDenied;
    }
  }

  if (command === "previewCandidate") {
    const pin = await requirePin(ports, request, { requireHeader: true });
    if (!pin.ok) {
      return pin.response;
    }
    const parsed = catalogCreatePublicationCandidateRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return validationFailed(request.requestId, "changeSet");
    }
    const result = await ports.previewCandidate({
      trustedActor: scope.trustedActor,
      organizationId: scope.organizationId,
      principalId: scope.principalId,
      permissions: scope.permissions,
      actorKind: scope.actorKind,
      catalogReleaseId: pin.pin.id,
      changeSet: parsed.data.changeSet,
      proposalId: parsed.data.proposalId,
      proposalRevisionId: parsed.data.proposalRevisionId,
    });
    if (!result.ok) {
      return mapPublicationFailure(result.error, request.requestId);
    }
    return catalogPublicationOk({
      status: 201,
      body: itemEnvelope(mapPublicationCandidate(result.value)),
      requestId: request.requestId,
      catalogReleaseId: pin.pin.id,
    });
  }

  if (command === "getCandidate") {
    const pin = await requirePin(ports, request, { requireHeader: false });
    if (!pin.ok) {
      return pin.response;
    }
    const candidateId = params.candidateId;
    if (!candidateId) {
      return notFound(request.requestId);
    }
    const result = await ports.getCandidate({
      candidateId,
      organizationId: scope.organizationId,
      actorKind: scope.actorKind,
    });
    if (!result.ok) {
      return mapPublicationFailure(result.error, request.requestId);
    }
    return catalogPublicationOk({
      body: itemEnvelope(mapPublicationCandidate(result.value)),
      requestId: request.requestId,
      catalogReleaseId: pin.pin.id,
    });
  }

  if (command === "publishCandidate") {
    const pin = await requirePin(ports, request, { requireHeader: true });
    if (!pin.ok) {
      return pin.response;
    }
    const parsed = catalogPublishPublicationCandidateRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return validationFailed(request.requestId, "idempotencyKey");
    }
    const candidateId = params.candidateId;
    if (!candidateId) {
      return notFound(request.requestId);
    }
    const result = await ports.publishCandidate({
      trustedActor: scope.trustedActor,
      organizationId: scope.organizationId,
      principalId: scope.principalId,
      permissions: scope.permissions,
      actorKind: scope.actorKind,
      catalogReleaseId: pin.pin.id,
      candidateId,
      idempotencyKey: parsed.data.idempotencyKey,
    });
    if (!result.ok) {
      return mapPublicationFailure(result.error, request.requestId);
    }
    return catalogPublicationOk({
      status: result.replayed ? 200 : 201,
      body: itemEnvelope(mapPublicationJob(result.value)),
      requestId: request.requestId,
      catalogReleaseId: pin.pin.id,
    });
  }

  const pin = await requirePin(ports, request, { requireHeader: false });
  if (!pin.ok) {
    return pin.response;
  }
  const jobId = params.jobId;
  if (!jobId) {
    return notFound(request.requestId);
  }
  const result = await ports.getPublication({
    jobId,
    organizationId: scope.organizationId,
    actorKind: scope.actorKind,
  });
  if (!result.ok) {
    return mapPublicationFailure(result.error, request.requestId);
  }
  return catalogPublicationOk({
    body: itemEnvelope(mapPublicationJob(result.value)),
    requestId: request.requestId,
    catalogReleaseId: pin.pin.id,
  });
}

export async function handleCatalogPublication(
  ports: CatalogPublicationPorts,
  rawRequest: CatalogPublicationRequest,
): Promise<CatalogPublicationResponse> {
  const request = { ...rawRequest, headers: stripSpoofHeaders(rawRequest.headers) };
  const matched = matchCatalogPublicationRoute(request.method, request.path);
  if (!matched) {
    return notFound(request.requestId);
  }
  const auth = await ports.authenticate(request);
  if (!auth.ok) {
    return auth.status === 401 ? unauthenticated(request.requestId) : forbidden(request.requestId);
  }
  if (writeRoutes.has(matched.id) && !catalogReleaseHeader(request.headers)) {
    return validationFailed(request.requestId, "X-WiseEff-Catalog-Release");
  }
  return dispatch(ports, { ...request, params: matched.params }, auth.scope, matched.id, matched.params);
}
