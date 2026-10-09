import type pg from "pg";

import { getAuthContextForExternalIdentity } from "../auth/repository";
import type { AuthContext } from "../auth/types";
import {
  assertTrustedInvocationContext,
  assertTrustedInvocationMatchesAuth,
  type TrustedInvocationContext,
} from "../auth/trustedInvocation";
import { permissionsForRoles } from "../auth/policy";
import type { UsageProjectScope } from "../parameter-bindings/usage";
import { createUserInvocation } from "../auth/trustedInvocation";
import { createCatalogKernel, type CatalogKernel, type CatalogSubjectDetailSnapshot } from "../catalog-kernel/interface";
import { isCatalogProjectionEmpty, readCurrentCatalogPointer } from "../catalog-kernel/install/currentPointer";
import {
  captureCurrentCatalogPin,
  createPinCapturingCatalogRuntime,
  evaluateDualFactReadiness,
  resolveCatalogPublicationRuntimeOptions,
  type CatalogPublicationRuntimeOptions,
} from "../catalog-publication/runtime";
import { createStartupRuntimePin } from "../release-verification/report/service";
import {
  CatalogReleaseDigest,
  CatalogReleaseId,
  CatalogSubjectId,
  PublicationJobId,
  type CatalogReleasePin,
  type CatalogSubjectKind,
  type PlacementIntent,
} from "../parameter-catalog-contract/index";
import { canViewParameters } from "../parameter-kernel/policy";
import { executeProposal } from "../parameter-governance/proposals";
import { createGovernanceCatalogQueries, GOVERNANCE_CURRENT_PROJECTION_SEMANTICS } from "../parameter-governance/queries";
import type { GovernanceRegistrationRecord } from "../parameter-governance/queries";
import { executeRegistration } from "../parameter-governance/registration";
import { resolveReviewItem } from "../parameter-governance/resolveReviewItem";
import { createReviewQueueReader } from "../parameter-governance/review";
import { createUsageQueries } from "../parameter-bindings/usage";
import type { RouteRequest, WiseEffRouter } from "../../shared/http/router";
import type { Database } from "../../shared/database/client";
import { getRootPostgresPool } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { MappingQueryable } from "../catalog-cutover/mapping";
import {
  readCompletedCutoverMappingManifest,
  type CompletedMappingManifest,
} from "../catalog-cutover/completedMappingManifest";
export type { CompletedMappingManifest } from "../catalog-cutover/completedMappingManifest";
import type { ObjectStore } from "../logs/objectStore";
import {
  catalogDefinitionResponseSchema,
  catalogRegistrationDtoSchema,
} from "../contracts/dtoSchemas/parameterCatalog";

import { registerCatalogGovernanceRoutes, registerCatalogDefinitionReplacementRoutes } from "./governance/routes";
import { registerCatalogDriverCompatibleDiscoveryRoute } from "./driverDiscoveryRoute";
import { createParameterCatalogMigrationService } from "../parameter-catalog-migration/service";
import type { ReplacementPublicationPorts } from "../parameter-catalog-migration/types";
import { enqueuePublicationJob } from "../catalog-publication/enqueue";
import { withPublicationCoordinator } from "../catalog-publication/coordinator";
import { getJob, getReceiptByJobId } from "../catalog-publication/persistence/store";
import {
  bindCatalogGovernanceCommands,
  bindGovernanceCatalogQueryPorts,
  unavailableGovernanceQueryPorts,
} from "./governance/ports";
import { registerCatalogPublicationRoutes } from "./publication/routes";
import {
  bindCatalogPublicationCommands,
  unavailablePublicationCommandPorts,
} from "./publication/ports";
import type {
  CatalogPublicationPorts,
  CatalogPublicationRequest,
  TrustedPublicationScope,
} from "./publication/types";
import type {
  CatalogGovernancePorts,
  CatalogGovernanceRequest,
  TrustedGovernanceActorKind,
  TrustedGovernanceScope,
} from "./governance/types";
import { registerCatalogLegacyRoutes } from "./legacy/routes";
import { CATALOG_SUNSET_HTTP_DATE } from "./legacy/headers";
import type { LegacyCatalogOptions } from "./legacy/types";
import { registerCatalogReadRoutes } from "./read/routes";
import { handleCatalogRead } from "./read/handlers";
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

