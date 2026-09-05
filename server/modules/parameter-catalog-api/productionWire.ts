import type pg from "pg";

import type { AuthContext } from "../auth/types";
import { createUserInvocation } from "../auth/trustedInvocation";
import { createCatalogKernel, type CatalogKernel } from "../catalog-kernel/interface";
import { readCurrentCatalogPointer } from "../catalog-kernel/install/currentPointer";
import {
  CatalogReleaseDigest,
  CatalogReleaseId,
  CatalogSubjectId,
  type CatalogReleasePin,
  type CatalogSubjectKind,
  type PlacementIntent,
} from "../parameter-catalog-contract/index";
import { canViewParameters } from "../parameter-kernel/policy";
import { executeProposal } from "../parameter-governance/proposals";
import { createGovernanceCatalogQueries } from "../parameter-governance/queries";
import { executeRegistration } from "../parameter-governance/registration";
import { resolveReviewItem } from "../parameter-governance/resolveReviewItem";
import { createReviewQueueReader } from "../parameter-governance/review";
import { createUsageQueries } from "../parameter-bindings/usage";
import type { RouteRequest, WiseEffRouter } from "../../shared/http/router";
import type { Database } from "../../shared/database/client";
import { getRootPostgresPool } from "../../shared/database/client";
import type { MappingQueryable } from "../catalog-cutover/mapping";

import { registerCatalogGovernanceRoutes } from "./governance/routes";
import {
  bindCatalogGovernanceCommands,
  bindGovernanceCatalogQueryPorts,
  unavailableGovernanceQueryPorts,
} from "./governance/ports";
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
  createRegistrationProjectionFromQueries,
  createUsageProjectionFromQueries,
  kernelOnlyTimelineComposer,
  unavailableRegistrationProjection,
  unavailableUsageProjection,
} from "./read/ports";
import type {
  CatalogDocumentFacts,
  CatalogReadPorts,
  CatalogReadRequest,
  CatalogReadinessResult,
  LoadedCatalogSnapshot,
  TrustedCatalogActorKind,
  TrustedCatalogScope,
} from "./read/types";

const CATALOG_SUNSET_HTTP_DATE = "Fri, 31 Dec 2027 00:00:00 GMT";
const UNAVAILABLE_RELEASE_ID = "catalog-unready";
const CATALOG_NOT_READY_RETRY_AFTER_SECONDS = 5;

export type CatalogApiAuthResolver = (request: RouteRequest) => Promise<AuthContext> | AuthContext;

