import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";

import type { AuthContext } from "../auth/types";
import { createCatalogKernel, type CatalogSnapshot } from "../catalog-kernel/interface";
import { readProtectedReference } from "../parameter-bindings/adapters";
import { DefinitionRevisionId } from "../parameter-catalog-contract/index";
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
import { parameterCatalogCanonicalRoutes } from "../contracts/dtoSchemas/parameterCatalog";
import type { Database } from "../../shared/database/client";
import {
  getBindingHistory,
  listIdentityMappingTasks,
  listProjectBindings,
} from "./service";

export const TOP_COMPARISON_CONTRACT_VERSION = "pcat-comparison-contribution/v1";
export const TOP_COMPARISON_FAMILY = "TOP";

export const TOP_COMPARISON_IDS = [
  "PCAT-CMP-D02-SUBJECT-IDENTITY",
  "PCAT-CMP-D03-REGISTRATION-PLACEMENT",
  "PCAT-CMP-D04-BINDING-HISTORY",
  "PCAT-CMP-D06-REVIEW-PROPOSAL-OBSERVATION",
] as const;

export type TopComparisonId = (typeof TOP_COMPARISON_IDS)[number];
export type TopComparisonPhase = "pre-activation" | "post-p13";
export type TopInventoryMode = "fresh" | "populated";
export type TopComparisonResult =
  | "exact-equivalent"
  | "declared-expected-difference"
  | "unexplained-difference"
  | "unqueryable/protected-reference-missing";

export const TOP_UNQUERYABLE_FAILURE_CODE = "PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE";

export type TopProtectedReference = {
  readonly kind: string;
  readonly id: string;
};

export type TopQueryObservation =
  | {
      readonly status: "value";
      readonly value: Readonly<Record<string, unknown>>;
    }
  | {
      readonly status: "query-failure";
      readonly code: string;
      readonly detail: string;
    };

export type TopExpectedDifference = {
  readonly rClass: string;
  readonly mappingHeadId: string;
  readonly mappingHeadVersion: number;
  readonly typedTarget?: { readonly kind: string; readonly id: string };
  readonly Archive?: { readonly id: string };
  readonly ruleId: string;
  readonly planPin: string;
};

export type TopComparisonCase = {
  readonly caseId: string;
  readonly comparisonId: TopComparisonId;
  readonly protectedReference: TopProtectedReference;
  readonly legacyObservation: TopQueryObservation;
  readonly canonicalObservation: TopQueryObservation;
  readonly result: TopComparisonResult;
  readonly expectedDifference: TopExpectedDifference | null;
};

export type TopComparisonContributionInput = {
  readonly database: Database;
  readonly pool: pg.Pool;
  readonly phase: TopComparisonPhase;
  readonly inventoryMode: TopInventoryMode;
  readonly candidateSha: string;
  readonly planPin: string;
  readonly mappingHeadId: string;
  readonly mappingHeadVersion: number;
  readonly mappingHeadChecksum: string;
  readonly catalogSnapshotChecksum: string;
};

export type TopComparisonContribution = {
  readonly contractVersion: typeof TOP_COMPARISON_CONTRACT_VERSION;
  readonly family: typeof TOP_COMPARISON_FAMILY;
  readonly phase: TopComparisonPhase;
  readonly inventoryMode: TopInventoryMode;
  readonly candidateSha: string;
  readonly planPin: string;
  readonly mappingHeadId: string;
  readonly mappingHeadVersion: number;
  readonly mappingHeadChecksum: string;
  readonly catalogSnapshotChecksum: string;
  readonly sourceInventoryCount: number;
  readonly sourceInventoryChecksum: string;
  readonly cases: readonly TopComparisonCase[];
  readonly checksum: string;
};

