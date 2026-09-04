import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";

import type { AuthContext } from "../auth/types";
import { createCatalogKernel } from "../catalog-kernel/interface";
import {
  handleCatalogGovernance,
  emptyGovernanceQueryPorts,
  type CatalogGovernancePorts,
} from "../parameter-catalog-api/governance";
import {
  handleCatalogRead,
  kernelOnlyTimelineComposer,
  unregisteredProjection,
  zeroUsageProjection,
  type CatalogReadPorts,
} from "../parameter-catalog-api/read";
import { handleLegacyCatalogRequest } from "../parameter-catalog-api/legacy";
import type { LegacyCatalogOptions } from "../parameter-catalog-api/legacy";
import { parameterCatalogCanonicalRoutes } from "../contracts/dtoSchemas/parameterCatalog";
import { routeManifest } from "../contracts/routeManifest";
import type { Database } from "../../shared/database/client";
import { createUserInvocation } from "../auth/trustedInvocation";
import {
  getModuleDiscoveryHints,
  getParameterModuleRegistry,
  listDriverRegistry,
} from "./service";

export const MOD_COMPARISON_CONTRACT_VERSION = "pcat-comparison-contribution/v1";
export const MOD_COMPARISON_FAMILY = "MOD";

export const MOD_COMPARISON_IDS = [
  "PCAT-CMP-D02-SUBJECT-IDENTITY",
  "PCAT-CMP-D03-REGISTRATION-PLACEMENT",
] as const;

export type ModComparisonId = (typeof MOD_COMPARISON_IDS)[number];
export type ModComparisonPhase = "pre-activation" | "post-p13";
export type ModInventoryMode = "fresh" | "populated";
export type ModComparisonResult =
  | "exact-equivalent"
  | "declared-expected-difference"
  | "unexplained-difference"
  | "unqueryable/protected-reference-missing";

export const MOD_UNQUERYABLE_FAILURE_CODE = "PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE";

export type ModProtectedReference = {
  readonly kind: string;
  readonly id: string;
};

export type ModQueryObservation =
  | {
      readonly status: "value";
      readonly value: Readonly<Record<string, unknown>>;
    }
  | {
      readonly status: "query-failure";
      readonly code: string;
      readonly detail: string;
    };

export type ModExpectedDifference = {
  readonly rClass: string;
  readonly mappingHeadId: string;
  readonly mappingHeadVersion: number;
  readonly typedTarget?: { readonly kind: string; readonly id: string };
  readonly Archive?: { readonly id: string };
  readonly ruleId: string;
  readonly planPin: string;
};

export type ModComparisonCase = {
  readonly caseId: string;
  readonly comparisonId: ModComparisonId;
  readonly protectedReference: ModProtectedReference;
  readonly legacyObservation: ModQueryObservation;
  readonly canonicalObservation: ModQueryObservation;
  readonly result: ModComparisonResult;
  readonly expectedDifference: ModExpectedDifference | null;
};

export type ModComparisonContributionInput = {
  readonly database: Database;
  readonly pool: pg.Pool;
  readonly phase: ModComparisonPhase;
  readonly inventoryMode: ModInventoryMode;
  readonly candidateSha: string;
  readonly planPin: string;
  readonly mappingHeadId: string;
  readonly mappingHeadVersion: number;
  readonly mappingHeadChecksum: string;
  readonly catalogSnapshotChecksum: string;
};

export type ModComparisonContribution = {
  readonly contractVersion: typeof MOD_COMPARISON_CONTRACT_VERSION;
  readonly family: typeof MOD_COMPARISON_FAMILY;
  readonly phase: ModComparisonPhase;
  readonly inventoryMode: ModInventoryMode;
  readonly candidateSha: string;
  readonly planPin: string;
  readonly mappingHeadId: string;
  readonly mappingHeadVersion: number;
  readonly mappingHeadChecksum: string;
  readonly catalogSnapshotChecksum: string;
  readonly sourceInventoryCount: number;
  readonly sourceInventoryChecksum: string;
  readonly cases: readonly ModComparisonCase[];
  readonly checksum: string;
};

type InventoryRecord = ModProtectedReference & {
  readonly applicable: readonly ModComparisonId[];
};

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => compareText(left, right))
        .map(([key, nested]) => [key, sortKeys(nested)]),
    );
  }
  return value;
}

