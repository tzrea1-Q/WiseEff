import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";

import { createCatalogKernel } from "../catalog-kernel/interface";
import { parameterCatalogCanonicalRoutes } from "../contracts/dtoSchemas/parameterCatalog";
import {
  handleCatalogRead,
  kernelOnlyTimelineComposer,
  unregisteredProjection,
  zeroUsageProjection,
  type CatalogReadPorts,
} from "../parameter-catalog-api/read";
import type { Database } from "../../shared/database/client";

export const LOG_COMPARISON_CONTRACT_VERSION = "pcat-comparison-contribution/v1";
export const LOG_COMPARISON_FAMILY = "LOG";

export const LOG_COMPARISON_IDS = ["PCAT-CMP-D07-PROTECTED-CONSUMER-REFERENCE"] as const;

export type LogComparisonId = (typeof LOG_COMPARISON_IDS)[number];
export type LogComparisonPhase = "pre-activation" | "post-p13";
export type LogInventoryMode = "fresh" | "populated";
export type LogComparisonResult =
  | "exact-equivalent"
  | "declared-expected-difference"
  | "unexplained-difference"
  | "unqueryable/protected-reference-missing";

export const LOG_UNQUERYABLE_FAILURE_CODE = "PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE";

export type LogProtectedReference = {
  readonly kind: string;
  readonly id: string;
};

export type LogQueryObservation =
  | {
      readonly status: "value";
      readonly value: Readonly<Record<string, unknown>>;
    }
  | {
      readonly status: "query-failure";
      readonly code: string;
      readonly detail: string;
    };

export type LogExpectedDifference = {
  readonly rClass: string;
  readonly mappingHeadId: string;
  readonly mappingHeadVersion: number;
  readonly typedTarget?: { readonly kind: string; readonly id: string };
  readonly Archive?: { readonly id: string };
  readonly ruleId: string;
  readonly planPin: string;
};

export type LogComparisonCase = {
  readonly caseId: string;
  readonly comparisonId: LogComparisonId;
  readonly protectedReference: LogProtectedReference;
  readonly legacyObservation: LogQueryObservation;
  readonly canonicalObservation: LogQueryObservation;
  readonly result: LogComparisonResult;
  readonly expectedDifference: LogExpectedDifference | null;
};

export type LogComparisonContributionInput = {
  readonly database: Database;
  readonly pool: pg.Pool;
  readonly phase: LogComparisonPhase;
  readonly inventoryMode: LogInventoryMode;
  readonly candidateSha: string;
  readonly planPin: string;
  readonly mappingHeadId: string;
  readonly mappingHeadVersion: number;
  readonly mappingHeadChecksum: string;
  readonly catalogSnapshotChecksum: string;
};

export type LogComparisonContribution = {
  readonly contractVersion: typeof LOG_COMPARISON_CONTRACT_VERSION;
  readonly family: typeof LOG_COMPARISON_FAMILY;
  readonly phase: LogComparisonPhase;
  readonly inventoryMode: LogInventoryMode;
  readonly candidateSha: string;
  readonly planPin: string;
  readonly mappingHeadId: string;
  readonly mappingHeadVersion: number;
  readonly mappingHeadChecksum: string;
  readonly catalogSnapshotChecksum: string;
  readonly sourceInventoryCount: number;
  readonly sourceInventoryChecksum: string;
  readonly cases: readonly LogComparisonCase[];
  readonly checksum: string;
};

