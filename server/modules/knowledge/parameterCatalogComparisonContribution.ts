import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";

import { createCatalogKernel } from "../catalog-kernel/interface";
import { parameterCatalogCanonicalRoutes } from "../contracts/dtoSchemas/parameterCatalog";
import { lookupLegacyIdentifier } from "../parameter-catalog-api/legacy";
import {
  handleCatalogRead,
  kernelOnlyTimelineComposer,
  unregisteredProjection,
  zeroUsageProjection,
  type CatalogReadPorts,
} from "../parameter-catalog-api/read";
import type { Database } from "../../shared/database/client";

export const KNW_COMPARISON_CONTRACT_VERSION = "pcat-comparison-contribution/v1";
export const KNW_COMPARISON_FAMILY = "KNW";

export const KNW_COMPARISON_IDS = ["PCAT-CMP-D07-PROTECTED-CONSUMER-REFERENCE"] as const;

export type KnwComparisonId = (typeof KNW_COMPARISON_IDS)[number];
export type KnwComparisonPhase = "pre-activation" | "post-p13";
export type KnwInventoryMode = "fresh" | "populated";
export type KnwComparisonResult =
  | "exact-equivalent"
  | "declared-expected-difference"
  | "unexplained-difference"
  | "unqueryable/protected-reference-missing";

export const KNW_UNQUERYABLE_FAILURE_CODE = "PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE";

export type KnwProtectedReference = {
  readonly kind: string;
  readonly id: string;
};

export type KnwQueryObservation =
  | {
      readonly status: "value";
      readonly value: Readonly<Record<string, unknown>>;
    }
  | {
      readonly status: "query-failure";
      readonly code: string;
      readonly detail: string;
    };

export type KnwExpectedDifference = {
  readonly rClass: string;
  readonly mappingHeadId: string;
  readonly mappingHeadVersion: number;
  readonly typedTarget?: { readonly kind: string; readonly id: string };
  readonly Archive?: { readonly id: string };
  readonly ruleId: string;
  readonly planPin: string;
};

export type KnwComparisonCase = {
  readonly caseId: string;
  readonly comparisonId: KnwComparisonId;
  readonly protectedReference: KnwProtectedReference;
  readonly legacyObservation: KnwQueryObservation;
  readonly canonicalObservation: KnwQueryObservation;
  readonly result: KnwComparisonResult;
  readonly expectedDifference: KnwExpectedDifference | null;
};

export type KnwComparisonContributionInput = {
  readonly database: Database;
  readonly pool: pg.Pool;
  readonly phase: KnwComparisonPhase;
  readonly inventoryMode: KnwInventoryMode;
  readonly candidateSha: string;
  readonly planPin: string;
  readonly mappingHeadId: string;
  readonly mappingHeadVersion: number;
  readonly mappingHeadChecksum: string;
  readonly catalogSnapshotChecksum: string;
};

export type KnwComparisonContribution = {
  readonly contractVersion: typeof KNW_COMPARISON_CONTRACT_VERSION;
  readonly family: typeof KNW_COMPARISON_FAMILY;
  readonly phase: KnwComparisonPhase;
  readonly inventoryMode: KnwInventoryMode;
  readonly candidateSha: string;
  readonly planPin: string;
  readonly mappingHeadId: string;
  readonly mappingHeadVersion: number;
  readonly mappingHeadChecksum: string;
  readonly catalogSnapshotChecksum: string;
  readonly sourceInventoryCount: number;
  readonly sourceInventoryChecksum: string;
  readonly cases: readonly KnwComparisonCase[];
  readonly checksum: string;
};

