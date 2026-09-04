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

export const AGT_COMPARISON_CONTRACT_VERSION = "pcat-comparison-contribution/v1";
export const AGT_COMPARISON_FAMILY = "AGT";

export const AGT_COMPARISON_IDS = [
  "PCAT-CMP-D07-PROTECTED-CONSUMER-REFERENCE",
  "PCAT-CMP-D08-SOURCE-WRITEBACK",
] as const;

export type AgtComparisonId = (typeof AGT_COMPARISON_IDS)[number];
export type AgtComparisonPhase = "pre-activation" | "post-p13";
export type AgtInventoryMode = "fresh" | "populated";
export type AgtComparisonResult =
  | "exact-equivalent"
  | "declared-expected-difference"
  | "unexplained-difference"
  | "unqueryable/protected-reference-missing";

export const AGT_UNQUERYABLE_FAILURE_CODE = "PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE";

export type AgtProtectedReference = {
  readonly kind: string;
  readonly id: string;
};

export type AgtQueryObservation =
  | {
      readonly status: "value";
      readonly value: Readonly<Record<string, unknown>>;
    }
  | {
      readonly status: "query-failure";
      readonly code: string;
      readonly detail: string;
    };

export type AgtExpectedDifference = {
  readonly rClass: string;
  readonly mappingHeadId: string;
  readonly mappingHeadVersion: number;
  readonly typedTarget?: { readonly kind: string; readonly id: string };
  readonly Archive?: { readonly id: string };
  readonly ruleId: string;
  readonly planPin: string;
};

export type AgtComparisonCase = {
  readonly caseId: string;
  readonly comparisonId: AgtComparisonId;
  readonly protectedReference: AgtProtectedReference;
  readonly legacyObservation: AgtQueryObservation;
  readonly canonicalObservation: AgtQueryObservation;
  readonly result: AgtComparisonResult;
  readonly expectedDifference: AgtExpectedDifference | null;
};

export type AgtComparisonContributionInput = {
  readonly database: Database;
  readonly pool: pg.Pool;
  readonly phase: AgtComparisonPhase;
  readonly inventoryMode: AgtInventoryMode;
  readonly candidateSha: string;
  readonly planPin: string;
  readonly mappingHeadId: string;
  readonly mappingHeadVersion: number;
  readonly mappingHeadChecksum: string;
  readonly catalogSnapshotChecksum: string;
};

export type AgtComparisonContribution = {
  readonly contractVersion: typeof AGT_COMPARISON_CONTRACT_VERSION;
  readonly family: typeof AGT_COMPARISON_FAMILY;
  readonly phase: AgtComparisonPhase;
  readonly inventoryMode: AgtInventoryMode;
  readonly candidateSha: string;
  readonly planPin: string;
  readonly mappingHeadId: string;
  readonly mappingHeadVersion: number;
  readonly mappingHeadChecksum: string;
  readonly catalogSnapshotChecksum: string;
  readonly sourceInventoryCount: number;
  readonly sourceInventoryChecksum: string;
  readonly cases: readonly AgtComparisonCase[];
  readonly checksum: string;
};

type InventoryRecord = AgtProtectedReference & {
  readonly applicable: readonly AgtComparisonId[];
  readonly legacyValue: Readonly<Record<string, unknown>>;
};

const UNBOUND_REVISION = "drev_agt_unbound" as ProtectedReadCommand["definitionRevisionId"];
const UNBOUND_TIP = "pval_agt_unbound" as ProtectedWritebackCommand["expectedTip"];

