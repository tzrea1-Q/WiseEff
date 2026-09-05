import type {
  CatalogSnapshot,
  CurrentCatalogSnapshot,
} from "../../catalog-kernel/interface";
import {
  CATALOG_RELEASE_HEADER,
  parameterCatalogCanonicalRoutes,
  parameterCatalogKernelReadByRouteId,
} from "../../contracts/dtoSchemas/parameterCatalog";
import {
  CatalogPageLimit,
  CatalogSubjectId,
  DefinitionRevisionId,
  ParameterDefinitionId,
  type CatalogCursor,
  type OptionalValue,
} from "../../parameter-catalog-contract/index";
import {
  emptyReasonFor,
  mapCatalogDefinition,
  mapCatalogDocument,
  mapCatalogSubject,
  mapDefinitionRevision,
  nextCursorValue,
} from "./dto";
import {
  CatalogProjectionError,
  catalogNotReady,
  catalogReadOk,
  forbidden,
  mapInvalidPage,
  mapKernelLoadError,
  mapProjectionError,
  notFound,
  releaseDrift,
  unauthenticated,
  validationFailed,
} from "./errors";
import {
  absent,
  asDefinitionId,
  asSubjectId,
  catalogPageLimit,
  defaultDefinitionLifecycles,
  defaultSubjectLifecycles,
  headerValue,
  mergeIdSelection,
  parseCatalogListQuery,
  queryValue,
  requestCarriesLegacySpecIdentity,
  searchValue,
  stripSpoofHeaders,
  subjectKinds,
} from "./query";
import type {
  CatalogDocumentFacts,
  CatalogReadPorts,
  CatalogReadRequest,
  CatalogReadResponse,
  CatalogReadRouteId,
  LoadedCatalogSnapshot,
  TrustedCatalogScope,
} from "./types";

const READ_ROUTE_IDS = new Set<string>(Object.keys(parameterCatalogKernelReadByRouteId));

const catalogReadRoutes = parameterCatalogCanonicalRoutes
  .filter((route) => route.method === "GET" && READ_ROUTE_IDS.has(route.id))
  .map((route) => {
    const segments = route.path.split("/").filter(Boolean);
    return {
      id: route.id as CatalogReadRouteId,
      path: route.path,
      segments,
      staticCount: segments.filter((segment) => !segment.startsWith(":")).length,
    };
  })
  .sort(
    (left, right) =>
      right.segments.length - left.segments.length || right.staticCount - left.staticCount,
  );

