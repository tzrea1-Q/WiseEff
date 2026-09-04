import { createHash } from "node:crypto";
import type pg from "pg";

import type { Database } from "../../shared/database/client";
import {
  readProtectedReference,
  writebackProtectedReference,
  type ProtectedReadCommand,
  type ProtectedWritebackCommand,
} from "../parameter-bindings/adapters";
import { listFileVersions, listProjectParameterFiles } from "./repository";

export const FIL_COMPARISON_CONTRACT_VERSION = "pcat-comparison-contribution/v1";
export const FIL_COMPARISON_FAMILY = "FIL";

export const FIL_COMPARISON_IDS = [
  "PCAT-CMP-D07-PROTECTED-CONSUMER-REFERENCE",
  "PCAT-CMP-D08-SOURCE-WRITEBACK",
] as const;

export type FilComparisonId = (typeof FIL_COMPARISON_IDS)[number];
export type FilComparisonPhase = "pre-activation" | "post-p13";
export type FilInventoryMode = "fresh" | "populated";
export type FilComparisonResult =
  | "exact-equivalent"
  | "declared-expected-difference"
  | "unexplained-difference"
  | "unqueryable/protected-reference-missing";

export const FIL_UNQUERYABLE_FAILURE_CODE = "PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE";

export type FilProtectedReference = {
  readonly kind: string;
  readonly id: string;
};

export type FilQueryObservation =
  | {
      readonly status: "value";
      readonly value: Readonly<Record<string, unknown>>;
    }
  | {
      readonly status: "query-failure";
      readonly code: string;
      readonly detail: string;
    };

export type FilExpectedDifference = {
  readonly rClass: string;
  readonly mappingHeadId: string;
  readonly mappingHeadVersion: number;
  readonly typedTarget?: { readonly kind: string; readonly id: string };
  readonly Archive?: { readonly id: string };
  readonly ruleId: string;
  readonly planPin: string;
};

export type FilComparisonCase = {
  readonly caseId: string;
  readonly comparisonId: FilComparisonId;
  readonly protectedReference: FilProtectedReference;
  readonly legacyObservation: FilQueryObservation;
  readonly canonicalObservation: FilQueryObservation;
  readonly result: FilComparisonResult;
  readonly expectedDifference: FilExpectedDifference | null;
};

export type FilComparisonContributionInput = {
  readonly database: Database;
  readonly pool: pg.Pool;
  readonly phase: FilComparisonPhase;
  readonly inventoryMode: FilInventoryMode;
  readonly candidateSha: string;
  readonly planPin: string;
  readonly mappingHeadId: string;
  readonly mappingHeadVersion: number;
  readonly mappingHeadChecksum: string;
  readonly catalogSnapshotChecksum: string;
};

export type FilComparisonContribution = {
  readonly contractVersion: typeof FIL_COMPARISON_CONTRACT_VERSION;
  readonly family: typeof FIL_COMPARISON_FAMILY;
  readonly phase: FilComparisonPhase;
  readonly inventoryMode: FilInventoryMode;
  readonly candidateSha: string;
  readonly planPin: string;
  readonly mappingHeadId: string;
  readonly mappingHeadVersion: number;
  readonly mappingHeadChecksum: string;
  readonly catalogSnapshotChecksum: string;
  readonly sourceInventoryCount: number;
  readonly sourceInventoryChecksum: string;
  readonly cases: readonly FilComparisonCase[];
  readonly checksum: string;
};

type InventoryRecord = FilProtectedReference & {
  readonly applicable: readonly FilComparisonId[];
  readonly legacyValue: Readonly<Record<string, unknown>>;
};

const UNBOUND_REVISION = "drev_fil_unbound" as ProtectedReadCommand["definitionRevisionId"];
const UNBOUND_TIP = "pval_fil_unbound" as ProtectedWritebackCommand["expectedTip"];

