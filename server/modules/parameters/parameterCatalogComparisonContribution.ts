import { createHash } from "node:crypto";

import type { Database } from "../../shared/database/client";
import { listSemanticParameters } from "./semanticParameterReads";
import {
  PRJ_UNQUERYABLE_FAILURE_CODE,
  readCanonicalParameterPin,
  type CanonicalPinObservation,
} from "./canonicalParameterPin";

export const PRJ_COMPARISON_CONTRACT_VERSION = "pcat-comparison-contribution/v1";
export const PRJ_COMPARISON_FAMILY = "PRJ";

export const PRJ_COMPARISON_IDS = [
  "PCAT-CMP-D04-BINDING-HISTORY",
  "PCAT-CMP-D05-PROJECT-VALUE-PIN",
] as const;

export type PrjComparisonId = (typeof PRJ_COMPARISON_IDS)[number];
export type PrjComparisonPhase = "pre-activation" | "post-p13";
export type PrjInventoryMode = "fresh" | "populated";
export type PrjComparisonResult =
  | "exact-equivalent"
  | "declared-expected-difference"
  | "unexplained-difference"
  | "unqueryable/protected-reference-missing";

export { PRJ_UNQUERYABLE_FAILURE_CODE };

export type PrjProtectedReference = {
  readonly kind: string;
  readonly id: string;
};

export type PrjQueryObservation =
  | {
      readonly status: "value";
      readonly value: Readonly<Record<string, unknown>>;
    }
  | {
      readonly status: "query-failure";
      readonly code: string;
      readonly detail: string;
    };

export type PrjExpectedDifference = {
  readonly rClass: string;
  readonly mappingHeadId: string;
  readonly mappingHeadVersion: number;
  readonly typedTarget?: { readonly kind: string; readonly id: string };
  readonly Archive?: { readonly id: string };
  readonly ruleId: string;
  readonly planPin: string;
};

export type PrjComparisonCase = {
  readonly caseId: string;
  readonly comparisonId: PrjComparisonId;
  readonly protectedReference: PrjProtectedReference;
  readonly legacyObservation: PrjQueryObservation;
  readonly canonicalObservation: PrjQueryObservation;
  readonly result: PrjComparisonResult;
  readonly expectedDifference: PrjExpectedDifference | null;
};

export type PrjComparisonContributionInput = {
  readonly database: Database;
  readonly phase: PrjComparisonPhase;
  readonly inventoryMode: PrjInventoryMode;
  readonly candidateSha: string;
  readonly planPin: string;
  readonly mappingHeadId: string;
  readonly mappingHeadVersion: number;
  readonly mappingHeadChecksum: string;
  readonly catalogSnapshotChecksum: string;
};

export type PrjComparisonContribution = {
  readonly contractVersion: typeof PRJ_COMPARISON_CONTRACT_VERSION;
  readonly family: typeof PRJ_COMPARISON_FAMILY;
  readonly phase: PrjComparisonPhase;
  readonly inventoryMode: PrjInventoryMode;
  readonly candidateSha: string;
  readonly planPin: string;
  readonly mappingHeadId: string;
  readonly mappingHeadVersion: number;
  readonly mappingHeadChecksum: string;
  readonly catalogSnapshotChecksum: string;
  readonly sourceInventoryCount: number;
  readonly sourceInventoryChecksum: string;
  readonly cases: readonly PrjComparisonCase[];
  readonly checksum: string;
};

type InventoryRecord = PrjProtectedReference & {
  readonly applicable: readonly PrjComparisonId[];
  readonly legacyValue: Readonly<Record<string, unknown>>;
};

const INVENTORY_PAGE = 100_000;

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

export function serializePrjComparisonContribution(
  contribution: Omit<PrjComparisonContribution, "checksum"> | PrjComparisonContribution,
): Buffer {
  const { checksum: _checksum, ...rest } = contribution as PrjComparisonContribution;
  void _checksum;
  return Buffer.from(`${JSON.stringify(sortKeys(rest))}\n`, "utf8");
}

export function checksumPrjComparisonBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function queryOrganizationIds(database: Database): Promise<readonly string[]> {
  const result = await database.query<{ id: string }>("select id from organizations order by id");
  if (!Array.isArray(result.rows)) {
    throw new Error("PRJ inventory organization query did not return rows");
  }
  return result.rows.map((row) => row.id);
}

async function queryBindingInventory(database: Database): Promise<InventoryRecord[]> {
  const organizations = await queryOrganizationIds(database);
  const scopes = organizations.length > 0 ? organizations : ["platform"];
  const byKey = new Map<string, InventoryRecord>();
  for (const organizationId of scopes) {
    const rows = await listSemanticParameters(database, {
      organizationId,
      limit: INVENTORY_PAGE,
    });
    if (rows.length >= INVENTORY_PAGE) {
      throw new Error("PRJ inventory query truncated; sampling is forbidden");
    }
    for (const row of rows) {
      const bindingKey = `project-parameter-binding:${row.id}`;
      const pinKey = `project-value-pin:${row.id}`;
      const legacyValue = {
        id: row.id,
        projectId: row.project_id,
        currentValue: row.current_value,
        selection: "latest-revision-tip",
      };
      byKey.set(bindingKey, {
        kind: "project-parameter-binding",
        id: row.id,
        applicable: ["PCAT-CMP-D04-BINDING-HISTORY"],
        legacyValue,
      });
      byKey.set(pinKey, {
        kind: "project-value-pin",
        id: row.id,
        applicable: ["PCAT-CMP-D05-PROJECT-VALUE-PIN"],
        legacyValue,
      });
    }
  }
  return [...byKey.values()];
}

