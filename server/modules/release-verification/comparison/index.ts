export { THREAT_MATRIX } from "./threatMatrix";
export type { ThreatMatrixId, ThreatMatrixRow } from "./threatMatrix";
export {
  ComparisonCorpusError,
  UNQUERYABLE_PROTECTED_REFERENCE_FAILURE_CODE,
  comparisonCorpusFailureCodes,
} from "./errors";
export type { ComparisonCorpusFailureCode } from "./errors";
export {
  COMPARISON_CONTRIBUTION_CONTRACT_VERSION,
  COMPARISON_CORPUS_CONTRACT_VERSION,
  COMPARISON_FAMILIES,
  COMPARISON_IDS,
  COMPARISON_REPORT_CONTRACT_VERSION,
  COMPARISON_RESULT_CLASSES,
  FAMILY_COMPARISON_IDS,
  checksumCanonicalBytes,
  checksumComparisonContribution,
  serializeCanonical,
  serializeComparisonContribution,
} from "./corpusContributionSchema";
export type {
  AggregationContext,
  ComparisonCase,
  ComparisonContribution,
  ComparisonFamily,
  ComparisonId,
  ComparisonPhase,
  ComparisonResultClass,
  ExpectedDifference,
  InventoryMode,
  ProtectedReference,
  QueryObservation,
} from "./corpusContributionSchema";
export {
  checksumComparisonCorpus,
  checksumComparisonReport,
  serializeComparisonCorpus,
  serializeComparisonReport,
} from "./corpusResultSchema";
export type {
  AggregatedComparisonCase,
  AggregatedComparisonCorpus,
  ComparisonGateCoverage,
  ComparisonReport,
  ComparisonResultCounts,
} from "./corpusResultSchema";
export {
  aggregateComparisonCorpus,
  aggregateLiveComparisonCorpus,
  collectComparisonContributions,
  productionComparisonProviders,
  registerComparisonProviders,
} from "./aggregateComparisonCorpus";
export {
  assertIndependentPhaseReports,
  generateComparisonReport,
} from "./generateComparisonReport";
export {
  createProductionComparisonProviders,
} from "./productionProviders";
export type { ComparisonProvider, ComparisonProviderInput } from "./productionProviders";
