import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { MappingQueryable } from "./mapping";
import type { FrozenP0Graph } from "./classifier";
import type { CapturedComparisonInventory } from "../release-verification/comparison/planInventory";
import { COMPARISON_FAMILIES, checksumCanonicalBytes, serializeCanonical } from "../release-verification/comparison/corpusContributionSchema";
import { readCommittedComparisonPlan, comparisonPlanDigest } from "./comparisonRules";
import { planCutover } from "./orchestrator";

const selected = vi.hoisted(() => ({ value: {} as Record<string, unknown>, summary: {} as Record<string, unknown> }));
vi.mock("../release-verification/comparison/planInventory", () => ({
  readCapturedComparisonInventory: () => structuredClone(selected.value),
  comparisonInventorySummary: () => structuredClone(selected.summary),
  assertComparisonPlanInventoryCurrent: async () => undefined,
}));

// Stored-plan/query doubles test the read boundary. They do not establish a
// committed PostgreSQL P0, source custody, or a passing comparison.
const digest = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
const pin = digest("plan");
const candidate = "a".repeat(40);
const read = (rows: unknown[], planDigest = pin) => {
  const query = vi.fn(async () => ({ rows, rowCount: rows.length }));
  return { query, result: () => readCommittedComparisonPlan({ client: { query } as unknown as MappingQueryable,
    runId: "original-run", planDigest, candidateSha: candidate }) };
};

async function storedOwnerPlan() {
  const graph: FrozenP0Graph = { catalog: "parameter-catalog-p0-graph",
    identities: ["a", "b"].map(id => ({ id: `identity-${id}`, sourceSystem: "source", sourceKind: "parameter-spec",
      ownerScopeKind: "platform", ownerScopeId: "platform", sourceId: `spec-${id}` })),
    specs: ["a", "b"].map(id => ({ id: `spec-${id}`, organizationId: null, sourceKind: "dts", specificationKey: `unknown,${id}`,
      attributionSubjectId: null, definitionLifecycle: "active", propertyKey: `unknown,${id}` })),
    specVersions: [], subjects: [], driverRegistrations: [], nodeTypeDefinitions: [], driverSchemas: [],
    driverSchemaVersions: [], dtsPropertySpecs: [], modules: [], placements: [], bindings: [], bindingRevisions: [] };
  const records = graph.identities.map(({ id, ...source }) => ({ kind: "parameter-definition-spec", id: source.sourceId,
    applicable: ["PCAT-CMP-D01-DEFINITION-SEMANTICS"], sourceReferences: [{ legacyIdentityId: id, ...source }] }));
  const source = Object.fromEntries(COMPARISON_FAMILIES.map(family => [family, family === "CGH" ? records : []]));
  const checksum = (value: unknown) => checksumCanonicalBytes(serializeCanonical(value));
  const binding = { hostRunId: "host-run", handoffDigest: digest("handoff"), sourceSystem: "source",
    managementConfigurationDigest: digest("config"), target: { systemIdentifier: "100", databaseOid: "101" },
    sourceSha: "b".repeat(40), candidateSha: candidate };
  selected.value = { source, graph, binding };
  selected.summary = { version: "pcat-comparison-selection/v2", binding,
    families: COMPARISON_FAMILIES.map(family => ({ family, sourceInventoryCount: source[family]!.length,
      sourceInventoryChecksum: checksum(source[family]), cases: source[family]!.flatMap(record => record.applicable.map(comparisonId => ({
        comparisonId, protectedReference: { kind: record.kind, id: record.id }, inputChecksum: checksum(record),
      }))) })) };
  // Exercise the actual planner and rule producer with an explicit source
  // custody double. This is not a PostgreSQL/domain-command success fixture.
  const result = await planCutover({ graph, targetArtifactSha: candidate, targetCatalogReleaseDigest: digest("release"),
    comparisonInventory: {} as CapturedComparisonInventory,
    managementMigrationReceiptDigest: digest("management"),
    // Deliberately retain a non-schema property order in this original input.
    managementPreparation: { candidateArtifactTree: "c".repeat(40), candidateArtifactSha: candidate,
      planDigest: digest("preparation"), runId: "host-run" } });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("unit plan unavailable");
  const plan = result.value;
  return { plan, row: { runId: "original-run", planDigest: plan.planDigest, candidateSha: candidate, state: "completed",
    sourceFingerprint: plan.sourceSnapshotFingerprint, checkpointDigest: digest("checkpoint"), eventDigest: digest("checkpoint"),
    payload: { comparisonPlan: JSON.stringify(plan), comparisonRules: plan.comparisonRules, sourceSnapshotFingerprint: plan.sourceSnapshotFingerprint } } };
}
describe("P0 comparison plan must come from its exact committed owner record", () => {
  it("reads the actual planner's two-identity rules without changing nested original JSON order", async () => {
    const { plan, row } = await storedOwnerPlan();
    expect(comparisonPlanDigest(plan)).toBe(plan.planDigest);
    expect(await read([row], plan.planDigest).result()).toEqual(plan);
  });
  it.each(["candidate", "plan", "event", "rules", "state"] as const)("refuses changed %s in its stored association", async field => {
    const { plan, row } = await storedOwnerPlan();
    if (field === "candidate") row.candidateSha = "f".repeat(40);
    if (field === "plan") row.planDigest = digest("other plan");
    if (field === "event") row.eventDigest = digest("other checkpoint");
    if (field === "state") row.state = "recovery-required";
    if (field === "rules") row.payload.comparisonRules = { ...plan.comparisonRules!, digest: digest("other rules") };
    await expect(read([row], plan.planDigest).result()).rejects.toThrow("PCAT-CMP-P0-PLAN-UNAVAILABLE");
  });
  it("does not accept a missing P0 or substitute another run", async () => {
    const source = read([]);
    await expect(source.result()).rejects.toThrow("PCAT-CMP-P0-PLAN-UNAVAILABLE");
    expect(source.query.mock.calls).toHaveLength(1);
  });
  it("does not import historical P0 payloads without the original plan bytes", async () => {
    await expect(read([{ runId: "original-run", planDigest: pin, candidateSha: candidate,
      checkpointDigest: digest("checkpoint"), eventDigest: digest("checkpoint"), payload: {} }]).result())
      .rejects.toThrow("PCAT-CMP-P0-PLAN-UNAVAILABLE");
  });
  it("does not choose one of duplicate checkpoint event associations", async () => {
    await expect(read([{}, {}]).result()).rejects.toThrow("PCAT-CMP-P0-PLAN-UNAVAILABLE");
  });
  it("redacts a failed actual query instead of exposing its raw message", async () => {
    const client = { query: async () => { throw new Error("private-query-detail"); } } as unknown as MappingQueryable;
    await expect(readCommittedComparisonPlan({ client, runId: "original-run", planDigest: pin, candidateSha: candidate }))
      .rejects.toThrow(/^PCAT-CMP-P0-PLAN-UNAVAILABLE$/);
  });
});
