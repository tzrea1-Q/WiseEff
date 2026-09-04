import { createHash } from "node:crypto";
import type pg from "pg";

import type { AuthContext } from "../auth/types";
import type { Database } from "../../shared/database/client";
import {
  readProtectedReference,
  type ProtectedReadCommand,
} from "../parameter-bindings/adapters";
import { listProjectBindings } from "../parameter-topology/service";

export const DBG_COMPARISON_CONTRACT_VERSION = "pcat-comparison-contribution/v1";
export const DBG_COMPARISON_FAMILY = "DBG";

export const DBG_COMPARISON_IDS = ["PCAT-CMP-D07-PROTECTED-CONSUMER-REFERENCE"] as const;

export type DbgComparisonId = (typeof DBG_COMPARISON_IDS)[number];
export type DbgComparisonPhase = "pre-activation" | "post-p13";
export type DbgInventoryMode = "fresh" | "populated";
export type DbgComparisonResult =
  | "exact-equivalent"
  | "declared-expected-difference"
  | "unexplained-difference"
  | "unqueryable/protected-reference-missing";

export const DBG_UNQUERYABLE_FAILURE_CODE = "PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE";

export type DbgProtectedReference = {
  readonly kind: string;
  readonly id: string;
};

export type DbgQueryObservation =
  | {
      readonly status: "value";
      readonly value: Readonly<Record<string, unknown>>;
    }
  | {
      readonly status: "query-failure";
      readonly code: string;
      readonly detail: string;
    };

export type DbgExpectedDifference = {
  readonly rClass: string;
  readonly mappingHeadId: string;
  readonly mappingHeadVersion: number;
  readonly typedTarget?: { readonly kind: string; readonly id: string };
  readonly Archive?: { readonly id: string };
  readonly ruleId: string;
  readonly planPin: string;
};

export type DbgComparisonCase = {
  readonly caseId: string;
  readonly comparisonId: DbgComparisonId;
  readonly protectedReference: DbgProtectedReference;
  readonly legacyObservation: DbgQueryObservation;
  readonly canonicalObservation: DbgQueryObservation;
  readonly result: DbgComparisonResult;
  readonly expectedDifference: DbgExpectedDifference | null;
};

export type DbgComparisonContributionInput = {
  readonly database: Database;
  readonly pool: pg.Pool;
  readonly phase: DbgComparisonPhase;
  readonly inventoryMode: DbgInventoryMode;
  readonly candidateSha: string;
  readonly planPin: string;
  readonly mappingHeadId: string;
  readonly mappingHeadVersion: number;
  readonly mappingHeadChecksum: string;
  readonly catalogSnapshotChecksum: string;
};

export type DbgComparisonContribution = {
  readonly contractVersion: typeof DBG_COMPARISON_CONTRACT_VERSION;
  readonly family: typeof DBG_COMPARISON_FAMILY;
  readonly phase: DbgComparisonPhase;
  readonly inventoryMode: DbgInventoryMode;
  readonly candidateSha: string;
  readonly planPin: string;
  readonly mappingHeadId: string;
  readonly mappingHeadVersion: number;
  readonly mappingHeadChecksum: string;
  readonly catalogSnapshotChecksum: string;
  readonly sourceInventoryCount: number;
  readonly sourceInventoryChecksum: string;
  readonly cases: readonly DbgComparisonCase[];
  readonly checksum: string;
};

type InventoryRecord = DbgProtectedReference & {
  readonly applicable: readonly DbgComparisonId[];
  readonly legacyValue: Readonly<Record<string, unknown>>;
};

const UNBOUND_REVISION = "drev_dbg_unbound" as ProtectedReadCommand["definitionRevisionId"];