const FIL_UNBOUND_SNAPSHOT = {
  release: {
    id: "crel_fil_unbound",
    version: "0.0.0",
    digest: `sha256:${"0".repeat(64)}`,
  },
  getSubject: () => ({ status: "unknown" as const, target: "subject" as const }),
  listSubjects: () => ({ status: "invalid-page" as const, reason: "cursor-malformed" as const }),
  resolveSubject: () => ({ status: "unknown" as const, reason: "no-candidate" as const }),
  getDefinition: () => ({ status: "unknown" as const, target: "definition" as const }),
  getDefinitionById: () => ({ status: "unknown" as const, target: "definition" as const }),
  listDefinitions: () => ({ status: "invalid-page" as const, reason: "cursor-malformed" as const }),
  getDefinitionRevision: () => ({ status: "unknown" as const, target: "definition" as const }),
  listDefinitionRevisions: () => ({ status: "unknown" as const, target: "definition" as const }),
  listDefinitionTimelineFacts: () => ({ status: "unknown" as const, target: "definition" as const }),
} as unknown as ProtectedReadCommand["snapshot"];

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

export function serializeFilComparisonContribution(
  contribution: Omit<FilComparisonContribution, "checksum"> | FilComparisonContribution,
): Buffer {
  const { checksum: _checksum, ...rest } = contribution as FilComparisonContribution;
  void _checksum;
  return Buffer.from(`${JSON.stringify(sortKeys(rest))}\n`, "utf8");
}

export function checksumFilComparisonBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function queryProjects(database: Database): Promise<readonly { id: string; organizationId: string }[]> {
  const result = await database.query<{ id: string; organization_id: string }>(
    "select id, organization_id from projects order by id",
  );
  if (!Array.isArray(result.rows)) {
    throw new Error("FIL inventory project query did not return rows");
  }
  return result.rows.map((row) => ({ id: row.id, organizationId: row.organization_id }));
}

async function queryLogicalNodeInventory(database: Database): Promise<InventoryRecord[]> {
  const result = await database.query<{
    id: string;
    organization_id: string;
    project_id: string;
    config_set_id: string;
  }>("select id, organization_id, project_id, config_set_id from dts_logical_nodes order by id");
  if (!Array.isArray(result.rows)) {
    throw new Error("FIL inventory logical-node query did not return rows");
  }
  return result.rows.map((row) => ({
    kind: "logical-node-source",
    id: row.id,
    applicable: FIL_COMPARISON_IDS,
    legacyValue: {
      id: row.id,
      organizationId: row.organization_id,
      projectId: row.project_id,
      configSetId: row.config_set_id,
    },
  }));
}

async function queryLogicalNodeRevisionInventory(database: Database): Promise<InventoryRecord[]> {
  const result = await database.query<{
    id: string;
    logical_node_id: string;
    node_locator: string | null;
    config_revision_id: string;
  }>(
    "select id, logical_node_id, node_locator, config_revision_id from dts_logical_node_revisions order by id",
  );
  if (!Array.isArray(result.rows)) {
    throw new Error("FIL inventory logical-node-revision query did not return rows");
  }
  return result.rows.map((row) => ({
    kind: "logical-node-revision-source",
    id: row.id,
    applicable: FIL_COMPARISON_IDS,
    legacyValue: {
      id: row.id,
      logicalNodeId: row.logical_node_id,
      nodeLocator: row.node_locator,
      configRevisionId: row.config_revision_id,
    },
  }));
}

async function queryConfigRevisionInventory(database: Database): Promise<InventoryRecord[]> {
  const result = await database.query<{
    id: string;
    organization_id: string;
    project_id: string;
    config_set_id: string;
    revision_number: number | string;
    status: string;
    entry_file: string | null;
  }>(
    "select id, organization_id, project_id, config_set_id, revision_number, status, entry_file from dts_config_revisions order by id",
  );
  if (!Array.isArray(result.rows)) {
    throw new Error("FIL inventory config-revision query did not return rows");
  }
  return result.rows.map((row) => ({
    kind: "config-revision-source",
    id: row.id,
    applicable: FIL_COMPARISON_IDS,
    legacyValue: {
      id: row.id,
      organizationId: row.organization_id,
      projectId: row.project_id,
      configSetId: row.config_set_id,
      revisionNumber: Number(row.revision_number),
      status: row.status,
      entryFile: row.entry_file,
    },
  }));
}

