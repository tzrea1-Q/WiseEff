import { beforeEach, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import type { Database } from "../../../shared/database/client";
import type { ComparisonP0Rules } from "../../catalog-cutover/comparisonRules";
import type { MappingSnapshotMember } from "../../catalog-cutover/mapping";
import { digestOf } from "../core/digest";
import { COMPARISON_FAMILIES, checksumCanonicalBytes, serializeCanonical } from "./corpusContributionSchema";

// Actual collector/codec with explicit owner-read doubles. This is not a
// PostgreSQL snapshot, trusted P0 issuance, or successful whole report.
const owned = vi.hoisted(() => ({ value: {} as Record<string, any>, reads: [] as string[] }));
vi.mock("./databaseSource", () => ({ assertComparisonDatabaseSource: () => undefined }));
vi.mock("../../../shared/database/client", () => ({ getRootPostgresPool: (database: unknown) => database === owned.value.database ? owned.value.pool : undefined }));
vi.mock("../../catalog-cutover/comparisonRules", () => ({ readCommittedComparisonPlan: async () => structuredClone(owned.value.plan) }));
vi.mock("../../catalog-cutover/activation", () => ({ readComparisonMappingFactsOnHeldSession: async () => structuredClone(owned.value.facts) }));
vi.mock("../../catalog-cutover/mapping", async importOriginal => ({ ...await importOriginal<object>(), readMappingSnapshot: async () => structuredClone(owned.value.snapshot) }));
vi.mock("./planInventory", () => ({ readComparisonSourceInventory: async () => {
  owned.reads.push(...Object.keys(owned.value.source)); return structuredClone(owned.value.source);
} }));
vi.mock("../../parameter-specs/parameterCatalogComparisonContribution", () => ({
  readComparisonNativeInventory: async () => {
    if (owned.value.nativeError) throw owned.value.nativeError;
    return structuredClone(owned.value.native);
  },
  readCghComparisonOperatorOutcome: async (_database: unknown, sourceId: string) => structuredClone(owned.value.operators[sourceId]),
}));
import { collectProductionComparisonContributionsV2, readProductionComparisonContextV2, type ComparisonProviderInputV2 } from "./productionProviders";

const checksum = (value: unknown) => checksumCanonicalBytes(serializeCanonical(value));
const hash = (value: unknown) => digestOf(value);
let input: ComparisonProviderInputV2;
beforeEach(() => {
  const database = {} as Database, pool = {} as pg.Pool;
  const members: MappingSnapshotMember[] = [1, 2].map(n => {
    const sourceIdentity = { legacyIdentityId: `identity-${n}`, sourceSystem: "wiseeff-v1", sourceKind: "parameter-spec" as const,
      ownerScopeKind: "platform" as const, ownerScopeId: "platform", sourceId: `spec-${n}` };
    const head = { legacyIdentityId: sourceIdentity.legacyIdentityId, currentVersionId: `version-${n}`, casVersion: n + 4,
      version: { id: `version-${n}`, legacyIdentityId: sourceIdentity.legacyIdentityId, cutoverRunId: "run", versionNumber: n + 2,
        sourceChecksum: hash(`source-${n}`), graphFingerprint: hash("graph"), rClass: "R9" as const,
        targetKind: "parameter-definition" as const, targetId: `definition-${n}`, archiveId: null, evidenceArchiveId: null, supersedesVersionId: null } };
    return { sourceIdentity, head, headDigest: hash(head) };
  });
  const records = members.map(member => ({ kind: "parameter-definition-spec", id: member.sourceIdentity.sourceId,
    applicable: ["PCAT-CMP-D01-DEFINITION-SEMANTICS", "PCAT-CMP-D09-LEGACY-OPERATOR-OUTCOME"], sourceReferences: [member.sourceIdentity],
    sourceObservations: [{ organizationId: "org", value: { id: member.sourceIdentity.sourceId, valueShape: { type: "integer" } } }] }));
  const source = Object.fromEntries(COMPARISON_FAMILIES.map(family => [family, family === "CGH" ? records : []]));
  const native = members.map(member => ({ kind: member.head.version.targetKind, id: member.head.version.targetId,
    organizationId: "org", value: { id: member.head.version.targetId, shape: { type: "integer" } } }));
  const rules = { cases: records.flatMap((record, index) => record.applicable.map(comparisonId => ({ family: "CGH", comparisonId,
    protectedReference: { kind: record.kind, id: record.id }, inputChecksum: hash(record), ruleId: `P0-rule-${index}-${comparisonId}`,
    identities: [{ sourceIdentity: members[index]!.sourceIdentity, rClass: "R9", disposition: "mapped" }] }))),
    inventory: { binding: { sourceSystem: "wiseeff-v1", target: { systemIdentifier: "100", databaseOid: "101" } },
      families: COMPARISON_FAMILIES.map(family => ({ family, sourceInventoryCount: source[family]!.length, sourceInventoryChecksum: checksum(source[family]) })) } } as ComparisonP0Rules;
  const snapshot = { members, headDigest: hash("complete-head-set"), versionInventoryDigest: hash("complete-version-set") };
  const context = { phase: "pre-activation" as const, inventoryMode: "populated" as const, candidateSha: "a".repeat(40),
    planPin: hash("plan"), mappingSnapshot: { epoch: hash("persisted-epoch"), headDigest: snapshot.headDigest }, catalogSnapshotChecksum: checksum(native) };
  input = { ...context, database, pool, managementClient: {} as pg.PoolClient, cutoverRunId: "run",
    target: rules.inventory.binding.target, verifyBoundary: vi.fn(async () => undefined) };
  owned.value = { database, pool, source, native, snapshot,
    plan: { planDigest: context.planPin, targetArtifactSha: context.candidateSha, sourceSnapshotFingerprint: hash("graph"), comparisonRules: rules },
    facts: { mapping: context.mappingSnapshot, versionInventoryDigest: snapshot.versionInventoryDigest,
      candidateSha: context.candidateSha, sourceSnapshotFingerprint: hash("graph"), runPhase: "P10", runState: "completed", currentBinding: null },
    operators: Object.fromEntries(members.map(member => [member.sourceIdentity.sourceId, [{ organizationId: "org", retired: { status: 410 },
      successor: { kind: "mapped", item: { legacyType: "parameter-spec", legacyId: member.sourceIdentity.sourceId,
        target: { kind: member.head.version.targetKind, id: member.head.version.targetId } } } }]])) };
  owned.reads = [];
});

describe("v2 collection separates whole snapshot from each actual head", () => {
  it("retains all eleven observed families and distinct per-source versions/CAS/digests", async () => {
    const contributions = await collectProductionComparisonContributionsV2(input);
    expect(owned.reads).toEqual(COMPARISON_FAMILIES);
    expect(contributions.map(row => row.family)).toEqual(COMPARISON_FAMILIES);
    expect(contributions.slice(1).every(row => row.sourceInventoryCount === 0 && row.cases.length === 0)).toBe(true);
    const expected = contributions[0]!.cases.filter(row => row.comparisonId === "PCAT-CMP-D09-LEGACY-OPERATOR-OUTCOME").map(row => row.expectedDifference);
    expect(expected.map(row => row?.mappingVersionId)).toEqual(["version-1", "version-2"]);
    expect(expected.map(row => row?.headVersion)).toEqual([5, 6]);
    expect(expected.map(row => row?.headDigest)).toEqual(owned.value.snapshot.members.map((member: MappingSnapshotMember) => member.headDigest));
    // Current D01 owner DTOs are not semantic equality; D09's real protocol
    // observation must not silently authorize their unrelated inequality.
    expect(contributions[0]!.cases.filter(row => row.comparisonId === "PCAT-CMP-D01-DEFINITION-SEMANTICS").every(row => row.result === "unexplained-difference" && row.expectedDifference === null)).toBe(true);
  });
  it("reads context independently from actual epoch and canonical bytes", async () => {
    const observed = await readProductionComparisonContextV2(input);
    expect(observed.mappingSnapshot).toEqual(input.mappingSnapshot);
    expect(observed.catalogSnapshotChecksum).toBe(checksum(owned.value.native));
    owned.value.native.push({ kind: "catalog-subject", id: "new", organizationId: "org", value: {} });
    expect((await readProductionComparisonContextV2(input)).catalogSnapshotChecksum).not.toBe(observed.catalogSnapshotChecksum);
    expect(observed.catalogSnapshotChecksum).toBe(input.catalogSnapshotChecksum);
  });
  it.each(["owner", "run", "rClass", "graph"] as const)("refuses %s drift instead of inventing expected evidence", async field => {
    const member = owned.value.snapshot.members[1];
    if (field === "owner") member.sourceIdentity.ownerScopeId = "other";
    if (field === "run") member.head.version.cutoverRunId = "other";
    if (field === "rClass") member.head.version.rClass = "R10";
    if (field === "graph") member.head.version.graphFingerprint = hash("other graph");
    await expect(collectProductionComparisonContributionsV2(input)).rejects.toThrow();
  });
  it("does not upgrade an actual legacy lookup disagreement to a declared difference", async () => {
    owned.value.operators["spec-2"][0].successor.item.target.id = "other";
    const contribution = (await collectProductionComparisonContributionsV2(input))[0]!;
    const item = contribution.cases.find(row => row.protectedReference.id === "spec-2" && row.comparisonId === "PCAT-CMP-D09-LEGACY-OPERATOR-OUTCOME")!;
    expect(item.result).toBe("unqueryable/protected-reference-missing");
    expect(item.expectedDifference).toBeNull();
  });
  it.each(["context", "collection"] as const)("keeps private owner errors out of the %s failure", async operation => {
    owned.value.nativeError = new Error("private database URL and source payload");
    const attempt = operation === "context" ? readProductionComparisonContextV2(input) : collectProductionComparisonContributionsV2(input);
    await expect(attempt).rejects.toMatchObject({ code: "PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE" });
    await expect(attempt).rejects.not.toThrow("private database URL and source payload");
  });
});
