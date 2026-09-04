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
import { listParameterSpecs, listSpecReviewTasks } from "./service";

export const CGH_COMPARISON_CONTRACT_VERSION = "pcat-comparison-contribution/v1";
export const CGH_COMPARISON_FAMILY = "CGH";

export const CGH_COMPARISON_IDS = [
  "PCAT-CMP-D01-DEFINITION-SEMANTICS",
  "PCAT-CMP-D03-REGISTRATION-PLACEMENT",
  "PCAT-CMP-D06-REVIEW-PROPOSAL-OBSERVATION",
  "PCAT-CMP-D09-LEGACY-OPERATOR-OUTCOME",
] as const;

export type CghComparisonId = (typeof CGH_COMPARISON_IDS)[number];
export type CghComparisonPhase = "pre-activation" | "post-p13";
export type CghInventoryMode = "fresh" | "populated";
export type CghComparisonResult =
  | "exact-equivalent"
  | "declared-expected-difference"
  | "unexplained-difference"
  | "unqueryable/protected-reference-missing";

export const CGH_UNQUERYABLE_FAILURE_CODE = "PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE";

export type CghProtectedReference = {
  readonly kind: string;
  readonly id: string;
};

export type CghQueryObservation =
  | {
      readonly status: "value";
      readonly value: Readonly<Record<string, unknown>>;
    }
  | {
      readonly status: "query-failure";
      readonly code: string;
      readonly detail: string;
    };

export type CghExpectedDifference = {
  readonly rClass: string;
  readonly mappingHeadId: string;
  readonly mappingHeadVersion: number;
  readonly typedTarget?: { readonly kind: string; readonly id: string };
  readonly Archive?: { readonly id: string };
  readonly ruleId: string;
  readonly planPin: string;
};

export type CghComparisonCase = {
  readonly caseId: string;
  readonly comparisonId: CghComparisonId;
  readonly protectedReference: CghProtectedReference;
  readonly legacyObservation: CghQueryObservation;
  readonly canonicalObservation: CghQueryObservation;
  readonly result: CghComparisonResult;
  readonly expectedDifference: CghExpectedDifference | null;
};

export type CghComparisonContributionInput = {
  readonly database: Database;
  readonly pool: pg.Pool;
  readonly phase: CghComparisonPhase;
  readonly inventoryMode: CghInventoryMode;
  readonly candidateSha: string;
  readonly planPin: string;
  readonly mappingHeadId: string;
  readonly mappingHeadVersion: number;
  readonly mappingHeadChecksum: string;
  readonly catalogSnapshotChecksum: string;
};

export type CghComparisonContribution = {
  readonly contractVersion: typeof CGH_COMPARISON_CONTRACT_VERSION;
  readonly family: typeof CGH_COMPARISON_FAMILY;
  readonly phase: CghComparisonPhase;
  readonly inventoryMode: CghInventoryMode;
  readonly candidateSha: string;
  readonly planPin: string;
  readonly mappingHeadId: string;
  readonly mappingHeadVersion: number;
  readonly mappingHeadChecksum: string;
  readonly catalogSnapshotChecksum: string;
  readonly sourceInventoryCount: number;
  readonly sourceInventoryChecksum: string;
  readonly cases: readonly CghComparisonCase[];
  readonly checksum: string;
};

type InventoryRecord = CghProtectedReference & {
  readonly applicable: readonly CghComparisonId[];
};

const SPEC_FAMILY_PREFIX = "parameterSpecs.";

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

export function serializeCghComparisonContribution(
  contribution: Omit<CghComparisonContribution, "checksum"> | CghComparisonContribution,
): Buffer {
  const { checksum: _checksum, ...rest } = contribution as CghComparisonContribution;
  void _checksum;
  return Buffer.from(`${JSON.stringify(sortKeys(rest))}\n`, "utf8");
}

