import { createHash } from "node:crypto";

import {
  COMPARISON_CONTRIBUTION_CONTRACT_VERSION,
  COMPARISON_FAMILIES,
  FAMILY_COMPARISON_IDS,
  checksumComparisonContribution,
  compareComparisonCases,
  type AggregationContext,
  type ComparisonCase,
  type ComparisonContribution,
  type ComparisonFamily,
  type ComparisonId,
  type ComparisonResultClass,
} from "./corpusContributionSchema";

export const FRESH_PRE_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const FRESH_POST_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
export const POP_PRE_SHA = "cccccccccccccccccccccccccccccccccccccccc";
export const POP_POST_SHA = "dddddddddddddddddddddddddddddddddddddddd";

export function aggregationContext(
  inventoryMode: AggregationContext["inventoryMode"],
  phase: AggregationContext["phase"],
  candidateSha: string,
): AggregationContext {
  return {
    phase,
    inventoryMode,
    candidateSha,
    planPin: `plan-${phase}-${inventoryMode}`,
    mappingHeadId: `map-${phase}-${inventoryMode}`,
    mappingHeadVersion: phase === "pre-activation" ? 1 : 2,
    mappingHeadChecksum: createHash("sha256").update(`${phase}:${inventoryMode}`).digest("hex"),
    catalogSnapshotChecksum: createHash("sha256")
      .update(`catalog:${phase}:${inventoryMode}`)
      .digest("hex"),
  };
}

function emptyInventoryChecksum(): string {
  return createHash("sha256").update("[]\n").digest("hex");
}

export function makeCase(
  family: ComparisonFamily,
  comparisonId: ComparisonId,
  context: AggregationContext,
  id = "ref-1",
  result: ComparisonResultClass = "declared-expected-difference",
): ComparisonCase {
  const protectedReference = { kind: `kind-${family.toLowerCase()}`, id };
  if (result === "unqueryable/protected-reference-missing") {
    return {
      caseId: `${family}:${comparisonId}:${protectedReference.kind}:${id}`,
      comparisonId,
      protectedReference,
      legacyObservation: {
        status: "query-failure",
        code: "PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE",
        detail: "missing",
      },
      canonicalObservation: { status: "value", value: { id } },
      result,
      expectedDifference: null,
    };
  }
  if (result === "unexplained-difference") {
    return {
      caseId: `${family}:${comparisonId}:${protectedReference.kind}:${id}`,
      comparisonId,
      protectedReference,
      legacyObservation: { status: "value", value: { side: "legacy" } },
      canonicalObservation: { status: "value", value: { side: "canonical" } },
      result,
      expectedDifference: null,
    };
  }
  if (result === "exact-equivalent") {
    return {
      caseId: `${family}:${comparisonId}:${protectedReference.kind}:${id}`,
      comparisonId,
      protectedReference,
      legacyObservation: { status: "value", value: { id, family } },
      canonicalObservation: { status: "value", value: { id, family } },
      result,
      expectedDifference: null,
    };
  }
  return {
    caseId: `${family}:${comparisonId}:${protectedReference.kind}:${id}`,
    comparisonId,
    protectedReference,
    legacyObservation: { status: "value", value: { id, family, side: "legacy" } },
    canonicalObservation: { status: "value", value: { id, family, side: "canonical" } },
    result,
    expectedDifference: {
      rClass: "R9",
      mappingHeadId: context.mappingHeadId,
      mappingHeadVersion: context.mappingHeadVersion,
      typedTarget: protectedReference,
      ruleId: comparisonId,
      planPin: context.planPin,
    },
  };
}

export function makeContribution(
  family: ComparisonFamily,
  context: AggregationContext,
  options: {
    readonly cases?: readonly ComparisonCase[];
    readonly sourceInventoryCount?: number;
    readonly checksum?: string;
  } = {},
): ComparisonContribution {
  const mappedIds = FAMILY_COMPARISON_IDS[family];
  const cases = [
    ...(options.cases ??
      (context.inventoryMode === "fresh"
        ? []
        : mappedIds.map((comparisonId) => makeCase(family, comparisonId, context)))),
  ].sort((left, right) => compareComparisonCases({ ...left, family }, { ...right, family }));
  const uniqueRefs = new Set(
    cases.map((item) => `${item.protectedReference.kind}\0${item.protectedReference.id}`),
  );
  const unsigned: Omit<ComparisonContribution, "checksum"> = {
    contractVersion: COMPARISON_CONTRIBUTION_CONTRACT_VERSION,
    family,
    phase: context.phase,
    inventoryMode: context.inventoryMode,
    candidateSha: context.candidateSha,
    planPin: context.planPin,
    mappingHeadId: context.mappingHeadId,
    mappingHeadVersion: context.mappingHeadVersion,
    mappingHeadChecksum: context.mappingHeadChecksum,
    catalogSnapshotChecksum: context.catalogSnapshotChecksum,
    sourceInventoryCount: options.sourceInventoryCount ?? uniqueRefs.size,
    sourceInventoryChecksum: emptyInventoryChecksum(),
    cases,
  };
  return {
    ...unsigned,
    checksum: options.checksum ?? checksumComparisonContribution(unsigned),
  };
}

export function makeFamilyContributions(
  context: AggregationContext,
): ComparisonContribution[] {
  return COMPARISON_FAMILIES.map((family) => makeContribution(family, context));
}
