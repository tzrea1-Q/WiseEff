import { createHash } from "node:crypto";
import type pg from "pg";

import type { Database } from "../../shared/database/client";
import {
  catalogLegacyGoneResult,
  LEGACY_WRITE_GONE_MESSAGE,
  lookupLegacyIdentifier,
} from "../parameter-catalog-api/legacy";
import { createReleaseVerificationService } from "../release-verification/core";
import { runInspectCutoverCli } from "../../../scripts/wayfinder/inspect-parameter-catalog-cutover";

export const OPS_COMPARISON_CONTRACT_VERSION = "pcat-comparison-contribution/v1";
export const OPS_COMPARISON_FAMILY = "OPS";

export const OPS_COMPARISON_IDS = ["PCAT-CMP-D09-LEGACY-OPERATOR-OUTCOME"] as const;

export type OpsComparisonId = (typeof OPS_COMPARISON_IDS)[number];
export type OpsComparisonPhase = "pre-activation" | "post-p13";
export type OpsInventoryMode = "fresh" | "populated";
export type OpsComparisonResult =
  | "exact-equivalent"
  | "declared-expected-difference"
  | "unexplained-difference"
  | "unqueryable/protected-reference-missing";

export const OPS_UNQUERYABLE_FAILURE_CODE = "PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE";

export type OpsProtectedReference = {
  readonly kind: string;
  readonly id: string;
};

export type OpsQueryObservation =
  | {
      readonly status: "value";
      readonly value: Readonly<Record<string, unknown>>;
    }
  | {
      readonly status: "query-failure";
      readonly code: string;
      readonly detail: string;
    };

export type OpsExpectedDifference = {
  readonly rClass: string;
  readonly mappingHeadId: string;
  readonly mappingHeadVersion: number;
  readonly typedTarget?: { readonly kind: string; readonly id: string };
  readonly Archive?: { readonly id: string };
  readonly ruleId: string;
  readonly planPin: string;
};

export type OpsComparisonCase = {
  readonly caseId: string;
  readonly comparisonId: OpsComparisonId;
  readonly protectedReference: OpsProtectedReference;
  readonly legacyObservation: OpsQueryObservation;
  readonly canonicalObservation: OpsQueryObservation;
  readonly result: OpsComparisonResult;
  readonly expectedDifference: OpsExpectedDifference | null;
};

export type OpsComparisonContributionInput = {
  readonly database: Database;
  readonly pool: pg.Pool;
  readonly phase: OpsComparisonPhase;
  readonly inventoryMode: OpsInventoryMode;
  readonly candidateSha: string;
  readonly planPin: string;
  readonly mappingHeadId: string;
  readonly mappingHeadVersion: number;
  readonly mappingHeadChecksum: string;
  readonly catalogSnapshotChecksum: string;
};

export type OpsComparisonContribution = {
  readonly contractVersion: typeof OPS_COMPARISON_CONTRACT_VERSION;
  readonly family: typeof OPS_COMPARISON_FAMILY;
  readonly phase: OpsComparisonPhase;
  readonly inventoryMode: OpsInventoryMode;
  readonly candidateSha: string;
  readonly planPin: string;
  readonly mappingHeadId: string;
  readonly mappingHeadVersion: number;
  readonly mappingHeadChecksum: string;
  readonly catalogSnapshotChecksum: string;
  readonly sourceInventoryCount: number;
  readonly sourceInventoryChecksum: string;
  readonly cases: readonly OpsComparisonCase[];
  readonly checksum: string;
};

