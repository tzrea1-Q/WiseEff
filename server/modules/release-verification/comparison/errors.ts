export const comparisonCorpusFailureCodes = [
  "PCAT-CMP-MISSING-FAMILY",
  "PCAT-CMP-DUPLICATE-FAMILY",
  "PCAT-CMP-UNKNOWN-FAMILY",
  "PCAT-CMP-UNKNOWN-COMPARISON-ID",
  "PCAT-CMP-CHECKSUM-INVALID",
  "PCAT-CMP-ORDER-DRIFT",
  "PCAT-CMP-SAMPLED-POPULATED",
  "PCAT-CMP-PHASE-REUSE",
  "PCAT-CMP-FRESH-INVENTORY-NOT-ZERO",
  "PCAT-CMP-CORPUS-COVERAGE",
  "PCAT-CMP-UNEXPLAINED-DIFFERENCE",
  "PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE",
  "PCAT-CMP-EXPECTED-DIFFERENCE-EVIDENCE",
  "PCAT-CMP-REPORT-INTEGRITY",
] as const;

export type ComparisonCorpusFailureCode = (typeof comparisonCorpusFailureCodes)[number];

export const UNQUERYABLE_PROTECTED_REFERENCE_FAILURE_CODE =
  "PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE" as const;

export class ComparisonCorpusError extends Error {
  readonly code: ComparisonCorpusFailureCode;

  constructor(code: ComparisonCorpusFailureCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "ComparisonCorpusError";
    this.code = code;
  }
}

export const corpusRefusal = (
  code: ComparisonCorpusFailureCode,
  detail: string,
): ComparisonCorpusError => new ComparisonCorpusError(code, detail);
