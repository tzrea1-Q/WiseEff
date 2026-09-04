import {
  COMPARISON_FAMILIES,
  COMPARISON_IDS,
  checksumCanonicalBytes,
  omitChecksum,
  serializeCanonical,
  type AggregationContext,
  type ComparisonCase,
  type ComparisonContribution,
  type ComparisonFamily,
  type ComparisonId,
  type ComparisonPhase,
  type ComparisonResultClass,
  type InventoryMode,
} from "./corpusContributionSchema";

export type ComparisonResultCounts = {
  readonly "exact-equivalent": number;
  readonly "declared-expected-difference": number;
  readonly "unexplained-difference": number;
  readonly "unqueryable/protected-reference-missing": number;
};

export type AggregatedComparisonCase = ComparisonCase & {
  readonly family: ComparisonFamily;
};

export type ComparisonGateCoverage = {
  readonly comparisonId: ComparisonId;
  readonly caseCount: number;
  readonly familyCoverage: readonly ComparisonFamily[];
  readonly resultCounts: ComparisonResultCounts;
};

export type FamilyInventoryBinding = {
  readonly family: ComparisonFamily;
  readonly sourceInventoryCount: number;
  readonly sourceInventoryChecksum: string;
  readonly checksum: string;
};

export type AggregatedComparisonCorpus = AggregationContext & {
  readonly contractVersion: "pcat-comparison-corpus/v1";
  readonly sourceInventoryCount: number;
  readonly sourceInventoryChecksum: string;
  readonly familyBindings: readonly FamilyInventoryBinding[];
  readonly familyChecksums: { readonly [Family in ComparisonFamily]: string };
  readonly cases: readonly AggregatedComparisonCase[];
  readonly resultCounts: ComparisonResultCounts;
  readonly checksum: string;
};

export type ComparisonReport = AggregationContext & {
  readonly contractVersion: "pcat-comparison-report/v1";
  readonly sourceInventoryCount: number;
  readonly sourceInventoryChecksum: string;
  readonly familyChecksums: { readonly [Family in ComparisonFamily]: string };
  readonly corpusChecksum: string;
  readonly coverageChecksum: string;
  readonly resultCounts: ComparisonResultCounts;
  readonly gateCoverage: readonly ComparisonGateCoverage[];
  readonly unexplainedDifferenceCount: number;
  readonly unqueryableProtectedReferenceCount: number;
  readonly decision: "passed";
  readonly failureCodes: readonly [];
  readonly checksum: string;
};

export const emptyResultCounts = (): ComparisonResultCounts => ({
  "exact-equivalent": 0,
  "declared-expected-difference": 0,
  "unexplained-difference": 0,
  "unqueryable/protected-reference-missing": 0,
});

export const incrementResultCount = (
  counts: ComparisonResultCounts,
  result: ComparisonResultClass,
): ComparisonResultCounts => ({
  ...counts,
  [result]: counts[result] + 1,
});

export const serializeComparisonCorpus = (
  corpus: Omit<AggregatedComparisonCorpus, "checksum"> | AggregatedComparisonCorpus,
): Buffer => serializeCanonical(omitChecksum(corpus as AggregatedComparisonCorpus));

export const checksumComparisonCorpus = (
  corpus: Omit<AggregatedComparisonCorpus, "checksum"> | AggregatedComparisonCorpus,
): string => checksumCanonicalBytes(serializeComparisonCorpus(corpus));

export const serializeComparisonReport = (
  report: Omit<ComparisonReport, "checksum"> | ComparisonReport,
): Buffer => serializeCanonical(omitChecksum(report as ComparisonReport));

export const checksumComparisonReport = (
  report: Omit<ComparisonReport, "checksum"> | ComparisonReport,
): string => checksumCanonicalBytes(serializeComparisonReport(report));

export const familyChecksumRecord = (
  contributions: readonly ComparisonContribution[],
): { readonly [Family in ComparisonFamily]: string } => {
  const record = {} as { [Family in ComparisonFamily]: string };
  for (const family of COMPARISON_FAMILIES) {
    const contribution = contributions.find((item) => item.family === family);
    if (!contribution) {
      record[family] = "";
      continue;
    }
    record[family] = contribution.checksum;
  }
  return record;
};

export const countResults = (
  cases: readonly Pick<ComparisonCase, "result">[],
): ComparisonResultCounts => {
  let counts = emptyResultCounts();
  for (const item of cases) {
    counts = incrementResultCount(counts, item.result);
  }
  return counts;
};

export const buildGateCoverage = (
  cases: readonly AggregatedComparisonCase[],
): readonly ComparisonGateCoverage[] =>
  COMPARISON_IDS.map((comparisonId) => {
    const matched = cases.filter((item) => item.comparisonId === comparisonId);
    const families = COMPARISON_FAMILIES.filter((family) =>
      matched.some((item) => item.family === family),
    );
    return {
      comparisonId,
      caseCount: matched.length,
      familyCoverage: families,
      resultCounts: countResults(matched),
    };
  });

export const coverageChecksumOf = (coverage: readonly ComparisonGateCoverage[]): string =>
  checksumCanonicalBytes(serializeCanonical(coverage));

export type { ComparisonFamily, ComparisonId, ComparisonPhase, InventoryMode };
