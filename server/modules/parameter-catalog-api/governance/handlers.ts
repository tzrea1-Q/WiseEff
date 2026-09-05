import {
  catalogAcceptProposalRequestSchema,
  catalogCreateProposalRequestSchema,
  catalogRegisterSubjectRequestSchema,
  catalogRejectProposalRequestSchema,
  catalogResolveReviewItemRequestSchema,
  catalogRestoreRegistrationRequestSchema,
  catalogRetireRegistrationRequestSchema,
  catalogSubmitProposalRequestSchema,
  catalogUpdatePlacementRequestSchema,
  catalogWithdrawProposalRequestSchema,
} from "../../contracts/dtoSchemas/parameterCatalog";
import {
  CatalogSubjectId,
  DefinitionProposalId,
  DefinitionRevisionId,
  ParameterDefinitionId,
  ReviewItemEtag,
  ReviewItemId,
  SubjectPlacementId,
  SubjectRegistrationId,
  reviewReasons,
  type CatalogReleasePin,
  type CatalogSubjectKind,
  type PlacementIntent,
  type ReviewReason,
} from "../../parameter-catalog-contract/index";
import type {
  CreateDraftProposalCommand,
  ProposalTrustedContext,
  SubmitExistingProposalCommand,
} from "../../parameter-governance/proposals/command";
import type { RegistrationCommand } from "../../parameter-governance/registration/command";
import type { RegistrationFailure } from "../../parameter-governance/registration/failures";
import type { ReviewQueueFailure, ReviewQueueTrustedContext } from "../../parameter-governance/review/types";
import type { ResolveReviewItemCommand } from "../../parameter-governance/resolveReviewItem/command";
import type { GovernanceFailure } from "../../parameter-governance/resolveReviewItem/failures";
import type { ProposalCommand } from "../../parameter-governance/proposals/command";
import type { ProposalFailure } from "../../parameter-governance/proposals/failures";
import {
  catalogGovernanceCommandByRouteId,
  catalogGovernanceIfMatchRouteIds,
  catalogGovernanceRoutes,
  catalogGovernanceWriteRouteIds,
  type CatalogGovernanceCommandName,
} from "./mapping";
import {
  mapObservation,
  mapPlacement,
  mapProposalRecord,
  mapProposalResult,
  mapRegistrationRecord,
  mapRegistrationResult,
  mapReviewItem,
  mapReviewResolution,
  listEnvelope,
  placementEtag,
  proposalEtag,
  registrationEtag,
  reviewEtag,
} from "./dto";
import {
  CatalogGovernanceQueryError,
  catalogGovernanceOk,
  catalogNotReady,
  conflict,
  forbidden,
  mapGovernanceQueryError,
  notFound,
  releaseDrift,
  revisionConflict,
  selfApprovalForbidden,
  subjectNotPublished,
  unauthenticated,
  validationFailed,
} from "./errors";
import {
  catalogReleaseHeader,
  idempotencyKeyHeader,
  ifMatchHeader,
  parseEtagVersion,
  stripSpoofHeaders,
  unquoteEtag,
} from "./query";
import type {
  CatalogGovernancePorts,
  CatalogGovernanceRequest,
  CatalogGovernanceResponse,
  CatalogGovernanceRouteId,
  RegistrationRecord,
  TrustedGovernanceScope,
} from "./types";

const ifMatchRequired = new Set<string>(catalogGovernanceIfMatchRouteIds);
const writeRoutes = new Set<string>(catalogGovernanceWriteRouteIds);
const reviewReasonSet = new Set<string>(reviewReasons);