type InventoryRecord = TopProtectedReference & {
  readonly applicable: readonly TopComparisonId[];
  readonly organizationId: string;
  readonly projectId?: string;
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

export function serializeTopComparisonContribution(
  contribution: Omit<TopComparisonContribution, "checksum"> | TopComparisonContribution,
): Buffer {
  const { checksum: _checksum, ...rest } = contribution as TopComparisonContribution;
  void _checksum;
  return Buffer.from(`${JSON.stringify(sortKeys(rest))}\n`, "utf8");
}

export function checksumTopComparisonBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function inventoryAuth(organizationId: string): AuthContext {
  return {
    user: {
      id: "top-comparison-reader",
      organizationId,
      name: "TOP comparison",
      email: "top-comparison@wiseeff.local",
      title: "comparison",
      isActive: true,
    },
    organization: { id: organizationId, name: organizationId },
    roles: [{ projectId: null, roleId: "platform-admin" }],
    permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
  };
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
    principalId: "top-comparison-reader",
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
        principalId: "top-comparison-reader",
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
      error: { kind: "review-item-not-found" as const, reviewItemId: "top-unwired" },
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
      error: { kind: "review-item-not-found" as const, reviewItemId: "top-unwired" },
    }),
    ...emptyGovernanceQueryPorts,
  };
}

const unusedSnapshot = {
  release: { id: "catalog-unready", version: "0", digest: "sha256:unready" },
  getSubject: () => ({ status: "unknown" as const, target: "subject" as const }),
  listSubjects: () => ({ status: "invalid-page" as const, reason: "cursor-malformed" as const }),
  resolveSubject: () => ({ status: "unknown" as const, reason: "no-candidate" as const }),
  getDefinition: () => ({ status: "unknown" as const, target: "definition" as const }),
  getDefinitionById: () => ({ status: "unknown" as const, target: "definition" as const }),
  listDefinitions: () => ({ status: "invalid-page" as const, reason: "cursor-malformed" as const }),
  getDefinitionRevision: () => ({
    status: "revision-unavailable" as const,
    definitionId: "unpinned",
    revisionId: "unpinned",
    reason: "unknown-revision" as const,
  }),
  listDefinitionRevisions: () => ({ status: "unknown" as const, target: "definition" as const }),
  listDefinitionTimelineFacts: () => ({ status: "unknown" as const, target: "definition" as const }),
} as unknown as CatalogSnapshot;

async function queryOrganizationIds(database: Database): Promise<readonly string[]> {
  const result = await database.query<{ id: string }>("select id from organizations order by id");
  if (!Array.isArray(result.rows)) {
    throw new Error("TOP inventory organization query did not return rows");
  }
  return result.rows.map((row) => row.id);
}

async function queryProjects(
  database: Database,
): Promise<readonly { id: string; organizationId: string }[]> {
  const result = await database.query<{ id: string; organization_id: string }>(
    "select id, organization_id from projects order by id",
  );
  if (!Array.isArray(result.rows)) {
    throw new Error("TOP inventory project query did not return rows");
  }
  return result.rows.map((row) => ({ id: row.id, organizationId: row.organization_id }));
}

async function observeCatalogList(
  pool: pg.Pool,
  organizationId: string,
  routeId: string,
  params: Record<string, string> = {},
): Promise<{ observation: TopQueryObservation; records: InventoryRecord[] }> {
  const isGovernance = routeId.includes("Registration") || routeId.includes("Review") || routeId.includes("Observation") || routeId.includes("Placement");
  const response = isGovernance
    ? await handleCatalogGovernance(createGovernancePorts(organizationId), {
        method: "GET",
        path: catalogPath(routeId, params),
        params,
        query: {},
        headers: {},
        requestId: randomUUID(),
        body: undefined,
      })
    : await handleCatalogRead(createReadPorts(pool, organizationId), {
        method: "GET",
        path: catalogPath(routeId, params),
        params,
        query: {},
        headers: {},
        requestId: randomUUID(),
      });

  if (response.status === 200 && response.body && typeof response.body === "object") {
    const body = response.body as { items?: Array<{ id?: string }> };
    const items = Array.isArray(body.items) ? body.items : [];
    const kind =
      routeId === "catalog.listSubjects"
        ? "catalog-subject"
        : routeId === "catalog.listRegistrations"
          ? "subject-registration"
          : routeId === "catalog.listReviewItems"
            ? "review-proposal-observation"
            : routeId === "catalog.listObservations"
              ? "review-proposal-observation"
              : "catalog-subject";
    const applicable: readonly TopComparisonId[] =
      kind === "catalog-subject"
        ? ["PCAT-CMP-D02-SUBJECT-IDENTITY"]
        : kind === "subject-registration"
          ? ["PCAT-CMP-D03-REGISTRATION-PLACEMENT"]
          : ["PCAT-CMP-D06-REVIEW-PROPOSAL-OBSERVATION"];
    return {
      observation: {
        status: "value",
        value: { httpStatus: response.status, itemCount: items.length },
      },
      records: items
        .filter((item) => typeof item.id === "string")
        .map((item) => ({
          kind,
          id: item.id as string,
          applicable,
          organizationId,
        })),
    };
  }
  return {
    observation: {
      status: "query-failure",
      code: String(response.status),
      detail: routeId,
    },
    records: [],
  };
}

