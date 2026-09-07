import { isDeepStrictEqual } from "node:util";
import type pg from "pg";
import type { Database } from "../../../shared/database/client";
import { comparisonVerificationGateIds, comparisonVerificationFailureCodes } from "../../parameter-catalog-contract/index";
import { digestOf } from "../core/digest";
import { findRegistryGate, gateApplicability } from "../core/gateRegistry";
import { VerificationGateId, type GateAdapter, type GateResult, type ReleaseVerificationReport, type TypedEvidenceRef,
  type VerificationLineage, type VerificationPins, type VerificationPlan, type VerificationSubject } from "../core/types";
import { aggregateLiveComparisonCorpus } from "./aggregateComparisonCorpus";
import { COMPARISON_REPORT_CONTRACT_VERSION, type AggregationContext } from "./corpusContributionSchema";
import { checksumComparisonReport, type ComparisonReport } from "./corpusResultSchema";
import { generateComparisonReport } from "./generateComparisonReport";
import { ComparisonCorpusError, comparisonCorpusFailureCodes, type ComparisonCorpusFailureCode } from "./errors";

export const COMPARISON_EVIDENCE_PRODUCER = "release-verification/comparison/v1";
export type ComparisonEvidenceFailure = "SOURCE-UNAVAILABLE" | "BOUNDARY-MISMATCH" | "BOUNDARY-DRIFT" | "CAPTURE-FAILED" |
  "PURPOSE-UNSUPPORTED" | "MODE-UNSUPPORTED" | "ATTEMPT-REUSED" | "NOT-COMPLETE" | "REPORT-INTEGRITY" | "ASSOCIATION-MISMATCH";
export class ComparisonEvidenceRefusal extends Error {
  constructor(readonly reason: ComparisonEvidenceFailure, readonly corpusFailureCode: ComparisonCorpusFailureCode | null = null) {
    super(`PCAT-CMP-EVIDENCE-${reason}${corpusFailureCode ? `:${corpusFailureCode}` : ""}`); this.name = "ComparisonEvidenceRefusal";
  }
}
function refuse(reason: ComparisonEvidenceFailure): never { throw new ComparisonEvidenceRefusal(reason); }
const copy = <T>(value: T): T => structuredClone(value);

export type ComparisonBoundaryObservation = {
  readonly context: AggregationContext;
  readonly pins: VerificationPins;
  readonly subject: VerificationSubject;
  readonly lineage: VerificationLineage;
};
/** Installed by the owning composition root. It must hold the actual target
 * and writer fence throughout the callback and observe the database/pool it
 * supplies. No runtime option accepts report bytes, provider overrides, a
 * successful status, or a caller's claimed context-to-pin equivalence. */
export type LiveComparisonSource = {
  withBoundary(body: (reader: {
    readonly database: Database;
    readonly pool: pg.Pool;
    readonly observe: () => Promise<ComparisonBoundaryObservation>;
  }) => Promise<void>): Promise<void>;
};

type EvidenceScope = {
  readonly planDigest: string;
  readonly purpose: VerificationPlan["purpose"];
  readonly mode: VerificationPlan["mode"];
  readonly subject: VerificationSubject;
  readonly phaseSnapshot: string;
  readonly pins: VerificationPins;
};
export type ComparisonEvidenceBundle = {
  readonly report: ComparisonReport;
  readonly reportArtifactDigest: string;
  readonly evidenceRefs: readonly TypedEvidenceRef[];
};