type InventoryRecord = OpsProtectedReference & {
  readonly applicable: readonly OpsComparisonId[];
  readonly lookupType: string;
  readonly organizationId: string | null;
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

export function serializeOpsComparisonContribution(
  contribution: Omit<OpsComparisonContribution, "checksum"> | OpsComparisonContribution,
): Buffer {
  const { checksum: _checksum, ...rest } = contribution as OpsComparisonContribution;
  void _checksum;
  return Buffer.from(`${JSON.stringify(sortKeys(rest))}\n`, "utf8");
}

export function checksumOpsComparisonBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function databaseUrlFromPool(pool: pg.Pool): string {
  const url = pool.options.connectionString;
  if (typeof url !== "string" || url.trim().length === 0) {
    throw new Error("OPS comparison requires a real PostgreSQL pool connection string");
  }
  return url;
}

function asLookupClient(database: Database): Parameters<typeof lookupLegacyIdentifier>[0]["client"] {
  return database as unknown as Parameters<typeof lookupLegacyIdentifier>[0]["client"];
}

export async function readTypedCutoverInspection(input: {
  readonly databaseUrl: string;
  readonly runId?: string;
  readonly planDigest?: string;
  readonly phase?: string;
}): Promise<OpsQueryObservation> {
  const args = ["--database-url", input.databaseUrl];
  if (input.runId) args.push("--run-id", input.runId);
  if (input.planDigest) args.push("--plan-digest", input.planDigest);
  if (input.phase) args.push("--phase", input.phase);
  try {
    const result = await runInspectCutoverCli(args);
    if (result.ok) {
      return {
        status: "value",
        value: {
          seam: "s7-orc-inspect",
          runId: result.value.runId,
          state: result.value.state,
          currentPhase: result.value.currentPhase,
          planDigest: result.value.planDigest,
          checkpointCount: result.value.checkpoints.length,
        },
      };
    }
    return {
      status: "value",
      value: {
        seam: "s7-orc-inspect",
        ok: false,
        code: result.error.code,
        detail: result.error.detail,
      },
    };
  } catch (error) {
    return {
      status: "query-failure",
      code: OPS_UNQUERYABLE_FAILURE_CODE,
      detail: error instanceof Error ? error.message : "cutover-inspect-query-failed",
    };
  }
}

export async function readTypedVerificationReport(input: {
  readonly database: Database;
  readonly reportIdOrDigest: string;
}): Promise<OpsQueryObservation> {
  try {
    const service = createReleaseVerificationService({ db: input.database });
    const result = await service.readReport(input.reportIdOrDigest);
    if (result.kind === "present") {
      return {
        status: "value",
        value: {
          seam: "s10-per-readReport",
          kind: result.kind,
          digest: result.report.digest,
          purpose: result.report.purpose,
          decision: result.report.decision,
        },
      };
    }
    return {
      status: "value",
      value: {
        seam: "s10-per-readReport",
        kind: result.kind,
        reason: result.reason,
      },
    };
  } catch (error) {
    return {
      status: "query-failure",
      code: OPS_UNQUERYABLE_FAILURE_CODE,
      detail: error instanceof Error ? error.message : "verification-report-query-failed",
    };
  }
}

export async function readTypedLegacyOperatorOutcome(input: {
  readonly database: Database;
  readonly legacyType: string;
  readonly legacyId: string;
  readonly organizationId?: string | null;
}): Promise<OpsQueryObservation> {
  try {
    const outcome = await lookupLegacyIdentifier({
      client: asLookupClient(input.database),
      legacyType: input.legacyType,
      legacyId: input.legacyId,
      organizationId: input.organizationId ?? null,
    });
    const gone = catalogLegacyGoneResult(
      `ops-${input.legacyType}-${input.legacyId}`,
      LEGACY_WRITE_GONE_MESSAGE,
    );
    if (outcome.kind === "mapped") {
      return {
        status: "value",
        value: {
          seam: "s8-leg",
          kind: outcome.kind,
          disposition: outcome.item.disposition,
          targetKind: outcome.item.target.kind,
          targetId: outcome.item.target.id,
          structuralWriteStatus: gone.status,
        },
      };
    }
    return {
      status: "value",
      value: {
        seam: "s8-leg",
        kind: outcome.kind,
        structuralWriteStatus: gone.status,
      },
    };
  } catch (error) {
    return {
      status: "query-failure",
      code: OPS_UNQUERYABLE_FAILURE_CODE,
      detail: error instanceof Error ? error.message : "legacy-operator-query-failed",
    };
  }
}

async function queryProjectInventory(database: Database): Promise<InventoryRecord[]> {
  const result = await database.query<{ id: string; organization_id: string }>(
    "select id, organization_id from projects order by id",
  );
  if (!Array.isArray(result.rows)) {
    throw new Error("OPS inventory project query did not return rows");
  }
  return result.rows.map((row) => ({
    kind: "operator-project",
    id: row.id,
    applicable: OPS_COMPARISON_IDS,
    lookupType: "project-parameter-binding",
    organizationId: row.organization_id,
  }));
}

async function queryLogicalNodeInventory(database: Database): Promise<InventoryRecord[]> {
  const result = await database.query<{
    id: string;
    organization_id: string;
  }>("select id, organization_id from dts_logical_nodes order by id");
  if (!Array.isArray(result.rows)) {
    throw new Error("OPS inventory logical-node query did not return rows");
  }
  return result.rows.map((row) => ({
    kind: "logical-node-source",
    id: row.id,
    applicable: OPS_COMPARISON_IDS,
    lookupType: "parameter-spec",
    organizationId: row.organization_id,
  }));
}

async function queryConfigRevisionInventory(database: Database): Promise<InventoryRecord[]> {
  const result = await database.query<{
    id: string;
    organization_id: string;
  }>("select id, organization_id from dts_config_revisions order by id");
  if (!Array.isArray(result.rows)) {
    throw new Error("OPS inventory config-revision query did not return rows");
  }
  return result.rows.map((row) => ({
    kind: "config-revision-source",
    id: row.id,
    applicable: OPS_COMPARISON_IDS,
    lookupType: "parameter-spec-version",
    organizationId: row.organization_id,
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

function sortCases(cases: OpsComparisonCase[]): OpsComparisonCase[] {
  return [...cases].sort(
    (left, right) =>
      compareText(OPS_COMPARISON_FAMILY, OPS_COMPARISON_FAMILY) ||
      compareText(left.comparisonId, right.comparisonId) ||
      compareText(left.protectedReference.kind, right.protectedReference.kind) ||
      compareText(left.protectedReference.id, right.protectedReference.id) ||
      compareText(left.caseId, right.caseId),
  );
}

async function observeCanonical(
  input: OpsComparisonContributionInput,
  record: InventoryRecord,
): Promise<OpsQueryObservation> {
  const inspect = await readTypedCutoverInspection({
    databaseUrl: databaseUrlFromPool(input.pool),
    runId: record.id,
  });
  const report = await readTypedVerificationReport({
    database: input.database,
    reportIdOrDigest: record.id,
  });
  if (inspect.status === "query-failure") return inspect;
  if (report.status === "query-failure") return report;
  return {
    status: "value",
    value: {
      inspect: inspect.value,
      report: report.value,
    },
  };
}

function classifyCase(input: {
  readonly comparisonId: OpsComparisonId;
  readonly legacyObservation: OpsQueryObservation;
  readonly canonicalObservation: OpsQueryObservation;
  readonly mappingHeadId: string;
  readonly mappingHeadVersion: number;
  readonly planPin: string;
  readonly protectedReference: OpsProtectedReference;
}): { result: OpsComparisonResult; expectedDifference: OpsExpectedDifference | null } {
  if (
    input.legacyObservation.status === "query-failure" &&
    input.legacyObservation.code === OPS_UNQUERYABLE_FAILURE_CODE
  ) {
    return { result: "unqueryable/protected-reference-missing", expectedDifference: null };
  }
  if (
    input.canonicalObservation.status === "query-failure" &&
    input.canonicalObservation.code === OPS_UNQUERYABLE_FAILURE_CODE
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

  const expectedDifference: OpsExpectedDifference = {
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
 * Production OPS comparison contribution. Queries real PostgreSQL through
 * operator inventory plus S7-ORC inspect, S10-PER readReport, and S8-LEG outcomes.
 */
export async function provideOpsParameterCatalogComparisonContribution(
  input: OpsComparisonContributionInput,
): Promise<OpsComparisonContribution> {
  if (input.phase !== "pre-activation" && input.phase !== "post-p13") {
    throw new Error("OPS comparison phase must be pre-activation or post-p13");
  }
  if (input.inventoryMode !== "fresh" && input.inventoryMode !== "populated") {
    throw new Error("OPS comparison inventoryMode must be fresh or populated");
  }
  if (!/^[a-f0-9]{40}$/u.test(input.candidateSha)) {
    throw new Error("OPS comparison candidateSha must be a full Git SHA");
  }

  const inventory = sortInventory([
    ...(await queryProjectInventory(input.database)),
    ...(await queryLogicalNodeInventory(input.database)),
    ...(await queryConfigRevisionInventory(input.database)),
  ]);

  if (input.inventoryMode === "fresh" && inventory.length !== 0) {
    throw new Error(
      `OPS fresh inventory must be empty after a real PostgreSQL query; received ${inventory.length} records`,
    );
  }

  const cases: OpsComparisonCase[] = [];
  for (const record of inventory) {
    const protectedReference = { kind: record.kind, id: record.id };
    for (const comparisonId of record.applicable) {
      if (comparisonId !== "PCAT-CMP-D09-LEGACY-OPERATOR-OUTCOME") {
        throw new Error(`OPS comparison rejected unknown comparison ID ${String(comparisonId)}`);
      }
      const legacyObservation = await readTypedLegacyOperatorOutcome({
        database: input.database,
        legacyType: record.lookupType,
        legacyId: record.id,
        organizationId: record.organizationId,
      });
      const canonicalObservation = await observeCanonical(input, record);
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
        caseId: `${OPS_COMPARISON_FAMILY}:${comparisonId}:${record.kind}:${record.id}`,
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
  const sourceInventoryChecksum = checksumOpsComparisonBytes(inventoryBytes);
  const unsigned: Omit<OpsComparisonContribution, "checksum"> = {
    contractVersion: OPS_COMPARISON_CONTRACT_VERSION,
    family: OPS_COMPARISON_FAMILY,
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
  const bytes = serializeOpsComparisonContribution(unsigned);
  return {
    ...unsigned,
    checksum: checksumOpsComparisonBytes(bytes),
  };
}
