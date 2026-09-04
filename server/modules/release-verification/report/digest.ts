import { canonicalBytes, digestOf } from "../core/digest";
import type { GateResult, ReleaseVerificationReport } from "../core/types";
import { VerificationReportDigest } from "../core/types";

const resultCanonical = (result: GateResult) => ({
  evidenceDigest: result.evidenceDigest,
  failureCode: result.failureCode,
  gateId: result.gateId,
  notApplicableProof: result.notApplicableProof,
  status: result.status,
  successorPurpose: result.successorPurpose,
});

export const reportCanonicalPayload = (
  report: Omit<
    ReleaseVerificationReport,
    "id" | "digest" | "aggregateDigest" | "canonicalBytes" | "assembledAt"
  >,
) => ({
  applicabilityProfile: report.applicabilityProfile,
  attemptDigest: report.attemptDigest,
  consumerFamilyCoverageChecksum: report.consumerFamilyCoverageChecksum,
  decision: report.decision,
  evidenceDigests: report.evidenceDigests,
  evidenceRefs: report.evidenceRefs,
  mode: report.mode,
  phaseSnapshot: report.phaseSnapshot,
  pins: report.pins,
  planDigest: report.planDigest,
  pointerRollbackStatus: report.pointerRollbackStatus,
  predecessorReportDigests: report.predecessorReportDigests,
  protectedReferenceCoverageChecksum: report.protectedReferenceCoverageChecksum,
  purpose: report.purpose,
  redactionPolicy: report.redactionPolicy,
  redactionVersion: report.redactionVersion,
  registryDigest: report.registryDigest,
  results: report.results.map(resultCanonical),
  retentionDeadlineInputs: report.retentionDeadlineInputs,
  writerReachability: report.writerReachability,
});

export const canonicalReportDigest = (
  report: Omit<
    ReleaseVerificationReport,
    "id" | "digest" | "aggregateDigest" | "canonicalBytes" | "assembledAt"
  >,
): VerificationReportDigest => VerificationReportDigest(digestOf(reportCanonicalPayload(report)));

export const canonicalReportBytes = (
  report: Omit<
    ReleaseVerificationReport,
    "id" | "digest" | "aggregateDigest" | "canonicalBytes" | "assembledAt"
  >,
): string => canonicalBytes(reportCanonicalPayload(report));

export const reportDigestIsDeterministic = (report: ReleaseVerificationReport): boolean => {
  const payload = reportCanonicalPayload(report);
  const bytes = canonicalBytes(payload);
  if (bytes.includes(report.assembledAt) || bytes.includes(report.id)) {
    return false;
  }
  return digestOf(payload) === report.digest && report.digest === report.aggregateDigest;
};