function comparisonPhase(purpose: VerificationPlan["purpose"]): AggregationContext["phase"] {
  if (purpose === "pre-activation") return "pre-activation";
  if (purpose === "post-retirement-runtime") return "post-p13";
  return refuse("PURPOSE-UNSUPPORTED");
}
function contextMatches(context: AggregationContext, scope: EvidenceScope) {
  if (scope.mode !== "fresh" && scope.mode !== "populated") refuse("MODE-UNSUPPORTED");
  if (context.phase !== comparisonPhase(scope.purpose) || context.inventoryMode !== scope.mode ||
    context.candidateSha !== scope.pins.artifact.gitSha || context.planPin !== scope.pins.cutover.planDigest) refuse("BOUNDARY-MISMATCH");
  // mappingHeadId/version/checksum and catalogSnapshotChecksum are the source
  // owner's actual joined snapshot. Their equivalence to aggregate mapping or
  // Catalog pins cannot be inferred from names, hashes, counts or prefixes.
}
function artifactDigest(report: ComparisonReport): string {
  if (report.contractVersion !== COMPARISON_REPORT_CONTRACT_VERSION || !/^[a-f0-9]{64}$/.test(report.checksum) ||
    checksumComparisonReport(report) !== report.checksum || report.decision !== "passed" || report.failureCodes.length !== 0 ||
    report.unexplainedDifferenceCount !== 0 || report.unqueryableProtectedReferenceCount !== 0 ||
    report.gateCoverage.length !== comparisonVerificationFailureCodes.length ||
    comparisonVerificationFailureCodes.some(id => report.gateCoverage.filter(row => row.comparisonId === id).length !== 1)) refuse("REPORT-INTEGRITY");
  // Label the digest of the original Comparison UTF-8/LF bytes. Never hash
  // the object with the different core codec and call it the same artifact.
  return `sha256:${report.checksum}`;
}
function evidenceRef(report: ComparisonReport, gateId: string, scope: EvidenceScope): TypedEvidenceRef {
  const index = comparisonVerificationGateIds.findIndex(id => id === gateId);
  if (index < 0) refuse("ASSOCIATION-MISMATCH");
  const comparisonId = comparisonVerificationFailureCodes[index]!;
  return { gateId: VerificationGateId(gateId),
    digest: digestOf({ producer: COMPARISON_EVIDENCE_PRODUCER, gateId, comparisonId,
      comparisonReportChecksum: report.checksum, planDigest: scope.planDigest,
      purpose: scope.purpose, subject: scope.subject, phaseSnapshot: scope.phaseSnapshot, pins: scope.pins }),
    producer: COMPARISON_EVIDENCE_PRODUCER, purpose: scope.purpose, subject: copy(scope.subject),
    phaseSnapshot: scope.phaseSnapshot, pins: copy(scope.pins) };
}

/** Integrity/association only. The caller still obtains the applicable report
 * through the formal approval projection and verifies the current target.
 * This function performs no approval or P12/runtime/public-release action. */
export function assertComparisonEvidenceAssociation(input: {
  readonly comparisonReport: ComparisonReport;
  readonly verificationReport: ReleaseVerificationReport;
  readonly subject: VerificationSubject;
}): { readonly comparisonReportDigest: string } {
  try {
    const { comparisonReport: comparison, verificationReport: report, subject } = copy(input);
    const comparisonReportDigest = artifactDigest(comparison);
    const scope: EvidenceScope = { planDigest: report.planDigest, purpose: report.purpose, mode: report.mode,
      subject, phaseSnapshot: report.phaseSnapshot, pins: report.pins };
    contextMatches(comparison, scope);
    if (report.decision !== "passed") refuse("ASSOCIATION-MISMATCH");
    for (const gateId of comparisonVerificationGateIds) {
      const expected = evidenceRef(comparison, gateId, scope);
      const refs = report.evidenceRefs.filter(ref => ref.gateId === gateId);
      const results = report.results.filter(result => result.gateId === gateId);
      const digests = report.evidenceDigests.filter(result => result.gateId === gateId);
      if (refs.length !== 1 || !isDeepStrictEqual(refs[0], expected) || results.length !== 1 ||
        results[0]!.status !== "passed" || results[0]!.failureCode !== null || results[0]!.evidenceDigest !== expected.digest ||
        results[0]!.successorPurpose !== null || results[0]!.notApplicableProof !== null ||
        digests.length !== 1 || digests[0]!.digest !== expected.digest) refuse("ASSOCIATION-MISMATCH");
    }
    return { comparisonReportDigest };
  } catch (error) { if (error instanceof ComparisonEvidenceRefusal) throw error; return refuse("REPORT-INTEGRITY"); }
}

/** One instance per actual runVerification invocation. Each registered gate
 * can be called once; recreating an execution must rerun the live providers.
 * The core owns gate selection, report assembly and approvals. */