export function matchCatalogReadRoute(
  path: string,
): { readonly id: CatalogReadRouteId; readonly params: Record<string, string> } | null {
  const pathSegments = path.split("/").filter(Boolean);
  for (const route of catalogReadRoutes) {
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

function hiddenId(selection: { kind: "all" } | { kind: "only"; ids: readonly string[] }, id: string): boolean {
  return selection.kind === "only" && !selection.ids.includes(id);
}

function listEnvelope(
  items: readonly unknown[],
  next: OptionalValue<CatalogCursor>,
  catalogReleaseId: string,
  emptyReason: ReturnType<typeof emptyReasonFor>,
): unknown {
  return {
    items: [...items],
    nextCursor: nextCursorValue(next),
    catalogReleaseId,
    ...(emptyReason ? { emptyReason } : {}),
  };
}

function catalogSubjectUniverse(snapshot: CatalogSnapshot): CatalogSubjectId[] {
  const result = snapshot.listSubjects({
    selection: { kind: "all" },
    kinds: [],
    lifecycles: ["active", "retired"],
    search: absent,
    page: { limit: CatalogPageLimit(Number.MAX_SAFE_INTEGER), after: absent },
  });
  if (result.status !== "found") {
    return [];
  }
  return result.page.items.map((item) => item.id);
}

function catalogDefinitionIndex(
  snapshot: CatalogSnapshot,
): Array<{ id: ParameterDefinitionId; subjectId: CatalogSubjectId }> {
  const result = snapshot.listDefinitions({
    selection: { kind: "all" },
    scope: { kind: "all" },
    lifecycles: ["active", "deprecated", "retired"],
    propertyKey: absent,
    search: absent,
    page: { limit: CatalogPageLimit(Number.MAX_SAFE_INTEGER), after: absent },
  });
  if (result.status !== "found" && result.status !== "retired") {
    return [];
  }
  return result.page.items.map((item) => ({ id: item.id, subjectId: item.subjectId }));
}

function observedPin(snapshot: CatalogSnapshot) {
  return { id: snapshot.release.id, digest: snapshot.release.digest };
}

async function resolveDocumentFacts(
  ports: CatalogReadPorts,
  request: CatalogReadRequest,
  documentRoute: boolean,
): Promise<{ ok: true; facts: CatalogDocumentFacts } | { ok: false; response: CatalogReadResponse }> {
  const queryRelease = queryValue(request.query, "catalogReleaseId");
  const headerRelease = headerValue(request.headers, CATALOG_RELEASE_HEADER);
  const expectedDigest = queryValue(request.query, "catalogReleaseDigest");
  if (queryRelease && headerRelease && queryRelease !== headerRelease && !documentRoute) {
    return { ok: false, response: releaseDrift(request.requestId, headerRelease, queryRelease) };
  }
  const named = queryRelease;
  const readiness = named
    ? await ports.readiness.named(named, expectedDigest)
    : await ports.readiness.current();
  if (readiness.status === "not-ready") {
    return { ok: false, response: catalogNotReady(request.requestId, readiness.retryAfterSeconds) };
  }
  if (readiness.status === "unknown") {
    return { ok: false, response: notFound(request.requestId, "subject-not-published") };
  }
  if (expectedDigest && expectedDigest !== readiness.document.pin.digest) {
    return {
      ok: false,
      response: releaseDrift(request.requestId, queryRelease ?? readiness.document.pin.id, readiness.document.pin.id),
    };
  }
  if (!documentRoute && headerRelease && headerRelease !== readiness.document.pin.id) {
    return {
      ok: false,
      response: releaseDrift(request.requestId, headerRelease, readiness.document.pin.id),
    };
  }
  return { ok: true, facts: readiness.document };
}

async function loadSnapshot(
  ports: CatalogReadPorts,
  facts: CatalogDocumentFacts,
  requestId: string,
  documentRoute: boolean,
): Promise<{ ok: true; snapshot: LoadedCatalogSnapshot } | { ok: false; response: CatalogReadResponse }> {
  const loaded =
    facts.snapshotKind === "pinned"
      ? await ports.runtime.loadPinnedCatalog(facts.pin)
      : await ports.runtime.loadCurrentCatalog(facts.pin);
  if (!loaded.ok) {
    return { ok: false, response: mapKernelLoadError(loaded.error, requestId, documentRoute) };
  }
  const snapshot = loaded.value;
  if (snapshot.release.id !== facts.pin.id || snapshot.release.digest !== facts.pin.digest) {
    return {
      ok: false,
      response: documentRoute
        ? catalogNotReady(requestId)
        : releaseDrift(requestId, facts.pin.id, snapshot.release.id),
    };
  }
  if (
    documentRoute &&
    snapshot.snapshotKind === "current" &&
    snapshot.materializationFingerprint !== facts.materializationFingerprint
  ) {
    return { ok: false, response: catalogNotReady(requestId) };
  }
  return { ok: true, snapshot };
}

async function handleGetCatalog(
  snapshot: LoadedCatalogSnapshot,
  facts: CatalogDocumentFacts,
  requestId: string,
): Promise<CatalogReadResponse> {
  const current = snapshot as CurrentCatalogSnapshot;
  if (snapshot.snapshotKind === "current" && !current.materializationFingerprint) {
    return catalogNotReady(requestId);
  }
  return catalogReadOk({ item: mapCatalogDocument(snapshot, facts) }, snapshot.release.id, requestId);
}

async function handleListSubjects(
  snapshot: CatalogSnapshot,
  ports: CatalogReadPorts,
  scope: TrustedCatalogScope,
  request: CatalogReadRequest,
): Promise<CatalogReadResponse> {
  const parsed = parseCatalogListQuery(request);
  if (!parsed.ok) {
    return parsed.response;
  }
  let lifecycles;
  try {
    lifecycles = defaultSubjectLifecycles(parsed.query.lifecycle);
  } catch {
    return validationFailed(request.requestId, "lifecycle");
  }
  const registrationSelection = await ports.registration.selectSubjectIds({
    organizationId: scope.organizationId,
    principalId: scope.principalId,
    registration: parsed.query.registration,
    catalogSubjectIds: parsed.query.registration
      ? catalogSubjectUniverse(snapshot)
      : undefined,
  });
  const selection = mergeIdSelection(scope.subjects, registrationSelection);
  const result = snapshot.listSubjects({
    selection,
    kinds: subjectKinds(parsed.query.type),
    lifecycles,
    search: searchValue(parsed.query.search),
    page: { limit: catalogPageLimit(parsed.query.limit), after: parsed.query.cursor },
  });
  if (result.status === "invalid-page") {
    return mapInvalidPage(result.reason, request.requestId, snapshot.release.id);
  }
  const items = [];
  for (const subject of result.page.items) {
    const projection = await ports.registration.projectSubject({
      organizationId: scope.organizationId,
      principalId: scope.principalId,
      subjectId: subject.id,
      canRegister: scope.canRegister,
      observedRelease: observedPin(snapshot),
    });
    items.push(
      mapCatalogSubject(subject, projection.registration, {
        reviewCount: projection.reviewCount,
        availableActions:
          projection.registration.status === "unregistered" && scope.canRegister ? ["register"] : [],
      }),
    );
  }
  const extraFiltered = Boolean(
    parsed.query.type || parsed.query.lifecycle || parsed.query.search || parsed.query.cursor.kind === "present",
  );
  const filtered = extraFiltered || Boolean(parsed.query.registration);
  const noRegistrations =
    Boolean(parsed.query.registration) && items.length === 0 && !extraFiltered;
  return catalogReadOk(
    listEnvelope(
      items,
      result.page.next,
      snapshot.release.id,
      emptyReasonFor(items.length, "subjects", filtered, { noRegistrations }),
    ),
    snapshot.release.id,
    request.requestId,
  );
}

async function handleGetSubject(
  snapshot: CatalogSnapshot,
  ports: CatalogReadPorts,
  scope: TrustedCatalogScope,
  request: CatalogReadRequest,
): Promise<CatalogReadResponse> {
  const parsedId = asSubjectId(request.params.subjectId ?? "", request.requestId);
  if (!parsedId.ok) {
    return parsedId.response;
  }
  if (hiddenId(scope.subjects, parsedId.value)) {
    return notFound(request.requestId, "subject-not-published");
  }
  const result = snapshot.getSubject(parsedId.value);
  if (result.status === "unknown" || result.status === "not-published") {
    return notFound(request.requestId, "subject-not-published");
  }
  const subject = result.subject;
  const projection = await ports.registration.projectSubject({
    organizationId: scope.organizationId,
    principalId: scope.principalId,
    subjectId: subject.id,
    canRegister: scope.canRegister,
    observedRelease: observedPin(snapshot),
  });
  return catalogReadOk(
    {
      item: mapCatalogSubject(subject, projection.registration, {
        reviewCount: projection.reviewCount,
        availableActions:
          projection.registration.status === "unregistered" && scope.canRegister ? ["register"] : [],
      }),
    },
    snapshot.release.id,
    request.requestId,
  );
}

async function handleListDefinitions(
  snapshot: CatalogSnapshot,
  ports: CatalogReadPorts,
  scope: TrustedCatalogScope,
  request: CatalogReadRequest,
  scopedSubjectId?: string,
): Promise<CatalogReadResponse> {
  const parsed = parseCatalogListQuery(request);
  if (!parsed.ok) {
    return parsed.response;
  }
  let lifecycles;
  try {
    lifecycles = defaultDefinitionLifecycles(parsed.query.lifecycle);
  } catch {
    return validationFailed(request.requestId, "lifecycle");
  }
  let definitionScope: { kind: "all" } | { kind: "subject"; subjectId: CatalogSubjectId } = {
    kind: "all",
  };
  if (scopedSubjectId) {
    const parsedSubject = asSubjectId(scopedSubjectId, request.requestId);
    if (!parsedSubject.ok) {
      return parsedSubject.response;
    }
    if (hiddenId(scope.subjects, parsedSubject.value)) {
      return notFound(request.requestId, "subject-not-published");
    }
    definitionScope = { kind: "subject", subjectId: parsedSubject.value };
  } else if (parsed.query.subjectId) {
    if (hiddenId(scope.subjects, parsed.query.subjectId)) {
      return notFound(request.requestId, "subject-not-published");
    }
    definitionScope = { kind: "subject", subjectId: parsed.query.subjectId };
  }

  const registrationSelection = await ports.registration.selectDefinitionIds({
    organizationId: scope.organizationId,
    principalId: scope.principalId,
    registration: parsed.query.registration,
    catalogDefinitions: parsed.query.registration ? catalogDefinitionIndex(snapshot) : undefined,
  });
  const selection = mergeIdSelection(scope.definitions, registrationSelection);
  const result = snapshot.listDefinitions({
    selection,
    scope: definitionScope,
    lifecycles,
    propertyKey: parsed.query.propertyKey ? { kind: "present", value: parsed.query.propertyKey } : absent,
    search: searchValue(parsed.query.search),
    page: { limit: catalogPageLimit(parsed.query.limit), after: parsed.query.cursor },
  });
  if (result.status === "invalid-page") {
    return mapInvalidPage(result.reason, request.requestId, snapshot.release.id);
  }
  if (result.status === "unknown" || result.status === "not-published") {
    return notFound(request.requestId, "subject-not-published");
  }
  const page = result.status === "found" || result.status === "retired" ? result.page : null;
  if (!page) {
    return notFound(request.requestId, "definition-not-found");
  }
  const items = [];
  for (const definition of page.items) {
    const registration = await ports.registration.projectDefinition({
      organizationId: scope.organizationId,
      principalId: scope.principalId,
      subjectId: definition.subjectId,
      observedRelease: observedPin(snapshot),
    });
    const usage = await ports.usage.summarize({
      organizationId: scope.organizationId,
      principalId: scope.principalId,
      definitionId: definition.id,
    });
    const mapped = mapCatalogDefinition(snapshot, definition, registration, usage);
    if (!mapped) {
      return catalogNotReady(request.requestId);
    }
    items.push(mapped);
  }
  const filtered = Boolean(
    parsed.query.lifecycle ||
      parsed.query.registration ||
      parsed.query.search ||
      parsed.query.propertyKey ||
      parsed.query.subjectId ||
      parsed.query.cursor.kind === "present",
  );
  return catalogReadOk(
    listEnvelope(items, page.next, snapshot.release.id, emptyReasonFor(items.length, "definitions", filtered)),
    snapshot.release.id,
    request.requestId,
  );
}

async function handleGetDefinition(
  snapshot: CatalogSnapshot,
  ports: CatalogReadPorts,
  scope: TrustedCatalogScope,
  request: CatalogReadRequest,
): Promise<CatalogReadResponse> {
  const parsedId = asDefinitionId(request.params.definitionId ?? "", request.requestId);
  if (!parsedId.ok) {
    return parsedId.response;
  }
  if (hiddenId(scope.definitions, parsedId.value)) {
    return notFound(request.requestId, "definition-not-found");
  }
  const result = snapshot.getDefinitionById(parsedId.value);
  if (result.status === "unknown" || result.status === "not-published") {
    return notFound(
      request.requestId,
      result.status === "not-published" && result.target === "subject"
        ? "subject-not-published"
        : "definition-not-found",
    );
  }
  const definition = result.definition;
  if (hiddenId(scope.subjects, definition.subjectId)) {
    return notFound(request.requestId, "definition-not-found");
  }
  const registration = await ports.registration.projectDefinition({
    organizationId: scope.organizationId,
    principalId: scope.principalId,
    subjectId: definition.subjectId,
    observedRelease: observedPin(snapshot),
  });
  const usage = await ports.usage.summarize({
    organizationId: scope.organizationId,
    principalId: scope.principalId,
    definitionId: definition.id,
  });
  const mapped = mapCatalogDefinition(snapshot, definition, registration, usage);
  if (!mapped) {
    return notFound(request.requestId, "definition-not-found");
  }
  return catalogReadOk({ item: mapped }, snapshot.release.id, request.requestId);
}

async function handleListRevisions(
  snapshot: CatalogSnapshot,
  request: CatalogReadRequest,
  scope: TrustedCatalogScope,
): Promise<CatalogReadResponse> {
  const parsedId = asDefinitionId(request.params.definitionId ?? "", request.requestId);
  if (!parsedId.ok) {
    return parsedId.response;
  }
  if (hiddenId(scope.definitions, parsedId.value)) {
    return notFound(request.requestId, "definition-not-found");
  }
  const parsed = parseCatalogListQuery(request);
  if (!parsed.ok) {
    return parsed.response;
  }
  const result = snapshot.listDefinitionRevisions({
    definitionId: parsedId.value,
    page: { limit: catalogPageLimit(parsed.query.limit), after: parsed.query.cursor },
  });
  if (result.status === "invalid-page") {
    return mapInvalidPage(result.reason, request.requestId, snapshot.release.id);
  }
  if (result.status === "unknown" || result.status === "not-published") {
    return notFound(request.requestId, "definition-not-found");
  }
  const items = result.page.items.map(mapDefinitionRevision);
  return catalogReadOk(
    listEnvelope(
      items,
      result.page.next,
      snapshot.release.id,
      emptyReasonFor(items.length, "revisions", parsed.query.cursor.kind === "present"),
    ),
    snapshot.release.id,
    request.requestId,
  );
}

async function handleGetRevision(
  snapshot: CatalogSnapshot,
  request: CatalogReadRequest,
  scope: TrustedCatalogScope,
): Promise<CatalogReadResponse> {
  const parsedDefinition = asDefinitionId(request.params.definitionId ?? "", request.requestId);
  if (!parsedDefinition.ok) {
    return parsedDefinition.response;
  }
  if (hiddenId(scope.definitions, parsedDefinition.value)) {
    return notFound(request.requestId, "definition-not-found");
  }
  let revisionId;
  try {
    revisionId = DefinitionRevisionId(request.params.revisionId ?? "");
  } catch {
    return validationFailed(request.requestId, "revisionId");
  }
  const result = snapshot.getDefinitionRevision({
    definitionId: parsedDefinition.value,
    revisionId,
  });
  if (result.status !== "found") {
    return notFound(request.requestId, "definition-not-found");
  }
  return catalogReadOk({ item: mapDefinitionRevision(result.revision) }, snapshot.release.id, request.requestId);
}

async function handleListTimeline(
  snapshot: CatalogSnapshot,
  ports: CatalogReadPorts,
  scope: TrustedCatalogScope,
  request: CatalogReadRequest,
): Promise<CatalogReadResponse> {
  const parsedId = asDefinitionId(request.params.definitionId ?? "", request.requestId);
  if (!parsedId.ok) {
    return parsedId.response;
  }
  if (hiddenId(scope.definitions, parsedId.value)) {
    return notFound(request.requestId, "definition-not-found");
  }
  const parsed = parseCatalogListQuery(request);
  if (!parsed.ok) {
    return parsed.response;
  }
  const result = snapshot.listDefinitionTimelineFacts({
    definitionId: parsedId.value,
    page: { limit: catalogPageLimit(parsed.query.limit), after: parsed.query.cursor },
  });
  if (result.status === "invalid-page") {
    return mapInvalidPage(result.reason, request.requestId, snapshot.release.id);
  }
  if (result.status === "unknown" || result.status === "not-published") {
    return notFound(request.requestId, "definition-not-found");
  }
  const composed = await ports.timeline.compose({
    definitionId: parsedId.value,
    facts: result.page.items,
    next: result.page.next,
    scope,
  });
  return catalogReadOk(
    listEnvelope(
      composed.items,
      composed.next,
      snapshot.release.id,
      emptyReasonFor(composed.items.length, "timeline", parsed.query.cursor.kind === "present"),
    ),
    snapshot.release.id,
    request.requestId,
  );
}

export async function handleCatalogRead(
  ports: CatalogReadPorts,
  rawRequest: CatalogReadRequest,
): Promise<CatalogReadResponse> {
  const request: CatalogReadRequest = {
    ...rawRequest,
    headers: stripSpoofHeaders(rawRequest.headers),
  };
  const matched = matchCatalogReadRoute(request.path);
  if (!matched || rawRequest.method !== "GET") {
    return notFound(request.requestId, "definition-not-found");
  }
  if (requestCarriesLegacySpecIdentity(rawRequest)) {
    return validationFailed(request.requestId, "legacy-identity");
  }
  const auth = await ports.authenticate(request);
  if (!auth.ok) {
    return auth.status === 401 ? unauthenticated(request.requestId) : forbidden(request.requestId);
  }
  if (!auth.scope.canReadCatalog) {
    return forbidden(request.requestId);
  }
  const documentRoute = matched.id === "catalog.get";
  const facts = await resolveDocumentFacts(ports, request, documentRoute);
  if (!facts.ok) {
    return facts.response;
  }
  const loaded = await loadSnapshot(ports, facts.facts, request.requestId, documentRoute);
  if (!loaded.ok) {
    return loaded.response;
  }
  const snapshot = loaded.snapshot;
  const scopedRequest = { ...request, params: { ...request.params, ...matched.params } };

  try {
    switch (matched.id) {
      case "catalog.get":
        return handleGetCatalog(snapshot, facts.facts, request.requestId);
      case "catalog.listSubjects":
        return handleListSubjects(snapshot, ports, auth.scope, scopedRequest);
      case "catalog.getSubject":
        return handleGetSubject(snapshot, ports, auth.scope, scopedRequest);
      case "catalog.listSubjectDefinitions":
        return handleListDefinitions(snapshot, ports, auth.scope, scopedRequest, scopedRequest.params.subjectId);
      case "catalog.listDefinitions":
        return handleListDefinitions(snapshot, ports, auth.scope, scopedRequest);
      case "catalog.getDefinition":
        return handleGetDefinition(snapshot, ports, auth.scope, scopedRequest);
      case "catalog.listDefinitionRevisions":
        return handleListRevisions(snapshot, scopedRequest, auth.scope);
      case "catalog.getDefinitionRevision":
        return handleGetRevision(snapshot, scopedRequest, auth.scope);
      case "catalog.listDefinitionTimeline":
        return handleListTimeline(snapshot, ports, auth.scope, scopedRequest);
      default:
        return notFound(request.requestId, "definition-not-found");
    }
  } catch (error) {
    if (error instanceof CatalogProjectionError) {
      return mapProjectionError(error, request.requestId);
    }
    if (error instanceof TypeError) {
      return catalogNotReady(request.requestId);
    }
    throw error;
  }
}

export const catalogReadRouteIds = Object.keys(parameterCatalogKernelReadByRouteId) as CatalogReadRouteId[];
