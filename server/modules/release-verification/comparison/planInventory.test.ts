import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../../../shared/database/client";
import type { MappingSourceIdentity } from "../../catalog-cutover/mapping";

// Owner projection doubles isolate the cross-family join. These tests do not
// prove PostgreSQL snapshot custody, identity issuance, or a passing report.
const state = vi.hoisted(() => ({ cgh: [] as unknown[], knw: [] as unknown[], identities: [] as unknown[] }));
vi.mock("../../parameter-specs/parameterCatalogComparisonContribution", () => ({ readCghComparisonSourceInventory: async () => state.cgh }));
vi.mock("../../knowledge/parameterCatalogComparisonContribution", () => ({ readKnwComparisonSourceInventory: async () => state.knw }));
vi.mock("../../agent/parameterCatalogComparisonContribution", () => ({ readAgtComparisonSourceInventory: async () => [] }));
vi.mock("../../debugging/parameterCatalogComparisonContribution", () => ({ readDbgComparisonSourceInventory: async () => [] }));
vi.mock("../../dts-reload/parameterCatalogComparisonContribution", () => ({ readDtsComparisonSourceInventory: async () => [] }));
vi.mock("../../logs/parameterCatalogComparisonContribution", () => ({ readLogComparisonSourceInventory: async () => [] }));
vi.mock("../../operations/parameterCatalogComparisonContribution", () => ({ readOpsComparisonSourceInventory: async () => [] }));
vi.mock("../../parameter-files/parameterCatalogComparisonContribution", () => ({ readFilComparisonSourceInventory: async () => [] }));
vi.mock("../../parameter-modules/parameterCatalogComparisonContribution", () => ({ readModComparisonSourceInventory: async () => [] }));
vi.mock("../../parameter-topology/parameterCatalogComparisonContribution", () => ({ readTopComparisonSourceInventory: async () => [] }));
vi.mock("../../parameters/parameterCatalogComparisonContribution", () => ({ readPrjComparisonSourceInventory: async () => [] }));
import { readComparisonSourceInventory } from "./planInventory";

const identity = { legacyIdentityId: "identity-spec", sourceSystem: "fixture-source", sourceKind: "parameter-spec",
  sourceId: "spec", ownerScopeKind: "platform", ownerScopeId: "platform" };
const spec = () => ({ kind: "parameter-definition-spec", id: "spec", applicable: ["PCAT-CMP-D01-DEFINITION-SEMANTICS"],
  sourceReferences: [{ sourceKind: "parameter-spec", sourceId: "spec", ownerScopeKind: "platform", ownerScopeId: "platform" }],
  sourceObservations: [{ organizationId: "organization-a", value: { id: "spec", organizationId: null } }] });
const read = () => readComparisonSourceInventory({} as Database, state.identities as MappingSourceIdentity[]);
beforeEach(() => {
  state.cgh = [spec()]; state.identities = [identity];
  state.knw = [{ kind: "knowledge-parameter-reference", id: "reference", sourceId: "spec", organizationId: "organization-a",
    applicable: ["PCAT-CMP-D07-PROTECTED-CONSUMER-REFERENCE"] }];
});
describe("P0 joins the actual KNW foreign key to the captured CGH owner", () => {
  it("retains the consumer reference and uses the referenced platform owner", async () => {
    const row = (await read()).KNW[0]!;
    expect(row.id).toBe("reference");
    expect(row.sourceReferences).toEqual([identity]);
  });
  it("refuses a missing referenced spec instead of substituting the reference ID", async () => {
    state.cgh = [];
    await expect(read()).rejects.toThrow();
  });
  it("refuses a spec not actually observed in the reference organization", async () => {
    state.cgh = [{ ...spec(), sourceObservations: [{ organizationId: "organization-b", value: { id: "spec", organizationId: null } }] }];
    await expect(read()).rejects.toThrow();
  });
  it("refuses an organization owner from another scope", async () => {
    state.cgh = [{ ...spec(), sourceReferences: [{ sourceKind: "parameter-spec", sourceId: "spec", ownerScopeKind: "organization", ownerScopeId: "organization-b" }] }];
    state.identities = [{ ...identity, ownerScopeKind: "organization", ownerScopeId: "organization-b" }];
    await expect(read()).rejects.toThrow();
  });
  it("refuses two source systems for the same unresolved source tuple", async () => {
    state.identities.push({ ...identity, legacyIdentityId: "other-identity", sourceSystem: "other-source" });
    await expect(read()).rejects.toThrow();
  });
});
