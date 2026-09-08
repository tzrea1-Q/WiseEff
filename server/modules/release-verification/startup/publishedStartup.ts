import { isDeepStrictEqual } from "node:util";
import type { Database } from "../../../shared/database/client";
import type { ReleaseVerificationReport } from "../core/types";
import { createStartupRuntimePin, createVerificationReportService, type RuntimePinQuery } from "../report/index";
import type { StartupRefusalReason } from "./interface";

/** Independently observed controller publication state. The producer must protect
 * activation/configuration/retirement metadata while allowing public business
 * operations; it cannot impersonate a maintenance quiescence proof on restart.
 * No field is populated from the report being verified or from an environment flag.
 */
export type PublishedStartupBoundary = RuntimePinQuery & {
  readonly runtimeReportDigest: string;
  readonly publicReportDigest: string;
  readonly preActivationReportDigest: string;
  readonly acceptanceReportDigest: string;
  readonly phaseSnapshot: string;
  readonly predecessorReportDigests: readonly string[];
  readonly pointerRollbackStatus: "open" | "closed";
  readonly trafficIsolationState: "isolated" | "public";
};

export type PublishedStartupResult =
  | { readonly ok: true; readonly scope: "published-candidate-restart-only";
      readonly runtimeReportDigest: string; readonly publicReportDigest: string }
  | { readonly ok: false; readonly reason: StartupRefusalReason | "not-published" };

const sameTarget = (report: ReleaseVerificationReport, current: PublishedStartupBoundary) =>
  isDeepStrictEqual(report.pins, current.pins) && report.evidenceRefs.length > 0 &&
  report.evidenceRefs.every(ref => isDeepStrictEqual(ref.subject, current.subject));

/** Consumes the existing approval/retention/lineage projections. It never runs
 * gates, publishes a pin, approves a report, starts a consumer or changes traffic.
 */
export async function verifyPublishedCandidateStartup(options: {
  readonly reports: Database;
  readonly target: {
    withLockedBoundary<T>(body: () => Promise<T>): Promise<T>;
    observe(): Promise<PublishedStartupBoundary>;
  };
}): Promise<PublishedStartupResult> {
  try {
    return await options.target.withLockedBoundary(async (): Promise<PublishedStartupResult> => {
      const current = structuredClone(await options.target.observe());
      if (current.trafficIsolationState !== "public" || current.pointerRollbackStatus !== "closed") {
        return { ok: false, reason: "not-published" };
      }
      if (current.p13State !== "retired" || !current.writerRetirementFingerprint?.trim() ||
          !current.runtimePinGeneration?.trim()) return { ok: false, reason: "pre-pin" };
      if (!current.runtimeReportDigest?.trim() || !current.publicReportDigest?.trim() ||
          !current.preActivationReportDigest?.trim() || !current.acceptanceReportDigest?.trim()) {
        return { ok: false, reason: "missing" };
      }
      const selected = await createStartupRuntimePin({ db: options.reports }).readApprovedRuntimePin(current);
      if (selected.kind === "absent") return { ok: false, reason: selected.reason };
      if (selected.report.digest !== current.runtimeReportDigest ||
          selected.report.purpose !== "post-retirement-runtime" || selected.report.decision !== "passed" ||
          !sameTarget(selected.report, current)) return { ok: false, reason: "boundary-mismatch" };

      const projection = createVerificationReportService({ db: options.reports });
      // Runtime selection and exact lineage are existing separate projections.
      // Re-reading also detects a changed retained report between those reads.
      const runtime = await projection.readReport(current.runtimeReportDigest);
      if (runtime.kind === "absent") return { ok: false, reason: runtime.reason };
      if (!isDeepStrictEqual(runtime.report, selected.report)) return { ok: false, reason: "boundary-mismatch" };
      if (!isDeepStrictEqual(runtime.report.predecessorReportDigests, [current.preActivationReportDigest])) {
        return { ok: false, reason: "boundary-mismatch" };
      }
      const publication = await projection.readReport(current.publicReportDigest);
      if (publication.kind === "absent") return { ok: false, reason: publication.reason };
      const report = publication.report;
      if (report.digest !== current.publicReportDigest || report.purpose !== "public-release" ||
          report.decision !== "passed" || !sameTarget(report, current) ||
          report.phaseSnapshot !== current.phaseSnapshot || report.pointerRollbackStatus !== "closed" ||
          !isDeepStrictEqual(report.predecessorReportDigests, current.predecessorReportDigests) ||
          !isDeepStrictEqual([...report.predecessorReportDigests].sort(),
            [current.preActivationReportDigest, current.runtimeReportDigest, current.acceptanceReportDigest].sort())) {
        return { ok: false, reason: "boundary-mismatch" };
      }
      // Direct predecessor validity does not prove that acceptance exercised the
      // runtime selected for this restart. Bind that edge through the same
      // approved report projection, without recomputing any verification gate.
      const acceptance = await projection.readReport(current.acceptanceReportDigest);
      if (acceptance.kind === "absent") return { ok: false, reason: acceptance.reason };
      if (acceptance.report.digest !== current.acceptanceReportDigest ||
          acceptance.report.purpose !== "isolated-candidate-acceptance" ||
          acceptance.report.decision !== "passed" || !sameTarget(acceptance.report, current) ||
          !isDeepStrictEqual(acceptance.report.predecessorReportDigests, [current.runtimeReportDigest])) {
        return { ok: false, reason: "boundary-mismatch" };
      }
      const preActivation = await projection.readReport(current.preActivationReportDigest);
      if (preActivation.kind === "absent") return { ok: false, reason: preActivation.reason };
      if (preActivation.report.digest !== current.preActivationReportDigest ||
          preActivation.report.purpose !== "pre-activation" || preActivation.report.decision !== "passed" ||
          !sameTarget(preActivation.report, current) || preActivation.report.predecessorReportDigests.length !== 0) {
        return { ok: false, reason: "boundary-mismatch" };
      }
      // Historical runtime phase and rollback status remain unchanged. Only the
      // public publication is compared with the currently published phase.
      if (!isDeepStrictEqual(current, await options.target.observe())) return { ok: false, reason: "boundary-mismatch" };
      return { ok: true, scope: "published-candidate-restart-only",
        runtimeReportDigest: current.runtimeReportDigest, publicReportDigest: current.publicReportDigest };
    });
  } catch { return { ok: false, reason: "source-unavailable" }; }
}
