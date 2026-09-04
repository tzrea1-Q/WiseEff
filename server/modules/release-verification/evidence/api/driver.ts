import { randomUUID } from "node:crypto";

import type { AuthContext } from "../../../auth/types";
import { createAgentInvocation, createUserInvocation } from "../../../auth/trustedInvocation";
import { createCatalogKernel } from "../../../catalog-kernel/interface";
import { readCurrentCatalogPointer } from "../../../catalog-kernel/install/currentPointer";
import {
  CatalogReleaseDigest,
  CatalogReleaseId,
  type CatalogReleasePin,
} from "../../../parameter-catalog-contract/index";
import { executeProposal } from "../../../parameter-governance/proposals";
import { executeRegistration } from "../../../parameter-governance/registration";
import { resolveReviewItem } from "../../../parameter-governance/resolveReviewItem";
import { createReviewQueueReader } from "../../../parameter-governance/review";
import { handleCatalogRead, matchCatalogReadRoute } from "../../../parameter-catalog-api/read/handlers";
import { registerCatalogReadRoutes } from "../../../parameter-catalog-api/read/routes";
import {
  kernelOnlyTimelineComposer,
  unregisteredProjection,
  zeroUsageProjection,
} from "../../../parameter-catalog-api/read/ports";
import type {
  CatalogReadPorts,
  CatalogReadRequest,
  TrustedCatalogActorKind,
  TrustedCatalogScope,
} from "../../../parameter-catalog-api/read/types";
import { handleCatalogGovernance, matchCatalogGovernanceRoute } from "../../../parameter-catalog-api/governance/handlers";
import { registerCatalogGovernanceRoutes } from "../../../parameter-catalog-api/governance/routes";
import { bindCatalogGovernanceCommands, emptyGovernanceQueryPorts } from "../../../parameter-catalog-api/governance/ports";
import type {
  CatalogGovernancePorts,
  CatalogGovernanceRequest,
  TrustedGovernanceActorKind,
  TrustedGovernanceScope,
} from "../../../parameter-catalog-api/governance/types";
import { handleLegacyCatalogRequest, registerCatalogLegacyRoutes } from "../../../parameter-catalog-api/legacy/routes";
import type { LegacyCatalogOptions } from "../../../parameter-catalog-api/legacy/types";
import { registerParameterTopologyRoutes } from "../../../parameter-topology/routes";
import type { MappingQueryable } from "../../../catalog-cutover/mapping";
import { ApiError } from "../../../../shared/http/errors";
import { createRouter, type HttpMethod, type RouteRequest } from "../../../../shared/http/router";
import { getRootPostgresPool, type Database } from "../../../../shared/database/client";
import type {
  CatalogApiCandidateDriver,
  CatalogApiDispatchInput,
  CatalogApiDispatchOutput,
  CatalogApiPrincipalMode,
} from "./types";

const CATALOG_SUNSET_HTTP_DATE = "Fri, 31 Dec 2027 00:00:00 GMT";
const UNAVAILABLE_RELEASE_ID = "catalog-unready";

const pinOf = (id: string, digest: string): CatalogReleasePin => ({
  id: CatalogReleaseId(id),
  digest: CatalogReleaseDigest(digest),
});

const wrapMappingQueryable = (
  query: (text: string, values?: unknown[]) => Promise<unknown>,
): MappingQueryable => ({
  query: ((text: string, values?: unknown[]) => query(text, values)) as MappingQueryable["query"],
});

export type CatalogApiEvidenceHarnessOptions = {
  readonly db: Database;
  readonly organizationId: string;
  readonly principalId: string;
  readonly authorizedAuth: AuthContext;
  readonly agentAuth: AuthContext;
  readonly forbiddenAuth: AuthContext;
};

const catalogScope = (
  actorKind: TrustedCatalogActorKind,
  options: CatalogApiEvidenceHarnessOptions,
  canRead: boolean,
): TrustedCatalogScope => ({
  principalId: options.principalId,
  organizationId: options.organizationId,
  actorKind,
  canReadCatalog: canRead,
  canRegister: actorKind === "org-admin",
  subjects: { kind: "all" },
  definitions: { kind: "all" },
});

const governanceScope = (
  actorKind: TrustedGovernanceActorKind,
  options: CatalogApiEvidenceHarnessOptions,
  canRead: boolean,
  canMutate: boolean,
): TrustedGovernanceScope => ({
  principalId: options.principalId,
  organizationId: options.organizationId,
  actorKind,
  canReadGovernance: canRead,
  canMutateOrganization: canMutate,
  canReviewProposals: false,
  defaultDestinationModuleId: "pmod-s10-api-driver",
  defaultSubjectKind: "driver",
});