const UNAVAILABLE_RELEASE_ID = "catalog-unready";
const CATALOG_NOT_READY_RETRY_AFTER_SECONDS = 5;

export type CatalogApiAuthResolver = (request: RouteRequest) => Promise<AuthContext> | AuthContext;

/** The Knowledge writer uses the same authenticated Definition read as Catalog HTTP. */
export async function readCatalogDefinitionForKnowledge(
  db: Database,
  auth: AuthContext,
  definitionId: string,
  requestId = "knowledge-definition-reference",
) {
  const pool = getRootPostgresPool(db);
  if (!pool) throw new ApiError("CONFLICT", "Catalog read is unavailable.", { reason: "catalog-unavailable" });
  const response = await handleCatalogRead(
    createReadPorts(pool, async () => auth, db, { env: process.env }),
    {
      method: "GET",
      path: `/api/v2/catalog/definitions/${encodeURIComponent(definitionId)}`,
      params: {}, query: {}, headers: {}, requestId,
    },
  );
  if (response.status === 404) throw new ApiError("NOT_FOUND", "Parameter definition was not found.");
  if (response.status === 401 || response.status === 403) {
    throw new ApiError("FORBIDDEN", "Parameter definition is not visible.");
  }
  if (response.status !== 200) {
    throw new ApiError("CONFLICT", "Catalog definition read is unavailable.", {
      reason: (response.body as { error?: { details?: { reason?: string } } }).error?.details?.reason ?? "catalog-unavailable",
    });
  }
  const parsed = catalogDefinitionResponseSchema.safeParse(response.body);
  if (!parsed.success) throw new ApiError("CONFLICT", "Catalog definition proof is invalid.", { reason: "catalog-proof-invalid" });
  return parsed.data.item;
}

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

/** Complete, read-only Governance projection for a release comparison snapshot. */
export type ComparisonGovernanceRegistration = GovernanceRegistrationRecord;
export type ComparisonCatalogSubject = CatalogSubjectDetailSnapshot;

export type CompletedModComparisonManifestScope = {
  readonly auth: AuthContext;
  readonly manifest: CompletedMappingManifest;
};

/** Revalidates persisted organization authority and the immutable P7 manifest for MOD comparison reads. */
export async function readCompletedModComparisonManifestForComparison(input: {
  readonly database: Database;
  readonly pool: pg.Pool;
  readonly runId: string;
  readonly invocation: TrustedInvocationContext;
}): Promise<CompletedModComparisonManifestScope> {
  if (getRootPostgresPool(input.database) !== input.pool) {
    throw new Error("PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE: MOD comparison manifest database and pool differ");
  }
  const invocation = assertTrustedInvocationContext(input.invocation);
  if (invocation.initiator !== "user") {
    throw new Error("PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE: MOD comparison requires a user invocation");
  }
  const organizationId = invocation.principal.organization.id;
  const principalId = invocation.principal.user.id;
  const auth = await getAuthContextForExternalIdentity(input.database, {
    organizationId,
    subject: principalId,
  });
  assertTrustedInvocationMatchesAuth(auth, invocation, "MOD comparison manifest read");
  if (auth.organization.id !== organizationId || auth.user.id !== principalId ||
      auth.user.organizationId !== organizationId || !auth.user.isActive) {
    throw new Error("PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE: MOD comparison manifest persisted principal scope is invalid");
  }
  const result = await readCompletedCutoverMappingManifest({
    pool: input.pool,
    runId: input.runId,
    auth,
  });
  if (!result.ok) {
    throw new Error(`PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE: MOD comparison completed manifest is unavailable: ${result.error.detail}`);
  }
  const manifest = result.value;
  if (manifest.projection.organizationId !== organizationId ||
      manifest.projection.principalId !== principalId) {
    throw new Error("PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE: MOD comparison completed manifest returned a different organization or principal");
  }
  return { auth, manifest };
}