export function serializeModComparisonContribution(
  contribution: Omit<ModComparisonContribution, "checksum"> | ModComparisonContribution,
): Buffer {
  const { checksum: _checksum, ...rest } = contribution as ModComparisonContribution;
  void _checksum;
  return Buffer.from(`${JSON.stringify(sortKeys(rest))}\n`, "utf8");
}

export function checksumModComparisonBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function inventoryAuth(organizationId: string): AuthContext {
  return {
    user: {
      id: "mod-comparison-reader",
      organizationId,
      name: "MOD comparison",
      email: "mod-comparison@wiseeff.local",
      title: "comparison",
      isActive: true,
    },
    organization: { id: organizationId, name: organizationId },
    roles: [{ projectId: null, roleId: "platform-admin" }],
    permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
  };
}

async function queryOrganizationIds(database: Database): Promise<readonly string[]> {
  const result = await database.query<{ id: string }>("select id from organizations order by id");
  if (!Array.isArray(result.rows)) {
    throw new Error("MOD inventory organization query did not return rows");
  }
  return result.rows.map((row) => row.id);
}

function catalogPath(routeId: string, params: Record<string, string> = {}): string {
  const route = parameterCatalogCanonicalRoutes.find((entry) => entry.id === routeId);
  if (!route) {
    throw new Error(`Missing catalog route ${routeId}`);
  }
  return route.path.replace(/:([^/]+)/g, (_match, name: string) => {
    const value = params[name];
    if (!value) {
      throw new Error(`Missing path parameter ${name}`);
    }
    return encodeURIComponent(value);
  });
}

function createReadPorts(pool: pg.Pool, organizationId: string): CatalogReadPorts {
  const kernel = createCatalogKernel(pool);
  const scope = {
    principalId: "mod-comparison-reader",
    organizationId,
    actorKind: "platform-admin" as const,
    canReadCatalog: true,
    canRegister: true,
    subjects: { kind: "all" as const },
    definitions: { kind: "all" as const },
  };
  return {
    runtime: kernel,
    readiness: {
      async current() {
        await pool.query("select 1 as ok");
        return { status: "not-ready", retryAfterSeconds: 1 };
      },
      async named() {
        await pool.query("select 1 as ok");
        return { status: "unknown" };
      },
    },
    registration: unregisteredProjection,
    usage: zeroUsageProjection,
    timeline: kernelOnlyTimelineComposer,
    authenticate: async () => ({ ok: true as const, scope }),
  };
}

function createGovernancePorts(organizationId: string): CatalogGovernancePorts {
  return {
    authenticate: async () => ({
      ok: true as const,
      scope: {
        principalId: "mod-comparison-reader",
        organizationId,
        actorKind: "platform-admin" as const,
        canReadGovernance: true,
        canMutateOrganization: true,
        canReviewProposals: true,
        defaultDestinationModuleId: "",
        defaultSubjectKind: "driver" as const,
      },
    }),
    currentRelease: async () => null,
    executeRegistration: async () => ({
      ok: false as const,
      error: { kind: "catalog-drift" as const, code: "PCAT-GUARD-DRIFT" as const, sqlstate: "PCA04" as const },
    }),
    resolveReviewItem: async () => ({
      ok: false as const,
      error: { kind: "review-item-not-found" as const, reviewItemId: "mod-unwired" },
    }),
    executeProposal: async () => ({
      ok: false as const,
      error: {
        kind: "permission-denied" as const,
        actorKind: "platform-admin" as const,
        method: "executeProposal" as const,
      },
    }),
    listReviewQueue: async () => ({
      ok: false as const,
      error: { kind: "permission-denied" as const, actorKind: "anonymous" as const },
    }),
    getReviewItem: async () => ({
      ok: false as const,
      error: { kind: "review-item-not-found" as const, reviewItemId: "mod-unwired" },
    }),
    ...emptyGovernanceQueryPorts,
  };
}

function createLegacyOptions(database: Database, organizationId: string): LegacyCatalogOptions {
  const auth = inventoryAuth(organizationId);
  return {
    catalogReleaseId: "catalog-unready",
    sunsetHttpDate: "Fri, 31 Dec 2027 00:00:00 GMT",
    getQueryable: async () => database as unknown as Awaited<ReturnType<LegacyCatalogOptions["getQueryable"]>>,
    resolveInvocation: async () => createUserInvocation(auth),
  };
}

