import { corpusRefusal } from "./errors";
import {
  COMPARISON_REPORT_CONTRACT_VERSION,
  checksumCanonicalBytes,
  serializeCanonical,
} from "./corpusContributionSchema";
import {
  buildGateCoverage,
  checksumComparisonReport,
  countResults,
  coverageChecksumOf,
  type AggregatedComparisonCorpus,
  type ComparisonReport,
} from "./corpusResultSchema";

export const generateComparisonReport = (
  corpus: AggregatedComparisonCorpus,
): ComparisonReport => {
  const resultCounts = countResults(corpus.cases);
  if (resultCounts["unexplained-difference"] > 0) {
    throw corpusRefusal(
      "PCAT-CMP-UNEXPLAINED-DIFFERENCE",
      `unexplained-difference count is ${resultCounts["unexplained-difference"]}`,
    );
  }
  if (resultCounts["unqueryable/protected-reference-missing"] > 0) {
    const unqueryable = corpus.cases
      .filter((item) => item.result === "unqueryable/protected-reference-missing")
      .map((item) => item.caseId);
    throw corpusRefusal(
      "PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE",
      `unqueryable/protected-reference-missing count is ${resultCounts["unqueryable/protected-reference-missing"]}: ${unqueryable.join(",")}`,
    );
  }

  const gateCoverage = buildGateCoverage(corpus.cases);
  if (gateCoverage.length !== 9) {
    throw corpusRefusal(
      "PCAT-CMP-CORPUS-COVERAGE",
      "comparison report must record all nine D01-D09 gates",
    );
  }
  if (corpus.inventoryMode === "fresh") {
    for (const gate of gateCoverage) {
      if (gate.caseCount !== 0) {
        throw corpusRefusal(
          "PCAT-CMP-FRESH-INVENTORY-NOT-ZERO",
          `${gate.comparisonId} fresh coverage is not a mode-proved zero-case result`,
        );
      }
    }
  } else if (corpus.sourceInventoryCount === 0) {
    throw corpusRefusal(
      "PCAT-CMP-CORPUS-COVERAGE",
      "populated corpus has no source inventory after family queries",
    );
  }

  const unsigned: Omit<ComparisonReport, "checksum"> = {
    contractVersion: COMPARISON_REPORT_CONTRACT_VERSION,
    phase: corpus.phase,
    inventoryMode: corpus.inventoryMode,
    candidateSha: corpus.candidateSha,
    planPin: corpus.planPin,
    mappingHeadId: corpus.mappingHeadId,
    mappingHeadVersion: corpus.mappingHeadVersion,
    mappingHeadChecksum: corpus.mappingHeadChecksum,
    catalogSnapshotChecksum: corpus.catalogSnapshotChecksum,
    sourceInventoryCount: corpus.sourceInventoryCount,
    sourceInventoryChecksum: corpus.sourceInventoryChecksum,
    familyChecksums: corpus.familyChecksums,
    corpusChecksum: corpus.checksum,
    coverageChecksum: coverageChecksumOf(gateCoverage),
    resultCounts,
    gateCoverage,
    unexplainedDifferenceCount: 0,
    unqueryableProtectedReferenceCount: 0,
    decision: "passed" as const,
    failureCodes: [] as const,
  };
  const bytes = serializeCanonical(unsigned);
  if (!bytes.toString("utf8").endsWith("\n") || bytes.toString("utf8").includes("\r")) {
    throw corpusRefusal("PCAT-CMP-REPORT-INTEGRITY", "report bytes must be UTF-8 LF with one trailing newline");
  }
  const checksum = checksumCanonicalBytes(bytes);
  const report: ComparisonReport = { ...unsigned, checksum };
  if (checksumComparisonReport(report) !== checksum) {
    throw corpusRefusal("PCAT-CMP-REPORT-INTEGRITY", "report checksum is not stable over canonical bytes");
  }
  return report;
};

export const assertIndependentPhaseReports = (
  preActivation: ComparisonReport,
  postP13: ComparisonReport,
): void => {
  if (preActivation.phase !== "pre-activation") {
    throw corpusRefusal(
      "PCAT-CMP-PHASE-REUSE",
      "first report is not the pre-activation P11 attempt",
    );
  }
  if (postP13.phase !== "post-p13") {
    throw corpusRefusal("PCAT-CMP-PHASE-REUSE", "second report is not the post-p13 P11 attempt");
  }
  if (preActivation.inventoryMode !== postP13.inventoryMode) {
    throw corpusRefusal(
      "PCAT-CMP-PHASE-REUSE",
      "phase attempts must share the target true inventoryMode",
    );
  }
  if (preActivation.checksum === postP13.checksum) {
    throw corpusRefusal("PCAT-CMP-PHASE-REUSE", "post-p13 reused the pre-activation report checksum");
  }
  if (preActivation.corpusChecksum === postP13.corpusChecksum) {
    throw corpusRefusal("PCAT-CMP-PHASE-REUSE", "post-p13 reused the pre-activation corpus checksum");
  }
  if (JSON.stringify(preActivation.familyChecksums) === JSON.stringify(postP13.familyChecksums)) {
    throw corpusRefusal(
      "PCAT-CMP-PHASE-REUSE",
      "post-p13 reused the pre-activation provider checksums",
    );
  }
};