export function checksumCghComparisonBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function inventoryAuth(organizationId: string): AuthContext {
  return {
    user: {
      id: "cgh-comparison-reader",
      organizationId,
      name: "CGH comparison",
      email: "cgh-comparison@wiseeff.local",
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
    throw new Error("CGH inventory organization query did not return rows");
  }
  return result.rows.map((row) => row.id);
}

async function querySpecInventory(database: Database): Promise<InventoryRecord[]> {
  const organizations = await queryOrganizationIds(database);
  const byId = new Map<string, InventoryRecord>();
  const scopes = organizations.length > 0 ? organizations : ["platform"];
  for (const organizationId of scopes) {
    const listed = await listParameterSpecs(database, inventoryAuth(organizationId), {});
    for (const item of listed.items) {
      byId.set(item.id, {
        kind: "parameter-definition-spec",
        id: item.id,
        applicable: ["PCAT-CMP-D01-DEFINITION-SEMANTICS", "PCAT-CMP-D09-LEGACY-OPERATOR-OUTCOME"],
      });
    }
  }
  return [...byId.values()];
}

async function queryReviewTaskInventory(database: Database): Promise<InventoryRecord[]> {
  const organizations = await queryOrganizationIds(database);
  const byId = new Map<string, InventoryRecord>();
  for (const organizationId of organizations) {
    let cursor: string | undefined;
    for (;;) {
      const page = await listSpecReviewTasks(database, inventoryAuth(organizationId), {
        limit: 100,
        cursor,
      });
      for (const item of page.items) {
        byId.set(item.id, {
          kind: "review-proposal-observation",
          id: item.id,
          applicable: ["PCAT-CMP-D06-REVIEW-PROPOSAL-OBSERVATION", "PCAT-CMP-D09-LEGACY-OPERATOR-OUTCOME"],
        });
      }
      if (!page.nextCursor) {
        break;
      }
      cursor = page.nextCursor;
    }
  }
  return [...byId.values()];
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
    principalId: "cgh-comparison-reader",
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
        principalId: "cgh-comparison-reader",
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
      error: { kind: "review-item-not-found" as const, reviewItemId: "cgh-unwired" },
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
      error: { kind: "review-item-not-found" as const, reviewItemId: "cgh-unwired" },
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

async function observeCanonicalDefinitions(
  pool: pg.Pool,
  organizationId: string,
): Promise<CghQueryObservation> {
  const ports = createReadPorts(pool, organizationId);
  const response = await handleCatalogRead(ports, {
    method: "GET",
    path: catalogPath("catalog.listDefinitions"),
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
    detail: "catalog-read-list-definitions",
  };
}

async function observeCanonicalRegistrations(
  organizationId: string,
): Promise<{ observation: CghQueryObservation; records: InventoryRecord[] }> {
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

async function observeCanonicalReviewItems(
  organizationId: string,
): Promise<{ observation: CghQueryObservation; records: InventoryRecord[] }> {
  const ports = createGovernancePorts(organizationId);
  const response = await handleCatalogGovernance(ports, {
    method: "GET",
    path: catalogPath("catalog.listReviewItems", { organizationId }),
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
          kind: "review-proposal-observation",
          id: item.id as string,
          applicable: ["PCAT-CMP-D06-REVIEW-PROPOSAL-OBSERVATION"] as const,
        })),
    };
  }
  return {
    observation: {
      status: "query-failure",
      code: String(response.status),
      detail: "catalog-governance-list-review-items",
    },
    records: [],
  };
}

function fillLegacyPath(path: string, identity: string): string {
  return path
    .replace(":specId", encodeURIComponent(identity))
    .replace(":taskId", encodeURIComponent(identity))
    .replace(":schemaId", encodeURIComponent(identity))
    .replace(":promotionId", encodeURIComponent(identity));
}

async function observeLegacyHttp(
  database: Database,
  organizationId: string,
  comparisonId: CghComparisonId,
  reference: CghProtectedReference,
): Promise<CghQueryObservation> {
  const route = routeManifest.find((entry) => {
    if (!entry.id.startsWith(SPEC_FAMILY_PREFIX)) {
      return false;
    }
    if (comparisonId === "PCAT-CMP-D09-LEGACY-OPERATOR-OUTCOME" && reference.kind === "parameter-definition-spec") {
      return entry.id === "parameterSpecs.get" || entry.id === "parameterSpecs.create";
    }
    if (reference.kind === "review-proposal-observation") {
      return entry.id === "parameterSpecs.listReviewTasks";
    }
    return entry.id === "parameterSpecs.list";
  });
  if (!route) {
    return { status: "query-failure", code: CGH_UNQUERYABLE_FAILURE_CODE, detail: "legacy-route-missing" };
  }
  const result = await handleLegacyCatalogRequest(
    {
      method: route.method,
      path: fillLegacyPath(route.path, reference.id),
      params: {},
      query: {},
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

async function observeLegacySpec(
  database: Database,
  organizationId: string,
  specId: string,
): Promise<CghQueryObservation> {
  const listed = await listParameterSpecs(database, inventoryAuth(organizationId), {});
  const item = listed.items.find((row) => row.id === specId);
  if (!item) {
    return {
      status: "query-failure",
      code: CGH_UNQUERYABLE_FAILURE_CODE,
      detail: "legacy-spec-missing",
    };
  }
  return {
    status: "value",
    value: {
      id: item.id,
      lifecycle: item.lifecycle,
      propertyKey: item.propertyKey,
      specificationKey: item.specificationKey,
      organizationId: item.organizationId ?? null,
      currentVersion: item.currentVersion,
      sourceKind: item.sourceKind,
    },
  };
}

function classifyCase(input: {
  readonly comparisonId: CghComparisonId;
  readonly legacyObservation: CghQueryObservation;
  readonly canonicalObservation: CghQueryObservation;
  readonly mappingHeadId: string;
  readonly mappingHeadVersion: number;
  readonly planPin: string;
}): { result: CghComparisonResult; expectedDifference: CghExpectedDifference | null } {
  if (
    input.legacyObservation.status === "query-failure" &&
    input.legacyObservation.code === CGH_UNQUERYABLE_FAILURE_CODE
  ) {
    return { result: "unqueryable/protected-reference-missing", expectedDifference: null };
  }
  if (
    input.canonicalObservation.status === "query-failure" &&
    input.canonicalObservation.code === CGH_UNQUERYABLE_FAILURE_CODE
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

  const expectedDifference: CghExpectedDifference = {
    rClass: input.comparisonId === "PCAT-CMP-D09-LEGACY-OPERATOR-OUTCOME" ? "R1" : "R9",
    mappingHeadId: input.mappingHeadId,
    mappingHeadVersion: input.mappingHeadVersion,
    ...(input.comparisonId === "PCAT-CMP-D09-LEGACY-OPERATOR-OUTCOME"
      ? { Archive: { id: input.mappingHeadId } }
      : { typedTarget: { kind: "parameter-definition", id: input.mappingHeadId } }),
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

function sortCases(cases: CghComparisonCase[]): CghComparisonCase[] {
  return [...cases].sort(
    (left, right) =>
      compareText(CGH_COMPARISON_FAMILY, CGH_COMPARISON_FAMILY) ||
      compareText(left.comparisonId, right.comparisonId) ||
      compareText(left.protectedReference.kind, right.protectedReference.kind) ||
      compareText(left.protectedReference.id, right.protectedReference.id) ||
      compareText(left.caseId, right.caseId),
  );
}

/**
 * Production CGH comparison contribution. Queries real PostgreSQL through
 * S8-READ / S8-GOV / S8-LEG and the Catalog/governance HTTP consumer inventory.
 */
export async function provideCghParameterCatalogComparisonContribution(
  input: CghComparisonContributionInput,
): Promise<CghComparisonContribution> {
  if (input.phase !== "pre-activation" && input.phase !== "post-p13") {
    throw new Error("CGH comparison phase must be pre-activation or post-p13");
  }
  if (input.inventoryMode !== "fresh" && input.inventoryMode !== "populated") {
    throw new Error("CGH comparison inventoryMode must be fresh or populated");
  }
  if (!/^[a-f0-9]{40}$/u.test(input.candidateSha)) {
    throw new Error("CGH comparison candidateSha must be a full Git SHA");
  }

  const specRecords = await querySpecInventory(input.database);
  const reviewRecords = await queryReviewTaskInventory(input.database);
  const organizations = await queryOrganizationIds(input.database);
  const organizationId = organizations[0] ?? "platform";

  const canonicalDefinitions = await observeCanonicalDefinitions(input.pool, organizationId);
  const canonicalRegistrations = await observeCanonicalRegistrations(organizationId);
  const canonicalReviews = await observeCanonicalReviewItems(organizationId);

  const inventory = sortInventory([
    ...specRecords,
    ...reviewRecords,
    ...canonicalRegistrations.records,
    ...canonicalReviews.records,
  ]);

  if (input.inventoryMode === "fresh" && inventory.length !== 0) {
    throw new Error(
      `CGH fresh inventory must be empty after a real PostgreSQL query; received ${inventory.length} records`,
    );
  }

  const cases: CghComparisonCase[] = [];
  for (const record of inventory) {
    const protectedReference = { kind: record.kind, id: record.id };
    for (const comparisonId of record.applicable) {
      if (
        comparisonId !== "PCAT-CMP-D01-DEFINITION-SEMANTICS" &&
        comparisonId !== "PCAT-CMP-D03-REGISTRATION-PLACEMENT" &&
        comparisonId !== "PCAT-CMP-D06-REVIEW-PROPOSAL-OBSERVATION" &&
        comparisonId !== "PCAT-CMP-D09-LEGACY-OPERATOR-OUTCOME"
      ) {
        throw new Error(`CGH comparison rejected unknown comparison ID ${String(comparisonId)}`);
      }
      const legacyObservation =
        comparisonId === "PCAT-CMP-D09-LEGACY-OPERATOR-OUTCOME"
          ? await observeLegacyHttp(input.database, organizationId, comparisonId, protectedReference)
          : record.kind === "parameter-definition-spec"
            ? await observeLegacySpec(input.database, organizationId, record.id)
            : {
                status: "value" as const,
                value: { id: record.id, kind: record.kind },
              };
      const canonicalObservation =
        comparisonId === "PCAT-CMP-D01-DEFINITION-SEMANTICS"
          ? canonicalDefinitions
          : comparisonId === "PCAT-CMP-D03-REGISTRATION-PLACEMENT"
            ? canonicalRegistrations.observation
            : comparisonId === "PCAT-CMP-D06-REVIEW-PROPOSAL-OBSERVATION"
              ? canonicalReviews.observation
              : await observeLegacyHttp(input.database, organizationId, comparisonId, protectedReference);

      const classified = classifyCase({
        comparisonId,
        legacyObservation,
        canonicalObservation,
        mappingHeadId: input.mappingHeadId,
        mappingHeadVersion: input.mappingHeadVersion,
        planPin: input.planPin,
      });

      cases.push({
        caseId: `${CGH_COMPARISON_FAMILY}:${comparisonId}:${record.kind}:${record.id}`,
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
  const sourceInventoryChecksum = checksumCghComparisonBytes(inventoryBytes);
  const unsigned: Omit<CghComparisonContribution, "checksum"> = {
    contractVersion: CGH_COMPARISON_CONTRACT_VERSION,
    family: CGH_COMPARISON_FAMILY,
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
  const bytes = serializeCghComparisonContribution(unsigned);
  return {
    ...unsigned,
    checksum: checksumCghComparisonBytes(bytes),
  };
}