function classifyCase(input: {
  readonly comparisonId: PrjComparisonId;
  readonly legacyObservation: PrjQueryObservation;
  readonly canonicalObservation: PrjQueryObservation;
  readonly mappingHeadId: string;
  readonly mappingHeadVersion: number;
  readonly planPin: string;
  readonly protectedReference: PrjProtectedReference;
}): { result: PrjComparisonResult; expectedDifference: PrjExpectedDifference | null } {
  if (
    input.legacyObservation.status === "query-failure" &&
    input.legacyObservation.code === PRJ_UNQUERYABLE_FAILURE_CODE
  ) {
    return { result: "unqueryable/protected-reference-missing", expectedDifference: null };
  }
  if (
    input.canonicalObservation.status === "query-failure" &&
    input.canonicalObservation.code === PRJ_UNQUERYABLE_FAILURE_CODE
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

  const expectedDifference: PrjExpectedDifference = {
    rClass: "R9",
    mappingHeadId: input.mappingHeadId,
    mappingHeadVersion: input.mappingHeadVersion,
    typedTarget: {
      kind: input.protectedReference.kind,
      id: input.protectedReference.id,
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

function sortCases(cases: PrjComparisonCase[]): PrjComparisonCase[] {
  return [...cases].sort(
    (left, right) =>
      compareText(PRJ_COMPARISON_FAMILY, PRJ_COMPARISON_FAMILY) ||
      compareText(left.comparisonId, right.comparisonId) ||
      compareText(left.protectedReference.kind, right.protectedReference.kind) ||
      compareText(left.protectedReference.id, right.protectedReference.id) ||
      compareText(left.caseId, right.caseId),
  );
}

function assertKnownComparisonId(comparisonId: string): asserts comparisonId is PrjComparisonId {
  if (!PRJ_COMPARISON_IDS.includes(comparisonId as PrjComparisonId)) {
    throw new Error(`Unknown PRJ comparison ID: ${comparisonId}`);
  }
}

/**
 * Production PRJ comparison contribution. Queries real PostgreSQL through
 * the project workbench inventory and S6-WFA protected-reference reads.
 */
export async function providePrjParameterCatalogComparisonContribution(
  input: PrjComparisonContributionInput,
): Promise<PrjComparisonContribution> {
  if (input.phase !== "pre-activation" && input.phase !== "post-p13") {
    throw new Error("PRJ comparison phase must be pre-activation or post-p13");
  }
  if (input.inventoryMode !== "fresh" && input.inventoryMode !== "populated") {
    throw new Error("PRJ comparison inventoryMode must be fresh or populated");
  }
  if (!/^[a-f0-9]{40}$/u.test(input.candidateSha)) {
    throw new Error("PRJ comparison candidateSha must be a full Git SHA");
  }

  const inventory = sortInventory(await queryBindingInventory(input.database));
  if (input.inventoryMode === "fresh" && inventory.length !== 0) {
    throw new Error(
      `PRJ fresh inventory must be empty after a real PostgreSQL query; received ${inventory.length} records`,
    );
  }

  const canonicalObservation: CanonicalPinObservation = await readCanonicalParameterPin(input.database);

  const cases: PrjComparisonCase[] = [];
  const seenCaseIds = new Set<string>();
  for (const record of inventory) {
    const protectedReference = { kind: record.kind, id: record.id };
    for (const comparisonId of record.applicable) {
      assertKnownComparisonId(comparisonId);
      const legacyObservation: PrjQueryObservation = {
        status: "value",
        value: record.legacyValue,
      };
      const classified = classifyCase({
        comparisonId,
        legacyObservation,
        canonicalObservation,
        mappingHeadId: input.mappingHeadId,
        mappingHeadVersion: input.mappingHeadVersion,
        planPin: input.planPin,
        protectedReference,
      });
      if (classified.result === "unexplained-difference") {
        throw new Error("PRJ comparison refused an unexplained-difference result");
      }
      const caseId = `${PRJ_COMPARISON_FAMILY}:${comparisonId}:${record.kind}:${record.id}`;
      if (seenCaseIds.has(caseId)) {
        throw new Error(`Duplicate PRJ comparison case: ${caseId}`);
      }
      seenCaseIds.add(caseId);
      cases.push({
        caseId,
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
  const sourceInventoryChecksum = checksumPrjComparisonBytes(inventoryBytes);
  const unsigned: Omit<PrjComparisonContribution, "checksum"> = {
    contractVersion: PRJ_COMPARISON_CONTRACT_VERSION,
    family: PRJ_COMPARISON_FAMILY,
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
  const bytes = serializePrjComparisonContribution(unsigned);
  return {
    ...unsigned,
    checksum: checksumPrjComparisonBytes(bytes),
  };
}