export function createComparisonEvidenceExecution(options: { readonly source?: LiveComparisonSource }) {
  const source = options.source;
  const used = new Set<string>();
  let plan: VerificationPlan | undefined;
  let captured: Promise<ComparisonEvidenceBundle> | undefined;
  let bundle: ComparisonEvidenceBundle | undefined;
  let failure: ComparisonEvidenceRefusal | undefined;
  const capture = async (fixed: VerificationPlan): Promise<ComparisonEvidenceBundle> => {
    if (!source || typeof source.withBoundary !== "function") refuse("SOURCE-UNAVAILABLE");
    const scope: EvidenceScope = { planDigest: fixed.digest, purpose: fixed.purpose, mode: fixed.mode,
      subject: fixed.subject, phaseSnapshot: fixed.lineage.phaseSnapshot, pins: fixed.pins };
    let issued: ComparisonEvidenceBundle | undefined;
    let entered = false;
    await source.withBoundary(async reader => {
      if (entered) refuse("BOUNDARY-MISMATCH"); entered = true;
      const { database, pool } = reader;
      const observe = reader.observe.bind(reader);
      const before = copy(await observe());
      contextMatches(before.context, scope);
      if (!isDeepStrictEqual(before.pins, fixed.pins) || !isDeepStrictEqual(before.subject, fixed.subject) ||
        !isDeepStrictEqual(before.lineage, fixed.lineage)) refuse("BOUNDARY-MISMATCH");
      const corpus = await aggregateLiveComparisonCorpus({ ...copy(before.context), database, pool });
      const report = generateComparisonReport(corpus);
      const reportArtifactDigest = artifactDigest(report);
      const after = copy(await observe());
      if (!isDeepStrictEqual(before, after)) refuse("BOUNDARY-DRIFT");
      issued = { report, reportArtifactDigest, evidenceRefs: comparisonVerificationGateIds.map(id => evidenceRef(report, id, scope)) };
    });
    if (!issued) return refuse("BOUNDARY-MISMATCH");
    return copy(issued);
  };
  const adapters = new Map<string, GateAdapter>();
  for (const registeredId of comparisonVerificationGateIds) {
    adapters.set(registeredId, async input => {
      try {
        if (failure) throw failure;
        if (!source || typeof source.withBoundary !== "function") refuse("SOURCE-UNAVAILABLE");
        const fixed = copy(input.plan);
        if (input.gateId !== registeredId || used.has(registeredId) || plan && !isDeepStrictEqual(plan, fixed)) refuse("ATTEMPT-REUSED");
        used.add(registeredId); plan ??= fixed;
        const registry = findRegistryGate(registeredId)!;
        const applicability = gateApplicability(registry, fixed.purpose, fixed.mode);
        if (applicability.status !== "required-now") return { gateId: VerificationGateId(registeredId),
          status: applicability.status, failureCode: null, evidenceDigest: null,
          successorPurpose: applicability.status === "not-yet-executable" ? applicability.successorPurpose : null,
          notApplicableProof: applicability.status === "not-applicable" ? applicability.proof : null };
        captured ??= capture(fixed);
        bundle = await captured;
        if (failure) throw failure;
        const ref = bundle.evidenceRefs.find(item => item.gateId === registeredId)!;
        return { gateId: ref.gateId, status: "passed", failureCode: null, evidenceDigest: ref.digest,
          successorPurpose: null, notApplicableProof: null };
      } catch (error) {
        failure ??= error instanceof ComparisonEvidenceRefusal ? error : new ComparisonEvidenceRefusal("CAPTURE-FAILED",
          error instanceof ComparisonCorpusError && comparisonCorpusFailureCodes.includes(error.code) ? error.code : null);
        return { gateId: VerificationGateId(registeredId), status: "failed", failureCode: findRegistryGate(registeredId)!.failureCode,
          evidenceDigest: null, successorPurpose: null, notApplicableProof: null } satisfies GateResult;
      }
    });
  }
  return { adapters, readEvidence(): ComparisonEvidenceBundle {
    if (failure) throw failure;
    if (!bundle || used.size !== comparisonVerificationGateIds.length) return refuse("NOT-COMPLETE");
    return copy(bundle);
  } };
}