export function createCatalogApiEvidenceHarness(options: CatalogApiEvidenceHarnessOptions): {
  readonly setPrincipal: (mode: CatalogApiPrincipalMode) => void;
  readonly driver: CatalogApiCandidateDriver;
  readonly router: ReturnType<typeof createRouter>;
} {
  const pool = getRootPostgresPool(options.db);
  if (!pool) {
    throw new Error("candidate catalog API evidence requires a root PostgreSQL pool");
  }

  let principal: CatalogApiPrincipalMode = "authorized";
  const setPrincipal = (mode: CatalogApiPrincipalMode) => {
    principal = mode;
  };

  const kernel = createCatalogKernel(pool);
  const readinessFromPointer = async (namedId?: string) => {
    const pointer = await readCurrentCatalogPointer(pool);
    if (pointer.kind !== "installed") {
      return { status: "not-ready" as const, retryAfterSeconds: 5 };
    }
    const pin = pinOf(pointer.current.id, pointer.current.digest);
    if (namedId && namedId !== pin.id) {
      const loadedNamed = await kernel.loadPinnedCatalog(pinOf(namedId, pin.digest));
      if (!loadedNamed.ok) {
        return { status: "unknown" as const };
      }
      return {
        status: "ready" as const,
        document: {
          pin: { id: loadedNamed.value.release.id, digest: loadedNamed.value.release.digest },
          snapshotKind: "pinned" as const,
          releaseSequence: 0,
          publishedAt: new Date(0).toISOString(),
          materializedAt: new Date(0).toISOString(),
          materializationFingerprint: pin.digest,
        },
      };
    }
    const loaded = await kernel.loadCurrentCatalog(pin);
    if (!loaded.ok) {
      return { status: "not-ready" as const, retryAfterSeconds: 5 };
    }
    return {
      status: "ready" as const,
      document: {
        pin: { id: loaded.value.release.id, digest: loaded.value.release.digest },
        snapshotKind: "current" as const,
        releaseSequence: 0,
        publishedAt: new Date(0).toISOString(),
        materializedAt: new Date(0).toISOString(),
        materializationFingerprint: loaded.value.materializationFingerprint,
      },
    };
  };

  const authenticateCatalog = async () => {
    if (principal === "unauthenticated") {
      return { ok: false as const, status: 401 as const };
    }
    if (principal === "forbidden") {
      return { ok: true as const, scope: catalogScope("user", options, false) };
    }
    if (principal === "agent") {
      return { ok: true as const, scope: catalogScope("agent", options, true) };
    }
    return { ok: true as const, scope: catalogScope("org-admin", options, true) };
  };

  const authenticateGovernance = async () => {
    if (principal === "unauthenticated") {
      return { ok: false as const, status: 401 as const };
    }
    if (principal === "forbidden") {
      return { ok: true as const, scope: governanceScope("org-member", options, false, false) };
    }
    if (principal === "agent") {
      return { ok: true as const, scope: governanceScope("agent", options, true, false) };
    }
    return { ok: true as const, scope: governanceScope("org-admin", options, true, true) };
  };

  const readPorts: CatalogReadPorts = {
    runtime: kernel,
    readiness: {
      current: () => readinessFromPointer(),
      named: (catalogReleaseId) => readinessFromPointer(catalogReleaseId),
    },
    registration: unregisteredProjection,
    usage: zeroUsageProjection,
    timeline: kernelOnlyTimelineComposer,
    authenticate: authenticateCatalog,
  };

  const reader = createReviewQueueReader(pool);
  const governancePorts: CatalogGovernancePorts = {
    authenticate: authenticateGovernance,
    currentRelease: async () => {
      const pointer = await readCurrentCatalogPointer(pool);
      if (pointer.kind !== "installed") {
        return null;
      }
      return pinOf(pointer.current.id, pointer.current.digest);
    },
    ...bindCatalogGovernanceCommands({
      executeRegistration: (command) => executeRegistration(pool, command),
      resolveReviewItem: (command) => resolveReviewItem(pool, command),
      executeProposal: (command) => executeProposal(pool, command),
      listReviewQueue: (query) => reader.list(query),
      getReviewItem: (query) => reader.get(query),
    }),
    ...emptyGovernanceQueryPorts,
  };

  const resolveAuthContext = async (): Promise<AuthContext> => {
    if (principal === "unauthenticated") {
      throw new ApiError("UNAUTHENTICATED", "Authentication required.");
    }
    if (principal === "agent") {
      return options.agentAuth;
    }
    if (principal === "forbidden") {
      return options.forbiddenAuth;
    }
    return options.authorizedAuth;
  };

  const legacyOptions: LegacyCatalogOptions = {
    catalogReleaseId: UNAVAILABLE_RELEASE_ID,
    resolveCatalogReleaseId: async () => {
      const pointer = await readCurrentCatalogPointer(pool);
      return pointer.kind === "installed" ? pointer.current.id : UNAVAILABLE_RELEASE_ID;
    },
    sunsetHttpDate: CATALOG_SUNSET_HTTP_DATE,
    getQueryable: async () => wrapMappingQueryable((text, values) => pool.query(text, values)),
    resolveInvocation: async () => {
      if (principal === "unauthenticated") {
        return null;
      }
      const auth = await resolveAuthContext();
      if (principal === "agent") {
        return createAgentInvocation(auth, {
          sessionId: "s10-api-agent",
          toolCallId: "s10-api-tool",
          approval: { required: false },
        });
      }
      return createUserInvocation(auth);
    },
  };

  const router = createRouter();
  registerCatalogReadRoutes(router, readPorts);
  registerCatalogGovernanceRoutes(router, governancePorts);
  registerCatalogLegacyRoutes(router, legacyOptions);
  registerParameterTopologyRoutes(router, {
    db: options.db,
    getCurrentAuthContext: resolveAuthContext,
  });

  const toRouteRequest = (input: CatalogApiDispatchInput): RouteRequest => ({
    method: input.method.toUpperCase() as HttpMethod,
    path: input.path.split("?")[0] ?? input.path,
    params: {},
    query: Object.fromEntries(new URL(`http://127.0.0.1${input.path}`).searchParams.entries()),
    headers: input.headers ?? {},
    requestId: input.requestId,
    body: input.body,
  });

  const toOutput = (status: number, body: unknown, headers: Record<string, string>, requestId: string): CatalogApiDispatchOutput => ({
    status,
    headers: {
      "X-Request-Id": headers["X-Request-Id"] ?? requestId,
      ...headers,
    },
    body,
  });

  const driver: CatalogApiCandidateDriver = {
    kind: "candidate",
    async dispatch(input) {
      setPrincipal(input.principal);
      const requestId = input.requestId || randomUUID();
      const routeRequest = { ...toRouteRequest({ ...input, requestId }), requestId };
      if (routeRequest.method === "GET" && matchCatalogReadRoute(routeRequest.path)) {
        const readRequest: CatalogReadRequest = {
          method: "GET",
          path: routeRequest.path,
          params: {},
          query: routeRequest.query,
          headers: routeRequest.headers,
          requestId,
        };
        const read = await handleCatalogRead(readPorts, readRequest);
        return toOutput(read.status, read.body, { ...read.headers }, requestId);
      }
      if (matchCatalogGovernanceRoute(routeRequest.method, routeRequest.path)) {
        const governanceRequest: CatalogGovernanceRequest = {
          method: routeRequest.method,
          path: routeRequest.path,
          params: {},
          query: routeRequest.query,
          headers: routeRequest.headers,
          requestId,
          body: routeRequest.body,
        };
        const governance = await handleCatalogGovernance(governancePorts, governanceRequest);
        return toOutput(governance.status, governance.body, { ...governance.headers }, requestId);
      }
      const legacy = await handleLegacyCatalogRequest(routeRequest, legacyOptions);
      if (
        routeRequest.path.startsWith("/api/v2/catalog/legacy-identifiers") ||
        routeRequest.path.startsWith("/api/v2/parameter-specs") ||
        routeRequest.path.startsWith("/api/v2/parameter-modules") ||
        legacy.status === 410
      ) {
        return toOutput(legacy.status, legacy.body, { ...legacy.headers }, requestId);
      }
      try {
        const routed = await router.handle(routeRequest);
        if ("body" in routed) {
          return toOutput(routed.status, routed.body, { ...(routed.headers ?? {}) }, requestId);
        }
        return toOutput(routed.status, {}, {}, requestId);
      } catch (error) {
        if (error instanceof ApiError) {
          return toOutput(error.status, {
            error: {
              code: error.code,
              message: error.message,
              details: error.details,
              requestId,
            },
          }, { "X-Request-Id": requestId }, requestId);
        }
        throw error;
      }
    },
  };

  return { setPrincipal, driver, router };
}

export function createCatalogApiHttpDriver(options: {
  readonly baseUrl: string;
  readonly setPrincipal: (mode: CatalogApiPrincipalMode) => void;
}): CatalogApiCandidateDriver {
  return {
    kind: "candidate",
    async dispatch(input) {
      options.setPrincipal(input.principal);
      const headers: Record<string, string> = {
        "content-type": "application/json",
        "X-Request-Id": input.requestId,
        ...(input.headers ?? {}),
      };
      const canSendBody = input.method !== "GET" && input.method !== "HEAD";
      const response = await fetch(`${options.baseUrl}${input.path}`, {
        method: input.method,
        headers,
        body: !canSendBody || input.body === undefined ? undefined : JSON.stringify(input.body),
      });
      const text = await response.text();
      let body: unknown = text;
      if (text) {
        try {
          body = JSON.parse(text) as unknown;
        } catch {
          body = text;
        }
      } else {
        body = undefined;
      }
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });
      return { status: response.status, headers: responseHeaders, body };
    },
  };
}