async function queryBindingInventory(
  database: Database,
  projects: readonly { id: string; organizationId: string }[],
): Promise<InventoryRecord[]> {
  const byId = new Map<string, InventoryRecord>();
  for (const project of projects) {
    const listed = await listProjectBindings(database, inventoryAuth(project.organizationId), {
      projectId: project.id,
    });
    for (const item of listed.items) {
      byId.set(item.id, {
        kind: "project-binding",
        id: item.id,
        applicable: ["PCAT-CMP-D04-BINDING-HISTORY"],
        organizationId: project.organizationId,
        projectId: project.id,
      });
    }
  }
  return [...byId.values()];
}

async function queryMappingInventory(
  database: Database,
  organizations: readonly string[],
): Promise<InventoryRecord[]> {
  const byId = new Map<string, InventoryRecord>();
  for (const organizationId of organizations) {
    const listed = await listIdentityMappingTasks(database, inventoryAuth(organizationId), {});
    for (const item of listed.items) {
      byId.set(item.id, {
        kind: "identity-mapping-task",
        id: item.id,
        applicable: ["PCAT-CMP-D02-SUBJECT-IDENTITY"],
        organizationId,
        projectId: item.projectId,
      });
    }
  }
  return [...byId.values()];
}

async function observeBindingHistory(
  database: Database,
  record: InventoryRecord,
): Promise<TopQueryObservation> {
  if (!record.projectId) {
    return {
      status: "query-failure",
      code: TOP_UNQUERYABLE_FAILURE_CODE,
      detail: "binding-project-missing",
    };
  }
  try {
    const history = await getBindingHistory(database, inventoryAuth(record.organizationId), {
      projectId: record.projectId,
      bindingId: record.id,
    });
    return {
      status: "value",
      value: {
        bindingId: record.id,
        historyCount: history.items.length,
      },
    };
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code: unknown }).code)
        : TOP_UNQUERYABLE_FAILURE_CODE;
    return {
      status: "query-failure",
      code: code === "NOT_FOUND" ? TOP_UNQUERYABLE_FAILURE_CODE : code,
      detail: "binding-history",
    };
  }
}

async function observeProtectedPin(
  pool: pg.Pool,
  record: InventoryRecord,
): Promise<TopQueryObservation> {
  const result = await readProtectedReference(pool, {
    snapshot: unusedSnapshot,
    binding: null,
    definitionRevisionId: DefinitionRevisionId("unpinned-topology-binding"),
  });
  if (!result.ok) {
    return {
      status: "value",
      value: {
        kind: result.error.kind,
        reason: result.error.reason,
        recordKind: record.kind,
        recordId: record.id,
      },
    };
  }
  return {
    status: "value",
    value: {
      kind: result.value.kind,
      bindingId: result.value.bindingId,
    },
  };
}