async function queryModInventory(database: Database): Promise<InventoryRecord[]> {
  const organizations = await queryOrganizationIds(database);
  const byKey = new Map<string, InventoryRecord>();
  const scopes = organizations.length > 0 ? organizations : ["platform"];
  for (const organizationId of scopes) {
    const auth = inventoryAuth(organizationId);
    const registry = await getParameterModuleRegistry(database, auth);
    for (const module of registry.item.modules) {
      byKey.set(`parameter-module:${module.id}`, {
        kind: "parameter-module",
        id: module.id,
        applicable: ["PCAT-CMP-D02-SUBJECT-IDENTITY"],
      });
    }
    for (const mapping of registry.item.mappings) {
      byKey.set(`parameter-module-mapping:${mapping.id}`, {
        kind: "parameter-module-mapping",
        id: mapping.id,
        applicable: ["PCAT-CMP-D03-REGISTRATION-PLACEMENT"],
      });
    }
    const hints = await getModuleDiscoveryHints(database, auth);
    for (const dismissed of hints.item.dismissedCompatibles) {
      byKey.set(`parameter-module-dismissed-compatible:${dismissed.compatible}`, {
        kind: "parameter-module-dismissed-compatible",
        id: dismissed.compatible,
        applicable: ["PCAT-CMP-D03-REGISTRATION-PLACEMENT"],
      });
    }
    const drivers = await listDriverRegistry(database, auth);
    for (const item of drivers.items) {
      byKey.set(`subject-registration:${item.moduleId}`, {
        kind: "subject-registration",
        id: item.moduleId,
        applicable: ["PCAT-CMP-D03-REGISTRATION-PLACEMENT"],
      });
      if (item.defaultBusinessCategoryId) {
        byKey.set(`subject-placement:${item.moduleId}`, {
          kind: "subject-placement",
          id: item.moduleId,
          applicable: ["PCAT-CMP-D03-REGISTRATION-PLACEMENT"],
        });
      }
    }
  }
  return [...byKey.values()];
}

async function observeCanonicalSubjects(
  pool: pg.Pool,
  organizationId: string,
): Promise<ModQueryObservation> {
  const ports = createReadPorts(pool, organizationId);
  const response = await handleCatalogRead(ports, {
    method: "GET",
    path: catalogPath("catalog.listSubjects"),
    params: {},
    query: {},
    headers: {},
    requestId: randomUUID(),
  });
  if (response.status === 200 && response.body && typeof response.body === "object") {
    const body = response.body as { items?: unknown };
    return {
      status: "value",
      value: {
        httpStatus: response.status,
        itemCount: Array.isArray(body.items) ? body.items.length : 0,
      },
    };
  }
  return {
    status: "query-failure",
    code: String(response.status),
    detail: "catalog-read-list-subjects",
  };
}

async function observeCanonicalRegistrations(
  organizationId: string,
): Promise<{ observation: ModQueryObservation; records: InventoryRecord[] }> {
  const ports = createGovernancePorts(organizationId);
  const response = await handleCatalogGovernance(ports, {
    method: "GET",
    path: catalogPath("catalog.listRegistrations", { organizationId }),
    params: { organizationId },
    query: {},
    headers: {},
    requestId: randomUUID(),
    body: undefined,
  });
  if (response.status === 200 && response.body && typeof response.body === "object") {
    const body = response.body as { items?: Array<{ id?: string }> };
    const items = Array.isArray(body.items) ? body.items : [];
    return {
      observation: {
        status: "value",
        value: { httpStatus: response.status, itemCount: items.length },
      },
      records: items
        .filter((item) => typeof item.id === "string")
        .map((item) => ({
          kind: "subject-registration",
          id: item.id as string,
          applicable: ["PCAT-CMP-D03-REGISTRATION-PLACEMENT"] as const,
        })),
    };
  }
  return {
    observation: {
      status: "query-failure",
      code: String(response.status),
      detail: "catalog-governance-list-registrations",
    },
    records: [],
  };
}

function fillLegacyPath(path: string, identity: string): string {
  return path
    .replace(":moduleId", encodeURIComponent(identity))
    .replace(":mappingId", encodeURIComponent(identity))
    .replace(":compatible", encodeURIComponent(identity));
}