/** Exact current-release Subject identities through the production read composition. */
export async function readPinnedCatalogSubjectsForComparison(
  pool: pg.Pool,
  db: Database,
  scopes: readonly {
    readonly organizationId: string;
    readonly auth: AuthContext;
    readonly subjectIds: readonly CatalogSubjectId[];
  }[],
  expectedPin: CatalogReleasePin,
): Promise<Map<string, ReadonlyMap<string, ComparisonCatalogSubject | null>>> {
  const matches = (pin: CatalogReleasePin | null) =>
    pin?.id === expectedPin.id && pin.digest === expectedPin.digest;
  if (!matches(await captureCurrentCatalogPin(pool))) {
    throw new Error("Catalog release differs from comparison input");
  }
  const byOrganization = new Map<string, ReadonlyMap<string, ComparisonCatalogSubject | null>>();
  for (const { organizationId, auth, subjectIds } of scopes) {
    if (byOrganization.has(organizationId)) throw new Error(`Duplicate Subject scope for ${organizationId}`);
    const ports = createReadPorts(pool, async () => auth, db, { env: process.env });
    const authenticated = await ports.authenticate({
      method: "GET", path: "/api/v2/catalog/subjects", params: {}, query: {}, headers: {},
      requestId: "mod-comparison-subject-read",
    });
    if (!authenticated.ok || !authenticated.scope.canReadCatalog ||
        authenticated.scope.organizationId !== organizationId ||
        auth.user.organizationId !== organizationId) {
      throw new Error(`Catalog Subject read unauthorized for ${organizationId}`);
    }
    const readiness = await ports.readiness.current();
    if (readiness.status !== "ready" || !matches(readiness.document.pin)) {
      throw new Error(`Catalog Subject read not ready for ${organizationId}: ${readiness.status}`);
    }
    const loaded = await ports.runtime.loadCurrentCatalog(expectedPin);
    if (!loaded.ok || !matches({ id: loaded.value.release.id, digest: loaded.value.release.digest })) {
      throw new Error(`Catalog Subject snapshot unavailable for ${organizationId}`);
    }
    const subjects = new Map<string, ComparisonCatalogSubject | null>();
    for (const id of subjectIds) {
      if (authenticated.scope.subjects.kind === "only" && !authenticated.scope.subjects.ids.includes(id)) {
        throw new Error(`Catalog Subject outside authorized scope for ${organizationId}`);
      }
      const found = loaded.value.getSubject(id);
      subjects.set(id, found.status === "found" || found.status === "retired" ? found.subject : null);
    }
    byOrganization.set(organizationId, subjects);
  }
  if (!matches(await captureCurrentCatalogPin(pool))) {
    throw new Error("Catalog release changed during Subject comparison read");
  }
  return byOrganization;
}