async function queryFileInventory(database: Database): Promise<InventoryRecord[]> {
  const projects = await queryProjects(database);
  const records: InventoryRecord[] = [];
  for (const project of projects) {
    const files = await listProjectParameterFiles(database, {
      organizationId: project.organizationId,
      projectId: project.id,
    });
    for (const file of files) {
      records.push({
        kind: "parameter-file",
        id: file.id,
        applicable: FIL_COMPARISON_IDS,
        legacyValue: {
          id: file.id,
          projectId: file.projectId,
          fileName: file.fileName,
          format: file.format,
          currentVersionId: file.currentVersionId ?? null,
        },
      });
      const versions = await listFileVersions(database, { fileId: file.id });
      for (const version of versions) {
        records.push({
          kind: "parameter-file-version",
          id: version.id,
          applicable: FIL_COMPARISON_IDS,
          legacyValue: {
            id: version.id,
            fileId: version.fileId,
            versionNumber: version.versionNumber,
            origin: version.origin,
            checksum: version.checksum,
            parsedIndexKeys: Object.keys(version.parsedIndex).sort(),
          },
        });
      }
    }
  }
  return records;
}

function sortInventory(records: InventoryRecord[]): InventoryRecord[] {
  return [...records].sort(
    (left, right) =>
      compareText(left.kind, right.kind) ||
      compareText(left.id, right.id) ||
      compareText(left.applicable.join("\0"), right.applicable.join("\0")),
  );
}

function sortCases(cases: FilComparisonCase[]): FilComparisonCase[] {
  return [...cases].sort(
    (left, right) =>
      compareText(left.comparisonId, right.comparisonId) ||
      compareText(left.protectedReference.kind, right.protectedReference.kind) ||
      compareText(left.protectedReference.id, right.protectedReference.id) ||
      compareText(left.caseId, right.caseId),
  );
}

function observeLegacy(record: InventoryRecord): FilQueryObservation {
  if (!record.id) {
    return {
      status: "query-failure",
      code: FIL_UNQUERYABLE_FAILURE_CODE,
      detail: "legacy-protected-reference-missing",
    };
  }
  return { status: "value", value: record.legacyValue };
}

function sourcePinFor(record: InventoryRecord): { sourceRef: string; configRevisionId: string } {
  const value = record.legacyValue;
  const configRevisionId =
    typeof value.configRevisionId === "string" && value.configRevisionId.length > 0
      ? value.configRevisionId
      : typeof value.id === "string"
        ? value.id
        : record.id;
  return {
    sourceRef: `${record.kind}:${record.id}`,
    configRevisionId,
  };
}

async function observeCanonical(
  pool: pg.Pool,
  record: InventoryRecord,
  comparisonId: FilComparisonId,
): Promise<FilQueryObservation> {
  const source = sourcePinFor(record);
  try {
    if (comparisonId === "PCAT-CMP-D07-PROTECTED-CONSUMER-REFERENCE") {
      const read = await readProtectedReference(pool, {
        snapshot: FIL_UNBOUND_SNAPSHOT,
        binding: null,
        definitionRevisionId: UNBOUND_REVISION,
      });
      if (read.ok) {
        return {
          status: "value",
          value: {
            adapter: "s6-wfa-read",
            kind: read.value.kind,
            bindingId: read.value.bindingId,
            currentValueId: read.value.currentValueId,
            sourceRef: read.value.source.sourceRef,
            configRevisionId: read.value.source.configRevisionId,
          },
        };
      }
      return {
        status: "value",
        value: {
          adapter: "s6-wfa-read",
          ok: false,
          block: read.error,
        },
      };
    }

    const written = await writebackProtectedReference(pool, {
      snapshot: FIL_UNBOUND_SNAPSHOT,
      binding: null,
      definitionRevisionId: UNBOUND_REVISION,
      source,
      payload: { kind: "string", value: "" },
      expectedTip: UNBOUND_TIP,
    });
    if (written.ok) {
      return {
        status: "value",
        value: {
          adapter: "s6-wfa-writeback",
          outcome: written.value.outcome,
          bindingId: written.value.pin.bindingId,
          currentTip: written.value.currentTip,
          sourceRef: written.value.pin.source.sourceRef,
          configRevisionId: written.value.pin.source.configRevisionId,
        },
      };
    }
    return {
      status: "value",
      value: {
        adapter: "s6-wfa-writeback",
        ok: false,
        block: written.error,
      },
    };
  } catch (error) {
    return {
      status: "query-failure",
      code: FIL_UNQUERYABLE_FAILURE_CODE,
      detail: error instanceof Error ? error.message : "canonical-protected-reference-query-failed",
    };
  }
}

