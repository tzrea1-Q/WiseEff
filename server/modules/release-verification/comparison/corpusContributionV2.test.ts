import { expect, it } from "vitest";
import { checksumCanonicalBytes, serializeCanonical } from "./corpusContributionSchema";
import { parseComparisonContributionV2 } from "./index";

function codecFixture() {
  // Codec-only fixture. Rule/mapping issuance is checked by the live owner,
  // never established by accepting this structurally valid document.
  const context = { phase: "pre-activation", inventoryMode: "populated", candidateSha: "a".repeat(40),
    planPin: `sha256:${"b".repeat(64)}`, catalogSnapshotChecksum: "c".repeat(64),
    mappingSnapshot: { epoch: `sha256:${"d".repeat(64)}`, headDigest: `sha256:${"e".repeat(64)}` } } as const;
  const unsigned = { ...context, contractVersion: "pcat-comparison-contribution/v2", family: "KNW",
    sourceInventoryCount: 2, sourceInventoryChecksum: "f".repeat(64), cases: [1, 2].map(n => ({
      caseId: `case-${n}`, comparisonId: "PCAT-CMP-D07-PROTECTED-CONSUMER-REFERENCE",
      protectedReference: { kind: "knowledge-reference", id: `reference-${n}` },
      legacyObservation: { status: "value", value: { state: "legacy" } },
      canonicalObservation: { status: "value", value: { state: "archived" } },
      result: "declared-expected-difference", expectedDifference: {
        sourceIdentity: { legacyIdentityId: `identity-${n}`, sourceSystem: "wiseeff-v1", sourceKind: "parameter-spec",
          ownerScopeKind: "organization", ownerScopeId: "organization-a", sourceId: `spec-${n}` },
        rClass: "R7", mappingVersionId: `mapping-${n}`, headVersion: n,
        headDigest: `sha256:${String(n).repeat(64)}`, Archive: { id: `archive-${n}` },
        ruleId: `pcat-p11-archive-reference:identity-${n}`, planPin: context.planPin,
      },
    })) };
  const contribution = { ...unsigned, checksum: checksumCanonicalBytes(serializeCanonical(unsigned)) };
  return { contribution, context };
}

it("decodes distinct identity heads without relabeling the complete snapshot as either head", () => {
  const { contribution, context } = codecFixture();
  expect(parseComparisonContributionV2(contribution, context)).toEqual(contribution);
});

it.each(["v1 envelope", "shared head", "both dispositions", "unknown source field", "unknown snapshot field", "negative zero"])(
  "refuses %s even when the changed document is checksummed", change => {
    const { contribution, context } = codecFixture();
    const first = contribution.cases[0]!;
    if (change === "v1 envelope") contribution.contractVersion = "pcat-comparison-contribution/v1";
    if (change === "shared head") Reflect.set(contribution, "mappingHeadId", "invented-shared-head");
    if (change === "both dispositions") Reflect.set(first.expectedDifference, "typedTarget", { kind: "parameter-definition", id: "definition" });
    if (change === "unknown source field") Reflect.set(first.expectedDifference.sourceIdentity, "ownerApproved", true);
    if (change === "unknown snapshot field") Reflect.set(contribution.mappingSnapshot, "headVersion", 1);
    if (change === "negative zero") Reflect.set(first.legacyObservation.value, "numericValue", -0);
    const { checksum: _checksum, ...unsigned } = contribution;
    contribution.checksum = checksumCanonicalBytes(serializeCanonical(unsigned));
    expect(() => parseComparisonContributionV2(contribution, context)).toThrow();
  },
);
