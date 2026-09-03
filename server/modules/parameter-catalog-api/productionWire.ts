import type pg from "pg";

import type { AuthContext } from "../auth/types";
import { createUserInvocation } from "../auth/trustedInvocation";
import { createCatalogKernel } from "../catalog-kernel/interface";
import { readCurrentCatalogPointer } from "../catalog-kernel/install/currentPointer";
import {
  CatalogReleaseDigest,
  CatalogReleaseId,
  type CatalogReleasePin,
} from "../parameter-catalog-contract/index";
import { canViewParameters } from "../parameter-kernel/policy";
import { executeProposal } from "../parameter-governance/proposals";
import { executeRegistration } from "../parameter-governance/registration";
import { resolveReviewItem } from "../parameter-governance/resolveReviewItem";
import { createReviewQueueReader } from "../parameter-governance/review";
import type { RouteRequest, WiseEffRouter } from "../../shared/http/router";
import type { Database } from "../../shared/database/client";
import { getRootPostgresPool } from "../../shared/database/client";
import type { MappingQueryable } from "../catalog-cutover/mapping";

import { registerCatalogGovernanceRoutes } from "./governance/routes";
import { bindCatalogGovernanceCommands, emptyGovernanceQueryPorts } from "./governance/ports";
import type {
  CatalogGovernancePorts,
  CatalogGovernanceRequest,
  TrustedGovernanceActorKind,
  TrustedGovernanceScope,
} from "./governance/types";
import { registerCatalogLegacyRoutes } from "./legacy/routes";
import type { LegacyCatalogOptions } from "./legacy/types";
import { registerCatalogReadRoutes } from "./read/routes";
import {
  kernelOnlyTimelineComposer,
  unregisteredProjection,
  zeroUsageProjection,
} from "./read/ports";
import type {
  CatalogReadPorts,
  CatalogReadRequest,
  TrustedCatalogActorKind,
  TrustedCatalogScope,
} from "./read/types";

const CATALOG_SUNSET_HTTP_DATE = "Fri, 31 Dec 2027 00:00:00 GMT";
const UNAVAILABLE_RELEASE_ID = "catalog-unready";

export type CatalogApiAuthResolver = (request: RouteRequest) => Promise<AuthContext> | AuthContext;

const unavailableRuntime: CatalogReadPorts["runtime"] = {
  async loadCurrentCatalog() {
    return {
      ok: false,
      error: { kind: "permission-denied", operation: "loadCurrentCatalog" },
    };
  },
  async loadPinnedCatalog() {
    return {
      ok: false,
      error: { kind: "permission-denied", operation: "loadPinnedCatalog" },
    };
  },
};

const pinOf = (id: string, digest: string): CatalogReleasePin => ({
  id: CatalogReleaseId(id),
  digest: CatalogReleaseDigest(digest),
});

const wrapMappingQueryable = (
  query: (text: string, values?: unknown[]) => Promise<unknown>,
): MappingQueryable => ({
  query: ((text: string, values?: unknown[]) => query(text, values)) as MappingQueryable["query"],
});

const catalogActorKind = (auth: AuthContext): TrustedCatalogActorKind => {
  if (auth.roles.some((role) => role.roleId === "platform-admin")) {
    return "platform-admin";
  }
  if (auth.roles.some((role) => role.roleId === "admin")) {
    return "org-admin";
  }
  if (auth.roles.some((role) => role.roleId === "guest")) {
    return "user";
  }
  return "user";
};

const governanceActorKind = (auth: AuthContext): TrustedGovernanceActorKind => {
  if (auth.roles.some((role) => role.roleId === "platform-admin")) {
    return "platform-admin";
  }
  if (auth.roles.some((role) => role.roleId === "admin")) {
    return "org-admin";
  }
  return "org-member";
};

const catalogScope = (auth: AuthContext): TrustedCatalogScope => ({
  principalId: auth.user.id,
  organizationId: auth.organization.id,
  actorKind: catalogActorKind(auth),
  canReadCatalog: canViewParameters(auth),
  canRegister:
    auth.permissions.includes("parameter:edit") ||
    auth.roles.some((role) => role.roleId === "admin" || role.roleId === "platform-admin"),
  subjects: { kind: "all" },
  definitions: { kind: "all" },
});

const governanceScope = (auth: AuthContext): TrustedGovernanceScope => ({
  principalId: auth.user.id,
  organizationId: auth.organization.id,
  actorKind: governanceActorKind(auth),
  canReadGovernance: canViewParameters(auth),
  canMutateOrganization:
    auth.permissions.includes("parameter:edit") ||
    auth.roles.some((role) => role.roleId === "admin" || role.roleId === "platform-admin"),
  canReviewProposals:
    auth.permissions.includes("parameter:review") ||
    auth.roles.some((role) => role.roleId === "admin" || role.roleId === "platform-admin"),
  defaultDestinationModuleId: "",
  defaultSubjectKind: "driver",
});

const authenticateCatalog =
  (resolveAuth: CatalogApiAuthResolver) =>
  async (request: CatalogReadRequest) => {
    const auth = await resolveAuth(request as RouteRequest);
    if (!auth.user.isActive) {
      return { ok: false as const, status: 401 as const };
    }
    return { ok: true as const, scope: catalogScope(auth) };
  };