const AGT_UNBOUND_SNAPSHOT = {
  release: {
    id: "crel_agt_unbound",
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

export function serializeAgtComparisonContribution(
  contribution: Omit<AgtComparisonContribution, "checksum"> | AgtComparisonContribution,
): Buffer {
  const { checksum: _checksum, ...rest } = contribution as AgtComparisonContribution;
  void _checksum;
  return Buffer.from(`${JSON.stringify(sortKeys(rest))}\n`, "utf8");
}

export function checksumAgtComparisonBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function inventoryAuth(organizationId: string): AuthContext {
  return {
    user: {
      id: "agt-comparison-reader",
      organizationId,
      name: "AGT comparison",
      email: "agt-comparison@wiseeff.local",
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
    principalId: "agt-comparison-reader",
    organizationId,
    actorKind: "agent" as const,
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
    throw new Error("AGT inventory project query did not return rows");
  }
  return result.rows.map((row) => ({ id: row.id, organizationId: row.organization_id }));
}

async function queryAgentSessionInventory(database: Database): Promise<InventoryRecord[]> {
  const result = await database.query<{
    id: string;
    organization_id: string;
    project_id: string | null;
    status: string;
  }>("select id, organization_id, project_id, status from agent_sessions order by id");
  if (!Array.isArray(result.rows)) {
    throw new Error("AGT inventory session query did not return rows");
  }
  return result.rows.map((row) => ({
    kind: "agent-session",
    id: row.id,
    applicable: AGT_COMPARISON_IDS,
    legacyValue: {
      id: row.id,
      organizationId: row.organization_id,
      projectId: row.project_id,
      status: row.status,
    },
  }));
}

async function queryAgentToolCallInventory(database: Database): Promise<InventoryRecord[]> {
  const result = await database.query<{
    id: string;
    organization_id: string;
    project_id: string | null;
    name: string;
    payload: unknown;
  }>("select id, organization_id, project_id, name, payload from agent_tool_calls order by id");
  if (!Array.isArray(result.rows)) {
    throw new Error("AGT inventory tool-call query did not return rows");
  }
  return result.rows.map((row) => ({
    kind: "agent-tool-call",
    id: row.id,
    applicable: AGT_COMPARISON_IDS,
    legacyValue: {
      id: row.id,
      organizationId: row.organization_id,
      projectId: row.project_id,
      name: row.name,
      payloadKeys: row.payload && typeof row.payload === "object" ? Object.keys(row.payload as object).sort() : [],
    },
  }));
}

async function queryAgentApprovalInventory(database: Database): Promise<InventoryRecord[]> {
  const result = await database.query<{
    id: string;
    organization_id: string;
    project_id: string | null;
    tool_call_id: string;
    status: string;
  }>("select id, organization_id, project_id, tool_call_id, status from agent_approvals order by id");
  if (!Array.isArray(result.rows)) {
    throw new Error("AGT inventory approval query did not return rows");
  }
  return result.rows.map((row) => ({
    kind: "agent-approval",
    id: row.id,
    applicable: AGT_COMPARISON_IDS,
    legacyValue: {
      id: row.id,
      organizationId: row.organization_id,
      projectId: row.project_id,
      toolCallId: row.tool_call_id,
      status: row.status,
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
        applicable: AGT_COMPARISON_IDS,
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

function sortCases(cases: AgtComparisonCase[]): AgtComparisonCase[] {
  return [...cases].sort(
    (left, right) =>
      compareText(left.comparisonId, right.comparisonId) ||
      compareText(left.protectedReference.kind, right.protectedReference.kind) ||
      compareText(left.protectedReference.id, right.protectedReference.id) ||
      compareText(left.caseId, right.caseId),
  );
}

function observeLegacy(record: InventoryRecord): AgtQueryObservation {
  if (!record.id) {
    return {
      status: "query-failure",
      code: AGT_UNQUERYABLE_FAILURE_CODE,
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
  comparisonId: AgtComparisonId,
): Promise<AgtQueryObservation> {
  const source = sourcePinFor(record);
  try {
    if (comparisonId === "PCAT-CMP-D07-PROTECTED-CONSUMER-REFERENCE") {
      const read = await readProtectedReference(pool, {
        snapshot: AGT_UNBOUND_SNAPSHOT,
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
      snapshot: AGT_UNBOUND_SNAPSHOT,
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
      code: AGT_UNQUERYABLE_FAILURE_CODE,
      detail: error instanceof Error ? error.message : "canonical-protected-reference-query-failed",
    };
  }
}

function classifyCase(input: {
  readonly comparisonId: AgtComparisonId;
  readonly legacyObservation: AgtQueryObservation;
  readonly canonicalObservation: AgtQueryObservation;
  readonly mappingHeadId: string;
  readonly mappingHeadVersion: number;
  readonly planPin: string;
  readonly protectedReference: AgtProtectedReference;
}): { result: AgtComparisonResult; expectedDifference: AgtExpectedDifference | null } {
  if (
    input.legacyObservation.status === "query-failure" &&
    input.legacyObservation.code === AGT_UNQUERYABLE_FAILURE_CODE
  ) {
    return { result: "unqueryable/protected-reference-missing", expectedDifference: null };
  }
  if (
    input.canonicalObservation.status === "query-failure" &&
    input.canonicalObservation.code === AGT_UNQUERYABLE_FAILURE_CODE
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

  const expectedDifference: AgtExpectedDifference = {
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
 * Production AGT comparison contribution. Queries real PostgreSQL through
 * Agent inventory and S6-WFA protected-reference adapters.
 */
export async function provideAgtParameterCatalogComparisonContribution(
  input: AgtComparisonContributionInput,
): Promise<AgtComparisonContribution> {
  if (input.phase !== "pre-activation" && input.phase !== "post-p13") {
    throw new Error("AGT comparison phase must be pre-activation or post-p13");
  }
  if (input.inventoryMode !== "fresh" && input.inventoryMode !== "populated") {
    throw new Error("AGT comparison inventoryMode must be fresh or populated");
  }
  if (!/^[a-f0-9]{40}$/u.test(input.candidateSha)) {
    throw new Error("AGT comparison candidateSha must be a full Git SHA");
  }

  const projects = await queryProjects(input.database);
  const catalogRead = await handleCatalogRead(createReadPorts(input.pool, projects[0]?.organizationId ?? "platform"), {
    method: "GET",
    path: "/api/v2/catalog",
    params: {},
    query: {},
    headers: {},
    requestId: `agt-comparison:${input.phase}:${input.inventoryMode}`,
  });
  if (typeof catalogRead.status !== "number") {
    throw new Error("AGT comparison S8-READ query did not return a status");
  }

  const inventory = sortInventory([
    ...(await queryAgentSessionInventory(input.database)),
    ...(await queryAgentToolCallInventory(input.database)),
    ...(await queryAgentApprovalInventory(input.database)),
    ...(await queryBindingInventory(input.database, projects)),
  ]);

  if (input.inventoryMode === "fresh" && inventory.length !== 0) {
    throw new Error(
      `AGT fresh inventory must be empty after a real PostgreSQL query; received ${inventory.length} records`,
    );
  }

  const cases: AgtComparisonCase[] = [];
  for (const record of inventory) {
    const protectedReference = { kind: record.kind, id: record.id };
    for (const comparisonId of record.applicable) {
      if (
        comparisonId !== "PCAT-CMP-D07-PROTECTED-CONSUMER-REFERENCE" &&
        comparisonId !== "PCAT-CMP-D08-SOURCE-WRITEBACK"
      ) {
        throw new Error(`AGT comparison rejected unknown comparison ID ${String(comparisonId)}`);
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
        caseId: `${AGT_COMPARISON_FAMILY}:${comparisonId}:${record.kind}:${record.id}`,
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
  const sourceInventoryChecksum = checksumAgtComparisonBytes(inventoryBytes);
  const unsigned: Omit<AgtComparisonContribution, "checksum"> = {
    contractVersion: AGT_COMPARISON_CONTRACT_VERSION,
    family: AGT_COMPARISON_FAMILY,
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
  const bytes = serializeAgtComparisonContribution(unsigned);
  return {
    ...unsigned,
    checksum: checksumAgtComparisonBytes(bytes),
  };
}