export async function readPinnedGovernanceRegistrationsForComparison(
  pool: pg.Pool,
  organizationIds: readonly string[],
  expectedPin: CatalogReleasePin,
  principalId = "mod-comparison-reader",
): Promise<Map<string, readonly ComparisonGovernanceRegistration[]>> {
  if (!principalId || principalId.trim() !== principalId) {
    throw new Error("Governance comparison principal is invalid");
  }
  const matches = (pin: CatalogReleasePin | null) =>
    pin?.id === expectedPin.id && pin.digest === expectedPin.digest;
  if (!matches(await captureCurrentCatalogPin(pool))) {
    throw new Error("Catalog release differs from comparison input");
  }
  const client = await pool.connect();
  const byOrganization = new Map<string, readonly GovernanceRegistrationRecord[]>();
  const seenRegistrationIds = new Set<string>();
  const seenPlacementIds = new Set<string>();
  try {
    await client.query("begin transaction isolation level repeatable read read only");
    const pointer = await readCurrentCatalogPointer(client);
    if (pointer.kind !== "installed" || !matches(pointer.current)) {
      throw new Error("Catalog release changed before snapshot");
    }
    const queries = createGovernanceCatalogQueries(client);
    for (const organizationId of organizationIds) {
      const items: GovernanceRegistrationRecord[] = [];
      const seenCursors = new Set<string>();
      let cursor: string | undefined;
      do {
        const result = await queries.listRegistrations({
          organizationId,
          observedCatalogReleaseId: expectedPin.id,
          authScope: { organizationId, principalId },
          limit: 100,
          cursor,
        });
        if (!result.ok) throw new Error(`Registration query failed for ${organizationId}: ${JSON.stringify(result.error)}`);
        const page = result.value;
        if (page?.semantics !== GOVERNANCE_CURRENT_PROJECTION_SEMANTICS || !Array.isArray(page.items) ||
            page.items.length > 100 || (page.nextCursor !== null &&
              (typeof page.nextCursor !== "string" || !page.nextCursor))) {
          throw new Error(`Registration response malformed for ${organizationId}`);
        }
        for (const item of page.items) {
          if (!item || typeof item.id !== "string" || !item.id ||
              item.organizationId !== organizationId || item.catalogReleaseId !== expectedPin.id ||
              typeof item.subjectId !== "string" || !item.subjectId ||
              !item.placement || typeof item.placement.id !== "string" || !item.placement.id ||
              !catalogRegistrationDtoSchema.safeParse({
                id: item.id, organizationId: item.organizationId, subjectId: item.subjectId,
                status: item.status, method: item.method,
                placement: {
                  id: item.placement.id, displayName: item.placement.displayName,
                  parentPlacementId: item.placement.parentPlacementId,
                  ...(item.placement.moduleId ? { moduleId: item.placement.moduleId } : {}),
                },
                catalogReleaseId: item.catalogReleaseId,
              }).success || seenRegistrationIds.has(item.id) || seenPlacementIds.has(item.placement.id)) {
            throw new Error(`Registration identity or shape invalid for ${organizationId}`);
          }
          seenRegistrationIds.add(item.id);
          seenPlacementIds.add(item.placement.id);
          items.push(item);
        }
        cursor = page.nextCursor ?? undefined;
        if (cursor && (page.items.length === 0 || seenCursors.has(cursor))) {
          throw new Error(`Registration pagination did not advance for ${organizationId}`);
        }
        if (cursor) seenCursors.add(cursor);
      } while (cursor);
      byOrganization.set(organizationId, items);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  if (!matches(await captureCurrentCatalogPin(pool))) {
    throw new Error("Catalog release changed during comparison read");
  }
  return byOrganization;
}

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

const catalogProjectScope = (auth: AuthContext): UsageProjectScope | null => {
  if (!Array.isArray(auth.roles) || auth.roles.some((binding) => !binding ||
    (binding.projectId !== null && (typeof binding.projectId !== "string" || binding.projectId.length === 0 || binding.projectId.trim() !== binding.projectId || /[\u0000-\u001F\u007F-\u009F]/u.test(binding.projectId))))) return null;
  const eligible = auth.roles.filter((binding) => permissionsForRoles([binding.roleId]).includes("parameter:view"));
  // Match existing parameter policy: explicit null is an organization grant;
  // real admin/platform-admin bindings retain their established global scope.
  if (eligible.some((binding) => binding.projectId === null || binding.roleId === "admin" || binding.roleId === "platform-admin")) return { kind: "all" };
  return { kind: "only", ids: [...new Set(eligible.flatMap((binding) => binding.projectId === null ? [] : [binding.projectId]))] };
};

const catalogScope = (auth: AuthContext): TrustedCatalogScope => {
  const actorKind = catalogActorKind(auth);
  const projectScope = catalogProjectScope(auth);
  return {
    principalId: auth.user.id,
    organizationId: auth.organization.id,
    actorKind,
    canReadCatalog: projectScope !== null && canViewParameters(auth),
    canRegister: actorKind === "org-admin",
    projectScope: projectScope ?? { kind: "only", ids: [] },
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
    trustedActor: createUserInvocation(auth),
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

const publicationScope = (auth: AuthContext): TrustedPublicationScope => ({
  principalId: auth.user.id,
  organizationId: auth.organization.id,
  actorKind: governanceActorKind(auth),
  permissions: auth.permissions,
  trustedActor: createUserInvocation(auth),
});

const authenticatePublication =
  (resolveAuth: CatalogApiAuthResolver) =>
  async (request: CatalogPublicationRequest) => {
    const auth = await resolveAuth(request as RouteRequest);
    if (!auth.user.isActive) {
      return { ok: false as const, status: 401 as const };
    }
    return { ok: true as const, scope: publicationScope(auth) };
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
  db: Database | undefined,
  catalogPublication: CatalogPublicationRuntimeOptions,
): CatalogReadPorts["readiness"] => {
  const runtimeOptions = resolveCatalogPublicationRuntimeOptions(catalogPublication);
  const startupPin = db ? createStartupRuntimePin({ db }) : undefined;
  const current = async (): Promise<CatalogReadinessResult> => {
    const pointer = await readCurrentCatalogPointer(pool);
    if (pointer.kind !== "installed") {
      // An absent pointer alone also describes an interrupted installation.
      // Only a genuinely empty owner projection is an unpublished catalog.
      return await isCatalogProjectionEmpty(pool) ? { status: "unpublished" } : notReady();
    }
    const captured = await captureCurrentCatalogPin(pool);
    if (
      captured === null ||
      captured.id !== pointer.current.id ||
      captured.digest !== pointer.current.digest
    ) {
      return notReady();
    }
    const dual = await evaluateDualFactReadiness(
      pool,
      {
        dataMode: runtimeOptions.dataMode,
        application: runtimeOptions.application,
        readApprovedRuntimePin: startupPin?.readApprovedRuntimePin,
      },
      db,
    );
    if (dual.status === "not-ready") {
      const catalogReasons = dual.reasons.filter((reason) => {
        if (
          reason === "missing-receipt" ||
          reason === "receipt-pin-mismatch" ||
          reason === "artifact-pin-mismatch" ||
          reason === "unsupported-catalog-capability"
        ) {
          return true;
        }
        return (
          runtimeOptions.dataMode === "populated" &&
          (reason === "application-pin-absent" || reason === "application-pin-catalog-mismatch")
        );
      });
      if (catalogReasons.length > 0) {
        return notReady();
      }
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
  subjectKind === "driver" ? "driver-group" : subjectKind === "node-type" ? "node-type" : "business";

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

const createReadPorts = (
  pool: pg.Pool | undefined,
  resolveAuth: CatalogApiAuthResolver,
  db: Database | undefined,
  catalogPublication: CatalogPublicationRuntimeOptions,
): CatalogReadPorts => {
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
  const runtime = createPinCapturingCatalogRuntime(pool, kernel);
  const queries = createGovernanceCatalogQueries(pool);
  const usage = createUsageQueries(pool);
  return {
    runtime,
    readiness: createKernelReadiness(runtime, pool, db, catalogPublication),
    registration: createRegistrationProjectionFromQueries(queries),
    usage: createUsageProjectionFromQueries(usage),
    timeline: kernelOnlyTimelineComposer,
    authenticate: authenticateCatalog(resolveAuth),
  };
};

const createGovernancePorts = (
  pool: pg.Pool | undefined,
  resolveAuth: CatalogApiAuthResolver,
  db?: Database,
  objectStore?: ObjectStore,
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

  const kernel = pool
    ? createPinCapturingCatalogRuntime(pool, createCatalogKernel(pool))
    : undefined;
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
    ...(db
      ? {
          definitionMigration: createParameterCatalogMigrationService({
            db,
            objectStore,
            publication: createReplacementPublicationPorts(db),
          }),
        }
      : {}),    resolveSubjectKind: kernel
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
      ? async ({ organizationId, subjectKind, placement, destinationModuleId }) => {
          if (destinationModuleId !== undefined) {
            const result = await pool.query<{ id: string }>(
              `select id from public.parameter_modules
                where organization_id = $1 and id = $2 and kind = $3`,
              [organizationId, destinationModuleId, expectedModuleKind(subjectKind)],
            );
            return result.rows[0]?.id ?? null;
          }
          if (placement.mode === "choose-parent") {
            return lookupChooseParentDestinationModule(pool, organizationId, placement);
          }
          return lookupDefaultDestinationModule(pool, organizationId, subjectKind);
        }
      : undefined,
    ...(queries ? bindGovernanceCatalogQueryPorts(queries) : unavailableGovernanceQueryPorts),
  };
};

/**
 * Publication ports for the definition identity correction migration.
 *
 * The API process only *enqueues* the publication job through the existing
 * Candidate/Authorization path (CP-07 isolation: release installation belongs
 * to the publication-manager process, ADR-0043 §5).  Activation is therefore
 * left to the manager, and `continue` performs the project advance once the
 * successor release is current and materialized.
 */
const createReplacementPublicationPorts = (
  db: Database,
): ReplacementPublicationPorts => ({
  async enqueueReplacementPublication({ organizationId, candidateId, idempotencyKey, trustedActor }) {
    const enqueued = await enqueuePublicationJob({
      db,
      candidateId,
      idempotencyKey,
      trustedActor,
      requestScope: `organization:${organizationId}:definition-replacement`,
    });
    if (!enqueued.ok) {
      if (enqueued.error.kind === "not-found") {
        return { ok: false as const, error: { kind: "not-found" as const } };
      }
      if (enqueued.error.kind === "idempotency-key-conflict") {
        return {
          ok: false as const,
          error: {
            kind: "revision-conflict" as const,
            idempotencyKey,
            storedFingerprint: "idempotency-key-conflict",
            attemptedFingerprint: "idempotency-key-conflict",
          },
        };
      }
      if (enqueued.error.kind === "authorization") {
        return {
          ok: false as const,
          error: { kind: "preview-unavailable" as const, reason: "unsupported-catalog-capability" },
        };
      }
      return {
        ok: false as const,
        error: { kind: "invalid-command" as const, reason: enqueued.error.reason },
      };
    }
    return {
      ok: true as const,
      value: {
        candidateId: enqueued.value.candidate.id,
        publicationJobId: enqueued.value.job.id,
        authorizationId: enqueued.value.job.authorizationId,
        replayed: enqueued.value.replayed,
      },
    };
  },
  /**
   * Observe activation instead of performing it.  The publication manager owns
   * the install (CP-07 isolation, ADR-0043 §5); the API only reports the
   * activation receipt the manager wrote.  Until that receipt exists the caller
   * keeps the frozen preview and answers a retryable "not ready", so a same-key
   * retry can persist the approved replacement once the successor is current.
   */
  async activateReplacementPublication({ jobId }) {
    const observed = await withPublicationCoordinator(db, (tx) =>
      getJob(tx, PublicationJobId(jobId)),
    );
    if (observed.ok && observed.value.status === "needs-rebase") {
      return { kind: "blocked" as const, jobId, reason: "needs-rebase" };
    }
    const receipt = await withPublicationCoordinator(db, (tx) =>
      getReceiptByJobId(tx, PublicationJobId(jobId)),
    );
    if (!receipt.ok) {
      return { kind: "pending" as const, jobId };
    }
    return {
      kind: "active" as const,
      releaseId: receipt.value.releaseId,
      releaseDigest: receipt.value.releaseDigest,
    };
  },
});

const createPublicationPorts = (
  db: Database | undefined,
  resolveAuth: CatalogApiAuthResolver,
): CatalogPublicationPorts => {
  const pool = getRootPostgresPool(db);
  const commands = db
    ? bindCatalogPublicationCommands({ db, pool })
    : unavailablePublicationCommandPorts;
  return {
    authenticate: authenticatePublication(resolveAuth),
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
  };
};

const createLegacyOptions = (
  db: Database | undefined,
  pool: pg.Pool | undefined,
  resolveAuth: CatalogApiAuthResolver,
  readPorts: CatalogReadPorts,
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
  readCatalog: async (request, path) => {
    const url = new URL(path, "http://localhost");
    return handleCatalogRead(readPorts, {
      method: "GET", path: url.pathname, params: {}, query: Object.fromEntries(url.searchParams),
      headers: request.headers, requestId: request.requestId,
    });
  },
});

export const registerParameterCatalogApi = (
  router: WiseEffRouter,
  options: {
    readonly db?: Database;
    readonly objectStore?: ObjectStore;
    readonly resolveAuth: CatalogApiAuthResolver;
    readonly catalogPublication?: CatalogPublicationRuntimeOptions;
  },
): void => {
  const pool = getRootPostgresPool(options.db);
  const readPorts = createReadPorts(pool, options.resolveAuth, options.db, options.catalogPublication ?? {});
  registerCatalogReadRoutes(router, readPorts);
  registerCatalogGovernanceRoutes(
    router,
    createGovernancePorts(pool, options.resolveAuth, options.db, options.objectStore),
  );
  registerCatalogDriverCompatibleDiscoveryRoute(router, {
    db: options.db, objectStore: options.objectStore, resolveAuth: options.resolveAuth,
  });
  registerCatalogDefinitionReplacementRoutes(
    router,
    createGovernancePorts(pool, options.resolveAuth, options.db, options.objectStore),
  );
  registerCatalogPublicationRoutes(
    router,
    createPublicationPorts(options.db, options.resolveAuth),
  );
  registerCatalogLegacyRoutes(router, createLegacyOptions(options.db, pool, options.resolveAuth, readPorts));
};