const authenticateGovernance =
  (resolveAuth: CatalogApiAuthResolver) =>
  async (request: CatalogGovernanceRequest) => {
    const auth = await resolveAuth(request as RouteRequest);
    if (!auth.user.isActive) {
      return { ok: false as const, status: 401 as const };
    }
    return { ok: true as const, scope: governanceScope(auth) };
  };

const createReadPorts = (pool: pg.Pool | undefined, resolveAuth: CatalogApiAuthResolver): CatalogReadPorts => {
  if (!pool) {
    return {
      runtime: unavailableRuntime,
      readiness: {
        async current() {
          return { status: "not-ready", retryAfterSeconds: 5 };
        },
        async named() {
          return { status: "unknown" };
        },
      },
      registration: unregisteredProjection,
      usage: zeroUsageProjection,
      timeline: kernelOnlyTimelineComposer,
      authenticate: authenticateCatalog(resolveAuth),
    };
  }

  const kernel = createCatalogKernel(pool);
  const readinessFromPointer = async (namedId?: string) => {
    const pointer = await readCurrentCatalogPointer(pool);
    if (pointer.kind !== "installed") {
      return { status: "not-ready" as const, retryAfterSeconds: 5 };
    }
    const pin = pinOf(pointer.current.id, pointer.current.digest);
    if (namedId && namedId !== pin.id) {
      let namedPin: CatalogReleasePin;
      try {
        namedPin = pinOf(namedId, pin.digest);
      } catch {
        return { status: "unknown" as const };
      }
      const loadedNamed = await kernel.loadPinnedCatalog(namedPin);
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

  return {
    runtime: kernel,
    readiness: {
      current: () => readinessFromPointer(),
      named: (catalogReleaseId) => readinessFromPointer(catalogReleaseId),
    },
    registration: unregisteredProjection,
    usage: zeroUsageProjection,
    timeline: kernelOnlyTimelineComposer,
    authenticate: authenticateCatalog(resolveAuth),
  };
};

const createGovernancePorts = (
  pool: pg.Pool | undefined,
  resolveAuth: CatalogApiAuthResolver,
): CatalogGovernancePorts => {
  const commands = pool
    ? bindCatalogGovernanceCommands({
        executeRegistration: (command) => executeRegistration(pool, command),
        resolveReviewItem: (command) => resolveReviewItem(pool, command),
        executeProposal: (command) => executeProposal(pool, command),
        listReviewQueue: (query) => {
          const reader = createReviewQueueReader(pool);
          return reader.list(query);
        },
        getReviewItem: (query) => {
          const reader = createReviewQueueReader(pool);
          return reader.get(query);
        },
      })
    : {
        executeRegistration: async () => ({
          ok: false as const,
          error: {
            kind: "catalog-drift" as const,
            code: "PCAT-GUARD-DRIFT" as const,
            sqlstate: "PCA04" as const,
          },
        }),
        resolveReviewItem: async () => ({
          ok: false as const,
          error: { kind: "review-item-not-found" as const, reviewItemId: "catalog-unwired" },
        }),
        executeProposal: async () => ({
          ok: false as const,
          error: {
            kind: "permission-denied" as const,
            actorKind: "org-admin" as const,
            method: "executeProposal",
          },
        }),
        listReviewQueue: async () => ({
          ok: false as const,
          error: { kind: "permission-denied" as const, actorKind: "anonymous" as const },
        }),
        getReviewItem: async () => ({
          ok: false as const,
          error: { kind: "review-item-not-found" as const, reviewItemId: "catalog-unwired" },
        }),
      };

  return {
    authenticate: authenticateGovernance(resolveAuth),
    currentRelease: async () => {
      if (!pool) {
        return null;
      }
      const pointer = await readCurrentCatalogPointer(pool);
      if (pointer.kind !== "installed") {
        return null;
      }
      return pinOf(pointer.current.id, pointer.current.digest);
    },
    ...commands,
    ...emptyGovernanceQueryPorts,
  };
};

const createLegacyOptions = (
  db: Database | undefined,
  pool: pg.Pool | undefined,
  resolveAuth: CatalogApiAuthResolver,
): LegacyCatalogOptions => ({
  catalogReleaseId: UNAVAILABLE_RELEASE_ID,
  resolveCatalogReleaseId: async () => {
    if (!pool) {
      return UNAVAILABLE_RELEASE_ID;
    }
    const pointer = await readCurrentCatalogPointer(pool);
    return pointer.kind === "installed" ? pointer.current.id : UNAVAILABLE_RELEASE_ID;
  },
  sunsetHttpDate: CATALOG_SUNSET_HTTP_DATE,
  getQueryable: async () => {
    if (pool) {
      return wrapMappingQueryable((text, values) => pool.query(text, values));
    }
    if (db) {
      return wrapMappingQueryable((text, values) => db.query(text, values));
    }
    throw new Error("Catalog legacy lookup requires a database");
  },
  resolveInvocation: async (request) => createUserInvocation(await resolveAuth(request)),
});

export const registerParameterCatalogApi = (
  router: WiseEffRouter,
  options: {
    readonly db?: Database;
    readonly resolveAuth: CatalogApiAuthResolver;
  },
): void => {
  const pool = getRootPostgresPool(options.db);
  registerCatalogReadRoutes(router, createReadPorts(pool, options.resolveAuth));
  registerCatalogGovernanceRoutes(router, createGovernancePorts(pool, options.resolveAuth));
  registerCatalogLegacyRoutes(router, createLegacyOptions(options.db, pool, options.resolveAuth));
};