const unavailableRuntime: CatalogReadPorts["runtime"] = {
  async loadCurrentCatalog() {
    return { ok: false, error: { kind: "synchronization-busy", retryable: true } };
  },
  async loadPinnedCatalog() {
    return { ok: false, error: { kind: "synchronization-busy", retryable: true } };
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

const isAgentPrincipal = (auth: AuthContext): boolean =>
  auth.user.title === "WiseEff Agent" || auth.user.id.startsWith("agt-");

const catalogActorKind = (auth: AuthContext): TrustedCatalogActorKind => {
  if (isAgentPrincipal(auth)) {
    return "agent";
  }
  if (auth.roles.some((role) => role.roleId === "platform-admin")) {
    return "platform-admin";
  }
  if (auth.roles.some((role) => role.roleId === "admin")) {
    return "org-admin";
  }
  return "user";
};

const governanceActorKind = (auth: AuthContext): TrustedGovernanceActorKind => {
  if (isAgentPrincipal(auth)) {
    return "agent";
  }
  if (auth.roles.some((role) => role.roleId === "platform-admin")) {
    return "platform-admin";
  }
  if (auth.roles.some((role) => role.roleId === "admin")) {
    return "org-admin";
  }
  return "org-member";
};

const catalogScope = (auth: AuthContext): TrustedCatalogScope => {
  const actorKind = catalogActorKind(auth);
  return {
    principalId: auth.user.id,
    organizationId: auth.organization.id,
    actorKind,
    canReadCatalog: canViewParameters(auth),
    canRegister: actorKind === "org-admin",
    subjects: { kind: "all" },
    definitions: { kind: "all" },
  };
};

const governanceScope = (auth: AuthContext): TrustedGovernanceScope => {
  const actorKind = governanceActorKind(auth);
  return {
    principalId: auth.user.id,
    organizationId: auth.organization.id,
    actorKind,
    canReadGovernance: canViewParameters(auth),
    canMutateOrganization: actorKind === "org-admin",
    canReviewProposals: actorKind === "platform-admin",
    defaultDestinationModuleId: "",
    defaultSubjectKind: "driver",
  };
};

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

const factsFromSnapshot = (snapshot: LoadedCatalogSnapshot): CatalogDocumentFacts => ({
  pin: { id: snapshot.release.id, digest: snapshot.release.digest },
  snapshotKind: snapshot.snapshotKind,
  releaseSequence: Number(snapshot.sequence),
  publishedAt: snapshot.publishedAt,
  materializedAt: snapshot.materializedAt,
  materializationFingerprint:
    snapshot.snapshotKind === "current"
      ? snapshot.materializationFingerprint
      : snapshot.databaseFingerprint,
});

const notReady = (): CatalogReadinessResult => ({
  status: "not-ready",
  retryAfterSeconds: CATALOG_NOT_READY_RETRY_AFTER_SECONDS,
});

const createKernelReadiness = (
  kernel: CatalogKernel,
  pool: pg.Pool,
): CatalogReadPorts["readiness"] => {
  const current = async (): Promise<CatalogReadinessResult> => {
    const pointer = await readCurrentCatalogPointer(pool);
    if (pointer.kind !== "installed") {
      return notReady();
    }
    const loaded = await kernel.loadCurrentCatalog(pinOf(pointer.current.id, pointer.current.digest));
    if (!loaded.ok) {
      return notReady();
    }
    return { status: "ready", document: factsFromSnapshot(loaded.value) };
  };

  return {
    current,
    async named(catalogReleaseId) {
      let releaseId: ReturnType<typeof CatalogReleaseId>;
      try {
        releaseId = CatalogReleaseId(catalogReleaseId);
      } catch {
        return { status: "unknown" };
      }
      const pointer = await readCurrentCatalogPointer(pool);
      if (pointer.kind === "installed" && pointer.current.id === releaseId) {
        return current();
      }
      const resolved = await kernel.resolveCatalogReleasePin(releaseId);
      if (!resolved.ok) {
        return { status: "unknown" };
      }
      const loaded = await kernel.loadPinnedCatalog(resolved.value);
      if (!loaded.ok) {
        return { status: "unknown" };
      }
      return { status: "ready", document: factsFromSnapshot(loaded.value) };
    },
  };
};

const expectedModuleKind = (subjectKind: CatalogSubjectKind): string =>
  subjectKind === "driver" ? "driver-group" : "node-type";

const lookupDefaultDestinationModule = async (
  pool: pg.Pool,
  organizationId: string,
  subjectKind: CatalogSubjectKind,
): Promise<string | null> => {
  const result = await pool.query<{ id: string }>(
    `select id
       from public.parameter_modules
      where organization_id = $1
        and kind = $2
      order by depth asc, id asc
      limit 1`,
    [organizationId, expectedModuleKind(subjectKind)],
  );
  return result.rows[0]?.id ?? null;
};

const lookupChooseParentDestinationModule = async (
  pool: pg.Pool,
  organizationId: string,
  placement: Extract<PlacementIntent, { mode: "choose-parent" }>,
): Promise<string | null> => {
  const result = await pool.query<{ id: string }>(
    `select module.id
       from public.parameter_modules module
       join parameter_catalog.subject_placements parent
         on parent.module_id = module.parent_id
        and parent.organization_id = module.organization_id
      where parent.id = $1
        and module.organization_id = $2
        and module.name = $3
      order by module.id asc
      limit 1`,
    [placement.parentPlacementId, organizationId, placement.displayName],
  );
  return result.rows[0]?.id ?? null;
};

const createReadPorts = (pool: pg.Pool | undefined, resolveAuth: CatalogApiAuthResolver): CatalogReadPorts => {
  if (!pool) {
    return {
      runtime: unavailableRuntime,
      readiness: {
        async current() {
          return notReady();
        },
        async named() {
          return { status: "unknown" };
        },
      },
      registration: unavailableRegistrationProjection,
      usage: unavailableUsageProjection,
      timeline: kernelOnlyTimelineComposer,
      authenticate: authenticateCatalog(resolveAuth),
    };
  }

  const kernel = createCatalogKernel(pool);
  const queries = createGovernanceCatalogQueries(pool);
  const usage = createUsageQueries(pool);
  return {
    runtime: kernel,
    readiness: createKernelReadiness(kernel, pool),
    registration: createRegistrationProjectionFromQueries(queries),
    usage: createUsageProjectionFromQueries(usage),
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

  const kernel = pool ? createCatalogKernel(pool) : undefined;
  const queries = pool ? createGovernanceCatalogQueries(pool) : undefined;

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
    resolveSubjectKind: kernel
      ? async (subjectId) => {
          const pointer = await readCurrentCatalogPointer(pool!);
          if (pointer.kind !== "installed") {
            return null;
          }
          const loaded = await kernel.loadCurrentCatalog(pinOf(pointer.current.id, pointer.current.digest));
          if (!loaded.ok) {
            return null;
          }
          let id: ReturnType<typeof CatalogSubjectId>;
          try {
            id = CatalogSubjectId(subjectId);
          } catch {
            return null;
          }
          const subject = loaded.value.getSubject(id);
          if (subject.status !== "found" && subject.status !== "retired") {
            return null;
          }
          return subject.subject.kind;
        }
      : undefined,
    resolveDestinationModuleId: pool
      ? async ({ organizationId, subjectKind, placement }) => {
          if (placement.mode === "choose-parent") {
            return lookupChooseParentDestinationModule(pool, organizationId, placement);
          }
          return lookupDefaultDestinationModule(pool, organizationId, subjectKind);
        }
      : undefined,
    ...(queries ? bindGovernanceCatalogQueryPorts(queries) : unavailableGovernanceQueryPorts),
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