async function observeLegacyHttp(
  database: Database,
  organizationId: string,
  comparisonId: ModComparisonId,
  reference: ModProtectedReference,
): Promise<ModQueryObservation> {
  const route = routeManifest.find((entry) => {
    if (!entry.id.startsWith("parameterModules.")) {
      return false;
    }
    if (comparisonId === "PCAT-CMP-D02-SUBJECT-IDENTITY") {
      return entry.id === "parameterModules.getRegistry";
    }
    if (reference.kind === "subject-registration" || reference.kind === "subject-placement") {
      return entry.id === "parameterModules.listDriverRegistry" || entry.id === "parameterModules.registerDriver";
    }
    if (reference.kind === "parameter-module-mapping") {
      return entry.id === "parameterModules.createMapping";
    }
    if (reference.kind === "parameter-module-dismissed-compatible") {
      return entry.id === "parameterModules.dismissCompatible";
    }
    return entry.id === "parameterModules.getRegistry";
  });
  if (!route) {
    return { status: "query-failure", code: MOD_UNQUERYABLE_FAILURE_CODE, detail: "legacy-route-missing" };
  }
  const result = await handleLegacyCatalogRequest(
    {
      method: route.method,
      path: fillLegacyPath(route.path, reference.id),
      params: {},
      query: comparisonId === "PCAT-CMP-D02-SUBJECT-IDENTITY" ? { id: reference.id } : {},
      headers: {},
      requestId: randomUUID(),
      body: {},
    },
    createLegacyOptions(database, organizationId),
  );
  return {
    status: "value",
    value: {
      httpStatus: result.status,
      retired: result.status === 410,
    },
  };
}

async function observeLegacyModule(
  database: Database,
  organizationId: string,
  moduleId: string,
): Promise<ModQueryObservation> {
  const listed = await getParameterModuleRegistry(database, inventoryAuth(organizationId));
  const item = listed.item.modules.find((row) => row.id === moduleId);
  if (!item) {
    return {
      status: "query-failure",
      code: MOD_UNQUERYABLE_FAILURE_CODE,
      detail: "legacy-module-missing",
    };
  }
  return {
    status: "value",
    value: {
      id: item.id,
      kind: item.kind,
      origin: item.origin,
      parentId: item.parentId,
      attributionSubjectId: item.attributionSubjectId,
      sourceKey: item.sourceKey,
    },
  };
}

function classifyCase(input: {
  readonly comparisonId: ModComparisonId;
  readonly legacyObservation: ModQueryObservation;
  readonly canonicalObservation: ModQueryObservation;
  readonly mappingHeadId: string;
  readonly mappingHeadVersion: number;
  readonly planPin: string;
}): { result: ModComparisonResult; expectedDifference: ModExpectedDifference | null } {
  if (
    input.legacyObservation.status === "query-failure" &&
    input.legacyObservation.code === MOD_UNQUERYABLE_FAILURE_CODE
  ) {
    return { result: "unqueryable/protected-reference-missing", expectedDifference: null };
  }
  if (
    input.canonicalObservation.status === "query-failure" &&
    input.canonicalObservation.code === MOD_UNQUERYABLE_FAILURE_CODE
  ) {
    return { result: "unqueryable/protected-reference-missing", expectedDifference: null };
  }

  if (
    input.legacyObservation.status === "value" &&
    input.canonicalObservation.status === "value" &&
    JSON.stringify(sortKeys(input.legacyObservation.value)) ===
      JSON.stringify(sortKeys(input.canonicalObservation.value))
  ) {
    return { result: "exact-equivalent", expectedDifference: null };
  }

  const expectedDifference: ModExpectedDifference = {
    rClass: "R9",
    mappingHeadId: input.mappingHeadId,
    mappingHeadVersion: input.mappingHeadVersion,
    typedTarget: {
      kind:
        input.comparisonId === "PCAT-CMP-D02-SUBJECT-IDENTITY"
          ? "catalog-subject"
          : "subject-placement",
      id: input.mappingHeadId,
    },
    ruleId: input.comparisonId,
    planPin: input.planPin,
  };
  return { result: "declared-expected-difference", expectedDifference };
}

function sortInventory(records: InventoryRecord[]): InventoryRecord[] {
  return [...records].sort(
    (left, right) =>
      compareText(left.kind, right.kind) ||
      compareText(left.id, right.id) ||
      compareText(left.applicable.join("\0"), right.applicable.join("\0")),
  );
}