const DBG_UNBOUND_SNAPSHOT = {
  release: {
    id: "crel_dbg_unbound",
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

export function serializeDbgComparisonContribution(
  contribution: Omit<DbgComparisonContribution, "checksum"> | DbgComparisonContribution,
): Buffer {
  const { checksum: _checksum, ...rest } = contribution as DbgComparisonContribution;
  void _checksum;
  return Buffer.from(`${JSON.stringify(sortKeys(rest))}\n`, "utf8");
}

export function checksumDbgComparisonBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertKnownComparisonId(comparisonId: string): asserts comparisonId is DbgComparisonId {
  if (!DBG_COMPARISON_IDS.includes(comparisonId as DbgComparisonId)) {
    throw new Error(`DBG comparison rejected unknown comparison ID ${comparisonId}`);
  }
}

function inventoryAuth(organizationId: string): AuthContext {
  return {
    user: {
      id: "dbg-comparison-reader",
      organizationId,
      name: "DBG comparison",
      email: "dbg-comparison@wiseeff.local",
      title: "comparison",
      isActive: true,
    },
    organization: { id: organizationId, name: organizationId },
    roles: [{ projectId: null, roleId: "hardware-user" }],
    permissions: ["parameter:view"],
  };
}

function rowsOrThrow<Row>(result: { rows: Row[] }, label: string): readonly Row[] {
  if (!Array.isArray(result.rows)) {
    throw new Error(`DBG inventory ${label} query did not return rows`);
  }
  return result.rows;
}

async function queryProjects(database: Database): Promise<readonly { id: string; organizationId: string }[]> {
  const result = await database.query<{ id: string; organization_id: string }>(
    "select id, organization_id from projects order by id",
  );
  return rowsOrThrow(result, "project").map((row) => ({ id: row.id, organizationId: row.organization_id }));
}

async function queryDebugParameterInventory(database: Database): Promise<InventoryRecord[]> {
  const result = await database.query<{
    id: string;
    organization_id: string;
    key: string;
    node_path: string;
  }>("select id, organization_id, key, node_path from debugging_parameters order by id");
  return rowsOrThrow(result, "debug-parameter").map((row) => ({
    kind: "debug-parameter",
    id: row.id,
    applicable: DBG_COMPARISON_IDS,
    legacyValue: {
      id: row.id,
      organizationId: row.organization_id,
      key: row.key,
      nodePath: row.node_path,
    },
  }));
}

async function queryDebugNodeInventory(database: Database): Promise<InventoryRecord[]> {
  const result = await database.query<{ id: string; organization_id: string; name: string }>(
    "select id, organization_id, name from debug_nodes order by id",
  );
  return rowsOrThrow(result, "debug-node").map((row) => ({
    kind: "debug-node",
    id: row.id,
    applicable: DBG_COMPARISON_IDS,
    legacyValue: {
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
    },
  }));
}

async function queryDebugNodeBindingInventory(database: Database): Promise<InventoryRecord[]> {
  const result = await database.query<{
    id: string;
    organization_id: string;
    node_id: string;
    protocol: string;
    node_path: string;
  }>("select id, organization_id, node_id, protocol, node_path from debug_node_bindings order by id");
  return rowsOrThrow(result, "debug-node-binding").map((row) => ({
    kind: "debug-node-binding",
    id: row.id,
    applicable: DBG_COMPARISON_IDS,
    legacyValue: {
      id: row.id,
      organizationId: row.organization_id,
      nodeId: row.node_id,
      protocol: row.protocol,
      nodePath: row.node_path,
    },
  }));
}

async function queryDebugParameterBindingInventory(database: Database): Promise<InventoryRecord[]> {
  const result = await database.query<{
    id: string;
    organization_id: string;
    parameter_id: string;
    protocol: string;
    node_path: string;
  }>(
    "select id, organization_id, parameter_id, protocol, node_path from debugging_parameter_node_bindings order by id",
  );
  return rowsOrThrow(result, "debug-parameter-binding").map((row) => ({
    kind: "debug-parameter-binding",
    id: row.id,
    applicable: DBG_COMPARISON_IDS,
    legacyValue: {
      id: row.id,
      organizationId: row.organization_id,
      parameterId: row.parameter_id,
      protocol: row.protocol,
      nodePath: row.node_path,
    },
  }));
}

async function queryNodeOperationInventory(database: Database): Promise<InventoryRecord[]> {
  const result = await database.query<{
    id: string;
    organization_id: string;
    session_id: string;
    parameter_id: string | null;
    node_path: string;
    project_parameter_binding_id: string | null;
  }>(
    "select id, organization_id, session_id, parameter_id, node_path, project_parameter_binding_id from node_operations order by id",
  );
  return rowsOrThrow(result, "node-operation").map((row) => ({
    kind: "node-operation",
    id: row.id,
    applicable: DBG_COMPARISON_IDS,
    legacyValue: {
      id: row.id,
      organizationId: row.organization_id,
      sessionId: row.session_id,
      parameterId: row.parameter_id,
      nodePath: row.node_path,
      bindingId: row.project_parameter_binding_id,
    },
  }));
}

async function queryDebugSessionInventory(database: Database): Promise<InventoryRecord[]> {
  const result = await database.query<{ id: string; organization_id: string; status: string }>(
    "select id, organization_id, status from debugging_sessions order by id",
  );
  return rowsOrThrow(result, "debug-session").map((row) => ({
    kind: "debug-session",
    id: row.id,
    applicable: DBG_COMPARISON_IDS,
    legacyValue: {
      id: row.id,
      organizationId: row.organization_id,
      status: row.status,
    },
  }));
}

async function queryDebugSnapshotInventory(database: Database): Promise<InventoryRecord[]> {
  const result = await database.query<{ id: string; organization_id: string; session_id: string }>(
    "select id, organization_id, session_id from debugging_snapshots order by id",
  );
  return rowsOrThrow(result, "debug-snapshot").map((row) => ({
    kind: "debug-snapshot",
    id: row.id,
    applicable: DBG_COMPARISON_IDS,
    legacyValue: {
      id: row.id,
      organizationId: row.organization_id,
      sessionId: row.session_id,
    },
  }));
}

async function queryLogicalNodeInventory(database: Database): Promise<InventoryRecord[]> {
  const result = await database.query<{
    id: string;
    organization_id: string;
    project_id: string;
    config_set_id: string;
  }>("select id, organization_id, project_id, config_set_id from dts_logical_nodes order by id");
  return rowsOrThrow(result, "logical-node").map((row) => ({
    kind: "logical-node-source",
    id: row.id,
    applicable: DBG_COMPARISON_IDS,
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
  return rowsOrThrow(result, "logical-node-revision").map((row) => ({
    kind: "logical-node-revision-source",
    id: row.id,
    applicable: DBG_COMPARISON_IDS,
    legacyValue: {
      id: row.id,
      logicalNodeId: row.logical_node_id,
      nodeLocator: row.node_locator,
      configRevisionId: row.config_revision_id,
    },
  }));
}

async function queryBindingInventory(
  database: Database,
  projects: readonly { id: string; organizationId: string }[],
): Promise<InventoryRecord[]> {
  const records: InventoryRecord[] = [];
  for (const project of projects) {
    const listed = await listProjectBindings(database, inventoryAuth(project.organizationId), {
      projectId: project.id,
    });
    for (const item of listed.items) {
      records.push({
        kind: "project-binding",
        id: item.id,
        applicable: DBG_COMPARISON_IDS,
        legacyValue: {
          id: item.id,
          projectId: project.id,
          organizationId: project.organizationId,
          propertyKey: item.propertyKey,
          logicalNodeId: item.logicalNodeId,
        },
      });
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

function sortCases(cases: DbgComparisonCase[]): DbgComparisonCase[] {
  return [...cases].sort(
    (left, right) =>
      compareText(DBG_COMPARISON_FAMILY, DBG_COMPARISON_FAMILY) ||
      compareText(left.comparisonId, right.comparisonId) ||
      compareText(left.protectedReference.kind, right.protectedReference.kind) ||
      compareText(left.protectedReference.id, right.protectedReference.id) ||
      compareText(left.caseId, right.caseId),
  );
}

function observeLegacy(record: InventoryRecord): DbgQueryObservation {
  if (!record.id) {
    return {
      status: "query-failure",
      code: DBG_UNQUERYABLE_FAILURE_CODE,
      detail: "legacy-protected-reference-missing",
    };
  }
  return { status: "value", value: record.legacyValue };
}

async function observeCanonical(pool: pg.Pool, record: InventoryRecord): Promise<DbgQueryObservation> {
  try {
    const read = await readProtectedReference(pool, {
      snapshot: DBG_UNBOUND_SNAPSHOT,
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
          definitionRevisionId: read.value.definitionRevisionId,
          recordKind: record.kind,
          recordId: record.id,
        },
      };
    }
    return {
      status: "value",
      value: {
        adapter: "s6-wfa-read",
        ok: false,
        block: read.error,
        recordKind: record.kind,
        recordId: record.id,
      },
    };
  } catch (error) {
    return {
      status: "query-failure",
      code: DBG_UNQUERYABLE_FAILURE_CODE,
      detail: error instanceof Error ? error.message : "canonical-protected-reference-query-failed",
    };
  }
}

function classifyCase(input: {
  readonly comparisonId: DbgComparisonId;
  readonly legacyObservation: DbgQueryObservation;
  readonly canonicalObservation: DbgQueryObservation;
  readonly mappingHeadId: string;
  readonly mappingHeadVersion: number;
  readonly planPin: string;
  readonly protectedReference: DbgProtectedReference;
}): { result: DbgComparisonResult; expectedDifference: DbgExpectedDifference | null } {
  if (
    input.legacyObservation.status === "query-failure" &&
    input.legacyObservation.code === DBG_UNQUERYABLE_FAILURE_CODE
  ) {
    return { result: "unqueryable/protected-reference-missing", expectedDifference: null };
  }
  if (
    input.canonicalObservation.status === "query-failure" &&
    input.canonicalObservation.code === DBG_UNQUERYABLE_FAILURE_CODE
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

  const expectedDifference: DbgExpectedDifference = {
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
 * Production DBG comparison contribution. Queries real PostgreSQL through
 * debugging inventory and S6-WFA protected-reference adapters. Mapping head
 * identity is S7-MAP input; this provider does not import Cutover internals.
 */
export async function provideDbgParameterCatalogComparisonContribution(
  input: DbgComparisonContributionInput,
): Promise<DbgComparisonContribution> {
  if (input.phase !== "pre-activation" && input.phase !== "post-p13") {
    throw new Error("DBG comparison phase must be pre-activation or post-p13");
  }
  if (input.inventoryMode !== "fresh" && input.inventoryMode !== "populated") {
    throw new Error("DBG comparison inventoryMode must be fresh or populated");
  }
  if (!/^[a-f0-9]{40}$/u.test(input.candidateSha)) {
    throw new Error("DBG comparison candidateSha must be a full Git SHA");
  }

  const projects = await queryProjects(input.database);
  const inventory = sortInventory([
    ...(await queryDebugParameterInventory(input.database)),
    ...(await queryDebugNodeInventory(input.database)),
    ...(await queryDebugNodeBindingInventory(input.database)),
    ...(await queryDebugParameterBindingInventory(input.database)),
    ...(await queryNodeOperationInventory(input.database)),
    ...(await queryDebugSessionInventory(input.database)),
    ...(await queryDebugSnapshotInventory(input.database)),
    ...(await queryLogicalNodeInventory(input.database)),
    ...(await queryLogicalNodeRevisionInventory(input.database)),
    ...(await queryBindingInventory(input.database, projects)),
  ]);

  if (input.inventoryMode === "fresh" && inventory.length !== 0) {
    throw new Error(
      `DBG fresh inventory must be empty after a real PostgreSQL query; received ${inventory.length} records`,
    );
  }

  const cases: DbgComparisonCase[] = [];
  const seenCaseIds = new Set<string>();
  for (const record of inventory) {
    const protectedReference = { kind: record.kind, id: record.id };
    for (const comparisonId of record.applicable) {
      assertKnownComparisonId(comparisonId);
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
      if (classified.result === "unexplained-difference") {
        throw new Error("DBG comparison refused an unexplained-difference result");
      }
      const caseId = `${DBG_COMPARISON_FAMILY}:${comparisonId}:${record.kind}:${record.id}`;
      if (seenCaseIds.has(caseId)) {
        throw new Error(`Duplicate DBG comparison case: ${caseId}`);
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
  const sourceInventoryChecksum = checksumDbgComparisonBytes(inventoryBytes);
  const unsigned: Omit<DbgComparisonContribution, "checksum"> = {
    contractVersion: DBG_COMPARISON_CONTRACT_VERSION,
    family: DBG_COMPARISON_FAMILY,
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
  const bytes = serializeDbgComparisonContribution(unsigned);
  return {
    ...unsigned,
    checksum: checksumDbgComparisonBytes(bytes),
  };
}