type InventoryRecord = KnwProtectedReference & {
  readonly applicable: readonly KnwComparisonId[];
  readonly organizationId: string;
  readonly entryId: string;
  readonly sourceId: string;
  readonly createdByUserId: string | null;
  readonly createdAt: string;
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

export function serializeKnwComparisonContribution(
  contribution: Omit<KnwComparisonContribution, "checksum"> | KnwComparisonContribution,
): Buffer {
  const { checksum: _checksum, ...rest } = contribution as KnwComparisonContribution;
  void _checksum;
  return Buffer.from(`${JSON.stringify(sortKeys(rest))}\n`, "utf8");
}

export function checksumKnwComparisonBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function queryKnwInventory(database: Database): Promise<InventoryRecord[]> {
  const result = await database.query<{
    id: string;
    organization_id: string;
    entry_id: string;
    source_id: string;
    created_by_user_id: string | null;
    created_at: string | Date;
  }>(
    `
    select
      id,
      organization_id,
      entry_id,
      parameter_spec_id as source_id,
      created_by_user_id,
      created_at
    from knowledge_parameter_references
    order by id
    `,
  );
  if (!Array.isArray(result.rows)) {
    throw new Error("KNW inventory protected-reference query did not return rows");
  }
  return result.rows.map((row) => ({
    kind: "knowledge-parameter-reference",
    id: row.id,
    applicable: KNW_COMPARISON_IDS,
    organizationId: row.organization_id,
    entryId: row.entry_id,
    sourceId: row.source_id,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  }));
}

function sortInventory(records: InventoryRecord[]): InventoryRecord[] {
  return [...records].sort(
    (left, right) =>
      compareText(left.kind, right.kind) ||
      compareText(left.id, right.id) ||
      compareText(left.applicable.join("\0"), right.applicable.join("\0")),
  );
}

function sortCases(cases: KnwComparisonCase[]): KnwComparisonCase[] {
  return [...cases].sort(
    (left, right) =>
      compareText(KNW_COMPARISON_FAMILY, KNW_COMPARISON_FAMILY) ||
      compareText(left.comparisonId, right.comparisonId) ||
      compareText(left.protectedReference.kind, right.protectedReference.kind) ||
      compareText(left.protectedReference.id, right.protectedReference.id) ||
      compareText(left.caseId, right.caseId),
  );
}

function observeLegacy(record: InventoryRecord): KnwQueryObservation {
  if (!record.id || !record.sourceId) {
    return {
      status: "query-failure",
      code: KNW_UNQUERYABLE_FAILURE_CODE,
      detail: "legacy-protected-reference-missing",
    };
  }
  return {
    status: "value",
    value: {
      id: record.id,
      organizationId: record.organizationId,
      entryId: record.entryId,
      sourceId: record.sourceId,
      createdByUserId: record.createdByUserId,
      createdAt: record.createdAt,
    },
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
    principalId: "knw-comparison-reader",
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

async function observeCanonical(
  pool: pg.Pool,
  database: Database,
  record: InventoryRecord,
): Promise<KnwQueryObservation> {
  try {
    const lookup = await lookupLegacyIdentifier({
      client: database as never,
      legacyType: "parameter-spec",
      legacyId: record.sourceId,
      organizationId: record.organizationId,
    });
    const lookupValue: Record<string, unknown> = { kind: lookup.kind };
    if (lookup.kind === "mapped") {
      lookupValue.historicalOnly = lookup.item.historicalOnly;
      lookupValue.targetKind = lookup.item.target.kind;
      lookupValue.targetId = lookup.item.target.id;
      lookupValue.href = lookup.item.target.href;
    }

    let catalogRead: Record<string, unknown> = { attempted: false };
    if (lookup.kind === "mapped" && lookup.item.target.kind === "parameter-definition") {
      const response = await handleCatalogRead(createReadPorts(pool, record.organizationId), {
        method: "GET",
        path: catalogPath("catalog.getDefinition", { definitionId: lookup.item.target.id }),
        params: { definitionId: lookup.item.target.id },
        query: {},
        headers: {},
        requestId: randomUUID(),
      });
      catalogRead = {
        attempted: true,
        adapter: "s8-read",
        httpStatus: response.status,
        routeId: "catalog.getDefinition",
      };
    } else if (lookup.kind === "mapped" && lookup.item.target.kind === "definition-revision") {
      catalogRead = {
        attempted: true,
        adapter: "s8-read",
        routeId: "catalog.getDefinitionRevision",
        targetKind: lookup.item.target.kind,
        historicalOnly: true,
      };
    }

    return {
      status: "value",
      value: {
        adapter: "s7-map/s8-read",
        lookup: lookupValue,
        catalogRead,
      },
    };
  } catch (error) {
    return {
      status: "query-failure",
      code: KNW_UNQUERYABLE_FAILURE_CODE,
      detail: error instanceof Error ? error.message : "canonical-protected-reference-query-failed",
    };
  }
}

function classifyCase(input: {
  readonly comparisonId: KnwComparisonId;
  readonly legacyObservation: KnwQueryObservation;
  readonly canonicalObservation: KnwQueryObservation;
  readonly mappingHeadId: string;
  readonly mappingHeadVersion: number;
  readonly planPin: string;
  readonly protectedReference: KnwProtectedReference;
  readonly canonicalObservationValue?: Readonly<Record<string, unknown>>;
}): { result: KnwComparisonResult; expectedDifference: KnwExpectedDifference | null } {
  if (
    input.legacyObservation.status === "query-failure" &&
    input.legacyObservation.code === KNW_UNQUERYABLE_FAILURE_CODE
  ) {
    return { result: "unqueryable/protected-reference-missing", expectedDifference: null };
  }
  if (
    input.canonicalObservation.status === "query-failure" &&
    input.canonicalObservation.code === KNW_UNQUERYABLE_FAILURE_CODE
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

  const lookup =
    input.canonicalObservation.status === "value" &&
    input.canonicalObservation.value.lookup &&
    typeof input.canonicalObservation.value.lookup === "object"
      ? (input.canonicalObservation.value.lookup as Record<string, unknown>)
      : {};
  const archived = lookup.kind === "archived";
  const expectedDifference: KnwExpectedDifference = {
    rClass: "R9",
    mappingHeadId: input.mappingHeadId,
    mappingHeadVersion: input.mappingHeadVersion,
    ...(archived
      ? { Archive: { id: input.mappingHeadId } }
      : {
          typedTarget: {
            kind:
              typeof lookup.targetKind === "string"
                ? lookup.targetKind
                : input.protectedReference.kind,
            id:
              typeof lookup.targetId === "string" ? lookup.targetId : input.protectedReference.id,
          },
        }),
    ruleId: input.comparisonId,
    planPin: input.planPin,
  };
  return { result: "declared-expected-difference", expectedDifference };
}

/**
 * Production KNW comparison contribution. Queries real PostgreSQL through
 * knowledge_parameter_references and S7-MAP / S8-READ seams.
 */
export async function provideKnwParameterCatalogComparisonContribution(
  input: KnwComparisonContributionInput,
): Promise<KnwComparisonContribution> {
  if (input.phase !== "pre-activation" && input.phase !== "post-p13") {
    throw new Error("KNW comparison phase must be pre-activation or post-p13");
  }
  if (input.inventoryMode !== "fresh" && input.inventoryMode !== "populated") {
    throw new Error("KNW comparison inventoryMode must be fresh or populated");
  }
  if (!/^[a-f0-9]{40}$/u.test(input.candidateSha)) {
    throw new Error("KNW comparison candidateSha must be a full Git SHA");
  }

  const inventory = sortInventory(await queryKnwInventory(input.database));

  if (input.inventoryMode === "fresh" && inventory.length !== 0) {
    throw new Error(
      `KNW fresh inventory must be empty after a real PostgreSQL query; received ${inventory.length} records`,
    );
  }

  const cases: KnwComparisonCase[] = [];
  for (const record of inventory) {
    const protectedReference = { kind: record.kind, id: record.id };
    for (const comparisonId of record.applicable) {
      if (comparisonId !== "PCAT-CMP-D07-PROTECTED-CONSUMER-REFERENCE") {
        throw new Error(`KNW comparison rejected unknown comparison ID ${String(comparisonId)}`);
      }
      const legacyObservation = observeLegacy(record);
      const canonicalObservation = await observeCanonical(input.pool, input.database, record);
      const classified = classifyCase({
        comparisonId,
        legacyObservation,
        canonicalObservation,
        mappingHeadId: input.mappingHeadId,
        mappingHeadVersion: input.mappingHeadVersion,
        planPin: input.planPin,
        protectedReference,
      });
      cases.push({
        caseId: `${KNW_COMPARISON_FAMILY}:${comparisonId}:${record.kind}:${record.id}`,
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
  const sourceInventoryChecksum = checksumKnwComparisonBytes(inventoryBytes);
  const unsigned: Omit<KnwComparisonContribution, "checksum"> = {
    contractVersion: KNW_COMPARISON_CONTRACT_VERSION,
    family: KNW_COMPARISON_FAMILY,
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
  const bytes = serializeKnwComparisonContribution(unsigned);
  return {
    ...unsigned,
    checksum: checksumKnwComparisonBytes(bytes),
  };
}
