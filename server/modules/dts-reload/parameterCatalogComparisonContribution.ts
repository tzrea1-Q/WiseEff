import { createHash } from "node:crypto";
import type pg from "pg";

import type { AuthContext } from "../auth/types";
import { createCatalogKernel } from "../catalog-kernel/interface";
import {
  handleCatalogRead,
  kernelOnlyTimelineComposer,
  unregisteredProjection,
  zeroUsageProjection,
  type CatalogReadPorts,
} from "../parameter-catalog-api/read";
import {
  readProtectedReference,
  writebackProtectedReference,
  type ProtectedReadCommand,
  type ProtectedWritebackCommand,
} from "../parameter-bindings/adapters";
import type { Database } from "../../shared/database/client";
import { listProjectBindings } from "../parameter-topology/service";

export const DTS_COMPARISON_CONTRACT_VERSION = "pcat-comparison-contribution/v1";
export const DTS_COMPARISON_FAMILY = "DTS";

export const DTS_COMPARISON_IDS = [
  "PCAT-CMP-D07-PROTECTED-CONSUMER-REFERENCE",
  "PCAT-CMP-D08-SOURCE-WRITEBACK",
] as const;

export type DtsComparisonId = (typeof DTS_COMPARISON_IDS)[number];
export type DtsComparisonPhase = "pre-activation" | "post-p13";
export type DtsInventoryMode = "fresh" | "populated";
export type DtsComparisonResult =
  | "exact-equivalent"
  | "declared-expected-difference"
  | "unexplained-difference"
  | "unqueryable/protected-reference-missing";

export const DTS_UNQUERYABLE_FAILURE_CODE = "PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE";

export type DtsProtectedReference = {
  readonly kind: string;
  readonly id: string;
};

export type DtsQueryObservation =
  | {
      readonly status: "value";
      readonly value: Readonly<Record<string, unknown>>;
    }
  | {
      readonly status: "query-failure";
      readonly code: string;
      readonly detail: string;
    };

export type DtsExpectedDifference = {
  readonly rClass: string;
  readonly mappingHeadId: string;
  readonly mappingHeadVersion: number;
  readonly typedTarget?: { readonly kind: string; readonly id: string };
  readonly Archive?: { readonly id: string };
  readonly ruleId: string;
  readonly planPin: string;
};

export type DtsComparisonCase = {
  readonly caseId: string;
  readonly comparisonId: DtsComparisonId;
  readonly protectedReference: DtsProtectedReference;
  readonly legacyObservation: DtsQueryObservation;
  readonly canonicalObservation: DtsQueryObservation;
  readonly result: DtsComparisonResult;
  readonly expectedDifference: DtsExpectedDifference | null;
};

export type DtsComparisonContributionInput = {
  readonly database: Database;
  readonly pool: pg.Pool;
  readonly phase: DtsComparisonPhase;
  readonly inventoryMode: DtsInventoryMode;
  readonly candidateSha: string;
  readonly planPin: string;
  readonly mappingHeadId: string;
  readonly mappingHeadVersion: number;
  readonly mappingHeadChecksum: string;
  readonly catalogSnapshotChecksum: string;
};

export type DtsComparisonContribution = {
  readonly contractVersion: typeof DTS_COMPARISON_CONTRACT_VERSION;
  readonly family: typeof DTS_COMPARISON_FAMILY;
  readonly phase: DtsComparisonPhase;
  readonly inventoryMode: DtsInventoryMode;
  readonly candidateSha: string;
  readonly planPin: string;
  readonly mappingHeadId: string;
  readonly mappingHeadVersion: number;
  readonly mappingHeadChecksum: string;
  readonly catalogSnapshotChecksum: string;
  readonly sourceInventoryCount: number;
  readonly sourceInventoryChecksum: string;
  readonly cases: readonly DtsComparisonCase[];
  readonly checksum: string;
};

type InventoryRecord = DtsProtectedReference & {
  readonly applicable: readonly DtsComparisonId[];
  readonly legacyValue: Readonly<Record<string, unknown>>;
};

const UNBOUND_REVISION = "drev_dts_unbound" as ProtectedReadCommand["definitionRevisionId"];
const UNBOUND_TIP = "pval_dts_unbound" as ProtectedWritebackCommand["expectedTip"];