function sortCases(cases: ModComparisonCase[]): ModComparisonCase[] {
  return [...cases].sort(
    (left, right) =>
      compareText(MOD_COMPARISON_FAMILY, MOD_COMPARISON_FAMILY) ||
      compareText(left.comparisonId, right.comparisonId) ||
      compareText(left.protectedReference.kind, right.protectedReference.kind) ||
      compareText(left.protectedReference.id, right.protectedReference.id) ||
      compareText(left.caseId, right.caseId),
  );
}

/**
 * Production MOD comparison contribution. Queries real PostgreSQL through
 * S4-REG / S8-LEG and the module-registry consumer inventory.
 */
export async function provideModParameterCatalogComparisonContribution(
  input: ModComparisonContributionInput,
): Promise<ModComparisonContribution> {
  if (input.phase !== "pre-activation" && input.phase !== "post-p13") {
    throw new Error("MOD comparison phase must be pre-activation or post-p13");
  }
  if (input.inventoryMode !== "fresh" && input.inventoryMode !== "populated") {
    throw new Error("MOD comparison inventoryMode must be fresh or populated");
  }
  if (!/^[a-f0-9]{40}$/u.test(input.candidateSha)) {
    throw new Error("MOD comparison candidateSha must be a full Git SHA");
  }

  const organizations = await queryOrganizationIds(input.database);
  const organizationId = organizations[0] ?? "platform";
  const moduleRecords = await queryModInventory(input.database);
  const canonicalSubjects = await observeCanonicalSubjects(input.pool, organizationId);
  const canonicalRegistrations = await observeCanonicalRegistrations(organizationId);

  const inventory = sortInventory([...moduleRecords, ...canonicalRegistrations.records]);

  if (input.inventoryMode === "fresh" && inventory.length !== 0) {
    throw new Error(
      `MOD fresh inventory must be empty after a real PostgreSQL query; received ${inventory.length} records`,
    );
  }

  const cases: ModComparisonCase[] = [];
  for (const record of inventory) {
    const protectedReference = { kind: record.kind, id: record.id };
    for (const comparisonId of record.applicable) {
      if (
        comparisonId !== "PCAT-CMP-D02-SUBJECT-IDENTITY" &&
        comparisonId !== "PCAT-CMP-D03-REGISTRATION-PLACEMENT"
      ) {
        throw new Error(`MOD comparison rejected unknown comparison ID ${comparisonId}`);
      }
      const legacyObservation =
        record.kind === "parameter-module"
          ? await observeLegacyModule(input.database, organizationId, record.id)
          : await observeLegacyHttp(input.database, organizationId, comparisonId, protectedReference);
      const canonicalObservation =
        comparisonId === "PCAT-CMP-D02-SUBJECT-IDENTITY"
          ? canonicalSubjects
          : canonicalRegistrations.observation;

      const classified = classifyCase({
        comparisonId,
        legacyObservation,
        canonicalObservation,
        mappingHeadId: input.mappingHeadId,
        mappingHeadVersion: input.mappingHeadVersion,
        planPin: input.planPin,
      });

      cases.push({
        caseId: `${MOD_COMPARISON_FAMILY}:${comparisonId}:${record.kind}:${record.id}`,
        comparisonId,
        protectedReference,
        legacyObservation,
        canonicalObservation,
        result: classified.result,
        expectedDifference: classified.expectedDifference,
      });
    }
  }

  const sortedCases = sortCases(cases);
  const inventoryBytes = Buffer.from(`${JSON.stringify(sortKeys(inventory))}\n`, "utf8");
  const sourceInventoryChecksum = checksumModComparisonBytes(inventoryBytes);
  const unsigned: Omit<ModComparisonContribution, "checksum"> = {
    contractVersion: MOD_COMPARISON_CONTRACT_VERSION,
    family: MOD_COMPARISON_FAMILY,
    phase: input.phase,
    inventoryMode: input.inventoryMode,
    candidateSha: input.candidateSha,
    planPin: input.planPin,
    mappingHeadId: input.mappingHeadId,
    mappingHeadVersion: input.mappingHeadVersion,
    mappingHeadChecksum: input.mappingHeadChecksum,
    catalogSnapshotChecksum: input.catalogSnapshotChecksum,
    sourceInventoryCount: inventory.length,
    sourceInventoryChecksum,
    cases: sortedCases,
  };
  const bytes = serializeModComparisonContribution(unsigned);
  return {
    ...unsigned,
    checksum: checksumModComparisonBytes(bytes),
  };
}