const catalogGovernanceRouteTable = catalogGovernanceRoutes
  .map((route) => {
    const segments = route.path.split("/").filter(Boolean);
    return {
      id: route.id as CatalogGovernanceRouteId,
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

export function matchCatalogGovernanceRoute(
  method: string,
  path: string,
): { readonly id: CatalogGovernanceRouteId; readonly params: Record<string, string> } | null {
  const pathSegments = path.split("/").filter(Boolean);
  for (const route of catalogGovernanceRouteTable) {
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

function asCommandName(id: CatalogGovernanceRouteId): CatalogGovernanceCommandName {
  return catalogGovernanceCommandByRouteId[id];
}

function reviewContext(scope: TrustedGovernanceScope): ReviewQueueTrustedContext {
  if (scope.actorKind === "org-admin") {
    return {
      actorKind: "org-admin",
      principalId: scope.principalId,
      organizationId: scope.organizationId,
    };
  }
  if (scope.actorKind === "platform-admin") {
    return { actorKind: "platform-admin", principalId: scope.principalId };
  }
  if (scope.actorKind === "agent") {
    return { actorKind: "agent", principalId: scope.principalId };
  }
  return {
    actorKind: "org-member",
    principalId: scope.principalId,
    organizationId: scope.organizationId,
  };
}

function registrationContext(
  scope: TrustedGovernanceScope,
): Extract<import("../../parameter-governance/registration/command").TrustedInvocationContext, { actorKind: "org-admin" }> | null {
  if (scope.actorKind !== "org-admin") {
    return null;
  }
  return { actorKind: "org-admin", principalId: scope.principalId };
}

function proposalAuthorContext(scope: TrustedGovernanceScope): ProposalTrustedContext | null {
  if (scope.actorKind !== "org-admin") {
    return null;
  }
  return { actorKind: "org-admin", principalId: scope.principalId };
}

function proposalReviewerContext(scope: TrustedGovernanceScope): ProposalTrustedContext | null {
  if (scope.actorKind !== "platform-admin") {
    return null;
  }
  return { actorKind: "platform-admin", principalId: scope.principalId };
}

function queryScope(
  scope: TrustedGovernanceScope,
  request: CatalogGovernanceRequest,
  pin: CatalogReleasePin,
) {
  return {
    organizationId: request.params.organizationId ?? scope.organizationId,
    catalogReleaseId: pin.id,
    principalId: scope.principalId,
  };
}

async function resolveSubjectKind(
  ports: CatalogGovernancePorts,
  scope: TrustedGovernanceScope,
  subjectId: string,
): Promise<CatalogSubjectKind | null> {
  if (ports.resolveSubjectKind) {
    return ports.resolveSubjectKind(subjectId);
  }
  return scope.defaultSubjectKind;
}

async function resolveDestinationModuleId(
  ports: CatalogGovernancePorts,
  scope: TrustedGovernanceScope,
  input: {
    readonly organizationId: string;
    readonly subjectKind: CatalogSubjectKind;
    readonly placement: PlacementIntent;
  },
): Promise<string | null> {
  if (ports.resolveDestinationModuleId) {
    return ports.resolveDestinationModuleId(input);
  }
  return scope.defaultDestinationModuleId || null;
}

function parsePlacement(value: unknown): PlacementIntent | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as { mode?: unknown; parentPlacementId?: unknown; displayName?: unknown };
  if (record.mode === "use-default") {
    return { mode: "use-default" };
  }
  if (
    record.mode === "choose-parent" &&
    typeof record.parentPlacementId === "string" &&
    typeof record.displayName === "string"
  ) {
    try {
      return {
        mode: "choose-parent",
        parentPlacementId: SubjectPlacementId(record.parentPlacementId),
        displayName: record.displayName,
      };
    } catch {
      return null;
    }
  }
  return null;
}

async function requirePin(
  ports: CatalogGovernancePorts,
  request: CatalogGovernanceRequest,
  options: { readonly requireHeader: boolean },
): Promise<
  | { ok: true; pin: CatalogReleasePin; offered: string | undefined }
  | { ok: false; response: CatalogGovernanceResponse }
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
  return { ok: true, pin, offered };
}

function requireWriteHeaders(
  request: CatalogGovernanceRequest,
  routeId: CatalogGovernanceRouteId,
): CatalogGovernanceResponse | null {
  if (!writeRoutes.has(routeId)) {
    return null;
  }
  if (routeId !== "catalog.createRegistration" && routeId !== "catalog.createProposal") {
    if (!catalogReleaseHeader(request.headers)) {
      return validationFailed(request.requestId, "X-WiseEff-Catalog-Release");
    }
  } else if (!catalogReleaseHeader(request.headers)) {
    return validationFailed(request.requestId, "X-WiseEff-Catalog-Release");
  }
  if (!idempotencyKeyHeader(request.headers)) {
    return revisionConflict(request.requestId);
  }
  if (ifMatchRequired.has(routeId) && !ifMatchHeader(request.headers)) {
    return revisionConflict(request.requestId);
  }
  return null;
}

function authorizeRead(
  scope: TrustedGovernanceScope,
  request: CatalogGovernanceRequest,
): CatalogGovernanceResponse | null {
  if (!scope.canReadGovernance) {
    return forbidden(request.requestId);
  }
  const organizationId = request.params.organizationId;
  if (organizationId && organizationId !== scope.organizationId && scope.actorKind !== "platform-admin") {
    return notFound(request.requestId);
  }
  return null;
}

function authorizeOrganizationWrite(
  scope: TrustedGovernanceScope,
  request: CatalogGovernanceRequest,
): CatalogGovernanceResponse | null {
  if (scope.actorKind !== "org-admin" || !scope.canMutateOrganization) {
    return forbidden(request.requestId);
  }
  const organizationId = request.params.organizationId ?? scope.organizationId;
  if (organizationId !== scope.organizationId) {
    return forbidden(request.requestId);
  }
  return null;
}

function authorizeProposalReview(
  scope: TrustedGovernanceScope,
  request: CatalogGovernanceRequest,
): CatalogGovernanceResponse | null {
  if (scope.actorKind !== "platform-admin" || !scope.canReviewProposals) {
    return forbidden(request.requestId);
  }
  return null;
}

function mapRegistrationFailure(
  error: RegistrationFailure,
  requestId: string,
): CatalogGovernanceResponse {
  switch (error.kind) {
    case "release-drift":
    case "catalog-drift":
      return releaseDrift(requestId, error.kind === "release-drift" ? error.expected.id : "current", "current");
    case "subject-not-published":
      return subjectNotPublished(requestId);
    case "subject-retired":
      return conflict(requestId, "subject-retired");
    case "synchronization-busy":
      return catalogNotReady(requestId);
    case "placement-conflict":
      return conflict(requestId, "placement-conflict");
    case "revision-conflict":
      return revisionConflict(requestId);
    case "auto-restore-forbidden":
    case "restore-required":
      return conflict(requestId, "registration-required");
    case "permission-denied":
      return forbidden(requestId);
    case "invalid-command":
      return validationFailed(requestId, error.reason);
    case "registration-not-found":
      return notFound(requestId);
    case "invalid-placement-parent":
      return conflict(requestId, "invalid-placement-parent");
  }
}

function mapReviewFailure(error: ReviewQueueFailure, requestId: string): CatalogGovernanceResponse {
  switch (error.kind) {
    case "permission-denied":
      return forbidden(requestId);
    case "stale-candidate":
      return releaseDrift(
        requestId,
        error.capturedRelease.id,
        error.currentRelease?.id ?? "current",
      );
    case "duplicate-group":
      return revisionConflict(requestId);
    case "review-item-not-found":
      return notFound(requestId);
    case "invalid-query":
      return validationFailed(requestId, error.reason);
  }
}

function mapGovernanceFailure(error: GovernanceFailure, requestId: string): CatalogGovernanceResponse {
  if ("sqlstate" in error || "registrationId" in error || error.kind === "invalid-command") {
    return mapRegistrationFailure(error as RegistrationFailure, requestId);
  }
  if (error.kind === "review-item-not-found") {
    return notFound(requestId);
  }
  if (error.kind === "revision-conflict") {
    return revisionConflict(requestId);
  }
  if (error.kind === "permission-denied") {
    return forbidden(requestId);
  }
  return mapRegistrationFailure(error, requestId);
}

function mapProposalFailure(error: ProposalFailure, requestId: string): CatalogGovernanceResponse {
  switch (error.kind) {
    case "proposal-stale":
      return conflict(requestId, "proposal-stale");
    case "proposal-self-approval-forbidden":
      return selfApprovalForbidden(requestId);
    case "permission-denied":
      return forbidden(requestId);
    case "revision-conflict":
      return revisionConflict(requestId);
    case "invalid-command":
      return validationFailed(requestId, error.reason);
    case "proposal-not-found":
      return notFound(requestId);
    case "invalid-transition":
      return revisionConflict(requestId);
  }
}

function placementFromResult(
  result: { placementId: string; moduleId?: string },
): RegistrationRecord["placement"] {
  return {
    id: result.placementId,
    displayName: result.moduleId ?? result.placementId,
    parentPlacementId: null,
  };
}

function parseReviewReason(value: string): ReviewReason | null {
  return reviewReasonSet.has(value) ? (value as ReviewReason) : null;
}

async function handleCreateRegistration(
  ports: CatalogGovernancePorts,
  scope: TrustedGovernanceScope,
  request: CatalogGovernanceRequest,
): Promise<CatalogGovernanceResponse> {
  const denied = authorizeOrganizationWrite(scope, request);
  if (denied) return denied;
  const parsed = catalogRegisterSubjectRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    return validationFailed(request.requestId, "body");
  }
  const pin = await requirePin(ports, request, { requireHeader: true });
  if (!pin.ok) return pin.response;
  const idempotencyKey = idempotencyKeyHeader(request.headers);
  if (!idempotencyKey) return revisionConflict(request.requestId);
  const placement = parsePlacement(parsed.data.placement);
  if (!placement) return validationFailed(request.requestId, "placement");
  let subjectId: ReturnType<typeof CatalogSubjectId>;
  try {
    subjectId = CatalogSubjectId(parsed.data.subjectId);
  } catch {
    return validationFailed(request.requestId, "subjectId");
  }
  const context = registrationContext(scope);
  if (!context) return forbidden(request.requestId);
  const organizationId = request.params.organizationId ?? scope.organizationId;
  const subjectKind = await resolveSubjectKind(ports, scope, subjectId);
  if (!subjectKind) return validationFailed(request.requestId, "subjectId");
  const destinationModuleId = await resolveDestinationModuleId(ports, scope, {
    organizationId,
    subjectKind,
    placement,
  });
  if (!destinationModuleId) return validationFailed(request.requestId, "destinationModuleId");
  const command: RegistrationCommand = {
    kind: "register",
    organizationId,
    subjectId,
    subjectKind,
    expectedRelease: pin.pin,
    placement,
    destinationModuleId,
    method: "explicit",
    proof: { reason: parsed.data.reason ?? "explicit-registration" },
    idempotencyKey,
    context,
  };
  const result = await ports.executeRegistration(command);
  if (!result.ok) return mapRegistrationFailure(result.error, request.requestId);
  const placementDto = placementFromResult(result.value);
  return catalogGovernanceOk({
    status: 201,
    body: { item: mapRegistrationResult(result.value, placementDto) },
    requestId: request.requestId,
    catalogReleaseId: result.value.release.id,
    etag: registrationEtag(result.value),
  });
}

async function handleRetireOrRestore(
  ports: CatalogGovernancePorts,
  scope: TrustedGovernanceScope,
  request: CatalogGovernanceRequest,
  kind: "retire" | "restore",
): Promise<CatalogGovernanceResponse> {
  const denied = authorizeOrganizationWrite(scope, request);
  if (denied) return denied;
  const schema =
    kind === "retire" ? catalogRetireRegistrationRequestSchema : catalogRestoreRegistrationRequestSchema;
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) return validationFailed(request.requestId, "body");
  const pin = await requirePin(ports, request, { requireHeader: true });
  if (!pin.ok) return pin.response;
  const idempotencyKey = idempotencyKeyHeader(request.headers);
  if (!idempotencyKey) return revisionConflict(request.requestId);
  let registrationId: ReturnType<typeof SubjectRegistrationId>;
  try {
    registrationId = SubjectRegistrationId(request.params.registrationId ?? "");
  } catch {
    return validationFailed(request.requestId, "registrationId");
  }
  const context = registrationContext(scope);
  if (!context) return forbidden(request.requestId);
  const command: RegistrationCommand = {
    kind,
    organizationId: request.params.organizationId ?? scope.organizationId,
    registrationId,
    expectedRelease: pin.pin,
    idempotencyKey,
    context,
    reason: parsed.data.reason,
  };
  const result = await ports.executeRegistration(command);
  if (!result.ok) return mapRegistrationFailure(result.error, request.requestId);
  const placementDto = placementFromResult(result.value);
  return catalogGovernanceOk({
    body: { item: mapRegistrationResult(result.value, placementDto) },
    requestId: request.requestId,
    catalogReleaseId: result.value.release.id,
    etag: registrationEtag(result.value),
  });
}

async function handleUpdatePlacement(
  ports: CatalogGovernancePorts,
  scope: TrustedGovernanceScope,
  request: CatalogGovernanceRequest,
): Promise<CatalogGovernanceResponse> {
  const denied = authorizeOrganizationWrite(scope, request);
  if (denied) return denied;
  const parsed = catalogUpdatePlacementRequestSchema.safeParse(request.body);
  if (!parsed.success) return validationFailed(request.requestId, "body");
  const pin = await requirePin(ports, request, { requireHeader: true });
  if (!pin.ok) return pin.response;
  const idempotencyKey = idempotencyKeyHeader(request.headers);
  if (!idempotencyKey) return revisionConflict(request.requestId);
  let registrationId: ReturnType<typeof SubjectRegistrationId>;
  try {
    registrationId = SubjectRegistrationId(request.params.registrationId ?? "");
  } catch {
    return validationFailed(request.requestId, "registrationId");
  }
  const placement = parsePlacement(parsed.data.placement);
  if (!placement) return validationFailed(request.requestId, "placement");
  const context = registrationContext(scope);
  if (!context) return forbidden(request.requestId);
  const organizationId = request.params.organizationId ?? scope.organizationId;
  const existing = await ports.getRegistration({
    ...queryScope(scope, request, pin.pin),
    registrationId,
  });
  if (!existing) return notFound(request.requestId);
  const subjectKind = await resolveSubjectKind(ports, scope, existing.subjectId);
  if (!subjectKind) return validationFailed(request.requestId, "subjectId");
  const destinationModuleId = await resolveDestinationModuleId(ports, scope, {
    organizationId,
    subjectKind,
    placement,
  });
  if (!destinationModuleId) return validationFailed(request.requestId, "destinationModuleId");
  const command: RegistrationCommand = {
    kind: "move-placement",
    organizationId,
    registrationId,
    expectedRelease: pin.pin,
    destinationModuleId,
    idempotencyKey,
    context,
  };
  const result = await ports.executeRegistration(command);
  if (!result.ok) return mapRegistrationFailure(result.error, request.requestId);
  const placementDto = placementFromResult(result.value);
  return catalogGovernanceOk({
    body: { item: mapPlacement(placementDto) },
    requestId: request.requestId,
    catalogReleaseId: result.value.release.id,
    etag: placementEtag(result.value.placementId),
  });
}

async function handleListRegistrations(
  ports: CatalogGovernancePorts,
  scope: TrustedGovernanceScope,
  request: CatalogGovernanceRequest,
): Promise<CatalogGovernanceResponse> {
  const denied = authorizeRead(scope, request);
  if (denied) return denied;
  const pin = await requirePin(ports, request, { requireHeader: false });
  if (!pin.ok) return pin.response;
  const items = await ports.listRegistrations(queryScope(scope, request, pin.pin));
  return catalogGovernanceOk({
    body: listEnvelope(items.map(mapRegistrationRecord), pin.pin.id, "no-registrations"),
    requestId: request.requestId,
    catalogReleaseId: pin.pin.id,
  });
}

async function handleGetRegistration(
  ports: CatalogGovernancePorts,
  scope: TrustedGovernanceScope,
  request: CatalogGovernanceRequest,
): Promise<CatalogGovernanceResponse> {
  const denied = authorizeRead(scope, request);
  if (denied) return denied;
  const pin = await requirePin(ports, request, { requireHeader: false });
  if (!pin.ok) return pin.response;
  const record = await ports.getRegistration({
    ...queryScope(scope, request, pin.pin),
    registrationId: request.params.registrationId ?? "",
  });
  if (!record) return notFound(request.requestId);
  return catalogGovernanceOk({
    body: { item: mapRegistrationRecord(record) },
    requestId: request.requestId,
    catalogReleaseId: pin.pin.id,
    etag: registrationEtag(record),
  });
}

async function handleGetPlacement(
  ports: CatalogGovernancePorts,
  scope: TrustedGovernanceScope,
  request: CatalogGovernanceRequest,
): Promise<CatalogGovernanceResponse> {
  const denied = authorizeRead(scope, request);
  if (denied) return denied;
  const pin = await requirePin(ports, request, { requireHeader: false });
  if (!pin.ok) return pin.response;
  const placement = await ports.getPlacement({
    ...queryScope(scope, request, pin.pin),
    registrationId: request.params.registrationId ?? "",
  });
  if (!placement) return notFound(request.requestId);
  return catalogGovernanceOk({
    body: { item: mapPlacement(placement) },
    requestId: request.requestId,
    catalogReleaseId: pin.pin.id,
    etag: placementEtag(placement.id),
  });
}

async function handleListObservations(
  ports: CatalogGovernancePorts,
  scope: TrustedGovernanceScope,
  request: CatalogGovernanceRequest,
): Promise<CatalogGovernanceResponse> {
  const denied = authorizeRead(scope, request);
  if (denied) return denied;
  const pin = await requirePin(ports, request, { requireHeader: false });
  if (!pin.ok) return pin.response;
  const items = await ports.listObservations(queryScope(scope, request, pin.pin));
  return catalogGovernanceOk({
    body: listEnvelope(items.map(mapObservation), pin.pin.id, "no-filter-match"),
    requestId: request.requestId,
    catalogReleaseId: pin.pin.id,
  });
}

async function handleGetObservation(
  ports: CatalogGovernancePorts,
  scope: TrustedGovernanceScope,
  request: CatalogGovernanceRequest,
): Promise<CatalogGovernanceResponse> {
  const denied = authorizeRead(scope, request);
  if (denied) return denied;
  const pin = await requirePin(ports, request, { requireHeader: false });
  if (!pin.ok) return pin.response;
  const record = await ports.getObservation({
    ...queryScope(scope, request, pin.pin),
    observationId: request.params.observationId ?? "",
  });
  if (!record) return notFound(request.requestId);
  return catalogGovernanceOk({
    body: { item: mapObservation(record) },
    requestId: request.requestId,
    catalogReleaseId: pin.pin.id,
  });
}

async function handleListReviewItems(
  ports: CatalogGovernancePorts,
  scope: TrustedGovernanceScope,
  request: CatalogGovernanceRequest,
): Promise<CatalogGovernanceResponse> {
  const denied = authorizeRead(scope, request);
  if (denied) return denied;
  const pin = await requirePin(ports, request, { requireHeader: false });
  if (!pin.ok) return pin.response;
  const result = await ports.listReviewQueue({
    organizationId: request.params.organizationId ?? scope.organizationId,
    capturedRelease: pin.pin,
    context: reviewContext(scope),
  });
  if (!result.ok) return mapReviewFailure(result.error, request.requestId);
  return catalogGovernanceOk({
    body: listEnvelope(
      result.value.items.map(mapReviewItem),
      result.value.catalogRelease.id,
      result.value.emptyReason,
    ),
    requestId: request.requestId,
    catalogReleaseId: result.value.catalogRelease.id,
  });
}

async function handleGetReviewItem(
  ports: CatalogGovernancePorts,
  scope: TrustedGovernanceScope,
  request: CatalogGovernanceRequest,
): Promise<CatalogGovernanceResponse> {
  const denied = authorizeRead(scope, request);
  if (denied) return denied;
  const pin = await requirePin(ports, request, { requireHeader: false });
  if (!pin.ok) return pin.response;
  let reviewItemId: ReturnType<typeof ReviewItemId>;
  try {
    reviewItemId = ReviewItemId(request.params.reviewItemId ?? "");
  } catch {
    return validationFailed(request.requestId, "reviewItemId");
  }
  const result = await ports.getReviewItem({
    organizationId: request.params.organizationId ?? scope.organizationId,
    capturedRelease: pin.pin,
    context: reviewContext(scope),
    reviewItemId,
  });
  if (!result.ok) return mapReviewFailure(result.error, request.requestId);
  return catalogGovernanceOk({
    body: { item: mapReviewItem(result.value) },
    requestId: request.requestId,
    catalogReleaseId: result.value.catalogReleaseId,
    etag: reviewEtag(result.value.etag),
  });
}

async function handleResolveReviewItem(
  ports: CatalogGovernancePorts,
  scope: TrustedGovernanceScope,
  request: CatalogGovernanceRequest,
): Promise<CatalogGovernanceResponse> {
  const denied = authorizeOrganizationWrite(scope, request);
  if (denied) return denied;
  const parsed = catalogResolveReviewItemRequestSchema.safeParse(request.body);
  if (!parsed.success) return validationFailed(request.requestId, "body");
  const pin = await requirePin(ports, request, { requireHeader: true });
  if (!pin.ok) return pin.response;
  const idempotencyKey = idempotencyKeyHeader(request.headers);
  const etagHeader = ifMatchHeader(request.headers);
  if (!idempotencyKey || !etagHeader) return revisionConflict(request.requestId);
  let reviewItemId: ReturnType<typeof ReviewItemId>;
  let etag: ReturnType<typeof ReviewItemEtag>;
  try {
    reviewItemId = ReviewItemId(request.params.reviewItemId ?? "");
    etag = ReviewItemEtag(unquoteEtag(etagHeader));
  } catch {
    return validationFailed(request.requestId, "reviewItemId");
  }
  const organizationId = request.params.organizationId ?? scope.organizationId;
  const reason = parseReviewReason(parsed.data.reason) ?? "unknown";
  const resolution = parsed.data.resolution;
  const writeContext = registrationContext(scope);
  if (!writeContext) return forbidden(request.requestId);
  const base = {
    organizationId,
    reviewItemId,
    expectedRelease: pin.pin,
    etag,
    idempotencyKey,
    context: {
      actorKind: "org-admin" as const,
      principalId: writeContext.principalId,
      organizationId,
    },
    reason,
  };
  let command: ResolveReviewItemCommand;
  if (resolution.type === "register-subject") {
    const placement = parsePlacement(resolution.placement);
    if (!placement) return validationFailed(request.requestId, "placement");
    let subjectId: ReturnType<typeof CatalogSubjectId>;
    try {
      subjectId = CatalogSubjectId(resolution.subjectId);
    } catch {
      return validationFailed(request.requestId, "subjectId");
    }
    const subjectKind = await resolveSubjectKind(ports, scope, subjectId);
    if (!subjectKind) return validationFailed(request.requestId, "subjectId");
    const destinationModuleId = await resolveDestinationModuleId(ports, scope, {
      organizationId,
      subjectKind,
      placement,
    });
    if (!destinationModuleId) return validationFailed(request.requestId, "destinationModuleId");
    command = {
      ...base,
      resolution: "register-subject",
      subjectId,
      subjectKind,
      placement,
      destinationModuleId,
    };
  } else if (resolution.type === "restore-registration") {
    let registrationId: ReturnType<typeof SubjectRegistrationId>;
    try {
      registrationId = SubjectRegistrationId(resolution.registrationId);
    } catch {
      return validationFailed(request.requestId, "registrationId");
    }
    command = {
      ...base,
      resolution: "restore-registration",
      registrationId,
    };
  } else if (resolution.type === "mark-out-of-scope") {
    command = {
      ...base,
      resolution: "mark-out-of-scope",
      outOfScopeReason: parsed.data.reason,
    };
  } else {
    command = {
      ...base,
      resolution: "open-definition-proposal",
      proposal: { reason: parsed.data.reason },
    };
  }
  const result = await ports.resolveReviewItem(command);
  if (!result.ok) return mapGovernanceFailure(result.error, request.requestId);
  const placementDto =
    result.value.placementId && result.value.registrationId
      ? placementFromResult({
          placementId: result.value.placementId,
        })
      : undefined;
  return catalogGovernanceOk({
    body: { item: mapReviewResolution(result.value, placementDto) },
    requestId: request.requestId,
    catalogReleaseId: result.value.release.id,
    etag: reviewEtag(result.value.etag),
  });
}

async function handleListProposals(
  ports: CatalogGovernancePorts,
  scope: TrustedGovernanceScope,
  request: CatalogGovernanceRequest,
): Promise<CatalogGovernanceResponse> {
  const denied = authorizeRead(scope, request);
  if (denied) return denied;
  const pin = await requirePin(ports, request, { requireHeader: false });
  if (!pin.ok) return pin.response;
  const items = await ports.listProposals(queryScope(scope, request, pin.pin));
  return catalogGovernanceOk({
    body: listEnvelope(items.map(mapProposalRecord), pin.pin.id, "no-filter-match"),
    requestId: request.requestId,
    catalogReleaseId: pin.pin.id,
  });
}

async function handleGetProposal(
  ports: CatalogGovernancePorts,
  scope: TrustedGovernanceScope,
  request: CatalogGovernanceRequest,
): Promise<CatalogGovernanceResponse> {
  const denied = authorizeRead(scope, request);
  if (denied) return denied;
  const pin = await requirePin(ports, request, { requireHeader: false });
  if (!pin.ok) return pin.response;
  const record = await ports.getProposal({
    ...queryScope(scope, request, pin.pin),
    proposalId: request.params.proposalId ?? "",
  });
  if (!record) return notFound(request.requestId);
  return catalogGovernanceOk({
    body: { item: mapProposalRecord(record) },
    requestId: request.requestId,
    catalogReleaseId: pin.pin.id,
    etag: record.etag.startsWith('"') ? record.etag : proposalEtag(record.id, record.version),
  });
}

async function handleCreateProposal(
  ports: CatalogGovernancePorts,
  scope: TrustedGovernanceScope,
  request: CatalogGovernanceRequest,
): Promise<CatalogGovernanceResponse> {
  const denied = authorizeOrganizationWrite(scope, request);
  if (denied) return denied;
  const parsed = catalogCreateProposalRequestSchema.safeParse(request.body);
  if (!parsed.success) return validationFailed(request.requestId, "body");
  const pin = await requirePin(ports, request, { requireHeader: true });
  if (!pin.ok) return pin.response;
  const idempotencyKey = idempotencyKeyHeader(request.headers);
  if (!idempotencyKey) return revisionConflict(request.requestId);
  const context = proposalAuthorContext(scope);
  if (!context) return forbidden(request.requestId);
  const definitionIdRaw = parsed.data.base.definitionId;
  const revisionIdRaw = parsed.data.base.definitionRevisionId;
  if (Boolean(definitionIdRaw) !== Boolean(revisionIdRaw)) {
    return validationFailed(
      request.requestId,
      definitionIdRaw ? "base.definitionRevisionId" : "base.definitionId",
    );
  }
  let baseDefinitionId: ReturnType<typeof ParameterDefinitionId> | undefined;
  let baseDefinitionRevisionId: ReturnType<typeof DefinitionRevisionId> | undefined;
  if (definitionIdRaw && revisionIdRaw) {
    try {
      baseDefinitionId = ParameterDefinitionId(definitionIdRaw);
      baseDefinitionRevisionId = DefinitionRevisionId(revisionIdRaw);
    } catch {
      return validationFailed(request.requestId, "base.definitionId");
    }
  }
  const command: CreateDraftProposalCommand = {
    kind: "create-draft",
    organizationId: scope.organizationId,
    baseRelease: pin.pin,
    currentRelease: pin.pin,
    claimedBaseReleaseId: parsed.data.base.catalogReleaseId,
    ...(baseDefinitionId ? { baseDefinitionId } : {}),
    ...(baseDefinitionRevisionId ? { baseDefinitionRevisionId } : {}),
    payload: parsed.data.requestedChange as import("../../parameter-governance/proposals/command").ProposalPayload,
    reason: parsed.data.reason,
    evidenceRefs: parsed.data.evidenceRefs ?? [],
    idempotencyKey,
    context,
  };
  const result = await ports.executeProposal(command);
  if (!result.ok) return mapProposalFailure(result.error, request.requestId);
  return catalogGovernanceOk({
    status: 201,
    body: { item: mapProposalResult(result.value, scope.principalId) },
    requestId: request.requestId,
    catalogReleaseId: result.value.baseCatalogReleaseId,
    etag: proposalEtag(result.value.proposalId, result.value.etagVersion),
  });
}

async function handleSubmitProposal(
  ports: CatalogGovernancePorts,
  scope: TrustedGovernanceScope,
  request: CatalogGovernanceRequest,
): Promise<CatalogGovernanceResponse> {
  const denied = authorizeOrganizationWrite(scope, request);
  if (denied) return denied;
  const parsed = catalogSubmitProposalRequestSchema.safeParse(request.body ?? {});
  if (!parsed.success) return validationFailed(request.requestId, "body");
  const pin = await requirePin(ports, request, { requireHeader: true });
  if (!pin.ok) return pin.response;
  const idempotencyKey = idempotencyKeyHeader(request.headers);
  const etagHeader = ifMatchHeader(request.headers);
  if (!idempotencyKey || !etagHeader) return revisionConflict(request.requestId);
  const expectedEtag = parseEtagVersion(etagHeader);
  if (!expectedEtag) return revisionConflict(request.requestId);
  const context = proposalAuthorContext(scope);
  if (!context) return forbidden(request.requestId);
  let proposalId: ReturnType<typeof DefinitionProposalId>;
  try {
    proposalId = DefinitionProposalId(request.params.proposalId ?? "");
  } catch {
    return validationFailed(request.requestId, "proposalId");
  }
  const command: SubmitExistingProposalCommand = {
    kind: "submit-existing",
    organizationId: scope.organizationId,
    proposalId,
    expectedEtag,
    currentRelease: pin.pin,
    idempotencyKey,
    context,
  };
  const result = await ports.executeProposal(command);
  if (!result.ok) return mapProposalFailure(result.error, request.requestId);
  return catalogGovernanceOk({
    body: { item: mapProposalResult(result.value, scope.principalId) },
    requestId: request.requestId,
    catalogReleaseId: result.value.baseCatalogReleaseId,
    etag: proposalEtag(result.value.proposalId, result.value.etagVersion),
  });
}

async function handleWithdrawProposal(
  ports: CatalogGovernancePorts,
  scope: TrustedGovernanceScope,
  request: CatalogGovernanceRequest,
): Promise<CatalogGovernanceResponse> {
  const denied = authorizeOrganizationWrite(scope, request);
  if (denied) return denied;
  const parsed = catalogWithdrawProposalRequestSchema.safeParse(request.body ?? {});
  if (!parsed.success) return validationFailed(request.requestId, "body");
  const pin = await requirePin(ports, request, { requireHeader: true });
  if (!pin.ok) return pin.response;
  const idempotencyKey = idempotencyKeyHeader(request.headers);
  const etagHeader = ifMatchHeader(request.headers);
  if (!idempotencyKey || !etagHeader) return revisionConflict(request.requestId);
  const expectedEtag = parseEtagVersion(etagHeader);
  if (!expectedEtag) return revisionConflict(request.requestId);
  let proposalId: ReturnType<typeof DefinitionProposalId>;
  try {
    proposalId = DefinitionProposalId(request.params.proposalId ?? "");
  } catch {
    return validationFailed(request.requestId, "proposalId");
  }
  const context = proposalAuthorContext(scope);
  if (!context) return forbidden(request.requestId);
  const command: ProposalCommand = {
    kind: "withdraw",
    organizationId: scope.organizationId,
    proposalId,
    expectedEtag,
    idempotencyKey,
    context,
  };
  const result = await ports.executeProposal(command);
  if (!result.ok) return mapProposalFailure(result.error, request.requestId);
  return catalogGovernanceOk({
    body: { item: mapProposalResult(result.value, scope.principalId) },
    requestId: request.requestId,
    catalogReleaseId: pin.pin.id,
    etag: proposalEtag(result.value.proposalId, result.value.etagVersion),
  });
}

async function handleAcceptOrRejectProposal(
  ports: CatalogGovernancePorts,
  scope: TrustedGovernanceScope,
  request: CatalogGovernanceRequest,
  kind: "accept" | "reject",
): Promise<CatalogGovernanceResponse> {
  const denied = authorizeProposalReview(scope, request);
  if (denied) return denied;
  const schema = kind === "accept" ? catalogAcceptProposalRequestSchema : catalogRejectProposalRequestSchema;
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) return validationFailed(request.requestId, "body");
  const pin = await requirePin(ports, request, { requireHeader: true });
  if (!pin.ok) return pin.response;
  const idempotencyKey = idempotencyKeyHeader(request.headers);
  const etagHeader = ifMatchHeader(request.headers);
  if (!idempotencyKey || !etagHeader) return revisionConflict(request.requestId);
  const expectedEtag = parseEtagVersion(etagHeader);
  if (!expectedEtag) return revisionConflict(request.requestId);
  let proposalId: ReturnType<typeof DefinitionProposalId>;
  try {
    proposalId = DefinitionProposalId(request.params.proposalId ?? "");
  } catch {
    return validationFailed(request.requestId, "proposalId");
  }
  const context = proposalReviewerContext(scope);
  if (!context) return forbidden(request.requestId);
  const command: ProposalCommand =
    kind === "accept"
      ? {
          kind: "accept",
          organizationId: scope.organizationId,
          proposalId,
          expectedEtag,
          currentRelease: pin.pin,
          repositoryReference: (parsed.data as { repositoryReference: string }).repositoryReference,
          idempotencyKey,
          context,
        }
      : {
          kind: "reject",
          organizationId: scope.organizationId,
          proposalId,
          expectedEtag,
          currentRelease: pin.pin,
          reason: (parsed.data as { reason: string }).reason,
          idempotencyKey,
          context,
        };
  const result = await ports.executeProposal(command);
  if (!result.ok) return mapProposalFailure(result.error, request.requestId);
  return catalogGovernanceOk({
    body: { item: mapProposalResult(result.value, null) },
    requestId: request.requestId,
    catalogReleaseId: pin.pin.id,
    etag: proposalEtag(result.value.proposalId, result.value.etagVersion),
  });
}