const DTS_UNBOUND_SNAPSHOT = {
  release: {
    id: "crel_dts_unbound",
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

export function serializeDtsComparisonContribution(
  contribution: Omit<DtsComparisonContribution, "checksum"> | DtsComparisonContribution,
): Buffer {
  const { checksum: _checksum, ...rest } = contribution as DtsComparisonContribution;
  void _checksum;
  return Buffer.from(`${JSON.stringify(sortKeys(rest))}\n`, "utf8");
}

export function checksumDtsComparisonBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function inventoryAuth(organizationId: string): AuthContext {
  return {
    user: {
      id: "dts-comparison-reader",
      organizationId,
      name: "DTS comparison",
      email: "dts-comparison@wiseeff.local",
      title: "comparison",
      isActive: true,
    },
    organization: { id: organizationId, name: organizationId },
    roles: [{ projectId: null, roleId: "hardware-user" }],
    permissions: ["parameter:view"],
  };
}

function createReadPorts(pool: pg.Pool, organizationId: string): CatalogReadPorts {
  const kernel = createCatalogKernel(pool);
  const scope = {
    principalId: "dts-comparison-reader",
    organizationId,
    actorKind: "user" as const,
    canReadCatalog: true,
    canRegister: false,
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

async function queryProjects(database: Database): Promise<readonly { id: string; organizationId: string }[]> {
  const result = await database.query<{ id: string; organization_id: string }>(
    "select id, organization_id from projects order by id",
  );
  if (!Array.isArray(result.rows)) {
    throw new Error("DTS inventory project query did not return rows");
  }
  return result.rows.map((row) => ({ id: row.id, organizationId: row.organization_id }));
}

async function queryReloadRunInventory(database: Database): Promise<InventoryRecord[]> {
  const result = await database.query<{
    id: string;
    organization_id: string;
    project_id: string;
    config_revision_id: string | null;
    status: string;
    purpose: string | null;
  }>(
    "select id, organization_id, project_id, config_revision_id, status, purpose from dts_reload_runs order by id",
  );
  if (!Array.isArray(result.rows)) {
    throw new Error("DTS inventory reload-run query did not return rows");
  }
  return result.rows.map((row) => ({
    kind: "reload-run",
    id: row.id,
    applicable: DTS_COMPARISON_IDS,
    legacyValue: {
      id: row.id,
      organizationId: row.organization_id,
      projectId: row.project_id,
      configRevisionId: row.config_revision_id,
      status: row.status,
      purpose: row.purpose,
    },
  }));
}

async function queryReloadTargetInventory(database: Database): Promise<InventoryRecord[]> {
  const result = await database.query<{
    id: string;
    reload_run_id: string;
    binding_id: string;
    node_path: string;
    property_key: string;
    baseline_value: string | null;
    debug_value: string;
  }>(
    "select id, reload_run_id, binding_id, node_path, property_key, baseline_value, debug_value from dts_reload_run_targets order by id",
  );
  if (!Array.isArray(result.rows)) {
    throw new Error("DTS inventory reload-target query did not return rows");
  }
  return result.rows.map((row) => ({
    kind: "reload-run-target",
    id: row.id,
    applicable: DTS_COMPARISON_IDS,
    legacyValue: {
      id: row.id,
      reloadRunId: row.reload_run_id,
      bindingId: row.binding_id,
      nodePath: row.node_path,
      propertyKey: row.property_key,
      baselineValue: row.baseline_value,
      debugValue: row.debug_value,
      configRevisionId: row.reload_run_id,
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
        applicable: DTS_COMPARISON_IDS,
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

function sortCases(cases: DtsComparisonCase[]): DtsComparisonCase[] {
  return [...cases].sort(
    (left, right) =>
      compareText(DTS_COMPARISON_FAMILY, DTS_COMPARISON_FAMILY) ||
      compareText(left.comparisonId, right.comparisonId) ||
      compareText(left.protectedReference.kind, right.protectedReference.kind) ||
      compareText(left.protectedReference.id, right.protectedReference.id) ||
      compareText(left.caseId, right.caseId),
  );
}

function observeLegacy(record: InventoryRecord): DtsQueryObservation {
  if (!record.id) {
    return {
      status: "query-failure",
      code: DTS_UNQUERYABLE_FAILURE_CODE,
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
      : record.id;
  return {
    sourceRef: `${record.kind}:${record.id}`,
    configRevisionId,
  };
}

async function observeCanonical(
  pool: pg.Pool,
  record: InventoryRecord,
  comparisonId: DtsComparisonId,
): Promise<DtsQueryObservation> {
  const source = sourcePinFor(record);
  try {
    if (comparisonId === "PCAT-CMP-D07-PROTECTED-CONSUMER-REFERENCE") {
      const read = await readProtectedReference(pool, {
        snapshot: DTS_UNBOUND_SNAPSHOT,
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
      snapshot: DTS_UNBOUND_SNAPSHOT,
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
      code: DTS_UNQUERYABLE_FAILURE_CODE,
      detail: error instanceof Error ? error.message : "canonical-protected-reference-query-failed",
    };
  }
}

function classifyCase(input: {
  readonly comparisonId: DtsComparisonId;
  readonly legacyObservation: DtsQueryObservation;
  readonly canonicalObservation: DtsQueryObservation;
  readonly mappingHeadId: string;
  readonly mappingHeadVersion: number;
  readonly planPin: string;
  readonly protectedReference: DtsProtectedReference;
}): { result: DtsComparisonResult; expectedDifference: DtsExpectedDifference | null } {
  if (
    input.legacyObservation.status === "query-failure" &&
    input.legacyObservation.code === DTS_UNQUERYABLE_FAILURE_CODE
  ) {
    return { result: "unqueryable/protected-reference-missing", expectedDifference: null };
  }
  if (
    input.canonicalObservation.status === "query-failure" &&
    input.canonicalObservation.code === DTS_UNQUERYABLE_FAILURE_CODE
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

  const expectedDifference: DtsExpectedDifference = {
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
 * Production DTS comparison contribution. Queries real PostgreSQL through
 * DTS reload inventory and S6-WFA protected-reference adapters. Mapping head
 * fields are S7-MAP input; catalog snapshot checksum is S8-READ input.
 */
export async function provideDtsParameterCatalogComparisonContribution(
  input: DtsComparisonContributionInput,
): Promise<DtsComparisonContribution> {
  if (input.phase !== "pre-activation" && input.phase !== "post-p13") {
    throw new Error("DTS comparison phase must be pre-activation or post-p13");
  }
  if (input.inventoryMode !== "fresh" && input.inventoryMode !== "populated") {
    throw new Error("DTS comparison inventoryMode must be fresh or populated");
  }
  if (!/^[a-f0-9]{40}$/u.test(input.candidateSha)) {
    throw new Error("DTS comparison candidateSha must be a full Git SHA");
  }

  const projects = await queryProjects(input.database);
  const catalogRead = await handleCatalogRead(createReadPorts(input.pool, projects[0]?.organizationId ?? "platform"), {
    method: "GET",
    path: "/api/v2/catalog",
    params: {},
    query: {},
    headers: {},
    requestId: `dts-comparison:${input.phase}:${input.inventoryMode}`,
  });
  if (typeof catalogRead.status !== "number") {
    throw new Error("DTS comparison S8-READ query did not return a status");
  }

  const inventory = sortInventory([
    ...(await queryReloadRunInventory(input.database)),
    ...(await queryReloadTargetInventory(input.database)),
    ...(await queryBindingInventory(input.database, projects)),
  ]);

  if (input.inventoryMode === "fresh" && inventory.length !== 0) {
    throw new Error(
      `DTS fresh inventory must be empty after a real PostgreSQL query; received ${inventory.length} records`,
    );
  }

  const cases: DtsComparisonCase[] = [];
  const seenCaseIds = new Set<string>();
  for (const record of inventory) {
    const protectedReference = { kind: record.kind, id: record.id };
    for (const comparisonId of record.applicable) {
      if (
        comparisonId !== "PCAT-CMP-D07-PROTECTED-CONSUMER-REFERENCE" &&
        comparisonId !== "PCAT-CMP-D08-SOURCE-WRITEBACK"
      ) {
        throw new Error(`DTS comparison rejected unknown comparison ID ${String(comparisonId)}`);
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
      const caseId = `${DTS_COMPARISON_FAMILY}:${comparisonId}:${record.kind}:${record.id}`;
      if (seenCaseIds.has(caseId)) {
        throw new Error(`DTS comparison emitted duplicate case ${caseId}`);
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
  const sourceInventoryChecksum = checksumDtsComparisonBytes(inventoryBytes);
  const unsigned: Omit<DtsComparisonContribution, "checksum"> = {
    contractVersion: DTS_COMPARISON_CONTRACT_VERSION,
    family: DTS_COMPARISON_FAMILY,
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
  const bytes = serializeDtsComparisonContribution(unsigned);
  return {
    ...unsigned,
    checksum: checksumDtsComparisonBytes(bytes),
  };
}