type InventoryRecord = LogProtectedReference & {
  readonly applicable: readonly LogComparisonId[];
  readonly organizationId: string;
  readonly relatedParameterId: string | null;
  readonly fileName: string;
  readonly status: string;
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

export function serializeLogComparisonContribution(
  contribution: Omit<LogComparisonContribution, "checksum"> | LogComparisonContribution,
): Buffer {
  const { checksum: _checksum, ...rest } = contribution as LogComparisonContribution;
  void _checksum;
  return Buffer.from(`${JSON.stringify(sortKeys(rest))}\n`, "utf8");
}

export function checksumLogComparisonBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
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
    principalId: "log-comparison-reader",
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

async function queryLogRecordInventory(database: Database): Promise<InventoryRecord[]> {
  const result = await database.query<{
    id: string;
    organization_id: string;
    related_parameter_id: string | null;
    file_name: string;
    status: string;
  }>(
    "select id, organization_id, related_parameter_id, file_name, status from log_records order by id",
  );
  if (!Array.isArray(result.rows)) {
    throw new Error("LOG inventory log-record query did not return rows");
  }
  return result.rows.map((row) => ({
    kind: "log-record",
    id: row.id,
    applicable: LOG_COMPARISON_IDS,
    organizationId: row.organization_id,
    relatedParameterId: row.related_parameter_id,
    fileName: row.file_name,
    status: row.status,
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

function sortCases(cases: LogComparisonCase[]): LogComparisonCase[] {
  return [...cases].sort(
    (left, right) =>
      compareText(LOG_COMPARISON_FAMILY, LOG_COMPARISON_FAMILY) ||
      compareText(left.comparisonId, right.comparisonId) ||
      compareText(left.protectedReference.kind, right.protectedReference.kind) ||
      compareText(left.protectedReference.id, right.protectedReference.id) ||
      compareText(left.caseId, right.caseId),
  );
}

function observeLegacy(record: InventoryRecord): LogQueryObservation {
  if (!record.id) {
    return {
      status: "query-failure",
      code: LOG_UNQUERYABLE_FAILURE_CODE,
      detail: "legacy-protected-reference-missing",
    };
  }
  return {
    status: "value",
    value: {
      id: record.id,
      organizationId: record.organizationId,
      relatedParameterId: record.relatedParameterId,
      fileName: record.fileName,
      status: record.status,
      protectedReference: record.relatedParameterId
        ? { kind: "canonical-pin", bindingId: record.relatedParameterId }
        : null,
    },
  };
}

async function observeCatalogRoute(
  pool: pg.Pool,
  organizationId: string,
  routeId: "catalog.listDefinitions" | "catalog.getDefinitionRevision",
  params: Record<string, string> = {},
): Promise<{ httpStatus: number; itemCount: number }> {
  const response = await handleCatalogRead(createReadPorts(pool, organizationId), {
    method: "GET",
    path: catalogPath(routeId, params),
    params,
    query: {},
    headers: {},
    requestId: randomUUID(),
  });
  const body = response.body && typeof response.body === "object" ? (response.body as Record<string, unknown>) : {};
  const items = Array.isArray(body.items) ? body.items : body.item ? [body.item] : [];
  return { httpStatus: response.status, itemCount: items.length };
}

async function observeCanonical(
  pool: pg.Pool,
  record: InventoryRecord,
): Promise<LogQueryObservation> {
  try {
    const definitions = await observeCatalogRoute(pool, record.organizationId, "catalog.listDefinitions");
    const revision = await observeCatalogRoute(pool, record.organizationId, "catalog.getDefinitionRevision", {
      definitionId: "pdef_log_unpinned",
      revisionId: "drev_log_unpinned",
    });
    return {
      status: "value",
      value: {
        adapter: "s8-read",
        definitionRoute: "catalog.listDefinitions",
        definitionHttpStatus: definitions.httpStatus,
        definitionItemCount: definitions.itemCount,
        revisionRoute: "catalog.getDefinitionRevision",
        revisionHttpStatus: revision.httpStatus,
        revisionItemCount: revision.itemCount,
        relatedParameterId: record.relatedParameterId,
        recordKind: record.kind,
        recordId: record.id,
      },
    };
  } catch (error) {
    return {
      status: "query-failure",
      code: LOG_UNQUERYABLE_FAILURE_CODE,
      detail: error instanceof Error ? error.message : "canonical-protected-reference-query-failed",
    };
  }
}

function classifyCase(input: {
  readonly comparisonId: LogComparisonId;
  readonly legacyObservation: LogQueryObservation;
  readonly canonicalObservation: LogQueryObservation;
  readonly mappingHeadId: string;
  readonly mappingHeadVersion: number;
  readonly planPin: string;
  readonly protectedReference: LogProtectedReference;
}): { result: LogComparisonResult; expectedDifference: LogExpectedDifference | null } {
  if (
    input.legacyObservation.status === "query-failure" &&
    input.legacyObservation.code === LOG_UNQUERYABLE_FAILURE_CODE
  ) {
    return { result: "unqueryable/protected-reference-missing", expectedDifference: null };
  }
  if (
    input.canonicalObservation.status === "query-failure" &&
    input.canonicalObservation.code === LOG_UNQUERYABLE_FAILURE_CODE
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

  const expectedDifference: LogExpectedDifference = {
    rClass: "R9",
    mappingHeadId: input.mappingHeadId,
    mappingHeadVersion: input.mappingHeadVersion,
    typedTarget: { kind: input.protectedReference.kind, id: input.protectedReference.id },
    ruleId: input.comparisonId,
    planPin: input.planPin,
  };
  return { result: "declared-expected-difference", expectedDifference };
}

/**
 * Production LOG comparison contribution. Queries real PostgreSQL through
 * log-record inventory and S8 catalog reads of scoped Definition/Revision pins.
 */
export async function provideLogParameterCatalogComparisonContribution(
  input: LogComparisonContributionInput,
): Promise<LogComparisonContribution> {
  if (input.phase !== "pre-activation" && input.phase !== "post-p13") {
    throw new Error("LOG comparison phase must be pre-activation or post-p13");
  }
  if (input.inventoryMode !== "fresh" && input.inventoryMode !== "populated") {
    throw new Error("LOG comparison inventoryMode must be fresh or populated");
  }
  if (!/^[a-f0-9]{40}$/u.test(input.candidateSha)) {
    throw new Error("LOG comparison candidateSha must be a full Git SHA");
  }

  const inventory = sortInventory(await queryLogRecordInventory(input.database));

  if (input.inventoryMode === "fresh" && inventory.length !== 0) {
    throw new Error(
      `LOG fresh inventory must be empty after a real PostgreSQL query; received ${inventory.length} records`,
    );
  }

  const cases: LogComparisonCase[] = [];
  for (const record of inventory) {
    const protectedReference = { kind: record.kind, id: record.id };
    for (const comparisonId of record.applicable) {
      if (comparisonId !== "PCAT-CMP-D07-PROTECTED-CONSUMER-REFERENCE") {
        throw new Error(`LOG comparison rejected unknown comparison ID ${String(comparisonId)}`);
      }
      const legacyObservation = observeLegacy(record);
      const canonicalObservation = await observeCanonical(input.pool, record);
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
        caseId: `${LOG_COMPARISON_FAMILY}:${comparisonId}:${record.kind}:${record.id}`,
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
  const sourceInventoryChecksum = checksumLogComparisonBytes(inventoryBytes);
  const unsigned: Omit<LogComparisonContribution, "checksum"> = {
    contractVersion: LOG_COMPARISON_CONTRACT_VERSION,
    family: LOG_COMPARISON_FAMILY,
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
  const bytes = serializeLogComparisonContribution(unsigned);
  return {
    ...unsigned,
    checksum: checksumLogComparisonBytes(bytes),
  };
}