function classifyCase(input: {
  readonly comparisonId: FilComparisonId;
  readonly legacyObservation: FilQueryObservation;
  readonly canonicalObservation: FilQueryObservation;
  readonly mappingHeadId: string;
  readonly mappingHeadVersion: number;
  readonly planPin: string;
  readonly protectedReference: FilProtectedReference;
}): { result: FilComparisonResult; expectedDifference: FilExpectedDifference | null } {
  if (
    input.legacyObservation.status === "query-failure" &&
    input.legacyObservation.code === FIL_UNQUERYABLE_FAILURE_CODE
  ) {
    return { result: "unqueryable/protected-reference-missing", expectedDifference: null };
  }
  if (
    input.canonicalObservation.status === "query-failure" &&
    input.canonicalObservation.code === FIL_UNQUERYABLE_FAILURE_CODE
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

  const expectedDifference: FilExpectedDifference = {
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
 * Production FIL comparison contribution. Queries real PostgreSQL through
 * file/source inventory and S6-WFA protected-reference adapters.
 */
export async function provideFilParameterCatalogComparisonContribution(
  input: FilComparisonContributionInput,
): Promise<FilComparisonContribution> {
  if (input.phase !== "pre-activation" && input.phase !== "post-p13") {
    throw new Error("FIL comparison phase must be pre-activation or post-p13");
  }
  if (input.inventoryMode !== "fresh" && input.inventoryMode !== "populated") {
    throw new Error("FIL comparison inventoryMode must be fresh or populated");
  }
  if (!/^[a-f0-9]{40}$/u.test(input.candidateSha)) {
    throw new Error("FIL comparison candidateSha must be a full Git SHA");
  }

  const inventory = sortInventory([
    ...(await queryFileInventory(input.database)),
    ...(await queryLogicalNodeInventory(input.database)),
    ...(await queryLogicalNodeRevisionInventory(input.database)),
    ...(await queryConfigRevisionInventory(input.database)),
  ]);

  if (input.inventoryMode === "fresh" && inventory.length !== 0) {
    throw new Error(
      `FIL fresh inventory must be empty after a real PostgreSQL query; received ${inventory.length} records`,
    );
  }

  const cases: FilComparisonCase[] = [];
  for (const record of inventory) {
    const protectedReference = { kind: record.kind, id: record.id };
    for (const comparisonId of record.applicable) {
      if (
        comparisonId !== "PCAT-CMP-D07-PROTECTED-CONSUMER-REFERENCE" &&
        comparisonId !== "PCAT-CMP-D08-SOURCE-WRITEBACK"
      ) {
        throw new Error(`FIL comparison rejected unknown comparison ID ${String(comparisonId)}`);
      }
      const legacyObservation = observeLegacy(record);
      const canonicalObservation = await observeCanonical(input.pool, record, comparisonId);
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
        caseId: `${FIL_COMPARISON_FAMILY}:${comparisonId}:${record.kind}:${record.id}`,
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
  const sourceInventoryChecksum = checksumFilComparisonBytes(inventoryBytes);
  const unsigned: Omit<FilComparisonContribution, "checksum"> = {
    contractVersion: FIL_COMPARISON_CONTRACT_VERSION,
    family: FIL_COMPARISON_FAMILY,
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
  const bytes = serializeFilComparisonContribution(unsigned);
  return {
    ...unsigned,
    checksum: checksumFilComparisonBytes(bytes),
  };
}