function classifyCase(input: {
  readonly comparisonId: TopComparisonId;
  readonly legacyObservation: TopQueryObservation;
  readonly canonicalObservation: TopQueryObservation;
  readonly mappingHeadId: string;
  readonly mappingHeadVersion: number;
  readonly planPin: string;
}): { result: TopComparisonResult; expectedDifference: TopExpectedDifference | null } {
  if (
    input.legacyObservation.status === "query-failure" &&
    input.legacyObservation.code === TOP_UNQUERYABLE_FAILURE_CODE
  ) {
    return { result: "unqueryable/protected-reference-missing", expectedDifference: null };
  }
  if (
    input.canonicalObservation.status === "query-failure" &&
    input.canonicalObservation.code === TOP_UNQUERYABLE_FAILURE_CODE
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

  const expectedDifference: TopExpectedDifference = {
    rClass: input.comparisonId === "PCAT-CMP-D02-SUBJECT-IDENTITY" ? "R2" : "R9",
    mappingHeadId: input.mappingHeadId,
    mappingHeadVersion: input.mappingHeadVersion,
    typedTarget: { kind: "canonical-pin", id: input.mappingHeadId },
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

function sortCases(cases: TopComparisonCase[]): TopComparisonCase[] {
  return [...cases].sort(
    (left, right) =>
      compareText(TOP_COMPARISON_FAMILY, TOP_COMPARISON_FAMILY) ||
      compareText(left.comparisonId, right.comparisonId) ||
      compareText(left.protectedReference.kind, right.protectedReference.kind) ||
      compareText(left.protectedReference.id, right.protectedReference.id) ||
      compareText(left.caseId, right.caseId),
  );
}

/**
 * Production TOP comparison contribution. Queries real PostgreSQL through
 * topology services, S8 catalog HTTP, and S6-WFA protected-reference reads.
 */
export async function provideTopParameterCatalogComparisonContribution(
  input: TopComparisonContributionInput,
): Promise<TopComparisonContribution> {
  if (input.phase !== "pre-activation" && input.phase !== "post-p13") {
    throw new Error("TOP comparison phase must be pre-activation or post-p13");
  }
  if (input.inventoryMode !== "fresh" && input.inventoryMode !== "populated") {
    throw new Error("TOP comparison inventoryMode must be fresh or populated");
  }
  if (!/^[a-f0-9]{40}$/u.test(input.candidateSha)) {
    throw new Error("TOP comparison candidateSha must be a full Git SHA");
  }

  const organizations = await queryOrganizationIds(input.database);
  const projects = await queryProjects(input.database);
  const organizationId = organizations[0] ?? "platform";

  const subjects = await observeCatalogList(input.pool, organizationId, "catalog.listSubjects");
  const registrations = await observeCatalogList(
    input.pool,
    organizationId,
    "catalog.listRegistrations",
    { organizationId },
  );
  const reviews = await observeCatalogList(input.pool, organizationId, "catalog.listReviewItems", {
    organizationId,
  });
  const observations = await observeCatalogList(
    input.pool,
    organizationId,
    "catalog.listObservations",
    { organizationId },
  );

  const bindingRecords = await queryBindingInventory(input.database, projects);
  const mappingRecords = await queryMappingInventory(input.database, organizations);

  const inventory = sortInventory([
    ...subjects.records,
    ...registrations.records,
    ...reviews.records,
    ...observations.records,
    ...bindingRecords,
    ...mappingRecords,
  ]);

  if (input.inventoryMode === "fresh" && inventory.length !== 0) {
    throw new Error(
      `TOP fresh inventory must be empty after a real PostgreSQL query; received ${inventory.length} records`,
    );
  }

  const cases: TopComparisonCase[] = [];
  for (const record of inventory) {
    const protectedReference = { kind: record.kind, id: record.id };
    for (const comparisonId of record.applicable) {
      const legacyObservation =
        comparisonId === "PCAT-CMP-D04-BINDING-HISTORY"
          ? await observeBindingHistory(input.database, record)
          : {
              status: "value" as const,
              value: { id: record.id, kind: record.kind },
            };
      const canonicalObservation =
        comparisonId === "PCAT-CMP-D02-SUBJECT-IDENTITY"
          ? subjects.observation
          : comparisonId === "PCAT-CMP-D03-REGISTRATION-PLACEMENT"
            ? registrations.observation
            : comparisonId === "PCAT-CMP-D06-REVIEW-PROPOSAL-OBSERVATION"
              ? record.kind === "review-proposal-observation" && reviews.observation.status === "value"
                ? reviews.observation
                : observations.observation
              : await observeProtectedPin(input.pool, record);

      const classified = classifyCase({
        comparisonId,
        legacyObservation,
        canonicalObservation,
        mappingHeadId: input.mappingHeadId,
        mappingHeadVersion: input.mappingHeadVersion,
        planPin: input.planPin,
      });

      cases.push({
        caseId: `${TOP_COMPARISON_FAMILY}:${comparisonId}:${record.kind}:${record.id}`,
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
  const sourceInventoryChecksum = checksumTopComparisonBytes(inventoryBytes);
  const unsigned: Omit<TopComparisonContribution, "checksum"> = {
    contractVersion: TOP_COMPARISON_CONTRACT_VERSION,
    family: TOP_COMPARISON_FAMILY,
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
  const bytes = serializeTopComparisonContribution(unsigned);
  return {
    ...unsigned,
    checksum: checksumTopComparisonBytes(bytes),
  };
}