export async function handleCatalogGovernance(
  ports: CatalogGovernancePorts,
  rawRequest: CatalogGovernanceRequest,
): Promise<CatalogGovernanceResponse> {
  const request: CatalogGovernanceRequest = {
    ...rawRequest,
    headers: stripSpoofHeaders(rawRequest.headers),
  };
  const matched = matchCatalogGovernanceRoute(request.method, request.path);
  if (!matched) {
    return notFound(request.requestId);
  }
  const headerError = requireWriteHeaders(request, matched.id);
  if (headerError) {
    return headerError;
  }
  const auth = await ports.authenticate(request);
  if (!auth.ok) {
    return auth.status === 401 ? unauthenticated(request.requestId) : forbidden(request.requestId);
  }
  const scopedRequest = { ...request, params: { ...request.params, ...matched.params } };
  void asCommandName(matched.id);
  try {
  switch (matched.id) {
    case "catalog.listRegistrations":
      return handleListRegistrations(ports, auth.scope, scopedRequest);
    case "catalog.createRegistration":
      return handleCreateRegistration(ports, auth.scope, scopedRequest);
    case "catalog.getRegistration":
      return handleGetRegistration(ports, auth.scope, scopedRequest);
    case "catalog.retireRegistration":
      return handleRetireOrRestore(ports, auth.scope, scopedRequest, "retire");
    case "catalog.restoreRegistration":
      return handleRetireOrRestore(ports, auth.scope, scopedRequest, "restore");
    case "catalog.getPlacement":
      return handleGetPlacement(ports, auth.scope, scopedRequest);
    case "catalog.updatePlacement":
      return handleUpdatePlacement(ports, auth.scope, scopedRequest);
    case "catalog.listObservations":
      return handleListObservations(ports, auth.scope, scopedRequest);
    case "catalog.getObservation":
      return handleGetObservation(ports, auth.scope, scopedRequest);
    case "catalog.listReviewItems":
      return handleListReviewItems(ports, auth.scope, scopedRequest);
    case "catalog.getReviewItem":
      return handleGetReviewItem(ports, auth.scope, scopedRequest);
    case "catalog.resolveReviewItem":
      return handleResolveReviewItem(ports, auth.scope, scopedRequest);
    case "catalog.listProposals":
      return handleListProposals(ports, auth.scope, scopedRequest);
    case "catalog.createProposal":
      return handleCreateProposal(ports, auth.scope, scopedRequest);
    case "catalog.getProposal":
      return handleGetProposal(ports, auth.scope, scopedRequest);
    case "catalog.submitProposal":
      return handleSubmitProposal(ports, auth.scope, scopedRequest);
    case "catalog.withdrawProposal":
      return handleWithdrawProposal(ports, auth.scope, scopedRequest);
    case "catalog.acceptProposal":
      return handleAcceptOrRejectProposal(ports, auth.scope, scopedRequest, "accept");
    case "catalog.rejectProposal":
      return handleAcceptOrRejectProposal(ports, auth.scope, scopedRequest, "reject");
  }
  return notFound(request.requestId);
  } catch (error) {
    if (error instanceof CatalogGovernanceQueryError) {
      return mapGovernanceQueryError(error, request.requestId);
    }
    throw error;
  }
}

export { catalogGovernanceCommandByRouteId, catalogGovernanceRouteIds } from "./mapping";
